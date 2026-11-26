'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { KIT } = require('..').load();
const PNG = require('../cli/png.js');
const out = path.resolve(process.argv[2] ?? 'painting-3d-demo');
const cli = path.resolve(__dirname, '../cli/ink-studio.js');
fs.mkdirSync(out, { recursive: true });
const run = (...args) => execFileSync(process.execPath, [cli, ...args], { cwd: out, encoding: 'utf8', stdio: 'pipe' });
const json = (file, data) => fs.writeFileSync(path.join(out, file + '.json'), JSON.stringify(data, null, 2) + '\n');

const palette = [
  0x101926, 0x233047, 0x334961, 0x48647b, 0x729196,
  0x08323a, 0x114c55, 0x22686d, 0x368680, 0x6da799,
  0x634339, 0x9d6345, 0xcc8e4c, 0xfac66e, 0xffe4a1,
  0x1d5a63, 0x359394, 0x65c9b3, 0x9aebcc, 0xe1ffdf,
  0x352847, 0x725780, 0xab87aa, 0xe0abc5, 0xffd2d7,
  0x511d35, 0x963945, 0xc35c57, 0xe88d79, 0xffbb9c
];
const roles = { stone: [1, 2, 3, 4], dark: [0, 1, 2], enamel: [5, 6, 7, 8, 9], gold: [10, 11, 12, 13, 14],
  jade: [15, 16, 17, 18, 19], orchid: [20, 21, 22, 23, 24], coral: [25, 26, 27, 28, 29] };
const box = (id, at, half, mat, round, part) => ({ kind: 'box', id, at, half, mat, round, res: .044, ...(part && { part }) });
const ball = (id, at, r, mat, part) => ({ kind: 'ball', id, at, r, mat, res: .035, ...(part && { part }) });
const base = { id: 'tide-instrument', style: { palette, roles, amb: .31, sky: .30, sun: [-.48, .62, .75] },
  finish: { detail: 15, dither: 0 }, camera: { target: [0, 1.14, .16], dist: 6.4, yaw: .15, pitch: .20, sway: 0 },
  solids: [
    box('stage', [0, -.20, 0], [2.15, .17, .93], 'dark', .15),
    box('foot', [-.56, .155, -.12], [1.10, .18, .54], 'stone', .15),
    box('plate-rim', [-.54, 1.12, -.12], [1.09, .95, .23], 'gold', .23),
    box('plate', [-.54, 1.12, -.005], [1.035, .90, .26], 'enamel', .20),
    ...[-1.36, .28].flatMap(x => [.47, 1.76].map(y => ball('rivet-' + x + '-' + y, [x, y, .26], .050, 'gold'))),
    box('hinge', [.68, 1.15, -.01], [.15, .20, .15], 'stone', .07),
    box('wing', [1.18, 1.15, .01], [.49, .43, .14], 'stone', .11, 'wing'),
    box('wing-face', [1.18, 1.15, .06], [.435, .38, .12], 'dark', .085, 'wing'),
    ball('hinge-pin', [.72, 1.15, .17], .085, 'gold', 'wing')
  ], parts: { wing: { joint: [.70, 1.15, .03] } },
  motion: [{ do: 'turn', part: 'wing', axis: [0, 0, 1], amount: .66, period: 4 },
    { do: 'turn', part: 'wing', axis: [0, 1, 0], amount: -.44, period: 4 }] };

const sample = (count, draw) => Array.from({ length: count }, (_, i) => draw(i / (count - 1)));
const paint = (id, points, mat, radius, options = {}) => ({ id, mat, brush: { kind: 'sphere', radius },
  poses: points.map(row => ({ point: row.slice(0, 3), ...(row[3] !== undefined && { pressure: row[3] }) })),
  step: Math.min(.030, radius * .66), res: .030, ...options });
