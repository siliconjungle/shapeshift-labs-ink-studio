const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const Color = require('../src/color-space.js');
const PNG = require('./png.js');
const { fields, maxBytes } = require('./texture-common.js');
const { allocatePlanes, readDeepEXR, plateLayout } = require('./deep-openexr.js');
const { name, finite, compile } = require('./deep-shot-effects.js');

const format = 'ink-studio/deep-shot';
const sequenceFormats = ['ink-studio/deep-openexr', 'ink-studio/deep-shot-sequence'];
const maxFrames = 128;
const workingSpaces = ['srgb-linear','display-p3-linear'];
const hash = data => createHash('sha256').update(data).digest('hex');
const label = value => typeof value === 'string' && value.trim() && value.length <= 1024;
const address = value => label(value) && !path.isAbsolute(value) && !path.win32.isAbsolute(value) && !value.includes('\0');
const ordered = times => Array.isArray(times) && times.length >= 1 && times.length <= maxFrames &&
  Array.from(times).every((time, i) => finite(time, -1e6, 1e6) && (i === 0 || time > times[i - 1]));

function read(file, limit = plateLayout.maxBytes) {
  const { O_RDONLY, O_NONBLOCK } = fs.constants;
  const handle = fs.openSync(file, O_RDONLY | O_NONBLOCK);
  try {
    const info = fs.fstatSync(handle);
    if (!info.isFile() || info.size > limit) throw new RangeError('Deep shot input exceeds its file budget: ' + file);
    const bytes = fs.readFileSync(handle);
    if (bytes.length > limit) throw new RangeError('Deep shot input exceeds its file budget: ' + file);
    return bytes;
  } finally { fs.closeSync(handle); }
}

function sources(readInput, rows, directory) {
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > 8) throw new RangeError('Choose 1–8 deep shot inputs');
  const ids = new Set();
  return rows.map(row => {
    if (!fields(row, ['id','file','kind','offset','depthOffset','timeOffset','depth','object','material','color']) ||
        !name(row.id) || ids.has(row.id) || !address(row.file)) throw new TypeError('Deep inputs need distinct IDs and relative files');
    const { id, kind = 'deep', offset = [0,0], depthOffset = 0, timeOffset = 0,
      depth, object = id, material = id, color = 'srgb' } = row;
    if (!['deep','card'].includes(kind) || !Array.isArray(offset) || offset.length !== 2 ||
        !Array.from(offset).every(n => Number.isSafeInteger(n) && finite(n, -16384, 16384)) ||
        !finite(depthOffset, -1e6, 1e6) || !finite(timeOffset, -1e6, 1e6) ||
        (kind === 'card' ? !finite(depth, 0, 1e6) || !label(object) || !label(material) :
          ['depth','object','material','color'].some(key => row[key] !== undefined)))
      throw new RangeError('Invalid plate registration or card settings for ' + id);
    const file = path.resolve(directory, row.file), sequence = /\.json$/i.test(file);
    let frames;
    if (sequence) {
      const doc = JSON.parse(readInput(file, 4 * 1024 ** 2));
      if (!sequenceFormats.includes(doc?.format) || doc.version !== 1 || !Array.isArray(doc.frames) ||
          !ordered(doc.frames.map(frame => frame?.time)) || doc.frames.some(frame => !address(frame.file)))
        throw new TypeError('Invalid or unordered deep shot sequence for ' + id);
      frames = doc.frames.map(frame => ({ path: path.resolve(path.dirname(file), frame.file), time: frame.time }));
    } else frames = [{ path: file }];
    const ext = kind === 'deep' ? '.exr' : '.png';
    if (frames.some(frame => path.extname(frame.path).toLowerCase() !== ext))
      throw new TypeError('Deep shot input ' + id + ' needs ' + ext + ' frames');
    const card = kind === 'card' && { depth, object, material, color: Color.descriptor(color) };
    if (card && card.color.range.min.some((n, i) => n !== 0 || card.color.range.max[i] !== 1))
      throw new RangeError('Card color descriptors use normalized PNG codes');
    return { id, file: row.file, kind, offset, depthOffset, timeOffset, sequence, frames, ...(card && { card }) };
  });
}

function align(input, time, tolerance) {
  if (!input.sequence) return { ...input.frames[0], static: true };
  const target = time - input.timeOffset;
  let nearest, delta = Infinity;
  for (const frame of input.frames) {
    const distance = Math.abs(frame.time - target);
    if (distance + 1e-12 < delta) {
      nearest = frame;
      delta = distance;
    }
  }
  if (delta > tolerance + 1e-12)
    throw new RangeError('No frame for ' + input.id + ' within ' + tolerance + ' seconds of shot time ' + time);
  return { ...nearest, delta: nearest.time + input.timeOffset - time };
}

