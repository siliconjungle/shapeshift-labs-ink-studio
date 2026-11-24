const fs = require('node:fs');
const path = require('node:path');
const { json } = require('./asset-files.js');

const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));

function command([mode, file, ...args], { out, previous }, { KIT }) {
  const api = KIT.authoring.hybridOwnership;
  if (!file || !['inspect', 'route', 'plan'].includes(mode) || out !== undefined && typeof out !== 'string' ||
      previous !== undefined && (mode !== 'plan' || typeof previous !== 'string'))
    throw new TypeError('Use hybrid-ownership inspect|route|plan with a scene or ownership document');
  const source = read(file), manifest = api.prepare(source.hybridOwnership ?? source);
  let result;
  if (mode === 'inspect' && !args.length) result = manifest;
  else if (mode === 'route' && args.length === 3) {
    const [object, part, channel] = args;
    result = api.route(manifest, { object, part, channel });
  } else if (mode === 'plan' && args.length === 1) {
    result = api.plan(manifest, read(args[0]), previous === undefined ? undefined : read(previous));
  } else throw new TypeError('Use inspect <scene>, route <scene> <object> <part> <channel>, or plan <scene> <revisions.json>');
  const inputs = mode === 'plan' ? [file, args[0], previous] : [file];
  if (out && inputs.some(input => input && path.resolve(input) === path.resolve(out)))
    throw new Error('Write the hybrid report to a separate output file');
  if (out) json(out, result);
  else process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

module.exports = { command };
