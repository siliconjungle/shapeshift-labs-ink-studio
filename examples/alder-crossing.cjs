const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { KIT: K, makeBuilder, makeSculpt } = require('..').load();
const R = require('../cli/render.js');
const PNG = require('../cli/png.js');
const Composite = require('../src/frame-composite.js');

const out = path.resolve(process.argv[2] ?? 'alder-crossing');
fs.mkdirSync(out, { recursive: true });
const file = name => path.join(out, name);
const write = (name, value) => fs.writeFileSync(file(name), JSON.stringify(value, null, 2) + '\n');
const read = name => JSON.parse(fs.readFileSync(file(name), 'utf8'));
const cli = path.resolve(__dirname, '../cli/ink-studio.js'), T = K.procedural.terrainSet;
const run = (...args) => execFileSync(process.execPath, [cli, 'terrain-set', ...args], { encoding: 'utf8', maxBuffer: 4 * 1024 ** 2 });
const grid = { origin: [-8, -4], cell: .20, tileCells: 20, size: [4, 2] };
const { tileCells, cell } = grid, stride = tileCells + 1, clamp = (n, a = 0, b = 1) => Math.max(a, Math.min(b, n));
const hill = (x, z) => .58 - x * .026 + .99 * Math.exp(-((x + 4.3)**2 / 12 + (z + 3.1)**2 / 1.55)) +
  .71 * Math.exp(-((x - 3.2)**2 / 8.1 + (z + 2.82)**2 / 1.36)) +
  .43 * Math.exp(-((x - 4.92)**2 / 6.8 + (z - 2.55)**2 / 1.5)) +
  .075 * Math.sin(2.1 * x + 1.8 * z) * Math.cos(3.14 * z) + .047 * Math.cos(5.2 * x - 1.43 * z);
const tiles = Array.from({ length: 8 }, (_, i) => {
  const at = [i % 4, i >> 2], origin = grid.origin.map((n, k) => n + at[k] * tileCells * cell);
  return { at, heights: Array.from({ length: stride ** 2 }, (_, j) => {
    const x = j % stride, z = Math.floor(j / stride), edge = Math.min(x, z, tileCells - x, tileCells - z);
    return hill(origin[0] + x * cell, origin[1] + z * cell) + (i % 2 ? -.035 : .055) * Math.max(0, 1 - edge / 3);
  }) };
});
const chain = items => items.map(([id, x, z]) => ({ id, at: [x, z] }));
const pathPoints = chain([['west', -7.8, 2.52], ['ford', -5.08, 1.47], ['market', -2.77, 2.07],
  ['meadow', .72, 2.36], ['turn', 3.87, 2.05], ['east', 7.8, 2.64]]);
const prototype = (id, names) => ({ id, variants: names.map((name, i) => ({
  id: name, weight: i ? 1 : 2,
  lods: [{ distance: 0, asset: name + '-near' }, { distance: 3.8, asset: name + '-middle' },
    { distance: 7.4, asset: name + '-far' }]
})) });
const paint = (id, points, width, softness) => ({ id, points, width, softness });
const recipe = { format: T.format, version: 1, id: 'alder-crossing', seed: 83, grid, tiles, stitch: { mode: 'average' },
  erosion: { strength: .45, minArea: .20, maxDepth: .18, steps: 4, protect: 'keep-meadow' },
  masks: [
    { id: 'keep-meadow', source: 'paint', strokes: [paint('grass-bank', [[1.5, 1.3], [3.5, 2.25], [5.5, 2.7]], 1.24, .55)] },
    { id: 'wet-bank', source: 'route', route: 'alder-run', range: [.53, 1.42], feather: .37 },
    { id: 'ridge', source: 'height', range: [.83, 2.75], feather: .21 }
  ],
  biomes: { fallback: 'heath', regions: [{ id: 'moss', mask: 'wet-bank' }, { id: 'ridge', mask: 'ridge', weight: .95 }] },
  routes: [
    { id: 'alder-run', kind: 'river', width: 1.12, depth: .31, grade: .012, waterHeight: .61, points: chain([
      ['spring', -8, -.25], ['bend', -5.52, .13], ['pool', -2.47, -.58], ['bars', .58, .40], ['reed', 2.82, .12],
      ['sill', 5.37, -.58], ['mouth', 8, .06]]) },
    { id: 'market-road', kind: 'road', width: .52, points: pathPoints },
    { id: 'merchant-row', kind: 'buildings', width: .52, prototypeId: 'houses', spacing: 1.53, setback: .47, side: 'right', points: pathPoints }
  ],
  prototypes: [prototype('trees', ['spruce', 'alder']), prototype('reeds', ['rush']), prototype('boulders', ['basalt']),
    prototype('houses', ['copper-house', 'slate-house']), prototype('shrine', ['beacon'])],
  scatter: [
    { id: 'grove', prototypeId: 'trees', density: .73, mask: 'ridge', clearance: .27, options: { spacing: .67, slots: 2, exclusion: { distance: .53 } } },
    { id: 'rushes', prototypeId: 'reeds', density: .48, mask: 'wet-bank', clearance: .12,
      options: { spacing: .55, slots: 2, exclusion: { distance: .33 } } },
    { id: 'stone', prototypeId: 'boulders', density: .21, clearance: .27, options: { spacing: 1.07, slots: 2 } }
  ] };
