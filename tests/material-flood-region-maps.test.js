const test = require('node:test');
const assert = require('node:assert/strict');
const Ink = require('..');
const { KIT } = Ink.load();
const image = KIT.procedural.graphImages;
const { floodRegions, regionMap, regionLookup, valid } = image.regions;

function mask(width, height, coords, spec = {}) {
  const data = new Uint8Array(width * height);
  for (const [x, y] of coords) data[y * width + x] = 255;
  return image.declare({ width, height, channels: 1, data }, { intent: 'mask', ...spec });
}
const raw = value => Array.from(value.raster.data);
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, a + ' differs from ' + b);

test('both wrapped axes produce one compact unwrapped chart for a region at all four corners', () => {
  const source = mask(7, 5, [[0,0], [6,0], [0,4], [6,4]], { tiling: { u: 'wrap', v: 'wrap' }, pixelPitchMm: [.4, .6] });
  const field = floodRegions(source);
  assert.equal(field.regions.length, 1);
  assert.deepEqual(field.regions[0], { id: 1, area: 4, seed: [0,0], bounds: { x: 6, y: 4, width: 2, height: 2 },
    center: [0,0], chartCenter: [7,5], angle: 0, crosses: [true,true], winding: [false,false] });
  assert.equal(field.labels.raster.data[34], 1);
  assert.deepEqual(field.labels.descriptor.pixelPitchMm, [.4,.6]);
  assert.deepEqual(raw(regionMap(field, 'position')).slice(0, 2), [7.5, 5.5]);
  assert.deepEqual(raw(regionMap(field, 'localUV')).slice(0, 2), [.75,.75]);
  assert.deepEqual(raw(regionMap(field, 'localUV')).slice(-2), [.25,.25]);
  const boxes = raw(regionMap(field, 'bounds', { units: 'normalized' }));
  [6/7, 4/5, 2/7, 2/5].forEach((n, i) => near(boxes[i], n));
  assert.deepEqual(raw(regionMap(field, 'area')).filter(Boolean), [4,4,4,4]);
  assert.equal(floodRegions(source, { border: 'clamp' }).regions.length, 4);
  assert.equal(floodRegions(source, { border: { v: 'mirror' } }).regions.length, 2);
});

test('diagonal connections across a corner obey four- versus eight-neighbor connectivity', () => {
  const source = mask(6, 5, [[0,0],[5,4]]);
  const open = floodRegions(source, { border: 'wrap', connectivity: 4 });
  const joined = floodRegions(source, { border: 'wrap', connectivity: 8 });
  assert.equal(open.regions.length, 2);
  assert.equal(joined.regions.length, 1);
  assert.deepEqual(joined.regions[0].bounds, { x: 5, y: 4, width: 2, height: 2 });
  near(joined.regions[0].angle, Math.PI / 4);
  near(regionMap(joined, 'orientation').raster.data[0], Math.PI / 4);
  const gradient = regionMap(joined, 'gradient', { align: 'orientation' }).raster.data;
  assert.equal(gradient[0], 1);
  assert.equal(gradient.at(-1), 0);
  assert.equal(regionMap(open, 'gradient', { angle: 90 }).raster.data[0], .5);
});

test('closed paths around the tile report winding and keep a deterministic chart on other axes', () => {
  const cells = Array.from({ length: 6 }, (_, x) => [x,0]).concat([[0,4],[1,4]]);
  const field = floodRegions(mask(6, 5, cells), { border: 'wrap' });
  const r = field.regions[0];
  assert.deepEqual(r.winding, [true,false]);
  assert.deepEqual(r.crosses, [true,true]);
  assert.deepEqual(r.bounds, { x: 0, y: 4, width: 6, height: 2 });
  assert.equal(r.area, 8);
  near(regionMap(field, 'localUV').raster.data[0], 1/12);
  near(regionMap(field, 'localUV').raster.data[1], .75);
  assert.deepEqual(floodRegions(mask(1, 1, [[0,0]]), { border: 'wrap', connectivity: 8 }).regions[0].winding, [true,true]);
});

test('stable IDs and seeded values ignore the removal or filtering of unrelated regions', () => {
  const a = floodRegions(mask(8, 2, [[0,0],[5,1],[6,1]], { materialSeed: 31 }));
  const b = floodRegions(mask(8, 2, [[5,1],[6,1]], { materialSeed: 31 }));
  const c = floodRegions(mask(8, 2, [[0,0],[5,1],[6,1]], { materialSeed: 31 }), { minArea: 2 });
  assert.deepEqual(a.regions.map(row => row.id), [1,14]);
  assert.deepEqual(raw(b.labels), raw(c.labels));
  const random = field => regionMap(field, 'randomValue').raster.data[13];
  assert.equal(random(a), random(b));
  assert.equal(random(b), random(c));
  assert.notEqual(random(a), regionMap(a, 'randomValue', { seed: 31 + 2 ** 32 }).raster.data[13]);
  const pigment = raw(regionMap(a, 'randomColor', { palette: ['#a42663'] }));
  assert.deepEqual(pigment.slice(52,60), [164,38,99,255,164,38,99,255]);
  assert.deepEqual(pigment.slice(4,8), [0,0,0,0]);
});

