const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Ink = require('../..');
const { runBakeJob } = require('../../cli/bake-jobs.js');
const files = require('../../cli/asset-files.js');
const PNG = require('../../cli/png.js');
const { mesh, corrections } = require('./mesh.cjs');

const out = path.resolve(process.argv[2] ?? 'studio/out/smart-material-masks');
const at = file => path.join(out, file);
const size = 152;
const { names } = Ink.load().KIT.procedural.smartMasks;
const op = (op, inputs) => ({ op, inputs }), link = (node, port = 'value') => ({ node, port });
const input = input => ({ input });
const maps = {
  coverage: ['coverage', {}, { intent: 'mask' }],
  convex: ['curvature-convex', { encoding: 'exr', curvatureScale: .022 }, { intent: 'data', units: 'inverse-shape-units' }],
  concave: ['curvature-concave', { encoding: 'exr', curvatureScale: .022 }, { intent: 'data', units: 'inverse-shape-units' }],
  cavity: ['cavity', { samples: 24, cavityRadius: .16 }, { intent: 'mask' }],
  exposure: ['exposure', { samples: 24, exposureDistance: .24 }, { intent: 'mask' }],
  ao: ['ao', { encoding: 'png16', range: .22, rays: 20 }, { intent: 'mask' }],
  normal: ['world-normal', { encoding: 'exr' }, { intent: 'normal', normalSpace: 'world' }],
  position: ['position-world', {}, { intent: 'data', layout: 'xyz', vectorDomain: 'raw', units: 'shape-units' }],
  metalness: ['metalness', {}, { intent: 'mask' }]
};
const shared = { seed: 59 };
const defaults = {
  edgeWear: { ...shared, curvatureScale: .16, threshold: .4, softness: .43, breakup: .60, frequency: 41 },
  dirt: { ...shared, curvatureScale: .145, threshold: .5, softness: .52, breakup: .54, frequency: 25 },
  dust: { ...shared, threshold: .41, softness: .34, breakup: .42, frequency: 19 },
  rust: { ...shared, threshold: .29, softness: .57, breakup: .84, frequency: 39 },
  leaks: { ...shared, length: 1.62, threshold: .45, softness: .35, breakup: .37, frequency: 27 },
  slope: { minAngle: 44, maxAngle: 79, feather: 17 },
  waterline: { ...shared, level: -.35, width: .081, side: 'band', breakup: .86, frequency: 25 },
  exposure: { threshold: .66, softness: .6 }
};
const titles = { edgeWear: 'Edge wear', dirt: 'Dirt', dust: 'Dust', rust: 'Rust',
  leaks: 'Leaks', slope: 'Slope', waterline: 'Waterline', exposure: 'Exposure' };
const sources = {
  edgeWear: ['coverage', 'convex', 'exposure', 'position'],
  dirt: ['coverage', 'concave', 'cavity', 'ao', 'position'],
  dust: ['coverage', 'normal', 'exposure', 'position'],
  rust: ['coverage', 'metalness', 'cavity', 'ao', 'position'],
  leaks: ['coverage', 'source', 'position'],
  slope: ['coverage', 'normal'],
  waterline: ['coverage', 'position'],
  exposure: ['coverage', 'exposure']
};

