const { test } = require('node:test');
const assert = require('node:assert/strict');
const studio = require('..');
const runWebGL = require('../cli/look-webgl');
const kit = studio.load();
const { KIT: K, SpriteSurface } = kit;

const options = {
  width: 8, height: 4, maxPixelsPerFrame: 8, maxViewsPerFrame: 2,
  views: [
    { id: 'fast', rect: [0, 0, 2, 2], fps: 8, frame: { camera: { yaw: 1 } } },
    { id: 'wide', rect: [2, 0, 4, 2], fps: 4, frame: ({ time }) => ({ camera: { yaw: time } }) },
    { id: 'slow', rect: [0, 2, 2, 2], fps: 2 }
  ]
};
const pixel = (image, x, y) => Array.from(image.rgba.subarray((y * image.w + x) * 4, (y * image.w + x) * 4 + 4));

test('camera tile updates respect both budgets, individual cadences and fair deferral', () => {
  const world = {}, calls = [];
  const atlas = K.cameraAtlas.raster(options, (source, frame) => {
    assert.equal(source, world);
    calls.push(frame);
    return { w: frame.width, h: frame.height, rgb: new Uint8Array(frame.width * frame.height * 3).fill(30 + calls.length) };
  });
  const first = atlas.capture(world, { time: 0, frame: { camera: { pitch: .4 } } });
  assert.deepEqual(first, { updated: ['fast'], deferred: ['wide', 'slow'], pixels: 4, rewound: false });
  assert.deepEqual(calls[0].camera, { yaw: 1, pitch: .4 });
  assert.equal(calls[0].inspection, false);
  assert.deepEqual(pixel(atlas.read('wide'), 0, 0), [0, 0, 0, 0]);
  assert.deepEqual(atlas.capture(world, { time: 0 }).updated, ['wide']);
  assert.deepEqual(atlas.capture(world, { time: 0 }).updated, ['slow']);
  assert.deepEqual(atlas.capture(world, { time: .124 }).updated, []);
  assert.deepEqual(atlas.capture(world, { time: .125 }).updated, ['fast']);
  assert.equal(atlas.lastCapture('wide'), 0);
  const read = atlas.read();
  assert.deepEqual(pixel(read, 0, 2), [33, 33, 33, 255]);
  assert.deepEqual(pixel(read, 7, 3), [0, 0, 0, 0]);
  read.rgba.fill(255);
  assert.deepEqual(pixel(atlas.read(), 0, 2), [33, 33, 33, 255]);
  assert.equal(atlas.capture(world, { time: 0 }).rewound, true);
  assert.equal(atlas.lastCapture('wide'), undefined);
  assert.deepEqual(pixel(atlas.read(), 2, 1), [0, 0, 0, 0]);
  atlas.dispose();
  assert.throws(() => atlas.capture(world), /disposed/);
});

test('a bad capture is retried without publishing a partial tile or losing completed captures', () => {
  let fail = true, atlas;
  atlas = K.cameraAtlas.raster({ ...options, maxViewsPerFrame: 1 }, (world, frame) => {
    if (frame.width === 4 && fail) atlas.capture(world);
    return { w: frame.width, h: frame.height, rgba: new Uint8Array(frame.width * frame.height * 4).fill(100) };
  });
  atlas.capture({});
  assert.throws(() => atlas.capture({}), /recursively/);
  assert.equal(atlas.lastCapture('fast'), 0);
  assert.equal(atlas.lastCapture('wide'), undefined);
  assert.deepEqual(pixel(atlas.read('wide'), 0, 0), [0, 0, 0, 0]);
  fail = false;
  assert.deepEqual(atlas.capture({}).updated, ['wide']);
  assert.throws(() => K.cameraAtlas.prepare({ ...options, maxPixelsPerFrame: 7 }), /budget/);
  assert.throws(() => K.cameraAtlas.prepare({ ...options, views: [...options.views,
    { id: 'overlap', rect: [1, 0, 2, 1] }] }), /overlap/);
});