write('terrain.json', recipe);
run('bake', file('terrain.json'), '--out', file('before'));
const revision = JSON.parse(run('inspect', file('terrain.json'))).revision;
const before = read('before/manifest.json'), compileTiles = (folder, manifest) => manifest.tiles.map(row => read(folder + '/' + row.file));
const beforeTiles = compileTiles('before', before);
const candidate = beforeTiles.flatMap(tile => tile.instances).filter(row => row.group === 'stone' && row.point[0] < -4 && row.point[2] < 1.4)
  .sort((a, b) => Math.hypot(a.point[0] + 6.8, a.point[2] - .97) - Math.hypot(b.point[0] + 6.8, b.point[2] - .97))[0];
assert(candidate);
write('revision.json', { revision, operations: [
  { op: 'move-point', route: 'market-road', point: 'ford', at: [-5.08, 2.64] },
  { op: 'move-point', route: 'merchant-row', point: 'ford', at: [-5.08, 2.64] },
  { op: 'set-replacement', id: candidate.id, prototypeId: 'shrine' }
] });
run('edit', file('terrain.json'), file('revision.json'), '--out', file('terrain-edited.json'), '--report', file('edit-report.json'));
run('bake', file('terrain-edited.json'), '--out', file('after'));
const after = read('after/manifest.json'), afterTiles = compileTiles('after', after);
const retainedTiles = before.tiles.filter((tile, i) => tile.digest === after.tiles[i].digest);
assert(retainedTiles.length > 0 && retainedTiles.length < after.tiles.length);
const replacement = afterTiles.flatMap(tile => tile.instances).find(instance => instance.id === candidate.id);
assert.equal(replacement.prototypeId, 'shrine');
assert.deepEqual(replacement.point, candidate.point);

const byBytes = manifest => manifest.tiles.reduce((sum, row) => sum + row.bytes, 0);
write('overview.json', { budgetBytes: byBytes(before) + byBytes(after), views: [{ id: 'overview', at: [0, 5.8], radius: 4 }] });
for (const tag of ['before', 'after']) {
  run('stream', file(tag + '/manifest.json'), file('overview.json'), '--out', file(tag + '-overview.json'));
}
const views = [{ id: 'west', at: [-6.2, 1.1], radius: 1 }, { id: 'middle', at: [-1.75, 1.25], radius: 1 },
  { id: 'east', at: [5.78, 1.1], radius: 1 }];
const budgetBytes = Math.max(...after.tiles.map(tile => tile.bytes)) * 5;
write('views.json', { budgetBytes, views });
run('stream', file('after/manifest.json'), file('views.json'), '--out', file('stream-report.json'));
const stream = read('stream-report.json'), seen = new Map(), switches = [];
for (const view of stream.views) for (const { id, asset } of view.instances) {
  if (seen.has(id) && seen.get(id) !== asset) switches.push({ id, view: view.id, before: seen.get(id), after: asset });
  seen.set(id, asset);
}
assert(stream.views[1].retained.length && stream.views[2].evicted.length && switches.length);
assert(stream.views.every(view => view.bytes <= budgetBytes));

