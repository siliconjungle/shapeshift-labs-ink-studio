'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { KIT } = require('..').load();
const PNG = require('../cli/png.js');
const cli = path.resolve(__dirname, '../cli/ink-studio.js');
const out = path.resolve(process.argv[2] ?? 'sculpt-spray-demo');
fs.mkdirSync(out, { recursive: true });
const run = (...args) => execFileSync(process.execPath, [cli, ...args], { cwd: out, encoding: 'utf8', stdio: 'pipe' });
const save = (name, value) => fs.writeFileSync(path.join(out, name + '.json'), JSON.stringify(value, null, 2) + '\n');
const palette = [0x122231, 0x1d3545, 0x295461, 0x46777d, 0x6c9a96, 0x99bcb0,
  0x403430, 0x6b4f3b, 0xa27f59, 0xc8a16e, 0xe6c58f, 0xffdbac,
  0x702a2e, 0xa53b31, 0xc85537, 0xef6f45, 0xff9765, 0xffc384];

save('base', {
  id: 'kiln-glaze-test', seed: 42, camera: { target: [0, .16, 0], dist: 5.5, yaw: .57, pitch: .265 },
  style: { sun: [-.43, .78, .6], amb: .31, palette,
    roles: { stone: [0, 1, 2, 3, 4, 5], tool: [6, 7, 8, 9, 10, 11] } },
  solids: [
    { id: 'vessel', kind: 'lathe', at: [0, -1.1, 0], h: 2.35, res: .037, mat: 'stone',
      r: [[0, .55], [.06, .57], [.14, .79], [.32, .96], [.49, 1], [.62, .91], [.76, .61], [.88, .43], [1, .46]],
      modifiers: [{ id: 'hollow-neck', kind: 'mask', mode: 'cut',
        shape: { kind: 'lathe', at: [0, .73, 0], h: .6, r: .31 } }] },
    { id: 'mouth', kind: 'torus', at: [0, 1.22, 0], R: .39, r: .062, mat: 'stone', res: .04 },
    { id: 'foot', kind: 'torus', at: [0, -1.05, 0], R: .55, r: .06, mat: 'stone', res: .042 },
    { id: 'stencil', kind: 'box', at: [-.2, .13, 1.27], half: [.13, .7, .08], round: .03, mat: 'tool', res: .032 },
    { id: 'plinth', kind: 'lathe', at: [0, -1.31, 0], h: .20, r: [[0, 1.19], [.82, 1.19], [1, 1.14]],
      mat: 'stone', res: .05 }
  ]
});

const brush = { id: 'coral', targets: ['vessel'],
  brush: { shape: 'ellipsoid', center: [.1, .08, 0], direction: [0, 0, -1], half: [1.32, 1.02, 1.95] },
  color: '#ff7048', softness: .34, falloff: 1.25, opacity: .96, facing: 'all', resolution: 144 };
for (const mode of ['visible', 'wrap']) {
  save(mode + '-brush', { ...brush, occlusion: mode });
  const report = run('sculpt-spray', 'apply', 'base.json', mode + '-brush.json', '--out', mode + '.json');
  fs.writeFileSync(path.join(out, mode + '-report.json'), report);
}

const panels = [
  ['visible', '.58', 'VISIBLE  /  FRONT'],
  ['wrap', '.58', 'WRAP  /  FRONT'],
  ['visible', '3.45', 'VISIBLE  /  BACK'],
  ['wrap', '3.45', 'WRAP  /  BACK']
];
const w = 278, h = 276, gap = 8, heading = 25, width = w * 4 + gap * 5, height = h + heading + gap * 2;
const sheet = Buffer.alloc(width * height * 3, 20);
for (const [i, [scene, yaw, title]] of panels.entries()) {
  const x = gap + i * (w + gap), file = scene + (i < 2 ? '-front.png' : '-back.png');
  run('render', scene + '.json', '--ortho', '--raw', '--yaw', yaw, '--px', '1',
    '--w', String(w), '--h', String(h), '--out', file);
  const { rgb } = PNG.read(path.join(out, file));
  for (let y = 0; y < h; y++)
    sheet.set(rgb.subarray(y * w * 3, (y + 1) * w * 3), ((heading + gap + y) * width + x) * 3);
  const { data, width: tw, height: th } = KIT.procedural.drawing2d.text(title, { color: '#dbe4e3', scale: 2 }).value;
  for (let y = 0; y < th; y++) for (let col = 0; col < tw; col++) {
    const p = (y * tw + col) * 4;
    if (data[p + 3]) sheet.set(data.subarray(p, p + 3), ((gap + y) * width + x + col) * 3);
  }
}
const preview = path.join(out, 'sculpt-spray-demo.png');
fs.writeFileSync(preview, PNG.encode(width, height, sheet));
console.log(preview);
