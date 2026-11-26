'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { KIT } = require('..').load();
const PNG = require('../cli/png.js');

const out = path.resolve(process.argv[2] ?? 'sculpt-contribution-demo');
fs.mkdirSync(out, { recursive: true });
const cli = path.resolve(__dirname, '../cli/ink-studio.js');
const run = (...args) => execFileSync(process.execPath, [cli, ...args], { cwd: out, encoding: 'utf8', stdio: 'pipe' });
const save = (name, data) => fs.writeFileSync(path.join(out, name + '.json'), JSON.stringify(data, null, 2) + '\n');
const point = (x, y) => ({ point: [x, y, -.38] });
const bolt = (id, x, z) => ({ id, kind: 'lathe', at: [x, .12, z], h: .12, r: [.105, .08], mat: 'fastener', res: .035 });

save('original', {
  id: 'casting-plate', seed: 26,
  camera: { target: [0, .28, 0], dist: 6.65, yaw: .25, pitch: .65 },
  style: {
    sun: [-.6, .78, .42], amb: .18,
    palette: [0x141d26, 0x253540, 0x3d5563, 0x547380, 0x76939d, 0xaabebc,
      0x352a31, 0x754135, 0xac6343, 0xd9844d, 0xf5ab6b, 0xffd491,
      0x173a39, 0x2d6558, 0x54957a, 0x8cc4a1, 0xbde1b3],
    roles: { stone: [1, 2, 3, 4, 5], metal: [6, 7, 8, 9, 10, 11], fastener: [1, 2, 4, 5],
      jade: [12, 13, 14, 15, 16] }
  },
  solids: [
    { id: 'plate', kind: 'box', at: [0, 0, 0], half: [2.04, .19, 1.1], round: .12, mat: 'stone', res: .038,
      modifiers: [
        { id: 'rail', kind: 'join', how: 'union', shape: { kind: 'sweep', mat: 'metal',
          brush: { kind: 'sphere', radius: .3 }, poses: [point(-1.22, .26), point(-.61, .44), point(.20, .46), point(1.07, .31)],
          blendRadius: .065 } },
        { id: 'cross-slot', kind: 'mask', mode: 'cut',
          shape: { kind: 'box', at: [0, .4, -.38], half: [.18, .49, .37], round: .045 } },
        { id: 'drain', kind: 'mask', mode: 'cut', shape: { kind: 'lathe', at: [1.4, -.35, .64], h: .85, r: .15 } }
      ],
      sdfPaint: { version: 1, strokes: [{
        id: 'jade-stripe', grid: [4, 4], material: 'jade',
        projection: { origin: [-.71, 2, -.38], right: [.32, 0, 0], down: [0, 0, .31], forward: [0, -1, 0], perspective: false },
        cells: [[1, 1, [-.84, .69, -.43], [0, 1, 0], .094], [1, 2, [-.84, .69, -.34], [0, 1, 0], .094]]
      }] }
    },
    bolt('fastener-a', -1.66, .76), bolt('fastener-b', -1.66, -.78), bolt('fastener-c', 1.65, -.78)
  ]
});

const selection = { solid: 'plate', contribution: 'rail' };
save('move', { ...selection, op: 'move', delta: [0, 0, .8] });
save('reorder', { ...selection, op: 'reorder', index: 1 });
for (const [request, stage] of [['move', 'moved'], ['reorder', 'reordered']]) {
  const report = run('sculpt-contribution', 'edit', 'original.json', request + '.json', '--out', stage + '.json');
  fs.writeFileSync(path.join(out, stage + '-report.json'), report);
}

const panels = [['original', 'ORIGINAL'], ['moved', 'MOVED RAIL'], ['reordered', 'CUT FIRST']];
const w = 360, h = 270, gap = 10, heading = 25, width = w * panels.length + gap * (panels.length + 1);
const height = h + heading + gap * 2, sheet = Buffer.alloc(width * height * 3, 20);
for (const [i, [stage, title]] of panels.entries()) {
  const offset = gap + i * (w + gap);
  run('render', stage + '.json', '--ortho', '--px', '1', '--w', String(w), '--h', String(h), '--out', stage + '.png');
  const { rgb } = PNG.read(path.join(out, stage + '.png'));
  for (let y = 0; y < h; y++)
    sheet.set(rgb.subarray(y * w * 3, (y + 1) * w * 3), ((heading + gap + y) * width + offset) * 3);
  const { data, width: tw, height: th } = KIT.procedural.drawing2d.text(title, { color: '#d6deda', scale: 2 }).value;
  for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
    const p = (y * tw + x) * 4;
    if (data[p + 3]) sheet.set(data.subarray(p, p + 3), ((gap + y) * width + offset + x) * 3);
  }
}
const preview = path.join(out, 'sculpt-contribution-demo.png');
fs.writeFileSync(preview, PNG.encode(width, height, sheet));
console.log(preview);
