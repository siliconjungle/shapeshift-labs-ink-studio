'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { test } = require('node:test');
const ink = require('..');
const { KIT } = ink.load();
const cli = path.resolve(__dirname, '../cli/ink-studio.js');

function scene() {
  return { id: 'stroke-test', solids: [{
    id: 'plate', kind: 'box', at: [0, 0, 0], half: [2, .24, 1.1], mat: 'stone', res: .08,
    modifiers: [
      { id: 'bead', kind: 'join', how: 'union', shape: { id: 'bead-shape', kind: 'sweep', mat: 'metal',
        brush: { kind: 'sphere', radius: .36 }, poses: [{ point: [-.75, .42, 0] }, { point: [.75, .42, 0] }] } },
      { id: 'slot', kind: 'mask', mode: 'cut', shape: { kind: 'box', at: [0, .36, 0], half: [.17, .4, .29] } },
      { id: 'mount', kind: 'mask', mode: 'cut', shape: { kind: 'ball', at: [1.7, .2, -.7], r: .19 } }
    ],
    sdfPaint: { version: 1, strokes: [{
      id: 'badge', grid: [4, 4], material: 'moss',
      projection: { origin: [0, 3, 0], right: [1, 0, 0], down: [0, 0, 1], forward: [0, -1, 0], perspective: false },
      cells: [[1, 2, [-.65, .78, 0], [0, 1, 0], .08]]
    }] }
  }] };
}

test('reports a dependent cut and painted region with rest-space witnesses, and edits one entry per undo', () => {
  const base = scene(), editor = ink.createSceneEditor(base);
  const delta = [0, 0, .74];
  const report = editor.editSculptContribution({ solid: 'plate', contribution: 'bead', op: 'move', delta });
  assert.equal(report.space, 'solid-rest');
  assert.equal(report.cuts.find(row => row.id === 'slot')?.status, 'observed-change');
  assert(report.cuts.find(row => row.id === 'slot').removedBeforeOnly > 0);
  assert.equal(report.cuts.find(row => row.id === 'mount')?.status, 'stack-dependency');
  assert(report.materials.regions.some(row => row.kind === 'paint' && row.id === 'badge' && row.beforeOnly > 0));
  assert.deepEqual(editor.node('solid:bead-shape').solid.transform.translation, delta);
  assert.deepEqual(editor.snapshot().solids[0].modifiers.slice(1), base.solids[0].modifiers.slice(1));
  assert.deepEqual(editor.snapshot().solids[0].sdfPaint, base.solids[0].sdfPaint);
  const after = editor.snapshot();
  assert(KIT.diorama.brushField(after).sdf(0, .5, .74) < 0);
  editor.undo();
  assert.deepEqual(editor.snapshot(), base);
  editor.redo();
  assert.deepEqual(editor.snapshot(), after);
});

test('stretches, clones, replaces, mutes and reorders existing contributions by ID', () => {
  const editor = ink.createSceneEditor(scene());
  const edit = (op, fields) => editor.editSculptContribution({ solid: 'plate', contribution: 'bead', op, ...fields });
  const sample = (...point) => KIT.diorama.brushField(editor.snapshot()).sdf(...point);
  assert(sample(1.32, .43, .05) > 0);
  edit('stretch', { factors: [1.6, 1, 1], pivot: [0, .42, 0] });
  assert(sample(1.32, .43, .05) < 0);
  assert.equal(editor.node('solid:bead-shape').solid.poses.length, 2);
  assert.equal(edit('clone', { id: 'copy' }).contribution, 'copy');
  assert(editor.node('solid:copy/bead-shape'));
  assert.deepEqual(editor.sculptContributions('plate').map(row => row.id), ['bead', 'copy', 'slot', 'mount']);
  editor.undo();
  edit('replace', { replacement: { kind: 'join', how: 'union', shape: { kind: 'ball', at: [.65, .48, 0], r: .33 } } });
  assert.equal(editor.sculptContributions('plate')[0].shape, 'ball');
  assert(sample(.65, .55, 0) < 0);
  edit('mute');
  assert(sample(.65, .55, 0) > 0);
  edit('mute', { muted: false });
  assert(sample(.65, .55, 0) < 0);
  const snapshot = editor.snapshot();
  assert.throws(() => edit('reorder', { index: 99 }), /zero-based/);
  assert.throws(() => edit('stretch', { factors: [1, 0, 2] }), /three factors/);
  assert.throws(() => edit('replace', { replacement: { kind: 'mask', mode: 'cut', shape: { kind: 'box' } } }), /missing/);
  assert.equal(editor.snapshot(), snapshot);

  const original = ink.createSceneEditor(scene());
  const reordered = original.editSculptContribution({ solid: 'plate', contribution: 'bead', op: 'reorder', index: 1 });
  assert(reordered.cuts.find(row => row.id === 'slot').removedBeforeOnly > 0);
  assert.deepEqual(original.sculptContributions('plate').map(row => row.id), ['slot', 'bead', 'mount']);
  assert(KIT.diorama.brushField(original.snapshot()).sdf(0, .5, 0) < 0);
});

