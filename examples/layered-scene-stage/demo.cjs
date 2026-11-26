'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const PNG = require('../../cli/png.js');
const Files = require('../../cli/asset-files.js');
const { hash } = require('../../cli/asset-references.js');
const { KIT: kit } = require('../..').load();

const out = path.resolve(process.argv[2] ?? 'studio/layered-scene-stage');
const file = name => path.join(out, name);
const cli = path.resolve(__dirname, '../../cli/ink-studio.js');
const run = (...args) => execFileSync(process.execPath, [cli, ...args], { stdio: 'inherit' });
const put = (filename, value) => Files.json(file(filename), value);
const read = filename => JSON.parse(fs.readFileSync(file(filename), 'utf8'));
const op = (path, value, op = 'set') => ({ op, path, value });
const stageFile = 'source/watchlight.stage.json';
const variant = ['--stage-selection', 'night-watch'];
const w = 224, h = 150;
const view = ['--w', String(w), '--h', String(h), '--px', '1', '--raw', '--t', '0.4'];
const soil = 'stone', copper = 'roof', brass = 'hardware', mint = 'moss';
const amberGlow = { role: 'amber', glow: true };

const solid = (id, kind, mat, at, shapes) => ({ id, kind, mat, at, ...shapes });
const box = (id, mat, at, half, res = .063) => solid(id, 'box', mat, at, { half, res, round: .035 });
const rock = (id, mat, at, r, res = .11) => solid(id, 'rock', mat, at, { r, res });
const lathe = (id, mat, at, height, r, res = .065) => solid(id, 'lathe', mat, at, { h: height, r, res });
const tube = (id, mat, pts, r, res = .05) => ({ id, kind: 'tube', mat, pts, r, res });

const day = [
  0xa5bac1, 0x243548, 0x385565, 0x55727a, 0x7b9090, 0xa6aaa0, 0xd1c6aa, 0xf2dec1,
  0x253d44, 0x3d6262, 0x578477, 0x77a286, 0xa8bb91,
  0x4d3338, 0x783f42, 0xb25b4a, 0xda8361, 0xf5a978,
  0x453335, 0x825145, 0xbb8165, 0xe4b784, 0xffd6a2,
  0x1b4952, 0x286976, 0x50868d, 0x6fa5a4, 0xa1c0b9,
  0x673b47, 0xa55062, 0xe48273, 0xffb785, 0xffe8ad,
  0x2b536e, 0x3e7d99, 0x6bb3c1, 0x93d5d6, 0xe0f9e7
];
const night = [
  0x171d3a, 0x10182f, 0x212945, 0x363d58, 0x505978, 0x686d8b, 0x878cad, 0xb2acd0,
  0x192838, 0x273d47, 0x415663, 0x637771, 0x89967f,
  0x182841, 0x283758, 0x3d5276, 0x587396, 0x8f9ebd,
  0x352635, 0x624047, 0xa05950, 0xdb8260, 0xfdbd7d,
  0x0e2038, 0x172944, 0x233a5d, 0x354976, 0x535e91,
  0x583355, 0xb25459, 0xed825c, 0xffb573, 0xffe5a0,
  0x264969, 0x3b7299, 0x73b1d0, 0x9ddce9, 0xf0ffff
];
const roles = { stone: [1,2,3,4,5,6,7], moss: [8,9,10,11,12], roof: [13,14,15,16,17],
  hardware: [18,19,20,21,22], sea: [23,24,25,26,27], amber: [28,29,30,31,32], ice: [33,34,35,36,37] };

