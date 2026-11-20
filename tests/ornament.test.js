const test = require('node:test');
const assert = require('node:assert/strict');
const { KIT: { procedural: { ornament } } } = require('..').load();
const near = (a, b) => assert(Math.abs(a - b) < 1e-9, `${a} != ${b}`);
const motif = [
  { type: 'polygon', points: [[.12, .16], [.33, .18], [.25, .35], [.16, .30]], color: '#f0b167' },
  { type: 'path', points: [[.113, .17], [.25, .22], [.34, .46]], color: '#67d1b3', width: .032 }
];
const transform = ({ matrix: [a, b, c, d], offset: [u, v] }, x, y) => [a * x + b * y + u, c * x + d * y + v];

test('all 24 conventional groups preserve pigment and signed relief under every listed isometry', () => {
  const wallpaperOrders = [1, 2, 2, 2, 4, 4, 4, 4, 8, 4, 8, 8, 3, 6, 6, 6, 12];
  const friezeOrders = [1, 2, 2, 2, 2, 4, 4];
  for (const [kind, groups] of Object.entries(ornament.groups)) {
    assert.equal(groups.length, kind === 'wallpaper' ? 17 : 7);
    for (const [i, group] of groups.entries()) {
      const pattern = ornament.compile({ kind, group, motif });
      const orders = kind === 'wallpaper' ? wallpaperOrders : friezeOrders;
      assert.equal(pattern.operations.length, orders[i]);
      for (const operation of pattern.operations) {
        const [origin, x, y] = [[0, 0], [1, 0], [0, 1]].map(([u, v]) => pattern.position(transform(operation, u, v)));
        near(Math.hypot(x[0] - origin[0], x[1] - origin[1]), Math.hypot(...pattern.basis[0]));
        near(Math.hypot(y[0] - origin[0], y[1] - origin[1]), Math.hypot(...pattern.basis[1]));
        const xy = pattern.position([1, -1]);
        near(Math.hypot(x[0] - y[0], x[1] - y[1]), Math.hypot(...xy));
        for (let v = 0; v < 7; v++) for (let u = 0; u < 7; u++) {
          const U = u / 7 + .037, V = v / 7 - .026;
          const here = pattern.position([U, V]), there = pattern.position(transform(operation, U, V));
          assert.deepEqual(pattern.ink(...there), pattern.ink(...here), kind + ' ' + group);
          near(pattern.distance(...there), pattern.distance(...here));
        }
      }
    }
  }
});

test('glides shift by half a cell, preserve source colors and leave frieze V unwrapped', () => {
  const single = [{ type: 'path', points: [[.21, .24]], width: .038, color: '#ff9030' }];
  const f = ornament.compile({ kind: 'frieze', group: 'p11g', cell: [2, 1], motif: single });
  const w = ornament.compile({ group: 'pg', cell: [2, 1], motif: single });
  for (const pattern of [f, w]) {
    const [x, y] = pattern.position([.71, .76]);
    assert.deepEqual(pattern.ink(x, y), [255, 144, 48, 255]);
    assert.equal(pattern.ink(...pattern.position([.21, .76])), null);
    assert.equal(pattern.ink(...pattern.position([.71, .24])), null);
    assert.deepEqual(pattern.ink(x + 2, y), pattern.ink(x, y));
  }
  assert.equal(f.ink(...f.position([.21, 1.24])), null);
  assert.deepEqual(w.ink(...w.position([.21, 1.24])), [255, 144, 48, 255]);
});

test('hexagonal mirror settings are distinct and centered groups add half-cell sites', () => {
  const seed = [{ type: 'path', width: .015, points: [[.21, .28]] }];
  const a = ornament.compile({ group: 'p3m1', motif: seed }), b = ornament.compile({ group: 'p31m', motif: seed });
  assert(a.ink(...a.position([-.28, -.21])));
  assert.equal(b.ink(...b.position([-.28, -.21])), null);
  const c = ornament.compile({ group: 'cmm', cell: [3, .7], motif: seed });
  assert(c.ink(...c.position([.71, .78])));
});

