// Headless orchestration of native Ink commands with checked artifact receipts.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const { fingerprint, engineFingerprint } = require('./graph-artifact-cache.js');
const { claim } = require('./graph-batch.js');
const Assets = require('./asset-files.js');
const Process = require('./task-process.js');

const planFormat = 'ink-studio/task-graph', runFormat = 'ink-studio/task-run';
const operations = new Set([
  'shape', 'mesh-topology', 'sim', 'graph', 'render', 'clip', 'sweep', 'shot', 'project', 'export-scene', 'export-glb'
]);
const name = value => typeof value === 'string' && /^[a-z][a-z0-9_-]{0,79}$/.test(value);
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fields = (value, keys) => record(value) && Object.keys(value).every(key => keys.includes(key));
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const filePath = value => typeof value === 'string' && value.length <= 240 &&
  value.split('/').every(part => part !== '.' && part !== '..' && /^[\w.-]+$/.test(part));
function check(condition, message) {
  if (!condition) throw new TypeError(message);
}

function prepare(filename) {
  const file = path.resolve(filename), root = path.dirname(file), spec = read(file);
  check(fields(spec, ['format', 'version', 'tasks']) && spec.format === planFormat &&
    spec.version === 1 && record(spec.tasks), 'Expected an Ink task graph, version 1');
  const entries = Object.entries(spec.tasks);
  check(entries.length > 0 && entries.length <= 128, 'A task graph needs 1–128 tasks');
  const tasks = new Map(entries.map(([id, task]) => {
    check(name(id) && fields(task, ['command', 'args', 'inputs', 'outputs', 'acceptExit']) &&
      operations.has(task.command), 'Invalid native task ' + id);
    const { command, args, inputs = {}, outputs, acceptExit = [0] } = task;
    check(record(inputs) && record(outputs) && Object.keys(inputs).length <= 64 &&
      Object.keys(outputs).length >= 1 && Object.keys(outputs).length <= 32, 'Invalid artifacts for ' + id);
    for (const [key, input] of Object.entries(inputs)) {
      check(name(key) && (filePath(input) || fields(input, ['task', 'artifact']) &&
        name(input.task) && name(input.artifact)), 'Invalid input ' + id + '/' + key);
    }
    const outputFiles = Object.values(outputs);
    check(Object.keys(outputs).every(name) && outputFiles.every(filePath) &&
      outputFiles.every((file, i) => outputFiles.every((other, j) =>
        i === j || file !== other && !file.startsWith(other + '/'))), 'Task outputs need separate paths for ' + id);
    check(Array.isArray(args) && args.length <= 128 && args.every(arg => typeof arg === 'string' && arg.length < 4096 ||
      fields(arg, ['input', 'output']) && Object.keys(arg).length === 1 &&
      (Object.hasOwn(arg, 'input') ? Object.hasOwn(inputs, arg.input) : Object.hasOwn(outputs, arg.output))),
    'Task arguments need literal strings or declared input and output references for ' + id);
    check(args.filter(arg => typeof arg === 'string' && /^--out(?:=|$)/.test(arg)).length === 1 &&
      args.some((arg, i) => arg === '--out' && Object.hasOwn(args[i + 1] ?? {}, 'output')),
      'Task must write --out to a declared artifact for ' + id);
    check(Array.isArray(acceptExit) && acceptExit.length >= 1 && new Set(acceptExit).size === acceptExit.length &&
      acceptExit.every(code => [0, 2].includes(code)), 'Task acceptExit supports success or completed-with-findings codes');
    const dependencies = [...new Set(Object.values(inputs).filter(record).map(input => input.task))];
    return [id, { id, command, args, inputs, outputs, acceptExit, dependencies }];
  }));
  for (const { id, inputs } of tasks.values()) for (const input of Object.values(inputs))
    if (record(input)) check(Object.hasOwn(tasks.get(input.task)?.outputs ?? {}, input.artifact),
      'Unknown upstream artifact for ' + id + ': ' + input.task + '/' + input.artifact);
  // A pass over ready tasks provides deterministic order and catches cycles before any work.
  const order = [], pending = new Set(tasks.keys());
  while (pending.size) {
    const ready = [...pending].filter(id => tasks.get(id).dependencies.every(dep => !pending.has(dep)));
    check(ready.length, 'Task graph contains a dependency cycle');
    ready.forEach(id => { order.push(id); pending.delete(id); });
  }
  return { root, tasks, order };
}

