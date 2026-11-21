const path = require('node:path');

const rgba = { width: 4, height: 4, channels: 4, data: Array.from({ length: 16 }, (_, i) =>
  i === 5 || i === 6 || i === 9 || i === 10 ? [60, 135, 190, 255] : [0, 0, 0, 0]).flat() };
const mask = { width: 4, height: 4, channels: 1, data: [0, 0, 0, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 0, 0, 0] };
const palette = ['#102032', '#3c87be', '#f2be6e'];
const slots = { ...mask, data: mask.data.map(value => value ? 1 : 0) };
const motion = { width: 4, height: 4, channels: 2, data: Array.from({ length: 16 }, () => [.5, 0]).flat() };
const bone = { id: 'root', pivot: [0, 0], tip: [3, 3] };
const triangle = [[0, 0], [1, 0], [0, 1]], quad = [[0, 0], [1, 0], [0, 1], [1, 1]];
const mesh = { points: [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]], faces: [[0, 2, 1], [0, 1, 3], [0, 3, 2], [1, 2, 3]] };
const clip = { width: 4, height: 4, fps: 8, layers: { ink: { frames: [rgba.data, rgba.data] } } };
const audio = { sampleRate: 8000, channels: 1, samples: Array.from({ length: 128 }, (_, i) => i % 4 === 1 ? .5 : i % 4 === 3 ? -.5 : 0) };
const event = { time: 0, channel: 'held', value: true };
const diorama = { id: 'node-catalog', seed: 1, style: 'slate', solids: [
  { id: 'block', kind: 'box', at: [0, 0, 0], half: [.45, .45, .45], mat: { role: 'stone' }, res: .22 }
] };

