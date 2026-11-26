'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { KIT } = require('..').load();
const PNG = require('../cli/png.js');

const out = path.resolve(process.argv[2] ?? 'assembly-stretch-demo');
const cli = path.resolve(__dirname, '../cli/ink-studio.js');
fs.mkdirSync(out, { recursive: true });
const run = (...args) => execFileSync(process.execPath, [cli, ...args], { cwd: out, encoding: 'utf8', stdio: 'pipe' });
const save = (file, value) => fs.writeFileSync(path.join(out, file + '.json'), JSON.stringify(value, null, 2) + '\n');
const socket = (x, y, direction) => ({ p: [x, y, 0], dir: direction });
const union = (id, shape) => ({ id, kind: 'join', how: 'union', shape });
const block = (at, half, mat, round = .04) => ({ kind: 'box', at, half, mat, round });
const start = -1.5, stop = 1.1, y = .45, left = [start, y, 0], right = [stop, y, 0];
const face = [1, 0, 0], back = [-1, 0, 0];
save('gantry', {
  id: 'inspection-gantry', seed: 17,
  camera: { target: [.65, .32, 0], dist: 8.65, yaw: .32, pitch: .52 },
  style: {
    sun: [-.49, .83, .47], amb: .22,
    palette: [0x13202b, 0x20353f, 0x304e60, 0x4e7888, 0x8cb0b5, 0xc5dcce,
      0x402c2d, 0x754838, 0xb46b44, 0xe39554, 0xffc578, 0xffe6a7,
      0x143e36, 0x276452, 0x4b9c7c, 0x89c69c, 0xc4e8bc],
    roles: { stone: [0, 1, 2, 3, 4, 5], metal: [6, 7, 8, 9, 10, 11], signal: [12, 13, 14, 15, 16] }
  },
  parts: { bed: { joint: left }, boom: { parent: 'bed', joint: left },
    head: { parent: 'boom', joint: right } },
  solids: [
    { id: 'base', part: 'bed', ...block([-1.95, .05, 0], [.55, .22, .54], 'stone', .095), res: .04,
      modifiers: [union('mast', block([-1.8, .31, 0], [.33, .38, .34], 'metal', .07))],
      sockets: { root: socket(start, y, face), flange: socket(start, y, face) } },
    { id: 'rail', part: 'boom', ...block([-.20, y, 0], [1.33, .18, .255], 'stone', .055), res: .035,
      transform: { pivot: [-.2, y, 0] },
      sockets: { inlet: socket(start, y, back), outlet: socket(stop, y, face) },
      modifiers: [union('ridge', block([-.2, .54, .13], [1.23, .096, .105], 'metal', .023))],
      sdfPaint: { version: 1, strokes: [{
        id: 'inspection-band', material: 'signal', grid: [6, 4],
        projection: { origin: [-.18, 2, 0], right: [.26, 0, 0], down: [0, 0, .22], forward: [0, -1, 0], perspective: false },
        cells: [[2, 1, [-.26, .63, -.12], [0, 1, 0], .09], [2, 2, [-.26, .63, .11], [0, 1, 0], .09]]
      }] } },
    { id: 'sensor', part: 'head', ...block([1.37, .45, 0], [.29, .28, .36], 'metal', .075), res: .034,
      transform: { pivot: right },
      modifiers: [
        union('lens', { kind: 'lathe', at: [1.39, .45, .28], h: .20, r: [.151, .125], turn: [0, Math.PI / 2, 0], mat: 'stone' })
      ],
      sockets: { handle: socket(stop, y, back), outlet: socket(1.66, y, face) } }
  ]
});

const request = { members: [{ solid: 'base', mode: 'fixed' }, { solid: 'rail' }, { solid: 'sensor', mode: 'rigid' }],
  anchor: { solid: 'base', socket: 'root' }, handle: { solid: 'sensor', socket: 'handle' }, length: 4,
  connections: [
    { id: 'base-to-rail', a: { solid: 'base', socket: 'flange' }, b: { solid: 'rail', socket: 'inlet' }, maxAngle: 2 },
    { id: 'rail-to-sensor', a: { solid: 'rail', socket: 'outlet' }, b: { solid: 'sensor', socket: 'handle' }, maxAngle: 2 }
  ],
  jointLimits: [{ part: 'head', maxLength: 4.3 }]
};
save('stretch-request', request);
save('blocked-request', { ...request, length: 4.65, members: [...request.members.slice(0, 2),
  { solid: 'sensor', mode: 'rigid', grip: { socket: 'outlet' } }] });
const approved = run('assembly-stretch', 'apply', 'gantry.json', 'stretch-request.json', '--out', 'stretched.json');
const blocked = run('assembly-stretch', 'plan', 'gantry.json', 'blocked-request.json', '--preview', 'blocked.json');
fs.writeFileSync(path.join(out, 'stretch-report.json'), approved);
fs.writeFileSync(path.join(out, 'blocked-report.json'), blocked);

const panels = [['gantry', 'AT REST'], ['stretched', '4.0  APPROVED'], ['blocked', 'LIMIT + SLIP']];
const w = 410, h = 260, gap = 10, heading = 24, width = w * 3 + gap * 4, height = h + heading + gap * 2;
const sheet = Buffer.alloc(width * height * 3, 20);
for (const [i, [stage, title]] of panels.entries()) {
  const x = gap + (w + gap) * i;
  run('render', stage + '.json', '--ortho', '--px', '1', '--w', String(w), '--h', String(h), '--out', stage + '.png');
  const { rgb } = PNG.read(path.join(out, stage + '.png'));
  for (let y = 0; y < h; y++)
    sheet.set(rgb.subarray(y * w * 3, (y + 1) * w * 3), ((heading + gap + y) * width + x) * 3);
  const { data, width: tw, height: th } = KIT.procedural.drawing2d.text(title,
    { color: i === 2 ? '#ffad83' : '#dce4df', scale: 2 }).value;
  for (let y = 0; y < th; y++) for (let col = 0; col < tw; col++) {
    const p = (y * tw + col) * 4;
    if (data[p + 3]) sheet.set(data.subarray(p, p + 3), ((gap + y) * width + x + col) * 3);
  }
}
const preview = path.join(out, 'assembly-stretch-demo.png');
fs.writeFileSync(preview, PNG.encode(width, height, sheet));
console.log(preview);