const jsonDigest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function fileDigest(file, buffer, measure) {
  const info = fs.lstatSync(file);
  measure?.(info, file);
  if (info.isDirectory()) {
    const entries = fs.readdirSync(file).sort().map(name => [name, fileDigest(path.join(file, name), buffer, measure)]);
    return { kind: 'directory', sha256: jsonDigest(entries), entries: entries.length };
  }
  check(info.isFile(), 'Task inputs and outputs must be ordinary files or directories');
  const hash = createHash('sha256'), reader = fs.openSync(file, 'r');
  try {
    let length;
    while ((length = fs.readSync(reader, buffer)) > 0) hash.update(buffer.subarray(0, length));
  } finally {
    fs.closeSync(reader);
  }
  return { kind: 'file', bytes: info.size, sha256: hash.digest('hex') };
}

function digests(paths, buffer, measure) {
  return Object.fromEntries(Object.entries(paths).map(([name, file]) => [name, fileDigest(file, buffer, measure)]));
}

function manifest(plan, limits) {
  const files = [...new Set([...plan.tasks.values()].flatMap(task =>
    Object.values(task.inputs).filter(input => typeof input === 'string')))].sort();
  const root = fs.realpathSync(plan.root);
  const paths = Object.fromEntries(files.map(file => {
    const location = path.join(root, file);
    check(fs.realpathSync(location) === location, 'Declared worker assets must use ordinary paths');
    return [file, location];
  }));
  const measure = limits && Process.meter(limits.inputBytes, limits.files, 'Declared assets');
  const assets = digests(paths, Buffer.allocUnsafe(64 * 1024), measure);
  const recipe = jsonDigest([...plan.tasks.values()]);
  return { recipe, assets, id: jsonDigest([recipe, assets]) };
}

function existing(directory, key, task, inputs, buffer, measure) {
  try {
    const receipt = read(path.join(directory, 'receipt.json'));
    if (receipt?.key !== key || !task.acceptExit.includes(receipt.exit) || !isDeepStrictEqual(receipt.inputs, inputs)) return;
    const paths = Object.fromEntries(Object.entries(task.outputs).map(([name, file]) =>
      [name, path.join(directory, 'artifacts', file)]));
    if (isDeepStrictEqual(receipt.artifacts, digests(paths, buffer, measure)))
      return { key, exit: receipt.exit, inputs, artifacts: receipt.artifacts };
  } catch (error) {
    if (!['ENOENT', 'ENOTDIR', 'EISDIR'].includes(error.code) &&
        !(error instanceof SyntaxError) && !(error instanceof TypeError)) throw error;
  }
}

async function run(plan, directory, { resume, kit, entry, limits, signal, env, progress, output }) {
  const marker = path.join(directory, 'task-run.json');
  const release = claim(directory, 'task graph');
  const controller = new AbortController(), deadline = limits && Date.now() + limits.jobMs;
  const abort = () => controller.abort(signal.reason);
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const timeLimit = () => controller.abort(Process.taskError('JOB_TIMEOUT', 'Job exceeded its time budget'));
  const timeout = limits && setTimeout(timeLimit, limits.jobMs);
  try {
    if (fs.readdirSync(directory).some(name => name !== '.ink-batch')) {
      const saved = resume && fs.existsSync(marker) && read(marker);
      check(saved?.format === runFormat && saved.version === 1, 'Use a new task directory or resume an existing task run');
    } else {
      Assets.json(marker, { format: runFormat, version: 1 });
    }
    return await execute(plan, directory, { resume, kit, entry, limits, signal: controller.signal, env, progress, output,
      checkTime() { if (deadline && Date.now() >= deadline) timeLimit(); } });
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
    release();
  }
}