test('seam-crossing shapes stay aligned in transparent raster output and the relief field', () => {
  const pattern = ornament.compile({ motif: [
    { type: 'polygon', points: [[-.13, .3], [.17, .3], [.17, .7], [-.13, .7]], color: '#ef7850' },
    { type: 'path', points: [[-.1, .5], [.1, .5]], width: .078, color: '#55c9ad' }
  ] });
  assert.deepEqual(pattern.ink(.955, .50), [85, 201, 173, 255]);
  near(pattern.distance(-.045, .65), pattern.distance(.955, .65));
  assert(pattern.distance(.955, .65) < 0);
  assert(pattern.distance(.50, .80) > 0);
  const a = pattern.raster({ w: 64, h: 64, samples: 2 });
  const b = pattern.raster({ w: 64, h: 64, samples: 2, bounds: { min: [1, -2], max: [2, -1] } });
  assert.deepEqual(a.rgba, b.rgba);
  const alphas = a.rgba.filter((_, i) => i % 4 === 3);
  assert(alphas.includes(0) && alphas.includes(255) && alphas.some(v => v > 0 && v < 255));
});

test('a hexagonal rectangular supercell exports pixel-identically and tiles keep stable parallelograms', () => {
  const pattern = ornament.compile({ group: 'p6m', cell: [2, 2], motif });
  const h = 2 * pattern.basis[1][1];
  const settings = { w: 60, h: 72, space: 'plane', background: '#142236' };
  const cell = pattern.raster({ ...settings, bounds: { min: [0, 0], max: [2, h] } });
  const shifted = pattern.raster({ ...settings, bounds: { min: [-2, h], max: [0, h * 2] } });
  assert.deepEqual(cell.rgba, shifted.rgba);
  const tiles = pattern.tiles({ min: [-1, 0], max: [2, 1] });
  assert.deepEqual(tiles.map(p => p.id), ['-1:0', '0:0', '1:0']);
  assert.deepEqual(tiles[1], pattern.tiles()[0]);
  assert.deepEqual(tiles[0].corners[1], tiles[1].corners[0]);
  assert.deepEqual(tiles[0].corners[2], tiles[1].corners[3]);
  assert(Object.isFrozen(tiles[0].corners[0]));
});

test('invalid lattice metrics, motif inputs and work budgets are rejected', () => {
  assert.throws(() => ornament.compile({ group: 'p4g', cell: [1, 2], motif }), /cell lengths/);
  assert.throws(() => ornament.compile({ group: 'pm', angle: 1.23, motif }), /angle/);
  assert.throws(() => ornament.compile({ kind: 'frieze', group: 'p6m', motif }), /group/);
  assert.throws(() => ornament.compile({ group: 'p1', motif: [{ ...motif[0], color: '#ffffff77' }] }), /opaque/);
  const f = ornament.compile({ kind: 'frieze', motif });
  assert.throws(() => f.raster({ w: 4000, h: 4000, samples: 4 }), /budget/);
  assert.throws(() => f.tiles({ max: [2, 2] }), /tile window/);
});

test('the CLI exports matching pigment, beveled relief, and keyed tile layouts', () => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const { execFileSync } = require('node:child_process'), { raster } = require('../cli/png.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-ornament-'));
  const root = path.resolve(__dirname, '..'), cli = path.join(root, 'cli/ink-studio.js');
  try {
    const spec = path.join(dir, 'pattern.json');
    const definition = { group: 'p4g', motif, raster: { w: 48, h: 56, samples: 2, bevel: .02 },
      tiles: { min: [-1, 0], max: [1, 1] } };
    fs.writeFileSync(spec, JSON.stringify(definition));
    function exportFile(format, suffix) {
      const output = path.join(dir, format + suffix);
      execFileSync(process.execPath, [cli, 'ornament', spec, '--format', format, '--out', output], { cwd: root });
      return output;
    }
    const inky = raster(exportFile('pigment', '.png')), relief = raster(exportFile('relief', '.png'));
    assert.deepEqual([inky.w, inky.h, relief.w, relief.h], [48, 56, 48, 56]);
    const values = new Set();
    let insideDarker = false;
    for (let p = 0; p < 48 * 56; p++) {
      const i = p * 4, gray = relief.data[i];
      values.add(gray);
      assert.equal(gray, relief.data[i + 1]);
      assert.equal(gray, relief.data[i + 2]);
      assert.equal(relief.data[i + 3], 255);
      if (inky.data[i + 3] === 255 && gray < 100) insideDarker = true;
    }
    assert(insideDarker && values.has(0) && values.has(255) && values.size > 2);
    const geometry = JSON.parse(fs.readFileSync(exportFile('tiles', '.json'), 'utf8'));
    assert.deepEqual(geometry.tiles, ornament.compile(definition).tiles(definition.tiles));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
