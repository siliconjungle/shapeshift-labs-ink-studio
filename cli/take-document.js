const fs = require('node:fs');
const path = require('node:path');
const { embed } = require('./data-inputs.js');
const { install } = require('./asset-pack.js');
const { embedModels } = require('./simulation-model-files.js');
const { embedStoryDocuments } = require('./story-document.js');
const Assets = require('./asset-references.js');

const format = 'ink-studio/take';
const plain = value => value !== null && typeof value === 'object' &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
const name = value => typeof value === 'string' && /^[a-z0-9][\w.-]{0,95}$/i.test(value) &&
  !['constructor', 'prototype', '__proto__'].includes(value);

function validateTake(spec) {
  const refs = ['world', 'graph', 'audio', 'assetPack', 'checkpoint'];
  if (!plain(spec) || spec.format !== format || spec.version !== 1 ||
      Object.keys(spec).some(key => !['format', 'version', 'id', 'clock', 'shots', 'simulation', 'assetRegistry', ...refs].includes(key)) ||
      spec.id !== undefined && !name(spec.id) ||
      refs.some(key => spec[key] !== undefined && !(typeof spec[key] === 'string' && spec[key].trim() ||
        key === 'graph' && plain(spec.graph) && Object.hasOwn(spec.graph,'asset'))) ||
      spec.assetRegistry !== undefined && (typeof spec.assetRegistry !== 'string' || !spec.assetRegistry.trim()) ||
      (spec.assetPack !== undefined || spec.simulation !== undefined) && spec.world === undefined ||
      spec.shots !== undefined && (!plain(spec.shots) || Object.keys(spec.shots).length > 1024 ||
        Object.entries(spec.shots).some(([key, file]) => !name(key) || typeof file !== 'string' || !file.trim())))
    throw new TypeError('Expected ink-studio/take version 1 with local document paths and named shots');
  return spec;
}

function resolveTakeFile(owner, spec, key, kit = require('../index.js').load(), onFile) {
  const ref = spec[key];
  if (typeof ref === 'string') return path.resolve(path.dirname(owner), ref);
  const api = kit.KIT.authoring.assetReferences;
  return Assets.scope(api, owner, spec.assetRegistry, { onFile })(ref, key).filename;
}

function readTakeWorld(file, spec, kit, dependency = () => {}) {
  if (spec.world === undefined) return;
  const location = path.resolve(path.dirname(file), spec.world);
  dependency(location);
  const model = embedModels(JSON.parse(fs.readFileSync(location, 'utf8')), location, dependency), K = kit.KIT;
  const document = embedStoryDocuments(Assets.visual(K.authoring.assetReferences, model, 'world', location, dependency),
    location, dependency);
  const world = document?.format === K.world.models.format ? { ...K.world.models.compile(document) } : document;
  if (world.dataInputs !== undefined) world.dataInputs = embed(K.dataInputs, world.dataInputs, location, dependency);
  if (spec.assetPack !== undefined) {
    const pack = path.resolve(path.dirname(file), spec.assetPack);
    dependency(pack);
    world.assetPacks = install(K.authoring.assetPacks, world.assetPacks, pack);
  }
  return world;
}

module.exports = { format, validateTake, readTakeWorld, resolveTakeFile };
