const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { json } = require('./asset-files.js');
const WAV = require('./wav.js');

const waveKinds = Object.freeze(['voice', 'sound']);
const graphKinds = format => format === 'wav' ? waveKinds :
  format === 'json' ? ['rig', 'scene', 'effect', 'graph', 'projection'] : [];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const parse = bytes => JSON.parse(bytes.toString('utf8'));
const relative = (owner, file) => path.resolve(path.dirname(owner), file);
const limit = 128 * 1024 * 1024;
function read(file) {
  if (fs.statSync(file).size > limit) throw new RangeError('Asset exceeds the 128 MiB byte budget: ' + file);
  return fs.readFileSync(file);
}

function open(api, file, { load = read, resolvePath = relative, onFile = () => {}, draft = false } = {}) {
  const registry = api.compile(parse(load(file)), { draft });
  onFile(file);
  function inspect(entry) {
    const filename = resolvePath(file, entry.file), bytes = load(filename), sha256 = hash(bytes);
    if (entry.sha256 !== undefined && entry.sha256 !== sha256)
      throw new Error('Asset SHA-256 mismatch for ' + api.key(entry) + ' (' + filename + ')');
    onFile(filename);
    return { entry, filename, bytes, sha256 };
  }
  return { entries: registry.entries, inspect, resolve: (ref, kind) => inspect(registry.bind(ref, kind)) };
}

function scope(api, owner, registryFile, options = {}) {
  const resolvePath = options.resolvePath ?? relative;
  if (registryFile !== undefined && !api.localFile(registryFile))
    throw new TypeError('assetRegistry needs a relative local path');
  const registry = registryFile === undefined ? undefined : open(api, resolvePath(owner, registryFile), options);
  return (ref, kind) => {
    if (!api.validRef(ref)) throw new TypeError('Expected an asset ID with an exact positive revision');
    if (!registry) throw new TypeError('Asset reference ' + api.key(ref) + ' needs an assetRegistry file');
    return registry.resolve(ref, kind);
  };
}

function visual(api, document, type, owner, onFile) {
  const { assetRegistry, ...content } = document;
  const resolve = scope(api, owner, assetRegistry, { onFile });
  return api.visual(assetRegistry === undefined ? document : content, type, (ref, kind) => parse(resolve(ref, kind).bytes));
}

function referenceArgument(api, value) {
  const match = /^@([^@]+)@([1-9]\d*)$/.exec(value);
  const ref = match && { asset: match[1], revision: Number(match[2]) };
  if (!api.validRef(ref)) throw new TypeError('Use @namespace/name@revision');
  return ref;
}

async function validateContent({ entry, bytes }, kit) {
  if (entry.kind === 'voice' || entry.kind === 'sound') return WAV.decode(bytes);
  const document = parse(bytes);
  if (entry.kind === 'projection') return require('./patch-show-config.js').projectionSurfaces(document);
  if (entry.kind === 'effect' && Array.isArray(document)) return;
  if (!document || Object.getPrototypeOf(document) !== Object.prototype)
    throw new TypeError('Expected a JSON object for ' + entry.kind + ' asset');
  if (entry.kind === 'rig') {
    if (Object.hasOwn(document, 'shots')) kit.KIT.cameraRig.compile(document);
    else {
      const errors = kit.KIT.diorama.check({ id: 'asset-rig', style: 'slate', solids: [], parts: document })
        .filter(problem => problem.level === 'error');
      if (errors.length) throw new TypeError(kit.KIT.diorama.report(errors));
    }
  }
  if (entry.kind === 'graph' && (document.format !== 'ink-studio/graph-project' || document.version !== 1))
    throw new TypeError('Graph asset needs a version 1 graph project');
  if (entry.kind === 'scene' && (typeof document.id !== 'string' || document.format !== undefined))
    throw new TypeError('Scene asset needs a named JSON diorama');
}

async function command([mode, file, asset, rev, ...rest], options, kit) {
  const { out } = options;
  if (!file || rest.length || !['lock', 'validate', 'resolve'].includes(mode) ||
      Object.keys(options).some(key => key !== 'out') || out !== undefined && (typeof out !== 'string' || !out.trim()) ||
      mode === 'lock' && out === undefined || (mode === 'resolve' ? !asset || !rev : asset !== undefined))
    throw new TypeError('Use assets lock <draft.json> --out catalog.json, assets validate <catalog.json>, or assets resolve <catalog.json> <ID> <revision>');
  const source = path.resolve(file), destination = out && path.resolve(out), api = kit.KIT.authoring.assetReferences;
  const inputs = new Set();
  const registry = open(api, source, { draft: mode === 'lock', onFile: file => inputs.add(file) });
  let result;
  if (mode === 'resolve') {
    const resolved = registry.resolve(referenceArgument(api, '@' + asset + '@' + rev));
    await validateContent(resolved, kit);
    result = resolved.entry;
  } else {
    const entries = [];
    for (const entry of registry.entries) {
      const resolved = registry.inspect(entry);
      await validateContent(resolved, kit);
      const file = mode === 'lock' && path.dirname(destination) !== path.dirname(source) ?
        path.relative(path.dirname(destination), resolved.filename).split(path.sep).join('/') : entry.file;
      entries.push({ ...entry, file, sha256: resolved.sha256 });
    }
    result = { format: api.format, version: 1, ...(mode === 'validate' && { valid: true }), entries };
    if (mode === 'lock') api.compile(result);
  }
  if (destination) {
    const target = fs.statSync(destination, { throwIfNoEntry: false });
    for (const file of inputs) {
      const input = target && fs.statSync(file);
      if (destination === file || input && target.dev === input.dev && target.ino === input.ino)
        throw new TypeError('Choose an asset registry output separate from its inputs');
    }
    json(destination, result);
  } else process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

module.exports = { open, scope, visual, parse, hash, referenceArgument, command, waveKinds, graphKinds };