const color = {
  heath: [[86, 112, 74], [105, 129, 81], [125, 141, 90]],
  moss: [[59, 98, 71], [79, 128, 83], [104, 143, 86]],
  ridge: [[86, 100, 84], [111, 125, 98], [145, 145, 111]],
  river: [[37, 89, 103], [43, 115, 129], [76, 150, 149]],
  road: [[166, 126, 83], [182, 146, 88], [214, 173, 104]]
};
function terrainTexture(tile) {
  const size = 112, pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = (x + .5) / size * tileCells, v = (y + .5) / size * tileCells;
    const iu = Math.floor(u), iv = Math.floor(v), a = iu + iv * stride, b = a + stride, U = u - iu, W = v - iv;
    const near = Math.round(u) + Math.round(v) * stride;
    const sample = field => (field[a] * (1 - U) + field[a + 1] * U) * (1 - W) + (field[b] * (1 - U) + field[b + 1] * U) * W;
    const wx = tile.origin[0] + u * cell, wz = tile.origin[1] + v * cell;
    const noise = K.hash(Math.floor(wx * 33), Math.floor(wz * 33), 74);
    const bank = sample(tile.river), road = sample(tile.road);
    const hillSide = clamp(.19 + noise * .42 + (tile.normals[near * 3] * -.23 + tile.normals[near * 3 + 2] * .35) * 1.7);
    const kind = bank > .42 ? 'river' : road > .39 ? 'road' : tile.biomes[near];
    const band = kind === 'river' ? .35 + .32 * Math.sin(wz * 17 + 1.4 * Math.sin(wx * 3.2)) + noise * .18
      : kind === 'road' ? .35 + noise * .50 : hillSide;
    pixels.set([...color[kind][Math.min(2, Math.floor(clamp(band) * 3))], 255], (y * size + x) * 4);
  }
  return { width: size, height: size, pixels };
}
function worldTile(tile) {
  const { points, faces, uvs, normals } = T.mesh(tile), faceMaterials = faces.map(() => 0);
  const [tx, tz] = tile.at;
  const lines = [
    [tx === 0, [-1, 0, 0], i => i * stride],
    [tx === 3, [1, 0, 0], i => (tileCells - i) * stride + tileCells],
    [tz === 0, [0, 0, -1], i => tileCells - i],
    [tz === 1, [0, 0, 1], i => tileCells * stride + i]
  ];
  for (const [edge, normal, slot] of lines) {
    if (!edge) continue;
    for (let i = 0; i < tileCells; i++) {
      const a = points[slot(i)], b = points[slot(i + 1)], k = points.length;
      points.push(a, b, [b[0], -.41, b[2]], [a[0], -.41, a[2]]);
      normals.push(...normal, ...normal, ...normal, ...normal);
      uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
      faces.push([k, k + 2, k + 1], [k, k + 3, k + 2]);
      faceMaterials.push(1, 1);
    }
  }
  return K.sceneMeshes.create({ id: 'terrain-' + tile.at.join('-'), positions: points.flat(), indices: faces.flat(),
    normals, uvs, faceMaterials, materials: [{ id: 'terrain', texture: terrainTexture(tile) }, { id: 'cut-earth', color: 0x654e4a }] });
}

const palette = [0x172a38, 0x303d42, 0x475b50, 0x60785c, 0x809068, 0xb6ba81, 0x8f947c, 0xbfc1a0,
  0x43494b, 0x76584f, 0xa7785d, 0xd99964, 0xf3c187, 0x655b69, 0x848194, 0xb0a4a4, 0xfee5ab];
