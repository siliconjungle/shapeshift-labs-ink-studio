const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const studio = require('..');
const PNG = require('../cli/png.js');
const { KIT: K } = studio.load();

const ball = (id, at, extra = {}) => ({ kind: 'ball', ...(id && { id }), at, r: .22, mat: 'stone', res: .08, ...extra });
const ray = (x, y = 0) => ({ origin: [x, y, 5], direction: [0, 0, -1] });
function source() {
  return { id: 'editor-review', camera: { target: [0, 0, 0], dist: 6, pitch: 0, yaw: 0 },
    groups: { cluster: { blend: .02 } }, parts: { body: {}, tip: { parent: 'body' } },
    solids: [
      ball(null, [-1.4, 0, 0]),
      ball('@editor/0', [-1.4, 0, -.8], { tags: ['@editor/0'] }),
      { id: 'carved', kind: 'join', how: 'cut', group: 'cluster',
        a: { id: 'base', kind: 'box', at: [0, 0, 0], half: [.32, .24, .3], mat: 'stone' },
        b: ball(null, [0, 0, .25], { r: .14 }) },
      ball('body-shape', [1, -.15, 0], { part: 'body' }),
      ball('tip-shape', [1.8, .25, 0], { part: 'tip' })
    ] };
}

test('the scene tree resolves parts and compound operands and selects visible unnamed geometry', () => {
  const scene = source(), editor = studio.createSceneEditor(JSON.stringify(scene));
  assert.deepEqual(editor.snapshot(), scene);
  assert.equal(editor.node('part:body').children[0].key, 'part:tip');
  assert.equal(editor.node('part:tip').children[0].key, 'solid:tip-shape');
  assert.equal(editor.node('group:cluster').children[0].key, 'solid:carved');
  assert.deepEqual(editor.node('solid:carved').children.map(({ key, operand }) => [key, operand]),
    [['solid:base', 'a'], ['operand:carved/b', 'b']]);
  assert.equal(editor.node('slot:2/b'),editor.node('operand:carved/b'));
  const top = editor.selectRay(ray(-1.4));
  assert.equal(top.key, 'slot:0');
  assert.deepEqual(top.hit.target.tags, ['@editor/0_']);
  assert.equal(editor.selectRay(ray(1.8, .25), { mode: 'add' }).key, 'solid:tip-shape');
  assert.deepEqual(editor.selection(), ['slot:0', 'solid:tip-shape']);
  editor.select('solid:tip-shape', { mode: 'toggle' });
  assert.deepEqual(editor.selection(), ['slot:0']);
  assert.equal(editor.selectRay(ray(4)), null);
  assert.deepEqual(editor.selection(), []);
  assert.equal(editor.snapshot().solids[0].id, undefined);
  assert(Object.isFrozen(editor.snapshot().solids[0]));
  assert(Object.isFrozen(editor.tree().children));
  assert.throws(() => editor.select('scene:editor-review'), /keys of solids/);
  delete scene.solids[4].id;
  const unnamedPart = studio.createSceneEditor(scene).pick(ray(1.8, .25));
  assert.equal(unnamedPart.key, 'slot:4');
  assert.equal(unnamedPart.hit.target.entity, 'tip');
});

test('named parts and modifier operands have the same keys after reordering and relabeling', () => {
  const scene = source();
  const body = scene.solids.find(solid => solid.id === 'body-shape');
  body.modifiers = [
    { id:'vent', label:'Air inlet', kind:'mask', mode:'cut', shape:ball(null,[1,-.15,.18],{r:.1}) },
    { id:'shell', kind:'swell', by:.03 }
  ];
  const address = 'operand:body-shape/modifiers/vent/shape';
  assert.equal(studio.createSceneEditor(scene).node(address).solid.r,.1);
  scene.solids.reverse();
  body.modifiers.reverse();
  body.label = 'Main enclosure';
  scene.parts.body.label = 'Enclosure';
  const editor = studio.createSceneEditor(scene);
  assert.equal(editor.node('part:body').name,'Enclosure');
  assert.equal(editor.node('solid:body-shape').name,'Main enclosure');
  editor.updateShape({r:.12},address);
  editor.updateModifier('vent',{label:'Intake'},'solid:body-shape');
  assert.equal(editor.node(address).solid.r,.12);
  assert.deepEqual(editor.node('solid:body-shape').solid.modifiers.map(({id,label})=>[id,label]),
    [['shell',undefined],['vent','Intake']]);
});

