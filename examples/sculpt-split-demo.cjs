'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const ink = require('..');
const PNG = require('../cli/png.js');

const out = path.resolve(process.argv[2] ?? 'sculpt-split-demo');
fs.mkdirSync(out, { recursive: true });
const cli = path.resolve(__dirname, '../cli/ink-studio.js');
const run = (...args) => execFileSync(process.execPath, [cli, ...args], { cwd: out, encoding: 'utf8', stdio: 'pipe' });
const save = (name, data) => fs.writeFileSync(path.join(out, name + '.json'), JSON.stringify(data, null, 2) + '\n');
const axis = [0, 0, -Math.PI / 2];
const collar = (id, x, width, r) => ({
  id, kind: 'join', how: 'union',
  shape: { kind: 'lathe', at: [x, 0, 0], h: width, r, turn: axis, mat: 'rim' }
});

save('original', {
  id: 'turbine-cartridge', seed: 18,
  camera: { target: [0, .04, 0], dist: 7.6, yaw: .54, pitch: .39 },
  style: {
    sun: [-.5, .81, .49], amb: .17,
    palette: [0x16212b, 0x223b45, 0x305962, 0x49808a, 0x78abb0, 0xaadcce,
      0x382b32, 0x775146, 0xb77b58, 0xdf9a67, 0xf6be7a, 0xffdfa1,
      0x543a35, 0x9d6548, 0xca8d58, 0xf6c584, 0xffe5af,
      0x642c27, 0x994d38, 0xde755a, 0xf7a577, 0xffd4a8],
    roles: { enamel: [0, 1, 2, 3, 4, 5], rim: [6, 7, 8, 9, 10, 11],
      core: [12, 13, 14, 15, 16], signal: [17, 18, 19, 20, 21], stone: [0, 1, 2, 3, 4] }
  },
  solids: [{
    id: 'cartridge', kind: 'lathe', at: [-1.85, 0, 0], h: 3.7, turn: axis, res: .043,
    r: [[0, .6], [.06, .73], [.15, .75], [.29, .62], [.69, .62], [.84, .76], [.95, .76], [1, .61]],
    mat: { role: 'enamel', materialId: 'blue-enamel' },
    modifiers: [
      collar('inlet-rim', -1.77, .19, [.68, .78]),
      collar('outlet-rim', 1.58, .22, [.81, .72]),
      { id: 'through-bore', kind: 'mask', mode: 'cut',
        shape: { kind: 'lathe', at: [-2.1, 0, 0], h: 4.25, r: .33, turn: axis } }
    ],
    sockets: { inlet: { p: [-1.85, 0, 0], dir: [-1, 0, 0] },
      outlet: { p: [1.85, 0, 0], dir: [1, 0, 0] },
      inspection: { p: [-.53, .62, 0] } },
    sdfPaint: { version: 1, strokes: [{
      id: 'service-mark', material: 'signal', grid: [6, 4],
      projection: { origin: [0, 1.8, 0], right: [.33, 0, 0], down: [0, 0, .24], forward: [0, -1, 0], perspective: false },
      cells: [[1, 1, [-.50, .62, -.11], [0, 1, 0], .09], [1, 2, [-.50, .62, .11], [0, 1, 0], .09],
        [4, 1, [.5, .62, -.11], [0, 1, 0], .09], [4, 2, [.5, .62, .11], [0, 1, 0], .09]]
    }] }
  }]
});

save('split-request', { solid: 'cartridge', extract: 'cartridge-outlet', id: 'service-cut',
  cutter: { kind: 'plane', at: [.16, 0, 0], normal: [1, .13, .09] },
  capMaterial: { role: 'core', materialId: 'machined-core' } });
const report = run('sculpt-split', 'apply', 'original.json', 'split-request.json', '--out', 'split.json');
fs.writeFileSync(path.join(out, 'split-report.json'), report);

const scene = ink.createSceneEditor(fs.readFileSync(path.join(out, 'split.json'), 'utf8'));
scene.setTransform({ translation: [-.72, .05, .08] }, 'solid:cartridge');
scene.setTransform({ pivot: [.68, 0, 0], translation: [1.03, .20, -.12], rotation: [2.64, -.06, .06] },
  'solid:cartridge-outlet');
save('spread', scene.snapshot());

const { drawing2d } = ink.load().KIT.procedural;
const w = 470, h = 325, gap = 12, heading = 30, width = w * 2 + gap * 3, height = h + heading + gap * 2;
const sheet = Buffer.alloc(width * height * 3, 20);
for (const [i, [stage, title]] of [['original', 'CARTRIDGE'], ['spread', 'CUT APART']].entries()) {
  const x = gap + i * (w + gap);
  run('render', stage + '.json', '--ortho', '--px', '1', '--w', String(w), '--h', String(h), '--out', stage + '.png');
  const { rgb } = PNG.read(path.join(out, stage + '.png'));
  for (let y = 0; y < h; y++)
    sheet.set(rgb.subarray(y * w * 3, (y + 1) * w * 3), ((heading + gap + y) * width + x) * 3);
  const { data, width: tw, height: th } = drawing2d.text(title, { color: '#dce4df', scale: 2 }).value;
  for (let y = 0; y < th; y++) for (let col = 0; col < tw; col++) {
    const p = (y * tw + col) * 4;
    if (data[p + 3]) sheet.set(data.subarray(p, p + 3), ((gap + y) * width + x + col) * 3);
  }
}
const preview = path.join(out, 'sculpt-split-demo.png');
fs.writeFileSync(preview, PNG.encode(width, height, sheet));
console.log(preview);
