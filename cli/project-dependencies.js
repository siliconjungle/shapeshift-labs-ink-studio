/* Discover typed project references while preserving their original relative paths. */
const path = require('node:path');
const { createHash } = require('node:crypto');
const Shot = require('./shot-recipes.js');
const { validateTake } = require('./take-document.js');
const { resolveCheckpoint } = require('./checkpoint-file.js');

const formats = {
  'ink-studio/take': 'take',
  'ink-studio/world': 'world',
  'ink-studio/graph-project': 'graph',
  'ink-studio/graph-group': 'group',
  'ink-studio/scene-audio': 'audio',
  'ink-studio/shot-recipe': 'shot',
  'ink-studio/checkpoint-ref': 'checkpoints',
  'ink-studio/checkpoint': 'checkpoints',
  'ink-studio/take-checkpoint': 'checkpoints',
  'ink-studio/raster-checkpoint': 'checkpoints',
  'ink-studio/run': 'checkpoints',
  'ink-studio/asset-pack': 'look',
  'ink-studio/asset-bundle': 'look',
  'ink-studio/input-recording': 'inputs'
};
const bytes = record => Buffer.from(record.data, record.encoding);
const digest = record => createHash('sha256').update(bytes(record)).digest('hex');
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const values = value => Object.values(value ?? {});

function collectDependencies(bundles, entry, get, attachments = {}) {
  const { resolvePath } = bundles, visited = new Map(), atlasPaths = new Set();
  const virtualRoot = path.resolve(path.sep, 'ink-project');
  const requireFile = name => {
    const value = get(name);
    if (!value) throw new Error('Missing project file: ' + name);
    return value;
  };

  function directoryAnchor(owner, ref) {
    if (typeof ref !== 'string') throw new TypeError('Expected a project directory path');
    return resolvePath(owner, (ref || '.') + '/.ink-root');
  }

  function datasetFiles(file, data) {
    for (const dataset of values(data)) if (dataset?.file !== undefined)
      requireFile(resolvePath(file, dataset.file));
  }

  function shot(file, document) {
    const recipe = Shot.validate(document);
    const anchor = directoryAnchor(file, recipe.project);
    const inputs = new Set();
    for (const { file: ref, sha256 } of recipe.inputs) {
      const name = resolvePath(anchor, ref);
      if (/(?:^|\/)ink-studio\.config\.js$/i.test(name))
        throw new TypeError('A portable shot needs declarative project settings: ' + file);
      if (digest(requireFile(name)) !== sha256) throw new Error('Shot input is missing or changed: ' + name);
      inputs.add(name);
      visit(name);
    }
    if (!/^[\w.-]+$/.test(recipe.scene) || /\.json$/i.test(recipe.scene)) {
      const target = resolvePath(anchor, recipe.scene);
      if (!/\.json$/i.test(target) && !/\.(?:obj|gltf|glb)$/i.test(target))
        throw new TypeError('A portable shot needs a declarative scene or mesh: ' + target);
      visit(target);
    } else if (/\.(?:js|cjs|mjs)$/i.test(recipe.scene)) {
      throw new TypeError('A portable shot needs a declarative scene: ' + recipe.scene);
    }
    for (const [key, value] of Object.entries(recipe.options)) if (typeof value === 'string') {
      if (key === 'dir' || key === 'asset-cache') {
        directoryAnchor(anchor, value);
      } else if (Shot.fileOption(key) && (/[\\/]/.test(value) || /\.(?:json|png|cube)$/i.test(value))) {
        const file = resolvePath(anchor, value);
        if (key === 'look' && !/\.(?:json|png|cube)$/i.test(value) && !inputs.has(file)) continue;
        if (!inputs.has(file)) throw new TypeError('Portable shots need a fingerprint for ' + file);
        if (key === 'horizon-bands') {
          const horizon = JSON.parse(bytes(requireFile(file)).toString('utf8'));
          for (const band of horizon?.bands ?? []) if (typeof band?.image === 'string')
            requireFile(resolvePath(file, band.image));
        }
      }
    }
  }

  function visit(file, expected, json = false) {
    if (visited.has(file)) {
      if (expected && expected !== visited.get(file)) throw new TypeError('Unexpected project dependency type: ' + file);
      return;
    }
    const raw = requireFile(file);
    const document = /\.json$/i.test(file) || expected || json ? JSON.parse(bytes(raw).toString('utf8')) : undefined;
    const kind = document && Object.hasOwn(formats, document.format) ? formats[document.format] :
      document && document.format === undefined && expected === 'world' ? 'world' :
      document && (file === entry || Array.isArray(document.solids) || document.brushRegion || document.prefabLibrary || document.instances)
        ? 'scene' : undefined;
    if (expected && expected !== kind) throw new TypeError('Unexpected project dependency type: ' + file);
    visited.set(file, kind);
    const follow = (ref, type) => { if (ref !== undefined) visit(resolvePath(file, ref), type); };

    if (kind === 'take') {
      validateTake(document);
      follow(document.world, 'world');
      follow(document.graph, 'graph');
      follow(document.audio, 'audio');
      follow(document.assetPack, 'look');
      follow(document.checkpoint, 'checkpoints');
      for (const ref of values(document.shots)) follow(ref, 'shot');
    } else if (kind === 'graph') {
      for (const group of values(document.groups)) if (typeof group === 'string') follow(group, 'group');
      for (const asset of values(document.assets)) {
        if (asset?.format === 'json') visit(resolvePath(file, asset.file), undefined, true);
        else requireFile(resolvePath(file, asset?.file));
      }
    } else if (kind === 'audio') {
      follow(document.world, 'world');
      for (const asset of values(document.assets)) {
        if (typeof asset === 'string') requireFile(resolvePath(file, asset));
        else if (record(asset)) follow(asset.graph, 'graph');
      }
    } else if (kind === 'world') {
      datasetFiles(file, document.dataInputs);
    } else if (kind === 'shot') {
      shot(file, document);
    } else if (kind === 'checkpoints') {
      if (document.format === 'ink-studio/checkpoint-ref') directoryAnchor(file, document.store);
      const data = resolveCheckpoint(path.join(virtualRoot, file), document, {
        readBlock(block) {
          const name = path.relative(virtualRoot, block).split(path.sep).join('/');
          return bytes(requireFile(resolvePath('', name)));
        }
      });
      for (const world of [data.world, data.world?.world, data.origin?.world, data.end?.world])
        if (world?.dataInputs) datasetFiles(file, world.dataInputs);
    } else if (kind === 'scene') {
      for (const name of bundles.collect(file, get, {}, { validate: file === entry }).atlasPaths) atlasPaths.add(name);
    } else if (kind === undefined) {
      bundles.collectAttachment(file, get);
    }
  }
  visit(entry);
  for (const file of values(attachments)) visit(file);
  return { atlasPaths };
}

module.exports = { collectDependencies };
