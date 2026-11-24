const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const ink = require('..');
const { capture } = require('../cli/mesh-uv-editor.js');
const fixture = require('../examples/mesh-uv-workshop.cjs').fixture;
const kit = ink.load(), K = kit.KIT, topology = K.meshTopology, UV = topology.uv;

test('cut and align stitch retain stable polygon, edge, and corner IDs and preserve pinned UVs', () => {
  const { doc, cut, stitch, seam } = fixture(kit);
  const layout = UV.inspect(doc), moved = UV.plan(doc, cut), joined = UV.plan(moved.document, stitch);
  assert.equal(layout.islands.length, 4);
  assert.equal(moved.report.islandsAfter, 6);
  assert.equal(joined.report.islandsAfter, 5);
  assert(moved.report.canCommit && joined.report.canCommit);
  const prior = new Map(layout.corners.map(row => [row.id, row]));
  const after = UV.inspect(joined.document);
  assert.deepEqual(after.corners.filter(row => row.pinned).map(row => row.id), ['faceplate/flb', 'faceplate/frt']);
  for (const row of after.corners) if (row.face !== 'right-wing' && row.face !== 'right-wall')
    assert(K.V.dist([...row.uv, 0], [...prior.get(row.id).uv, 0]) < 1e-7);
  assert.deepEqual(joined.document.vertices, doc.vertices);
  assert.deepEqual(joined.document.faces.map(row => row.id), doc.faces.map(row => row.id));
  assert.deepEqual(joined.document.edges.map(row => row.id), doc.edges.map(row => row.id));
  const cuts = topology.select(moved.document, { domain: 'edges', filter: { seam: true } }).ids;
  assert(cuts.includes(seam('left-wing')));
  assert.equal(after.edges.find(row => row.id === seam('left-wing')).kind, 'continuous');
  assert.equal(after.edges.find(row => row.id === seam('right-wing')).kind, 'seam');
  assert.deepEqual(topology.edit(doc, moved.patch), moved.document);
});

test('pin constraints survive reload, reject an entire failed edit, and can be explicitly released', () => {
  const { doc, cut } = fixture(kit);
  const current = JSON.parse(JSON.stringify(UV.plan(doc, cut).document));
  const pick = UV.select(current, { domain: 'islands', ids: ['faceplate'] });
  const blocked = UV.plan(current, { operations: [
    { op: 'pin', ids: ['right-wing/rrb'], pinned: true },
    { op: 'transform', ids: ['faceplate'], translate: [.03, .01] }
  ] });
  assert.equal(blocked.report.canCommit, false);
  assert.deepEqual(blocked.patch, {});
  assert.deepEqual(blocked.document, current);
  assert(blocked.report.operations[1].conflicts.some(row => row.code === 'pinned-corner'));
  const unpin = UV.plan(current, { operations: [
    { op: 'pin', ids: ['faceplate/flb', 'faceplate/frt'], pinned: false },
    { op: 'transform', ids: ['faceplate'], translate: [.03, .01] }
  ] });
  assert(unpin.report.canCommit);
  assert(!UV.inspect(unpin.document).corners.some(row => row.pinned));
  assert.throws(() => UV.plan(unpin.document, { operations: [{ op: 'transform', selection: pick }] }), /mesh revision/);
});

test('weld stitches endpoint groups without moving the keeper, and conflicting pins stop the weld', () => {
  const { doc, seam } = fixture(kit);
  const edge = seam('left-wing');
  const separated = UV.plan(doc, { operations: [
    { op: 'cut', ids: [edge] },
    { op: 'transform', ids: ['left-wall'], translate: [-.02, .01] },
    { op: 'pin', ids: ['faceplate/flb'], pinned: true }
  ] }).document;
  const weld = { op: 'stitch', ids: [edge], keepFace: 'faceplate' };
  const joined = UV.plan(separated, { operations: [weld] });
  assert(joined.report.canCommit);
  assert.equal(UV.inspect(joined.document).edges.find(row => row.id === edge).kind, 'continuous');
  assert.deepEqual(joined.document.faces.find(row => row.id === 'faceplate'), separated.faces.find(row => row.id === 'faceplate'));
  const failed = UV.plan(separated, { operations: [{ op: 'pin', ids: ['left-wing/flb'], pinned: true }, weld] });
  assert(!failed.report.canCommit);
  assert.deepEqual(failed.document, separated);
  assert(failed.report.operations[1].conflicts.some(row => row.code === 'stitch-anchor-conflict'));
});

