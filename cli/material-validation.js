const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const PNG = require('./png.js');

const origin = { kind: 'input' };
const imageOf = (packet, channel) => packet?.channels?.[channel]?.raster;
const nodePath = (scope, node) => scope.path ? scope.path + '/' + node : node;

// Object identity proves transport through a pack, subgraph or other pass-through.
function carries(value, image, depth = 5) {
  if (value === image) return true;
  if (!depth || !value || typeof value !== 'object' || ArrayBuffer.isView(value) ||
      value.format === 'ink-studio/graph-image' || value.data || Array.isArray(value) && value.length > 256) return false;
  return Object.values(value).some(child => carries(child, image, depth - 1));
}

function ownerAt(rows, p) {
  let low = 0, high = rows.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (rows[middle][0] < p) low = middle + 1;
    else high = middle;
  }
  return rows[low]?.[0] === p ? rows[low][1] : undefined;
}

function trace(scope, binding, image, channel, depth = 2000) {
  const info = source => ({ origin: source, at: () => source, *clips() {} });
  if (!binding || !depth) return info(origin);
  if (binding.kind === 'value') return info({ kind: 'literal', ...(scope.path && { node: scope.path }) });
  if (binding.kind === 'input') return scope.parent ?
    trace(scope.parent, scope.call.inputs[binding.input], image, channel, depth - 1) :
    info({ kind: 'input', input: binding.input });
  if (binding.kind !== 'node') return info(origin);
  const { node, port } = binding, stage = scope.frame.stage(node), path = nodePath(scope, node);
  const child = scope.frame.inspectGroup(node);
  if (child?.outputSource(port)) return trace({ frame: child, parent: scope, call: stage, path },
    child.outputSource(port), image, channel, depth - 1);
  const producer = { kind: 'node', node: path, port, operation: stage.op };
  if (stage.op === 'bitmapAsset' && typeof stage.inputs.name?.value === 'string')
    producer.asset = stage.inputs.name.value;
  if (stage.op === 'material.paint' && imageOf(stage.outputs.value, channel) === image) {
    const { source } = stage.inputs, upstream = imageOf(source.value, channel);
    const evidence = stage.outputs.report?.diagnostics, rows = evidence?.channels[channel];
    const sameContract = upstream === image || upstream?.descriptor && image?.descriptor &&
      JSON.stringify(upstream.descriptor) === JSON.stringify(image.descriptor);
    const before = upstream && sameContract ? trace(scope, source, upstream, channel, depth - 1) : info(producer);
    const brush = index => {
      const layer = evidence?.layers[index];
      return layer ? { ...producer, kind: 'brush', layer: layer.id, label: layer.label } : producer;
    };
    return {
      origin: sameContract ? before.origin : producer,
      at(p) {
        const owner = rows && ownerAt(rows.owners, p);
        return owner === undefined ? before.at(p) : brush(owner);
      },
      *clips() {
        const own = new Set();
        for (const [p, layer, min, max] of rows?.clips ?? []) {
          own.add(p);
          yield { p, min, max, source: brush(layer) };
        }
        for (const clip of before.clips()) if (!own.has(clip.p) && (!rows || ownerAt(rows.owners, clip.p) === undefined))
          yield clip;
      }
    };
  }
  if (stage.op === 'image.convert' && stage.outputs.value === image) {
    const source = stage.inputs.source;
    const before = trace(scope, source, source.value, channel, depth - 1);
    return { ...info(producer), *clips() {
      const measured = stage.outputs.materialClips ?? [], own = new Set(measured.map(row => row[0]));
      for (const clip of before.clips()) if (clip.code !== 'conversion-clipping' || !own.has(clip.p)) yield clip;
      for (const [p, min, max] of measured) yield { p, min, max, source: producer, code: 'conversion-clipping' };
    } };
  }
  const inputs = Object.values(stage.inputs).filter(input => carries(input.value, image));
  return inputs.length === 1 ? trace(scope, inputs[0], image, channel, depth - 1) : info(producer);
}

function targetScope(frame, node, port) {
  const names = node.split('/');
  let scope = { frame, path: '' };
  for (const name of names.slice(0, -1)) {
    const call = scope.frame.stage(name), child = scope.frame.inspectGroup(name);
    if (!child) throw new RangeError('Unknown material validation group ' + node);
    scope = { frame: child, parent: scope, call, path: nodePath(scope, name) };
  }
  return { scope, binding: { kind: 'node', node: names.at(-1), port } };
}

