const test = require('node:test');
const assert = require('node:assert/strict');
const Ink = require('..');

const kit = Ink.load();
const { graphImages: I, materialChannels: M, scanProcessing: S } = kit.KIT.procedural;
const im = (width, height, channels, data, descriptor) =>
  I.declare({ width, height, channels, data: Float32Array.from(data) }, descriptor);
const scalar = (w, h, data, extra = {}) => im(w, h, 1, data, { intent: 'data', ...extra });
const height = (w, h, data) => im(w, h, 1, data, { intent: 'height', units: 'mm', pixelPitchMm: [.2, .2] });
const rgb = (w, h, data, extra = {}) => im(w, h, 3, data, { intent: 'color', colorSpace: 'srgb-linear', ...extra });
const normals = (w, h, data, extra = {}) => im(w, h, 3, data, { intent: 'normal', ...extra });
const colors = luma => luma.flatMap(x => [x, x * .75, x * .4]);
const image = (packet, name) => M.channel(packet, name).raster;
const samples = (packet, name) => [...image(packet, name).raster.data];
function near(a, b, tolerance = 2e-6) {
  assert.equal(a.length, b.length);
  a.forEach((n, i) => assert(Math.abs(n - b[i]) <= tolerance, n + ' vs ' + b[i] + ' at ' + i));
}

test('independent registration uses the same target grid and transports image-frame tangent normals', () => {
  const w = 3, h = 3, amount = [.12, .18, .24, .28, .34, .4, .44, .52, .6];
  const target = [[0, 0], [2, 0], [2, 2], [0, 2]];
  const rotate = ([x, y]) => [2 - y, x], shift = ([x, y]) => [x + 1, y];
  const rotateLandmarks = target.map(p => ({ target: p, source: rotate(p) }));
  const cropLandmarks = target.map(p => ({ target: p, source: shift(p) }));
  const relief = amount.flatMap((n, i) => i % 3 === 0 ? [-99, n * 3] : [n * 3]);
  const normal = amount.flatMap(() => [.6, 0, .8]);
  const source = M.pack({
    baseColor: rgb(w, h, colors(amount)), height: height(4, h, relief), normal: normals(w, h, normal),
    roughness: scalar(w, h, amount)
  }, { height: { label: 'Laser relief' } });
  const result = S.process(source, { align: { pixelPitchMm: [.2, .2], normalFrame: 'image',
    perChannel: { height: cropLandmarks, normal: rotateLandmarks } } });
  near(samples(result.aligned, 'height'), amount.map(n => n * 3));
  near(samples(result.aligned, 'roughness'), amount);
  near(samples(result.aligned, 'normal').slice(0, 3), [0, .6, .8]);
  assert.equal(result.report.alignment[1].landmarks, 4);
  assert.equal(result.report.alignment[2].maxPx, 0);
  assert.deepEqual(image(result.aligned, 'normal').descriptor.pixelPitchMm, [.2, .2]);
  assert.deepEqual(result.value.channels.height.metadata, { label: 'Laser relief' });
});

test('colored measured illumination is divided before filtered registration and preserves all geometry maps', () => {
  const target = [[0, 0], [1, 0], [1, 1], [0, 1]];
  const nd = [[.5, 0], [1.5, 0], [1.5, 1], [.5, 1]];
  const irradiance = [1, .75, .5, .3, .7, .99, .88, 1.21, 1.62];
  const conditions = [...irradiance, ...irradiance];
  const trueColor = [.28, .45, .18, .63, .21, .46, .18, .58, .66];
  const values = [...trueColor, ...trueColor];
  const source = M.pack({ baseColor: rgb(3, 2, conditions.map((n, i) => n * values[i])),
    height: height(3, 2, [0, .1, .2, 0, .1, .2]) });
  const result = S.process(source, { align: { width: 2, height: 2,
    landmarks: target.map((p, i) => ({ target: p, source: nd[i] })) } }, null, rgb(3, 2, conditions));
  const a = trueColor.slice(0, 6), b = trueColor.slice(3);
  near(samples(result.delit, 'baseColor').slice(0, 6), a.map((n, i) => (n + b[i]) / 2));
  assert.strictEqual(result.delit.channels.height, result.aligned.channels.height);
  assert.notDeepEqual(samples(result.aligned, 'baseColor'), samples(result.delit, 'baseColor'));
  assert.equal(result.report.deLight.skipped, 0);
});

