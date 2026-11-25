const assert = require('node:assert/strict');
const test = require('node:test');
const Ink = require('..');
const { graphImages: I, geometry } = Ink.load().KIT.procedural;
const M = I.morphology;
const scalar = (width, height, data, settings = {}, pivot) =>
  I.declare({ width, height, channels: 1, data, pivot }, { intent: 'mask', ...settings });
const values = image => Array.from(image.raster.data);
const link = (node, port = 'value') => ({ node, port });
const op = (op, inputs) => ({ op, inputs });

function brute(x, y, width, height, occupied, wrap, target) {
  const candidates = [];
  for (let sy = 0; sy < height; sy++) for (let sx = 0; sx < width; sx++) {
    if (occupied[sy * width + sx] !== target) continue;
    for (const tx of wrap[0] ? [-width, 0, width] : [0]) for (const ty of wrap[1] ? [-height, 0, height] : [0]) {
      const u = sx + tx, v = sy + ty;
      candidates.push({ u, v, site: sy * width + sx, squared: (u - x) ** 2 + (v - y) ** 2 });
    }
  }
  return candidates.sort((a, b) => a.squared - b.squared || a.v - b.v || a.u - b.u)[0];
}

test('periodic Euclidean distances and original owners match brute force on either axis', () => {
  for (const [width, height] of [[5, 4], [4, 5], [1, 5], [4, 1]]) {
    for (const wrap of [[false, false], [true, false], [false, true], [true, true]]) {
      const mask = Array.from({ length: width * height }, (_, i) => Number((i * 11 + width + height) % 7 > 4));
      const result = geometry.distanceTransform(mask, { size: [width, height], signed: true, wrap });
      for (let p = 0; p < mask.length; p++) {
        const expected = brute(p % width, Math.floor(p / width), width, height, mask, wrap, 1 - mask[p]);
        assert.equal(result.distance[p], (mask[p] ? -1 : 1) * Math.sqrt(expected?.squared ?? Infinity));
        assert.equal(result.nearest[p], expected?.site ?? -1);
      }
    }
  }
  const last = Array.from({ length: 24 }, (_, i) => Number(i === 23));
  const volume = geometry.distanceTransform(last, { size: [4, 3, 2], spacing: [1, 2, 3], wrap: true });
  assert.equal(volume.distance[0], Math.sqrt(14));
  assert.equal(volume.nearest[0], 23);
  assert.throws(() => geometry.distanceTransform([1, 0], { size: [2, 1], wrap: [true] }), /bounded binary/);
});

test('typed distance uses pixel or aspect-preserving normalized units and reports caps and missing seeds', () => {
  const features = scalar(4, 2, [1, 0, 0, 0, 0, 0, 0, 0], { tiling: { u: 'wrap' }, pixelPitchMm: [.5, .25] }, [.5, 1]);
  const result = M.distance(features);
  assert.deepEqual(values(result.value), [0, 1, 2, 1, 1, Math.SQRT2, Math.sqrt(5), Math.SQRT2]);
  assert.equal(result.value.descriptor.units, 'art-px');
  assert.deepEqual(values(result.nearest), Array(16).fill(0));
  assert.deepEqual(values(result.valid), Array(8).fill(255));
  const normalized = M.distance(features, { units: 'normalized', precision: 'float32', maxDistance: .6 });
  assert.equal(normalized.value.descriptor.units, 'normalized');
  assert.deepEqual(values(normalized.value), [0, .5, Math.fround(.6), .5, .5, Math.fround(.6), Math.fround(.6), Math.fround(.6)]);
  assert.deepEqual(values(normalized.nearest), values(result.nearest));
  assert.deepEqual(normalized.value.raster.pivot, [.5, 1]);
  assert.deepEqual(normalized.value.descriptor.pixelPitchMm, [.5, .25]);
  const empty = M.distance(scalar(2, 1, [0, 0]), { maxDistance: 9 });
  assert.deepEqual(values(empty.value), [9, 9]);
  assert.deepEqual(values(empty.nearest), [-1, -1, -1, -1]);
  assert.deepEqual(values(empty.valid), [0, 0]);
  assert.throws(() => M.distance(features, { units: 'percent' }), /normalized units/);
  assert.throws(() => M.distance(features, { precision: 'unorm16' }), /float32/);
});

