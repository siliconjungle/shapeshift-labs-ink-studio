const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const topology = require('..').load().KIT.meshTopology;

const face = (id, ring, material = 'enamel') => ({
  id, material, corners: ring.map((vertex, i) => ({ id: id + '/' + vertex, vertex, uv: [[0, 0], [1, 0], [1, 1], [0, 1]][i] ?? [0, 0] }))
});
const vertex = (id, x, y, z = 0) => ({ id, position: [x, y, z] });

function board(prefix = '', z = 0, id = 'badge') {
  const vertices = [vertex(prefix + 'a', 0, 0, z), vertex(prefix + 'b', 2, 0, z),
    vertex(prefix + 'c', 2, 2, z), vertex(prefix + 'd', 0, 2, z)];
  return topology.create({ id, vertices, faces: [face(prefix + 'panel', vertices.map(v => v.id))] });
}

const group = (report, domain, side, id) => report.domains[domain].groups.find(row => row[side].includes(id));

test('ordinary edits infer a face partition, boundary edge split, and duplicated corners, then infer the reverse merge', () => {
  const before = board(), edge = before.edges.find(e => e.vertices.join('') === 'ab');
  const patch = {
    vertices: [vertex('middle', 1, 0)],
    faces: [face('panel', ['a', 'middle', 'c', 'd']), face('inset', ['middle', 'b', 'c'])]
  };
  const { document: after, correspondence: report } = topology.editWithCorrespondence(before, patch);
  assert.equal(report.format, 'ink-studio/topology-correspondence');
  assert.equal(report.version, 1);
  const panel = group(report, 'faces', 'from', 'panel');
  assert.equal(panel.status, 'split');
  assert.deepEqual(panel.to, ['inset', 'panel']);
  assert.deepEqual(panel.links.map(row => [row.confidence, row.evidence.method]), [[1, 'boundary-partition'], [1, 'stable-id']]);
  const lowerEdge = group(report, 'edges', 'from', edge.id);
  assert.equal(lowerEdge.status, 'split');
  assert.deepEqual(lowerEdge.links.map(row => row.evidence.span).sort(), [[0, .5], [.5, 1]]);
  assert.equal(group(report, 'corners', 'from', 'panel/c').status, 'split');
  assert.equal(group(report, 'corners', 'to', 'panel/middle').status, 'created');
  const reverse = topology.correspond(after, before);
  assert.equal(group(reverse, 'faces', 'to', 'panel').status, 'merged');
  assert.equal(group(reverse, 'corners', 'to', 'panel/c').status, 'merged');
  assert.equal(group(reverse, 'edges', 'to', edge.id).status, 'merged');
  assert.equal(group(reverse, 'corners', 'from', 'panel/middle').status, 'deleted');
});

test('explicit modeling lineage can cover interior topology and ordinary moves preserve exact IDs', () => {
  const before = board();
  const moved = topology.editWithCorrespondence(before, { vertices: [vertex('b', 2.2, 0)] });
  for (const map of Object.values(moved.correspondence.domains))
    assert(map.groups.every(row => row.status === 'retained' && row.links[0].confidence === 1));
  const patch = { vertices: [vertex('center', 1, 1)], removeFaces: ['panel'],
    faces: [face('a', ['a', 'b', 'center']), face('b', ['b', 'c', 'center']),
      face('c', ['c', 'd', 'center']), face('d', ['d', 'a', 'center'])],
    lineage: { faces: ['a', 'b', 'c', 'd'].map(id => ({ from: 'panel', to: id })) }
  };
  const map = topology.editWithCorrespondence(before, patch).correspondence;
  assert.deepEqual(group(map, 'faces', 'from', 'panel').to, ['a', 'b', 'c', 'd']);
  assert(group(map, 'faces', 'from', 'panel').links.every(row => row.evidence.method === 'authored'));
  assert.equal(group(map, 'corners', 'from', 'panel/a').status, 'split');
  assert.throws(() => topology.editWithCorrespondence(before, { ...patch, lineage: { faces: [{ from: 'absent', to: 'a' }] } }), /Unknown faces ID/);
});

test('retained corner IDs win over shared-vertex inference within their same face pair', () => {
  const before = board(), [old] = before.faces;
  const corners = old.corners.map(({ id, ...rest }, i) => ({ ...rest, id: old.corners[(i + 1) % old.corners.length].id }));
  const report = topology.editWithCorrespondence(before, { faces: [{ ...old, corners }] }).correspondence;
  assert(report.domains.corners.groups.every(row => row.status === 'retained'));
});