function loadPlan(file, operators) {
  const directory = path.dirname(file), dependencies = new Map();
  const relative = source => path.relative(directory, source).split(path.sep).join('/');
  function readInput(source, limit) {
    const data = read(source, limit), sha256 = hash(data), prior = dependencies.get(source);
    if (prior && prior.sha256 !== sha256) throw new RangeError('Deep shot input changed during the run: ' + relative(source));
    dependencies.set(source, { file: relative(source), sha256, bytes: data.length });
    return data;
  }

  const bytes = readInput(file, 4 * 1024 ** 2), plan = JSON.parse(bytes);
  if (!fields(plan, ['format','version','inputs','reference','clock','alignment','working','display','effects','allowTruncated']) ||
      plan.format !== format || plan.version !== 1) throw new TypeError('Use a version 1 Ink deep shot plan');
  const { clock = {}, alignment = 'strict', working = 'srgb-linear', display = { space:'srgb', outOfRange:'clamp' },
    effects = [], allowTruncated = false } = plan;
  if (!['strict','registered'].includes(alignment) || !workingSpaces.includes(working) || typeof allowTruncated !== 'boolean' ||
      !fields(clock, ['times','tolerance']) || !finite(clock.tolerance ?? 0, 0, 60) ||
      clock.times !== undefined && !ordered(clock.times)) throw new TypeError('Invalid deep shot alignment, clock or working space');
  const displayColor = Color.descriptor(display);
  if (displayColor.space !== 'srgb' || displayColor.outOfRange === 'preserve' ||
      displayColor.range.min.some((low, i) => low !== 0 || displayColor.range.max[i] !== 1))
    throw new RangeError('PNG delivery needs normalized sRGB with clamp or error handling');

  const inputs = sources(readInput, plan.inputs, directory), reference = inputs.find(input => input.id === plan.reference);
  if (reference?.kind !== 'deep' || reference.offset.some(Boolean) || reference.depthOffset)
    throw new TypeError('Choose one deep reference input without a spatial or depth offset');
  if (alignment === 'strict' && inputs.some(input => input.kind === 'deep' && (input.offset.some(Boolean) || input.depthOffset)))
    throw new RangeError('Use registered alignment for authored deep plate offsets');

  const operations = compile(effects, operators, inputs.map(input => input.id), working);
  let first;
  const times = clock.times ?? (reference.sequence ? reference.frames.map(frame => frame.time + reference.timeOffset) :
    [(first = readDeepEXR(readInput(reference.frames[0].path))).time ?? 0].map(time => time + reference.timeOffset));
  if (!ordered(times) || times.length * inputs.length > 512) throw new RangeError('Deep shot exceeds its aligned frame budget');
  const frames = times.map(time => ({ time, matches: inputs.map(input => align(input, time, clock.tolerance ?? 0)) }));
  function plate(input, match, remaining) {
    const local = first && input === reference && match.static;
    const value = local ? first : input.kind === 'deep' ? readDeepEXR(readInput(match.path), { sampleBudget: remaining }) :
      cardPlate(readInput(match.path, maxBytes), input.card, remaining);
    if (local) first = undefined;
    if (value.planes.A.length > remaining) throw new RangeError('Deep shot exceeds its shared input sample budget');
    if (input.kind === 'deep' && input.sequence && value.time !== undefined && Math.abs(value.time - match.time) > 1e-9)
      throw new RangeError('Deep frame header and sequence time disagree for ' + input.id);
    if (!allowTruncated && value.statistics?.droppedSamples)
      throw new RangeError('Input ' + input.id + ' lost deep samples. Allow truncation explicitly to use it.');
    return value;
  }
  return { alignment, working, display: displayColor, allowTruncated, reference: reference.id, inputs, frames,
    operations, plate, relative, dependencies };
}

function cardPlate(bytes, options, sampleBudget) {
  const { w, h } = PNG.layout(bytes);
  if (w * h > plateLayout.maxPixels) throw new RangeError('Card exceeds its art-grid budget');
  const { data, max } = PNG.raster(bytes), offsets = new Uint32Array(w * h + 1);
  let count = 0;
  for (let p = 0; p < w * h; p++) {
    if (data[p * 4 + 3]) count++;
    offsets[p + 1] = count;
  }
  if (count > sampleBudget) throw new RangeError('Card exceeds the shared deep sample budget');
  const planes = allocatePlanes(count), linear = Color.prepare(options.color, 'srgb-linear');
  const display = Color.prepare(options.color, 'srgb'), source = [0,0,0], rgb = [0,0,0], capture = [0,0,0];
  for (let p = 0; p < w * h; p++) {
    const i = offsets[p], at = p * 4;
    if (i === offsets[p + 1]) continue;
    const a = data[at + 3] / max;
    for (let c = 0; c < 3; c++) source[c] = data[at + c] / max;
    linear(source, rgb);
    display(source, capture);
    planes.A[i] = a;
    planes.Z[i] = planes.ZBack[i] = options.depth;
    planes['ink.visibleCoverage'][i] = a;
    planes['ink.kind'][i] = plateLayout.kinds.sprite;
    planes['ink.objectId'][i] = planes['ink.materialId'][i] = 1;
    for (const [c, channel] of ['R','G','B'].entries()) {
      planes[channel][i] = Math.fround(rgb[c] * a);
      planes['ink.surface.' + channel][i] = capture[c];
      planes['ink.transmission.' + channel][i] = 1;
    }
  }
  return { w, h, planes, offsets, objects: [null, options.object], materials: [null, options.material] };
}

module.exports = { format, loadPlan, read, hash };