const link = (node, port = 'value') => ({ node, port });
const param = input => ({ input });
const group = (inputs, op, values) => ({
  inputs, nodes: { step: { op, inputs: values } }, outputs: { value: link('step') }
});
const assetFixtures = {
  pngAsset: ['png', 'swatch.png'], indexedPngAsset: ['indexed-png', 'swatch.png'],
  rasterAsset: ['png', 'swatch.png'], audioAsset: ['wav', 'tone.wav'],
  inputAsset: ['inputs', 'input.json'], jsonAsset: ['json', 'input.json']
};
const dynamic = {
  'array.map': { inputs: { items: [1, 2, 3] }, callback: group({ item: 'number' }, 'multiply', { a: param('item'), b: 2 }) },
  'array.filter': { inputs: { items: [1, 2, 3] }, callback: group({ item: 'number' }, 'lessThan', { a: 1, b: param('item') }) },
  'array.reduce': { inputs: { items: [1, 2, 3], initial: 0 },
    callback: group({ accumulator: 'number', item: 'number' }, 'add', { a: param('accumulator'), b: param('item') }) },
  'array.sort': { inputs: { items: [3, 1, 2] } },
  'data.typed': { type: 'number', inputs: { value: 7 } },
  'data.record': { inputs: { label: 'Ink', count: 3 } },
  'anim.retime': { inputs: { timing: { offset: .1 } },
    callback: group({}, 'time', {}) }
};
const specifications = {
  lessThan: { inputs: { a: 1, b: 2 } },
  'array.broadcast': { inputs: { arrays: { x: [1, 2], y: [3, 4] }, mode: 'cartesian' } },
  'data.get': { inputs: { record: { hue: 4 }, key: 'hue' } },
  'data.collect': { inputs: { source: { a: 1, b: 2 }, keys: ['b', 'a'] } },
  'atlas.compile': { inputs: { source: { metadata: { width: 4, height: 4, frames: [
    { id: 'tile', rect: { x: 0, y: 0, width: 4, height: 4 } }
  ] }, images: { color: rgba.data } } } },
  'raster.canvas': { inputs: { color: [60, 135, 190, 255] } },
  'raster.channels': { inputs: { planes: [mask, mask, mask] } },
  'raster.math': { inputs: { op: 'add', b: 2 } },
  'raster.crop': { inputs: { options: { x: 1, y: 1, width: 2, height: 2 } } },
  'raster.resize': { inputs: { options: { width: 8, height: 6, filter: 'nearest' } } },
  'raster.nineSlice': { inputs: { options: { width: 8, height: 6, insets: [1, 1, 1, 1] } } },
  'raster.stack': { inputs: { layers: [{ source: rgba }] } },
  'raster.depth': { inputs: { layers: [{ source: rgba, depth: 2 }] } },
  'raster.height': { inputs: { layers: [{ source: rgba, height: .5 }] } },
  'raster.spriteStack': { inputs: { source: rgba, options: { count: 2 } } },
  'raster.pack': { inputs: { sprites: [{ id: 'tile', source: rgba }] } },
  'raster.frame': { inputs: { source: clip } },
  'draw.render': { inputs: { commands: [{ type: 'rect', rect: [0, 0, 3, 2], fill: '#3c87be' }], edges: 'hard' } },
  'draw.trackedAnchors': {
    nodes: { observations: { op: 'fx.regionObservations', inputs: { frames: [mask, mask] } } },
    inputs: { observations: link('observations'), bindings: [{ id: 'signal', track: 1, hold: .2,
      commands: [{ type: 'rect', rect: [-1, -1, 2, 2], fill: '#3c87be' }] }] }
  },
  'draw.path': { inputs: { d: 'M0 0 L2 1 L3 0' } },
  'layout.boxes': { inputs: { boxes: [{ id: 'tile', rect: [0, 0, 3, 3] }] } },
  'layout.place': { inputs: { box: { content: [0, 0, 4, 4] } } },
  'raster.floodFill': { inputs: { options: { seed: [1, 1], color: '#f2be6e' } } },
  'raster.extractComponent': { nodes: { components: { op: 'raster.components', inputs: { source: rgba } } },
    inputs: { labels: link('components', 'labels'), component: { id: 1, rect: { x: 1, y: 1, width: 2, height: 2 } } } },
  'palette.recipe': { inputs: { definition: { anchors: { light: '#3c87be' }, roles: {
    ink: { anchor: 'light', steps: 4, lightness: [.2, .8] }
  } } } },
  'palette.resolve': { inputs: { policy: { palette } } },
  'color.gradient': { inputs: { ramp: palette } },
  'color.stack': { inputs: { stack: { name: 'Sample', steps: [] } } },
  'color.key': { inputs: { options: { color: '#3c87be' } } },
  'fx.bitplane': { inputs: { source: slots } },
  'fx.paletteFault': { inputs: { source: slots, options: { swaps: [[0, 1]] } } },
  'fx.regionObservations': { inputs: { frames: [mask, mask] } },
  'fx.analyze': { output: 'paths' },
  'warp.sample': { nodes: { mapping: { op: 'warp.field', inputs: { width: 4, height: 4 } } },
    inputs: { field: link('mapping') } },
  'warp.mesh': { inputs: { control: { from: triangle, to: triangle, triangles: [[0, 1, 2]] } } },
  'warp.grid': { inputs: { control: { columns: 2, rows: 2, points: quad } } },
  'warp.morph': { inputs: { control: { from: triangle, to: triangle, triangles: [[0, 1, 2]] } } },
  'warp.frames': { inputs: { source: clip } },
  'warp.timeRemap': { inputs: { frames: [rgba, rgba], map: mask, options: { scale: 0 } } },
  'warp.displace': { inputs: { map: mask } },
  'warp.refract': { inputs: { map: mask } },
  'warp.surface': { inputs: { mesh: { ...mesh, uvs: quad } } },
  'proc.reaction': { inputs: { steps: 4, options: { width: 16, height: 16 } } },
  'proc.tiles': { inputs: { definitions: [{ id: 'ink', edges: ['a', 'a', 'a', 'a'] }], options: { width: 2, height: 2 } } },
  'proc.tileImage': { inputs: { layout: { status: 'ok', width: 1, height: 1, tiles: ['ink'] }, images: { ink: rgba } } },
  'proc.parallax': { inputs: { layers: [{ source: rgba }], options: { width: 4, height: 4 } } },
  'proc.horizon': { inputs: { bands: [{ id: 'shore', radius: 20, height: [0, 4], source: rgba }] } },
  'geo.triangulate': { inputs: { rings: [triangle] } },
  'geo.clip': { inputs: { planes: [{ normal: [1, 0, 0], offset: .3 }] } },
  'geo.scrambleIndices': { inputs: { options: { maxDisplacement: 1.5, amount: .5 } } },
  'sdf.bound': { inputs: { bounds: { min: [-1, -1, -1], max: [1, 1, 1] } } },
  'sdf.combine': { nodes: {
    shape: { op: 'sdf.shape' }, fields: { op: 'data.record', inputs: { first: link('shape') } },
    sources: { op: 'data.collect', inputs: { source: link('fields'), keys: ['first'] } }
  }, inputs: { sources: link('sources') } },
  'sdf.render': { inputs: { options: { width: 16, height: 16 } } },
  'scene.diorama': { inputs: { definition: diorama } },
  'scene.cameraTrack': { inputs: { definition: { shots: { main: { yaw: 0, dist: 4 } },
    sequence: [{ time: 0, shot: 'main' }] } } },
  'scene.world': { nodes: {
    prop: { op: 'scene.object', inputs: { source: mesh, options: { id: 'prop', resolution: .15 } } },
    props: { op: 'data.record', inputs: { prop: link('prop') } },
    objects: { op: 'data.collect', inputs: { source: link('props'), keys: ['prop'] } }
  }, inputs: { objects: link('objects') } },
  'scene.render': { inputs: { options: { width: 16, height: 16 } } },
  'scene.pass': { inputs: { channel: 'color' } },
  'rig.bindSprite': { inputs: { bones: [bone] } },
  'rig.skinSprite': { nodes: { binding: { op: 'rig.bindSprite', inputs: { source: rgba,
    bones: [bone] } } }, inputs: { bind: link('binding') } },
  'anim.keyframes': { inputs: { channels: { x: 'number' }, keys: [{ time: 0, value: { x: 2 } }] } },
  'anim.spriteDesync': { inputs: { source: clip } },
  'sim.define': { inputs: { kind: 'particles' } },
  'sim.run': { nodes: { recipe: { op: 'sim.define', inputs: { kind: 'particles' } } }, inputs: { recipe: link('recipe') } },
  'anim.feedback': { inputs: { frames: [rgba, rgba] } },
  'audio.buffer': { inputs: audio },
  'input.recording': { inputs: { events: [event] } },
  'input.replay': { inputs: { source: { events: [event] } } },
  'input.actions': { inputs: { state: { 'key:space': true }, context: 'main', contexts: { main: { select: ['key:space'] } } } },
  meshPaths: { inputs: { sources: [0], targets: [1] }, output: 'curves' },
  tiles: { inputs: { settings: { bounds: { min: [0, 0], max: [2, 2] } } } }
};

