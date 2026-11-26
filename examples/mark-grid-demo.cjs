'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { KIT } = require('..').load();
const PNG = require('../cli/png.js');
const output = path.resolve(process.argv[2] ?? 'mark-grid-demo');
const cli = path.resolve(__dirname, '../cli/ink-studio.js');
fs.mkdirSync(output, { recursive: true });
const run = (...args) => execFileSync(process.execPath, [cli, ...args], { cwd: output, encoding: 'utf8', stdio: 'pipe' });
const put = (name, value) => fs.writeFileSync(path.join(output, name + '.json'), JSON.stringify(value, null, 2) + '\n');

const solids = [
  { id: 'rim', kind: 'box', at: [0, 1.19, 0], half: [2.23, .97, .25], round: .14, mat: 'rim', res: .044 },
  { id: 'tile', kind: 'box', at: [0, 1.19, .12], half: [2.15, .89, .25], round: .13, mat: 'stone', res: .041,
    surfaceState: { charts: { fabric: { origin: [-2.02, .34, .37], u: [4.0, .046, 0], v: [.11, 1.64, 0], depth: .1 } } } }
];
const style = { amb: .29, sky: .27, sun: [-.40, .59, .69],
  palette: [0x101724, 0x1b293d, 0x273950, 0x3f5269, 0x66747c, 0xa6b0a7,
    0x623c35, 0x885e43, 0xaf8558, 0xe1b784, 0xffdc9e,
    0x205063, 0x387782, 0x5eaaac, 0x82cebe, 0xc0edd2,
    0x785036, 0xb47743, 0xe0aa62, 0xf6ce85, 0xffeabe,
    0x6a3f48, 0x9d5e61, 0xc87f77, 0xeda795, 0xffc7a9],
  roles: { stone: [1,2,3,4,5], rim: [6,7,8,9,10], jade: [11,12,13,14,15], gold: [16,17,18,19,20],
    clay: [21,22,23,24,25] } };
function base(id, bend) {
  return { id, style, seed: 58, finish: { detail: 16, dither: 0 },
    camera: { target: [0, 1.39, .17], dist: 6.30, yaw: .10, pitch: .21, sway: 0 },
    solids: bend ? solids.map(solid => ({ id: solid.id, kind: 'warp', bend: .36, centre: [0, 1.13, 0],
      res: solid.res, of: { ...solid, id: solid.id + '-flat' },
      modifiers: [{ id: 'twist', kind: 'warp', twist: .30, centre: [0, 1.13, 0] }] })) : solids };
}
put('flat-base', base('grid-study-flat', false));
put('bent-base', base('grid-study-bent', true));
const flow = KIT.flowMap.create({ width: 11, height: 7, bounds: [-2.12, .31, 2.12, 2.06] }).asset();
for (let y = 0; y < flow.height; y++) for (let x = 0; x < flow.width; x++) {
  const i = 2 * (y * flow.width + x), angle = .94 * Math.cos(x * .33 - y * .38) + .18;
  flow.vectors[i] = Math.cos(angle);
  flow.vectors[i + 1] = Math.sin(angle);
}
const attachment = { kind: 'surface', slot: 'panel',
  snap: { mode: 'surface', direction: [0, 0, 1], maxDistance: .50, offset: .018 } };
const brush = { kind: 'profile', depth: .104,
  points: [[-.134,-.043], [-.074,-.086], [.040,-.078], [.146,0], [.040,.079], [-.075,.084], [-.134,.043]] };
const origin = [-1.73, .56, .37], spacing = [.37, .25];
const marks = Array.from({ length: 60 }, (_, i) => {
  const x = i % 10, y = Math.floor(i / 10);
  const angle = Math.sin(i * 4.157 + .4) * .98;
  return { id: 'scale-' + i, brush, attachment, res: .022,
    mat: y === 2 || y === 3 ? x % 3 === 1 ? 'clay' : 'jade' : (x + y) % 4 === 1 ? 'jade' : 'gold',
    poses: [{ point: [origin[0] + (x + (y % 2) * .5) * spacing[0] + .106 * Math.sin(i * 5.174),
      origin[1] + y * spacing[1] + .077 * Math.cos(i * 2.87), .62],
      rotation: [0,0,Math.sin(angle / 2),Math.cos(angle / 2)], pressure: .89 + .07 * Math.cos(i * 1.31) }] };
});
const id = 'scales', command = 'painting-3d';
const placement = { id, bindings: { panel: 'tile' }, painting: { id: 'scale-relief', version: 1,
  format: KIT.authoring.paintings3d.format, flowMaps: { grain: flow }, marks } };
