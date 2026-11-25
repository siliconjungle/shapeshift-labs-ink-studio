const assert = require('node:assert/strict');
const { test } = require('node:test');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const Ink = require('..');
const PNG = require('../cli/png.js');

const op = (op, inputs) => ({ op, inputs });
const link = (node, port = 'value') => ({ node, port });
const input = name => ({ input: name });
const parent = { id: 'paint-catalog', settings: {
  size: { width: 24, height: 8 }, output: { format: 'png', bitDepth: 16 },
  pixelSizeMm: .5, pixelRatio: [3, 2], tiling: { u: 'mirror', v: 'clamp' }, seed: 39
} };
const inheritance = {
  size: { mode: 'primary', scale: [.5, .5] },
  output: { mode: 'parent' },
  pixelSizeMm: { mode: 'primary', scale: 2 },
  pixelRatio: { mode: 'primary' },
  tiling: { mode: 'absolute' },
  seed: { mode: 'parent', offset: 3 }
};

function image(width, height, descriptor = {}) {
  const images = Ink.load().KIT.procedural.graphImages;
  const rgba = Array.from({ length: width * height * 4 }, (_, i) => [43, 121, 156, 255][i % 4]);
  const typed = images.declare({ width, height, channels: 4, data: rgba },
    { intent: 'color', precision: 'unorm8', pixelPitchMm: [.125, .25], materialSeed: 11, ...descriptor });
  return { ...typed, raster: { ...typed.raster, data: Array.from(typed.raster.data) } };
}

function fixture() {
  return {
    format: 'ink-studio/graph-project', version: 1,
    base: { size: { width: 7, height: 3 }, tiling: { u: 'wrap', v: 'mirror' } }, seed: 19,
    inheritance, primaryInput: 'artwork', inputs: { artwork: 'colorImage' },
    nodes: {
      metrics: op('material.base', { settings: input('materialBase') }),
      fit: op('material.imageOutput', { source: input('artwork'), settings: input('materialBase') }),
      noise: { op: 'random' }
    },
    outputs: { image: link('fit'), width: link('metrics', 'width'), seed: link('metrics', 'seed'), noise: link('noise') },
    exports: { image: { output: 'image', format: 'material-image' } }
  };
}

test('each setting independently accepts all three providers and resolves against the effective combination', () => {
  const resolve = Ink.resolveMaterialInheritance;
  const authored = { ...parent.settings, seed: 17 };
  for (const mode of ['absolute', 'parent', 'primary']) {
    const policies = Object.fromEntries(Object.keys(authored).map(key => [key, { mode }]));
    const selected = mode === 'absolute' ? authored : parent.settings;
    const { base, provenance } = resolve(authored, policies, { parent, primary: { ...parent, id: 'upstream' } });
    assert.deepEqual(base, Ink.resolveMaterialBaseSettings(selected));
    for (const key of Object.keys(base)) {
      assert.deepEqual(provenance[key].value, base[key]);
      assert.equal(provenance[key].mode, mode);
      assert.equal(provenance[key].source.kind, mode === 'absolute' ? 'authored' : mode);
      if (mode !== 'absolute') assert.equal(provenance[key].source.id, mode === 'parent' ? parent.id : 'upstream');
    }
  }

  const { base } = resolve({}, {
    size: { mode: 'parent', scale: [.2, .5], lock: false },
    pixelRatio: { mode: 'parent', scale: [4, 3] },
    seed: { mode: 'parent', offset: -4 }
  }, { parent: { ...parent, settings: { ...parent.settings, size: { width: 12, height: 4, lock: true } } } });
  assert.deepEqual(base.size, { width: 2, height: 6, lock: false });
  assert.deepEqual(base.pixelRatio, [2, 1]);
  assert.equal(base.seed, 35);
  assert.equal(resolve({}, {}, {}, { seed: 19 }).provenance.seed.source.kind, 'graph-seed');
  assert.equal(resolve().provenance.seed.source.kind, 'default');
  assert.throws(() => resolve({}, { seed: { mode: 'primary' } }), /seed needs a value from the primary/);
  assert.throws(() => resolve({}, { size: { mode: 'parent', scale: [.5, 0] } }, { parent }), /size adjustment/);
  assert.throws(() => resolve({}, { output: { mode: 'parent', scale: 2 } }, { parent }), /output inheritance/);
  assert.throws(() => resolve({}, { size: { mode: 'parent', scale: [1000, 1] } }, { parent }), /raster budget/);
});

