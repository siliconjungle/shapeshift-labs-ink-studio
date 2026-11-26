const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const Ink = require('..');

const kit = Ink.load();
const { materialValidation: V, graphImages: I, materialChannels: M } = kit.KIT.procedural;
const link = (node, port = 'value') => ({ node, port });
const input = input => ({ input });
const op = (op, inputs) => ({ op, inputs });
const pixel = (width, height, lanes, data, descriptor) =>
  I.declare({ width, height, channels: lanes, data }, descriptor);
const finding = (result, name, code) => result.report.findings.find(row => row.channel === name && row.code === code);

test('range, convention, layout, finite samples and wide-gamut delivery are independent checks', () => {
  const pigment = pixel(2, 1, 3, Float32Array.of(.2, .3, .4, 0, 1, 0),
    { intent: 'color', colorSpace: 'display-p3-linear' });
  const normal = pixel(2, 1, 3, Float32Array.of(0, 0, .5, 0, 0, -1),
    { intent: 'normal', normalSpace: 'tangent', normalOrientation: 'directx' });
  const height = pixel(2, 1, 1, Float32Array.of(.02, 70000), { intent: 'height', units: 'mm' });
  const invalid = { width: 2, height: 1, channels: 1, data: Float32Array.of(NaN, 1.4) };
  const result = V.inspect({ baseColor: pigment, normal, height, roughness: invalid }, {
    required: ['metalness'], maps: {
      baseColor: { delivery: { format: 'png', bitDepth: 16 } },
      normal: { normalOrientation: 'opengl' }, height: { range: [0, 4], delivery: { format: 'exr', bitDepth: 16 } }
    }
  }, { preview: true });
  assert.equal(result.report.valid, false);
  assert.equal(finding(result, 'baseColor', 'physical-range'), undefined);
  assert.deepEqual(finding(result, 'baseColor', 'delivery-clipping').bounds, [1, 0, 1, 0]);
  assert.deepEqual([...result.rasters.baseColor.masks['baseColor:delivery-clipping']], [0, 1]);
  assert.deepEqual(finding(result, 'roughness', 'nonfinite').examples[0].values, ['NaN']);
  assert.deepEqual(finding(result, 'normal', 'convention').details, [
    { field: 'normalOrientation', expected: 'opengl', actual: 'directx' }
  ]);
  assert.equal(finding(result, 'normal', 'normal-length').count, 1);
  assert.equal(finding(result, 'normal', 'normal-hemisphere').severity, 'warning');
  assert.equal(finding(result, 'height', 'delivery-clipping').count, 1);
  assert.equal(finding(result, 'metalness', 'missing').severity, 'error');
});

test('valid HDR emission passes while its bounded display preview is noted', () => {
  const emission = pixel(2, 1, 3, Float32Array.of(1.6, .1, .1, .11, .12, .13),
    { intent: 'color', colorSpace: 'srgb-linear' });
  const result = V.inspect(M.pack({ emission }), { maps: { emission: { delivery: { format: 'exr' } } } });
  assert.equal(result.report.valid, true);
  assert.equal(finding(result, 'emission', 'preview-clipping').count, 1);
  assert.equal(finding(result, 'emission', 'physical-range'), undefined);
});

const paintDoc = invalid => ({
  format: 'ink-studio/material-paint', version: 1,
  layers: [{ id: 'lamp', label: 'Lantern highlights', channel: 'baseColor',
    strokes: [{ space: 'texel', brush: { radius: 2 }, samples: [[2, 2]],
      value: invalid ? [1] : [1.6, .2, .06], colorSpace: 'srgb-linear' }] }]
});
function graphSource(invalid = false) {
  return {
    format: 'ink-studio/graph-project', version: 1,
    groups: { Finish: {
      inputs: { original: 'materialChannels' },
      nodes: { finish: op('material.paint', { source: input('original'), session: paintDoc(invalid) }) },
      outputs: { value: link('finish') }
    } },
    nodes: {
      base: op('image.uniform', { width: 6, height: 6, value: [.25, .3, .2],
        descriptor: { intent: 'color', precision: 'unorm8', colorSpace: 'srgb' } }),
      scratch: op('image.uniform', { width: 6, height: 6, value: [1.3, .2, .1],
        descriptor: { intent: 'color', precision: 'float32', colorSpace: 'srgb-linear' } }),
      display: op('image.convert', { source: link('scratch'), descriptor: {
        intent: 'color', precision: 'unorm8', colorSpace: 'srgb' }, outOfRange: 'clamp' }),
      polish: op('image.uniform', { width: 6, height: 6, value: .8, descriptor: { intent: 'data' } }),
      overdrive: op('image.channelMath', { a: link('polish'), b: .4, operation: 'add' }),
      maps: op('data.record', { baseColor: link('base'), roughness: link('overdrive'), emission: link('display') }),
      material: op('material.pack', { maps: link('maps') }),
      craft: op('Finish', { original: link('material') })
    },
    outputs: { surface: link('craft') }
  };
}

test('graph review resolves pass-through packs and nested paint layers, including stored clipping', () => {
  const graph = Ink.createGraphProject(graphSource(), { kit });
  graph.run();
  const result = graph.validateMaterial({}, {}, {}, { preview: false });
  assert.equal(result.report.valid, false);
  const paint = finding(result, 'baseColor', 'paint-clipping');
  assert(paint.count >= 1);
  assert.deepEqual(paint.sources[0], { kind: 'brush', node: 'craft/finish', port: 'value', operation: 'material.paint',
    layer: 'lamp', label: 'Lantern highlights', count: paint.count });
  assert.equal(finding(result, 'roughness', 'physical-range').sources[0].node, 'overdrive');
  assert.equal(finding(result, 'emission', 'conversion-clipping').sources[0].node, 'display');
  const single = graph.validateMaterial({ node: 'craft/finish', channel: 'baseColor' });
  assert.equal(finding(single, 'baseColor', 'paint-clipping').sources[0].node, 'craft/finish');
  assert(single.artifacts.some(row => row.file === 'index.html'));
  assert.equal(graph.inspect({ node: 'craft/finish', port: 'report' }).value.diagnostics, undefined);
});

test('validation identifies the failing brush and node when the graph cannot render', () => {
  const graph = Ink.createGraphProject(graphSource(true), { kit });
  const result = graph.validateMaterial({}, {}, {}, { preview: false });
  const error = result.report.findings[0];
  assert.equal(error.code, 'evaluation');
  assert.equal(error.sources[0].node, 'craft/finish');
  assert.equal(error.sources[0].layer, 'lamp');
});

test('CLI emits a failing receipt and overlay assets without attempting material deliveries', t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-validation-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const source = path.join(folder, 'sample.json'), output = path.join(folder, 'review');
  fs.writeFileSync(source, JSON.stringify(graphSource()));
  const result = spawnSync(process.execPath, [path.join(__dirname, '../cli/ink-studio.js'), 'graph', 'validate-material',
    source, '--out', output], { encoding: 'utf8' });
  assert.equal(result.status, 2, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.target.output, 'surface');
  const clipping = finding({ report }, 'baseColor', 'paint-clipping');
  assert(fs.existsSync(path.join(output, clipping.mask)));
  assert(fs.existsSync(path.join(output, 'index.html')));
});