test('lookup maps fit a texture across the seam and preserve exact UNORM output samples', () => {
  const field = floodRegions(mask(5, 1, [[0,0],[4,0]], { pixelPitchMm: [.2,.3] }), { border: 'wrap' });
  const texture = image.declare({ width: 2, height: 1, channels: 4, data: Uint16Array.of(100,200,300,65535,1,2,3,65535) },
    { intent: 'color' });
  const mapped = regionLookup(field, texture);
  assert.deepEqual(raw(mapped), [1,2,3,65535,0,0,0,0,0,0,0,0,0,0,0,0,100,200,300,65535]);
  assert.deepEqual(mapped.descriptor.pixelPitchMm, [.2,.3]);
  assert.deepEqual(mapped.descriptor.tiling, { u:'wrap', v:'wrap' });
  const center = raw(regionLookup(field, texture, { coordinates: 'center' }));
  assert.deepEqual(center.slice(0,4), center.slice(-4));
  const seed = raw(regionLookup(field, texture, { coordinates: 'seed' }));
  assert.deepEqual(center, seed);
  const mixed = raw(regionLookup(field, texture, { coordinates: 'center', filter: 'linear', border: { u: 'wrap' } }));
  assert.deepEqual(mixed.slice(0,4), [51,101,152,65535]);
});

test('selection decodes source alpha by default and can threshold another channel explicitly', () => {
  const rgba = image.declare({ width: 4, height: 1, channels: 4, data: Uint16Array.of(
    65535,0,0,65535, 65535,0,0,0, 0,65535,0,32768, 0,0,0,65535) }, { intent: 'color' });
  assert.deepEqual(raw(floodRegions(rgba).labels), [1,0,3,3]);
  assert.deepEqual(raw(floodRegions(rgba, { channel:'r' }).labels), [1,0,0,0]);
  assert.deepEqual(raw(floodRegions(rgba, { channel:'luminance' }).labels), [0,0,3,0]);
  assert.deepEqual(raw(floodRegions(rgba, { invert:true }).labels), [0,2,0,0]);
  assert.equal(regionMap(floodRegions(rgba, { threshold:2 }), 'gradient').raster.data.every(v => v === 0), true);
});

test('label traversal agrees with a reference search for every 3 × 3 mask on every topology', () => {
  const order = Array.from({ length: 9 }, (_, p) => [p % 3, Math.floor(p / 3)]);
  for (const connectivity of [4,8]) for (const u of ['clamp','wrap']) for (const v of ['clamp','wrap']) {
    const steps = order.map(([x,y]) => [x-1,y-1]).filter(([x,y]) => (x || y) && (connectivity === 8 || !x || !y));
    for (let bits = 0; bits < 512; bits++) {
      const selected = p => Boolean(bits & (1 << p)), labels = Array(9).fill(0);
      for (let p = 0; p < 9; p++) {
        if (labels[p] || !selected(p)) continue;
        const open = [p];
        labels[p] = p + 1;
        while (open.length) {
          const [x,y] = order[open.pop()];
          for (const [dx,dy] of steps) {
            const i = u === 'wrap' ? (x + dx + 3) % 3 : x + dx;
            const j = v === 'wrap' ? (y + dy + 3) % 3 : y + dy;
            const k = j * 3 + i;
            if (i < 0 || i > 2 || j < 0 || j > 2 || labels[k] || !selected(k)) continue;
            labels[k] = p + 1;
            open.push(k);
          }
        }
      }
      const field = floodRegions(mask(3,3,order.filter((_,p) => selected(p))), { connectivity, border: {u,v} });
      assert.deepEqual(raw(field.labels), labels);
      assert.equal(valid(field), true);
    }
  }
});

test('a region field round-trips through editable graph exports and rejects mismatched records', () => {
  const link = (node, port = 'value') => ({node,port});
  const graph = { format:'ink-studio/graph-project', version:1,
    nodes: {
      image: { op:'image.declare', inputs:{ source:{width:4,height:1,channels:1,data:[1,0,0,1]},descriptor:{intent:'mask'} } },
      flood: { op:'image.floodRegions', inputs:{ source:link('image'), options:{border:'wrap',seed:15} } },
      map: { op:'image.regionMap', inputs:{source:link('flood'),kind:'randomValue'} }
    }, outputs:{ value:link('map'), field:link('flood'), regions:link('flood','regions') },
    exports:{ field:{output:'field',format:'json'} } };
  const project = Ink.createGraphProject(Ink.openMaterialGraph(graph, {id:'regions'})), result = project.run();
  const stored = JSON.parse(result.artifacts[0].bytes);
  assert.ok(valid(stored));
  assert.deepEqual(raw(regionMap(stored, 'randomValue')), raw(result.outputs.value));
  assert.equal(result.outputs.regions.length, 1);
  stored.labels.raster.data[2] = 2;
  assert.equal(valid(stored), false);
});