put('placement', placement);
run(command, 'apply', 'flat-base.json', 'placement.json', '--out', 'authored.json');
const variants = [
  ['tangent', { kind: 'tangent', origin, spacing, stagger: .5 }],
  ['direction', { kind: 'direction', field: { kind: 'flow-map', map: 'grain' }, angleStep: 180 }],
  ['uv-flat', { kind: 'uv', chart: 'fabric', spacing: [.0925,.15244], phase: [.061,.132], stagger: .5 }]
];
const reports = {};
for (const [name, grid] of variants) {
  put(name + '-edit', { id, edits: marks.map(mark => ({ op: 'set', id: mark.id, patch: { grid } })) });
  reports[name] = JSON.parse(run(command, 'update', 'authored.json', name + '-edit.json', '--out', name + '.json'));
}
run(command, 'extract', 'uv-flat.json', '--id', id, '--out', 'painting.json');
const portable = JSON.parse(fs.readFileSync(path.join(output, 'painting.json'), 'utf8'));
put('uv-placement', { ...placement, painting: portable });
reports['uv-bent'] = JSON.parse(run(command, 'apply', 'bent-base.json', 'uv-placement.json', '--out', 'uv-bent.json'));
const verified = JSON.parse(run(command, 'inspect', 'uv-bent.json'));
const uvCells = new Set(reports['uv-bent'].marks.map(mark => mark.orientation.frames[0].grid.target?.join(',')));
if (reports.tangent.marks.some(mark => mark.orientation.gridResults.aligned !== 1) ||
    reports.direction.marks.some(mark => mark.orientation.gridResults.aligned !== 1) ||
    uvCells.size !== marks.length ||
    reports['uv-bent'].marks.some((mark, index) => !mark.orientation.warped || mark.orientation.gridResults.aligned !== 1 ||
      KIT.V.dist(mark.orientation.frames[0].rest, reports['uv-flat'].marks[index].orientation.frames[0].rest) > 1e-6))
  throw new Error('The samples did not align across the three grid modes');
put('grid-report', { ...reports, reopened: verified });

const w = 459, h = 261, gap = 8, caption = 33, width = 2 * w + 3 * gap, height = 2 * (h + caption) + 3 * gap;
const pixels = Buffer.alloc(width * height * 3);
for (let i = 0; i < pixels.length; i += 3) pixels.set([15,21,31], i);
const panels = [['authored', 'AUTHORED DABS'], ['tangent', 'STAGGERED TANGENT GRID'],
  ['direction', 'HEADING ALIGNED TO FLOW'], ['uv-bent', 'UV GRID AFTER BENDING']];
for (const [i, [file, label]] of panels.entries()) {
  run('render', file + '.json', '--ortho', '--raw', '--px', '1', '--w', String(w), '--h', String(h), '--out', file + '.png');
  const frame = PNG.read(path.join(output, file + '.png')).rgb;
  const x = gap + (i % 2) * (w + gap), y = gap + Math.floor(i / 2) * (h + caption + gap);
  const text = KIT.procedural.drawing2d.text(label, { color: '#f5dcaa', scale: 2 }).value;
  for (let ty = 0; ty < text.height; ty++) for (let tx = 0; tx < text.width; tx++) {
    const src = (ty * text.width + tx) * 4;
    if (text.data[src + 3]) pixels.set(text.data.subarray(src, src + 3), ((y + 7 + ty) * width + x + 12 + tx) * 3);
  }
  for (let row = 0; row < h; row++)
    pixels.set(frame.subarray(row * w * 3, (row + 1) * w * 3), ((y + caption + row) * width + x) * 3);
}
const demo = path.join(output, 'mark-grid-demo.png');
fs.writeFileSync(demo, PNG.encode(width, height, pixels));
console.log(demo);
