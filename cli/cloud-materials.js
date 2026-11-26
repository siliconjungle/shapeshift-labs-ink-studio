'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { graphOutputs } = require('./graph-outputs.js');
const { claim } = require('./graph-batch.js');
const Camera = require('../src/camera-lens.js');
const Fit = require('./cloud-material-fit.js');
const { clamp, normalize } = require('./cloud-material-normals.js');
const PNG = require('./png.js');
const Render = require('./render.js');

const format = 'ink-studio/cloud-materials';
const maxRows = 40000, maxBytes = 64 * 1024 * 1024;
const channels = ['normal', 'pigment', 'roughness', 'specular'];
const uncertainties = channels.slice(0, 3);
const normalSources = ['covariance', 'neighborhood', 'orientation'];
const profileEvidence = ['dc-only', 'insufficient-key', 'unresolved-lobe', 'directional-lobe'];
const modes = ['relit', 'captured', 'pigment', 'normals', 'roughness', ...uncertainties.map(n => n + '-uncertainty')];
const filePattern = /^capture\.(ply|spz)$/;
const record = value => value && Object.getPrototypeOf(value) === Object.prototype;
const fields = (value, keys) => record(value) && Object.keys(value).every(k => keys.includes(k));
const range = (n, min, max) => Number.isFinite(n) && n >= min && n <= max;
const integer = (n, min, max) => Number.isSafeInteger(n) && range(n, min, max);
const triplet = (a, min, max) => Array.isArray(a) && a.length === 3 && Array.from(a).every(n => range(n, min, max));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const round = n => Math.round(n * 1e6) / 1e6;
const validDigest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

function read(file, limit) {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > limit) throw new RangeError('Invalid or over-budget cloud material input ' + file);
    const bytes = Buffer.alloc(stat.size);
    for (let at = 0; at < bytes.length;) {
      const length = fs.readSync(fd, bytes, at, bytes.length - at, at);
      if (!length) throw new RangeError('Incomplete cloud material input ' + file);
      at += length;
    }
    return bytes;
  } finally {
    fs.closeSync(fd);
  }
}

const json = (file, limit) => JSON.parse(read(file, limit));
const number = (n, min, max, name) => {
  if (!range(n, min, max)) throw new RangeError(name + ' needs a value in [' + min + ', ' + max + ']');
  return n;
};

function direction(raw) {
  if (!triplet(raw, -1e6, 1e6) || !normalize(raw).some(Boolean))
    throw new RangeError('Expected a nonzero XYZ direction');
  return normalize(raw);
}

function light(raw) {
  if (!record(raw)) throw new TypeError('Expected directional light settings');
  return { direction: direction(raw.direction), ambient: number(raw.ambient, .025, 4, 'Ambient'),
    key: number(raw.key, 0, 4, 'Key') };
}

function lightInput(raw) {
  if (!fields(raw, ['direction', 'ambient', 'key'])) throw new TypeError('Invalid directional light settings');
  return light(raw);
}

function config(raw, count) {
  if (!fields(raw, ['neighbors', 'normalToward', 'fallbackRoughness', 'anchors', 'captureLight']))
    throw new TypeError('Unknown cloud material plan setting');
  const { neighbors = 14, fallbackRoughness = .64 } = raw;
  if (!integer(neighbors, 4, 32)) throw new RangeError('Choose 4 to 32 nearby points per normal');
  number(fallbackRoughness, 0, 1, 'Fallback roughness');
  if (raw.anchors !== undefined && (!Array.isArray(raw.anchors) || !integer(raw.anchors.length, 4, 128) || raw.captureLight !== undefined))
    throw new RangeError('Use 4 to 128 pigment anchors or a fixed capture light');
  const seen = new Set();
  const anchors = raw.anchors?.map(anchor => {
    if (!fields(anchor, ['row', 'pigment']) || !integer(anchor.row, 0, count - 1) || seen.has(anchor.row) ||
        !triplet(anchor.pigment, 0, 1) || Math.hypot(...anchor.pigment) < .035)
      throw new RangeError('Pigment anchors need unique source rows and nonblack linear RGB');
    seen.add(anchor.row);
    return anchor;
  });
  return { neighbors, fallbackRoughness, ...(raw.normalToward !== undefined && { normalToward: direction(raw.normalToward) }),
    ...(raw.captureLight !== undefined && { captureLight: lightInput(raw.captureLight) }), ...(anchors && { anchors }) };
}

