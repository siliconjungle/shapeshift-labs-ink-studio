const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const ink = require('..');
const PNG = require('../cli/png.js');
const project = require('../examples/thermal-survey-graph.cjs');

const kit = ink.load();
const link = (node, port = 'value') => ({ node, port });

test('software evaluation connects a solver, mesh, material group and borrowed scene textures', async () => {
  const graph = ink.createGraphProject({ ...project, outputs: { ...project.outputs, frame: link('capture', 'frame'),
    pixels: link('capture'), mask: link('mask'), field: link('field'), grid: link('smoke', 'grid'), measure: link('measure'),
    surface: link('offset') } }, { kit });
  const { report, artifacts } = await graph.evaluateSoftware(['rendered', 'mask', 'measure', 'terrain']);
  assert.equal(report.backend, 'software');
  assert(report.passed);
  assert.equal(report.performance.renderPasses.length, 1);
  assert.equal(report.performance.renderPasses[0].node, 'capture');
  assert(report.performance.renderPasses[0].fragments > 0);
  assert(report.performance.timingsMs.capture > 0);
  assert(report.performance.samples.sharedLinkedViewBytes > 0);
  const find = node => report.nodes.find(row => row.node === node);
  assert.equal(find('terrain').outputs.value.type, 'sceneMesh');
  assert.equal(find('terrain/binding').inputs.material.type, 'materialChannels');
  assert(find('capture').inputs.renderGraphInputs.sharedBytes > 0);
  assert.equal(find('mask').outputs.value.type, 'grayImage');

  const { outputs: got } = graph.run();
  assert.strictEqual(got.survey.raster.data, got.pixels.data);
  assert.strictEqual(got.mask.raster.data, got.frame.renderGraphPasses.density.data);
  assert.strictEqual(got.field.data.buffer, got.grid.data.buffer);
  assert.strictEqual(got.measure.raster.data, got.field.data);
  assert.equal(got.surface.uvs[0], 0);
  assert.deepEqual(Array.from(got.surface.uvs.subarray(-2)), [1, 1]);
  assert(got.binding.channels.every(channel => channel.sharedInput));
  assert.deepEqual(report.captured.map(row => row.format), ['png','png','json','json']);
  assert.deepEqual(PNG.raster(artifacts[0].bytes).data, got.survey.raster.data);
  const saved = JSON.parse(artifacts[2].bytes);
  assert.equal(saved.descriptor.precision, 'float64');
  assert.deepEqual(saved.raster.data, Array.from(got.field.data));
  assert.equal(JSON.parse(artifacts[3].bytes).triangles, got.binding.triangles);

  const warm = await graph.evaluateSoftware(['rendered']);
  assert.equal(warm.report.performance.renderPasses.length, 0);
  assert(warm.report.nodes.every(row => row.status === 'cached' && row.computeMs === 0));
  assert.equal(warm.report.captured[0].sha256, report.captured[0].sha256);
  const edited = await graph.evaluateSoftware(['rendered'], { time: .72 });
  assert.notEqual(edited.report.captured[0].sha256, report.captured[0].sha256);
  const statuses = edited.report.cache.nodes;
  assert.equal(statuses.slab, 'cached');
  assert.equal(statuses.smoke, 'evaluated');
  assert.equal(statuses['terrain/binding'], 'evaluated');
});

test('read-only field slices borrow contiguous rows and pack strided components', () => {
  const A = kit.KIT.world.outputAdapters;
  const field = A.field({ shape: [2, 2, 2], components: 2, data: Array.from({ length: 16 }, (_, i) => i) });
  const z = A.fieldRaster(field, { axis: 'z', index: 1, share: true });
  assert.equal(z.report.borrowed, true);
  assert.strictEqual(z.value.data.buffer, field.data.buffer);
  assert.deepEqual(Array.from(z.value.data), [8,9,10,11,12,13,14,15]);
  const x = A.fieldRaster(field, { axis: 'x', index: 1, component: 1, share: true });
  assert.equal(x.report.borrowed, false);
  assert.notStrictEqual(x.value.data.buffer, field.data.buffer);
  assert.deepEqual(Array.from(x.value.data), [3,7,11,15]);
  assert.notStrictEqual(A.fieldRaster(field).value.data.buffer, field.data.buffer);
});

test('graph evaluate CLI persists selected typed textures without project exports', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-software-graph-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const graph = path.join(directory, 'survey.json'), out = path.join(directory, 'out');
  fs.writeFileSync(graph, JSON.stringify(project));
  const cli = path.resolve(__dirname, '../cli/ink-studio.js');
  const run = (...args) => spawnSync(process.execPath, [cli, 'graph', 'evaluate', graph, ...args], { encoding: 'utf8' });
  const result = run('--capture', 'original,terrain/binding:report', '--out', out, '--json');
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(out, 'report.json'))), report);
  for (const row of report.captured) {
    const bytes = fs.readFileSync(path.join(out, row.file));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), row.sha256);
  }
  const invalid = run('--capture', 'original');
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /need --out/);
  const pulse = { op: 'evaluate', capture: ['original'] };
  const session = spawnSync(process.execPath, [cli, 'graph', 'session', graph, '--out', out], {
    encoding: 'utf8', input: [pulse, pulse, { op: 'quit' }].map(JSON.stringify).join('\n') + '\n'
  });
  assert.equal(session.status, 0, session.stderr);
  const [cold, warm] = session.stdout.trim().split('\n').map(JSON.parse);
  assert.equal(warm.code, 0, warm.error);
  assert.equal(warm.report.cache.misses, 0);
  assert.equal(warm.report.captured[0].sha256, cold.report.captured[0].sha256);
});