function project(node, output, extra = {}) {
  const { nodes, ...fields } = extra;
  return { format: 'ink-studio/graph-project', version: 1, ...fields,
    nodes: { ...nodes, example: node }, outputs: { value: link('example', output) } };
}

const density = 'P.density.bounded({ bounds: { min: [-1, -1, -1], max: [1, 1, 1] }, ' +
  'sample: (x, y, z) => Math.max(0, 1 - Math.hypot(x, y, z)) })';
const runtime = {
  materialSample: { inputs: { uv: [.25, .5] }, output: 'height', factory: 'P.graph.material({ height: 0.25, wetness: 0.3 })' },
  rasterLayer: { inputs: { layer: 'ink' }, type: 'any', factory: 'P.graph.raster(' + JSON.stringify(clip) + ')' },
  attributeTransfer: { inputs: { domain: 'point', entities: [[.1, .1, 0]] }, factory: 'P.attributes.mesh(' + JSON.stringify(mesh) + ')' },
  densityMesh: { inputs: { options: { resolution: .2 } }, factory: density },
  densityPoints: { inputs: { options: { count: 6 } }, factory: density }
};

function runtimeExample(id, { inputs, output = 'value', type = 'field', factory }) {
  const graph = project({ op: id, inputs: { source: param('source'), ...inputs } }, output, { inputs: { source: type } });
  return { kind: 'node', source: 'const ink = require(process.env.INK_STUDIO_MODULE || ' +
    JSON.stringify(path.resolve(__dirname, '../index.js')) + ');\n' +
    'const P = ink.load().KIT.procedural;\n' +
    'const project = ink.createGraphProject(' + JSON.stringify(graph, null, 2) + ');\n' +
    'console.log(project.run({ inputs: { source: ' + factory + ' } }).report.outputs);\n' };
}

