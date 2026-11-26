const path = require('node:path');
const assert = require('node:assert/strict');
const Ink = require('../..');
const PNG = require('../../cli/png.js');
const files = require('../../cli/asset-files.js');
const art = require('./panels.cjs');
const { KIT } = Ink.load(), P = KIT.procedural;
const directory = path.resolve(process.argv[2] ?? 'studio/out/linked-material-preview');
const at = name => path.join(directory, name);
const ref = node => ({ node, port: 'value' });
const op = (op, inputs) => ({ op, inputs });
const assets = {}, nodes = {};
const plane = art.housing({ tiled: false });
const imported = art.housing();
files.write(at('relay.obj'), art.obj(imported));
files.json(at('relay.ink-topology.json'), KIT.meshTopology.create(plane));

const sources = [art.enamel('harbour'), art.enamel('bearing')], bronze = art.bronze();
function bytes(swatch, channel) {
  const { size, pigment, relief, roughness } = swatch;
  if (channel === 'color') return PNG.encode(size, size, pigment, 4);
  if (channel === 'roughness') return PNG.encodeGray(size, size, roughness);
  const image = P.graphImages.declare({ width: size, height: size, channels: 1, data: relief }, { intent: 'height', units: 'mm' });
  return Ink.encodeTexture(image, { encoding: 'exr', bitDepth: 32 });
}
for (const name of ['color', 'roughness', 'height']) {
  const encoding = name === 'height' ? 'exr' : 'png';
  const interpretation = name === 'height' ? { intent: 'height', units: 'mm' } :
    { intent: name === 'color' ? 'color' : 'mask' };
  const member = source => ({ encoding, base64: bytes(source, name).toString('base64') });
  assets['enamel-' + name] = { format: 'bitmap', interpretation,
    tiles: sources.map((swatch, i) => ({ udim: 1001 + i, source: member(swatch) })) };
  assets['bronze-' + name] = { format: 'bitmap', interpretation, source: member(bronze) };
  nodes['enamel-' + name] = op('bitmapAsset', { name: 'enamel-' + name, tile: { input: 'tile' } });
  nodes['bronze-' + name] = op('bitmapAsset', { name: 'bronze-' + name });
}
for (const material of ['enamel', 'bronze']) {
  nodes[material + '-normal'] = op('image.heightToNormal', {
    source: ref(material + '-height'), options: { spacing: [.19, .19], strength: 1.2, method: 'sobel' }
  });
  nodes[material + '-maps'] = op('data.record', {
    baseColor: ref(material + '-color'), normal: ref(material + '-normal'), roughness: ref(material + '-roughness'),
    height: ref(material + '-height')
  });
  nodes[material] = op('material.pack', { maps: ref(material + '-maps') });
}

const graph = { format: 'ink-studio/graph-project', version: 1, assets, nodes,
  inputs: { tile: { type: 'vec2', default: [0, 0] } },
  outputs: { enamel: ref('enamel'), bronze: ref('bronze') },
  outputUsages: {
    'bronze-color': { source: { output: 'bronze', channel: 'baseColor' }, usage: 'baseColor', label: 'Bronze pigment', order: 0,
      format: { format: 'png', bitDepth: 8 }, export: false },
    'bronze-finish': { source: { output: 'bronze', channel: 'roughness' }, usage: 'roughness', label: 'Bronze roughness', order: 1,
      format: { format: 'png', bitDepth: 8 }, export: false }
  } };
const material = Ink.openMaterialGraph(graph, { id: 'harbour-relay' });
material.label = 'Harbour Relay';
const saved = Ink.writeMaterialGraph(at('harbour-relay.material.json'), material);
const plan = { format: 'ink-studio/linked-material-preview', version: 1, label: 'Harbour Relay',
  targets: [
    { id: 'relay', kind: 'mesh', label: 'Relay housing · OBJ', file: 'relay.obj' },
    { id: 'sphere', kind: 'sphere', label: 'Sphere', slot: 'Enamel', uvGrid: [2, 1] },
    { id: 'plane', kind: 'plane', label: 'Plane', slot: 'Enamel', uvGrid: [2, 1] },
    { id: 'cube', kind: 'cube', label: 'Cube', slot: 'Enamel', uvGrid: [2, 1] },
    { id: 'ink', kind: 'ink', label: 'Relay housing · Ink asset', file: 'relay.ink-topology.json' }
  ],
  slots: {
    Enamel: { output: 'enamel', tiles: [1001, 1002], tileInput: 'tile' },
    Bronze: { maps: { baseColor: { map: 'bronze-color' }, roughness: { map: 'bronze-finish' } } }
  },
  view: { width: 438, height: 330, steps: 12, textureSize: 256 }
};
files.json(at('preview.plan.json'), plan);

Ink.writeLinkedMaterialPreview(Ink.createGraphProject(saved), at('preview.plan.json'), { directory })
  .then(({ file, targets }) => {
    const front = targets[0], enamel = front.regions.filter(row => row.slot === 'Enamel');
    assert.deepEqual(enamel.map(row => row.tile), ['1001', '1002']);
    assert.notEqual(enamel[0].maps[0].image, enamel[1].maps[0].image);
    assert(front.views[0].pixels.every(n => n > 0));
    console.log(file);
  }).catch(error => { console.error(error); process.exitCode = 1; });
