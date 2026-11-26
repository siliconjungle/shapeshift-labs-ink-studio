'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const ink = require('..');
const { KIT: K } = ink.load();
const PNG = require('../cli/png.js');
const output = path.resolve(process.argv[2] ?? 'assembly-review-demo');
const cli = path.resolve(__dirname, '../cli/ink-studio.js');
fs.mkdirSync(output, { recursive: true });
const save = (name, input) => fs.writeFileSync(path.join(output, name + '.json'), JSON.stringify(input, null, 2) + '\n');
const run = (...args) => execFileSync(process.execPath, [cli, 'assembly-review', ...args], { cwd: output, encoding: 'utf8' });

const palette = [0x131827, 0x161c29, 0x252d3e, 0x435062, 0x637285, 0x8d9fa8,
  0x282238, 0x3b304b, 0x5d4b62, 0x6e596d, 0x4a272e, 0x744139, 0xa96142, 0xd78850,
  0x1c383f, 0x296065, 0x46a4a5, 0xb6dfcd];
const rivets = [-.7, .7].flatMap(x => [-.32, .68].map(y => ({ kind: 'ball', part: 'sensor', at: [x, y, .54],
  r: .065, mat: 'copper', res: .03 })));
const front = [Math.PI / 2, 0, 0];
const tone = [0, 1, 2, 3, 4, 5];
const scene = {
  id: 'night-relay',
  camera: { target: [0, .15, 0], dist: 5.4, yaw: .24, pitch: .22, projection: 'orthographic' },
  style: { palette, roles: { stone: tone, shutter: [0, 6, 7, 8, 9], copper: [10, 11, 12, 13], glass: [14, 15, 16, 17] } },
  light: { sun: [.53, .4, -.74], amb: .07, sky: .04 },
  parts: { stand: { joint: [0, -.67, 0] }, sensor: { parent: 'stand', joint: [0, .17, 0] } },
  effects: [{ do: 'lamp', at: [.78, .67, .51], follow: 'sensor', r: 1.6, strength: .18 }],
  finish: { shotLighting: { rim: { at: [2, 1.6, -1.5], normal: [-.68, -.1, .73], size: [.6, 1.8],
    color: '#b095ff', intensity: 2.4, radius: 4, shadows: false } } },
  solids: [
    { id: 'foot', kind: 'lathe', at: [0, -.98, 0], h: .27, r: [[0, .75], [.24, .85], [1, .64]], part: 'stand', res: .045 },
    { id: 'column', kind: 'box', at: [0, -.59, 0], half: [.27, .34, .25], part: 'stand', round: .085, res: .04 },
    { id: 'housing', kind: 'box', at: [0, .17, 0], half: [.9, .59, .52], round: .19, part: 'sensor', res: .041 },
    { id: 'lens-mount', kind: 'lathe', at: [0, .23, .47], h: .25, r: [[0, .44], [.33, .46], [1, .38]],
      transform: { rotation: front }, part: 'sensor', mat: 'stone', res: .033 },
    { id: 'lens-rim', kind: 'torus', at: [0, .23, .70], R: .35, r: .043,
      transform: { rotation: front }, part: 'sensor', mat: 'copper', res: .026 },
    { id: 'lens', kind: 'ball', at: [0, .23, .66], r: [.33, .33, .15], part: 'sensor', mat: 'glass', res: .037 },
    { id: 'sensor-brow', kind: 'box', at: [0, .81, 0], half: [.6, .108, .33], round: .065, part: 'sensor', res: .037 },
    ...rivets.map((solid, i) => ({ ...solid, id: 'rivet-' + i })),
    { id: 'service-shutter', kind: 'box', at: [-.77, .12, .98], half: [.38, .91, .08], round: .05,
      transform: { rotation: [0, .13, -.14] }, mat: 'shutter', res: .041 },
    { id: 'shutter-edge', kind: 'box', at: [-.46, .1, 1.055], half: [.021, .77, .026], round: .016,
      transform: { rotation: [0, .13, -.14] }, mat: 'shutter', res: .032 }
  ]
};

