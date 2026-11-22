import { createRenderer } from '../../src/webgl/renderer.mjs';

const $ = id => document.getElementById(id);
const { width, height } = $('coverage'), atlasWidth = 96, atlasHeight = 80, unitsPerPixel = .03;
const cutoff = .55;
const palette = [0x0d1c28, 0x7fcdb7, 0xf6d292, 0xa98be1];
const color = new Uint8Array(atlasWidth * atlasHeight * 4), depth = new Uint8Array(color.length);
const mint = [112, 201, 172], gold = [241, 185, 106], pale = [249, 223, 165], jade = [73, 153, 151];

function deposit(x, y, swatch) {
  if (x < 0 || y < 0 || x >= atlasWidth || y >= atlasHeight) return;
  const p = (y * atlasWidth + x) * 4;
  color.set(swatch, p);
  color[p + 3] = depth[p + 3] = 255;
  depth[p] = x < atlasWidth / 2 + 2 ? 0 : 255;
}

function segment(a, b, r, swatch) {
  const [ax, ay] = a, [bx, by] = b, dx = bx - ax, dy = by - ay, span = dx * dx + dy * dy;
  for (let y = Math.floor(Math.min(ay, by) - r); y <= Math.ceil(Math.max(ay, by) + r); y++)
    for (let x = Math.floor(Math.min(ax, bx) - r); x <= Math.ceil(Math.max(ax, bx) + r); x++) {
      const t = span ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / span)) : 0;
      if ((x - ax - t * dx) ** 2 + (y - ay - t * dy) ** 2 <= r * r) deposit(x, y, swatch);
    }
}

function path(points, radius, swatch, side) {
  const mapped = points.map(([x, y]) => [47.5 + side * x, y]);
  for (let i = 1; i < points.length; i++) segment(mapped[i - 1], mapped[i], radius, swatch);
}

for (const side of [-1, 1]) {
  const upper = [[2, 35], [11, 20], [23, 11], [33, 8], [42, 10], [43, 15], [38, 24], [29, 32], [16, 38], [3, 39]];
  const lower = [[3, 38], [17, 38], [30, 43], [41, 51], [42, 57], [37, 63], [29, 66], [18, 64], [11, 56], [3, 45], [3, 38]];
  path(upper, .76, mint, side);
  path(lower, .68, gold, side);
  for (const [i, point] of upper.slice(1, -1).entries()) {
    const [x, y] = point;
    path([[3, 37], [x * .54, y * .58 + 15], point], .53, i % 2 === 0 ? gold : jade, side);
  }
  for (const [i, point] of lower.slice(2, -2).entries()) {
    const [x, y] = point;
    path([[3, 40], [x * .52, y * .58 + 19], point], .53, i % 2 === 0 ? jade : gold, side);
  }
  path([[7, 29], [16, 29], [23, 26], [30, 21], [35, 15], [39, 11]], .53, mint, side);
  path([[10, 48], [18, 46], [26, 47], [33, 50], [40, 56]], .53, pale, side);
  path([[4, 29], [6, 22], [12, 16], [16, 12]], .81, pale, side);
  path([[3, 46], [5, 57], [11, 68], [17, 73]], .85, mint, side);
  for (const point of [[12, 16], [16, 12], [42, 10], [37, 63], [17, 73]]) path([point, point], 1.38, pale, side);
}
segment([47.5, 35], [47.5, 49], 2.35, mint);
segment([47.5, 30], [47.5, 35], 2.5, gold);
segment([47.5, 39], [47.5, 44], 1.12, pale);
segment([47.5, 48], [47.5, 54], 1.25, jade);

const offscreen = document.createElement('canvas');
const views = ['average', 'coverage'].map(id => ({
  canvas: $(id).getContext('2d', {alpha: false}), label: $(id + '-count'),
  atlas: KIT.sprite.atlas({
    metadata: { width: atlasWidth, height: atlasHeight, unitsPerPixel, depthRange: [-.36, .36],
      depthFormat: 'gray', frames: [{ rect: { x: 0, y: 0, width: atlasWidth, height: atlasHeight } }],
      cutoutMipmaps: { mode: id, cutoff } },
    images: { color, depth }
  })
}));
const reconstruction = KIT.sprite.reconstruction;
function scene(atlas, bar) {
  const B = makeBuilder(19, palette);
  function plate(points, color, object) {
    for (const tri of [[0, 1, 2], [0, 2, 3]])
      KIT.surfacePatches.triangle(B, tri.map(i => points[i]), { color, object });
  }
  plate([[-1, -.8, 0], [1, -.8, 0], [1, .8, 0], [-1, .8, 0]], [140, 196, 166], 'wing');
  if (bar) plate([[-1.45, -.1, .06], [1.45, -.1, .06], [1.45, .1, .06], [-1.45, .1, .06]], [143, 106, 187], 'bar');
  const world = B.finish({ radius: 4, dither: 0, fog: { c: 0, start: 1, max: 0 },
    cam: { target: [0,0,0], yaw: 0, pitch: 0, ortho: true, dist: 4 } });
  reconstruction.bind(world, [{ asset: reconstruction.asset({ atlas }), object: 'wing', at: [0,0,0] }]);
  return world;
}
for (const view of views) view.worlds = [scene(view.atlas, false), scene(view.atlas, true)];

try {
  const renderer = createRenderer(offscreen, { toolkit: { KIT, PixelLook } });
  function draw() {
    const level = Number($('mip').value), dist = height * unitsPerPixel * 2 ** level / (2 * Math.tan(19 * Math.PI / 180));
    const bar = Number($('bar').checked);
    let original;
    for (const view of views) {
      const world = view.worlds[bar], tile = view.atlas.select(0, 'card');
      let activeLevel;
      renderer.render(world, { width, height, raw: true, colored: false, damp: false, spriteReconstruction: 'sprite',
        camera: { ...world.cam, dist }, spriteReconstructionFrame: report => { activeLevel = report.states[0].cutoutLevel; } });
      view.canvas.drawImage(offscreen, 0, 0);
      const mip = view.atlas.cutoutImage(tile, activeLevel), base = view.atlas.cutoutImage(tile);
      const percent = (100 * mip.covered / (mip.width * mip.height)).toFixed(1);
      view.label.value = mip.covered + ' texels · ' + percent + '% coverage';
      $('size').value = mip.width + ' × ' + mip.height + ' px';
      original = (100 * base.covered / (base.width * base.height)).toFixed(1);
    }
    $('status').textContent = bar ? 'The left wing passes in front of the bar. The right wing passes behind it.' :
      'Source coverage is ' + original + '% at a ' + (cutoff * 100).toFixed(0) + '% cutoff.';
  }
  $('mip').addEventListener('input', draw);
  $('bar').addEventListener('input', draw);
  draw();
} catch (error) {
  $('status').textContent = error.message;
}
