'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { KIT } = require('..').load();
const PNG = require('../cli/png.js');
const output = path.resolve(process.argv[2] ?? 'paint-relief-demo');
const cli = path.resolve(__dirname, '../cli/ink-studio.js');
fs.mkdirSync(output, { recursive: true });
const run = (...args) => execFileSync(process.execPath, [cli, ...args], { cwd: output, encoding: 'utf8', stdio: 'pipe' });
const put = (name, value) => fs.writeFileSync(path.join(output, name + '.json'), JSON.stringify(value, null, 2) + '\n');

const palette = [0x111c2a,0x203340,0x2a4650,0x3f5b60,0x5d7674,0x84958b,0xadac90,0xd9c5a4,
  0x102a37,0x1d404a,0x2b575e,0x417477,0x63918a,0x98b8a0,0xb8ceac,0xd7e0be,
  0x4b302a,0x714535,0xa2704a,0xc39460,0xe4bb7c,0xf6d698,0xffe2a8];
const scene = { id: 'relief-study', seed: 33,
  style: { palette, roles: { stone: [8,9,10,11,12,13,14,15], seat: [1,2,3,4,5,6,7], ink: [16,17,18,19,20,21,22] },
    sun: [-.52,.62,.39], amb: .34, sky: .17 },
  camera: { target: [0, 1.30, .21], dist: 5.58, yaw: .10, pitch: .21, sway: 0 },
  finish: { detail: 16, dither: 0, shadowMarch: { steps: 28, distance: 4, emptySpace: 'clear' } },
  solids: [
    { id: 'backplate', kind: 'box', at: [0, 1.27, -.10], half: [2.12, 1.03, .15], round: .15, mat: 'seat', res: .052 },
    { id: 'clay', kind: 'box', at: [0, 1.27, .10], half: [1.86, .85, .23], round: .125, mat: 'stone', res: .030 }
  ] };
put('base', scene);
const snap = { mode: 'surface', direction: [0, 0, 1], maxDistance: .43 };
const point = (x, y, pressure = 1) => ({ point: [x, y, .58], pressure });
const stamp = (id, poses, radius) => ({ id, brush: { kind: 'sphere', radius }, poses, step: .039, res: .025, mat: 'ink',
  attachment: { kind: 'surface', slot: 'tile', snap } });
const main = Array.from({ length: 27 }, (_, i) => {
  const u = i / 26;
  return point(-1.54 + 3.22 * u, 1.24 + .31 * Math.sin(u * Math.PI * 2.25) + .06 * u, .86 + .16 * Math.sin(Math.PI * u));
});
const marks = [
  stamp('wave', main, .173),
  stamp('upper-scroll', [point(-.36, 1.79, .81), point(-.19, 1.82, .9), point(.04, 1.78), point(.19, 1.72, .74)], .101),
  stamp('lower-scroll', [point(.41, .87, .76), point(.55, .78, .9), point(.75, .73), point(1.01, .76, .76)], .109),
  stamp('small-seal', [point(-1.20, .92)], .111),
  stamp('small-point', [point(-.91, .84, .76)], .085)
];
const format = KIT.authoring.paintings3d.format, id = 'slip';
const flat = { mode: 'flat' }, raised = { mode: 'volume', height: .31, seat: .109, castShadow: false };
const placement = { id, bindings: { tile: 'clay' },
  painting: { id: 'kiln-seal', format, version: 1, marks: marks.map(mark => ({ ...mark, relief: flat })) } };
const variants = [
  ['flat', 'FLAT PIGMENT', flat],
  ['lit-ridge', 'SHADING / RAISED', {mode: 'shading', height: .115, feather: .085}],
  ['lit-groove', 'SHADING / RECESSED', {mode: 'shading', height: -.115, feather: .085}],
  ['volume-off', 'RAISED / CAST OFF', raised],
  ['volume-on', 'RAISED / CAST ON', {...raised, castShadow: true}],
  ['volume-cut', 'RECESSED VOLUME', {mode: 'volume', height: -.18, seat: .08}]
];
put('placement', placement);
const reports = { flat: JSON.parse(run('painting-3d', 'apply', 'base.json', 'placement.json', '--out', 'flat.json')) };
for (const [name, , relief] of [...variants.slice(1), ['volume-capped', '', { ...raised, castShadow: true, silhouetteAllowance: .075 }]]) {
  const edits = marks.map(mark => ({ op: 'set', id: mark.id, patch: { relief } }));
  put(name + '-edit', { id, edits });
  reports[name] = JSON.parse(run('painting-3d', 'update', 'flat.json', name + '-edit.json', '--out', name + '.json'));
}
reports.reopened = JSON.parse(run('painting-3d', 'inspect', 'volume-cut.json'));
put('relief-report', reports);
run('painting-3d', 'extract', 'volume-on.json', '--id', id, '--out', 'painting.json');

const w = 390, h = 240, gap = 8, caption = 32, width = 3 * w + 4 * gap, height = 2 * (h + caption) + 3 * gap;
const sheet = Buffer.alloc(width * height * 3);
for (let i = 0; i < sheet.length; i += 3) sheet.set([16,23,33], i);
function render(name, extra = []) {
  run('render', name + '.json', '--ortho', '--raw', '--px', '1', '--w', String(w), '--h', String(h),
    ...extra, '--out', name + '.png');
  return PNG.read(path.join(output, name + '.png')).rgb;
}
const shadows = [];
for (const [i, [file, label]] of variants.entries()) {
  const frame = render(file);
  if (file.startsWith('volume-') && (file.endsWith('-on') || file.endsWith('-off'))) shadows.push(frame);
  const x = gap + (i % 3) * (w + gap), y = gap + Math.floor(i / 3) * (h + caption + gap);
  const text = KIT.procedural.drawing2d.text(label, { color: '#f5dcb6', scale: 2 }).value;
  for (let ty = 0; ty < text.height; ty++) for (let tx = 0; tx < text.width; tx++) {
    const src = (ty * text.width + tx) * 4;
    if (text.data[src + 3]) sheet.set(text.data.subarray(src, src + 3), ((y + 8 + ty) * width + x + 12 + tx) * 3);
  }
  for (let row = 0; row < h; row++)
    sheet.set(frame.subarray(row * w * 3, (row + 1) * w * 3), ((y + caption + row) * width + x) * 3);
}
if (shadows[0].every((value, i) => value === shadows[1][i])) throw Error('The cast switch did not affect the render');
render('volume-capped');
const demo = path.join(output, 'paint-relief-demo.png');
fs.writeFileSync(demo, PNG.encode(width, height, sheet));
console.log(demo);
