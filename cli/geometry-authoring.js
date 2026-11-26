const fs = require('node:fs');
const path = require('node:path');
const files = require('./asset-files.js');

const read = file => JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
const print = value => process.stdout.write(JSON.stringify(value, null, 2) + '\n');

function options(opt, keys, inputs) {
  if (Object.entries(opt).some(([key, value]) => !keys.includes(key) || typeof value !== 'string' || !value.trim()))
    throw new TypeError('Invalid or missing option for this authoring command');
  const destinations = [opt.out, opt.report].filter(Boolean).map(file => path.resolve(file));
  if (new Set(destinations).size !== destinations.length ||
      destinations.some(file => inputs.some(input => input && file === path.resolve(input))))
    throw new RangeError('Write results and reports separately from each other and their inputs');
}

function publish(opt, result, report) {
  if (opt.out) files.json(path.resolve(opt.out), result);
  else print(result);
  if (opt.report) files.json(path.resolve(opt.report), report);
}

function bend([source, request, ...extra], opt, api) {
  if (!source || !request || extra.length || opt.at === undefined)
    throw new TypeError('Use curve bend <splines.json> <bend.json> --at seconds');
  options(opt, ['at', 'out', 'report'], [source, request]);
  const { document, report } = api.create(read(source), read(request)).sample(Number(opt.at));
  publish(opt, document, report);
}

function surface([action, source, request, ...extra], opt, api) {
  const edit = action === 'edit', sample = action === 'sample', mesh = action === 'mesh';
  if (!source || extra.length || (!edit && !sample && !mesh && action !== 'inspect') ||
      Boolean(request) !== (edit || sample))
    throw new TypeError('Use surface inspect|mesh <patch.json> or surface edit|sample <patch.json> <request.json>');
  const keys = ['out'];
  if (edit || mesh) keys.push('report');
  if (mesh) keys.push('resolution');
  options(opt, keys, [source, request]);

  const doc = api.create(read(source));
  if (edit) {
    const { document, report } = api.edit(doc, read(request));
    publish(opt, document, report);
  } else if (mesh) {
    const { geometry, report } = api.mesh(doc, { resolution: opt.resolution === undefined ? undefined : Number(opt.resolution) });
    publish(opt, geometry, report);
  } else if (sample) {
    const uv = read(request);
    if (!Array.isArray(uv) || !uv.length || uv.length > 4096) throw new RangeError('Supply 1 to 4096 UV pairs');
    publish(opt, { ...api.inspect(doc), samples: uv.map(pair => api.sample(doc, pair)) });
  } else {
    publish(opt, api.inspect(doc));
  }
}

function attributes([action, source, request, ...extra], opt, api) {
  const edit = action === 'edit', init = action === 'init';
  if (!source || extra.length || (!edit && !init && action !== 'inspect') || ((edit || init) && !request))
    throw new TypeError('Use attributes init|edit <source.json> <request.json> or attributes inspect <asset.json> [selection.json]');
  options(opt, edit ? ['out', 'report'] : ['out'], [source, request]);
  const input = read(source), settings = request && read(request);
  if (edit) {
    const { asset, report } = api.edit(input, settings);
    publish(opt, asset, report);
  } else {
    publish(opt, init ? api.initialize(input, settings) : api.inspect(input, settings));
  }
}

module.exports = { bend, surface, attributes };
