const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { KIT: kit } = require('..').load();
const { resolve } = require('../cli/scene-stage.js');
const { hash } = require('../cli/asset-references.js');

const stageFormat = 'ink-studio/scene-stage';
const layerFormat = 'ink-studio/scene-stage-layer';
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-stage-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'stage.json');
  const write = (name, value) => fs.writeFileSync(path.join(root, name), JSON.stringify(value));
  const base = { id: 'marker', seed: 5, camera: { target: [0, 0, 0], dist: 5, pitch: .3, yaw: .1 },
    solids: [{ id: 'marker', kind: 'box', at: [0,0,0], half: [1,.2,.5], mat: 'stone', res: .12 }] };
  return { file, root, base, write, stage: value => write('stage.json', { format: stageFormat, version: 1,
    id: 'test', base, layers: [], ...value }) };
}
const set = (path, value) => ({ op: 'set', path, value });

test('scene stages apply ordered native edits and trace parent changes and array splices', t => {
  const { file, base, stage } = fixture(t);
  stage({ base: { ...base, finish: { test: [{ hue: null }, { hue: 'ochre' }] } }, layers: [
    { id: 'base-material', kind: 'material', edits: [
      { op: 'merge', path: '/finish/test/0', value: { hue: 'ink', order: 1 } },
      { op: 'test', path: ['finish','test',0,'hue'], value: 'ink' }
    ] },
    { id: 'remove-patch', kind: 'asset', edits: [{ op: 'remove', path: '/finish/test/0' }] },
    { id: 'shot-override', kind: 'shot', edits: [set('/finish/test/0/hue', 'ochre')] }
  ] });
  const traced = resolve(file, kit, { at: '/finish/test/0/hue' });
  assert.deepEqual(traced.scene, resolve(file, kit).scene);
  assert.deepEqual(traced.report.query, {
    path: '/finish/test/0/hue', base: { exists: true, value: null }, resolved: { exists: true, value: 'ochre' },
    source: { layer: 'remove-patch', index: 1, path: '/finish/test/0', op: 'remove' },
    history: [
      { layer: 'base-material', index: 1, path: '/finish/test/0', op: 'merge',
        before: { exists: true, value: null }, after: { exists: true, value: 'ink' } },
      { layer: 'remove-patch', index: 1, path: '/finish/test/0', op: 'remove',
        before: { exists: true, value: 'ink' }, after: { exists: true, value: 'ochre' } }
    ]
  });
  const removal = resolve(file, kit, { at: '/finish/test/1' }).report.query;
  assert.deepEqual(removal.resolved, { exists: false });
  assert.equal(removal.source.layer, 'remove-patch');
  assert.equal(resolve(file, kit, { at: '/missing' }).report.query.source, null);
});

test('stage defaults, selections and overrides gate payloads before file reads and enforce pins', t => {
  const { file, root, write, stage } = fixture(t);
  const payload = { format: layerFormat, version: 1, edits: [set('/name', 'Retained buoy')] };
  const layer = { id: 'buoy', kind: 'asset', file: 'buoy.json', sha256: hash(Buffer.from(JSON.stringify(payload))),
    when: { time: 'night' }, payload: { default: false } };
  const chosen = { 'stage-selection': 'lit' };
  stage({ variants: { time: { default: 'night', choices: ['day','night'] } },
    selections: { lit: { payloads: { buoy: true }, variants: { time: 'night' } } },
    layers: [layer] });
  const opened = [];
  const skipped = resolve(file, kit, { onFile: f => opened.push(path.basename(f)) }).report;
  assert.deepEqual(opened, ['stage.json']);
  assert.equal(skipped.layers[0].status, 'payload-unloaded');
  assert.deepEqual(skipped.payloads.buoy, { value: false, from: 'default' });
  assert.throws(() => resolve(file, kit, { options: chosen }), /Missing stage input buoy\.json/);
  const gated = resolve(file, kit, { options: { ...chosen, 'stage-variants': 'time=day' } }).report;
  assert.equal(gated.layers[0].status, 'variant-mismatch');
  assert.deepEqual(gated.variants.time, { value: 'day', from: 'override' });
  assert.deepEqual(gated.payloads.buoy, { value: true, from: 'selection' });
  write('buoy.json', payload);
  const applied = resolve(file, kit, { options: chosen, onFile: f => opened.push(path.basename(f)) });
  assert.equal(applied.scene.name, 'Retained buoy');
  assert.equal(applied.report.layers[0].source.sha256, layer.sha256);
  assert.deepEqual(opened, ['stage.json','stage.json','buoy.json']);
  fs.appendFileSync(path.join(root, 'buoy.json'), '\n');
  assert.throws(() => resolve(file, kit, { options: chosen }), /SHA-256 mismatch/);
  const disabled = resolve(file, kit, { options: { ...chosen, 'stage-payloads': 'buoy=off' } }).report;
  assert.equal(disabled.layers[0].status, 'payload-unloaded');
  assert.deepEqual(disabled.payloads.buoy, { value: false, from: 'override' });
  assert.throws(() => resolve(file, kit, { options: { 'stage-variants': 'time=day,time=night' } }), /repeated pair/);
  assert.throws(() => resolve(file, kit, { options: { 'stage-payloads': 'unknown=on' } }), /unknown choice/);
});

test('the stage CLI protects source files and renders the same selection directly or as a project', t => {
  const { file, root, base, write, stage } = fixture(t);
  write('base.json', base);
  stage({ base: 'base.json', variants: { framing: { default: 'wide', choices: ['wide','tight'] } },
    selections: { tight: { variants: { framing: 'tight' } } },
    layers: [{ id: 'tight', kind: 'shot', when: { framing: 'tight' }, edits: [set('/camera/dist', 3.5)] }]
  });
  const run = (...args) => execFileSync(process.execPath, [path.resolve(__dirname, '../cli/ink-studio.js'), ...args],
    { stdio: 'pipe', cwd: root });
  const opts = ['--stage-selection', 'tight'];
  const bundle = path.join(root, 'moved', 'bundle.json');
  assert.throws(() => run('scene-stage', 'resolve', file, '--out', 'base.json'), /separate from stage inputs/);
  run('scene-stage', 'resolve', file, ...opts, '--out', bundle);
  const explanation = JSON.parse(run('scene-stage', 'explain', file, ...opts, '--at', '/camera/dist'));
  assert.deepEqual(explanation.query.resolved, { exists: true, value: 3.5 });
  const view = ['--w', '48', '--h', '32', '--px', '1', '--raw'];
  run('render', file, ...view, ...opts, '--out', 'stage.png', '--recipe', 'stage-shot.json');
  const shot = JSON.parse(fs.readFileSync(path.join(root, 'stage-shot.json'), 'utf8'));
  assert.deepEqual(shot.inputs.map(source => source.file), ['stage.json','base.json']);
  run('shot', 'replay', 'stage-shot.json', '--out', 'replayed.png');
  fs.unlinkSync(file);
  fs.unlinkSync(path.join(root, 'base.json'));
  run('render', bundle, ...view, '--out', 'bundle.png');
  const png = name => fs.readFileSync(path.join(root, name));
  assert.deepEqual(png('stage.png'), png('bundle.png'));
  assert.deepEqual(png('stage.png'), png('replayed.png'));
});
