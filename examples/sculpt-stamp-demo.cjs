'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const ink = require('..');
const PNG = require('../cli/png.js');

const out = path.resolve(process.argv[2] ?? 'sculpt-stamp-demo');
const cli = path.resolve(__dirname, '../cli/ink-studio.js');
fs.mkdirSync(out, { recursive: true });
const save = (name, data) => fs.writeFileSync(path.join(out, name + '.json'), JSON.stringify(data, null, 2) + '\n');
const run = (...args) => execFileSync(process.execPath, [cli, ...args], { cwd: out, stdio: 'pipe' });
const screw = (id, x, z) => ({ id, kind: 'lathe', at: [x, .13, z], h: .14, r: [.13, .105], mat: 'bolt', res: .035,
  modifiers: [{ id: 'slot', kind: 'mask', mode: 'cut',
    shape: { kind: 'box', at: [x, .265, z], half: [.135, .03, .022] } }] });

save('base', {
  id: 'mounting-plate', seed: 21,
  camera: { target: [0, .44, 0], dist: 6.8, yaw: .39, pitch: .67 },
  style: {
    sun: [-.58, .82, .45], amb: .16,
    palette: [0x121c26, 0x213141, 0x334c5a, 0x4d6471, 0x6f8991, 0xa0b0a8, 0xa8bbb7,
      0x12282e, 0x21434a, 0x3b6969, 0x60978a, 0x97bfa7,
      0x412927, 0x794841, 0xb46c4b, 0xd78d53, 0xf2ad69, 0xffd78e, 0xffecc3],
    roles: { plate: [1, 2, 3, 4, 5], bolt: [1, 3, 4, 5, 6], housing: [7, 8, 9, 10, 11],
      copper: [12, 13, 14, 15, 16, 17, 18] }
  },
  solids: [
    { id: 'plate', kind: 'box', at: [0, 0, 0], half: [1.82, .2, 1.2], round: .11, mat: 'plate', res: .036 },
    screw('front-left', -1.46, .85), screw('front-right', 1.46, .85),
    screw('back-left', -1.46, -.85), screw('back-right', 1.46, -.85)
  ]
});
save('socket', {
  format: 'ink-studio/sculpt-stamp', version: 1,
  add: {
    housing: { kind: 'lathe', at: [0, .15, 0], h: .52, mat: 'housing', res: .033,
      r: [[0, .93], [.23, .93], [.36, .84], [.78, .78], [1, .76]] },
    lip: { kind: 'lathe', at: [0, .64, 0], h: .25, mat: 'copper', res: .028,
      r: [[0, .76], [.2, .83], [.72, .83], [1, .78]] }
  },
  cut: {
    bore: { shape: { kind: 'lathe', at: [0, -.44, 0], h: 1.51, res: .031,
      r: [[0, .47], [.78, .47], [.9, .51], [1, .64]] } },
    keyway: { shape: { kind: 'box', at: [0, .73, .48], half: [.115, .26, .14], round: .025, res: .03 },
      targets: ['lip'], host: false }
  }
});
save('placement', { id: 'socket-a', target: 'plate', transform: { rotation: [.33, 0, 0] } });
run('sculpt-stamp', 'place', 'base.json', 'socket.json', 'placement.json', '--out', 'stamped.json');

const w = 435, h = 335, gap = 12, heading = 32;
const width = 2 * w + 3 * gap, height = h + heading + gap * 2;
const sheet = Buffer.alloc(width * height * 3, 18);
const { drawing2d } = ink.load().KIT.procedural;
for (const [i, stage] of ['base', 'stamped'].entries()) {
  const x = gap + (w + gap) * i;
  run('render', stage + '.json', '--ortho', '--px', '1', '--w', String(w), '--h', String(h), '--out', stage + '.png');
  const { rgb } = PNG.read(path.join(out, stage + '.png'));
  for (let row = 0; row < h; row++)
    sheet.set(rgb.subarray(row * w * 3, (row + 1) * w * 3), ((heading + gap + row) * width + x) * 3);
  const title = i === 0 ? 'BASE PLATE' : 'ONE COMPOUND STAMP';
  const { data, width: tw, height: th } = drawing2d.text(title, { color: '#d4dbd9', scale: 2 }).value;
  for (let row = 0; row < th; row++) for (let col = 0; col < tw; col++) {
    const p = (row * tw + col) * 4;
    if (data[p + 3]) sheet.set(data.subarray(p, p + 3), ((gap + row) * width + x + col) * 3);
  }
}
const preview = path.join(out, 'sculpt-stamp-demo.png');
fs.writeFileSync(preview, PNG.encode(width, height, sheet));
console.log(preview);