const base = { id: 'watchlight-station', name: 'Watchlight Station', seed: 913, palette: day, roles,
  camera: { target: [0,.99,0], dist: 12.5, yaw: .21, pitch: .26, projection: 'orthographic' },
  light: { sun: [-.62,.73,.34], amb: .33, sky: .22 },
  finish: { detail: 21, radius: 11, dither: .05, look: { pixel: true, splatCoverage: 'continuous' } },
  solids: [
    rock('islet', soil, [-.72,-.35,-.13], [3.15,1.05,2.12]),
    rock('jutting-shelf', soil, [1.85,-.41,.68], [1.95,.64,1.42]),
    rock('shale', soil, [-2.58,-.33,1.05], [1.36,.74,1.03], .098),
    rock('grass', mint, [-1.2,.42,.19], [2.16,.38,1.64], .088),
    lathe('tower-plinth', soil, [-.76,.61,-.24], .23, [1.11,1.06]),
    lathe('tower', soil, [-.76,.82,-.24], 2.08, [.91,.70]),
    lathe('rim', brass, [-.76,2.81,-.24], .21, [.75,.92], .055),
    lathe('roof', copper, [-.76,3.53,-.24], .88, [[0,1.03],[.22,.87],[.6,.46],[1,.08]], .054),
    lathe('lantern-bay', brass, [-.76,3.03,-.24], .53, [.64,.64], .052),
    solid('lantern', 'ball', amberGlow, [-.76,3.31,.24], { r: .37, res: .038 }),
    box('door', brass, [-.72,1.33,.63], [.24,.45,.10]),
    box('door-glass', amberGlow, [-.72,1.50,.75], [.085,.12,.03], .031),
    box('sill', soil, [-.72,.91,.92], [.37,.095,.30]),
    box('pier', brass, [2.55,.02,1.05], [1.62,.10,.60]),
    box('sea', 'sea', [0,-.93,-10], [22,.05,27], .47),
    rock('low-shore', soil, [-6.1,-.82,-9.4], [3,.55,1.9], .225),
    rock('far-shore', soil, [4.8,-.92,-14.6], [5.2,1.1,3.0], .25)
  ]
};
for (let i = 0; i < 7; i++) {
  base.solids.push(tube('lantern-rail-' + i, copper, [3.04,3.57].map(y => {
    const angle = (i + .25) * Math.PI * 2 / 7;
    return [-.76 + Math.sin(angle) * .67, y, -.24 + Math.cos(angle) * .67];
  }), .032, .04));
  base.solids.push(box('pier-plank-' + i, brass, [1.43 + i * .41,.15,1.05], [.19,.047,.62]));
}
for (const [x,z] of [[1.08,.55],[1.08,1.55],[3.98,.55],[3.98,1.55]])
  base.solids.push(box('pile-' + base.solids.length, brass, [x,-.28,z], [.09,.51,.095]));
for (let i = 0; i < 12; i++) {
  const x = -3.27 + i * .42, z = .93 + .34 * Math.sin(i * 1.31);
  base.solids.push(rock('shore-cover-' + i, i % 3 ? mint : soil, [x,.43 + .11 * Math.sin(i),z],
    [.27 + .06 * (i % 4),.13,.25], .061));
}
const layer = edits => ({ format: 'ink-studio/scene-stage-layer', version: 1, edits });
const append = (...items) => items.map((item, i) => op('/solids/' + (base.solids.length + i), item));
const coreFile = 'layers/rig.json', assetFile = 'layers/shore-kit.json', payloadFile = 'layers/signal-buoys.json';
put('source/base.json', base);
put('source/' + assetFile, layer(append(
  box('pier-brace', brass, [3.48,.47,1.42], [.61,.05,.061]),
  box('pier-lamp-stem', brass, [3.91,.48,1.43], [.054,.37,.055]),
  box('pier-lamp', amberGlow, [3.91,.89,1.43], [.105,.09,.095], .037),
  box('pier-lamp-roof', copper, [3.91,1.01,1.43], [.14,.045,.13], .041))));
put('source/' + coreFile, layer([
  op('/parts', { crown: { joint: [-.76,4.41,-.24] } }),
  op('/motion', [{ do: 'spin', part: 'crown', axis: [0,1,0], speed: .4 }]),
  op('/solids/' + (base.solids.length + 4), { ...tube('wind-vane', brass,
    [[-1.17,4.54,-.24],[-.33,4.54,-.24]], .046, .044), part: 'crown' }),
  op('/cameraRig', { shots: { wide: {}, close: { target: [-.42,1.64,.3], dist: 9.8, yaw: .4, pitch: .17 } } })
]));
const stage = { format: 'ink-studio/scene-stage', version: 1, id: 'watchlight-station',
  base: { file: 'base.json', sha256: hash(fs.readFileSync(file('source/base.json'))) },
  variants: { time: { default: 'day', choices: ['day','night'] }, framing: { default: 'wide', choices: ['wide','close'] } },
  selections: { 'night-watch': { variants: { time: 'night', framing: 'close' }, payloads: { 'signal-buoys': true } } },
  layers: [
    { id: 'shore-kit', kind: 'asset', file: assetFile },
    { id: 'tower-rig', kind: 'rig', file: coreFile },
    { id: 'night-materials', kind: 'material', when: { time: 'night' }, edits: [
      op('/palette', night), op('/solids/9/mat', { role: 'ice', glow: true })
    ] },
    { id: 'moonlight', kind: 'lighting', when: { time: 'night' }, edits: [
      op('/light', { sun: [.62,.47,-.41], amb: .15, sky: .18 }, 'merge')
    ] },
    { id: 'signal-buoys', kind: 'asset', file: payloadFile, payload: { default: false } },
    { id: 'close-shot', kind: 'shot', when: { framing: 'close' }, edits: [
      op('/cameraRig/sequence', [{ time: 0, shot: 'close' }]), op('/solids/9/mat/role', 'amber')
    ] }
  ]
};
put(stageFile, stage);

