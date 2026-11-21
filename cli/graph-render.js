/* Host the CPU splat renderer and pass previews in headless recipe graphs. */
const { render, cameraCapture } = require('./render.js');
const { history } = require('../src/render-graph.js');
const { pose } = require('./diarama-pose.js');
const { select } = require('../src/art-passes.js');
const { encode, depthRange, labels } = require('./pass-preview.js');

const defaults = ['coverage', 'depth', 'normal', 'objectId', 'materialId', 'emission'];
const positionPass = new Set(['position', 'objectPosition']);
const finitePass = new Set(['depth', 'emissionDepth']);

function renderGraphScene(source, { camera, lights, channels = defaults, options = {}, renderGraphInputs, renderGraphCapture,
  take, time = take?.start ?? 0, kit } = {}) {
  const api = (kit ?? require('../index.js').load()).KIT.procedural.sceneGraph;
  const { width = 128, height = 128, time: at = time, ...settings } = options;
  if (![width, height].every(n => Number.isSafeInteger(n) && n > 0 && n <= 2048) ||
      width * height > 1048576 || !Number.isFinite(at)) throw new RangeError('Graph render dimensions or time exceed the render budget');
  const requested = select(channels);
  if (requested.some(name => positionPass.has(name)) && !requested.includes('depth')) requested.push('depth');
  const view = camera && Object.keys(camera).length ? api.camera(camera) : undefined;
  const lighting = lights?.length ? api.lightOptions(lights) : {};
  let sampledCamera;
  const renderOptions = { ...settings, ...lighting, ...(view && { camera: view }),
    w: width, h: height, px: 1, t: at, passes: requested, ...(take !== undefined && { take }),
    ...(renderGraphInputs !== undefined && { renderGraphInputs }), ...(renderGraphCapture !== undefined && { renderGraphCapture }) };
  const frame = render(source, {
    ...renderOptions, ...cameraCapture(renderOptions, camera => { sampledCamera = camera; })
  });
  return { value: api.rasterFrame(frame), frame, motionReference: frame.motionReference ?? null,
    report: { width: frame.w, height: frame.h, time: at, splats: source.count,
      ...(sampledCamera && { camera: sampledCamera }),
      passes: requested.filter(name => frame.passes?.[name]),
      ...(frame.renderGraphPasses && { graphPasses: Object.keys(frame.renderGraphPasses) }) } };
}

function createSceneSampler(kit) {
  let retained, active, previousMotion, previousTime;
  function sample(source, { sequence, take, time = take?.start ?? 0, options = {}, ...settings }) {
    if (sequence === undefined) return renderGraphScene(source, { ...settings, options, time, take, kit });
    if (active !== sequence) {
      retained?.clear();
      retained = history();
      active = sequence;
      previousMotion = previousTime = undefined;
    }
    const at = options.time ?? time;
    if (!Number.isFinite(at) || at < 0) throw new RangeError('Graph scene playback needs nonnegative seconds');
    pose(source, at, { kit, artDirection: options.artDirection, maxSteps: 36000 });
    const motion = select(settings.channels).some(channel => channel === 'motion' || channel === 'emissionMotion');
    const result = renderGraphScene(source, { ...settings, time, take, kit, options: {
      ...(motion && at > previousTime && { motionFrom: previousMotion }), ...options,
      ...(motion && { captureMotion: true }), renderHistory: retained, renderHistoryKey: retained
    } });
    previousMotion = motion ? result.motionReference : undefined;
    previousTime = at;
    return result;
  }
  sample.clear = () => {
    retained?.clear();
    retained = active = previousMotion = previousTime = undefined;
  };
  return sample;
}

function positionPreview(samples, valid, width, height) {
  const data = new Uint8Array(width * height * 4);
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let p = 0; p < width * height; p++) if (valid[p]) for (let c = 0; c < 3; c++) {
    const n = samples[p * 3 + c];
    min[c] = Math.min(min[c], n);
    max[c] = Math.max(max[c], n);
  }
  for (let p = 0; p < width * height; p++) if (valid[p]) {
    for (let c = 0; c < 3; c++) data[p * 4 + c] = Math.round(255 * (samples[p * 3 + c] - min[c]) / (max[c] - min[c] || 1));
    data[p * 4 + 3] = 255;
  }
  const range = Number.isFinite(min[0]) ? { min, max } : null;
  return { image: { width, height, channels: 4, data }, range };
}

