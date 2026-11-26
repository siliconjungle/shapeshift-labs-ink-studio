const assert = require('node:assert/strict');
const path = require('node:path');
const Ink = require('../..');
const PNG = require('../../cli/png.js');
const files = require('../../cli/asset-files.js');
const tile = require('./tile.cjs');
const directory = path.resolve(process.argv[2] ?? 'studio/out/displacement-preview');
const at = name => path.join(directory, name);
const { width, height, pigment, heights } = tile();
const P = Ink.load().KIT.procedural;
const image = P.graphImages.declare({ width, height, channels: 1, data: heights }, { intent: 'height', units: 'mm' });
const png = PNG.encode(width, height, pigment, 4);
const exr = Ink.encodeTexture(image, { encoding: 'exr', bitDepth: 32 });
const asset = (bytes, encoding, interpretation) => ({ format: 'bitmap',
  source: { base64: bytes.toString('base64'), encoding }, interpretation });
const ref = node => ({ node, port: 'value' });
const op = (op, inputs) => ({ op, inputs });
const graph = { format: 'ink-studio/graph-project', version: 1,
  assets: { pigment: asset(png, 'png', { intent: 'color' }), relief: asset(exr, 'exr', { intent: 'height', units: 'mm' }) },
  nodes: {
    pigment: op('bitmapAsset', { name: 'pigment' }),
    height: op('bitmapAsset', { name: 'relief' }),
    tangent: op('image.heightToNormal', { source: ref('height'),
      options: { spacing: [.048, .047], orientation: 'directx', method: 'sobel' } }),
    maps: op('data.record', { baseColor: ref('pigment'), height: ref('height'), normal: ref('tangent') }),
    material: op('material.pack', { maps: ref('maps') })
  },
  outputs: { material: ref('material') },
  exports: { 'ember-gate': { output: 'material', format: 'texture', options: { encoding: 'exr', bitDepth: 32 } } }
};
const material = Ink.openMaterialGraph(graph, { id: 'ember-gate' });
material.label = 'Ember Gate';
const saved = Ink.writeMaterialGraph(at('ember-gate.material.json'), material);
const plan = { format: 'ink-studio/displacement-preview', version: 1, label: 'Ember Gate',
  source: { output: 'material' },
  settings: { scale: .34, bias: -.17, tessellation: [120, 96], reference: [150, 120], tileSize: [2.4, 1.67],
    seam: 'clamp', repeats: [1, 1], steps: 66 },
  cameras: [
    { id: 'grazing', label: 'Close grazing', distance: 3.88, yaw: -45, pitch: 22, fov: 42 },
    { id: 'working', label: 'Working distance', distance: 8.6, yaw: -23, pitch: 13, fov: 40 },
    { id: 'wide', label: 'Wide front', distance: 18.4, yaw: -3, pitch: 4, fov: 39, projection: 'orthographic' },
    { id: 'front', label: 'Straight-on', distance: 9.2, yaw: 0, pitch: 0, fov: 39, projection: 'orthographic' }
  ],
  view: { width: 340, height: 236, profilePixels: 150, profileFraction: .008, colorRmse: 10 }
};
files.json(at('preview.plan.json'), plan);
const project = Ink.createGraphProject(saved);
for (const { file, bytes } of project.run().artifacts) files.write(at(file), bytes);
Ink.writeDisplacementPreview(project, at('preview.plan.json'), { directory }).then(report => {
  assert.equal(report.maps.height.units, 'mm');
  assert.equal(report.settings.tangent, 'directx');
  assert.deepEqual(Ink.readTexture(at('artifacts/ember-gate.exr'), { channels: ['height'] }).data, heights);
  console.log(report.file);
}).catch(error => { console.error(error); process.exitCode = 1; });