function validation(profile, usageRows, target) {
  if (profile === null || typeof profile !== 'object' || Array.isArray(profile) ||
      Object.hasOwn(profile, 'maps') && (!profile.maps || typeof profile.maps !== 'object' || Array.isArray(profile.maps)))
    throw new TypeError('Invalid material validation profile');
  const mapRules = {}, rank = value => value.format === 'png' ||
    value.format === 'tiff' && (value.bitDepth ?? 16) <= 16 ? 2 : value.format === 'exr' && value.bitDepth === 16 ? 1 : 0;
  for (const row of usageRows) {
    if (!row.export || !row.source || row.source.output !== target.output || !row.source.channel && !target.channel) continue;
    const name = row.source.channel ?? target.channel;
    if (target.channel && target.channel !== name) continue;
    if (!Object.hasOwn(mapRules, name) || rank(row.format) > rank(mapRules[name].delivery)) mapRules[name] = { delivery: row.format };
  }
  for (const [name, rules] of Object.entries(profile.maps ?? {})) {
    if (!rules || typeof rules !== 'object' || Array.isArray(rules) || ['__proto__', 'prototype', 'constructor'].includes(name))
      throw new TypeError('Invalid validation rules for ' + name);
    mapRules[name] = { ...mapRules[name], ...rules };
  }
  return { ...profile, maps: mapRules };
}

function artifact(file, bytes) {
  return { file, bytes, sha256: createHash('sha256').update(bytes).digest('hex') };
}

function review(P, frame, selection, profile, header, preview) {
  const { output, node, port, channel } = selection;
  const { scope, binding } = output !== undefined ? { scope: { frame, path: '' }, binding: frame.outputSource(output) } :
    targetScope(frame, node, port);
  const value = output !== undefined ? frame.outputs[output] : frame.preview(node, port);
  const selected = channel ? imageOf(value, channel) ?? (value?.channels ? undefined : value) : undefined;
  if (channel && !selected) throw new RangeError('Unknown material channel ' + channel);
  const source = channel ? { [channel]: selected } : value;
  const candidates = P.materialValidation.inspect(source, profile, {
    preview, provenance: (name, image) => trace(scope, binding, image, name)
  });
  return deliver({ ...header, ...candidates.report, target: selection }, candidates.rasters, preview);
}

function failed(error, target, header, preview) {
  const source = { kind: error.graphMaterialLayer ? 'brush' : 'node', node: error.graphMaterialNode,
    ...(error.graphMaterialPort && { port: error.graphMaterialPort }),
    ...(error.graphMaterialLayer && { layer: error.graphMaterialLayer.id, label: error.graphMaterialLayer.label }) };
  const finding = { id: 'evaluation', code: 'evaluation', severity: 'error', message: error.message, count: 1,
    sources: [{ ...source, count: 1 }], examples: [], ...(error.graphMaterialLayer && { channel: error.graphMaterialLayer.channel }) };
  return deliver({ ...header, target, valid: false, errors: 1, warnings: 0, maps: {}, findings: [finding] }, {}, preview);
}

function deliver(report, rasters, preview) {
  const artifacts = [];
  const add = (file, bytes) => { artifacts.push(artifact(file, bytes)); return file; };
  let index = 0;
  for (const [name, { width, height, data, masks }] of Object.entries(rasters)) {
    const row = report.maps[name];
    row.preview = add('artifacts/map-' + index++ + '.png', PNG.encode(width, height, data, 4));
    for (const finding of report.findings.filter(item => item.channel === name)) {
      const mask = masks[finding.id];
      if (mask) {
        finding.mask = add('artifacts/issue-' + index + '.png', PNG.encodeGray(width, height, mask.map(n => n ? 255 : 0)));
        if (finding.sources.length > 1)
          finding.sourceMask = add('artifacts/source-' + index + '.png', PNG.encodeGray(width, height, mask));
        index++;
      }
    }
  }
  if (preview) {
    const images = Object.fromEntries(artifacts.map(({ file, bytes }) => [file, 'data:image/png;base64,' + bytes.toString('base64')]));
    add('index.html', fs.readFileSync(path.join(__dirname, 'material-validation.html')));
    add('review.js', Buffer.from('const review = ' + JSON.stringify(report).replaceAll('<', '\\u003c') +
      ';\nconst previewImages = ' + JSON.stringify(images) + ';\n'));
    report.review = 'index.html';
  }
  report.artifacts = artifacts.map(({ file, sha256, bytes }) => ({ file, sha256, bytes: bytes.length }));
  return { report, artifacts };
}

module.exports = { validation, review, failed };
