const test = require('node:test');
const assert = require('node:assert/strict');
const Ink = require('..');
const { KIT } = Ink.load();
const P = KIT.procedural, Paint = P.materialPaint;
const uniform = (value, width, height, descriptor) => P.graphImages.uniform(value, width, height, descriptor);
const image = (packet, channel) => P.materialChannels.channel(packet, channel).raster;
const linear = { intent: 'color', layout: 'rgb', precision: 'float32', colorSpace: 'srgb-linear' };
const scalar = { intent: 'data', precision: 'float32' };
const heightSpec = { intent: 'height', units: 'mm', precision: 'float32' };
const document = (layers, settings = {}) => ({ format: Paint.format, version: Paint.version, layers, ...settings });
const layer = (id, channel, strokes, options = {}) => ({ id, channel, strokes, ...options });
const stamp = (at, value, options = {}) => ({ samples: [at], value, brush: { radius: .5 }, ...options });
const get = (packet, name, x, y) => {
  const { width, data, channels } = image(packet, name).raster, offset = (y * width + x) * channels;
  return Array.from(data.subarray(offset, offset + channels));
};

test('large, signed height and HDR color canvases retain native values and channel identity', () => {
  const width = 1152, height = 65;
  const heightMap = uniform(-.027, width, height, heightSpec);
  const emission = uniform([.01, .02, .03], width, height, linear);
  const roughness = uniform(.41, 3, 2, scalar);
  const packet = P.materialChannels.pack({ height: heightMap, emission, roughness }, { height: { uvSet: 1 } });
  const doc = document([
    layer('etch', 'height', [stamp([725, 33], -.441937)]),
    layer('lit', 'emission', [stamp([725, 33], [3.25, 1.75, .18], { symmetry: { mirrorX: 575.5 } })])
  ]);
  const { value, report } = Paint.apply(packet, doc);
  assert.equal(get(value, 'height', 725, 33)[0], Math.fround(-.441937));
  assert.deepEqual(get(value, 'emission', 426, 33), [3.25, 1.75, Math.fround(.18)]);
  assert.equal(get(packet, 'height', 725, 33)[0], Math.fround(-.027));
  assert.equal(value.channels.roughness, packet.channels.roughness);
  assert.equal(value.channels.height.metadata, packet.channels.height.metadata);
  assert.deepEqual(report.channels.height.dirty, [725, 33, 1, 1]);
  assert.equal(report.channels.emission.changed, 2);
  assert.equal(image(value, 'height').descriptor.units, 'mm');
});

test('layers composite in linear light and erase only their own paint', () => {
  const packet = P.materialChannels.pack({
    baseColor: uniform([0, 0, 0, 1], 12, 4, { intent: 'color', layout: 'rgba', colorSpace: 'srgb', precision: 'unorm16' }),
    roughness: uniform(.25, 12, 4, scalar)
  });
  const doc = document([
    layer('bright', 'baseColor', [stamp([6, 2], [1, 1, 1, .5])]),
    layer('inlay', 'roughness', [stamp([6, 2], .75), stamp([7, 2], .75)]),
    layer('gloss', 'roughness', [stamp([6, 2], .2), stamp([7, 2], .1), {
      mode: 'erase', samples: [[6, 2]], brush: { radius: .5 }
    }])
  ]);
  const { value } = Paint.apply(packet, doc);
  assert(Math.abs(get(value, 'baseColor', 6, 2)[0] / 65535 - .73535698) < 2e-5);
  assert.equal(get(value, 'roughness', 6, 2)[0], .75);
  assert.equal(get(value, 'roughness', 7, 2)[0], Math.fround(.1));
});

test('indexed tips, selections, graph masks and world/rest/UV projection route exact texels', () => {
  const width = 768, height = 8;
  const packet = P.materialChannels.pack({ height: uniform(0, width, height, heightSpec) });
  const gate = uniform(.5, width, height, { intent: 'mask', precision: 'float32' });
  const tip = KIT.pixelBrushes.capture({
    width: 1, height: 1, rect: [0, 0, 1, 1], read: () => ({ color: '#ffffff' })
  });
  const projections = {
    pose: { space: 'world', projection: { origin: [50, 0, 0] }, extent: [768, 8] },
    part: { space: 'rest', projection: { origin: [0, 0, 0] }, extent: [768, 8] }
  };
  const paint = layer('marks', 'height', [
    { space: 'world', chart: 'pose', samples: [[651.5, 0, 4.5]], brush: { kind: 'tip', definition: tip }, value: .5,
      selection: { type: 'rectangle', rect: [600, 4, 3, 1] } },
    stamp([610.5, 0, 4.5], .625, { space: 'rest', chart: 'part' }),
    stamp([(620.5) / width, 4.5 / height], .875, { space: 'uv' }),
    stamp([(630.5) / width, 4.5 / height], 1, { space: 'uv',
      selection: { type: 'rectangle', rect: [600, 4, 2, 1] } })
  ], { mask: 'graph-gate' });
  const { value } = Paint.apply(packet, document([paint], { charts: projections }), { masks: { 'graph-gate': gate } });
  assert.equal(get(value, 'height', 601, 4)[0], .25);
  assert.equal(get(value, 'height', 610, 4)[0], .3125);
  assert.equal(get(value, 'height', 620, 4)[0], .4375);
  assert.equal(get(value, 'height', 630, 4)[0], 0);
});

