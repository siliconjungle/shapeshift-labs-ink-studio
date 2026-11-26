'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { KIT } = require('..').load();
const PNG = require('../cli/png.js');
const output = path.resolve(process.argv[2] ?? 'paint-looseness-demo');
const cli = path.resolve(__dirname, '../cli/ink-studio.js');
fs.mkdirSync(output, { recursive: true });
const run = (...args) => execFileSync(process.execPath, [cli, ...args], { cwd: output, encoding: 'utf8', stdio: 'pipe' });
const put = (name, value) => fs.writeFileSync(path.join(output, name + '.json'), JSON.stringify(value, null, 2) + '\n');
const read = name => JSON.parse(fs.readFileSync(path.join(output, name + '.json'), 'utf8'));

const palette = [0x0e1e29, 0x1b3442, 0x2b4a58, 0x456976, 0x668990,
  0x153f46, 0x205557, 0x327478, 0x54928d, 0x78b3a2,
  0x485357, 0x71836f, 0x99ab76, 0xc5ce91, 0xe4edab,
  0x714638, 0xa56b46, 0xd69557, 0xf1bd76, 0xffe6b2,
  0x20232e, 0x3f3846, 0x695163, 0xa58283, 0xddb6a0];
const roles = { stone: [0,1,2,3,4], ceramic: [5,6,7,8,9], leaf: [10,11,12,13,14], amber: [15,16,17,18,19], dark: [20,21,22,23,24] };
const ball = (id, at, r, mat, res = .036) => ({ kind: 'ball', id, at, r, mat, res });
const box = (id, at, half, mat) => ({ kind: 'box', id, at, half, round: .095, mat, res: .05 });
put('base', { id: 'night-owl-mask', seed: 19, style: { palette, roles, amb: .43, sky: .27, sun: [-.49,.70,.49] },
  camera: { target: [0, 1.39, .2], dist: 5.54, yaw: .035, pitch: .08, sway: 0 }, finish: { detail: 16, dither: 0 },
  solids: [
    box('stand',[0,-.14,-.18],[1.51,.14,.56],'stone'), box('mount',[0,.19,-.17],[.34,.28,.32],'stone'),
    ball('face',[0,1.38,0],[1.95,1.27,.64],'ceramic',.026),
    ...[-1, 1].flatMap(side => {
      const x = .71 * side;
      return [ball('eye-rim-' + side,[x,1.70,.542],[.466,.355,.171],'dark'),
        ball('eye-' + side,[x,1.70,.689],[.361,.256,.069],'amber',.028),
        ball('pupil-' + side,[x + .025,1.70,.744],[.17,.175,.042],{ role: 'dark', ramp: [0,20,21] },.025),
        ball('catchlight-' + side,[x - .023,1.776,.780],[.046,.050,.016],{ role:'amber', glow:true },.017)];
    }),
    { kind:'box', id:'beak', at:[0,1.248,.642], half:[.125,.125,.090], turn:[0,0,.7853982], round:.043, mat:'amber', res:.024 }
  ] });

const nib = {
  silhouette: [[[-.072,-.019],[-.037,-.035],[.052,-.024],[.083,.006],[.049,.038],[-.032,.029]]],
  spacing: .177, coverage: { opacity: .93, feather: .011 }, grain: { amount: .075, scale: .028, seed: 23 },
  depth: { back: .052, curve: [[0,.024],[.036,.078]] }
};
const border = {
  silhouette: [[[-.053,-.021],[.041,-.023],[.058,.008],[.033,.023],[-.046,.022]]], spacing: .121,
  coverage: { opacity:.85, feather:.007 }, depth: { back:.055, curve:[[0,.045]] }
};
const rotation = angle => [0, 0, Math.sin(angle / 2), Math.cos(angle / 2)];
const attachment = { kind: 'surface', slot: 'mask', snap: { mode: 'surface', direction: [0,0,1], maxDistance: .82,
  minFacing: .085, spacing: .069 } };
const paint = (id, profile, poses, mat) => ({ id, brush: { kind: 'mark-profile', profile }, poses, mat, res: .024,
  attachment, looseness: { silhouetteAllowance: 0 } });
