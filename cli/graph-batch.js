/* Publish cases individually and make each completed case independently resumable. */
const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { setImmediate: nextTurn } = require('node:timers/promises');
const { fingerprint } = require('./graph-artifact-cache.js');

const receiptFormat = 'ink-studio/graph-batch-receipt';
const progressFile = 'progress.ndjson';
const jsonBytes = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const sha256 = /^[a-f0-9]{64}$/;
const artifactPath = /^artifacts\/[\w.-]+(?:\/[\w.-]+)*$/;

function claim(directory) {
  const root = path.join(directory, '.ink-batch');
  fs.mkdirSync(root, { recursive: true });
  const name = 'writer-' + process.pid + '-' + randomUUID();
  const file = path.join(root, name), release = () => fs.rmSync(file, { force: true });
  fs.writeFileSync(file, '', { flag: 'wx' });
  try {
    for (const entry of fs.readdirSync(root)) {
      if (entry === name) continue;
      const match = /^writer-([1-9][0-9]*)-[0-9a-f-]{36}$/.exec(entry);
      if (!match || Number(match[1]) > 0x7fffffff) continue;
      const previous = path.join(root, entry);
      try {
        process.kill(Number(match[1]), 0);
      } catch (error) {
        if (error.code === 'ESRCH') {
          fs.rmSync(previous, { force: true });
          continue;
        }
      }
      if (fs.existsSync(previous)) throw new Error('Another graph batch is writing to ' + directory);
    }
    return release;
  } catch (error) {
    release();
    throw error;
  }
}

function journal(directory, protect) {
  const file = path.join(directory, progressFile);
  const { O_APPEND, O_RDWR, O_CREAT, O_NOFOLLOW, O_NONBLOCK } = fs.constants;
  const fd = fs.openSync(file, O_APPEND | O_RDWR | O_CREAT | O_NOFOLLOW | O_NONBLOCK);
  try {
    const stat = fs.fstatSync(fd);
    protect(stat);
    if (!stat.isFile()) throw new TypeError('Graph batch progress needs a regular file');
    // Discard a partial last line left by an interrupted append.
    const buffer = Buffer.allocUnsafe(4096);
    let end = stat.size;
    while (end) {
      const offset = Math.max(0, end - buffer.length);
      const length = fs.readSync(fd, buffer, 0, end - offset, offset);
      const newline = buffer.subarray(0, length).lastIndexOf(10);
      if (newline >= 0) { end = offset + newline + 1; break; }
      end = offset;
    }
    if (end !== stat.size) fs.ftruncateSync(fd, end);
    return { append: line => fs.writeFileSync(fd, line + '\n'), close: () => fs.closeSync(fd) };
  } catch (error) {
    fs.closeSync(fd);
    throw error;
  }
}

function verifyArtifact(directory, artifact, buffer) {
  if (!artifact || typeof artifact.file !== 'string' || !artifactPath.test(artifact.file) ||
      artifact.file.split('/').some(part => part === '.' || part === '..') ||
      !Number.isSafeInteger(artifact.bytes) || artifact.bytes < 0 ||
      typeof artifact.sha256 !== 'string' || !sha256.test(artifact.sha256)) return false;
  const file = path.join(directory, artifact.file);
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size !== artifact.bytes) return false;
    const hash = createHash('sha256');
    for (let remaining = stat.size; remaining > 0;) {
      const length = fs.readSync(fd, buffer, 0, Math.min(remaining, buffer.length), null);
      if (!length) return false;
      hash.update(buffer.subarray(0, length));
      remaining -= length;
    }
    return fs.fstatSync(fd).size === stat.size && hash.digest('hex') === artifact.sha256;
  } finally { fs.closeSync(fd); }
}

function readCase(directory, key, id, projectHash, buffer) {
  let receipt;
  try {
    receipt = JSON.parse(fs.readFileSync(path.join(directory, 'receipt.json'), 'utf8'));
    if (receipt?.format !== receiptFormat || receipt.version !== 1 || receipt.key !== key || receipt.id !== id) return {};
    if (receipt.status === 'failed' || receipt.status === 'error') return { retry: true };
    if (receipt.status !== 'completed') return {};
    const bytes = fs.readFileSync(path.join(directory, 'report.json'));
    if (digest(bytes) !== receipt.reportSha256) return {};
    const report = JSON.parse(bytes);
    if (report.format !== 'ink-studio/graph-report' || report.version !== 1 || report.kind !== 'run' ||
        report.projectHash !== projectHash || report.passed !== true || !Array.isArray(report.artifacts) ||
        !report.artifacts.every(artifact => verifyArtifact(directory, artifact, buffer))) return {};
    return { report, receipt };
  } catch { return {}; }
}

async function runBatch(project, batch, options) {
  const { output, resume, stream, writer, runtime, identity, cache } = options;
  const attempt = randomUUID(), { projectHash } = project.validate(), total = batch.cases.length;
  const counts = { completed: 0, reused: 0, failed: 0, error: 0 };
  const results = [], buffer = output && Buffer.allocUnsafe(64 * 1024);
  const release = output && claim(output);
  let log, sequence = 0;
  async function emit(type, details) {
    const line = JSON.stringify({ format: 'ink-studio/graph-batch-progress', version: 1, attempt,
      sequence: ++sequence, type, ...details });
    log?.append(line);
    if (stream) await stream(line);
  }

  try {
    if (output) log = journal(output, writer.protect);
    await emit('batch-started', { projectHash, total });
    for (const [index, row] of batch.cases.entries()) {
      const { id } = row, relative = 'cases/' + id, directory = output && path.join(output, relative);
      const request = row.requestKey(), key = fingerprint([runtime, identity.fingerprint, id, request]);
      const previous = resume ? readCase(directory, key, id, projectHash, buffer) : {};
      let { report, receipt } = previous;
      let status = 'reused';
      if (!report) {
        await emit('case-started', { id, index, key, directory: relative });
        // Give pipe consumers and signals a turn before starting the next synchronous evaluation.
        await nextTurn();
        let result;
        try {
          project.clear();
          result = cache ? cache('run', identity, { batchCase: request, runtime }, row.run, {
            reuse: !previous.retry, accept: cached => cached.report.passed === true
          }) : row.run();
          status = result.report.passed ? 'completed' : 'failed';
        } catch (error) {
          status = 'error';
          result = { artifacts: [], report: { format: 'ink-studio/graph-report', version: 1, projectHash, kind: 'run',
            passed: false, error: error?.message ?? String(error), assertions: [], artifacts: [] } };
        }
        report = result.report;
        const bytes = jsonBytes(report);
        receipt = { format: receiptFormat, version: 1, id, key, status, reportSha256: digest(bytes) };
        if (output) writer.write(directory, [...result.artifacts, { file: 'report.json', bytes },
          { file: 'receipt.json', document: receipt }]);
      }
      counts[status]++;
      results.push({ id, report });
      await emit('case-finished', { id, index, key, status, directory: relative, reportSha256: receipt.reportSha256,
        artifacts: report.artifacts, ...(report.error && { error: report.error }) });
    }
    const report = { ...batch.summarize(results), resume: { ...counts, ...(output && { progress: progressFile }) } };
    const code = counts.error ? 1 : report.passed ? 0 : 2;
    if (output) writer.write(output, [{ file: 'report.json', document: report }]);
    await emit('batch-finished', { code, report });
    return { code, report };
  } finally {
    try { project.clear(); }
    finally {
      try { log?.close(); }
      finally { release?.(); }
    }
  }
}

module.exports = { runBatch };