test('flow maps steer elongated dabs and symmetric flow painting reflects vector directions', () => {
  const width = 36, height = 24;
  const packet = P.materialChannels.pack({
    height: uniform(0, width, height, heightSpec),
    flow: uniform([0, 0], width, height, { ...scalar, layout: 'rg', units: 'uv/s' })
  });
  const field = KIT.flowMap.create({ width: 1, height: 1, bounds: [0, 0, 1, 1] });
  field.stroke({ points: [[.5, .5]], radius: 1, direction: [0, 1] });
  const doc = document([
    layer('bristles', 'height', [stamp([8, 11], .3, { brush: { radius: 5, aspect: .25, hardness: 1 }, flow: 'vertical' })]),
    layer('flow', 'flow', [{ samples: [[4, 14], [12, 14]], velocity: 'stroke', speed: .4,
      brush: { radius: 1, hardness: 1 }, symmetry: { mirrorX: 17.5 } }])
  ]);
  const { value } = Paint.apply(packet, doc, { flows: { vertical: field.asset() } });
  assert.equal(get(value, 'height', 8, 14)[0], Math.fround(.3));
  assert.equal(get(value, 'height', 11, 11)[0], 0);
  assert.deepEqual(get(value, 'flow', 7, 14), [Math.fround(.4), 0]);
  assert.deepEqual(get(value, 'flow', 28, 14), [Math.fround(-.4), 0]);
});

test('a paint editor commits atomically, undoes, and saves a replayable graph document', () => {
  const packet = P.materialChannels.pack({ emission: uniform([0, 0, 0], 8, 8, linear) });
  const editor = Paint.create(packet, document([layer('glass', 'emission', [])]));
  editor.stroke('glass', stamp([3, 4], [2, .5, 1]));
  const committed = editor.snapshot();
  assert.throws(() => editor.stroke('glass', stamp([9, 4], [1, 1, 1])), /outside/);
  assert.deepEqual(editor.snapshot(), committed);
  editor.editLayer('glass', { locked: true });
  assert.throws(() => editor.stroke('glass', stamp([1, 1], [1, 1, 1])), /locked/);
  editor.undo();
  editor.undo();
  assert.equal(editor.preview().value, packet);
  assert(editor.redo());

  const graph = { format: 'ink-studio/graph-project', version: 1,
    inputs: { source: 'materialChannels', session: { type: 'record', default: editor.snapshot() } },
    nodes: { painted: { op: 'material.paint', inputs: { source: { input: 'source' }, session: { input: 'session' } } } },
    outputs: { value: { node: 'painted' } } };
  const saved = JSON.parse(JSON.stringify(Ink.openMaterialGraph(graph, { id: 'glass' })));
  assert.deepEqual(get(Ink.createGraphProject(saved).run({ inputs: { source: packet } }).outputs.value, 'emission', 3, 4),
    [2, .5, 1]);
});


test('normal painting preserves encoding and alpha and mirrors tangent directions', () => {
  const width = 24, height = 4;
  const base = uniform([.5, .5, 1, 1], width, height, {
    intent: 'normal', layout: 'xyza', precision: 'unorm16', normalSpace: 'tangent', normalOrientation: 'directx'
  });
  const packet = P.materialChannels.pack({ normal: base });
  const paint = document([layer('grain', 'normal', [stamp([6, 1], [.6, .3, .74, .75],
    { symmetry: { mirrorX: 11.5 } })])], { canvases: { normal: { precision: 'float32' } } });
  const normal = Paint.apply(packet, paint).value;
  const left = get(normal, 'normal', 6, 1), right = get(normal, 'normal', 17, 1);
  assert(left[0] > .4);
  assert(right[0] < -.4);
  assert(left[1] < -.15 && right[1] < -.15);
  assert.equal(left[3], 1);
  assert(Math.abs(Math.hypot(...left.slice(0, 3)) - 1) < 1e-6);
  assert.equal(image(normal, 'normal').descriptor.normalOrientation, 'directx');
  assert.equal(image(normal, 'normal').descriptor.precision, 'float32');
});