function overrideValue(name, value) {
  if (name === 'normal') return direction(value).map(round);
  if (name === 'pigment') {
    if (!triplet(value, 0, 1)) throw new RangeError('Pigment needs three linear RGB values in [0, 1]');
    return value;
  }
  return number(value, 0, 1, name);
}

function validateAsset(asset) {
  const { source, illumination, rows, overrides } = asset ?? {};
  if (asset?.format !== format || asset.version !== 1 || !fields(source, ['file', 'sha256', 'count', 'degree']) ||
      typeof source.file !== 'string' || !filePattern.test(source.file) || !validDigest(source.sha256) ||
      !integer(source.count, 1, maxRows) || !integer(source.degree, 0, 4) ||
      !Array.isArray(rows) || rows.length !== source.count || !Array.isArray(overrides) || overrides.length > source.count)
    throw new RangeError('Invalid or over-budget cloud material asset');
  light(illumination);
  for (const row of rows) {
    if (!record(row) || !triplet(row.normal, -1, 1) || Math.abs(Math.hypot(...row.normal) - 1) > .001 ||
        !triplet(row.pigment, 0, 1) || !range(row.roughness, 0, 1) || !range(row.specular, 0, 1) ||
        !row.uncertainty || !uncertainties.every(key => range(row.uncertainty[key], 0, 1)) ||
        !normalSources.includes(row.normalSource) || !profileEvidence.includes(row.evidence) ||
        row.residual !== null && !range(row.residual, 0, 1))
      throw new RangeError('Invalid recovered material row');
  }
  let previous = -1;
  for (const entry of overrides) {
    const { row, ...change } = entry ?? {};
    if (!integer(row, previous + 1, rows.length - 1) || !Object.keys(change).length || !fields(change, channels))
      throw new RangeError('Invalid cloud material override table');
    for (const [name, value] of Object.entries(change)) overrideValue(name, value);
    previous = row;
  }
  return asset;
}

function edits(asset, patch) {
  if (!fields(patch, ['format', 'version', 'sourceSha256', 'edits']) || patch.format !== format + '-overrides' ||
      patch.version !== 1 || patch.sourceSha256 !== asset.source.sha256 ||
      !Array.isArray(patch.edits) || !integer(patch.edits.length, 1, asset.rows.length))
    throw new RangeError('Overrides need this capture fingerprint and a bounded row edit list');
  const saved = new Map(asset.overrides.map(({ row, ...value }) => [row, value])), seen = new Set();
  for (const entry of patch.edits) {
    const { row, ...changes } = entry ?? {};
    if (!integer(row, 0, asset.rows.length - 1) || seen.has(row) || !fields(changes, channels) || !Object.keys(changes).length)
      throw new RangeError('Overrides need unique source rows and at least one channel');
    seen.add(row);
    const value = { ...saved.get(row) };
    for (const [name, change] of Object.entries(changes)) {
      if (change === null) delete value[name];
      else value[name] = overrideValue(name, change);
    }
    if (Object.keys(value).length) saved.set(row, value);
    else saved.delete(row);
  }
  return { ...asset, overrides: [...saved].sort((a, b) => a[0] - b[0]).map(([row, value]) => ({ row, ...value })) };
}

