'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { KIT } = require('..').load();
const PNG = require('../cli/png.js');
const out = path.resolve(process.argv[2] ?? 'sculpt-guide-demo');
const cli = path.resolve(__dirname, '../cli/ink-studio.js');
fs.mkdirSync(out, { recursive: true });
const run = (...args) => execFileSync(process.execPath, [cli, ...args], { cwd: out, encoding: 'utf8', stdio: 'pipe' });
const save = (name, value) => fs.writeFileSync(path.join(out, name + '.json'), JSON.stringify(value, null, 2) + '\n');

save('plate', {
  id: 'guide-medallion', seed: 28, camera: { target: [0, .17, 0], dist: 6.8, yaw: .16, pitch: .81 },
  constructionPlane: { origin: [0, .2, 0], right: [1, 0, 0], up: [0, 0, -1], grid: .1 },
  style: {
    sun: [-.53, .83, .40], amb: .19,
    palette: [0x13202a, 0x203640, 0x315762, 0x508490, 0x7aabb1, 0xa8ccc7,
      0x492731, 0x7e4842, 0xb36a4b, 0xde9255, 0xf8b56f, 0xffdf9d,
      0x29324c, 0x4a456b, 0x6a608b, 0x9384a5, 0xc5aac6],
    roles: { stone: [0, 1, 2, 3, 4, 5], metal: [6, 7, 8, 9, 10, 11], trim: [12, 13, 14, 15, 16] }
  },
  solids: [
    { id: 'plate', kind: 'lathe', at: [0, -.18, 0], h: .39, res: .034, mat: 'stone',
      r: [[0, 1.77], [.18, 1.89], [.66, 1.89], [1, 1.77]] },
    { id: 'outer-rim', kind: 'torus', at: [0, .18, 0], R: 1.73, r: .055, mat: 'trim', res: .04 }
  ]
});

save('wings', {
  id: 'wings', type: 'stroke', target: 'plate', guides: { space: 'construction-plane',
    mirror: { axis: 'x', side: 'positive', clip: true } },
  stroke: { op: 'add', mat: 'metal', brush: { kind: 'sphere', radius: .093 },
    snap: { mode: 'surface', direction: [0, 1, 0], maxDistance: .30, offset: .033, spacing: .045 }, poses: [
    { point: [-.32, .43, -.14], pressure: .75 }, { point: [0, .30, -.22], pressure: 1 },
    { point: [.34, .31, -.44], pressure: .89 }, { point: [.72, .32, -.50], pressure: 1 },
    { point: [.99, .33, -.35], pressure: .86 }, { point: [.84, .34, -.08], pressure: .82 },
    { point: [.56, .34, .04], pressure: .73 }, { point: [.69, .33, .31], pressure: .64 },
    { point: [.99, .315, .41], pressure: .48 }
  ] }
});
save('studs', {
  id: 'stud', type: 'stamp', target: 'plate',
  placement: { transform: { translation: [1.42, 0, 0], rotation: [.22, .18, .11] } },
  guides: { space: 'world', radial: { axis: 'y', count: 4 }, angleIncrement: 45, upright: true },
  stamp: { format: 'ink-studio/sculpt-stamp', version: 1, add: {
    collar: { kind: 'lathe', at: [0, .15, 0], h: .20, r: [[0, .19], [.3, .19], [1, .15]], mat: 'metal', res: .033 }
  }, cut: { bore: { shape: { kind: 'lathe', at: [0, -.30, 0], h: .79, r: .080 } } } }
});
save('count-edit', { id: 'stud', guides: { radial: { count: 8 } } });
for (const [verb, source, request, result] of [
  ['apply', 'plate', 'wings', 'mirrored'], ['apply', 'mirrored', 'studs', 'four'], ['update', 'four', 'count-edit', 'eight']
]) {
  const receipt = run('sculpt-guide', verb, source + '.json', request + '.json', '--out', result + '.json');
  fs.writeFileSync(path.join(out, result + '-report.json'), receipt);
}

const panels = [['mirrored', 'CLIPPED MIRROR'], ['four', '4 RADIAL STAMPS'], ['eight', '8 RADIAL STAMPS']];
const w = 352, h = 286, gap = 10, heading = 24, width = w * 3 + gap * 4, height = h + heading + gap * 2;
const sheet = Buffer.alloc(width * height * 3, 20);
for (const [i, [stage, title]] of panels.entries()) {
  const x = gap + i * (w + gap);
  run('render', stage + '.json', '--ortho', '--px', '1', '--w', String(w), '--h', String(h), '--out', stage + '.png');
  const { rgb } = PNG.read(path.join(out, stage + '.png'));
  for (let y = 0; y < h; y++) sheet.set(rgb.subarray(y * w * 3, (y + 1) * w * 3), ((heading + gap + y) * width + x) * 3);
  const { data, width: tw, height: th } = KIT.procedural.drawing2d.text(title, { color: '#dbe4e3', scale: 2 }).value;
  for (let y = 0; y < th; y++) for (let col = 0; col < tw; col++) {
    const p = (y * tw + col) * 4;
    if (data[p + 3]) sheet.set(data.subarray(p, p + 3), ((gap + y) * width + x + col) * 3);
  }
}
const preview = path.join(out, 'sculpt-guide-demo.png');
fs.writeFileSync(preview, PNG.encode(width, height, sheet));
console.log(preview);