const patch = [[.54, -.12, .543], [.8, -.12, .543], [.8, .13, .543], [.54, .13, .543]];
const decal = { id: 'service-tag', vertices: patch.map((position, i) => ({ id: 'v' + i, position })),
  faces: [{ id: 'tag', material: 'tag', corners: [[0, 1], [1, 1], [1, 0], [0, 0]].map((uv, i) =>
    ({ id: 'c' + i, vertex: 'v' + i, uv })) }] };
const inked = new Uint8Array(8 * 8 * 4);
for (let i = 0; i < 64; i++) {
  const x = i % 8, y = Math.floor(i / 8), line = x === 0 || x === 7 || y === 0 || y === 7 || ((x + y) % 4 < 2);
  inked.set(line ? [209, 153, 82, 255] : [58, 62, 74, 255], i * 4);
}
scene.topologyMeshes = { serviceTag: { document: decal, part: 'sensor',
  materials: [{ id: 'tag', color: 0xb3b9c0, texture: { width: 8, height: 8, pixels: [...inked] } }] } };
const editor = ink.createSceneEditor(scene);
editor.applySculptSpray({ id: 'service-enamel', targets: ['housing'], occlusion: 'wrap', facing: { minDot: -.15, feather: .3 },
  color: '#bf7041', opacity: .78, softness: .17,
  brush: { shape: 'box', direction: [0, 0, -1], center: [.59, .18, .19], half: [.28, .45, .75] } });
const authored = editor.snapshot();
save('night-relay', authored);

const scoped = { lighting: 'neutral', isolate: ['part:stand'], freeze: ['part:sensor'], time: 0 };
const presets = [
  ['shot', 'AUTHORED SHOT', {}],
  ['through', 'REVEAL THROUGH', { revealThrough: ['part:sensor'], freeze: ['part:sensor'], revealOpacity: .79 }],
  ['neutral', 'NEUTRAL + ISOLATE', scoped],
  ['no-paint', 'PAINT HIDDEN', { ...scoped, hide: ['paint:sculpt/housing', 'paint:mesh/serviceTag'] }]
];
const w = 292, h = 244, gap = 8, heading = 27, width = w * 4 + gap * 5, height = h + heading + gap * 2;
const sheet = Buffer.alloc(width * height * 3, 20);
for (const [i, [file, title, preset]] of presets.entries()) {
  const x = gap + i * (w + gap);
  save(file, preset);
  const report = run('render', 'night-relay.json', file + '.json', '--w', String(w), '--h', String(h),
    '--raw', '--zoom', '1.17', '--out', file + '.png');
  fs.writeFileSync(path.join(output, file + '-report.json'), report);
  const { rgb } = PNG.read(path.join(output, file + '.png'));
  for (let y = 0; y < h; y++)
    sheet.set(rgb.subarray(y * w * 3, (y + 1) * w * 3), ((heading + gap + y) * width + x) * 3);
  const { data, width: tw, height: th } = K.procedural.drawing2d.text(title, { color: '#dbe4e3', scale: 2 }).value;
  for (let y = 0; y < th; y++) for (let col = 0; col < tw; col++) {
    const offset = (y * tw + col) * 4;
    if (data[offset + 3]) sheet.set(data.subarray(offset, offset + 3), ((gap + y) * width + x + col) * 3);
  }
}

const draft = structuredClone(authored);
draft.solids.find(row => row.id === 'housing').transform = { translation: [0, .12, 0] };
save('blocked-draft', draft);
const lock = spawnSync(process.execPath, [cli, 'assembly-review', 'check', 'night-relay.json', 'neutral.json', 'blocked-draft.json'],
  { cwd: output, encoding: 'utf8' });
if (lock.status !== 1 || JSON.parse(lock.stdout).canEdit !== false) throw new Error('Expected the frozen housing edit to be rejected');
fs.writeFileSync(path.join(output, 'freeze-report.json'), lock.stdout);
const preview = path.join(output, 'assembly-review-demo.png');
fs.writeFileSync(preview, PNG.encode(width, height, sheet));
console.log(preview);
