/* Capture display, raw and tracked channels while the graph clip is evaluating. */
const { graphRenderPass } = require('./graph-render.js');
const { channels } = require('../src/art-passes.js');

const captureKeys = ['pass', 'crop', 'region', 'tracking', 'labels', 'mask', 'depth', 'depthValid', 'motion', 'motionValid'];
const record = value => value && [Object.prototype, null].includes(Object.getPrototypeOf(value));

function createCapture(settings, { fps, from, to, kit, plan, type }) {
  if (!record(settings) || Object.keys(settings).some(key => !captureKeys.includes(key)))
    throw new TypeError('Invalid visual sample capture settings');
  const { pass = 'color', crop, region, tracking, labels, mask, depth, motion, depthValid, motionValid } = settings;
  if (typeof pass !== 'string' || !['color', ...channels].includes(pass) && !/^graph:.+/.test(pass))
    throw new RangeError('Choose a native render channel or a graph:<pass> capture');
  const P = kit.KIT.procedural, V = P.visualResampling;
  if (to - from > V.maxFrames) throw new RangeError('Visual sample needs at most ' + V.maxFrames + ' frames');
  const named = (name, type) => {
    if (name === undefined) return;
    if (typeof name !== 'string' || !Object.hasOwn(plan.outputs, name) ||
        !P.graphTypes.compatible(plan.outputs[name].type, type))
      throw new TypeError('Visual sample needs a named ' + type + ' output: ' + name);
  };
  for (const key of [labels, mask, depthValid, motionValid]) named(key, 'raster');
  for (const key of [depth, motion]) if (typeof key !== 'boolean') named(key, 'raster');
  if ((labels !== undefined || mask !== undefined || tracking !== undefined) && region === undefined ||
      labels !== undefined && (mask !== undefined || tracking !== undefined) ||
      tracking !== undefined && !record(tracking))
    throw new TypeError('Region capture needs a region ID and either labels or tracking settings');
  if (depth === false && depthValid !== undefined || motion === false && motionValid !== undefined)
    throw new TypeError('Visual sample validity needs its enabled auxiliary plane');
  const recorder = V.create({ fps, startFrame: from, crop, region });
  const tracker = region !== undefined && labels === undefined ? P.pixelEffects.createRegionTracker(tracking) : null;
  const isFrame = P.graphTypes.validator('renderFrame'), isScene = P.graphTypes.validator('world');
  const nativeChannels = [
    ...(channels.includes(pass) ? [pass] : []),
    ...(depth === undefined || depth === true ? ['depth'] : []),
    ...(motion === undefined || motion === true ? ['motion'] : [])
  ];
  const graphPasses = pass.startsWith('graph:') ? [pass.slice(6)] : undefined;
  const aligned = (value, image) => value?.width === image.width && value?.height === image.height;

  function capture(output, outputs, { take, sequence, render, camera, lights, options, keep }) {
    const frame = isScene(output) ? render(output, { take, sequence, camera, lights,
      options: { transparent: true, ...options }, channels: nativeChannels, renderGraphCapture: graphPasses }).frame
      : isFrame(output) ? output : null;
    if (!keep && !tracker) return;
    if (!frame && pass !== 'color') throw new TypeError('A named render pass needs a render frame or scene output');
    const selected = frame && graphRenderPass(frame, pass, { kit });
    const linear = !selected && (type === 'linearRaster' || output?.colorSpace === 'srgb-linear');
    const raster = selected?.data ?? (linear ? { ...output, colorSpace: 'srgb-linear' } : output);
    const image = selected?.value ?? (linear ? P.conversions.rasterToDisplay(raster) : raster);
    const raw = raster !== image || image.channels !== 4 ||
      !(image.data instanceof Uint8Array || image.data instanceof Uint8ClampedArray);
    let IDs = labels === undefined ? undefined : outputs[labels];
    if (tracker) {
      if (take.cut) tracker.reset();
      const signal = mask === undefined ? (selected?.report.kind === 'mask' ? raster : image) : outputs[mask];
      if (!aligned(signal, image)) throw new RangeError('Tracking signal must align with the captured pass');
      IDs = tracker.update(signal, take.start).labels;
    }
    if (!keep) return;
    const auxiliary = (channel, choice, validName) => {
      if (choice === false) return {};
      if (typeof choice === 'string') return { [channel]: outputs[choice],
        ...(validName !== undefined && { [channel + 'Valid']: outputs[validName] }) };
      const passes = frame?.passes;
      const alignedPass = passes?.[channel] && passes.w === image.width && passes.h === image.height;
      if (!alignedPass) {
        if (choice === true || validName !== undefined) throw new RangeError('Missing aligned native ' + channel + ' pass');
        return {};
      }
      const { data, valid } = graphRenderPass(frame, channel, { kit });
      return { [channel]: data, [channel + 'Valid']: validName === undefined ? valid : outputs[validName] };
    };
    recorder.append(image, {
      ...(raw && { data: raster }),
      ...auxiliary('depth', depth, depthValid), ...auxiliary('motion', motion, motionValid), labels: IDs
    });
    return { width: crop?.[2] ?? image.width, height: crop?.[3] ?? image.height };
  }

  return { capture, snapshot: recorder.snapshot };
}

module.exports = { createCapture };