test('nearest propagation retains exact typed source codes and follows both periodic seams', () => {
  const seeds = scalar(4, 2, [0, 0, 0, 1, 0, 0, 0, 1], { tiling: { u: 'wrap' } });
  const red = [30001, 1, 0, 32001], blue = [2, 0, 30002, 32002];
  const paint = I.declare({ width: 4, height: 2, channels: 4, data: [...Array(12).fill(0), ...red,
    ...Array(12).fill(0), ...blue] }, { intent: 'color', precision: 'unorm16', alpha: 'premultiplied' });
  const nearest = M.distance(seeds).nearest;
  assert.deepEqual(values(nearest).slice(0, 2), [3, 0]);
  const filled = M.propagate(paint, nearest);
  assert.deepEqual(values(filled), [...red, ...red, ...red, ...red, ...blue, ...blue, ...blue, ...blue]);
  assert.deepEqual(filled.descriptor, paint.descriptor);
  assert(I.valid(filled));
  const noSites = M.distance(scalar(4, 2, Array(8).fill(0))).nearest;
  assert.deepEqual(values(M.propagate(paint, noSites)), values(paint));
  const wrong = I.uniform([3.25, 0], 4, 2, { intent: 'data', layout: 'rg', units: 'art-px' });
  assert.throws(() => M.propagate(paint, wrong), /Invalid nearest-seed coordinate/);
});

test('signed distances, dilation, erosion and outline distinguish wrapped and open borders', () => {
  const full = scalar(3, 3, Array(9).fill(1));
  assert.deepEqual(values(M.signedDistance(full, { border: 'wrap', maxDistance: 5 })), Array(9).fill(-5));
  assert.deepEqual(values(M.signedDistance(full, { border: { u: 'wrap', v: 'transparent' } })),
    [-1, -1, -1, -2, -2, -2, -1, -1, -1]);
  assert.deepEqual(values(M.erode(full, { border: 'transparent' })), [0, 0, 0, 0, 1, 0, 0, 0, 0]);
  assert.deepEqual(values(M.erode(full, { border: 'wrap', radius: 10 })), Array(9).fill(1));
  const corner = scalar(3, 3, [1, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(values(M.dilate(corner, { border: 'wrap' })), [1, 1, 1, 1, 0, 0, 1, 0, 0]);
  const radius = Math.SQRT2 / 3;
  assert.deepEqual(values(M.dilate(corner, { border: 'wrap', radius, units: 'normalized' })), Array(9).fill(1));
  const outline = M.outline(corner, { outer: 1, inner: 1, feather: 2, border: 'wrap' });
  assert.equal(outline.inner.raster.data[0], .5);
  assert.equal(outline.outer.raster.data[2], .5);
  assert.equal(outline.value.raster.data[0], .5);
  assert(outline.outer.raster.data[8] < .5 && outline.outer.raster.data[8] > 0);
  assert.deepEqual(values(M.outline(full, { border: 'wrap', inner: 10 }).value), Array(9).fill(0));
});

test('Sobel and Scharr measure wrapped edges and respect typed alpha selection', () => {
  const source = scalar(4, 1, [1, 0, 0, 0]);
  const wrapped = M.edgeDetect(source, { border: 'wrap', threshold: .2, softness: .3 });
  assert.deepEqual(values(wrapped.magnitude), [0, .5, 0, .5]);
  assert.deepEqual(values(wrapped.value), [0, 1, 0, 1]);
  assert.deepEqual(values(M.edgeDetect(source, { method: 'scharr', border: 'clamp' }).magnitude), [.5, .5, 0, 0]);
  const color = I.declare({ width: 3, height: 1, channels: 4, data: [1, 0, 0, 1, 1, 0, 0, 0, 1, 0, 0, 0] },
    { intent: 'color' });
  assert.deepEqual(values(M.dilate(color)), [1, 1, 0]);
  assert.deepEqual(values(M.edgeDetect(color, { border: 'wrap' }).magnitude), [0, .5, .5]);
  assert.equal(M.edgeDetect(color, { border: 'wrap', precision: 'unorm16' }).value.raster.data[2], 65535);
});

test('an editable material graph reuses nearest owners for source propagation and signed distance exports', () => {
  const graph = Ink.createGraphProject(Ink.openMaterialGraph({
    format: 'ink-studio/graph-project', version: 1, nodes: {
      source: op('image.uniform', { width: 2, height: 1, value: [1, .25, .5],
        descriptor: { intent: 'color', precision: 'unorm16' } }),
      seeds: op('image.declare', { source: { width: 2, height: 1, channels: 1, data: [1, 0] }, descriptor: { intent: 'mask' } }),
      distance: op('image.distance', { source: link('seeds') }),
      signed: op('image.signedDistance', { source: link('seeds') }),
      painted: op('image.propagate', { source: link('source'), nearest: link('distance', 'nearest') })
    }, outputs: { painted: link('painted'), signed: link('signed') },
    exports: { signed: { output: 'signed', format: 'json' } }
  }, { id: 'material-morphology' }));
  const result = graph.run();
  assert.equal(graph.plan().outputs.painted.type, 'colorImage');
  assert.deepEqual(values(result.outputs.painted), [65535, 16384, 32768, 65535, 16384, 32768]);
  assert.deepEqual(JSON.parse(result.artifacts[0].bytes).raster.data, [-1, 1]);
});
