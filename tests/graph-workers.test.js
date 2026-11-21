const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createGraphProject, createGraphWorkers } = require('..');

const cli = path.resolve(__dirname, '../cli/ink-studio.js');
const link = (node, port = 'value') => ({ node, port });
const width = 360;
const make = (nodes, outputs) => ({ format: 'ink-studio/graph-project', version: 1, nodes, outputs });
const node = (op, inputs = {}) => ({ op, inputs });

function branches(size = width) {
  return {
    orange: node('raster.canvas', { width: size, height: size, color: [209, 91, 36] }),
    glow: node('fx.pathBlur', { source: link('orange'), path: [[0, 0], [13.3, 24.7]], options: { samples: 26 } }),
    blue: node('raster.canvas', { width: size, height: size, color: [28, 113, 211] }),
    haze: node('fx.kernelBlur', { source: link('blue'), options: { radius: 25 } })
  };
}

test('CLI runs independent branches on workers and keeps PNG bytes and declared output order', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-graph-workers-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'graph.json');
  const project = make(branches(), { warm: link('glow'), cool: link('haze'), source: link('orange') });
  project.exports = { first: { output: 'warm', format: 'png' }, second: { output: 'cool', format: 'png' } };
  fs.writeFileSync(file, JSON.stringify(project));
  const run = count => {
    const out = path.join(directory, String(count));
    const child = spawnSync(process.execPath, [cli, 'graph', 'run', file, '--workers', String(count), '--out', out],
      { encoding: 'utf8' });
    assert.equal(child.status, 0, child.stderr);
    const report = JSON.parse(child.stdout);
    return { report, files: report.artifacts.map(artifact => fs.readFileSync(path.join(out, artifact.file))) };
  };
  const serial = run(1), parallel = run(2);
  assert.equal(serial.report.workers.jobs, 0);
  assert.equal(parallel.report.workers.jobs, 2);
  assert.equal(parallel.report.workers.peakConcurrent, 2);
  assert(parallel.report.workers.inputBytesCopied >= width * width * 4 * 2);
  assert.equal(parallel.report.workers.outputBytesTransferred, width * width * 4 * 2);
  assert.deepEqual(Object.keys(parallel.report.cache.nodes), ['orange', 'glow', 'blue', 'haze']);
  assert.deepEqual(Object.keys(parallel.report.outputs), ['warm', 'cool', 'source']);
  assert.deepEqual(parallel.report.artifacts, serial.report.artifacts);
  assert.deepEqual(parallel.files, serial.files);
});

test('workers preserve shared inputs, cached group results and host execution order', () => {
  const calls = [], workers = createGraphWorkers(2);
  const nodes = branches();
  nodes.haze.inputs.source = link('orange');
  const root = make({
    before: node('probe', { stage: 'before' }), inside: node('BlurGroup'),
    after: node('probe', { stage: 'after', value: link('inside', 'fromSource') })
  }, { h: link('inside', 'haze'), g: link('inside', 'glow'), value: link('after') });
  root.groups = { BlurGroup: { nodes, outputs: { glow: link('glow'), haze: link('haze'), fromSource: link('orange') } } };
  const project = createGraphProject(root, { workerPool: workers, operations: {
    probe: { inputs: { stage: 'string', value: { type: 'any', default: null } }, outputs: { value: 'number' },
      run({ stage, value }) { calls.push(stage); return { value: value?.data[0] ?? 0 }; } }
  } });
  try {
    const first = project.run();
    assert.equal(first.report.workers.jobs, 2);
    assert.equal(first.outputs.value, 209);
    assert.deepEqual(calls, ['before', 'after']);
    const repeat = project.run();
    assert.equal(repeat.report.workers.jobs, 0);
    assert(repeat.report.cache.hits > 0);
    assert.deepEqual(calls, ['before', 'after']);
    assert.deepEqual(Object.keys(repeat.outputs), ['h', 'g', 'value']);
  } finally {
    project.clear();
    workers.close();
  }
});

test('cheap graphs, single branches and host overrides stay in the coordinator', () => {
  const workers = createGraphWorkers(2);
  try {
    const short = make(branches(64), { color: link('glow') });
    assert.equal(createGraphProject(short, { workerPool: workers }).run().report.workers.startedThreads, 0);
    const one = make({ canvas: node('raster.canvas', { width, height: width }),
      blur: node('fx.kernelBlur', { source: link('canvas'), options: { radius: 25 } }) }, { result: link('blur') });
    assert.equal(createGraphProject(one, { workerPool: workers }).run().report.workers.jobs, 0);
    const overridden = make(branches(), { warm: link('glow'), cool: link('haze') });
    const result = createGraphProject(overridden, { workerPool: workers, operations: {
      'fx.pathBlur': { inputs: { source: 'raster', path: 'path', options: 'record' }, outputs: { value: 'raster' },
        run({ source }) { return { value: source }; } }
    } }).run();
    assert.equal(result.report.workers.startedThreads, 0);
    assert.equal(result.outputs.warm.data[0], 209);
  } finally { workers.close(); }
});

test('a worker failure replays the pure block and preserves serial errors and results', () => {
  const workers = createGraphWorkers(2, { timeoutMs: 1 });
  const spec = make(branches(), { warm: link('glow'), cool: link('haze') });
  try {
    const project = createGraphProject(spec, { workerPool: workers });
    const result = project.run(), expected = createGraphProject(spec).run();
    assert.equal(result.report.workers.fallbacks, 1);
    assert.deepEqual(result.outputs, expected.outputs);
    spec.nodes.glow.inputs.options.edge = 'invalid';
    const invalid = createGraphProject(spec, { workerPool: workers });
    assert.throws(() => invalid.run(), { name: 'TypeError', message: 'Pixel filter edge must be clamp, transparent or wrap' });
  } finally { workers.close(); }
});
