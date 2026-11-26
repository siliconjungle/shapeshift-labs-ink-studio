// Headless orchestration of native Ink commands with checked artifact receipts.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { isDeepStrictEqual } = require('node:util');
const { fingerprint, engineFingerprint } = require('./graph-artifact-cache.js');
const Assets = require('./asset-files.js');

const planFormat = 'ink-studio/task-graph', runFormat = 'ink-studio/task-run';
const operations = new Set(['render', 'clip', 'sweep', 'sim', 'graph', 'shot', 'export-scene', 'export-glb']);
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

function fileDigest(file, buffer) {
  const info = fs.lstatSync(file);
  if (info.isDirectory()) {
    const entries = fs.readdirSync(file).sort().map(name => [name, fileDigest(path.join(file, name), buffer)]);
    return { kind: 'directory', sha256: fingerprint(entries), entries: entries.length };
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

function existing(directory, key, outputs, buffer) {
  try {
    const receipt = read(path.join(directory, 'receipt.json'));
    if (receipt.key === key && isDeepStrictEqual(receipt.artifacts,
      Object.fromEntries(Object.entries(outputs).map(([name, file]) =>
        [name, fileDigest(path.join(directory, 'artifacts', file), buffer)])))) return receipt;
  } catch (error) {
    if (error.code !== 'ENOENT' && !(error instanceof SyntaxError) && !(error instanceof TypeError)) throw error;
  }
}

function run(plan, directory, { resume, kit, entry }) {
  const marker = path.join(directory, 'task-run.json');
  if (fs.existsSync(directory) && fs.readdirSync(directory).length)
    check(resume && fs.existsSync(marker) && read(marker).format === runFormat,
      'Use a new task directory or resume an existing task run');
  fs.mkdirSync(directory, { recursive: true });
  const release = require('./graph-batch.js').claim(directory, 'task graph');
  try {
    return execute(plan, directory, { resume, kit, entry, marker });
  } finally {
    release();
  }
}

function execute(plan, directory, { resume, kit, entry, marker }) {
  const engine = engineFingerprint(kit, { allowCustom: true });
  const results = new Map(), buffer = Buffer.allocUnsafe(64 * 1024);
  const runs = path.join(directory, 'tasks');
  fs.mkdirSync(runs, { recursive: true });
  if (!fs.existsSync(marker)) Assets.json(marker, { format: runFormat, version: 1 });
  for (const id of plan.order) {
    const task = plan.tasks.get(id);
    const blocked = task.dependencies.filter(dep => !['completed', 'reused'].includes(results.get(dep).status));
    if (blocked.length) {
      results.set(id, { id, status: 'blocked', dependencies: blocked });
      continue;
    }
    const parent = path.join(runs, id);
    fs.mkdirSync(parent, { recursive: true });
    try {
      const inputs = Object.fromEntries(Object.entries(task.inputs).map(([name, spec]) =>
        [name, typeof spec === 'string' ? path.join(plan.root, spec) : results.get(spec.task).outputs[spec.artifact]]));
      const inputDigests = Object.fromEntries(Object.entries(inputs).map(([name, file]) => [name, fileDigest(file, buffer)]));
      const key = fingerprint([engine, plan.root, task, inputDigests]), destination = path.join(parent, key);
      const outputs = Object.fromEntries(Object.entries(task.outputs).map(([name, file]) =>
        [name, path.join(destination, 'artifacts', file)]));
      const prior = resume && existing(destination, key, task.outputs, buffer);
      if (prior) {
        results.set(id, { id, status: 'reused', ...prior, outputs });
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
        const child = spawnSync(process.execPath, [entry, task.command, ...args], {
          cwd: plan.root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024
        });
        Assets.write(path.join(parent, 'last.log'), (child.stdout ?? '') + (child.stderr ?? ''));
        if (child.error) throw child.error;
        check(task.acceptExit.includes(child.status),
          'Native command exited with ' + (child.status ?? child.signal));
        const receipt = { key, exit: child.status, inputs: inputDigests, artifacts:
          Object.fromEntries(Object.entries(task.outputs).map(([name, file]) =>
            [name, fileDigest(path.join(artifacts, file), buffer)])) };
        Assets.json(path.join(scratch, 'receipt.json'), receipt);
        if (fs.existsSync(destination)) fs.rmSync(destination, { recursive: true });
        fs.renameSync(scratch, destination);
        results.set(id, { id, status: 'completed', ...receipt, outputs });
      } finally {
        fs.rmSync(scratch, { recursive: true, force: true });
      }
    } catch (error) {
      results.set(id, { id, status: 'failed', error: error.message, log: path.relative(directory, path.join(parent, 'last.log')) });
    }
  }
  const rows = [...results.values()];
  const report = { format: runFormat, version: 1, passed: rows.every(row =>
    row.status === 'completed' || row.status === 'reused'), tasks: rows };
  Assets.json(path.join(directory, 'report.json'), report);
  return report;
}

module.exports = { prepare, run };