function exampleFor(id, operation, kit) {
  if (Object.hasOwn(runtime, id)) return runtimeExample(id, runtime[id]);
  if (Object.hasOwn(assetFixtures, id)) {
    const [format, file] = assetFixtures[id];
    return { kind: 'graph', project: project({ op: id, inputs: { name: 'sample' } }, 'value',
      { assets: { sample: { format, file: path.join(__dirname, 'graph-catalog-assets', file) } } }) };
  }
  if (Object.hasOwn(dynamic, id)) {
    const { type, inputs, callback } = dynamic[id];
    return { kind: 'graph', project: project({ op: id, inputs, ...(type && { type }), ...(callback && { group: 'Callback' }) }, 'value',
      callback && { groups: { Callback: callback } }) };
  }
  if (operation.specialize) return;
  const { inputs: specified = {}, nodes: earlier, output = Object.keys(operation.outputs ?? { value: 'any' })[0] } =
    id === 'color.look' ? { inputs: { pack: kit.KIT.authoring.assetPacks.savePaletteLook({ id: 'catalog/ink', label: 'Catalog ink', palette }),
      binding: { asset: 'catalog/ink' } } } : specifications[id] ?? {};
  const nodes = { ...earlier };
  const field = { op: 'sdf.shape' }, world = { op: 'scene.diorama', inputs: { definition: diorama } };
  function sample(type, name) {
    switch (type) {
      case 'number': return 4;
      case 'boolean': return true;
      case 'string': return 'Ink';
      case 'raster': case 'image': return name === 'mask' ? mask : name === 'motion' ? motion : rgba;
      case 'palette': return palette;
      case 'path': return { points: triangle };
      case 'points': return triangle;
      case 'mesh': case 'geometry': return mesh;
      case 'vec2': return [.3, .5];
      case 'vec3': return name === 'end' ? [1, 1, 0] : [0, 0, 0];
      case 'field': nodes.field ??= field; return link('field');
      case 'world': nodes.world ??= world; return link('world');
      case 'renderFrame': return { w: 1, h: 1, rgb: [60, 135, 190] };
      case 'audio': return audio;
      case 'record': return {};
      case 'array': case 'array<record>': return [];
      case 'array<raster>': return [rgba, rgba];
      case 'array<mesh>': return [mesh];
      case 'array<vec2>': return [[1.5, 1.5]];
      case 'array<string>': return ['ink'];
      default: return 1;
    }
  }
  const inputs = { ...specified };
  for (const [name, socket] of Object.entries(operation.inputs ?? {})) {
    if (Object.hasOwn(inputs, name) || Object.hasOwn(socket, 'default')) continue;
    inputs[name] = sample(typeof socket === 'string' ? socket : socket.type, name);
  }
  return { kind: 'graph', project: project({ op: id, ...(Object.keys(inputs).length && { inputs }) }, output, { nodes }) };
}

module.exports = { exampleFor };
