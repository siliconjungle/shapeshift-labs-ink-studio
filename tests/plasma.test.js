const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const ink = require('..'), P = ink.load().KIT.procedural;
const plasma = P.generator.plasma;
const colors = ['#121b32', '#32676c', '#bf756e', '#ffdfa0'];
const cold = ['#172233', '#267890', '#61ab9c', '#d0eaae'];
const row = raster => Array.from(raster.data.slice(0, raster.width));
const bounds = data => data.every(value => Number.isFinite(value) && value >= -1 && value <= 1);
const plane = { id: 'plane', type: 'plane', center: [.125, .5], frequency: 1 };

test('a plane wave quantizes into real palette slots at pixel centers', () => {
  const result = plasma({ width: 4, height: 4, geometry: [plane], palette: colors });
  const values = row(result.field);
  assert(Math.abs(values[0]) < 1e-6 && Math.abs(values[2]) < 1e-6);
  assert.equal(values[1], 1);
  assert.equal(values[3], -1);
  assert.deepEqual(row(result.indices), [2, 3, 2, 0]);
  assert.deepEqual([...result.value.data.slice(4, 8)], [255, 223, 160, 255]);
  const narrower = plasma({ width: 4, height: 4, geometry: [plane], palette: colors, range: [0, .5] });
  assert.deepEqual(narrower.field, result.field);
  assert.notDeepEqual(narrower.indices, result.indices);
});

test('signed weights normalize the sum, and triangle, radial and spiral waves stay finite', () => {
  const constant = id => ({ id, type: 'plane', frequency: 0 });
  const weighted = plasma({ width: 2, height: 2, geometry: [constant('a'), { ...constant('b'), weight: -3 }],
    motion: { a: { phase: .25 }, b: { phase: .25 } } });
  assert.deepEqual([...weighted.field.data], Array(4).fill(-.5));
  const geometry = [{ id:'curl', type:'spiral', arms: -2, frequency: 2 },
    { id:'rings', type:'radial', wave:'triangle', frequency: 4, weight: .8 }];
  assert(bounds(plasma({ width: 37, height: 21, geometry, time: -12, motion: {
    rings: { velocity: [.1, -.1], rate: .4 }, curl: { phase: .25, rate: -.5 }
  } }).field.data));
  const rings = plasma({ width: 7, height: 5, geometry: [{ id: 'r', type: 'radial' }] }).field;
  assert.equal(rings.data[2 * 7 + 2], rings.data[2 * 7 + 4]);
  assert.equal(rings.data[2 * 7 + 2], rings.data[1 * 7 + 3]);
});

test('motion changes the field, palette changes only the display, and time can seek both ways', () => {
  const geometry = [plane, { id: 'rings', type: 'radial', frequency: 3, weight: .5 }];
  const options = { width: 17, height: 11, geometry, motion: {
    plane: { rate: .25 }, rings: { velocity: [.08, -.03], phase: .1 }
  } };
  const frame = time => plasma({ ...options, time, palette: colors });
  const first = frame(0), later = frame(.5);
  assert.notDeepEqual(first.field, later.field);
  assert.notDeepEqual(frame(-.5).indices, later.indices);
  assert.deepEqual(frame(.5), later);
  const recolored = plasma({ ...options, time: .5, palette: cold });
  assert.deepEqual(recolored.indices, later.indices);
  assert.deepEqual(recolored.field, later.field);
  assert.notDeepEqual(recolored.value, later.value);
  assert.deepEqual(plasma({ ...options, time: 99, motion: {} }),
    plasma({ ...options, time: 0, motion: {} }));
});

test('graph outputs feed palette cycling, and native indexed PNG preserves exact slot numbers', t => {
  const link = (node, port) => ({ node, ...(port && { port }) });
  const program = P.graph.create({ nodes: {
    field: { op: 'proc.plasma', inputs: { palette: colors, motion: { cross: { rate: .5 } },
      options: { width: 12, height: 8 } } },
    cycle: { op: 'fx.paletteCycle', inputs: { source: link('field', 'indices'), palette: link('field', 'palette'),
      cycles: { warm: { range: [0, 3], period: 2 } } } }
  }, outputs: { value: link('cycle'), indices: link('cycle', 'indices'), palette: link('cycle', 'palette'),
    field: link('field', 'field'), original: link('field', 'indices') } });
  const first = program.evaluate({}, { time: 0 }).outputs;
  const next = program.evaluate({}, { time: .75 }).outputs;
  assert.notDeepEqual(first.field, next.field);
  assert.notDeepEqual(first.palette, next.palette);
  assert.deepEqual(next.indices, next.original);
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-plasma-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const PNG = require('../cli/png.js'), file = path.join(folder, 'plasma.png');
  const palette = next.palette.map(hex => [1,3,5].map(i => parseInt(hex.slice(i, i + 2), 16)));
  PNG.writeIndexed(file, next.indices.width, next.indices.height, Array.from(next.indices.data), palette);
  const decoded = PNG.indexedRaster(file);
  assert.deepEqual([...decoded.value.data], [...next.indices.data]);
  assert.deepEqual([...PNG.raster(file).data], [...next.value.data]);
});

test('malformed geometry, motion and excessive work are rejected up front', () => {
  assert.throws(() => plasma({ geometry: [plane, plane] }), /unique/);
  assert.throws(() => plasma({ geometry: [{ ...plane, weight: 0 }] }), /nonzero/);
  assert.throws(() => plasma({ geometry: [plane], motion: { missing: { rate: .4 } } }), /existing field/);
  assert.throws(() => plasma({ geometry: [plane], motion: { plane: { rate: NaN } } }), /plasma motion/);
  assert.throws(() => plasma({ palette: [] }), /indexed palette/);
  assert.throws(() => plasma({ range: [1, -1] }), /remap/);
  assert.throws(() => plasma({ width: 1800, height: 1800,
    geometry: Array.from({ length: 16 }, (_, id) => ({ ...plane, id: String(id) })) }), /bounded field program/);
});
