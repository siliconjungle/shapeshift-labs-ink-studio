'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { test } = require('node:test');
const ink = require('..');
const { KIT: K } = ink.load();
const cli = path.resolve(__dirname, '../cli/ink-studio.js');

const recipe = {
  format: 'ink-studio/sculpt-stamp', version: 1,
  add: {
    collar: { kind: 'lathe', at: [0, .15, 0], h: .4, r: .58, mat: 'stone', res: .08 },
    lip: { kind: 'lathe', at: [0, .54, 0], h: .22, r: .52, mat: 'metal', res: .08,
      transform: { scale: 1.05, pivot: [0, .54, 0] } }
  },
  cut: {
    bore: { shape: { kind: 'lathe', at: [0, -.65, 0], h: 1.8, r: .31 } },
    notch: { shape: { kind: 'ball', at: [.52, .39, 0], r: .15 },
      targets: ['collar'], host: false }
  }
};

test('a stamp edits a transformed host and its positive pieces in one undoable revision', () => {
  const host = { id: 'plate', kind: 'box', at: [.3, 0, .2], half: [1.65, .19, .85], mat: 'stone',
    res: .08, transform: { translation: [2, .6, -.7], rotation: [.37, .25, .2], scale: 1.2 },
    part: 'mount' };
  const local = { translation: [-.43, 0, .25], rotation: [.3, -.13, .06], scale: .9 };
  // Independent reference: each authored transform is applied in isolation to a probe.
  const origin = point => {
    function moved(p, raw, pivot) {
      const axes = [[0, 1, 0], [1, 0, 0], [0, 0, 1]];
      const basis = raw.rotation.reduce((out, angle, i) => K.M.mul(out, K.M.rot(axes[i], angle)), K.M.id());
      return K.V.mad(K.V.add(pivot, raw.translation), K.M.app(basis, K.V.sub(p, pivot)), raw.scale);
    }
    return moved(moved(point, local, [0, 0, 0]), host.transform, host.at);
  };
  const neighboring = { id: 'unrelated', kind: 'ball', at: origin([0, -.36, 0]), r: .09, mat: 'stone' };
  const scene = { id: 'stamp-test', parts: { mount: {} }, solids: [host, neighboring] };
  const editor = ink.createSceneEditor(scene);
  const placement = { id: 'intake', target: 'plate', transform: local };
  const pieces = editor.placeSculptStamp(recipe, placement);
  assert.deepEqual(pieces, ['intake.collar', 'intake.lip']);
  const stamped = editor.snapshot();
  assert.equal(stamped.solids[0].modifiers[0].id, 'intake.bore');
  assert.deepEqual(stamped.solids[1], neighboring);
  assert.deepEqual(stamped.solids.slice(2).map(solid => solid.part), ['mount', 'mount']);
  assert.deepEqual(stamped.solids[2].modifiers.map(row => row.id), ['intake.bore', 'intake.notch']);
  assert.deepEqual(stamped.solids[3].modifiers.map(row => row.id), ['intake.bore']);

  const before = K.diorama.brushField(scene), after = K.diorama.brushField(stamped);
  assert(before.sdf(...origin([0, 0, 0])) < 0, 'uncut plate');
  assert(after.sdf(...origin([0, 0, 0])) > 0, 'through-hole in plate');
  assert(after.sdf(...origin([0, .66, 0])) > 0, 'through-hole in lip');
  assert(after.sdf(...origin([0, -.36, 0])) < 0, 'no cut on unrelated overlapping solid');
  assert(after.sdf(...origin([.52, .39, 0])) > 0, 'notch in collar');
  const lip = after.renderSurface(...origin([.42, .64, 0])).owner;
  assert.equal(lip.renderTarget.entity, 'intake.lip');
  assert.equal(lip.mat.materialId, 'metal');
  assert.deepEqual(ink.createSceneEditor(editor.serialize()).snapshot(), stamped);

  assert.throws(() => editor.placeSculptStamp(recipe, placement), /already in use/);
  assert.throws(() => editor.placeSculptStamp({ ...recipe, cut: {
    bore: { ...recipe.cut.bore, targets: ['missing'] }
  } }, { ...placement, id: 'other' }), /distinct named add pieces/);
  assert.equal(editor.snapshot(), stamped);
  editor.undo();
  assert.deepEqual(editor.snapshot(), scene);
  editor.redo();
  assert.deepEqual(editor.snapshot(), stamped);
});

test('CLI saves, reloads and renders an independently placed stamp and refuses invalid edits', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-stamp-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const get = file => fs.readFileSync(path.join(dir, file), 'utf8');
  const put = (file, value) => fs.writeFileSync(path.join(dir, file), JSON.stringify(value));
  const run = (...args) => execFileSync(process.execPath, [cli, ...args], { cwd: dir, stdio: 'pipe', encoding: 'utf8' });
  const place = out => run('sculpt-stamp', 'place', 'base.json', 'stamp.json', 'placement.json', '--out', out);
  const scene = { id: 'stamp-cli', solids: [{ id: 'plate', kind: 'box',
    at: [0, 0, 0], half: [1.7, .19, .85], mat: 'stone', res: .08 }] };
  put('base.json', scene);
  put('stamp.json', recipe);
  put('placement.json', { id: 'left', target: 'plate', transform: { translation: [-.8, 0, 0] } });
  place('first.json');
  put('placement.json', { id: 'right', transform: { translation: [2.7, 0, 0] } });
  run('sculpt-stamp', 'place', 'first.json', 'stamp.json', 'placement.json', '--out', 'both.json');
  const both = JSON.parse(get('both.json')), field = K.diorama.brushField(both);
  assert(field.sdf(-.8, 0, 0) > 0);
  assert(field.sdf(.8, 0, 0) < 0);
  assert(field.sdf(2.7, .62, 0) > 0 && field.sdf(3.12, .62, 0) < 0);
  run('render', 'both.json', '--ortho', '--w', '96', '--h', '80', '--out', 'both.png');
  assert(fs.statSync(path.join(dir, 'both.png')).size > 300);

  put('placement.json', { id: 'bad', target: 'missing' });
  const prior = get('both.json');
  assert.throws(() => place('both.json'), /named editable exterior sculpt solid/);
  assert.equal(get('both.json'), prior);
  assert.deepEqual(JSON.parse(get('base.json')), scene);
});