function fixture({ makeBuilder }) {
  const builder = makeBuilder(9, [0x09111a, 0xf45035, 0x36ecaa, 0x496bfb]);
  builder.ball(-1.2, 0, 0, .45, .7, .36, 480, [1]);
  builder.ball(1.2, 0, 0, .62, .42, .36, 450, [2]);
  return builder.finish({ cam: { target: [0, 0, 0], yaw: 0, pitch: 0, dist: 6 }, radius: 4 });
}

test('headless capture renders independent views and composes with screen layers and world surface regions', () => {
  const world = fixture(kit);
  const cameras = [{ target: [-1.2, 0, 0], dist: 3 }, { target: [1.2, 0, 0], dist: 3.1 }];
  const atlas = studio.createCameraAtlas({
    width: 40, height: 16, views: cameras.map((camera, i) => ({
      id: 'cam-' + i, rect: [20 * i, 0, 20, 16], frame: { camera, raw: true }
    }))
  });
  atlas.capture(world);
  for (let i = 0; i < 2; i++) {
    const image = studio.render(world, { ...cameras[i], w: 20, h: 16, px: 1, raw: true });
    const capture = atlas.read('cam-' + i);
    for (let j = 0; j < 320; j++)
      assert.deepEqual(capture.rgba.subarray(j * 4, j * 4 + 3), image.rgb.subarray(j * 3, j * 3 + 3));
  }
  assert.notDeepEqual(atlas.read('cam-0'), atlas.read('cam-1'));

  const builder = SpriteSurface.make(24), region = builder.reserve(20, 16);
  builder.faceRegion([-.6, -.5, .2], [1.2, 0, 0], [0, 1, 0], region);
  builder.faceRegion([-.6, -.5, -.4], [1.2, 0, 0], [0, 1, 0], region);
  builder.face([-2, -1, 0], [.2, 0, 0], [0, .2, 0], 1, 1, () => 0xdd4499);
  const surfaces = builder.finish(), sync = atlas.bindSurface(surfaces, 'cam-1', region);
  assert.equal(sync(), true);
  assert.equal(sync(), false);
  assert.equal(surfaces.vertices.length, 18 * 5);
  assert.deepEqual(Array.from(surfaces.pixels.subarray(0, 20 * 4)), Array.from(atlas.read('cam-1').rgba.subarray(0, 20 * 4)));
  assert.deepEqual(Array.from(surfaces.pixels.subarray(80, 84)), [221, 68, 153, 255]);

  const view = { w: 70, h: 48, px: 1, raw: true };
  const layer = atlas.layer('cam-0', { rect: [-2, 2, 16, 18], filter: 'linear' });
  const main = { ...world, spriteSurfaces: surfaces };
  const ordinary = studio.render(main, view);
  const composed = studio.render(main, { ...view, composite: { layers: [layer] } });
  const graph = studio.render(main, { ...view, renderGraph: { passes: [
    { id: 'feed', type: 'composite', layer }
  ] } });
  assert.ok(composed.rgb.every((value, i) => value === graph.rgb[i]), 'graph and mixed composition must agree');
  assert.notDeepEqual(ordinary.rgb, composed.rgb);
  assert.deepEqual(ordinary.rgb.subarray(0, 70 * 3), composed.rgb.subarray(0, 70 * 3));
  assert.notDeepEqual(studio.render(world, view).rgb, ordinary.rgb);
  atlas.reset();
  assert.equal(sync(), true);
  assert.equal(surfaces.pixels[3], 0);
});

