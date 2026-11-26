'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const ink = require('..');
const PNG = require('../cli/png.js');

const out = path.resolve(process.argv[2] ?? 'sculpt-sweep-demo');
fs.mkdirSync(out, { recursive: true });
const save = (name, value) => fs.writeFileSync(path.join(out, name), JSON.stringify(value, null, 2) + '\n');
const cli = path.resolve(__dirname, '../cli/ink-studio.js');
const run = (...args) => execFileSync(process.execPath, [cli, ...args], { cwd: out, stdio: 'pipe' });
const sweep = (verb, source, request, next, ...options) =>
  run('sculpt-sweep', verb, source, request, '--out', next, ...options);
const turn = degrees => [0, Math.sin(degrees * Math.PI / 360), 0, Math.cos(degrees * Math.PI / 360)];
const pose = (point, pressure, degrees) => ({ point, pressure, rotation: turn(degrees) });

save('base.json', {
  id: 'channel-gauge', seed: 23,
  camera: { target: [0, .35, 0], dist: 9, yaw: .38, pitch: .57 },
  style: {
    sun: [-.6, .75, .5],
    palette: [0x161e2b, 0x232e3b, 0x394c5a, 0x5a7181, 0x8ca2ab, 0xbccac3,
      0x39282c, 0x64403a, 0x99543f, 0xc9794c, 0xeaa664, 0xf9d992],
    roles: { stone: [1, 2, 3, 4, 5], metal: [6, 7, 8, 9, 10, 11] }
  },
  solids: [
    { id: 'gauge', kind: 'box', at: [0, 0, .58], half: [2.65, .32, 1.06], round: .13, mat: 'stone', res: .065 },
    { id: 'foot-left', kind: 'box', at: [-1.73, -.39, .58], half: [.36, .18, .74], round: .055, mat: 'metal', res: .075 },
    { id: 'foot-right', kind: 'box', at: [1.73, -.39, .58], half: [.36, .18, .74], round: .055, mat: 'metal', res: .075 }
  ]
});

save('fin.json', {
  id: 'fin', brush: { kind: 'wedge', half: [.29, .42, .20] }, mat: 'metal', res: .055, blendRadius: .10,
  poses: [pose([-2.16, .06, -.87], .8, 100), pose([-1.12, .34, -.99], 1, 89),
    pose([-.24, .57, -1.15], 1.22, 75), pose([.64, .95, -1.36], .92, 60), pose([1.30, 1.43, -1.62], .20, 48)]
});
save('channel.json', {
  id: 'channel', brush: { kind: 'profile', points: [[-.31, .26], [0, -.36], [.31, .26]], depth: .29 },
  poses: [pose([-2.17, .38, .76], .74, 111), pose([-1.34, .38, .50], .86, 96),
    pose([-.32, .38, .48], 1, 80), pose([.74, .38, .70], .98, 83), pose([2.09, .38, .80], .74, 86)],
  res: .052, blendRadius: .07
});
save('revise.json', {
  id: 'channel',
  poses: [pose([-2.17, .38, .76], .74, 112), pose([-1.32, .40, .37], .8, 98),
    pose([-.32, .43, .40], .93, 64), pose([.74, .43, .97], 1.17, 72), pose([2.09, .39, 1.14], .80, 87)],
  blendRadius: .14
});

sweep('add', 'base.json', 'fin.json', 'raised.json');
sweep('cut', 'raised.json', 'channel.json', 'carved.json', '--target', 'gauge');
sweep('update', 'carved.json', 'revise.json', 'revised.json', '--target', 'gauge');
const inspection = run('sculpt-sweep', 'inspect', 'revised.json', '--target', 'gauge', '--id', 'channel');
fs.writeFileSync(path.join(out, 'revised-sweep.json'), inspection);

const w = 380, h = 300, gutter = 10, heading = 25, labels = ['RAISED WEDGE', 'PROFILE CUT', 'REVISED CUT'];
const { drawing2d } = ink.load().KIT.procedural;
const width = w * labels.length + gutter * (labels.length + 1);
const height = h + heading + gutter * 2;
const image = Buffer.alloc(width * height * 3, 20);
for (const [i, stage] of ['raised', 'carved', 'revised'].entries()) {
  const x = gutter + (w + gutter) * i;
  run('render', stage + '.json', '--ortho', '--px', '1', '--w', String(w), '--h', String(h),
    '--out', stage + '.png');
  const { rgb } = PNG.read(path.join(out, stage + '.png'));
  for (let y = 0; y < h; y++) {
    const a = y * w * 3, b = ((heading + gutter + y) * width + x) * 3;
    image.set(rgb.subarray(a, a + w * 3), b);
  }
  const { data, width: tw, height: th } = drawing2d.text(labels[i], { color: '#d5ddd9', scale: 2 }).value;
  for (let y = 0; y < th; y++) for (let a = 0; a < tw; a++) {
    const p = (y * tw + a) * 4;
    if (data[p + 3]) image.set(data.subarray(p, p + 3), ((gutter + y) * width + x + 6 + a) * 3);
  }
}
const sheet = path.join(out, 'sculpt-sweep-demo.png');
fs.writeFileSync(sheet, PNG.encode(width, height, image));
console.log(sheet);
