'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { KIT } = require('..').load();
const PNG = require('../cli/png.js');
const output = path.resolve(process.argv[2] ?? 'paint-mark-pressure-demo');
const cli = path.resolve(__dirname, '../cli/ink-studio.js');
fs.mkdirSync(output, { recursive: true });
const run = (...args) => execFileSync(process.execPath, [cli, ...args], { cwd: output, encoding: 'utf8', stdio: 'pipe' });
const put = (name, json) => fs.writeFileSync(path.join(output, name + '.json'), JSON.stringify(json, null, 2) + '\n');

const palette = [0x141a26, 0x202e3e, 0x304657, 0x415b66, 0x638081,
  0x3a2c2a, 0x695046, 0x9b7459, 0xc7a373, 0xe9cb97,
  0x74372b, 0xbc5a38, 0xec8a53, 0xffbc76, 0xffe6aa,
  0x1c6562, 0x36978a, 0x5ec9ab, 0x90e4c4, 0xc3ffe3,
  0x564176, 0x7e65a0, 0xb296cf, 0xe0b8f1, 0xfce4ff];
const roles = { stone: [1, 2, 3, 4], dark: [0, 1, 2], brass: [5, 6, 7, 8, 9], amber: [10, 11, 12, 13, 14],
  mint: [15, 16, 17, 18, 19], orchid: [20, 21, 22, 23, 24] };
const box = (id, at, half, mat, round, res = .06) => ({ kind: 'box', id, at, half, mat, round, res });
put('base', { id: 'brush-study', style: { palette, roles, amb: .3, sky: .35, sun: [-.44, .65, .66] },
  camera: { target: [0, 1.57, .15], dist: 6.4, yaw: .08, pitch: .10, sway: 0 },
  finish: { detail: 15, dither: 0 }, solids: [
    box('frame', [0, 1.57, -.04], [2.46, 1.54, .25], 'brass', .22),
    box('face', [0, 1.57, .09], [2.37, 1.45, .205], 'dark', .17),
    ...[-2.08, 2.08].flatMap(x => [.34, 2.78].map(y => ({ kind: 'ball', id: 'rivet-' + x + '-' + y,
      at: [x, y, .29], r: .056, mat: 'brass', res: .035 })))
  ] });

const surface = { kind: 'surface', slot: 'board', snap: { mode: 'surface', maxDistance: .35, direction: [0, 0, 1], offset: .035 } };
const quaternion = angle => [0, 0, Math.sin(angle / 2), Math.cos(angle / 2)];
const mark = (id, brush, mat, points, pressureResponse, path) => ({ id, brush, mat, pressureResponse, ...(path && { path }),
  poses: points.map(([x, y, pressure, angle]) => ({ point: [x, y, .55], pressure, ...(angle !== undefined && { rotation: quaternion(angle) }) })),
  res: .032, attachment: surface });
const sphere = { kind: 'sphere', radius: .105 };
const sweep = y => Array.from({ length: 19 }, (_, n) => {
  const f = n / 18;
  return [-1.38 + 2.76 * f, y + .06 * Math.sin(2 * Math.PI * f), .03 + .97 * f];
});
const input = { id: 'study', bindings: { board: 'face' }, painting: { format: KIT.authoring.paintings3d.format, version: 1,
  id: 'brush-calibration', marks: [
    mark('dab', { kind: 'box', half: [.36, .125, .062], round: .03 }, 'orchid', [[-.93, 2.53, .45, .47]], { width: [1, 1] }),
    mark('opacity', sphere, 'amber', sweep(1.95), { opacity: [.015, .96] }),
    mark('width', sphere, 'mint', sweep(1.34), { width: [.31, 1.6] }),
    mark('ruler', { kind: 'box', half: [.115, .045, .052], round: .022 }, 'orchid',
      [[-1.38, .67, .30, -.34], [-.52, .84, .72, .21], [.36, .48, .64, -.23], [1.38, .67, .91, .26]], { width: [1, 1] }, 'ruled')
  ] } };
put('placement', input);
put('edit', { id: 'study', edits: [
  { op: 'set', id: 'opacity', patch: { pressureResponse: { width: [.31, 1.6] } } },
  { op: 'set', id: 'width', patch: { pressureResponse: { opacity: [.015, .96] } } },
  { op: 'set', id: 'ruler', patch: { path: 'free' } }
] });
const report = run('painting-3d', 'apply', 'base.json', 'placement.json', '--out', 'painted.json');
fs.writeFileSync(path.join(output, 'placement-report.json'), report);
const editReport = run('painting-3d', 'update', 'painted.json', 'edit.json', '--out', 'remapped.json');
fs.writeFileSync(path.join(output, 'edit-report.json'), editReport);
run('painting-3d', 'extract', 'remapped.json', '--id', 'study', '--out', 'painting.json');

const w = 468, h = 320, gap = 10, title = 44, footer = 33;
function render(scene) {
  run('render', scene + '.json', '--ortho', '--raw', '--px', '1', '--w', String(w), '--h', String(h), '--out', scene + '.png');
  return PNG.read(path.join(output, scene + '.png')).rgb;
}
const width = 2 * w + 3 * gap, height = title + h + footer;
const rgb = Buffer.alloc(width * height * 3);
for (let i = 0; i < rgb.length; i += 3) rgb.set([17, 24, 36], i);
function text(label, x, y, scale, color) {
  const bitmap = KIT.procedural.drawing2d.text(label, { color, scale }).value;
  for (let j = 0; j < bitmap.height; j++) for (let k = 0; k < bitmap.width; k++) {
    const start = (j * bitmap.width + k) * 4;
    if (bitmap.data[start + 3]) rgb.set(bitmap.data.subarray(start, start + 3), ((y + j) * width + x + k) * 3);
  }
}
const panels = [
  ['ORIGINAL MAPPING', 'ORIENTED DAB / OPACITY / WIDTH / RULED', 'painted'],
  ['SAME POSES, NEW MAPPING', 'ORIENTED DAB / WIDTH / OPACITY / FREE', 'remapped']
];
for (const [i, [heading, caption, scene]] of panels.entries()) {
  const x = gap + i * (w + gap), pixels = render(scene);
  text(heading, x + 14, 15, 2, '#f4e5c7');
  for (let y = 0; y < h; y++) rgb.set(pixels.subarray(y * w * 3, (y + 1) * w * 3), ((title + y) * width + x) * 3);
  text(caption, x + 14, title + h + 12, 1, '#becccf');
}
const demo = path.join(output, 'paint-mark-pressure-demo.png');
fs.writeFileSync(demo, PNG.encode(width, height, rgb));
console.log(demo);
