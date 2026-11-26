const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const ink = require('..');
const files = require('../cli/asset-files.js');
const PNG = require('../cli/png.js');

const link = (node, port = 'value') => ({ node, port });
const op = (name, inputs) => ({ op: name, inputs });
const width = 68, height = 46;
const frameWidth = 214, frameHeight = 158;
const palette = [
  [0, '#132731'], [.065, '#1b4150'], [.17, '#28586b'], [.31, '#418892'],
  [.43, '#6ca7a0'], [.58, '#c8af74'], [.72, '#f2ac6e'], [.84, '#ffe4a7']
];
const ramp = { interpolation: 'step', stops: palette.map(([at, value], i) => ({ id: 'signal-' + i, at, value })) };
const view = {
  output: 'survey',
  passes: [
    { id: 'density', type: 'mask', raster: { slot: 'sample', channel: 0, range: [0, 2.4], filter: 'nearest' } },
    { id: 'survey', type: 'trackedWindow', at: [98, 99], crop: { size: [26, 22] },
      place: { at: [182, 26], size: [40, 34] }, chrome: { color: '#6caaa8', border: 1, leader: true } }
  ]
};
const nodes = {
  recipe: op('sim.define', { kind: 'smoke', settings: { width, height, buoyancy: 6.5, pressureIterations: 16,
    emitters: [
      { at: [19, 33], radius: 5.5, density: 9, velocity: [42, -47], end: 1.07 },
      { at: [45, 32], radius: 4.2, density: 8, velocity: [-29, -49], end: .93 },
      { at: [33, 21], radius: 3.3, density: 6, velocity: [28, -24], start: .24, end: .72 }
    ], walls: [[23, 17, 8, 2], [37, 24, 9, 2]] } }),
  smoke: op('sim.run', { recipe: link('recipe') }),
  field: op('sim.fieldRaster', { source: link('smoke', 'grid'), options: { share: true } }),
  measure: op('image.declare', { source: link('field'), descriptor: { intent: 'data', units: 'density' } }),
  pigment: op('image.gradientMap', { source: link('measure'), ramp, options: { range: [0, 2.4], precision: 'unorm8' } }),
  roughness: op('image.uniform', { value: .48, width, height, descriptor: { intent: 'data', precision: 'unorm8' } }),
  maps: op('data.record', { baseColor: link('pigment'), roughness: link('roughness') }),
  material: op('material.pack', { maps: link('maps') }),
  surface: op('sim.fieldMesh', { source: link('smoke', 'grid'), options: { heightScale: 1.37 } }),
  offset: op('geo.transform', { source: link('surface'), position: [-1.7, .098, -1.15], scale: [.05, .07, .05] }),
  terrain: op('ReliefCarrier', { source: link('offset'), material: link('material') }),
  meshRecord: op('data.record', { panel: link('terrain') }),
  meshes: op('data.collect', { source: link('meshRecord'), keys: ['panel'] }),
  slab: op('geo.box', { center: [0, -.08, 0], half: [1.76, .125, 1.21] }),
  plinth: op('scene.object', { source: link('slab'), options: { id: 'slate-plinth', color: '#385160', facets: true } }),
  objectRecord: op('data.record', { plinth: link('plinth') }),
  objects: op('data.collect', { source: link('objectRecord'), keys: ['plinth'] }),
  lab: op('scene.world', { objects: link('objects'), meshes: link('meshes'), options: { background: '#152832',
    palette: ['#182835', '#263c4a', '#385160', '#476773', '#617c87', ...palette.map(([, swatch]) => swatch)] } }),
  slots: op('data.record', { sample: link('field') }),
  capture: op('scene.render', { source: link('lab'), renderGraphInputs: link('slots'),
    renderGraphCapture: ['density', 'scene'], channels: ['coverage'], camera: {
      target: [0, .18, 0], yaw: -.5, pitch: .76, dist: 6.8, fov: .53, ortho: true
    }, options: { width: frameWidth, height: frameHeight, renderGraph: view } }),
  original: op('scene.colorTexture', { frame: link('capture', 'frame'), channel: 'graph:scene' }),
  rendered: op('scene.colorTexture', { frame: link('capture', 'frame') }),
  mask: op('scene.maskTexture', { frame: link('capture', 'frame'), channel: 'graph:density' }),
  maskPreview: op('image.resize', { source: link('mask'), width, height })
};
const project = {
  format: 'ink-studio/graph-project', version: 1, seed: 34, time: 1.15, nodes,
  groups: { ReliefCarrier: {
    inputs: { source: { type: 'mesh' }, material: { type: 'materialChannels' } },
    nodes: { binding: op('scene.materialMesh', { source: { input: 'source' }, material: { input: 'material' },
      options: { id: 'density-panel' } }) },
    outputs: { value: link('binding'), report: link('binding', 'report') }
  } },
  outputs: { survey: link('rendered'), pigment: link('pigment'), texture: link('maskPreview'),
    binding: link('terrain', 'report'), simulation: link('smoke', 'report') }
};