function graphRenderPass(frame, channel, { emptyDepth = 1e9, kit } = {}) {
  const procedural = (kit ?? require('../index.js').load()).KIT.procedural;
  const api = procedural.sceneGraph;
  if (channel === 'color') {
    const value = api.rasterFrame(frame);
    const { width, height, data } = value;
    return { value, data: value, valid: { width, height, channels: 1,
      data: Uint8Array.from({ length: width * height }, (_, p) => data[p * 4 + 3] ? 255 : 0) }, report: { channel, width, height } };
  }
  if (typeof channel === 'string' && channel.startsWith('graph:')) {
    const id = channel.slice(6), captures = frame.renderGraphPasses ?? {};
    if (!Object.hasOwn(captures, id)) throw new RangeError('Render did not capture pass ' + channel);
    const { kind, width, height, channels, data } = captures[id];
    const raster = { width, height, channels, data: data.slice() };
    const value = kind === 'mask' ? procedural.raster.rgba(raster) : raster;
    const valid = new Uint8Array(width * height).fill(255);
    if (kind === 'image') for (let p = 0; p < valid.length; p++) valid[p] = data[p * 4 + 3] ? 255 : 0;
    return { value, data: raster, valid: { width, height, channels: 1, data: valid },
      report: { channel, kind, width, height } };
  }
  if (!Number.isFinite(emptyDepth) || select([channel]).length !== 1 || channel === 'environment')
    throw new RangeError('Pass needs one channel and a finite emptyDepth');
  const { w: width, h: height } = frame.passes ?? {}, raw = frame.passes?.[channel];
  const size = width * height, channels = raw?.length / size;
  if (!raw || !Number.isSafeInteger(size) || size <= 0 || ![1, 2, 3, 4].includes(channels))
    throw new RangeError('Render did not capture pass ' + channel);
  const depth = finitePass.has(channel), positions = positionPass.has(channel);
  const buffer = depth ? Float64Array.from(raw, n => Number.isFinite(n) ? n : emptyDepth) : raw.slice();
  const valid = frame.passes[channel + 'Valid']?.slice() ?? new Uint8Array(size).fill(255);
  if (depth || positions) {
    const owner = depth ? raw : frame.passes.depth;
    if (!owner) throw new RangeError('Position preview needs its matching depth pass');
    for (let p = 0; p < size; p++) if (!Number.isFinite(owner[p])) valid[p] = 0;
  }
  const preview = positions ? positionPreview(raw, valid, width, height) :
    { image: api.rasterFrame(encode({ w: width, h: height, passes: frame.passes }, channel)),
      ...(depth && { range: depthRange(raw) }) };
  const names = { objectId: 'objects', materialId: 'materials', target: 'targets', paletteOwner: 'paletteOwners' }[channel];
  const legend = names ? labels(frame.passes)[names] : undefined;
  return { value: preview.image, data: { width, height, channels, data: buffer }, valid: { width, height, channels: 1, data: valid },
    report: { channel, width, height, ...(preview.range !== undefined && { range: preview.range }),
      ...(depth && { emptyDepth }), ...(legend && { legend }) } };
}

function graph3DOperations(kit) {
  const options = { type: 'record', default: {} };
  return {
    'scene.render': {
      inputs: { source: 'world', camera: options, lights: { type: 'array<record>', default: [] },
        channels: { type: 'array<string>', default: defaults }, options,
        renderGraphInputs: options, renderGraphCapture: { type: 'array<string>', default: [] } },
      outputs: { value: 'displayRaster', frame: 'renderFrame', motionReference: 'any', report: 'record' }, time: true,
      instantiate() {
        const sample = createSceneSampler(kit);
        const run = ({ source, options, ...inputs }, { time, take, sequence }) =>
          sample(source, { ...inputs, options, time, sequence, ...(options.time === undefined && { take }) });
        run.clear = sample.clear;
        return run;
      }
    },
    'scene.pass': {
      inputs: { frame: 'renderFrame', channel: 'string', options },
      outputs: { value: 'raster', data: 'raster', valid: 'raster', report: 'record' },
      run({ frame, channel, options }) { return graphRenderPass(frame, channel, { ...options, kit }); }
    }
  };
}

module.exports = { renderGraphScene, graphRenderPass, graph3DOperations, createSceneSampler };