test('unstable names can match by mutual surface, segment, and corner evidence', () => {
  const before = board(), after = board('new-', .01);
  const projection = { maxDistance: .1 };
  const report = topology.correspond(before, after, { projection });
  assert.equal(report.projection.complete, true);
  const match = group(report, 'faces', 'from', 'panel');
  assert.equal(match.status, 'replaced');
  const [{ evidence, confidence }] = match.links;
  assert.equal(evidence.method, 'projected-surface');
  assert(confidence > .8 && confidence < 1);
  assert.equal(evidence.forward.samples, 6);
  assert.equal(evidence.forward.farthest.triangle.length, 3);
  assert(Math.abs(evidence.forward.farthest.barycentric.reduce((a, b) => a + b, 0) - 1) < 1e-8);
  assert(Math.abs(evidence.forward.maxDistance - .01) < 1e-7);
  assert(report.domains.edges.groups.every(row => row.links[0].evidence.method === 'projected-segment'));
  assert(report.domains.corners.groups.every(row => row.links[0].evidence.method === 'projected-corner'));
  assert.deepEqual(report, topology.correspond(JSON.parse(JSON.stringify(before)), JSON.parse(JSON.stringify(after)), { projection }));
  const other = topology.correspond(before, board('', 0, 'different-mesh'), { projection });
  assert.equal(group(other, 'faces', 'from', 'panel').status, 'replaced');
  const imported = topology.correspond(before, board('', .01), { projection, matchIds: false });
  assert.equal(imported.matchedIds, false);
  assert.equal(group(imported, 'faces', 'from', 'panel').links[0].evidence.method, 'projected-surface');
});

test('ambiguous, low-confidence, wrong-facing and budget-limited projections are distinguishable', () => {
  const before = board(), first = board('x-', .01), second = board('y-', -.01);
  const after = topology.create({ id: before.id, vertices: [...first.vertices, ...second.vertices], faces: [...first.faces, ...second.faces] });
  const report = topology.correspond(before, after, { projection: { maxDistance: .2 } });
  assert.equal(group(report, 'faces', 'from', 'panel').status, 'unresolved');
  const why = report.domains.faces.unresolved.find(row => row.side === 'from');
  assert.equal(why.reason, 'ambiguous');
  assert.deepEqual(why.candidates.map(row => row.id), ['x-panel', 'y-panel']);
  assert.equal(group(topology.correspond(before, first, { projection: { maxDistance: .011 } }), 'faces', 'from', 'panel').status, 'unresolved');
  const reversed = topology.create({ ...first, faces: first.faces.map(row => ({ ...row, corners: row.corners.slice().reverse() })) });
  assert.equal(group(topology.correspond(before, reversed, { projection: { maxDistance: .2 } }), 'faces', 'from', 'panel').status, 'deleted');
  const bounded = topology.correspond(before, after, { projection: { maxDistance: .2, maxChecks: 1 } });
  assert.equal(bounded.projection.complete, false);
  assert.equal(bounded.projection.checks, 1);
  assert.equal(group(bounded, 'faces', 'from', 'panel').status, 'unresolved');
  assert.equal(bounded.domains.edges.projectionIncomplete, true);
});

test('CLI edit receipts match independent correspondence and preserve editable JSON output', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-topology-map-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = name => path.join(dir, name + '.json');
  const run = (...args) => execFileSync(process.execPath, [path.join(__dirname, '../cli/ink-studio.js'), 'mesh-topology', ...args], { encoding: 'utf8' });
  fs.writeFileSync(file('before'), JSON.stringify(board()));
  fs.writeFileSync(file('patch'), JSON.stringify({ faces: [face('panel', ['a', 'b', 'c']), face('back', ['a', 'c', 'd'])] }));
  run('edit', file('before'), file('patch'), '--out', file('after'), '--report', file('map'));
  const saved = JSON.parse(fs.readFileSync(file('map'), 'utf8'));
  assert.equal(group(saved, 'faces', 'from', 'panel').status, 'split');
  assert.deepEqual(JSON.parse(run('correspond', file('before'), file('after'))), saved);
  assert.equal(JSON.parse(fs.readFileSync(file('after'), 'utf8')).format, 'ink-studio/mesh-topology');
});
