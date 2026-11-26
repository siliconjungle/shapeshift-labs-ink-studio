const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');

const cli = path.resolve(__dirname, '../cli/ink-studio.js');
const ref = (node, port = 'value') => ({ node, port });
const op = (name, inputs) => ({ op: name, inputs });

test('geometry sessions capture typed stages and explain selective reevaluation', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-geometry-session-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const graph = path.join(root, 'graph.json');
  const radius = { input: 'radius' };
  const mesh = { points: [[0,0,0],[1,0,0],[0,1,0]], faces: [[0,1,2]],
    uvs: [0,0,1,0,0,1], normals: [0,0,1,0,0,1,0,0,1] };
  fs.writeFileSync(graph, JSON.stringify({
    format: 'ink-studio/graph-project', version: 1,
    inputs: { radius: { type: 'number', default: .5 } },
    groups: { Shaping: {
      inputs: { radius: { type: 'number' } },
      nodes: {
        ball: op('sdf.primitive', { kind: 'sphere', radius }),
        pigment: op('sdf.attributes', { source: ref('ball'), objectId: 'orb', materialId: 'enamel' }),
        surface: op('sdf.mesh', { source: ref('pigment'), options: { resolution: .19 } })
      }, outputs: { value: ref('surface') }
    } },
    nodes: {
      shape: op('Shaping', { radius }),
      base: op('geo.mesh', { source: mesh }),
      stand: op('geo.box', { options: { center: [4,0,0], half: [1,1,1] }, half: [.5,1,1] }),
      move: op('geo.transform', { source: ref('shape'), position: [1,0,0] }),
      bounds: op('geo.measure', { source: ref('move') }),
      table: op('attributeTable', { domain: 'vertex', entities: [{ id: 'origin', point: [0,0,0] }],
        channels: { patina: { type: 'number', values: [.7] } } })
    }, outputs: { geometry: ref('move'), size: ref('bounds', 'size') }
  }));
  const capture = ['base', 'shape/pigment', 'move', 'bounds:size', 'table'], out = path.join(root, 'session');
  const request = (id, inputs) => ({ id, op: 'geometry', inputs, capture });
  const child = spawnSync(process.execPath, [cli, 'graph', 'session', graph, '--out', out, '--protocol', 'ndjson'], {
    encoding: 'utf8', input: [request('first', {}), request('edit', { radius: .8 }), request('repeat', { radius: .8 }),
      { op: 'quit' }].map(row => JSON.stringify(row) + '\n').join('')
  });
  assert.equal(child.status, 0, child.stderr);
  const [first, edit, repeat] = child.stdout.trim().split('\n').map(line => JSON.parse(line));
  for (const row of [first, edit, repeat]) assert.equal(row.code, 0, row.error);
  const stages = reply => Object.fromEntries(reply.report.nodes.map(stage => [stage.node, stage]));
  const before = stages(first), after = stages(edit);
  assert(before['shape/surface'].work.some(row => row.kind === 'remesh' && row.counts.triangles > 0));
  assert.deepEqual(before.base.outputs.value.geometry.attributes.map(row => row.name), ['position', 'normal', 'uv', 'material']);
  assert.deepEqual(before.stand.outputs.value.geometry.bounds, { min: [3.5,-1,-1], max: [4.5,1,1] });
  assert.equal(before.table.outputs.value.geometry.attributes[0].name, 'patina');
  assert.equal(before.bounds.outputs.size.type, 'vec3');
  assert.deepEqual(Object.keys(edit.report.cache.nodes).filter(node => edit.report.cache.nodes[node] === 'evaluated'),
    ['shape','shape/ball','shape/pigment','shape/surface','move','bounds']);
  assert.deepEqual(after.shape.invalidated, [{ kind: 'input', socket: 'radius', input: 'radius' }]);
  assert.deepEqual(after['shape/surface'].invalidated, [{ kind: 'node', socket: 'source', node: 'shape/pigment', port: 'value' }]);
  assert(after['shape/surface'].computeMs > 0);
  assert.deepEqual(after.base.invalidated, []);
  assert.equal(after.base.computeMs, 0);
  assert(after.move.outputs.value.geometry.bounds.max[0] > before.move.outputs.value.geometry.bounds.max[0]);
  assert(repeat.report.nodes.every(row => row.status === 'cached' && row.computeMs === 0 && !row.invalidated.length));
  function artifact(reply, index) {
    const row = reply.report.captured[index], bytes = fs.readFileSync(path.join(out, reply.folder, row.file));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), row.sha256);
    return JSON.parse(bytes);
  }
  assert.deepEqual(artifact(first, 0), artifact(edit, 0));
  assert.equal(first.report.captured[1].summaryOnly, true);
  assert.deepEqual(artifact(first, 1).attributes, { tagged: true, objectIds: ['orb'], materialIds: ['enamel'] });
  assert(Array.isArray(artifact(edit, 2).tri));
  assert.equal(artifact(edit, 3).length, 3);
  assert.equal(artifact(edit, 4).domain, 'vertex');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(out, edit.folder, 'report.json'))), edit.report);

  const invalid = spawnSync(process.execPath, [cli, 'graph', 'geometry', graph, '--capture', 'base'], { encoding: 'utf8' });
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /need --out/);
});