const defaultFrame = 'day-establishing.png', compareFrame = 'night-establishing.png', finalFrame = 'night-watch.png';
run('render', file(stageFile), ...view, '--out', file(defaultFrame));
run('scene-stage', 'explain', file(stageFile), '--out', file('day-resolution.json'));
const daytime = read('day-resolution.json');
assert.equal(daytime.layers.find(row => row.id === 'signal-buoys').status, 'payload-unloaded');
assert.equal(daytime.layers.find(row => row.id === 'signal-buoys').source.sha256, undefined);

const buoys = [];
for (const [i, x, z] of [[0,4.15,1.88],[1,2.82,2.52],[2,.99,2.78]]) {
  buoys.push(lathe('buoy-base-' + i, copper, [x,-.88,z], .23, [.20,.14], .04),
    solid('buoy-lens-' + i, 'mesh', amberGlow, [x,-.57,z], { asset: 'props/buoy-lens.obj', size: .32, res: .044 }));
}
put('source/' + payloadFile, layer(buoys.map((item, i) => op('/solids/' + (base.solids.length + 5 + i), item))));
Files.write(file('source/props/buoy-lens.obj'), `v 0 .9 0
v -1 0 0
v 0 0 1
v 1 0 0
v 0 0 -1
v 0 -.65 0
f 1 2 3
f 1 3 4
f 1 4 5
f 1 5 2
f 6 3 2
f 6 4 3
f 6 5 4
f 6 2 5
`);
run('render', file(stageFile), ...view, ...variant,
  '--stage-variants', 'framing=wide', '--stage-payloads', 'signal-buoys=off', '--out', file(compareFrame));
run('render', file(stageFile), ...view, ...variant, '--out', file(finalFrame));
run('scene-stage', 'explain', file(stageFile), ...variant, '--at', '/solids/9/mat/role',
  '--out', file('lantern-resolution.json'));
const resolution = read('lantern-resolution.json');
assert.equal(resolution.layers.find(row => row.id === 'signal-buoys').payloadLoaded, true);
assert.deepEqual(resolution.query.history.map(entry => [entry.layer, entry.after.value]), [
  ['night-materials', 'ice'], ['close-shot', 'amber']
]);
run('scene-stage', 'resolve', file(stageFile), ...variant, '--out', file('portable/watchlight.json'));
const bundle = read('portable/watchlight.json');
assert.deepEqual(Object.keys(bundle.files).sort(), ['props/buoy-lens.obj', 'watchlight.stage.json']);
const relocated = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-watchlight-'));
let reopened;
try {
  const moved = path.join(relocated, 'watchlight.json');
  fs.copyFileSync(file('portable/watchlight.json'), moved);
  run('render', moved, ...view, '--out', file('portable/reopened.png'));
  reopened = fs.readFileSync(file('portable/reopened.png'));
  assert.deepEqual(reopened, fs.readFileSync(file(finalFrame)));
} finally {
  fs.rmSync(relocated, { recursive: true, force: true });
}

const gap = 8, top = 36, width = gap * 4 + w * 3, height = top + h + 23;
const label = (text, x, y, color, scale = 1) => ({ type: 'text', text, at: [x,y], color, scale });
const commands = [{ type: 'rect', rect: [0,0,width,height], fill: '#101622' },
  label('WATCHLIGHT STATION', gap, 8, '#f3c790', 2),
  label('DAY  /  WIDE', gap, 25, '#bfccd0'), label('NIGHT  /  WIDE', w + gap * 2, 25, '#bfccd0'),
  label('NIGHT WATCH  /  CLOSE', w * 2 + gap * 3, 25, '#bfccd0'),
  label('BASE RAMP AND DAYLIGHT', gap, top + h + 8, '#95a7b5'),
  label('MOONLIGHT AND COOL LANTERN', w + gap * 2, top + h + 8, '#95a7b5'),
  label('BUOYS LOADED AND AMBER LANTERN', w * 2 + gap * 3, top + h + 8, '#95a7b5')
];
const board = kit.procedural.drawing2d.render({ width, height, commands, edges: 'hard' });
for (const [i, name] of [defaultFrame, compareFrame, finalFrame].entries()) {
  const image = PNG.read(file(name));
  const left = gap + i * (w + gap);
  for (let px = 0; px < w * h; px++)
    board.data.set(image.rgb.subarray(px * 3, px * 3 + 3), ((top + Math.floor(px / w)) * width + left + px % w) * 4);
}
Files.write(file('watchlight-stages.png'), PNG.encode(width, height, board.data, 4));
put('verification.json', { stage: stageFile, selection: 'night-watch', frames: [defaultFrame, compareFrame, finalFrame],
  bundledFiles: Object.keys(bundle.files).sort(), unloadedPayloadRead: false, relocatedRenderMatches: true,
  nativePNGHash: hash(reopened), query: resolution.query });