test('the CLI lists and inspects without writes and publishes a reloadable edit and JSON report', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-stroke-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const put = (file, value) => fs.writeFileSync(path.join(dir, file), JSON.stringify(value));
  const get = file => JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
  const run = (...args) => execFileSync(process.execPath, [cli, ...args], { cwd: dir, encoding: 'utf8', stdio: 'pipe' });
  put('base.json', scene());
  const list = JSON.parse(run('sculpt-contribution', 'list', 'base.json', '--solid', 'plate'));
  assert.equal(list.contributions[0].id, 'bead');
  const inspect = JSON.parse(run('sculpt-contribution', 'inspect', 'base.json', '--solid', 'plate', '--id', 'bead'));
  assert.equal(inspect.comparison, 'muted');
  assert.equal(inspect.cuts[0].status, 'observed-change');
  const request = { solid: 'plate', contribution: 'bead', op: 'move', delta: [0, 0, .74] };
  put('edit.json', request);
  const edited = JSON.parse(run('sculpt-contribution', 'edit', 'base.json', 'edit.json', '--out', 'edited.json'));
  assert.equal(edited.cuts[0].status, 'observed-change');
  run('render', 'edited.json', '--ortho', '--w', '128', '--h', '96', '--out', 'proof.png');
  assert(fs.statSync(path.join(dir, 'proof.png')).size > 400);
  assert.deepEqual(get('base.json'), scene());
  const published = get('edited.json');
  put('edit.json', { ...request, contribution: 'missing' });
  assert.throws(() => run('sculpt-contribution', 'edit', 'base.json', 'edit.json', '--out', 'edited.json'), /Unknown sculpt contribution/);
  assert.deepEqual(get('edited.json'), published);
});

test('moves and stretches a retained native-pixel stencil without changing its grid', () => {
  const source = scene();
  const owner = source.solids[0];
  delete owner.sdfPaint;
  const projection = {
    origin: [0, 2, 0], right: [.4, 0, 0], down: [0, 0, .4], forward: [0, -1, 0], perspective: false
  };
  owner.modifiers = [{ id: 'pixel-slot', kind: 'grid-brush', mode: 'cut',
    brush: { version: 1, grid: [1, 1], projection, cells: [[0, 0, 1.68, 2.12]] } }];
  const editor = ink.createSceneEditor(source);
  const edit = (op, fields) => editor.editSculptContribution({ solid: 'plate', contribution: 'pixel-slot', op, ...fields });
  const field = () => KIT.diorama.brushField(editor.snapshot());
  assert(field().sdf(0, .12, 0) > 0);
  edit('move', { delta: [.75, 0, 0] });
  assert(field().sdf(0, .12, 0) < 0);
  assert(field().sdf(.75, .12, 0) > 0);
  edit('stretch', { factors: [2, 1, 1], pivot: [.75, 0, 0] });
  assert(field().sdf(.43, .12, 0) > 0);
  assert.deepEqual(editor.snapshot().solids[0].modifiers[0].brush.cells, [[0, 0, 1.68, 2.12]]);
});
