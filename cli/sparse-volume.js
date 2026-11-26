const fs = require('node:fs');
const path = require('node:path');
const files = require('./asset-files.js');

const actions = { inspect: 1, sample: 2, pack: 1, combine: 3, resample: 2, export: 2 };
const settings = (v, allowed) => v && [Object.prototype, null].includes(Object.getPrototypeOf(v)) &&
  Object.keys(v).every(key => allowed.includes(key));
function need(ok, message) {
  if (!ok) throw new RangeError('Volume command: ' + message);
}

function read(file, maxBytes) {
  const bytes = fs.statSync(file);
  need(bytes.isFile() && bytes.size <= maxBytes, 'input exceeds its file byte budget');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function publish(opt, result, report) {
  if (opt.out) files.write(path.resolve(opt.out), JSON.stringify(result) + '\n');
  else process.stdout.write(JSON.stringify(result, null, ['inspect', 'sample'].includes(opt.action) ? 2 : 0) + '\n');
  if (opt.report) files.json(path.resolve(opt.report), report);
}

function exportField(K, api, doc, request) {
  need(request && ['sparse', 'dense', 'slice', 'isosurface'].includes(request.kind),
    'choose sparse, dense, slice or isosurface export');
  const { kind, ...config } = request;
  if (kind === 'sparse' || kind === 'dense') {
    need(settings(config, kind === 'dense' ? ['channels', 'maxCells'] : ['channels']), 'unexpected export setting');
    const result = kind === 'sparse' ? api.extract(doc, config.channels) : api.dense(doc, config);
    const view = api.inspect(kind === 'sparse' ? result : api.extract(doc, config.channels));
    return { result, report: { kind, channels: Object.keys(result.fields), logicalCells: view.logicalCells,
      storedComponents: view.storedComponents, ...(kind === 'dense' && { maxCells: config.maxCells ?? 250000 }) } };
  }
  const common = ['channel', 'filter', 'component'];
  need(settings(config, common.concat(kind === 'slice' ? ['plane', 'counts'] :
    ['level', 'inside', 'resolution', 'maxCells', 'maxTriangles', 'edgeRefinements'])), 'unexpected export setting');
  const { channel, filter = 'linear', component, ...options } = config;
  let field = api.sampler(doc, { filter }).field(channel);
  if (field.type === 'vec3') {
    const axis = ['x', 'y', 'z'].indexOf(component);
    need(axis !== -1 || component === undefined || component === 'magnitude', 'velocity component must be x, y, z or magnitude');
    if (axis === -1) field = K.fieldViews.magnitude(field);
    else {
      const input = field;
      field = K.fieldViews.source({ ...input, type: 'number', sample: (x, y, z) => input.sample(x, y, z)?.[axis] });
    }
  } else need(component === undefined, 'only velocity has selectable components');
  if (kind === 'slice') {
    const view = K.fieldViews.slice(field, options);
    return { result: { ...view, channel, ...(channel === 'velocity' && { component: component ?? 'magnitude' }) },
      report: { kind, channel, filter, counts: view.counts, range: view.range } };
  }
  const { level = channel === 'signedDistance' ? 0 : channel === 'density' ? .5 : undefined,
    inside = channel === 'signedDistance' ? 'below' : 'above', ...meshOptions } = options;
  need(Number.isFinite(level), 'isosurface needs a finite level');
  const view = K.fieldViews.isosurface(field, { ...meshOptions, level, inside });
  const { positions, sampling } = view.mesh;
  const ids = new Map(), points = [], triangles = [];
  for (let i = 0; i < positions.length; i += 9) {
    triangles.push([0, 3, 6].map(offset => {
      const p = Array.from(positions.slice(i + offset, i + offset + 3)), key = p.join('/');
      if (!ids.has(key)) {
        ids.set(key, points.length);
        points.push(p);
      }
      return ids.get(key);
    }));
  }
  const faces = triangles.filter(face => new Set(face).size === 3);
  const result = { points, faces };
  return { result, report: { kind, channel, filter, level, inside, units: view.units, sampling,
    vertices: points.length, triangles: faces.length, collapsedTriangles: triangles.length - faces.length } };
}

module.exports = function volumeCLI([action, ...args], opt, { KIT: K }) {
  need(Object.hasOwn(actions, action) && args.length === actions[action], 'use inspect, sample, pack, combine, resample or export');
  const allowed = ['out'];
  if (['combine', 'pack', 'resample', 'export'].includes(action)) allowed.push('report');
  if (action === 'pack') allowed.push('max-cells');
  need(Object.entries(opt).every(([n, v]) => allowed.includes(n) && typeof v === 'string' && v.trim()), 'unexpected or incomplete option');
  const inputs = args.map(file => path.resolve(file)), outputs = [opt.out, opt.report].filter(Boolean).map(file => path.resolve(file));
  need(new Set(outputs).size === outputs.length && !outputs.some(file => inputs.includes(file)),
    'write results and receipts separately from their inputs');
  const api = K.procedural.sparseVolume, input = read(inputs[0], 128 * 1024 * 1024);
  const recipe = file => read(file, 2 * 1024 * 1024);
  let result, report;
  if (action === 'pack') {
    ({ document: result, report } = api.pack(input, { maxCells: opt['max-cells'] === undefined ? undefined : Number(opt['max-cells']) }));
  } else {
    const volume = api.create(input);
    if (action === 'inspect') result = api.inspect(volume);
    else if (action === 'combine') {
      const second = read(inputs[1], 128 * 1024 * 1024);
      ({ document: result, report } = api.combine(volume, second, recipe(inputs[2])));
    } else if (action === 'resample') {
      ({ document: result, report } = api.resample(volume, recipe(inputs[1])));
    } else if (action === 'sample') {
      const request = recipe(inputs[1]);
      need(settings(request, ['points', 'channels', 'filter']) && Array.isArray(request.points) &&
        request.points.length >= 1 && request.points.length <= 4096, 'sample recipe needs 1 to 4096 positions');
      const { points, channels: volumeFields = Object.keys(volume.fields), filter = 'linear' } = request;
      need(Array.isArray(volumeFields) && volumeFields.length > 0 && volumeFields.length <= Object.keys(volume.fields).length &&
        new Set(volumeFields).size === volumeFields.length && volumeFields.every(n => Object.hasOwn(volume.fields, n)),
      'field selection must name distinct declared fields');
      const { sample } = api.sampler(volume, { filter });
      result = { filter, fields: volumeFields, samples: points.map(point => ({
        point, values: Object.fromEntries(volumeFields.map(name => [name, sample(name, point)])) })) };
    } else ({ result, report } = exportField(K, api, volume, recipe(inputs[1])));
  }
  publish({ ...opt, action }, result, report);
};