test('the same editable graph uses actual runtime images and parent context for generators, snapshots and delivery', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-inheritance-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'enamel.material.json');
  const editable = Ink.openMaterialGraph(fixture(), { id: 'enamel' });
  Ink.writeMaterialGraph(file, editable);
  assert.deepEqual(Ink.readMaterialGraph(file).settings.inheritance, inheritance);
  assert.equal(Ink.readMaterialGraph(file).settings.primaryInput, 'artwork');
  const project = Ink.readGraphProject(file, { baseContext: { parent } });
  const first = { artwork: image(12, 8) }, second = { artwork: image(24, 16) };
  assert.throws(() => project.run(), /primary graph input artwork/);
  assert.throws(() => project.run({ inputs: { artwork: image(12, 8, { pixelPitchMm: undefined }) } }),
    /pixelSizeMm needs a value from primary artwork/);
  assert.throws(() => Ink.createGraphProject(fixture(), { baseContext: { primary: parent } }), /Choose a primary/);
  assert.throws(() => Ink.createGraphProject({ ...fixture(), primaryInput: 'missing' }), /declared typed image/);
  assert.throws(() => Ink.createGraphProject({ ...fixture(), inputs: { artwork: 'record' } }), /declared typed image/);

  for (const [inputs, dimensions] of [[first, [6, 4]], [second, [12, 8]], [first, [6, 4]]]) {
    const { report, outputs, artifacts } = project.run({ inputs });
    const { base, baseProvenance } = report;
    assert.deepEqual([base.size.width, base.size.height], dimensions);
    assert.deepEqual(outputs.image.descriptor.pixelPitchMm, [.25, .5]);
    assert.equal(outputs.image.descriptor.materialSeed, 42);
    assert.equal(outputs.width, dimensions[0]);
    assert.equal(report.seed, 42);
    assert.equal(outputs.seed, 42);
    assert.deepEqual(baseProvenance.size.source, { kind: 'primary', id: 'artwork' });
    assert.deepEqual(baseProvenance.output.source, { kind: 'parent', id: 'paint-catalog' });
    assert.deepEqual(baseProvenance.tiling.source, { kind: 'authored' });
    assert.deepEqual(project.snapshot({ inputs }).settings.baseProvenance, baseProvenance);
    assert.deepEqual(project.plan(inputs).baseProvenance, baseProvenance);
    assert.deepEqual(project.plan(inputs).inputs.materialBase.default, base);
    const png = PNG.raster(artifacts[0].bytes);
    assert.deepEqual([png.w, png.h], dimensions);
    assert.equal(artifacts[0].bytes[24], 16);
  }
  const overridden = project.run({ inputs: first, seed: 99 });
  assert.equal(overridden.outputs.seed, 99);
  assert.equal(overridden.report.baseProvenance.seed.source.kind, 'run-override');
  assert.notEqual(overridden.outputs.noise, project.run({ inputs: first }).outputs.noise);
  const alternateParent = { ...parent, settings: { ...parent.settings, output: { format: 'json' } } };
  const alternate = Ink.readGraphProject(file, { baseContext: { parent: alternateParent } });
  assert.notEqual(project.artifactIdentity().fingerprint, alternate.artifactIdentity().fingerprint);
  assert.equal(alternate.run({ inputs: second }).artifacts[0].format, 'json');
});

test('CLI plans and renders a named primary from an input file and resolves a default image', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-inheritance-cli-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'material.json'), context = path.join(directory, 'context.json');
  const inputs = path.join(directory, 'inputs.json'), cli = path.resolve(__dirname, '../cli/ink-studio.js');
  const graph = fixture();
  graph.inputs.artwork = { type: 'colorImage', default: image(16, 10) };
  Ink.writeMaterialGraph(file, Ink.openMaterialGraph(graph));
  fs.writeFileSync(context, JSON.stringify({ parent }));
  fs.writeFileSync(inputs, JSON.stringify({ artwork: image(22, 14) }));
  function command(mode, ...args) {
    return JSON.parse(execFileSync(process.execPath, [cli, 'graph', mode, file, '--base-context', context, ...args],
      { encoding: 'utf8', cwd: directory }));
  }
  assert.deepEqual(command('plan').base.size, { width: 8, height: 5, lock: false });
  const planned = command('plan', '--memory', '--inputs', inputs);
  const rendered = command('run', '--inputs', inputs);
  assert.deepEqual(rendered.base.size, { width: 11, height: 7, lock: false });
  assert.deepEqual(rendered.baseProvenance, planned.baseProvenance);
  assert.equal(rendered.artifacts[0].format, 'png');
});

test('a branch can inherit dimensions and seed from a linked typed image without changing root settings', () => {
  const project = Ink.createGraphProject({
    format: 'ink-studio/graph-project', version: 1,
    base: { size: { width: 15, height: 5 }, seed: 66 },
    nodes: {
      texture: op('image.resize', { source: image(4, 2), width: 8, height: 4 }),
      branch: op('material.inherit', { primary: link('texture'), primaryId: 'texture',
        rules: { size: { mode: 'primary' }, output: { mode: 'primary' }, seed: { mode: 'primary', offset: 4 } } }),
      fitted: op('material.imageOutput', { source: link('texture'), settings: link('branch') })
    },
    outputs: { fitted: link('fitted'), provenance: link('branch', 'provenance') }
  });
  const { report, outputs } = project.run();
  assert.equal(report.base.size.width, 15);
  assert.equal(report.seed, 66);
  assert.equal(outputs.fitted.raster.width, 8);
  assert.equal(outputs.fitted.descriptor.materialSeed, 15);
  assert.equal(outputs.provenance.size.source.id, 'texture');
  assert.deepEqual(outputs.provenance.output.value, { format: 'png', bitDepth: 8 });
});