test('defects and missing light use one repair donor for pigment, relief, normals and roughness', () => {
  const amount = [.12, .18, .24, .28, .34, .4, .44, .52, .6];
  const component = [[.6, 0, .8], [0, .6, .8], [0, 0, 1]];
  const source = M.pack({ baseColor: rgb(3, 3, colors(amount)),
    height: height(3, 3, amount.map(n => n * 4)),
    normal: normals(3, 3, amount.flatMap((_, i) => component[i % 3])),
    roughness: scalar(3, 3, amount.map(n => n / 2)) });
  const defects = scalar(3, 3, amount.map((_, i) => Number(i === 4)));
  const illumination = scalar(3, 3, amount.map((_, i) => i === 8 ? .001 : 1));
  const result = S.process(source, {}, defects, illumination);
  assert.equal(result.report.repair.repaired, 2);
  assert.equal(result.report.deLight.skipped, 1);
  const raw = samples(result.delit, 'height'), repaired = samples(result.repaired, 'height');
  const donor = raw.indexOf(repaired[4]);
  assert.notEqual(donor, 4);
  for (const name of ['baseColor', 'normal', 'roughness']) {
    const lanes = image(result.repaired, name).raster.channels;
    near(samples(result.repaired, name).slice(4 * lanes, 5 * lanes),
      samples(result.delit, name).slice(donor * lanes, (donor + 1) * lanes));
  }
  assert.equal(result.repairedMask.raster.data[4], 1);
  assert.equal(result.support.raster.data[8], 0);
  const padded = S.process(source, { repair: { padding: 1 } }, defects, illumination);
  assert.equal(padded.report.repair.repaired, 6);
  assert.equal(padded.repairedMask.raster.data[1], 1);
  assert.equal(padded.repairedMask.raster.data[0], 0);
  assert.throws(() => S.process(source, { repair: { radius: 0 }, tile: {} }, defects, illumination), /unresolved defects/);
  const retained = S.process(source, { repair: { radius: 0 }, tile: { crop: [0, 0, 3, 2] } }, null, illumination);
  assert.equal(retained.value.channels.roughness.raster.raster.height, 2);
  assert.equal(retained.unresolved.raster.data[8], 1);
});

test('tile seams share a crop and preserve height-linked and measured residual normals', () => {
  const w = 8, h = 7, step = [.2, .2];
  const z = height(w, h, Array.from({ length: w * h }, (_, i) => (i % w) * .03 + Math.floor(i / w) * .04));
  const geometric = I.normals.heightToNormal(z, { method: 'central' });
  const color = rgb(w, h, colors([...z.raster.data].map(n => .2 + n)));
  const roughness = scalar(w, h, [...z.raster.data]);
  const source = M.pack({ baseColor: color, height: z, normal: geometric, roughness });
  const result = S.process(source, { align: { pixelPitchMm: step }, tile: { band: 2 } });
  for (const name of ['baseColor', 'height', 'roughness']) {
    assert(result.report.tile.seams[name].before > .01);
    assert(result.report.tile.seams[name].after < 1e-7);
    assert.deepEqual(image(result.value, name).descriptor.tiling, { u: 'wrap', v: 'wrap' });
  }
  assert.equal(result.report.tile.normalMode, 'height-detail');
  const next = I.normals.heightToNormal(image(result.value, 'height'), { method: 'central' });
  near(samples(result.value, 'normal'), [...next.raster.data]);
  const perturbed = I.normals.normalRotate(geometric, { axis: [1, 0, 0], degrees: 12 });
  const withDetail = S.process(M.replace(source, { normal: perturbed }), { tile: { band: 2 } });
  assert.notDeepEqual(samples(result.value, 'normal'), samples(withDetail.value, 'normal'));
  const crop = S.process(source, { align: { pivot: [3, 3] }, tile: { crop: [1, 1, 6, 4], axes: 'u', strength: 0 } });
  assert.deepEqual(image(crop.value, 'normal').raster.pivot, [2, 2]);
  assert.deepEqual(image(crop.value, 'height').descriptor.tiling, { u: 'wrap', v: 'clamp' });
});

test('editable graphs expose processing stages and support valid per-map evidence only', () => {
  const graph = Ink.createGraphProject(Ink.openMaterialGraph({
    format: 'ink-studio/graph-project', version: 1,
    inputs: { scan: 'materialChannels' },
    nodes: { process: { op: 'material.scanProcess', inputs: { source: { input: 'scan' } } } },
    outputs: { value: { node: 'process' }, support: { node: 'process', port: 'support' } }
  }, { id: 'scan-test' }), { kit });
  const scan = M.pack({ baseColor: rgb(2, 2, colors([.25, .4, .3, .5])) });
  assert.equal(graph.plan().outputs.value.type, 'materialChannels');
  assert.deepEqual([...graph.run({ inputs: { scan } }).outputs.support.raster.data], [1, 1, 1, 1]);
  assert.throws(() => S.process(scan, {}, null, scalar(3, 2, [1, 1, 1, 1, 1, 1])), /aligned to the source/);
  assert.throws(() => S.process(scan, {}, null, null, { height: scalar(2, 2, [1, 1, 1, 1]) }), /identify supplied/);
  const low = S.process(scan, {}, null, null, { baseColor: scalar(2, 2, [1, 0, 1, 1]) });
  assert.equal(low.report.repair.repaired, 1);
  const constant = S.process(M.replace(scan, { roughness: scalar(1, 1, [.6]) }));
  near(samples(constant.value, 'roughness'), [.6, .6, .6, .6]);
  assert.equal(constant.report.alignment.at(-1).constant, true);
});