test('WebGL reuses the atlas directly in overlays and render graphs, and copies its feed to a world panel', {
  skip: !process.env.INK_TEST_CHROME
}, () => {
  function build({ makeBuilder }) {
    return makeBuilder(3, [0x000000, 0xff0000]).finish({
      cam: { target: [0, 0, 0], yaw: 0, pitch: 0, dist: 4 }, radius: 3
    });
  }
  function render(kit, make, backend) {
    const scene = make(kit), gpu = backend(28, 22, { raw: true, scale: 1, offscreen: true });
    const red = { rect: [0, 0, 3, 1], color: '#ff0000', type: 'rect' };
    const blue = { rect: [0, 1, 3, 2], color: '#0000ff', type: 'rect' };
    const green = { rect: [0, 0, 3, 3], color: '#00ff00', type: 'rect' };
    const frame = draw => ({ composite: { layers: [{ draw }] } });
    const atlas = gpu.cameraAtlas({ width: 8, height: 6, views: [
      { id: 'west', rect: [1, 1, 3, 3], frame: frame([red, blue]) },
      { id: 'east', rect: [4, 1, 3, 3], frame: frame([green]) }
    ] });
    function pixel(image, x, y) {
      const i = (y * image.w + x) * 4;
      return Array.from(image.rgba.subarray(i, i + 4));
    }
    try {
      const updates = atlas.capture(scene), image = atlas.read();
      const layer = atlas.layer('west', { rect: [2, 2, 12, 12], filter: 'linear' });
      const greenLayer = atlas.layer('east', { rect: [14, 2, 12, 12] });
      const probes = { top: [3, 2], bottom: [3, 13], edge: [13, 2], next: [14, 2], outside: [0, 0] };
      const originalRead = WebGL2RenderingContext.prototype.readPixels;
      let reads = 0;
      WebGL2RenderingContext.prototype.readPixels = function (...args) { reads++; return originalRead.apply(this, args); };
      let composite, graph;
      try {
        gpu.draw(scene, { composite: { layers: [layer, greenLayer] } });
        composite = gpu.sample(probes);
        gpu.draw(scene, { renderGraph: { passes: [
          { id: 'west', type: 'composite', layer }, { id: 'east', type: 'composite', layer: greenLayer }
        ] } });
        graph = gpu.sample(probes);
      } finally {
        WebGL2RenderingContext.prototype.readPixels = originalRead;
      }
      const surface = SpriteSurface.make(3, 3);
      const region = surface.reserve(3, 3);
      surface.faceRegion([-.8, -.8, 0], [1.6, 0, 0], [0, 1.6, 0], region);
      const spriteSurfaces = surface.finish();
      atlas.bindSurface(spriteSurfaces, 'east', region)();
      gpu.draw({ ...scene, spriteSurfaces });
      const panel = gpu.sample({ center: [14, 11] }).center;
      const hasTexture = atlas.texture instanceof WebGLTexture;
      atlas.reset();
      const cleared = pixel(atlas.read('west'), 0, 0);
      return { updated: updates.updated, reads, pixel: pixel(image, 1, 1), empty: pixel(image, 0, 0),
        composite, graph, panel, hasTexture, cleared };
    } finally {
      atlas.dispose();
      gpu.close();
    }
  }
  const result = runWebGL({}, build, render, {});
  assert.deepEqual(result.updated, ['west', 'east']);
  assert.equal(result.hasTexture, true);
  assert.equal(result.reads, 2, 'only the two explicit screen probes should read GPU pixels');
  assert.deepEqual(result.pixel, [255, 0, 0, 255]);
  assert.deepEqual(result.empty, [0, 0, 0, 0]);
  assert.deepEqual(result.cleared, [0, 0, 0, 0]);
  assert.deepEqual(result.composite, result.graph);
  assert.deepEqual(result.graph.top, [255, 0, 0]);
  assert.deepEqual(result.graph.edge, [255, 0, 0]);
  assert.deepEqual(result.graph.bottom, [0, 0, 255]);
  assert.deepEqual(result.graph.next, [0, 255, 0]);
  assert.deepEqual(result.graph.outside, [0, 0, 0]);
  assert.ok(result.panel[1] > 235 && result.panel[0] < 10);
});
