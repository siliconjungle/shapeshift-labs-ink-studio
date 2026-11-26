'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const ink = require('..'), kit = ink.load(), { KIT } = kit;
const PNG = require('../cli/png.js');
const out = path.resolve(process.argv[2] ?? 'entity-promotion-demo');
const cli = path.resolve(__dirname, '../cli/ink-studio.js');
fs.mkdirSync(out, { recursive: true });
const save = (name, value) => fs.writeFileSync(path.join(out, name + '.json'), JSON.stringify(value, null, 2) + '\n');
const runCLI = (...args) => execFileSync(process.execPath, [cli, ...args], { cwd: out, encoding: 'utf8', stdio: 'pipe' });
const W = KIT.world;
const palette = [
  0x151e29, 0x26313b, 0x374653, 0x536071, 0x758292, 0xa2a5a2, 0xc6b8a5,
  0x283745, 0x374b56, 0x455f6a, 0x58777a, 0x87938a, 0xaeb8a1,
  0x17384b, 0x24586a, 0x267c86, 0x399b98, 0x6eb5a8, 0xb1dace,
  0x4d2d31, 0x744137, 0xa65f43, 0xd38859, 0xefb47c, 0xffdb9d
];
const camera = { target: [0, .55, 0], dist: 6.1, yaw: .17, pitch: .69, projection: 'orthographic' };
const front = {
  channel: 'paint', value: '#ffd072',
  brush: { kind: 'bitmap', min: [.06,.1], max: [.94,.9], rows: [
    '........#..#........',
    '...#...######...#...',
    '..###.##....##.###..',
    '.#...##..##..##...#.',
    '..###.##....##.###..',
    '...#...######...#...',
    '........#..#........'
  ] }
};
const bands = [0.04, 0.88].map(y => ({ channel: 'paint', value: '#e8ae63',
  brush: { kind: 'rect', min: [.02, y], max: [.98, y + .055] } }));
const body = { position: [0, 1.1, 0], half: [1.75, .35, .16], fixed: true, mass: 2.3, turn: .1,
  material: 'cobalt-glaze', look: [13, 14, 15, 16, 17, 18],
  surfaceState: { fresh: { material: 'fired-clay', ramp: [19, 20, 21, 22, 23] },
    faces: { '+z': [front, ...bands], '+y': bands } } };
const input = W.manifest({
  id: 'kiln-spill', seed: 27, dt: 1 / 60,
  systems: { rig: { kind: 'mechanics', config: { bodies: { tile: body }, ground: 0, drag: .10 } } },
  visual: { resolution: .054, bounds: { min: [-2.7, -.28, -1.70], max: [2.7, 1.7, 1.7] },
    fields: { bodies: 'rig/bodies' }, palette, camera }
});
save('kiln-world', input);
const run = W.runtime.create(input);
const w = 300, h = 242;
const view = { w, h, raw: true, ortho: true, px: 1 };
const renderRun = () => ink.render(W.visual(kit, run.view(), run.query()), view);
const intact = renderRun();
run.schedule([{ tick: 1, action: 'rig/fracture', args: { body: 'tile', parts: 4, axis: 0 } },
  ...[
    [[-.84, .35, -.53], [.8, -.9, .32]],
    [[-.35, .04, .48], [-.95, .55, -.15]],
    [[.30, .3, -.36], [.95, .15, .2]],
    [[.76, .13, .54], [-.6, .8, -.25]]
  ].map(([linear, angular], i) => ({ tick: 2, action: 'rig/impulse', args: { body: 'tile.' + i, linear, angular } }))
]);
run.advance(29);
const committed = renderRun();
save('cut-frame', run.checkpoint());

const picked = { id: 'kiln-pieces',
  select: ['tile.0', 'tile.1', 'tile.2', 'tile.3'].map(body => ({ field: 'rig/bodies', body })) };
save('selection', picked);
save('stage', { id: 'kiln-layout', seed: 27, camera, style: { palette, roles: { stone: [7, 8, 9, 10, 11] } },
  solids: [{ id: 'bed', kind: 'box', at: [0, -.14, 0], half: [2.7, .14, 1.7], mat: 'stone', res: .056 }] });
const receipt = runCLI('scene', 'promote-entities', 'cut-frame.json', 'selection.json', '--into', 'stage.json', '--out', 'promoted.json');
fs.writeFileSync(path.join(out, 'promotion-report.json'), receipt);
const editor = ink.createSceneEditor(JSON.parse(fs.readFileSync(path.join(out, 'promoted.json'), 'utf8')));
const moved = JSON.parse(receipt).objects[2].solid;
editor.setTransform({ translation: [0, .28, .7] }, 'solid:' + moved);
save('edited', editor.snapshot());

function renderFile(source) {
  runCLI('render', source + '.json', '--ortho', '--raw', '--px', '1',
    '--w', String(w), '--h', String(h), '--out', source + '.png');
  return PNG.read(path.join(out, source + '.png'));
}
const panels = [
  ['INTACT  /  TICK 0', intact], ['LIVE  /  TICK 29', committed],
  ['PROMOTED  /  4 OBJECTS', renderFile('promoted')], ['ONE PIECE MOVED', renderFile('edited')]
];
const gap = 8, heading = 27, width = w * 4 + gap * 5, height = h + heading + gap * 2;
const sheet = Buffer.alloc(width * height * 3, 20);
for (const [i, [title, { rgb }]] of panels.entries()) {
  const x = gap + i * (w + gap);
  for (let y = 0; y < h; y++) sheet.set(rgb.subarray(y * w * 3, (y + 1) * w * 3), ((heading + gap + y) * width + x) * 3);
  const { data, width: tw, height: th } = KIT.procedural.drawing2d.text(title, { color: '#dbe4e3', scale: 2 }).value;
  for (let y = 0; y < th; y++) for (let col = 0; col < tw; col++) {
    const p = (y * tw + col) * 4;
    if (data[p + 3]) sheet.set(data.subarray(p, p + 3), ((gap + y) * width + x + col) * 3);
  }
}
const preview = path.join(out, 'entity-promotion-demo.png');
fs.writeFileSync(preview, PNG.encode(width, height, sheet));
console.log(preview);
