const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const PNG = require('../cli/png.js');
const R = require('../cli/render.js');
const Composite = require('../src/frame-composite.js');

const out = path.resolve(process.argv[2] ?? 'geometry-network-demo');
fs.mkdirSync(out);
const file = name => path.join(out, name);
const write = (name, value) => fs.writeFileSync(file(name), JSON.stringify(value, null, 2) + '\n');
const op = (name, inputs) => ({ op: name, inputs });
const ref = (node, port = 'value') => ({ node, port });
const boreRadius = { input: 'boreRadius' };
const aperture = {
  inputs: { boreRadius: { type: 'number' } },
  nodes: {
    bronze: op('sdf.primitive', { kind: 'box', half: [1.28, .84, .30], center: [0, .12, 0], round: .16 }),
    jacket: op('sdf.attributes', { source: ref('bronze'), objectId: 'tidegate', materialId: 'cast-bronze', color: [.8, .49, .25] }),
    cutter: op('sdf.primitive', { kind: 'cylinder', radius: boreRadius, length: 1.8, center: [0, .15, 0], rotation: [Math.PI / 2, 0, 0] }),
    lining: op('sdf.attributes', { source: ref('cutter'), materialId: 'bore-lining', color: [.3, .61, .54] }),
    cut: op('sdf.boolean', { a: ref('jacket'), b: ref('lining'), operation: 'subtract' }),
    surface: op('sdf.mesh', { source: ref('cut'), options: { color: '#cf8f59', resolution: .063, maxCells: 64000 } })
  },
  outputs: { value: ref('surface') }
};
const nodes = {
  cradle: op('geo.box', { center: [0, -.9, 0], half: [1.55, .17, .56], options: { color: '#466e76' } }),
  trim: op('geo.box', { center: [0, -.75, .035], half: [1.48, .054, .54], options: { color: '#83b4a2' } }),
  fixedBounds: op('geo.measure', { source: ref('cradle') }),
  gate: op('Aperture', { boreRadius }),
  gateBounds: op('geo.measure', { source: ref('gate') }),
  body: op('scene.object', { source: ref('gate'), options: { color: '#ce8c55', cells: 44, resolution: .056 } }),
  base: op('scene.object', { source: ref('cradle'), options: { cells: 30 } }),
  lip: op('scene.object', { source: ref('trim'), options: { cells: 28, resolution: .068 } }),
  camera: op('scene.camera', { options: { target: [0, -.04, 0], dist: 5.7, yaw: -.32, pitch: .20, projection: 'orthographic' } })
};
const fixedObjects = ['base', 'lip'];
for (const [index, [x, y]] of [[-.98, .69], [.98, .69], [-.98, -.42], [.98, -.42]].entries()) {
  const id = 'stud' + index, placed = id + 'Mount';
  nodes[id] = op('geo.tube', { start: [x, y, .25], end: [x, y, .42], radius: .116, sides: 6, options: { color: '#e7c58a' } });
  nodes[placed] = op('scene.object', { source: ref(id), options: { cells: 18, resolution: .046 } });
  fixedObjects.push(placed);
}
const placed = ['body', ...fixedObjects];
nodes.objectSlots = op('data.record', Object.fromEntries(placed.map(id => [id, ref(id)])));
nodes.objects = op('data.collect', { source: ref('objectSlots'), keys: placed });
nodes.world = op('scene.world', { objects: ref('objects'), options: { background: '#172631',
  style: { ambient: .43, sky: .22, sunStrength: .73, direction: [-.54, .82, .62] } } });
nodes.image = op('scene.render', { source: ref('world'), camera: ref('camera'), options: { width: 216, height: 148 } });
write('tidegate.json', { format: 'ink-studio/graph-project', version: 1, inputs: { boreRadius: { type: 'number', default: .33 } },
  groups: { Aperture: aperture }, nodes, outputs: { image: ref('image'), gateMesh: ref('gate') } });

const capture = ['cradle', 'gate/lining', 'gate/cut', 'gate/surface', 'gateBounds', 'image'];
const requests = [
  { id: 'baseline', op: 'geometry', capture },
  { id: 'widened', op: 'geometry', inputs: { boreRadius: .58 }, capture },
  { id: 'repeat', op: 'geometry', inputs: { boreRadius: .58 }, capture },
  { op: 'quit' }
];
const input = requests.map(value => JSON.stringify(value) + '\n').join('');
fs.writeFileSync(file('requests.ndjson'), input);
const cli = path.resolve(__dirname, '../cli/ink-studio.js');
const child = spawnSync(process.execPath, [cli, 'graph', 'session', file('tidegate.json'), '--out', file('session')],
  { input, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
assert.equal(child.status, 0, child.stderr ?? child.error?.message);
const replies = child.stdout.trim().split('\n').map(line => JSON.parse(line));
for (const reply of replies) assert.equal(reply.code, 0, reply.error);
fs.writeFileSync(file('replies.ndjson'), child.stdout);
const [before, after, repeat] = replies;
const selected = (reply, node) => reply.report.nodes.find(row => row.node === node);
const artifact = (reply, node) => file(path.join('session', reply.folder, reply.report.captured.find(row => row.node === node).file));
assert.deepEqual(after.report.nodes.filter(row => row.status === 'evaluated').map(row => row.node),
  ['gate', 'gate/cutter', 'gate/lining', 'gate/cut', 'gate/surface', 'gateBounds', 'body', 'objectSlots', 'objects', 'world', 'image']);
assert.equal(repeat.report.cache.misses, 0);
assert.equal(selected(after, 'cradle').computeMs, 0);
assert.deepEqual(fs.readFileSync(artifact(before, 'cradle')), fs.readFileSync(artifact(after, 'cradle')));
assert.notDeepEqual(fs.readFileSync(artifact(before, 'gate/surface')), fs.readFileSync(artifact(after, 'gate/surface')));
assert.notDeepEqual(fs.readFileSync(artifact(before, 'image')), fs.readFileSync(artifact(after, 'image')));
assert.deepEqual(fs.readFileSync(artifact(after, 'image')), fs.readFileSync(artifact(repeat, 'image')));
const images = [before, after].map(reply => PNG.read(artifact(reply, 'image')));
const base = R.upscale(R.grid(images, 2), 2), { w, h } = base;
const text = (text, x, y, size, color = '#c6dade') => ({ type: 'text', text, at: [x, y], size, color });
const draw = [
  text('TIDEGATE GEOMETRY', w / 2, 19, 16, '#f3dbb2'),
  text('BORE RADIUS 0.33', w / 4, 43, 13), text('BORE RADIUS 0.58', w * .75, 43, 13),
  text(before.report.cache.misses + ' EVALUATED', w / 4, h - 28, 12, '#92b9b3'),
  text(after.report.cache.misses + ' EVALUATED   /   ' + after.report.cache.hits + ' REUSED', w * .75, h - 28, 12, '#92b9b3')
];
const { frameComposite } = require('..').load().KIT;
const layout = frameComposite.prepare({ layers: [{ draw }] }, w, h, 1);
const sheet = Composite.compose(base, frameComposite.layers(layout, {}, 0), w, h, 'nearest');
PNG.write(file('tidegate-comparison.png'), sheet.w, sheet.h, sheet.rgb);
console.log('Bore radius .33 to .58, ' + after.report.cache.misses + ' evaluated, ' + after.report.cache.hits +
  ' reused, and ' + repeat.report.cache.hits + ' reused on the repeat.');