if (require.main === module) {
  const out = path.resolve(process.argv[2] ?? 'thermal-survey');
  const graph = path.join(out, 'thermal-survey.graph.json'), review = path.join(out, 'review');
  files.json(graph, project);
  const selectors = 'rendered,original,pigment,maskPreview,terrain';
  const report = JSON.parse(execFileSync(process.execPath, [
    path.resolve(__dirname, '../cli/ink-studio.js'), 'graph', 'evaluate', graph, '--capture', selectors, '--out', review
  ], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }));
  const captures = Object.fromEntries(report.captured.map(item => [item.node, item]));
  assert.notEqual(captures.original.sha256, captures.rendered.sha256);
  assert(report.performance.samples.sharedLinkedViewBytes > 0);
  assert.equal(report.performance.renderPasses.length, 1);
  function load(name) {
    return PNG.raster(path.join(review, captures[name].file));
  }
  const W = 642, H = 410, K = ink.load().KIT;
  const block = (x, y, w, h, fill) => ({ type: 'rect', rect: [x, y, w, h], fill });
  const text = (value, x, y, scale, fill) => ({ type: 'text', text: value, at: [x, y], scale, fill });
  const label = (value, x, y) => text(value, x, y, 1, '#8cb5b9');
  const commands = [
    block(0, 0, W, H, '#0e1c26'), block(512, 23, 108, 3, '#549e9c'), block(512, 29, 67, 2, '#3c6877'),
    text('THERMAL SURVEY', 22, 18, 3, '#f8dfa8'), label('SMOKE SOLVER  /  TYPED MATERIAL  /  SOFTWARE FRAME', 23, 47),
    label('UV PIGMENT', 470, 71), label('CAPTURED DENSITY', 470, 188),
    label('SAMPLED SWATCHES', 470, 309), label('SOFTWARE SCENE WITH TRACKED DETAIL', 24, 389),
    label('ONE GRAPH  /  1.15 S', 470, 389)
  ];
  for (const [i, [, fill]] of palette.entries()) commands.push(block(470 + i * 18, 327, 15, 10, fill));
  const sheet = K.procedural.drawing2d.render({ width: W, height: H, edges: 'hard', commands });
  function paste(source, left, top, zoom) {
    for (let y = 0; y < source.h * zoom; y++) for (let x = 0; x < source.w * zoom; x++) {
      const at = (Math.floor(y / zoom) * source.w + Math.floor(x / zoom)) * 4;
      sheet.data.set(source.data.subarray(at, at + 4), ((top+y)*W+left+x)*4);
    }
  }
  paste(load('rendered'), 22, 65, 2);
  paste(load('pigment'), 470, 84, 2);
  paste(load('maskPreview'), 470, 201, 2);
  const image = path.join(out, 'thermal-survey.png');
  files.write(image, PNG.encode(W, H, sheet.data, 4));
  console.log(image);
}
module.exports = project;
