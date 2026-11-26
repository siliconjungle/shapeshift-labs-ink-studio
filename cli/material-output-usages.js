const { isDeepStrictEqual } = require('node:util');
const Base = require('../src/material-base-settings.js');
const PNG = require('./png.js');
const { typedPng } = require('./material-image-export.js');

const own = Object.hasOwn;
const record = value => value && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const id = value => typeof value === 'string' && /^[a-z][\w.-]{0,99}$/i.test(value) &&
  !['__proto__', 'constructor', 'prototype'].includes(value);
const usages = new Set(['baseColor', 'normal', 'height', 'roughness', 'metalness', 'ao', 'emission', 'opacity', 'packed']);
const typed = new Set(['typedImage', 'colorImage', 'grayImage', 'heightImage', 'normalImage']);
const components = ['r', 'g', 'b', 'a'];
const maximum = { unorm8: 255, unorm16: 65535 };
const unit = value => Number.isFinite(value) && value >= 0 && value <= 1;

function fields(value, keys, label) {
  if (!record(value) || Object.keys(value).some(key => !keys.includes(key)))
    throw new TypeError('Invalid ' + label);
}

function normalize(spec, outputs) {
  if (!record(spec) || Object.keys(spec).length > 64)
    throw new TypeError('Material output usages need a record of up to 64 maps');
  const keys = new Set();
  const rows = Object.entries(spec).map(([key, row]) => {
    if (!id(key) || keys.has(key.toLowerCase())) throw new TypeError('Invalid or duplicate material map ID ' + key);
    keys.add(key.toLowerCase());
    fields(row, ['usage', 'label', 'order', 'format', 'source', 'packing', 'export'], 'material map ' + key);
    const { usage, label, order, source, packing, export: delivery = true } = row;
    if (!(usages.has(usage) || typeof usage === 'string' && /^(?:mask|custom)\.[A-Za-z][\w.-]{0,92}$/.test(usage)) ||
        typeof label !== 'string' || !label.trim() || label.length > 120 || !Number.isSafeInteger(order) ||
        order < 0 || typeof delivery !== 'boolean' || !own(row, 'format'))
      throw new TypeError('Material map ' + key + ' needs a usage, label, nonnegative order and format');
    fields(row.format, ['format', 'bitDepth'], 'delivery format for material map ' + key);
    if (!own(row.format, 'format')) throw new TypeError('Material map ' + key + ' needs an explicit delivery format');
    const { output: format } = Base.resolve({ output: row.format });
    if (usage === 'packed') {
      if (source !== undefined) throw new TypeError('Packed material map ' + key + ' needs channel assignments');
      fields(packing, components, 'packing for material map ' + key);
      const assignments = components.filter(component => own(packing, component));
      if (!components.slice(0, 3).every(component => own(packing, component)))
        throw new TypeError('Packed material map ' + key + ' needs explicit r, g and b assignments');
      const normalized = Object.fromEntries(assignments.map(component => {
        const assignment = packing[component], address = key + '.' + component;
        fields(assignment, ['map', 'value'], 'packing source ' + address);
        if (Object.keys(assignment).length !== 1 || !(own(assignment, 'map') ? id(assignment.map) : unit(assignment.value)))
          throw new TypeError('Packing source ' + address + ' needs one map ID or a constant between zero and one');
        return [component, assignment];
      }));
      if (!Object.values(normalized).some(assignment => own(assignment, 'map')))
        throw new TypeError('Packed material map ' + key + ' needs a map to establish its extent');
      return { id: key, usage, label, order, format, packing: normalized, export: delivery };
    }
    if (packing !== undefined) throw new TypeError('Use packed usage for channel assignments on ' + key);
    fields(source, ['output', 'channel'], 'source for material map ' + key);
    if (!id(source.output) || !own(outputs, source.output) || source.channel !== undefined && !id(source.channel))
      throw new TypeError('Material map ' + key + ' needs a declared graph output and an optional packet channel');
    if (usage === 'height' && format.format === 'png' && delivery)
      throw new TypeError('Physical height map ' + key + ' needs a JSON delivery format');
    return { id: key, usage, label, order, format, source, export: delivery };
  });
  const byId = new Map(rows.map(row => [row.id, row]));
  for (const row of rows) for (const [component, { map }] of Object.entries(row.packing ?? {})) {
    if (map === undefined) continue;
    const source = byId.get(map);
    if (!source || !source.source || ['baseColor', 'normal', 'height', 'emission'].includes(source.usage))
      throw new TypeError('Packing source ' + row.id + '.' + component + ' needs an unpacked scalar material map');
  }
  return rows.sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : 1));
}

function checkPorts(rows, outputs) {
  for (const { id, source } of rows) {
    if (!source) continue;
    const type = outputs[source.output]?.type;
    if (source.channel === undefined ? !typed.has(type) : type !== 'materialChannels')
      throw new TypeError('Material map ' + id + ' needs a ' + (source.channel === undefined ?
        'typed image output' : 'material channel packet output'));
  }
}

function alignment(image) {
  const { raster: { width, height, pivot }, descriptor: { pixelPitchMm, tiling, sampling } } = image;
  return { width, height, pivot, pixelPitchMm, tiling, sampling };
}