function report(asset) {
  const { rows, source, illumination, overrides } = asset, normalCounts = {}, roughnessEvidence = {};
  const uncertainty = Object.fromEntries(uncertainties.map(name => [name, { mean: 0, high: 0 }]));
  let residual = 0, fittedProfiles = 0, searchLimited = 0;
  for (const row of rows) {
    normalCounts[row.normalSource] = (normalCounts[row.normalSource] ?? 0) + 1;
    roughnessEvidence[row.evidence] = (roughnessEvidence[row.evidence] ?? 0) + 1;
    for (const [name, sum] of Object.entries(uncertainty)) {
      sum.mean += row.uncertainty[name] / rows.length;
      if (row.uncertainty[name] >= .75) sum.high++;
    }
    if (row.searchLimited) searchLimited++;
    if (Number.isFinite(row.residual)) { residual += row.residual ** 2; fittedProfiles++; }
  }
  for (const sum of Object.values(uncertainty)) sum.mean = round(sum.mean);
  const overridden = Object.fromEntries(channels.map(name => [name, overrides.filter(row => Object.hasOwn(row, name)).length]));
  return { format: format + '-report', version: 1, source, illumination, normalSources: normalCounts, roughnessEvidence, uncertainty,
    fittedProfiles, profileResidualRms: fittedProfiles ? round(Math.sqrt(residual / fittedProfiles)) : null,
    searchLimited, overridden };
}

function effective(asset, row, patch) {
  return { ...asset.rows[row], ...patch };
}

function rgbPacked(rgb) {
  return rgb.reduce((n, c, i) => n | (c << (8 * i)), 0);
}

function render(cloud, api, asset, input) {
  if (!fields(input, ['width', 'height', 'camera', 'light', 'mode', 'captured', 'transparent']))
    throw new TypeError('Invalid cloud material view settings');
  const { width: w = 192, height: h = 192, camera, mode = 'relit', captured = 0, transparent = false } = input;
  if (![w, h].every(n => integer(n, 8, 768)) || camera !== undefined && !record(camera) ||
      !modes.includes(mode) || typeof transparent !== 'boolean')
    throw new RangeError('Invalid or over-budget cloud material view');
  number(captured, 0, 1, 'Captured blend');
  const lum = input.light === undefined ? light(asset.illumination) : lightInput(input.light);
  const world = api.gaussianSplatWorld(cloud, { colorMode: 'rgb' });
  const options = { w, h, px: 1, raw: true, lockCamera: true, transparent, camera, snap: false,
    gaussianFilter: { footprint: 'compensated' } };
  const resolved = Camera.frame(world, options, w, h), { eye, back } = resolved.pose;
  const view = { eye, back, ortho: resolved.ortho };
  const patches = new Map(asset.overrides.map(({ row, ...data }) => [row, data]));
  for (let i = 0; i < world.count; i++) {
    const at = i * 16, data = effective(asset, i, patches.get(i));
    let rgb;
    if (mode === 'captured' || mode === 'relit' && captured === 1) {
      rgb = api.gaussianSplatColors(world, i, view).rgb;
    } else if (mode === 'normals') {
      rgb = data.normal.map(v => Math.round(127.5 + 127.5 * v));
    } else if (mode === 'roughness') {
      rgb = [1, 1, 1].map(() => Math.round(255 * data.roughness));
    } else if (mode.endsWith('-uncertainty')) {
      const score = data.uncertainty[mode.split('-')[0]];
      rgb = [46 + 203 * score, 205 - 108 * score, 187 - 122 * score].map(Math.round);
    } else {
      const toward = resolved.ortho ? back : normalize(eye.map((n, k) => n - world.data[at + k]));
      let color = mode === 'pigment' ? data.pigment : Fit.shade(data, toward, lum);
      if (mode === 'relit' && captured) {
        const original = Fit.toLinear(api.gaussianSplatColors(world, i, view).rgb.map(n => n / 255));
        color = color.map((n, k) => n * (1 - captured) + original[k] * captured);
      }
      rgb = Fit.toDisplay(color).map(n => Math.round(255 * clamp(n)));
    }
    world.data[at + 7] = rgbPacked(rgb);
  }
  const frame = Render.render(world, options);
  return PNG.encodeFrame(PNG.packFrame(frame));
}

