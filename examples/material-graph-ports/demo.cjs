const assert = require('node:assert/strict');
const path = require('node:path');
const Ink = require('../..');
const PNG = require('../../cli/png.js');
const files = require('../../cli/asset-files.js');

const kit = Ink.load();
const { KIT, makeBuilder } = kit;
const M = KIT.procedural.materialChannels;
const out = path.resolve(process.argv[2] ?? 'studio/out/material-graph-ports');
const at = file => path.join(out, file);
const size = 112;
const names = ['baseColor', 'normal', 'height', 'roughness', 'metalness', 'ao', 'emission', 'opacity', 'mask.inlay'];
const clamp = n => Math.min(1, Math.max(0, n));
const byte = n => Math.round(clamp(n) * 255);
const link = (node, port = 'value') => ({ node, port });
const node = (op, inputs) => ({ op, inputs });

function petal(x, y, angle) {
  const u = x * Math.cos(angle) + y * Math.sin(angle);
  const v = y * Math.cos(angle) - x * Math.sin(angle);
  if (u < -.08 || u > .56) return 0;
  const width = .118 * (1 - Math.max(0, u) / .565);
  return clamp((width - Math.abs(v)) / .036) * clamp((.568 - u) / .033);
}

function surface(x, y) {
  const radius = Math.hypot(x, y), a = Math.atan2(y, x);
  const star = Math.max(...Array.from({ length: 8 }, (_, i) => {
    const scale = i % 2 ? 1.36 : 1;
    return petal(x * scale, y * scale, i * Math.PI / 4);
  }));
  const round = (center, width) => clamp(1 - Math.abs(radius - center) / width);
  const brand = Math.max(star, round(.098, .048));
  const rim = Math.max(round(.828, .037), round(.903, .027) * .68, round(.728, .025) * .74);
  const tick = (a / (Math.PI / 16) + 32) % 1 < .2 && radius > .765 && radius < .808;
  const cut = clamp((1 - radius) / .034);
  const height = (.023 + .021 * (1 - radius ** 2) + .04 * rim + .027 * brand + (tick ? .010 : 0)) * cut;
  return { radius, brand, rim, tick, height };
}

function sourceMaps() {
  const maps = Object.fromEntries(names.map(name => [name, { width: size, height: size,
    channels: ['baseColor', 'normal', 'emission'].includes(name) ? 4 : 1, data: [] }]));
  const alternate = { ...maps.baseColor, data: [] };
  for (let row = 0; row < size; row++) for (let col = 0; col < size; col++) {
    const x = (col + .5) * 2 / size - 1, y = 1 - (row + .5) * 2 / size;
    const { radius, brand, rim, tick, height } = surface(x, y);
    const delta = 2 / size;
    const dx = (surface(x - delta, y).height - surface(x + delta, y).height) / (2 * delta);
    const dy = (surface(x, y - delta).height - surface(x, y + delta).height) / (2 * delta);
    const length = Math.hypot(dx, dy, 1);
    const grain = ((Math.imul(col + 7, 59743) ^ Math.imul(row + 3, 49171)) & 31) / 31 - .5;
    const pooling = .045 * Math.sin(11 * x + 7 * y) * Math.cos(6 * x - 11 * y);
    const shine = Math.max(brand, rim, tick ? .82 : 0);
    const metal = radius > .711 || brand > .45;
    const ink = clamp(.37 + pooling + .08 * grain + .22 * shine);
    const p = (base, scale) => base.map((n, i) => byte(n + ink * scale[i]));
    const painted = metal ? p([.22, .14, .16], [.63, .43, .23]) : p([.045, .065, .126], [.14, .20, .28]);
    const polished = metal ? painted : p([.025, .128, .123], [.15, .46, .37]);
    const alpha = radius < 1 ? 255 : 0;
    maps.baseColor.data.push(...painted, alpha);
    alternate.data.push(...polished, alpha);
    maps.normal.data.push(...[dx, dy, 1].map(value => byte(.5 + .5 * value / length)), 255);
    maps.height.data.push(height);
    maps.roughness.data.push(metal ? .57 + .08 * grain : .6 + .045 * grain);
    maps.metalness.data.push(metal ? .82 : .1);
    maps.ao.data.push(clamp(.78 + .22 * cutAO(dx, dy)));
    maps.emission.data.push(2, byte(brand * .035), byte(brand * .028), 255);
    maps.opacity.data.push(alpha / 255);
    maps['mask.inlay'].data.push(metal ? 0 : 1);
  }
  return { maps, alternate };
}