test('transforms, material assignments, and ramps commit together and undo exactly', () => {
  const editor = studio.createSceneEditor(source()), original = editor.serialize();
  const events = [];
  editor.onChange(event => events.push(event));
  editor.select('slot:0');
  editor.begin('Move and recolor');
  editor.setTransform({ translation: [.35, 0, 0] });
  editor.setTransform({ translation: [.7, .4, 0], rotation: [.2, 0, 0], scale: 1.15 });
  editor.setMaterial({ role: 'accent', glow: true });
  editor.setRole('accent', [24, 25]);
  assert.equal(editor.preview().solids[0].transform.scale, 1.15);
  assert.equal(editor.pick(ray(-.7, .4)).key, 'slot:0');
  assert.equal(editor.pick(ray(-1.4)).key, 'solid:@editor/0');
  assert.equal(editor.pick(ray(-.7, .4)).hit.target.material, 'accent');
  assert.deepEqual(editor.materials().roles.accent, [24, 25]);
  assert.equal(editor.history().undo.length, 0);
  assert.equal(editor.commit(), true);
  assert.equal(editor.revision(), 1);
  assert.deepEqual(editor.history().undo, ['Move and recolor']);
  const edited = editor.serialize();
  assert(editor.undo());
  assert.equal(editor.serialize(), original);
  assert.equal(editor.pick(ray(-1.4)).key, 'slot:0');
  assert(editor.redo());
  assert.equal(editor.serialize(), edited);
  assert.deepEqual(events.map(e => e.type), ['commit', 'undo', 'redo']);
  assert.equal(events[0].snapshot.solids[0].mat.role, 'accent');

  editor.begin('Canceled edit');
  editor.setTransform({ translation: [0, 0, 2] });
  assert(editor.cancel());
  assert.equal(editor.serialize(), edited);
  editor.begin('Invalid edit');
  editor.setMaterial('wood');
  editor.setTransform({ scale: -1 });
  assert.throws(() => editor.commit(), error => error.problems.some(p => p.path === 'solids[0].transform'));
  assert.equal(editor.serialize(), edited);
  assert.throws(() => editor.setRole('accent', [1000]), /roles.accent/);
  assert.equal(editor.serialize(), edited);
  assert.deepEqual(editor.history().undo, ['Move and recolor']);
});

test('transformed recipes, boolean operands, and separate model shapes use their edited geometry', () => {
  const spec = { id: 'editor-geometry', solids: [
    { id: 'flight', kind: 'stairs', at: [0, 0, 0], dir: [1, 0, 0], rise: .5, res: .12 },
    { ...ball('ornament', [3, 0, 0]), separate: true },
    source().solids[2]
  ], groups: { cluster: { blend: .02 } } };
  const editor = studio.createSceneEditor(spec);
  editor.setTransform({ translation: [-2, .2, 1], rotation: [Math.PI / 2, 0, 0], scale: 1.4 }, ['solid:flight']);
  editor.setTransform({ translation: [.25, .5, 0], scale: 2 }, ['solid:ornament']);
  editor.setTransform({ translation: [.2, 0, 0] }, ['slot:2/b']);
  editor.setMaterial('ember', ['solid:carved']);
  const world = editor.build();
  const objectId = world.renderMetadata.objects.indexOf('flight');
  assert(objectId > 0);
  assert.deepEqual(world.made.flight.sockets.foot.p, [-2, .2, 1]);
  assert(world.made.flight.sockets.top.dir[2] < -.999);
  let count = 0, z = Infinity;
  for (let i = 0; i < world.count; i++) if (world.renderMetadata.objectIds[i] === objectId) {
    count++;
    assert(world.data[i * 16] < -.6);
    z = Math.min(z, world.data[i * 16 + 2]);
  }
  assert(count > 15 && z < .5);
  assert(world.made.carved.sd(.2, 0, .26) > .08);
  assert(world.made.carved.sd(-.12, 0, .26) < 0);
  assert(world.renderMetadata.materials.includes('ember'));
  const model = K.diorama.scene(editor.snapshot()).model(1, { resolution: .15, targetTriangles: 2400 });
  const ornament = model.meshes.flatMap(mesh => [mesh, ...(mesh.attachments ?? [])]).find(mesh => mesh.name === 'ornament');
  assert(ornament);
  const extent = Math.max(...ornament.points.map(p => p[1]));
  assert(Math.abs(extent - .94) < .015);
});

test('serialized edits load through normal CLI validation and rendering', t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-scene-editor-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const original = source(), editor = studio.createSceneEditor(original);
  editor.setTransform({ translation: [.65, .25, .4], rotation: [0, 0, .35] }, ['solid:carved']);
  editor.setMaterial('ember', ['solid:carved']);
  const before = path.join(folder, 'before.json'), after = path.join(folder, 'after.json');
  fs.writeFileSync(before, JSON.stringify(original));
  fs.writeFileSync(after, editor.serialize());
  const cli = path.resolve(__dirname, '../cli/ink-studio.js');
  assert.doesNotThrow(() => execFileSync(process.execPath, [cli, 'validate', after], { stdio: 'pipe' }));
  const read = file => {
    const png = file + '.png';
    execFileSync(process.execPath, [cli, 'render', file, '--w', '96', '--h', '64', '--px', '1', '--ortho', '--out', png], { stdio: 'pipe' });
    return PNG.read(png).rgb;
  };
  assert.notDeepEqual(read(after), read(before));
  assert.deepEqual(studio.createSceneEditor(fs.readFileSync(after, 'utf8')).snapshot(), editor.snapshot());
});
