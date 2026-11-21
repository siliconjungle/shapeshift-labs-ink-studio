/* Persistent, bounded storage for complete headless graph artifact sets. */
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { serialize, deserialize } = require('node:v8');
const files = require('./asset-files.js');

const defaultBytes = 256 * 1024 * 1024;
const defaultEntries = 128;
const maxEntryBytes = 256 * 1024 * 1024;
const hash = () => createHash('sha256');
const fingerprint = value => hash().update(serialize(value)).digest('hex');
const entryName = /^[a-f0-9]{64}\.bin$/;
const artifactPath = /^(?!.*(?:^|\/)\.{1,2}(?:\/|$))[\w.-]+(?:\/[\w.-]+)*$/;

function engineFingerprint(kit, { allowCustom = false } = {}) {
  const studio = require('../index.js'), build = studio.toolkitBuildHash(kit);
  if (!build && !allowCustom) return undefined;
  const custom = !build && Object.values(require.cache).find(module => module.exports === kit);
  const source = custom ? hash().update(fs.readFileSync(custom.filename)).digest('hex') : build ?? 'custom-toolkit';
  const runtime = hash().update(serialize([source, process.versions, process.platform, process.arch,
    Intl.DateTimeFormat().resolvedOptions()]));
  for (const directory of ['cli', 'src']) {
    const root = path.join(__dirname, '..', directory);
    for (const name of fs.readdirSync(root).filter(name => /\.js$/.test(name)).sort()) {
      const bytes = fs.readFileSync(path.join(root, name));
      runtime.update(directory + '/' + name + '\0').update(hash().update(bytes).digest());
    }
  }
  return runtime.digest('hex');
}

function portable(result) {
  const { report, artifacts, results } = result;
  return results ? { report, results: results.map(({ id, report, artifacts }) => ({ id, report, artifacts })) } :
    { report, artifacts };
}

function validResult(result, mode) {
  function artifacts(rows) {
    return Array.isArray(rows) && rows.every(row =>
      typeof row?.file === 'string' && artifactPath.test(row.file) && Buffer.isBuffer(row.bytes) &&
      typeof row.sha256 === 'string' && /^[a-f0-9]{64}$/.test(row.sha256));
  }
  function report(value, kind) {
    return value?.version === 1 && (kind === 'clip' ? value.format === 'ink-studio/graph-clip' :
      value.format === 'ink-studio/graph-report' && value.kind === kind);
  }
  return report(result?.report, mode) && (mode === 'batch' ? Array.isArray(result.results) &&
    result.results.every(row => typeof row?.id === 'string' && /^[a-z][\w.-]{0,99}$/i.test(row.id) &&
      report(row.report, 'run') && artifacts(row.artifacts)) : artifacts(result.artifacts));
}

function openGraphArtifactCache(directory, { kit, maxBytes = defaultBytes, maxEntries = defaultEntries } = {}) {
  if (typeof directory !== 'string' || !directory.trim() ||
      ![maxBytes, maxEntries].every(n => Number.isSafeInteger(n) && n > 0))
    throw new TypeError('Graph cache needs a directory and positive cache byte and entry limits');
  const root = path.resolve(directory, 'ink-graph-artifacts-v1');
  const entryLimit = Math.min(maxEntryBytes, maxBytes);
  let engine, engineError;
  try { engine = engineFingerprint(kit); }
  catch { engineError = 'unavailable'; }
  const filename = key => path.join(root, key + '.bin');
  const checksum = (key, payload) => hash().update(key, 'hex').update(payload).digest();

  function prune() {
    const entries = [];
    let size = 0;
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      const staged = entry.isDirectory() && /^\.ink-asset-\w+$/.test(entry.name);
      if (!staged && !entryName.test(entry.name)) continue;
      const file = path.join(root, entry.name);
      const stat = fs.lstatSync(file, { throwIfNoEntry: false });
      if (!stat) continue;
      if (staged && stat.isDirectory() && Date.now() - stat.mtimeMs > 3600000)
        fs.rmSync(file, { recursive: true, force: true });
      if (staged || !stat.isFile()) continue;
      entries.push({ file, size: stat.size, time: stat.mtimeMs });
      size += stat.size;
    }
    let count = entries.length;
    if (size <= maxBytes && count <= maxEntries) return;
    entries.sort((a, b) => a.time - b.time || a.file.localeCompare(b.file));
    for (const entry of entries) {
      fs.rmSync(entry.file, { force: true });
      size -= entry.size;
      count--;
      if (size <= maxBytes && count <= maxEntries) break;
    }
  }

  function read(key, mode) {
    let fd;
    try {
      fd = fs.openSync(filename(key), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
      const stat = fs.fstatSync(fd);
      if (!stat.isFile() || stat.size <= 32 || stat.size > entryLimit) return;
      const bytes = Buffer.allocUnsafe(stat.size);
      for (let offset = 0; offset < bytes.length;) {
        const length = fs.readSync(fd, bytes, offset, bytes.length - offset, offset);
        if (!length) return;
        offset += length;
      }
      const payload = bytes.subarray(32);
      if (!checksum(key, payload).equals(bytes.subarray(0, 32))) return;
      const result = deserialize(payload);
      if (!validResult(result, mode)) return;
      try { const now = new Date(); fs.futimesSync(fd, now, now); }
      catch { /* Read-only caches can still replay a valid result. */ }
      return result;
    } catch { /* A missing, interrupted or unreadable entry can be rebuilt. */ }
    finally { if (fd !== undefined) fs.closeSync(fd); }
  }

  function write(key, result, mode) {
    try {
      const copy = portable(result);
      if (!validResult(copy, mode)) return 'unavailable';
      const artifactBytes = (copy.results ?? [copy]).reduce((total, row) =>
        total + row.artifacts.reduce((size, artifact) => size + artifact.bytes.length, 0), 0);
      if (artifactBytes > entryLimit) return 'oversize';
      const payload = serialize(copy);
      if (payload.length + 32 > entryLimit) return 'oversize';
      const file = filename(key);
      files.write(file, Buffer.concat([checksum(key, payload), payload]));
      try { prune(); }
      catch (error) {
        fs.rmSync(file, { force: true });
        throw error;
      }
      return fs.existsSync(file) ? undefined : 'evicted';
    } catch { return 'unavailable'; }
  }

  function report(result, artifactCache) {
    return { ...result, report: { ...result.report, artifactCache } };
  }

  return (mode, identity, settings, evaluate, { reuse = true, accept } = {}) => {
    const reason = identity.reason ?? engineError ?? (!engine && 'custom-toolkit');
    if (reason) return report(evaluate(), { status: 'bypass', reason, ...(identity.operations && { operations: identity.operations }) });
    const key = fingerprint([engine, mode, identity.fingerprint, settings]);
    try { prune(); } catch { /* Publishing will create the cache on the first miss. */ }
    const cached = reuse && read(key, mode);
    if (cached && (!accept || accept(cached))) return report(cached, { status: 'hit', key });
    const result = evaluate();
    const unavailable = write(key, result, mode);
    return report(result, { status: 'miss', key, stored: !unavailable, ...(unavailable && { reason: unavailable }) });
  };
}

module.exports = { openGraphArtifactCache, fingerprint, engineFingerprint };
