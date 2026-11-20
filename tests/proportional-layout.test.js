const test = require('node:test');
const assert = require('node:assert/strict');
const { KIT: K } = require('..').load();
const { grammar, proportions: { phi, subdivide, pixelRect } } = K.procedural;

const almost = (a, b) => assert(Math.abs(a - b) < 1e-10, `${a} != ${b}`);
const size = ({ min, max }) => max.map((n, i) => n - min[i]);
const area = bounds => size(bounds).reduce((value, extent) => value * extent);
const emit = role => ({ op: 'emit', role });

test('a golden rectangle yields four successive squares with rotating placement', () => {
  const source = { min: [0, 0], max: [phi, 1] };
  const layout = subdivide(source, { depth: 4, majorAt: 'turn' });
  assert.equal(layout.leaves.length, 5);
  assert.deepEqual(layout.seams.map(s => s.axis), ['u', 'v', 'u', 'v']);
  for (const { bounds } of layout.leaves.slice(0, 4)) {
    const [w, h] = size(bounds);
    almost(w, h);
  }
  const [first, second, third, fourth, tail] = layout.leaves.map(leaf => leaf.bounds);
  assert.equal(first.min[0], source.min[0]);
  assert.equal(second.min[1], source.min[1]);
  assert.equal(third.max[0], source.max[0]);
  assert.equal(fourth.max[1], source.max[1]);
  almost(area(tail) + layout.leaves.slice(0, 4).reduce((sum, leaf) => sum + area(leaf.bounds), 0), phi);
  assert(Object.isFrozen(layout.nodes[0].split.bounds.min));
  assert(Object.isFrozen(layout.leaves[0].path));
  assert(!Object.isFrozen(source.min));
});

test('custom ratios conserve the rectangle and reserve separate gutters across both branches', () => {
  const root = { min: [-3, 2], max: [11, 10] };
  const layout = subdivide(root, { ratio: 2.25, axis: 'alternate', majorAt: 'end', gap: .4, depth: 3, recurse: 'both' });
  assert.equal(layout.leaves.length, 8);
  assert.equal(layout.seams.length, 7);
  const pieces = [...layout.leaves, ...layout.seams];
  for (const [i, { bounds: a }] of pieces.entries()) for (const { bounds: b } of pieces.slice(i + 1))
    assert(a.min.some((value, j) => value >= b.max[j] || b.min[j] >= a.max[j]));
  almost(pieces.reduce((sum, piece) => sum + area(piece.bounds), 0), area(root));
  for (const node of layout.nodes.filter(n => n.split)) {
    const dim = node.split.axis === 'u' ? 0 : 1;
    const [major, minor] = ['major', 'minor'].map(side => layout.nodes.find(n =>
      JSON.stringify(n.path) === JSON.stringify([...node.path, side])));
    almost(size(major.bounds)[dim] / size(minor.bounds)[dim], 2.25);
    almost(size(node.split.bounds)[dim], .4);
  }
});

test('size limits stop small branches without moving surviving paths', () => {
  const root = { min: [0, 0], max: [80, 40] };
  const one = subdivide(root, { depth: 1 });
  const deep = subdivide(root, { depth: 12, minSpan: 8 });
  assert.deepEqual(one.leaves[0], deep.leaves[0]);
  assert(deep.seams.length > 1 && deep.seams.length < 12);
  assert.deepEqual(subdivide(root, { gap: 81 }).leaves[0].path, []);
  assert.deepEqual(subdivide(root, { depth: 0 }).seams, []);
  for (const options of [{ ratio: .8 }, { depth: 13 }, { axis: 'z' }, { gap: -1 }, { recurse: true }, { minSpan: Infinity }])
    assert.throws(() => subdivide(root, options), /Proportions/);
  assert.throws(() => subdivide({ min: [0, 0], max: [0, 1] }), /finite UV bounds/);
});

test('rounded shared edges tile an output raster exactly and feed camera atlas rectangles', () => {
  const bounds = { min: [0, 0], max: [151, 99] };
  const { leaves } = subdivide(bounds, { depth: 4, ratio: 1.85, axis: 'alternate', recurse: 'both' });
  const views = leaves.map(({ path, bounds }) => ({ id: path.join('-'), rect: pixelRect(bounds) }));
  const atlas = K.cameraAtlas.prepare({ width: 151, height: 99, views });
  assert.equal(atlas.tiles.length, 16);
  assert.equal(atlas.tiles.reduce((sum, tile) => sum + tile.width * tile.height, 0), area(bounds));
  assert.deepEqual(pixelRect({ min: [1.3, 2.7], max: [1.4, 3.4] }), [1, 3, 0, 0]);
});

test('grammar maps a proportional tree to a world plane with retained panel, trim, and socket paths', () => {
  const scope = { id: 'bay', symbol: 'front', bounds: { min: [1, 2, -5], max: [7, 2.6, 5] } };
  const rules = { front: { op: 'proportion', plane: ['z', 'x'], axis: 'alternate', depth: 2,
    ratio: 2, gap: .25, major: 'face', minor: null, seam: emit('trim') },
  face: { op: 'group', children: [
    { key: 'panel', use: emit('panel') },
    { key: 'mount', use: { op: 'socket', name: 'mount', axis: 'y' } }
  ] } };
  const layout = grammar.expand(scope, rules);
  assert.deepEqual(layout.parts.map(({ path }) => path), [
    ['bay', 'major', 'panel'], ['bay', 'minor', 'major', 'panel'], ['bay', 'seam'], ['bay', 'minor', 'seam']
  ]);
  assert(layout.parts.every(({ bounds }) => bounds.min[1] === 2 && bounds.max[1] === 2.6));
  assert(layout.sockets.every(socket => socket.point[1] === 2.6));
  assert.equal(layout.parts[2].bounds.max[2] - layout.parts[2].bounds.min[2], .25);
  const wider = grammar.expand({ ...scope, bounds: { ...scope.bounds, max: [9, 2.6, 5] } }, rules);
  assert.deepEqual(grammar.children(wider).map(child => child.key), grammar.children(layout).map(child => child.key));
  assert.throws(() => grammar.expand(scope, rules, { maxSteps: 2 }), /budget/);
  assert.throws(() => grammar.expand(scope, rules, { maxDepth: 2 }), /budget/);
  assert.throws(() => grammar.expand(scope, { front: { ...rules.front, plane: ['x', 'x'] } }), /distinct axes/);
});
