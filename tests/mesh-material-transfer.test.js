const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { KIT } = require('..').load();
const topology = KIT.meshTopology;
const material = { id: 'enamel', texture: { width: 2, height: 2, palette: [0x112233, 0x112233, 0x998844],
  indices: [0, 1, 2, 1], coverage: [255, 255, 255, 128] }, masks: { wear: [0, 130, 7, 15] } };
const vertex = (id, x, y, z = 0) => ({ id, position: [x, y, z] });
const face = (id, ids, uvs, material = 'enamel') => ({ id, material, corners: ids.map((vertex, i) => ({
  id: id + '/' + vertex, vertex, uv: uvs?.[i], ...(uvs && { normal: [0,0,1],
    attributes: { wear: uvs[i][0], tint: [uvs[i][0], uvs[i][1]] } })
})) });
const panel = [[.1,.8],[.9,.8],[.9,.2],[.1,.2]];
const base = [vertex('a',0,0), vertex('b',1,0), vertex('c',1,1), vertex('d',0,1)];
const read = file => JSON.parse(fs.readFileSync(file));

test('a pinned material transfer keeps equal-color palette indices, maps and corner data through a face split', () => {
  const before = topology.create({ id: 'front', vertices: base, faces: [face('panel', ['a','b','c','d'], panel)] });
  const after = topology.create({ id: 'front', vertices: [...base, vertex('e',.5,.5)],
    faces: [['a','b'], ['b','c'], ['c','d'], ['d','a']].map((edge, i) => face('sector-' + i, [...edge, 'e'], null, 'new')) });
  const lineage = { faces: after.faces.map(row => ({ from: 'panel', to: row.id })) };
  const correspondence = topology.correspond(before, after, { lineage });
  const result = topology.transferMaterials(before, after, JSON.parse(JSON.stringify(correspondence)), { materials: [material] });
  assert(result.report.complete, JSON.stringify(result.report.issues));
  assert.deepEqual(result.materials, [material]);
  assert.deepEqual(result.report.indexedSlots, ['enamel']);
  assert.deepEqual(result.report.maskSlots, [{ material: 'enamel', names: ['wear'] }]);
  for (const row of result.document.faces) {
    assert.equal(row.material, 'enamel');
    const midpoint = row.corners.find(corner => corner.vertex === 'e');
    assert.deepEqual(midpoint.uv, [.5,.5]);
    assert.deepEqual(midpoint.normal, [0,0,1]);
    assert.deepEqual(midpoint.attributes, { tint: [.5,.5], wear: .5 });
  }
  for (const row of result.report.transferred) assert.equal(row.projectedCorners, 1);
  assert.deepEqual(topology.edit(after, result.patch), result.document);
  const [[, scene]] = KIT.authoring.meshTopologyScene.prepare({ panel: { document: result.document, materials: result.materials } });
  assert(scene.mesh);
  const stale = topology.edit(after, { vertices: [vertex('e',.43,.51)] });
  assert.throws(() => topology.transferMaterials(before, stale, correspondence), /pinned to these mesh revisions/);
});

test('authored matches preserve material across a deformation without consulting neighboring sheets', () => {
  const before = topology.create({ id: 'front', vertices: base, faces: [face('panel', ['a','b','c','d'], panel)] });
  const after = topology.create({ ...before, vertices: base.map(row => ({ ...row,
    position: [row.position[0] + 10, row.position[1], row.position[2] - 2] })),
    faces: [face('panel', ['a','b','c','d'], null, 'new')] });
  const result = topology.transferMaterials(before, after, topology.correspond(before, after));
  assert(result.report.complete);
  assert.equal(result.report.projection.checks, 0);
  assert.deepEqual(result.document.faces, before.faces);
  assert.deepEqual(result.document.vertices, after.vertices);
});