function cutAO(dx, dy) {
  return 1 / Math.hypot(dx, dy, 1);
}

const metadata = {
  baseColor: { colorSpace: 'srgb', texCoord: 0 },
  normal: { encoding: 'rgb8', space: 'tangent', texCoord: 0 },
  height: { encoding: 'float', unit: 'world', texCoord: 0 },
  roughness: { encoding: 'unit', texCoord: 0 },
  metalness: { encoding: 'unit', texCoord: 0 },
  ao: { encoding: 'unit', texCoord: 0 },
  emission: { colorSpace: 'srgb', texCoord: 0 },
  opacity: { encoding: 'unit', texCoord: 0 },
  'mask.inlay': { encoding: 'unit', texCoord: 0, role: 'glaze recess' }
};
const graph = {
  format: 'ink-studio/graph-project', version: 1,
  assets: { pattern: { format: 'json', file: 'source-maps.json' } },
  nodes: {
    pattern: node('jsonAsset', { name: 'pattern' }),
    maps: node('data.get', { record: link('pattern'), key: 'maps' }),
    alternate: node('data.get', { record: link('pattern'), key: 'alternate' }),
    before: node('material.pack', { maps: link('maps'), metadata }),
    originalRoughness: node('material.channel', { source: link('before'), name: 'roughness' }),
    inlay: node('material.channel', { source: link('before'), name: 'mask.inlay' }),
    recessPolish: node('raster.math', { a: link('inlay'), b: .28, op: 'multiply' }),
    polished: node('raster.math', { a: link('originalRoughness'), b: link('recessPolish'), op: 'subtract' }),
    updates: node('data.record', { baseColor: link('alternate'), roughness: link('polished') }),
    after: node('material.replace', { source: link('before'), maps: link('updates') }),
    processedColor: node('material.channel', { source: link('after'), name: 'baseColor' })
  },
  outputs: { before: link('before'), after: link('after'), baseColor: link('processedColor') },
  exports: { material: { output: 'after', format: 'json' }, pigment: { output: 'baseColor', format: 'png' } }
};
files.json(at('source-maps.json'), sourceMaps());
const project = at('northstar.material.json');
Ink.writeMaterialGraph(project, Ink.openMaterialGraph(graph, { id: 'northstar' }));
const run = Ink.readGraphProject(project).run();
for (const { file, bytes } of run.artifacts) files.write(at(file), bytes);

function sameRows(before, after) {
  assert.deepEqual(Object.keys(before.channels), Object.keys(after.channels));
  const changed = Object.keys(after.channels).filter(name => before.channels[name] !== after.channels[name]);
  assert.deepEqual(changed, ['baseColor', 'roughness']);
  for (const name of changed) assert.notDeepEqual(before.channels[name].raster, after.channels[name].raster);
  return changed;
}

const { before, after } = run.outputs;
const changed = sameRows(before, after);

function map(material, name) {
  return M.channel(material, name).raster.data;
}

function samples(material) {
  return { baseColor: map(material, 'baseColor'), normal: map(material, 'normal'), height: map(material, 'height'),
    roughness: map(material, 'roughness'), metalness: map(material, 'metalness'), opacity: map(material, 'opacity'),
    emission: map(material, 'emission') };
}

const stockMetal = [132, 85, 56];
const frame = {
  cam: { target: [0, 0, 0], dist: 3.75, fov: .63, yaw: -.27, pitch: .31, ortho: true },
  radius: 1.5, fog: { start: 1, max: 0 }, dither: 0,
  look: { pbrMaterials: {
    materials: { mapped: { coating: { weight: .26, roughness: .36 } }, enamel: { metalness: .1 }, bronze: { metalness: .82 } },
    bindings: ['mapped', 'enamel', 'bronze'].map(material => ({ select: { material }, material })),
    lights: [{ direction: [-.65, .69, .65], color: '#ffe4c6', intensity: 3.1 },
      { direction: [.8, .1, .25], color: '#a2d5f0', intensity: 1.07 }],
    environment: { sky: '#d2d8df', horizon: '#a08390', ground: '#283045', intensity: .85 }, exposure: 1
  } }
};

