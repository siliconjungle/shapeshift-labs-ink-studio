/* Evaluate a picture clock in order and reuse frame bytes for both export formats. */
const { createHash } = require('node:crypto');
const PNG = require('./png.js');
const { createSceneSampler } = require('./graph-render.js');

const formats = ['frames', 'apng', 'both'];
const supportedOutputs = ['raster', 'displayRaster', 'image', 'world', 'renderFrame', 'any'];
const maxEvaluations = 14400, maxBytes = 256 * 1024 * 1024;
const index = n => Number.isSafeInteger(n) && n >= 0 && n <= 1000000000;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

function clip({ output, from = 0, to, warmup = 0, format = 'both', clock: settings = {}, renderOptions = {} },
  { kit, sample, plan, checks, seed }) {
  const type = typeof output === 'string' && Object.hasOwn(plan.outputs, output) && plan.outputs[output].type;
  if (type === 'linearRaster') throw new TypeError('Graph clip needs display RGB. Use color.rasterToDisplay first.');
  if (!supportedOutputs.includes(type))
    throw new TypeError('Choose a named raster, render frame or scene output for the graph clip');
  const start = Math.max(0, from - warmup);
  if (![from, to, warmup].every(index) || to <= from || to - start > maxEvaluations)
    throw new RangeError('Graph clip needs an increasing integer frame range and bounded warm-up');
  if (!formats.includes(format)) throw new RangeError('Graph clip format must be frames, apng or both');

  const { KIT: K } = kit, P = K.procedural, T = P.takeTime;
  if (!P.graphTypes.validator('record')(renderOptions))
    throw new TypeError('Scene render options must be a record');
  const clock = K.timeDomains.take(settings);
  const [n, d] = T.read(settings.fps ?? 24), ratio = { numerator: Number(n), denominator: Number(d) };
  const fps = Object.values(ratio).every(Number.isSafeInteger) ? ratio : settings.fps;
  const apng = format !== 'frames', numbered = format !== 'apng';
  if (apng) PNG.animationDelay(ratio);
  const digits = Math.max(6, String(to - 1).length);
  clock.at(to - 1);
  const isScene = P.graphTypes.validator('world'), isFrame = P.graphTypes.validator('renderFrame');
  const render = createSceneSampler(kit), artifacts = [], packed = [], frames = [], cuts = [];
  const { camera, lights, ...options } = renderOptions;
  let sequence, bytes = 0, passed = true;
  function append(file, data) {
    const item = { file, bytes: data, sha256: hash(data) };
    artifacts.push(item);
    return { file, sha256: item.sha256, bytes: data.length };
  }

  try {
    for (let i = start; i < to; i++) {
      const take = clock.at(i);
      if (sequence === undefined || take.cut) sequence = Object.freeze({});
      if (take.cut) cuts.push({ frame: i, id: take.shot });
      const evaluated = sample(take, sequence);
      const result = evaluated.outputs[output];
      const image = isScene(result) ? render(result, { take, sequence, camera, lights, options, channels: [] }).value : result;
      if (i < from) continue;
      if (image?.colorSpace === 'srgb-linear') throw new TypeError('Graph clip needs display RGB. Use color.rasterToDisplay first.');
      const raster = isFrame(image) ? P.sceneGraph.rasterFrame(image) : P.raster.rgba(image);
      const row = { frame: i, time: take.start, tick: take.tick, firstSample: take.firstSample,
        cut: take.cut, shot: take.shot, width: raster.width, height: raster.height };
      const frame = PNG.packRGBA(raster);
      if (apng && packed.length && !frame.header.equals(packed[0].header))
        throw new RangeError('APNG frames must have the same dimensions. Export numbered frames for variable dimensions.');
      bytes += (frame.compressed.length + 128) * (Number(apng) + Number(numbered));
      if (bytes > maxBytes) throw new RangeError('Graph clip exceeds the encoded sequence byte budget');
      if (apng) packed.push(frame);
      if (numbered) Object.assign(row, append('frames/frame-' + String(i).padStart(digits, '0') + '.png', PNG.encodeFrame(frame)));
      if (checks.length) {
        row.assertions = checks.map(check => check(evaluated));
        passed = passed && row.assertions.every(check => check.passed);
      }
      frames.push(row);
    }
  } finally {
    render.clear();
  }

  const animation = apng ? append('clip.png', PNG.encodeAnimation(packed, ratio)) : undefined;
  const report = { format: 'ink-studio/graph-clip', version: 1, projectHash: plan.projectHash,
    output, seed, fps, from, to, warmup: { from: start, count: from - start }, cuts, frames, passed,
    ...(animation && { animation }) };
  return { report, artifacts };
}

module.exports = { clip };