const surface = { kind: 'surface', slot: 'dial', snap: { mode: 'surface', direction: [0, 0, 1], maxDistance: .55, offset: .022, spacing: .06 } };
const wave = (id, y, phase, radius) => paint(id, sample(33, t => [
  -1.22 + 1.36 * t, y + .135 * Math.sin(t * Math.PI * 3.0 + phase) * Math.sin(t * Math.PI) ** .3,
  .51, .48 + .52 * Math.sin(t * Math.PI) ** .4
]), 'jade', radius, { attachment: surface });
const free = paint('orbit', sample(38, t => [-1.37 + t * 1.68, 1.88 + .57 * Math.sin(Math.PI * t) ** 1.1,
  .50 + t * .32, .38 + .62 * Math.sin(Math.PI * t) ** .55]), 'gold', .054);
const wing = { kind: 'part', slot: 'hinge' };
const stripe = (id, points, radius) => paint(id, points.map(([x, y]) => [x, y, .203]), 'orchid', radius, { attachment: wing });
const placement = { id: 'tide', bindings: { dial: 'plate', hinge: 'wing' },
  painting: { id: 'tide-signals', format: KIT.authoring.paintings3d.format, version: 1, marks: [
    wave('upper-current', 1.34, .26, .055), wave('lower-current', .97, 1.07, .049),
    paint('dial-dot', [[-.60, .694, .52], [-.544, .693, .52]], 'gold', .052, { attachment: surface }), free,
    stripe('wing-diamond', [[.94, 1.15], [1.20, 1.40], [1.48, 1.15], [1.20, .90], [.94, 1.15]], .045),
    stripe('wing-slash', [[1.07, 1.04], [1.32, 1.28]], .047)
  ] } };
const edit = { id: 'tide', edits: [
  { op: 'set', id: 'upper-current', patch: { mat: 'coral', brush: { kind: 'sphere', radius: .083 },
    transform: { position: [0, .16, 0] } } },
  { op: 'move', id: 'upper-current' }
] };
json('base', base);
json('placement', placement);
json('edit', edit);
const command = 'painting-3d';
fs.writeFileSync(path.join(out, 'placement-report.json'), run(command, 'apply', 'base.json', 'placement.json', '--out', 'painted.json'));
fs.writeFileSync(path.join(out, 'edit-report.json'), run(command, 'update', 'painted.json', 'edit.json', '--out', 'revised.json'));
run(command, 'extract', 'revised.json', '--id', 'tide', '--out', 'painting.json');

const w = 352, h = 274;
function render(file, frame, time) {
  run('render', file + '.json', '--w', String(w), '--h', String(h), '--t', String(time),
    '--ortho', '--raw', '--px', '1', '--out', frame + '.png');
  return PNG.read(path.join(out, frame + '.png')).rgb;
}
const panels = [
  ['01 / RETAINED PAINTING', 'GOLD ARC / JADE SURFACE / LILAC RIG', render('painted', 'painted-rest', 0)],
  ['02 / ONE MARK EDITED', 'UPPER CURRENT MOVED AND RECOLORED', render('revised', 'revised-rest', 0)],
  ['03 / RIG IN MOTION', 'LILAC MARKS FOLLOW THE HINGE', render('revised', 'revised-posed', 1)]
];
const gap = 9, heading = 36, footer = 28, width = w * panels.length + gap * (panels.length + 1), height = h + heading + footer;
const sheet = Buffer.alloc(width * height * 3);
for (let i = 0; i < sheet.length; i += 3) sheet.set([18, 26, 38], i);
function label(title, x, top, scale, color) {
  const { data, width: tw, height: th } = KIT.procedural.drawing2d.text(title, { color, scale }).value;
  for (let y = 0; y < th; y++) for (let col = 0; col < tw; col++) {
    const i = (y * tw + col) * 4;
    if (data[i + 3]) sheet.set(data.subarray(i, i + 3), ((top + y) * width + x + col) * 3);
  }
}
for (const [i, [title, subtitle, rgb]] of panels.entries()) {
  const x = gap + i * (w + gap);
  label(title, x + 9, 11, 2, '#f2e8cc');
  for (let y = 0; y < h; y++) sheet.set(rgb.subarray(y * w * 3, (y + 1) * w * 3), ((heading + y) * width + x) * 3);
  label(subtitle, x + 9, heading + h + 9, 1, '#b5c9c5');
}
const preview = path.join(out, 'painting-3d-demo.png');
fs.writeFileSync(preview, PNG.encode(width, height, sheet));
console.log(preview);
