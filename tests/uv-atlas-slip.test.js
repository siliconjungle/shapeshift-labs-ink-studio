const test = require('node:test');
const assert = require('node:assert/strict');
const studio = require('..');
const runWebGL = require('../cli/look-webgl');
const kit = studio.load();
const chrome = process.env.INK_TEST_CHROME;

function fixture({ makeBuilder, SpriteSurface }) {
  const builder = SpriteSurface.make(16);
  const main = builder.reserve(4, 4, (x, y) =>
    y < 2 ? (x < 2 ? 0xf13547 : 0xfbb45a) : (x < 2 ? 0x51cda7 : 0x4e86e3));
  const neighbor = builder.reserve(4, 4, (x, y) => x < 2 && y < 2 ? null : 0xd771e9);
  const feed = builder.reserve(8, 4, (x, y) => x < 4 ? 0x295067 : y < 2 ? 0xffeeb9 : 0x999eeb);
  builder.faceRegion([-2, -.8, .2], [1.8, 0, 0], [0, 1.6, 0], main, { id: 'terminal' });
  builder.faceRegion([.2, -.8, .2], [1.8, 0, 0], [0, 1.6, 0], main);
  builder.faceRegion([-2.2, -1, 0], [2.2, 0, 0], [0, 2, 0], feed);
  const atlas = builder.finish();
  const world = makeBuilder(3, [0x121b29]).finish({
    cam: { target: [0, 0, 0], dist: 4, yaw: 0, pitch: 0, fov: .8 },
    spriteSurfaces: atlas
  });
  const points = { northwest: [13, 17], northeast: [25, 17], southwest: [13, 31], southeast: [25, 31], other: [43, 17] };
  const edits = [
    [],
    [{ face: 'terminal', flipU: true, flipV: true }],
    [{ face: 'terminal', cells: [1, 0] }],
    [{ face: 'terminal', to: { ...feed, x: feed.x + 4, width: 4 } }],
    []
  ];
  return { world, atlas, main, neighbor, points, edits };
}

const w = 64, h = 48;
const color = number => [number >> 16, (number >> 8) & 255, number & 255];
const view = { w, h, px: 1, raw: true };
const render = world => studio.render(world, view);
const software = (world, points) => {
  const { rgb } = render(world);
  return Object.fromEntries(Object.entries(points).map(([key, [x, y]]) => {
    const p = (y * w + x) * 3;
    return [key, [...rgb.subarray(p, p + 3)]];
  }));
};

test('face IDs select flips, adjacent atlas cells and arbitrary crops through the normal software renderer', () => {
  const { world, atlas, neighbor, points, edits } = fixture(kit);
  const vertices = atlas.vertices.slice(), pixels = atlas.pixels.slice();
  const baselineDepth = studio.render(world, { ...view, passes: ['depth'] }).passes.depth;
  const samples = edits.map(edit => {
    kit.SpriteSurface.uvSlip(atlas, edit);
    return software(world, points);
  });
  const [base, flip, cell, crop, restored] = samples;
  assert.deepEqual(Object.values(base), [0xf13547, 0xfbb45a, 0x51cda7, 0x4e86e3, 0xf13547].map(color));
  assert.deepEqual(Object.values(flip), [0x4e86e3, 0x51cda7, 0xfbb45a, 0xf13547, 0xf13547].map(color));
  assert.deepEqual(Object.values(cell), [0x295067, 0xd771e9, 0xd771e9, 0xd771e9, 0xf13547].map(color));
  assert.deepEqual(Object.values(crop), [0xffeeb9, 0xffeeb9, 0x999eeb, 0x999eeb, 0xf13547].map(color));
  assert.deepEqual(restored, base);
  assert.deepEqual(atlas.vertices, vertices);
  assert.deepEqual(atlas.pixels, pixels);
  assert.equal(atlas.revision, undefined);
  assert.equal(atlas.geometryRevision, undefined);
  kit.SpriteSurface.uvSlip(atlas, edits[3]);
  assert.deepEqual(studio.render(world, { ...view, passes: ['depth'] }).passes.depth, baselineDepth);
  kit.SpriteSurface.uvSlip(atlas, edits[2]);
  const rgba = new Uint8Array(4 * 4 * 4);
  for (let i = 0; i < rgba.length; i += 4) rgba.set([25, 175, 138, 255], i);
  kit.SpriteSurface.update(atlas, neighbor, { w: 4, h: 4, rgba });
  assert.deepEqual(software(world, points).northwest, [25, 175, 138]);
});

