/* Tideglass. Reproducible planar captures, an editable graph, and a relit scan carrier. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Ink = require('../..');
const PNG = require('../../cli/png.js');
const files = require('../../cli/asset-files.js');
const Swatch = require('./swatch.cjs');
const P = Ink.load().KIT.procedural;
const dir = path.resolve(process.argv[2] ?? 'studio/out/measured-materials');
const at = name => path.join(dir, name);
const { width, height, pitch, plate } = Swatch, count = width * height;
const clamp = n => Math.max(0, Math.min(1, n));
const display = require('../../src/color-space.js').prepare('srgb-linear', 'srgb');
const rgb = v => display(v).map(n => Math.round(clamp(n) * 255));
const ref = (node, port = 'value') => ({ node, port });
const op = (op, inputs) => ({ op, inputs });
const assets = {}, nodes = {};
const palette = (data, w, h) => {
  const out = new Uint8Array(w * h * 4);
  for (let i = 0; i < out.length; i += 4) out.set([...rgb([...data.subarray(i, i + 3)]), Math.round(255 * clamp(data[i + 3]))], i);
  return out;
};
function image(data, w, h, channels, descriptor) {
  return P.graphImages.declare({ width: w, height: h, channels, data }, descriptor);
}
function asset(name, w, h, data, descriptor, encoding) {
  const channels = data.length / (w * h);
  const texture = Ink.encodeTexture(image(data, w, h, channels, descriptor), { encoding });
  assets[name] = { format: 'bitmap', source: { encoding, base64: texture.toString('base64') }, interpretation: descriptor };
  nodes[name] = op('bitmapAsset', { name });
  return ref(name);
}
function rgba(name, width, height, pixels) {
  files.write(at(name), PNG.encode(width, height, pixels, 4));
  return name;
}

async function run() {
  const captures = Swatch.poses.map(Swatch.observation);
  const captureTable = {};
  for (const [index, view] of captures.entries()) {
    const { id, width: w, height: h } = view;
    const scalar = (field, data) => asset(id + '-' + field, w, h, data, { intent: 'mask' }, 'png');
    const color = asset(id + '-color', w, h, view.color, { intent: 'color', colorSpace: 'srgb-linear' }, 'exr');
    const height = asset(id + '-height', w, h, view.relief, { intent: 'height', units: 'mm' }, 'exr');
    const capture = { id, color, height, reliefMask: scalar('relief-mask', view.mask), coverage: scalar('coverage', view.coverage),
      roughness: index === 0 ? scalar('roughness', view.roughness) : undefined, lighting: view.lighting,
      calibration: view.calibration, clipLevel: 1.245, ...(index && { landmarks: view.landmarks }) };
    if (capture.roughness === undefined) delete capture.roughness;
    nodes[id] = op('data.record', capture);
    captureTable[id] = ref(id);
    rgba('views/' + id + '.png', w, h, palette(view.color, w, h));
  }
  nodes.table = op('data.record', captureTable);
  nodes.captures = op('data.collect', { source: ref('table'), keys: Object.keys(captureTable) });
  nodes.measured = op('material.measure', { captures: ref('captures'), settings: { width, height, pixelPitchMm: [pitch, pitch],
    reliefToleranceMm: .07, pigmentTolerance: .105 } });
  const graph = { format: 'ink-studio/graph-project', version: 1, assets, nodes,
    outputs: { maps: ref('measured'), report: ref('measured', 'report') },
    exports: { tideglass: { output: 'maps', format: 'texture', options: { encoding: 'exr', bitDepth: 32 } },
      measurements: { output: 'report', format: 'json' } } };
  const material = Ink.openMaterialGraph(graph, { id: 'tideglass' });
  material.label = 'Tideglass';
  const saved = Ink.writeMaterialGraph(at('tideglass.material.json'), material);
  const evaluated = Ink.createGraphProject(saved).run();
  for (const { file, bytes } of evaluated.artifacts) files.write(at(file), bytes);
  const { maps, report } = evaluated.outputs;
  const source = name => P.materialChannels.channel(maps, name).raster.raster.data;
  const pigment = source('baseColor'), relief = source('height'), normals = source('normal');
  const confidence = source('mask.relief-confidence'), pigmentConfidence = source('mask.pigment-confidence');
  const paint = palette(pigment, width, height);
  rgba('views/pigment.png', width, height, paint);
  function field(name, mapper) {
    const pixels = new Uint8Array(count * 4);
    for (let p = 0; p < count; p++) pixels.set([...mapper(p), paint[p * 4 + 3]], p * 4);
    rgba('views/' + name + '.png', width, height, pixels);
  }
  field('height', p => {
    const q = clamp((relief[p] + .48) / 1.78);
    return [Math.round(49 + 199 * q), Math.round(39 + 163 * q), Math.round(69 + 77 * q)];
  });
  field('normals', p => [...normals.subarray(p * 3, p * 3 + 3)].map(n => Math.round((n + 1) * 127.5)));
  function confidenceColors(n) {
    return [Math.round(211 - 113 * n), Math.round(77 + 126 * n), Math.round(97 + 88 * n)];
  }
  field('relief-confidence', p => confidenceColors(confidence[p]));
  field('pigment-confidence', p => confidenceColors(pigmentConfidence[p]));

  const depths = new Float32Array(count), renderNormal = new Uint8Array(count * 4);
  for (let p = 0; p < count; p++) {
    if (paint[p * 4 + 3] && confidence[p]) depths[p] = 3 - relief[p] * .016;
    renderNormal.set([...normals.subarray(p * 3, p * 3 + 3)].map(n => Math.round((n + 1) * 127.5)), p * 4);
    renderNormal[p * 4 + 3] = 255;
  }
  const captured = palette(captures[0].color, width, height);
  const scan = await Ink.scanToMesh({ width, height, depth: depths, maxDepthJump: .04,
    camera: { type: 'orthographic', height: height * pitch * .016 }, image: { width, height, channels: 4, data: captured } },
  { name: 'Tideglass ceramic', meshStride: 2, sampleStride: 2, residualLimit: 0, materials: {
    diffuse: { width, height, channels: 4, data: paint }, normal: renderNormal,
    roughness: Uint8Array.from(source('roughness'), n => Math.round(255 * n)), captured: true,
    daylight: { ambient: .48, light: [-.39, .35, .87], specular: .21 }
  } });
  files.write(at('artifacts/tideglass.glb'), scan.glb);
  const world = await scan.world(), angle = [-75, -55, -35, -15, 5, 25, 45, 65, 85];
  for (const [index, degrees] of angle.entries()) {
    const a = degrees * Math.PI / 180, x = .7 * Math.sin(a), z = .74 * Math.cos(a) + .17;
    const frame = Ink.render(world, { w: 424, h: 312, px: 1, raw: true, ortho: true, yaw: -.18, pitch: .23,
      target: [0, 0, -3], dist: 1.35, scanDaylight: true, passes: ['coverage'],
      areaLights: [{ id: 'review', shape: 'disk', at: [x, .34, -3 + z], normal: [-x, -.34, -z],
        size: [.19, .19], color: '#ffe2b4', radius: 1.6, intensity: 2.4, sampleGrid: 1, visible: false, shadows: false }] });
    const pixels = new Uint8Array(frame.w * frame.h * 4);
    for (let p = 0; p < frame.w * frame.h; p++)
      pixels.set([...frame.rgb.subarray(p * 3, p * 3 + 3), frame.passes.coverage[p] ? 255 : 0], p * 4);
    rgba('views/light-' + index + '.png', frame.w, frame.h, pixels);
  }

  const exr = at('artifacts/tideglass.exr');
  assert.deepEqual(Ink.readTexture(exr, { channels: ['height'] }).data, relief);
  assert.deepEqual(Ink.readTexture(exr, { channels: ['mask.relief-confidence'] }).data, confidence);
  assert(report.reliefDisagreements > 0 && report.rejectedPigmentSamples > 0);
  const error = { captured: 0, recovered: 0, samples: 0 };
  for (let y = 2, p = 2 * width + 2; y < height - 2; y++, p += 4) for (let x = 2; x < width - 2; x++, p++) {
    const truth = plate(x, y);
    if (truth.alpha < 1 || confidence[p] < .65 || pigmentConfidence[p] < .65) continue;
    for (let c = 0; c < 3; c++) {
      error.captured += (captures[0].color[p * 4 + c] - truth.color[c]) ** 2;
      error.recovered += (pigment[p * 4 + c] - truth.color[c]) ** 2;
      error.samples++;
    }
  }
  error.captured = Math.sqrt(error.captured / error.samples);
  error.recovered = Math.sqrt(error.recovered / error.samples);
  assert(error.samples > count && error.recovered < error.captured * .45, JSON.stringify(error));
  const data = { width, height, angle, report, error, scan: scan.report.material,
    probe: { at: [121, 106], height: relief[106 * width + 121], confidence: confidence[106 * width + 121] } };
  files.json(at('verification.json'), data);
  files.write(at('data.js'), 'const review = ' + JSON.stringify(data) + ';\n');
  for (const file of ['index.html', 'live.js']) {
    files.write(at(file), fs.readFileSync(path.join(__dirname, file)));
  }
  console.log('Wrote Tideglass to', dir, 'with linear pigment RMSE', error.captured.toFixed(4), '→', error.recovered.toFixed(4));
}
run().catch(error => { console.error(error); process.exitCode = 1; });