function scalar(image) {
  const { raster, descriptor } = image;
  const divisor = maximum[descriptor.precision] ?? 1;
  return raster.channels === 1 && ['data', 'mask'].includes(descriptor.intent) && descriptor.units === 'unitless' &&
    raster.data.every(value => unit(value / divisor));
}

function imagesFor(P, rows, outputs) {
  const found = new Map(), byId = new Map(rows.map(row => [row.id, row]));
  function get(key) {
    if (found.has(key)) return found.get(key);
    const row = byId.get(key);
    let image;
    if (row.source) {
      const { output, channel } = row.source;
      image = channel === undefined ? outputs[output] : P.materialChannels.channel(outputs[output], channel).raster;
      const custom = row.usage.startsWith('custom.');
      if (!(custom ? P.graphImages.valid(image) :
        image?.format === P.graphImages.format && P.materialChannels.validMap(row.usage, image)))
        throw new TypeError('Material map ' + key + ' does not match its ' + row.usage + ' usage');
      if (['data', 'mask'].includes(image.descriptor.intent) && !custom && !scalar(image))
        throw new RangeError('Material map ' + key + ' needs normalized unitless scalar samples');
    } else {
      const assignments = Object.entries(row.packing).map(([component, { map, value }]) => {
        if (map === undefined) return { component, value };
        const source = get(map);
        if (!scalar(source)) throw new TypeError('Packing source ' + key + '.' + component + ' needs normalized scalar samples');
        return { component, source, divisor: maximum[source.descriptor.precision] ?? 1 };
      });
      const { source: first } = assignments.find(assignment => assignment.source);
      const expected = alignment(first);
      for (const { component, source } of assignments) {
        if (source && !isDeepStrictEqual(alignment(source), expected))
          throw new RangeError('Packing source ' + key + '.' + component + ' must match extent, pivot, pitch, tiling and sampling');
      }
      const { width, height, pivot, pixelPitchMm, tiling, sampling } = expected, channels = assignments.length;
      const bits = row.format.bitDepth;
      const Samples = bits === 8 ? Uint8Array : bits === 16 ? Uint16Array : Float64Array;
      const data = new Samples(width * height * channels), bound = bits === undefined ? 1 : 2 ** bits - 1;
      for (let c = 0; c < channels; c++) {
        const { source, value, divisor } = assignments[c];
        for (let p = 0; p < width * height; p++) {
          const sample = source ? source.raster.data[p] / divisor : value;
          data[p * channels + c] = bits === undefined ? sample : Math.round(sample * bound);
        }
      }
      image = P.graphImages.declare({ width, height, channels, data, pivot },
        { intent: 'data', alpha: 'none', tiling, sampling, pixelPitchMm });
    }
    found.set(key, image);
    return image;
  }
  return get;
}

function png(P, image, bitDepth) {
  const density = image.descriptor.pixelPitchMm?.map(pitch => Math.round(1000 / pitch));
  return typedPng(P, image, bitDepth, density);
}

function previewComponent(row, component) {
  if (component !== undefined && (!components.includes(component) || !row.packing || !own(row.packing, component)))
    throw new RangeError('Preview component must name a packed channel on ' + row.id);
}

function preview(P, image, row, component) {
  const { raster: { width, height, channels, data }, descriptor: { intent, precision, units, domain } } = image;
  if (intent === 'color') return { bytes: typedPng(P, image, 8), mode: 'color' };
  const divisor = maximum[precision] ?? 1;
  if (channels >= 3 && component === undefined) {
    const samples = new Uint8Array(width * height * 3);
    for (let p = 0; p < width * height; p++) for (let c = 0; c < 3; c++) {
      const raw = data[p * channels + c];
      const normalized = domain === 'signed-unit' ? (raw + 1) / 2 : raw / divisor;
      samples[p * 3 + c] = Math.round(255 * Math.max(0, Math.min(1, normalized)));
    }
    const mode = intent === 'normal' ? 'normal' : row.packing ? 'packed' : 'data-rgb';
    return { bytes: PNG.encode(width, height, samples), mode };
  }

  const channel = component === undefined ? 0 : components.indexOf(component);
  let lo = 0, hi = 1;
  if (intent === 'height' || domain === 'finite' && !row.packing &&
      data.some((value, index) => index % channels === channel && !unit(value))) {
    lo = Infinity;
    hi = -Infinity;
    for (let n = channel; n < data.length; n += channels) {
      lo = Math.min(lo, data[n]);
      hi = Math.max(hi, data[n]);
    }
  }
  const samples = new Uint8Array(width * height);
  const scale = Math.max(Math.abs(lo), Math.abs(hi), 1);
  const low = lo / scale, span = hi / scale - low;
  for (let p = 0; p < samples.length; p++)
    samples[p] = Math.round(255 * (span ? (data[p * channels + channel] / divisor / scale - low) / span : .5));
  return { bytes: PNG.encodeGray(width, height, samples), mode: intent === 'height' ? 'height' : 'scalar',
    units, range: [lo, hi], ...(component && { component }), ...(channels === 2 && { component: 'r' }) };
}

module.exports = { normalize, checkPorts, imagesFor, png, previewComponent, preview };