test('the visible native model hit and atlas resolve the same face, corner and seam IDs', () => {
  const { doc, view } = fixture(kit);
  const native = capture(doc, { ...view, t: 0, raw: true }, kit);
  const { faceAt, faces } = UV.modelFaces(native.mesh, native.frame), index = faces.indexOf('right-wing');
  const pixels = Array.from(faceAt, (id, i) => id === index ? i : -1).filter(i => i >= 0);
  assert(pixels.length > 5);
  const at = pixels[Math.floor(pixels.length / 2)], pixel = [at % view.w, Math.floor(at / view.w)];
  for (const domain of ['faces', 'islands', 'edges', 'corners']) {
    const model = UV.pickModel(native.mesh, native.frame, pixel, domain);
    assert.equal(model.hit.face, 'right-wing');
    const layout = UV.inspect(doc), [id] = model.ids;
    let uv = model.hit.uv;
    if (domain === 'edges') {
      const side = layout.edges.find(row => row.id === id).sides.find(row => row.face === model.hit.face);
      uv = [0, 1].map(i => (side.uv[0][i] + side.uv[1][i]) * .5);
    } else if (domain === 'corners') uv = layout.corners.find(row => row.id === id).uv;
    const atlas = UV.select(doc, { domain, atlas: { at: uv, face: model.hit.face } });
    assert.deepEqual(atlas.ids, model.ids);
  }
  assert.equal(UV.pickModel(native.mesh, native.frame, [0, 0]).hit.status, 'miss');
  const overlap = UV.plan(doc, { operations: [{ op: 'transform', ids: ['rear'], translate: [.20, -.29] }] });
  const conflict = UV.select(overlap.document, { domain: 'islands', atlas: { at: [.42, .40] } });
  assert.equal(conflict.hit.status, 'ambiguous');
  assert.deepEqual(conflict.ids, []);
});

test('scene UV pin metadata keeps existing paint valid and UV movement invalidates the affected bake with undo', () => {
  const { scene } = require('../examples/mesh-topology-transaction.cjs').fixture();
  const editor = ink.createSceneEditor(scene), row = () => editor.snapshot().topologyMeshes.relay;
  const pins = editor.editMeshUV('relay', { operations: [{ op: 'pin', ids: ['cover/cap'], pinned: true }] });
  assert.equal(pins.topology.bakes.length, 0);
  assert.equal(pins.topology.bindings.length, 0);
  const move = editor.editMeshUV('relay', { operations: [
    { op: 'pin', ids: ['cover/cap'], pinned: false },
    { op: 'transform', ids: ['cover'], scale: .75 }
  ] });
  assert.equal(move.topology.bakes[0].id, 'cover-atlas');
  assert.deepEqual(row().bakes[0].invalidated.faces, ['cover']);
  assert.equal(row().bakes[1].invalidated, undefined);
  assert(editor.undo());
  assert(!row().bakes[0].invalidated);
  assert(UV.inspect(row().document).corners.find(row => row.id === 'cover/cap').pinned);
});

test('CLI imports face-corner UVs and inspects a cut before the two sides move', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-uv-edit-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const cli = path.resolve(__dirname, '../cli/ink-studio.js');
  const run = (...args) => JSON.parse(execFileSync(process.execPath, [cli, 'mesh-uv', ...args], { encoding: 'utf8' }));
  const at = name => path.join(dir, name);
  fs.writeFileSync(at('panel.obj'), ['v 0 0 0', 'v 1 0 0', 'v 1 1 0', 'v 0 1 0',
    'vt .1 .1', 'vt .4 .1', 'vt .4 .4', 'vt .1 .4', 'f 1/1 2/2 3/3', 'f 1/1 3/3 4/4'].join('\n') + '\n');
  run('import', at('panel.obj'), '--out', at('panel.json'));
  const layout = run('layout', at('panel.json'));
  const id = layout.edges.find(row => row.kind === 'continuous').id;
  fs.writeFileSync(at('cut-request.json'), JSON.stringify({ revision: layout.revision, operations: [{ op: 'cut', ids: [id] }] }));
  const result = run('edit', at('panel.json'), at('cut-request.json'), '--out', at('cut.json'), '--preview', at('preview'));
  assert.equal(result.islandsAfter, 2);
  assert(fs.existsSync(at('preview/comparison.png')));
  const metrics = run('inspect', at('cut.json'), '--out', at('inspect'));
  assert.equal(metrics.charts, 2);
  assert.equal(metrics.uvSeams, 1);
  assert.equal(run('layout', at('cut.json')).edges.find(row => row.id === id).authored, true);
});