async function main() {
  files.write(at('lock-nine.glb'), mesh());
  const correction = corrections(size);
  for (const [name, data] of Object.entries(correction)) files.write(at(name + '.png'), PNG.encodeGray(size, size, data));
  const job = { format: 'ink-studio/bake-job', version: 1, label: 'Lock Nine geometry bakes', source: 'lock-nine.glb',
    targets: [{ id: 'gate', mesh: 'Cast gate' }],
    preset: { format: 'ink-studio/bake-preset', version: 1, label: 'Smart mask evidence',
      defaults: { size, padding: 0 }, maps: Object.values(maps).map(([id, overrides]) => ({ id, overrides })) } };
  files.json(at('lock-nine.bake.json'), job);
  const baked = await runBakeJob(at('lock-nine.bake.json'), { directory: at('baked') });
  if (baked.status === 'cancelled') throw new Error('Lock Nine bake was cancelled');
  const folder = 'baked/revisions/' + baked.revision + '/';
  const bitmap = (file, interpretation) => ({ format: 'bitmap', source: { file }, interpretation });
  const assets = {};
  for (const [name, [id, , interpretation]] of Object.entries(maps)) {
    const row = baked.report.maps.find(row => row.map === id);
    assets[name] = bitmap(folder + row.file, interpretation);
  }
  for (const name of Object.keys(correction)) assets[name] = bitmap(name + '.png', { intent: 'mask' });
  const inputs = {}, nodes = {}, outputs = {};
  for (const name of Object.keys(assets)) {
    nodes[name + 'Map'] = op('bitmapAsset', { name });
    outputs[name + 'Map'] = link(name + 'Map');
  }
  const defaultMask = grayArray(new Uint8Array(size * size));
  for (const name of names) {
    inputs[name + 'Options'] = { type: 'record', default: defaults[name] };
    inputs[name + 'Paint'] = { type: 'grayImage', default: defaultMask };
    inputs[name + 'Protect'] = { type: 'grayImage', default: defaultMask };
    let add = input(name + 'Paint'), remove = input(name + 'Protect');
    if (name === 'rust') {
      const correctionNode = (id, authored, manual) => {
        nodes[id] = op('image.channelMath', { a: link(authored), b: input(manual), operation: 'max' });
        return link(id);
      };
      // Keep the user-painted correction editable without altering the baked or authored bitmaps.
      add = correctionNode('rustAdd', 'addMap', 'rustPaint');
      remove = correctionNode('rustRemove', 'removeMap', 'rustProtect');
    }
    nodes[name + 'Inputs'] = op('data.record', {
      ...Object.fromEntries(sources[name].map(source => [source, link(source + 'Map')])),
      ...(name === 'rust' && { moisture: link('leaks') })
    });
    nodes[name] = op('material.smartMask', { recipe: name, bakes: link(name + 'Inputs'),
      options: input(name + 'Options'), add, remove });
    for (const [suffix, port] of [['', 'value'], ['Raw', 'raw'], ['Evidence', 'evidence'], ['Info', 'report']])
      outputs[name + suffix] = link(name, port);
  }
  const graph = { format: 'ink-studio/graph-project', version: 1, inputs, nodes, assets, outputs };
  const saved = Ink.openMaterialGraph(graph, { id: 'lock-nine-smart-masks' });
  saved.label = 'Lock Nine';
  saved.settings.outputUsages = Object.fromEntries(names.map((name, order) => [name, {
    usage: 'mask.' + name, label: titles[name], order, source: { output: name }, format: { format: 'png', bitDepth: 16 }
  }]));
  const materialFile = at('lock-nine.material.json');
  Ink.writeMaterialGraph(materialFile, saved);
  const result = Ink.readGraphProject(materialFile).run();
  for (const name of names) {
    const report = result.outputs[name + 'Info'];
    assert(report.affected > 0 && report.affected <= report.covered, name + ' should select some baked surface');
  }
  assert(result.outputs.leaksInfo.routed > 6000);
  assert.notDeepEqual(result.outputs.rust.raster.data, result.outputs.rustRaw.raster.data);
  for (const artifact of result.artifacts) files.write(at('masks/' + artifact.file), artifact.bytes);
  const paintDefaults = new Set(Object.keys(inputs).filter(name => name.endsWith('Paint') || name.endsWith('Protect')));
  const browserInputs = Object.fromEntries(Object.entries(inputs).map(([name, rule]) =>
    [name, paintDefaults.has(name) ? { type: rule.type } : rule]));
  const browserNodes = { ...nodes };
  const packed = {};
  for (const name of Object.keys(assets)) {
    const key = name + 'Map', { raster, descriptor } = result.outputs[key];
    packed[key] = { width: raster.width, height: raster.height, channels: raster.channels, descriptor,
      bytes: Buffer.from(raster.data.buffer, raster.data.byteOffset, raster.data.byteLength).toString('base64') };
    browserNodes[key] = { op: 'data.typed', type: 'typedImage', inputs: { value: input('bake-' + name) } };
    browserInputs['bake-' + name] = { type: 'typedImage' };
  }
  files.write(at('data.js'), 'const demo = ' + JSON.stringify({ names, size, titles, defaults, packed,
    browser: { inputs: browserInputs, nodes: browserNodes, outputs }, bakeReview: folder + 'index.html' }) + ';\n');
  for (const name of ['index.html', 'live.js', 'preview.js']) files.write(at(name), fs.readFileSync(path.join(__dirname, name)));
  files.write(at('ink-studio.browser.js'), Ink.bundle());
  console.log(at('index.html'));
}

function grayArray(bytes) {
  return { format: 'ink-studio/graph-image', version: 1,
    raster: { width: size, height: size, channels: 1, data: Array.from(bytes) },
    descriptor: { intent: 'mask', layout: 'r', precision: 'unorm8', units: 'unitless', colorSpace: 'none',
      alpha: 'none', domain: 'unit', tiling: { u: 'clamp', v: 'clamp' }, sampling: 'nearest' } };
}
main().catch(error => { console.error(error); process.exitCode = 1; });