test('merged UV seams stay unassigned and partial CLI output requires an explicit choice', t => {
  const vertices = [...base, vertex('e',2,0), vertex('f',2,1)];
  const before = topology.create({ id: 'front', vertices, faces: [face('left', ['a','b','c','d'], panel),
    face('right', ['b','e','f','c'], panel)] });
  const after = topology.create({ id: 'front', vertices, faces: [face('merge', ['a','e','f','d'], null, 'replacement')] });
  const map = topology.correspond(before, after, { lineage: { faces: before.faces.map(row => ({ from: row.id, to: 'merge' })) } });
  const out = topology.transferMaterials(before, after, map);
  assert(!out.report.complete);
  assert.equal(out.report.issues[0].reason, 'uv-seam');
  assert.deepEqual(out.document, after);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-mesh-transfer-'));
  t.after(() => fs.rmSync(dir,{recursive:true,force:true}));
  const save = (name, value) => {
    const file = path.join(dir, name + '.json');
    fs.writeFileSync(file, JSON.stringify(value));
    return file;
  };
  const result = path.join(dir, 'target.json'), report = path.join(dir, 'report.json'), maps = path.join(dir, 'maps.json');
  const args = [path.resolve(__dirname,'../cli/ink-studio.js'), 'mesh-topology', 'transfer-materials',
    save('before',before), save('after',after), save('match',map),
    '--materials', save('materials',[material]), '--out-materials', maps, '--out', result, '--report', report];
  const cli = (...rest) => execFileSync(process.execPath, [...args, ...rest], { stdio: 'pipe' });
  assert.throws(() => cli(), /needs review/);
  assert(!fs.existsSync(result) && !fs.existsSync(maps));
  assert.deepEqual(read(report), out.report);
  cli('--partial','on');
  assert.deepEqual(read(result), after);
  assert.deepEqual(read(maps), []);
});

test('a weak map is checked against thin and overlapping sheets before paint can cross to them', () => {
  const after = topology.create({ id: 'new', vertices: base.map(({ id, position: [x,y] }) => vertex(id,x,y,.002)),
    faces: [face('target', ['a','b','c','d'], panel)] });
  for (const opposite of [true, false]) {
    const other = base.map(({ id, position: [x,y] }) => vertex('other-' + id,x,y,.006));
    // A different material makes the second sheet ineligible for mesh correspondence.
    // The material transfer still has to see the conflicting depth.
    const before = topology.create({ id: 'old', vertices: [...base, ...other], faces: [
      face('source', ['a','b','c','d'], panel),
      face('other', (opposite ? [...other].reverse() : other).map(row => row.id), panel, 'other-enamel')
    ] });
    const correspondence = topology.correspond(before, after, { projection: { maxDistance: .1 } });
    assert(correspondence.domains.faces.groups.some(row => row.links.some(link => link.to === 'target')));
    const result = topology.transferMaterials(before, after, correspondence);
    assert.equal(result.report.issues[0]?.reason, opposite ? 'thin-surface' : 'overlapping-surfaces', JSON.stringify(result));
    assert.equal(result.report.issues[0].candidates.length, 2);
  }
});

test('a continuous chart still needs enough replacement vertices to retain its UV and mask interpolation', () => {
  const vertices = [...base, vertex('e',2,0), vertex('f',2,1)];
  const before = topology.create({ id: 'front', vertices, faces: [
    face('left', ['a','b','c','d'], [[.1,.8],[.3,.8],[.3,.2],[.1,.2]]),
    face('right', ['b','e','f','c'], [[.3,.8],[.9,.8],[.9,.2],[.3,.2]])
  ] });
  const after = topology.create({ id: 'front', vertices, faces: [face('merge', ['a','e','f','d'], null, 'replacement')] });
  const map = topology.correspond(before, after, { lineage: { faces: before.faces.map(row => ({ from: row.id, to: 'merge' })) } });
  const result = topology.transferMaterials(before, after, map);
  assert.equal(result.report.issues[0].reason, 'uv-interpolation-error');
  assert.deepEqual(result.document, after);
  const bounded = topology.transferMaterials(before, after, map, { maxChecks: 1 });
  assert.equal(bounded.report.issues[0].reason, 'projection-budget');
  assert(!bounded.report.projection.complete);
});