function shot(tiles, instances) {
  const builder = makeBuilder(78, palette), S = K.sculpt(makeSculpt(builder));
  Object.assign(S, { pixel: true, sun: K.V.norm([-.5, .8, .43]), sky: .23, sunK: .52, amb: .32, shLen: 0 });
  for (const item of instances) {
    const [x, y, z] = item.point, { scale: s, asset, yaw, prototypeId } = item;
    if (prototypeId === 'trees') {
      const wide = item.variant === 'alder', height = (wide ? .75 : 1.20) * s;
      builder.axial(x, y + height * .25, z, [0, 1, 0], height * .25, .038 * s, builder.P[9], 1);
      const layers = asset.endsWith('-far') ? 3 : asset.endsWith('-middle') ? 5 : 7;
      for (let j = 0; j < layers; j++) {
        const t = j / layers, radius = (.26 + .09 * Number(wide)) * s * (1 - t * .86);
        const count = asset.endsWith('-far') ? 3 : 6;
        for (let k = 0; k < count; k++) {
          const angle = yaw + k * 2 * Math.PI / count + j * .35, a = Math.cos(angle), b = Math.sin(angle);
          builder.disc(x + a * radius * .64, y + height * (.24 + t * .69), z + b * radius * .64,
            [a * .7, .58, b * .7], radius * .69, .025, builder.P[2 + Math.round(clamp((b - a + 2) / 4) * 3)], 1);
        }
      }
    } else if (prototypeId === 'reeds') {
      for (let i = -1; i <= 1; i++) builder.axial(x + i * .045, y + .08, z, [i * .18, 1, 0],
        .096 * s, .021, builder.P[i === 0 ? 5 : 4], 1);
    } else if (prototypeId === 'boulders') {
      S.rock([x, y + .06, z], .15 * s, { r: [2, 3, 6, 7] }, { res: item.level === 2 ? .12 : .075, rd: .02 });
    } else {
      const landmark = prototypeId === 'shrine', narrow = landmark ? .23 : .34, height = landmark ? .94 : .45;
      const masonry = { r: landmark ? [8, 9, 10, 11, 12] : [2, 6, 7, 12] };
      S.box([x, y + height * .48, z], [narrow, height * .48, .275], masonry, { res: .071, rd: .03 });
      const roof = { r: item.variant === 'slate-house' ? [8, 13, 14, 15] : [8, 9, 10, 11, 12] };
      for (const side of [-1, 1]) {
        const a = side * -.49, c = Math.cos(a), t = Math.sin(a);
        S.box([x + side * narrow * .5, y + height + .073, z], [narrow * .65, .037, .327], roof,
          { res: .057, ax: [[c, t, 0], [-t, c, 0], [0, 0, 1]] });
      }
      S.box([x, y + height * .42, z + .277], [.072, .102, .021], { r: [8, 9, 16], em: landmark }, { res: .049 });
      if (landmark) builder.disc(x, y + height + .24, z, [0, 0, 1], .095, .035, builder.P[16], 2);
    }
  }
  S.bake();
  const world = builder.finish({ meshes: tiles.map(worldTile), radius: 17, dither: 0,
    cam: { target: [0, .45, 0], dist: 23.7, pitch: .67, yaw: -.19, ortho: true, fov: .58, sway: 0 } });
  return R.render(world, { w: 336, h: 232, px: 1, lockCamera: true, raw: true, edges: false });
}
const beforeView = read('before-overview.json').views[0], afterView = read('after-overview.json').views[0];
assert.equal(afterView.tiles.length, 8);
const gallery = [shot(beforeTiles, beforeView.instances), shot(afterTiles, afterView.instances)];
const w = 694, h = 374, dark = [23, 42, 56], paper = { w, h, rgb: new Uint8Array(w * h * 3) };
for (let i = 0; i < paper.rgb.length; i += 3) paper.rgb.set(dark, i);
function copy(image, x, y) {
  for (let row = 0; row < image.h; row++)
    paper.rgb.set(image.rgb.subarray(row * image.w * 3, (row + 1) * image.w * 3), ((y + row) * w + x) * 3);
}
copy(gallery[0], 7, 47);
copy(gallery[1], 351, 47);
const resident = [85, 135, 113], reused = [126, 168, 127], waiting = [48, 72, 79], dot = [242, 188, 125];
function blocks(view) {
  const w = 113, h = 47, rgb = new Uint8Array(w * h * 3);
  function plot(x, y, color) { rgb.set(color, (y * w + x) * 3); }
  for (let i = 0; i < rgb.length; i += 3) rgb.set(dark, i);
  for (let z = 0; z < 2; z++) for (let x = 0; x < 4; x++) {
    const is = row => row[0] === x && row[1] === z;
    const fill = view.retained.some(is) ? reused : view.loaded.some(is) ? resident : waiting;
    for (let y = z * 23 + 1; y < z * 23 + 23; y++) for (let i = x * 28 + 1; i < x * 28 + 28; i++) plot(i, y, fill);
  }
  const x = Math.round((view.at[0] + 8) / 16 * (w - 3)) + 1, y = Math.round((view.at[1] + 4) / 8 * (h - 3)) + 1;
  for (const [u, v] of [[0, 0], [-1, 0], [-2, 0], [1, 0], [2, 0], [0, -1], [0, -2], [0, 1], [0, 2]]) plot(x + u, y + v, dot);
  return { w, h, rgb };
}
for (const [i, view] of stream.views.entries()) copy(blocks(view), 120 + i * 171, 308);
const base = R.upscale(paper, 2);
const text = (text, x, y, size, color) => ({ type: 'text', text, at: [x * 2, y * 2], size: size * 2, color });
const draw = [text('ALDER CROSSING', w / 2, 17, 16, '#f4cf98'),
  text('ORIGINAL', 175, 41, 10, '#bfcec1'), text('ROAD DIVERSION AND BEACON', 519, 41, 10, '#bfcec1'),
  text(retainedTiles.length + ' OF 8 TILES RETAINED AFTER EDIT', w / 2, 282, 10, '#e2bd89'),
  ...stream.views.map((row, i) => text(row.id.toUpperCase() + '  /  ' + row.tiles.length + ' TILES', 176 + i * 171, 301, 9, '#bdcfc0')),
  text('STREAMING WINDOWS', w / 2, 364, 10, '#9eb8af')];
const layers = K.frameComposite.prepare({ layers: [{ draw }] }, base.w, base.h, 1);
const sheet = Composite.compose(base, K.frameComposite.layers(layers, {}, 0), base.w, base.h, 'nearest');
PNG.write(file('alder-crossing.png'), sheet.w, sheet.h, sheet.rgb);
write('report.json', { image: 'alder-crossing.png', shared: read('after/build-report.json').shared,
  erosion: read('after/build-report.json').erosion, retainedTiles: retainedTiles.map(row => row.at), replacement: {
    id: candidate.id, point: candidate.point, before: candidate.prototypeId, after: replacement.prototypeId },
  stream: { budgetBytes, verifiedTiles: stream.verifiedTiles, views: stream.views.map(({ instances, ...row }) => ({
    ...row, instances: instances.length })), visitedLodChanges: switches.length, examples: switches.slice(0, 5) } });
console.log(file('alder-crossing.png'));
