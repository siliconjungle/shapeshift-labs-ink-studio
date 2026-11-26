'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { KIT } = require('..').load();
const PNG = require('../cli/png.js');

const out = path.resolve(process.argv[2] ?? 'sculpt-snap-demo');
const cli = path.resolve(__dirname, '../cli/ink-studio.js');
fs.mkdirSync(out, { recursive: true });
const run = (...args) => execFileSync(process.execPath, [cli, ...args], { cwd: out, encoding: 'utf8', stdio: 'pipe' });
const save = (file, value) => fs.writeFileSync(path.join(out, file + '.json'), JSON.stringify(value, null, 2) + '\n');
const pose = (point, pressure = 1) => ({ point, pressure });
save('original', {
  id: 'engraved-seed', seed: 12, camera: { target: [0, .32, 0], dist: 5.15, yaw: .26, pitch: .55 },
  style: {
    sun: [-.59, .81, .51], amb: .15,
    palette: [0x12202a, 0x1f3541, 0x2d5364, 0x427c8b, 0x719eaa, 0xa8c9c9,
      0x3d2429, 0x704337, 0xa25d42, 0xcb7f4e, 0xf0ab61, 0xffda92],
    roles: { stone: [0, 1, 2, 3, 4, 5], metal: [6, 7, 8, 9, 10, 11] }
  },
  solids: [
    { id: 'seat', kind: 'lathe', at: [0, -.87, 0], h: .29, r: [1.12, .90], mat: 'metal', res: .038 },
    { id: 'seed', kind: 'ball', at: [0, 0, 0], r: [1.43, .83, 1.09], mat: 'stone', res: .035 }
  ]
});
save('engrave-request', { id: 'engraving', target: 'seed', op: 'cut', brush: { kind: 'sphere', radius: .10 },
  poses: [pose([-1.09, 1.02, .42], .62), pose([-.77, 1.02, .62]), pose([-.39, 1.02, .31], 1.12),
    pose([-.04, 1.02, .62]), pose([.31, 1.02, .32]), pose([.64, 1.02, .58], .94), pose([1.02, 1.02, .39], .67)],
  snap: { mode: 'surface', direction: [0, 1, 0], maxDistance: .72, spacing: .037 } });
save('root-request', { id: 'tendril', target: 'seed', op: 'add', mat: 'metal', brush: { kind: 'sphere', radius: .16 },
  poses: [pose([.17, 1.05, -.32], 1.24), pose([.25, 1.31, -.35], 1.1), pose([.58, 1.56, -.33], 1),
    pose([.56, 1.85, -.34], .87), pose([.29, 2.01, -.33], .73),
    pose([.02, 1.88, -.32], .57), pose([.12, 1.67, -.28], .34)],
  snap: { mode: 'root', maxDistance: .47, direction: [0, 1, 0], offset: -.035 } });

for (const [source, name, output] of [['original', 'engrave', 'engraved'], ['engraved', 'root', 'planted']]) {
  const report = run('sculpt-snap', 'apply', source + '.json', name + '-request.json', '--out', output + '.json');
  fs.writeFileSync(path.join(out, name + '-report.json'), report);
}
const panels = [['original', 'BEFORE'], ['engraved', 'WHOLE STROKE'], ['planted', 'ROOT ONLY']];
const w = 355, h = 300, gap = 10, heading = 25, width = w * 3 + gap * 4, height = h + heading + gap * 2;
const sheet = Buffer.alloc(width * height * 3, 20);
for (const [i, [stage, title]] of panels.entries()) {
  const x = gap + (w + gap) * i;
  run('render', stage + '.json', '--ortho', '--px', '1', '--w', String(w), '--h', String(h), '--out', stage + '.png');
  const { rgb } = PNG.read(path.join(out, stage + '.png'));
  for (let y = 0; y < h; y++) sheet.set(rgb.subarray(y * w * 3, (y + 1) * w * 3), ((heading + gap + y) * width + x) * 3);
  const { data, width: tw, height: th } = KIT.procedural.drawing2d.text(title, { color: '#dbe4e3', scale: 2 }).value;
  for (let y = 0; y < th; y++) for (let col = 0; col < tw; col++) {
    const p = (y * tw + col) * 4;
    if (data[p + 3]) sheet.set(data.subarray(p, p + 3), ((gap + y) * width + x + col) * 3);
  }
}
const preview = path.join(out, 'sculpt-snap-demo.png');
fs.writeFileSync(preview, PNG.encode(width, height, sheet));
console.log(preview);
