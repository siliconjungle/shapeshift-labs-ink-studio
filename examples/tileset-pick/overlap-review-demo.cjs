'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const ink = require('../..');
const PNG = require('../../cli/png.js');
const { drawing2d: art } = ink.load().KIT.procedural;

const dir = path.resolve(process.argv[2] ?? 'overlap-review-demo');
const cli = path.resolve(__dirname, '../../cli/ink-studio.js');
const file = name => path.join(dir, name);
const write = (name, data) => fs.writeFileSync(file(name), data);
const json = (name, data) => write(name, JSON.stringify(data, null, 2) + '\n');
const rect = (x, y, w, h, fill) => ({ type: 'rect', rect: [x, y, w, h], fill });
const label = (text, x, y, scale, color = '#f6ecd5') => ({ type: 'text', text, at: [x, y], scale, color });
fs.mkdirSync(dir, { recursive: true });

const panels = [
  { id: '01-signal', caption: 'SURVIVOR', tag: 'SIGN', fill: '#568b77', light: '#aff0ba', dark: '#28494e' },
  { id: '02-spare', caption: 'DUPLICATE', tag: 'COPY', fill: '#ac6357', light: '#f4bf97', dark: '#623b44' },
  { id: '03-reverse', caption: 'REVERSE', tag: 'BACK', fill: '#626992', light: '#cdd2ee', dark: '#343751' },
  { id: '04-overhang', caption: 'PARTIAL', tag: 'TRIM', fill: '#98875a', light: '#f4dd9f', dark: '#594e42' }
];
const atlas = art.render({ width: 128, height: 24, edges: 'hard', commands: panels.flatMap(({ fill, light, dark, tag }, i) => {
  const x = 32 * i;
  return [rect(x, 0, 32, 24, '#243140'), rect(x + 1, 1, 30, 22, fill),
    rect(x + 1, 1, 30, 2, light), rect(x + 1, 20, 30, 3, dark),
    rect(x + 4, 6, 24, 11, dark), label(tag, x + 4, 8, 1, light),
    rect(x + 2, 18, 2, 2, light), rect(x + 28, 18, 2, 2, light)];
}) });
const png = PNG.encode(128, 24, atlas.data, 4);
write('Canopy-paint.png', png);
const sheet = ink.readTilesetImage(png), { cropSource } = ink.load().KIT.authoring.tilesetFaces;

function canopy(exploded) {
  const scene = { id: exploded ? 'painted-canopy-exploded' : 'painted-canopy', style: 'slate', solids: [],
    tilesets: { enamel: sheet }, camera: { target: [0,.45,0], dist: 5, yaw: .1, pitch: .12,
      projection: 'orthographic', sway: 0 } };
  const vertices = [], faces = [], bindings = [], materials = [];
  for (const [i, { id }] of panels.entries()) {
    const x = exploded ? (i - 1.5) * 1.35 : i === 3 ? .63 : 0;
    const positions = [[x-.55,0,0], [x+.55,0,0], [x+.55,.82,0], [x-.55,.82,0]];
    const order = i === 2 ? [3,2,1,0] : i === 1 ? [1,2,3,0] : [0,1,2,3];
    const crop = ink.pickTilesetRectangle(scene, 'enamel', { x: i*32, y: 0, width: 32, height: 24 });
    const { source, pigmentUV } = cropSource(sheet, crop);
    vertices.push(...positions.map((position, j) => ({ id: id + '/v' + j, position })));
    faces.push({ id, material: id, corners: order.map(j => ({ id: id + '/c' + j, vertex: id + '/v' + j, uv: pigmentUV[j] })) });
    materials.push({ id, texture: { tileset: 'enamel' } });
    bindings.push({ id: 'tileset/' + id, domain: 'faces', element: id, data: source });
  }
  scene.topologyMeshes = { canopy: { document: { id: 'canopy', vertices, faces }, bindings, materials } };
  return scene;
}