async function execute(plan, directory, { resume, kit, entry, limits, signal, env, progress, output, checkTime }) {
  const engine = engineFingerprint(kit, { allowCustom: true });
  const results = new Map(), buffer = Buffer.allocUnsafe(64 * 1024);
  const runs = path.join(directory, 'tasks');
  fs.mkdirSync(runs, { recursive: true });
  const emit = (event, task) => progress?.({ event, ...task });
  const finish = row => {
    results.set(row.id, row);
    emit('task-finished', { id: row.id, status: row.status, code: row.code });
  };
  const inputMeter = () => limits && Process.meter(limits.inputBytes, limits.files, 'Task input');
  const outputMeter = () => limits && Process.meter(limits.outputBytes, limits.files, 'Task output');
  for (const id of plan.order) {
    checkTime();
    if (signal.aborted) break;
    const task = plan.tasks.get(id);
    const blocked = task.dependencies.filter(dep => !['completed', 'reused'].includes(results.get(dep).status));
    if (blocked.length) {
      finish({ id, status: 'blocked', dependencies: blocked });
      continue;
    }
    const parent = path.join(runs, id);
    fs.mkdirSync(parent, { recursive: true });
    let log;
    try {
      const inputs = Object.fromEntries(Object.entries(task.inputs).map(([name, spec]) =>
        [name, typeof spec === 'string' ? path.join(plan.root, spec) : results.get(spec.task).outputs[spec.artifact]]));
      const inputDigests = digests(inputs, buffer, inputMeter());
      const inputNames = Object.values(task.inputs).map(spec =>
        typeof spec === 'string' ? spec : plan.tasks.get(spec.task).outputs[spec.artifact]);
      const key = fingerprint([engine, env?.INK_STUDIO_PORTABLE_SHOT, plan.root, task, inputNames, inputDigests]);
      const destination = path.join(parent, key);
      const outputs = Object.fromEntries(Object.entries(task.outputs).map(([name, file]) =>
        [name, path.join(destination, 'artifacts', file)]));
      const prior = resume && existing(destination, key, task, inputDigests, buffer, outputMeter());
      if (prior) {
        finish({ id, status: 'reused', ...prior, outputs });
        continue;
      }
      const scratch = fs.mkdtempSync(path.join(parent, '.attempt-'));
      try {
        const artifacts = path.join(scratch, 'artifacts');
        fs.mkdirSync(artifacts);
        for (const file of Object.values(task.outputs))
          fs.mkdirSync(path.dirname(path.join(artifacts, file)), { recursive: true });
        const args = task.args.map(arg => typeof arg === 'string' ? arg :
          arg.input ? inputs[arg.input] : path.join(artifacts, task.outputs[arg.output]));
        emit('task-started', { id });
        const child = await Process.launch(entry, task.command, args, {
          cwd: plan.root, artifacts, signal, limits, env, onOutput: chunk => output?.(id, chunk)
        });
        const logFile = path.join(parent, 'last.log');
        Assets.write(logFile, child.log);
        log = path.relative(directory, logFile);
        if (child.error) throw child.error;
        check(task.acceptExit.includes(child.status),
          'Native command exited with ' + (child.status ?? child.signal));
        check(isDeepStrictEqual(inputDigests, digests(inputs, buffer, inputMeter())), 'Declared inputs changed during execution');
        const staged = Object.fromEntries(Object.entries(task.outputs).map(([name, file]) =>
          [name, path.join(artifacts, file)]));
        if (limits) Process.scan(artifacts, outputMeter());
        const receipt = { key, exit: child.status, inputs: inputDigests, artifacts: digests(staged, buffer, outputMeter()) };
        checkTime();
        signal.throwIfAborted();
        Assets.json(path.join(scratch, 'receipt.json'), receipt);
        if (fs.existsSync(destination)) fs.rmSync(destination, { recursive: true });
        fs.renameSync(scratch, destination);
        finish({ id, status: 'completed', ...receipt, outputs });
      } finally {
        fs.rmSync(scratch, { recursive: true, force: true });
      }
    } catch (error) {
      finish({ id, status: signal.aborted ? 'cancelled' : 'failed', error: error.message,
        ...(error.code && { code: error.code }), ...(log && { log }) });
    }
  }
  checkTime();
  const rows = [...results.values()];
  const report = { format: runFormat, version: 1, passed: !signal.aborted && rows.every(row =>
    row.status === 'completed' || row.status === 'reused'), tasks: rows,
    ...(signal.aborted && { stop: { code: signal.reason.code, message: signal.reason.message } }) };
  Assets.json(path.join(directory, 'report.json'), report);
  return report;
}

module.exports = { prepare, run, manifest, fileDigest, filePath };
