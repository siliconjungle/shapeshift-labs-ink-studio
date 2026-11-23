const { test } = require('node:test');
const assert = require('node:assert/strict');
const PNG = require('../cli/png.js');

test('browser turntable encoding keeps the shared slots and a distinct transparent index', async () => {
  const { encodeGaussianTurntablePNG } = await import('../webgl.mjs');
  const palette = [[0, 0, 0], [207, 122, 102], [0, 0, 0]];
  const sheet = { width: 3, height: 2, indices: Uint8Array.of(0, 1, 2, 2, 0, 1),
    metadata: { palette, transparent: 2 } };
  const blob = await encodeGaussianTurntablePNG(sheet);
  const bytes = Buffer.from(await blob.arrayBuffer());
  assert.equal(blob.type, 'image/png');
  assert.equal(bytes[25], 3);
  const decoded = PNG.indexedRaster(bytes);
  assert.deepEqual(decoded.palette, palette.map(([r,g,b]) => r << 16 | g << 8 | b));
  assert.deepEqual(Array.from(decoded.value.data), Array.from(sheet.indices));
  const raster = PNG.raster(bytes);
  assert.deepEqual([raster.data[3], raster.data[7], raster.data[11]], [255, 255, 0]);
});

test('browser normal PNG retains signed channels and validity alpha', async () => {
  const { encodeGaussianTurntableNormalPNG } = await import('../webgl.mjs');
  const normal = Uint8Array.of(253, 91, 140, 255, 0, 0, 0, 0);
  const png = await encodeGaussianTurntableNormalPNG({ width: 2, height: 1, normal });
  const bytes = Buffer.from(await png.arrayBuffer());
  assert.equal(bytes[25], 6);
  assert.deepEqual(Array.from(PNG.raster(bytes).data), Array.from(normal));
});

test('WebGL turntable keeps the same pivot and separates dark splats from transparency',
  { skip: !process.env.INK_TEST_CHROME }, () => {
    const result = require('../cli/look-webgl.js')({}, () => {}, (kit, fixture, backend) => {
      const data = new Float32Array(16);
      data[3] = .94;
      for (const field of [4, 8, 10]) data[field] = .09;
      const color = (16 / 255 - .5) / .28209479177387814;
      const world = { data, count:1, radius:2, pal:[0x101010,0x636363], dither:0,
        cam:{ dist:4, target:[0,0,0], yaw:0, pitch:0 },
        moving:new Int32Array(), back:new Int32Array(),
        gaussianHarmonics:{ count:1, degree:1, dc:Float32Array.of(color,color,color),
          sh:Float32Array.of(0,0,0,0,0,0,.8,.8,.8), normals:Int8Array.of(127,0,0), up:'y',colorMode:'palette' } };
      const renderer = backend(65, 65, { offscreen: true });
      const { width, height, metadata, indices } = renderer.captureTurntable(world,
        { angles: [90, 0, -90], width: 65, height: 65, columns: 2, fps: 5 });
      const sample = (x,y) => indices[y*width+x];
      const centers = metadata.frames.map(({ rect }) => sample(rect.x + 32, rect.y + 32));
      const corners = metadata.frames.map(({ rect }) => sample(rect.x, rect.y));
      const unused = sample(65,65);
      const painted = renderer.captureTurntable(world, { angles: [0], width: 65, height: 65, frame: {
        splatPaint: { mask: { count: 1, indices: [0] }, ramp: [0x15cc90], protect: true, preview: true }
      } });
      const mapped = renderer.captureTurntable(world,
        { angles: [90, 0, -90], width: 65, height: 65, columns: 2, fps: 5, normals: true });
      const normalAt = (x, y) => Array.from(mapped.normal.subarray((y * width + x) * 4, (y * width + x) * 4 + 4));
      const normalSamples = metadata.frames.map(({rect}) => normalAt(rect.x + 32, rect.y + 32));
      const aligned = indices.every((slot,i) => slot === mapped.indices[i] &&
        (slot !== metadata.transparent || mapped.normal[i*4+3] === 0));
      renderer.close();
      return { width, height, metadata, centers, corners, unused,
        paintedPalette: painted.metadata.palette, paintedPixel: painted.indices[32 * 65 + 32],
        aligned, normalSamples, normalSpace: mapped.metadata.normalSpace,
        normalCounts: mapped.metadata.frames.map(frame=>frame.normalPixels) };
    }, {});
    const { metadata, centers, corners } = result;
    assert.deepEqual([result.width, result.height], [130, 130]);
    assert.deepEqual(metadata.frames.map(frame => frame.angle), [90, 0, -90]);
    assert.deepEqual(metadata.frames.map(frame => frame.rect), [
      { x:0, y:0, width:65, height:65 }, { x:65, y:0, width:65, height:65 }, { x:0, y:65, width:65, height:65 }
    ]);
    assert(metadata.frames.every(frame => frame.pivot.x === 32.5 && frame.pivot.y === 32.5 &&
      frame.duration === .2 && frame.pixels > 0 && !frame.touchesBorder));
    assert.deepEqual(centers, [1, 0, 0]);
    assert(corners.every(slot => slot === metadata.transparent));
    assert.equal(result.unused, metadata.transparent);
    assert.equal(result.paintedPixel, 2);
    assert.deepEqual(result.paintedPalette[result.paintedPixel], [21,204,144]);
    assert.equal(result.normalSpace, 'view');
    assert(result.aligned && result.normalCounts.every(count => count > 0));
    const expected = [[128,128,255,255], [255,128,128,255], [128,128,255,255]];
    for (const [i, normal] of result.normalSamples.entries())
      assert(normal.every((value, c) => Math.abs(value - expected[i][c]) <= 1));
  });