const commands = [];
function studio(args, report) {
  commands.push('ink-studio ' + args.join(' ') + ' > ' + (report ?? '/dev/null'));
  const stdout = execFileSync(process.execPath, [cli, ...args], { cwd: dir, encoding: 'utf8' });
  if (report) write(report, stdout);
  return stdout;
}
json('canopy.json', canopy(false));
json('exploded.json', canopy(true));
json('edges-query.json', { convert: 'edges' });
const before = fs.readFileSync(file('canopy.json'));
const report = JSON.parse(studio(['mesh-topology', 'overlaps', 'canopy.json', '--object', 'canopy',
  '--selection-out', 'duplicates.json'], 'overlap-report.json'));
assert.equal(report.complete, true);
assert.deepEqual(report.groups.map(group => group.survivor.id), ['01-signal']);
assert.deepEqual(report.selection.ids, ['02-spare']);
const edges = JSON.parse(studio(['mesh-topology', 'select', 'canopy.json', 'edges-query.json', '--object', 'canopy',
  '--from', 'duplicates.json'], 'duplicate-edges.json'));
assert.equal(edges.ids.length, 4);
assert.deepEqual(fs.readFileSync(file('canopy.json')), before);

const render = (scene, output, w, h, target, zoom) => studio(['render', scene,
  '--w', w, '--h', h, '--px', '1', '--ortho', '--yaw', '.1', '--pitch', '.12', '--target', target,
  '--zoom', zoom, '--raw', '--out', output]);
render('canopy.json', 'Canopy-1x.png', 146, 94, '.31,.41,0', '2.40');
render('exploded.json', 'Exploded-1x.png', 280, 94, '0,.41,0', '1.82');

const W = 928, H = 363, left = 24, right = 344, top = 126;
const board = art.render({ width: W, height: H, edges: 'hard', commands: [
  rect(0, 0, W, H, '#152532'),
  label('INK STUDIO / TILE MESHES', left, 19, 2, '#97b9ad'),
  label('Find coincident faces', left, 48, 3),
  label('AS AUTHORED', left, 99, 2, '#adc8c8'),
  label('FACES SEPARATED FOR REVIEW', right, 99, 2, '#adc8c8'),
  rect(left-1, top-1, 294, 190, '#486169'),
  rect(right-1, top-1, 562, 190, '#486169'),
  label('3 FACES SHARE THE LEFT FOOTPRINT', left, 330, 1, '#adc8c8'),
  ...panels.flatMap(({ caption, light }, i) => {
    const x = right+81+i*133-3*caption.length-7;
    return [rect(x, 329, 7, 7, light), label(caption, x+14, 329, 1, light)];
  })
] });
for (const [image, x] of [['Canopy-1x.png', left], ['Exploded-1x.png', right]]) {
  const { w, h, data } = PNG.raster(file(image));
  for (let y = 0; y < 2*h; y++) for (let u = 0; u < 2*w; u++) {
    const src = (Math.floor(y/2)*w+Math.floor(u/2))*4;
    board.data.set(data.subarray(src, src+4), ((top+y)*W+x+u)*4);
  }
}
write('Overlap-review.png', PNG.encode(W, H, board.data, 4));
write('COMMANDS.sh', '#!/bin/sh\nset -eu\n' + commands.join('\n') + '\n');
write('README.md', `# Painted canopy overlap review

Run \`sh COMMANDS.sh\` with \`ink-studio\` on your PATH.

The canopy has four authored tile faces. \`01-signal\` and \`02-spare\`
share their full footprint and face the same way. The report keeps
\`01-signal\` and marks \`02-spare\` for review. The back-facing copy
and the partial overhang are both outside the duplicate selection.

The commands save a native face selection and convert it to its four
edges. The original canopy is left intact. The exploded scene is a
separate presentation so all four faces can be seen in one view.
`);