const rows = Array.from({ length: 10 }, (_, j) => {
  const y = .53 + j * .186, half = 1.65 * Math.sqrt(1 - ((y - 1.38) / 1.14) ** 2);
  const poses = Array.from({ length: 12 }, (_, i) => {
    const t = i / 11, x = half * (2 * t - 1), angle = .21 * Math.sin(t * Math.PI * 2 + j*.62);
    return { point: [x,y + .021 * Math.cos(x*4 + j*.76),.82], rotation: rotation(angle), pressure: .98 };
  });
  return paint('feather-' + j, 'feather', poses, 'leaf');
});
const rim = Array.from({ length: 89 }, (_, i) => {
  const t = Math.PI * 2 * i / 88;
  return { point: [1.78 * Math.cos(t), 1.38 + 1.12 * Math.sin(t), .82], rotation: rotation(t + Math.PI / 2) };
});
const input = { id: 'owl-pigment', bindings: { mask: 'face' }, painting: { id:'owl-feathers', version:1,
  format: KIT.authoring.paintings3d.format, profiles: { feather:nib, rim:border }, marks: [...rows, paint('rim','rim',rim,'amber')] } };
const edit = { id: input.id, edits: rows.map((row, i) => ({ op:'set', id:row.id, patch: { looseness: {
  size: 1.92, spacing: 1.63, displacement: .088, irregularity: .78, seed: 137 + i * 13,
  interior: { center:[0,1.39,.55], radii:[1.48,.91,.60], feather:.35 }, silhouetteAllowance:0
} } })) };
put('placement', input);
put('edit', edit);
fs.writeFileSync(path.join(output, 'tight-report.json'), run('painting-3d', 'apply', 'base.json', 'placement.json', '--out', 'tight.json'));
fs.writeFileSync(path.join(output, 'loose-report.json'), run('painting-3d', 'update', 'tight.json', 'edit.json', '--out', 'loose.json'));
run('painting-3d', 'extract', 'loose.json', '--id', input.id, '--out', 'painting.json');
const tight = KIT.diorama.build(read('tight')), loose = KIT.diorama.build(read('loose'));
if (tight.count !== loose.count) throw new Error('The zero-allowance edit added or removed geometry');
let changed = 0;
for (let i = 0; i < tight.count; i++) {
  for (const k of [0,1,2,3,4,5,6,8,9,10])
    if (tight.data[i * 16 + k] !== loose.data[i * 16 + k]) throw new Error('A splat footprint changed');
  if (tight.data[i * 16 + 7] !== loose.data[i * 16 + 7]) changed++;
}
if (!changed) throw new Error('The looseness edit did not change any pigment');
put('geometry-report', { silhouetteAllowance: 0, identicalGeometry: true, splats: tight.count, changedPigmentRows: changed });

const w = 461, h = 353, gap = 10, top = 37, bottom = 34, width = 2 * w + 3 * gap, height = top + h + bottom;
const sheet = Buffer.alloc(width * height * 3);
for (let i = 0; i < sheet.length; i += 3) sheet.set([17,26,34], i);
function label(title, x, y, scale, color) {
  const { data, width: tw, height: th } = KIT.procedural.drawing2d.text(title, { color, scale }).value;
  for (let j = 0; j < th; j++) for (let i = 0; i < tw; i++) {
    const p = (j * tw + i) * 4;
    if (data[p + 3]) sheet.set(data.subarray(p, p + 3), ((y + j) * width + x + i) * 3);
  }
}
for (const [i, [file, title, caption]] of [
  ['tight', 'TIGHT PAINT', 'REGULAR FEATHERS / FIXED RIM'],
  ['loose', 'LOOSE INSIDE THE FACE', 'LARGER, SCATTERED DABS / SAME RIM AND SILHOUETTE']
].entries()) {
  run('render', file + '.json', '--ortho', '--raw', '--px', '1', '--w', String(w), '--h', String(h), '--out', file + '.png');
  const pixels = PNG.read(path.join(output, file + '.png')).rgb, x = gap + i * (w + gap);
  label(title, x + 12, 11, 2, '#e6e9bd');
  for (let y = 0; y < h; y++) sheet.set(pixels.subarray(y * w * 3, (y + 1) * w * 3), ((top + y) * width + x) * 3);
  label(caption, x + 12, top + h + 12, 1, '#93b7ae');
}
const demo = path.join(output, 'paint-looseness-demo.png');
fs.writeFileSync(demo, PNG.encode(width, height, sheet));
console.log(demo);
