const fs = require('node:fs');
const path = require('node:path');
const { readGltfAsset } = require('./gltf-asset.js');
const files = require('./asset-files.js');

const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const sourcePath = (scene, source) => path.resolve(path.dirname(path.resolve(scene)), source);

function revision(asset, file) {
  const result = asset.assetRevision();
  if (!result) throw new RangeError('Missing Ink asset revision manifest in ' + file);
  return result;
}

async function loadSceneParts(scene, file, { toolkit, onFile } = {}) {
  const rows = Object.entries(toolkit.KIT.authoring.assetRevisions.placements(scene)), sources = new Map();
  if (!rows.length) return {};
  const { gltfAssetPart } = await import('../src/gaussian-gltf.mjs');
  const decodeImage = require('./gltf-image.js');
  return Object.fromEntries(await Promise.all(rows.map(async ([id, row]) => {
    const location = sourcePath(file, row.file);
    if (!sources.has(location)) sources.set(location, readGltfAsset(location, { onFile }));
    return [id, await gltfAssetPart(sources.get(location), id, row, { toolkit, decodeImage })];
  })));
}

async function command([mode, file, instance, replacement, ...rest], { out, expect }, { KIT }) {
  const api = KIT.authoring.assetRevisions;
  const write = value => out ? files.json(path.resolve(out), value) : process.stdout.write(JSON.stringify(value, null, 2) + '\n');
  if (out !== undefined && (typeof out !== 'string' || !out.trim())) throw new TypeError('--out needs a filename');
  if (mode === 'manifest' && file && instance === undefined && expect === undefined) {
    const manifest = revision(readGltfAsset(file), file).manifest;
    if (out && path.resolve(out) === path.resolve(file)) throw new RangeError('Choose a separate manifest output');
    return write(manifest);
  }
  if (!['preview', 'replace'].includes(mode) || !file || !instance || !replacement || rest.length)
    throw new TypeError('Use asset-part manifest <asset> or asset-part preview|replace <scene.json> <instance> <asset>');
  const directory = path.dirname(path.resolve(file));
  const output = out && path.resolve(out);
  if (mode === 'replace' && (!output || path.dirname(output) !== directory || !/\.json$/i.test(output) || output === path.resolve(file)))
    throw new TypeError('Use --out with a new scene JSON beside the source so relative scene assets resolve');
  if (output && [path.resolve(file), path.resolve(replacement)].includes(output))
    throw new RangeError('Choose a separate output file');
  const scene = read(file);
  const placements = api.placements(scene);
  if (!Object.hasOwn(placements, instance)) throw new RangeError('Unknown asset placement ' + instance);
  const row = placements[instance], oldFile = sourcePath(file, row.file);
  if (output === oldFile) throw new RangeError('Choose a separate output file');
  const current = revision(readGltfAsset(oldFile), oldFile), candidate = readGltfAsset(replacement), next = revision(candidate, replacement);
  const nextFile = path.relative(directory, path.resolve(replacement)).split(path.sep).join('/');
  const options = { instance, current, next, file: nextFile, ...(expect !== undefined && { expect: Number(expect) }) };
  if (expect !== undefined && (typeof expect !== 'string' || !/^\d+$/.test(expect) || !Number.isSafeInteger(Number(expect)) || Number(expect) < 1))
    throw new TypeError('--expect needs a positive revision number');
  const report = api.preview(scene, options);
  if (report.canReplace) {
    const { gltfAssetPart } = await import('../src/gaussian-gltf.mjs');
    try {
      await gltfAssetPart(candidate, instance, { ...row, file: nextFile, revision: report.toRevision }, {
        toolkit: KIT, decodeImage: require('./gltf-image.js')
      });
    } catch (error) {
      report.canReplace = false;
      report.blockers.push({ code: 'unavailable-geometry', message: error.message });
    }
  }
  if (mode === 'preview') return write(report);
  if (!report.canReplace) throw new RangeError('Asset replacement blocked: ' + JSON.stringify(report.blockers));
  const result = api.replace(scene, options);
  files.publishJson(output, result.scene, 'A different scene already exists at ' + output);
  process.stdout.write(JSON.stringify({ scene: output, ...report }, null, 2) + '\n');
}

module.exports = { command, loadSceneParts };