async function loadCapture(file, expected) {
  const bytes = read(file, maxBytes), sha256 = digest(bytes);
  if (expected && sha256 !== expected.sha256) throw new RangeError('Captured Gaussian fingerprint differs from the material asset');
  const api = await import('../src/gaussian-splats.mjs');
  const cloud = await api.decodeGaussianSplat(bytes, { maxPoints: maxRows });
  if (expected && (cloud.count !== expected.count || cloud.degree !== expected.degree))
    throw new RangeError('Captured Gaussian row layout differs from the material asset');
  return { cloud, bytes, sha256, api };
}

function publish(directory, asset, bytes, inputs) {
  const output = graphOutputs(inputs), release = claim(directory, 'cloud material recovery');
  try {
    output.write(directory, [{ file: asset.source.file, bytes }, { file: 'material.json', document: asset },
      { file: 'report.json', document: report(asset) }]);
  } finally {
    release();
  }
}

async function command(pos, opt) {
  const [action, filename, extra] = pos;
  const length = { recover: 2, override: 3, render: 3, inspect: 2 }[action];
  const options = action === 'recover' ? ['out', 'plan'] : action === 'inspect' ? ['row'] : ['out'];
  if (!length || pos.length !== length || Object.keys(opt).some(key => !options.includes(key)) ||
      action !== 'inspect' && (typeof opt.out !== 'string' || !opt.out) ||
      opt.plan !== undefined && (typeof opt.plan !== 'string' || !opt.plan))
    throw new TypeError('See ink-studio help for cloud-materials recover, override, render and inspect');
  const input = path.resolve(filename), out = opt.out && path.resolve(opt.out);
  if (action === 'recover') {
    const { cloud, bytes, sha256, api } = await loadCapture(input);
    const plan = opt.plan && path.resolve(opt.plan), settings = config(plan ? json(plan, 1_000_000) : {}, cloud.count);
    const { light: illumination, rows } = Fit.recover(api.gaussianSplatWorld(cloud, { colorMode: 'rgb' }), settings, api.shBasis);
    const asset = validateAsset({ format, version: 1, source: { file: cloud.format === 'ply' ? 'capture.ply' : 'capture.spz',
      sha256, count: cloud.count, degree: cloud.degree }, settings, illumination, rows, overrides: [] });
    publish(out, asset, bytes, plan ? [input, plan] : [input]);
    console.log('Recovered ' + rows.length + ' Gaussian materials in ' + out);
    return;
  }
  const asset = validateAsset(json(input, maxBytes)), capture = path.join(path.dirname(input), asset.source.file);
  if (action === 'inspect') {
    const row = Number(opt.row);
    if (opt.row !== undefined && (typeof opt.row !== 'string' || !opt.row.trim() || !integer(row, 0, asset.rows.length - 1)))
      throw new RangeError('Invalid cloud material row');
    const change = asset.overrides.find(entry => entry.row === row);
    const override = Object.fromEntries(channels.filter(name => change && Object.hasOwn(change, name)).map(name => [name, change[name]]));
    console.log(JSON.stringify(opt.row === undefined ? report(asset) :
      { source: asset.source.sha256, row, recovered: asset.rows[row], override, effective: effective(asset, row, override) }, null, 2));
    return;
  }
  const spec = path.resolve(extra), data = json(spec, action === 'override' ? 16_000_000 : 1_000_000);
  const { cloud, bytes, api } = await loadCapture(capture, asset.source);
  if (action === 'override') {
    const adjusted = edits(asset, data);
    publish(out, adjusted, bytes, [input, spec, capture]);
    console.log('Saved ' + adjusted.overrides.length + ' overridden rows in ' + out);
  } else {
    const bytes = render(cloud, api, asset, data);
    graphOutputs([input, spec, capture]).write(path.dirname(out), [{ file: path.basename(out), bytes }]);
    console.log('Rendered ' + out);
  }
}

module.exports = { command };
