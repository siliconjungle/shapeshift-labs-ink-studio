'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');
const { KIT } = require('..').load();
const PNG = require('../cli/png.js');
const output = path.resolve(process.argv[2] ?? 'paint-presets-demo');
const cli = path.resolve(__dirname, '../cli/ink-studio.js');
fs.mkdirSync(output, { recursive: true });
const run = (...args) => execFileSync(process.execPath, [cli, ...args], { cwd: output, encoding: 'utf8', stdio: 'pipe' });
const put = (name, value) => fs.writeFileSync(path.join(output, name + '.json'), JSON.stringify(value, null, 2) + '\n');
const read = name => JSON.parse(fs.readFileSync(path.join(output, name + '.json'), 'utf8'));

const slab = (id, at, half, mat, res) => ({ id, kind: 'box', at, half, mat, res, round: .17 });
const style = { sun: [-.49,.68,.43], amb: .27, sky: .24,
  palette: [0x101b28,0x27414c,0x345764,0x496d77,0x678a8b,0x8aa395,0xb4c0a6,
    0x4d3837,0x745141,0x9b7352,0xc69a6b,0xe0b989,0xf2d5a6,
    0x4e422c,0x735a37,0xab7b43,0xc99555,0xe2b06a,0xf6ca82,0xffe4a2],
  roles: { stone: [1,2,3,4,5,6], rim: [7,8,9,10,11,12], inlay: [13,14,15,16,17,18,19] } };
put('base', { id: 'paint-preset-study', seed: 63, style,
  camera: { target: [0, 1.32, .27], dist: 6.05, yaw: -.13, pitch: .30, sway: 0 },
  finish: { detail: 17, dither: 0, shadowMarch: { steps: 28, distance: 5, emptySpace: 'clear' } },
  solids: [
    slab('rim', [0,1.25,-.04], [2.20,1.0,.22], 'rim', .055),
    slab('tablet', [0,1.25,.12], [2.08,.88,.24], 'stone', .045)
  ] });
const profiles = {
  chisel: { silhouette: [[[-.085,-.13],[.068,-.12],[.085,.11],[-.050,.14]]], spacing: .44,
    depth: { back: .042, curve: [[0,.028],[.03,.083]] } },
  reed: { silhouette: [[[-.198,-.022],[-.139,-.071],[-.036,-.086],[.084,-.062],[.218,-.009],
    [.133,.022],[.052,.066],[-.069,.073],[-.167,.042]]], spacing: .33,
    depth: { back: .055, curve: [[0,.013],[.021,.055],[.055,.084]] } }
};
const flow = KIT.flowMap.create({ width: 13, height: 7, bounds: [-2.16,.32,2.16,2.22] }).asset();
for (let y = 0; y < flow.height; y++) for (let x = 0; x < flow.width; x++) {
  const i = (y * flow.width + x) * 2, u = x / (flow.width - 1);
  const angle = 1.18 + .92 * Math.sin(u * Math.PI * 2.0 - .52) + .17 * Math.cos(y * 1.03);
  flow.vectors[i] = Math.cos(angle);
  flow.vectors[i + 1] = Math.sin(angle);
}
const material = 'inlay', name = 'brushed-reed';
const preset = { brush: { kind: 'mark-profile', profile: 'reed' },
  direction: { field: { kind: 'flow-map', map: 'reed-grain' }, ruffleDegrees: 4, seed: 31 },
  looseness: { spacing: .59 }, relief: { mode: 'volume', height: .25, seat: .1, silhouetteAllowance: .24, castShadow: true } };
const dab = { id: 'ribbon', brush: { kind: 'mark-profile', profile: 'chisel' }, mat: material, res: .024, relief: { mode: 'flat' },
  attachment: { kind: 'surface', slot: 'plaque', snap: { mode: 'surface', direction: [0,0,1], maxDistance: .42 } },
  poses: Array.from({ length: 26 }, (_, i) => {
    const u = i / 25;
    return { point: [-1.76 + 3.52 * u, 1.24 + .37 * Math.sin(u * Math.PI * 2.15 - .67), .60],
      pressure: .77 + .22 * Math.sin(u * Math.PI) };
  }) };
const id = 'ribbon-demo', command = 'painting-3d';
put('placement', { id, bindings: { plaque: 'tablet' }, painting: { id: 'ceramic-ribbon', version: 1,
  format: KIT.authoring.paintings3d.format, profiles, flowMaps: { 'reed-grain': flow }, presets: { [name]: preset }, marks: [dab] } });
put('apply-preset', { id, edits: [{ op: 'apply-preset', id: dab.id, preset: name }] });
put('lower-relief', { id, edits: [{ op: 'set', id: dab.id, patch: {
  relief: { ...preset.relief, height: .068, seat: .045, silhouetteAllowance: .065 } } }] });
const raw = JSON.parse(run(command, 'apply', 'base.json', 'placement.json', '--out', 'original.json'));
const styled = JSON.parse(run(command, 'update', 'original.json', 'apply-preset.json', '--out', 'styled.json'));
const shallow = JSON.parse(run(command, 'update', 'styled.json', 'lower-relief.json', '--out', 'shallow.json'));
const reopened = JSON.parse(run(command, 'inspect', 'shallow.json'))[0];
run(command, 'extract', 'shallow.json', '--id', id, '--out', 'painting.json');
const before = styled.marks[0], after = reopened.marks[0];
assert.deepEqual(after.orientation, before.orientation);
assert.deepEqual(after.looseness, before.looseness);
assert.deepEqual(after.direction, before.direction);
assert.equal(after.profile, before.profile);
assert.equal(after.channelSources.relief, 'mark');
assert(after.relief.height < before.relief.height);
assert.deepEqual(read('painting').marks[0].poses, dab.poses);
put('preset-report', { raw, styled, shallow, reopened });

const w = 406, h = 253, gap = 8, caption = 32, width = 3 * w + 4 * gap, height = h + caption + 2 * gap;
const sheet = Buffer.alloc(width * height * 3);
for (let i = 0; i < sheet.length; i += 3) sheet.set([15,22,32], i);
const panels = [['original', 'ORIGINAL STROKE'], ['styled', 'BRUSH PRESET APPLIED'], ['shallow', 'RELIEF REDUCED']];
for (const [i, [file, label]] of panels.entries()) {
  run('render', file + '.json', '--ortho', '--raw', '--px', '1', '--w', String(w), '--h', String(h), '--out', file + '.png');
  const frame = PNG.read(path.join(output, file + '.png')).rgb, x = gap + i * (w + gap);
  const text = KIT.procedural.drawing2d.text(label, { color: '#f2dbb4', scale: 2 }).value;
  for (let ty = 0; ty < text.height; ty++) for (let tx = 0; tx < text.width; tx++) {
    const src = (ty * text.width + tx) * 4;
    if (text.data[src + 3]) sheet.set(text.data.subarray(src, src + 3), ((gap + 8 + ty) * width + x + 12 + tx) * 3);
  }
  for (let row = 0; row < h; row++)
    sheet.set(frame.subarray(row * w * 3, (row + 1) * w * 3), ((gap + caption + row) * width + x) * 3);
}
const demo = path.join(output, 'paint-presets-demo.png');
fs.writeFileSync(demo, PNG.encode(width, height, sheet));
console.log(demo);