function profile() {
  return [[1, -.155], [1.02, -.127], [1.02, -.044], [1, -.014], [.974, .012]];
}

function mesh(material) {
  const data = samples(material), positions = [], indices = [], uvs = [], faceMaterials = [];
  const sides = 112;
  for (const [radius, z] of [...profile(), [.75, .034], [.45, .043], [.001, .046]]) {
    for (let i = 0; i <= sides; i++) {
      const a = i * 2 * Math.PI / sides, x = radius * Math.cos(a), y = radius * Math.sin(a);
      positions.push(x, y, z);
      uvs.push(clamp(.5 + x * .5), clamp(.5 - y * .5));
    }
  }
  for (let band = 0; band < positions.length / (3 * (sides + 1)) - 1; band++) {
    for (let i = 0; i < sides; i++) {
      const a = band * (sides + 1) + i, b = a + sides + 1;
      indices.push(a, a + 1, b, a + 1, b + 1, b);
      faceMaterials.push(band < 3 ? 1 : 0, band < 3 ? 1 : 0);
    }
  }
  const pixels = Uint8Array.from(data.baseColor);
  for (let i = 0; i < data.opacity.length; i++) pixels[4 * i + 3] = byte(data.opacity[i]);
  return KIT.sceneMeshes.create({
    id: 'northstar-mesh', positions, indices, uvs, faceMaterials,
    materials: [{ id: 'mapped', texture: { width: size, height: size, pixels },
      normal: Uint8Array.from(data.normal), roughness: Uint8Array.from(data.roughness, byte),
      metalness: Uint8Array.from(data.metalness, byte), emission: Uint8Array.from(data.emission), emissionStrength: .55 },
    { id: 'bronze', color: stockMetal.reduce((rgb, channel) => rgb * 256 + channel, 0), roughness: .54 }]
  });
}

function splats(B, material) {
  const data = samples(material), roughness = [];
  function dab(x, y, z, n, width, color, alpha, rough, name) {
    const i = B.count();
    B.disc(x, y, z, n, width, .007, color, alpha);
    B.describeSplats(i, i + 1, { object: 'northstar-splat', material: name });
    roughness.push(rough);
  }
  for (const [radius, z] of profile().slice(0, -1)) {
    for (let i = 0; i < 216; i++) {
      const a = i * 2 * Math.PI / 216, x = Math.cos(a), y = Math.sin(a);
      dab(radius * x, radius * y, z, [x, y, .06], .021, stockMetal, 1, .54, 'bronze');
    }
  }
  for (let i = 0; i < data.opacity.length; i++) {
    if (data.opacity[i] === 0) continue;
    const x = (i % size + .5) * 2 / size - 1, y = 1 - (Math.floor(i / size) + .5) * 2 / size;
    const j = 4 * i, [r, g, b] = data.baseColor.slice(j, j + 3);
    const n = data.normal.slice(j, j + 3).map(channel => channel / 127.5 - 1);
    dab(x, y, data.height[i], n, .0135, [r, g, b],
      data.opacity[i], data.roughness[i], data.metalness[i] > .5 ? 'bronze' : 'enamel');
  }
  return Float32Array.from(roughness);
}

function render(carrier, state, material) {
  const builder = makeBuilder(14);
  const roughness = carrier === 'splat' ? splats(builder, material) : undefined;
  const world = builder.finish({ ...frame, ...(carrier === 'mesh' && { meshes: [mesh(material)] }) });
  if (roughness) world.splatRoughness = roughness;
  const { w, h, rgb } = Ink.render(world, { w: 276, h: 246, px: 1, raw: true });
  const file = carrier + '-' + state + '.png';
  files.write(at(file), PNG.encode(w, h, rgb, 3));
  return Buffer.from(rgb);
}

for (const carrier of ['mesh', 'splat'])
  assert.notDeepEqual(render(carrier, 'before', before), render(carrier, 'after', after));
files.json(at('receipt.json'), { names, changed, unchanged: names.filter(name => !changed.includes(name)) });
console.log('Rendered both carriers and exported all material maps to ' + out);