test('invalid edits are atomic and pre-existing atlases can target explicit triangle spans', () => {
  const { world, atlas, main, neighbor, points, edits } = fixture(kit);
  const slip = kit.SpriteSurface.uvSlip;
  slip(atlas, edits[1]);
  const flipped = render(world).rgb;
  for (const bad of [
    [{ face: 'missing' }], [{ face: 'terminal', first: 0 }], [{ face: 'terminal', cells: [-1, 0] }],
    [{ first: 1, count: 5, from: main }], [{ face: 'terminal', flipU: 1 }],
    [{ face: 'terminal' }, { first: 3, count: 3, from: main }]
  ]) assert.throws(() => slip(atlas, bad));
  assert.deepEqual(render(world).rgb, flipped);
  const legacy = { ...atlas };
  world.spriteSurfaces = legacy;
  const base = software(world, points);
  slip(legacy, [{ first: 0, count: 3, from: main, to: neighbor }]);
  const triangle = software(world, points);
  assert.deepEqual(triangle.northwest, color(0x295067));
  assert.deepEqual(triangle.southeast, base.southeast);
  assert.deepEqual(triangle.other, base.other);
});

test('WebGL redraws the face addresses without a texture or vertex upload', async () => {
  const { createSurfacePipeline } = await import('../src/webgl/surfaces.mjs');
  const { atlas, edits } = fixture(kit);
  const calls = [], constants = new Map();
  const raw = { getProgramParameter: (_program, key) => key === gl.LINK_STATUS, getShaderParameter: () => true,
    getParameter: () => 8192 };
  const gl = new Proxy(raw, { get(o, key) {
    if (key in o) return o[key];
    if (/^[A-Z_0-9]+$/.test(key)) {
      if (!constants.has(key)) constants.set(key, constants.size + 1);
      return constants.get(key);
    }
    return (...args) => {
      calls.push({ key, args });
      if (key.startsWith('create')) return {};
    };
  } });
  const pipeline = createSurfacePipeline(gl);
  const frame = { view: [], projection: [], range: [0, 10, 1, 0], fog: [0, 0, 0] };
  pipeline.draw(atlas, frame);
  calls.length = 0;
  kit.SpriteSurface.uvSlip(atlas, edits[2]);
  pipeline.draw(atlas, frame);
  assert.deepEqual(pipeline.stats, { geometryBytes: 0, textureBytes: 0 });
  assert.deepEqual(calls.filter(call => call.key === 'drawArrays').map(call => call.args.slice(1)), [[0, 6], [6, 12]]);
  pipeline.dispose();
});

test('native WebGL matches the software renderer while switching and clearing live slips', { skip: !chrome }, () => {
  const result = runWebGL({ chrome }, fixture, (kit, build, backend, [w, h]) => {
    const { world, atlas, points, edits } = build({ ...kit, SpriteSurface });
    const renderer = backend(w, h, { raw: true, offscreen: true });
    const samples = edits.map(edit => {
      SpriteSurface.uvSlip(atlas, edit);
      renderer.draw(world);
      return renderer.sample(points);
    });
    renderer.close();
    return { samples };
  }, [w, h]);
  const { world, atlas, points, edits } = fixture(kit);
  const expected = edits.map(edit => {
    kit.SpriteSurface.uvSlip(atlas, edit);
    return software(world, points);
  });
  assert.deepEqual(result.samples, expected);
});
