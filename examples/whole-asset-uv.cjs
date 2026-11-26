const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const ink = require('..');
const R = require('../cli/render.js');
const PNG = require('../cli/png.js');
const { KIT: K } = ink.load();
const T = K.meshTopology, UV = T.uv, art = K.procedural.drawing2d;

const output = path.resolve(process.argv[2] ?? 'switchback-relay');
fs.mkdirSync(output, { recursive: true });
const file = name => path.join(output, name);
const save = (name, value) => fs.writeFileSync(file(name), JSON.stringify(value, null, 2) + '\n');
const read = name => JSON.parse(fs.readFileSync(file(name), 'utf8'));
const cli = path.join(__dirname, '../cli/ink-studio.js');
const shell = { cwd: output, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 };
const run = (...args) => execFileSync(process.execPath, [cli, ...args], shell);

const rect = (x, y, w, h, fill) => ({ type: 'rect', rect: [x,y,w,h], fill });
const text = (text, x, y, scale, color = '#ead2a3') => ({ type: 'text', text, at: [x,y], scale, color });
const pathInk = (points, color) => ({ type: 'path', points, color, width: 1 });
const poly = (points, fill) => ({ type: 'polygon', points, fill });

const plate = art.render({ width: 35, height: 24, edges: 'hard', commands: [
  rect(0, 0, 35, 24, '#35364d'), rect(5, 6, 19, 9, '#384857'), rect(5, 6, 19, 1, '#d6a875'),
  rect(5, 14, 19, 1, '#816a5c'), rect(5, 7, 1, 7, '#d6a875'), rect(23, 7, 1, 7, '#a58469'),
  text('R7', 7, 8, 1, '#ffe09d'), rect(17, 9, 4, 3, '#b36762'), rect(17, 13, 4, 1, '#233b4a')
] });
const encoded = PNG.encode(plate.width, plate.height, plate.data, 4);
fs.writeFileSync(file('label-installed.png'), encoded);
const vertices = [], faces = [];
function polygon(id, material, ids, options = {}) {
  faces.push({ id, material, corners: ids.map((vertex, i) => {
    const point = vertices.find(row => row.id === vertex).position;
    const uv = options.uv?.[i] ?? [.28 + point[0] * .078, .31 + point[1] * .071 + point[2] * .026];
    return { id: id + '/c' + i, vertex, uv, ...(options.pin && i === 0 && { uvPinned: true }) };
  }) });
}
function extrude(id, profile, back, front, material) {
  const rows = [front, back].map((z, layer) => profile.map(([x, y], i) => {
    const key = id + '/v' + layer + '-' + i;
    vertices.push({ id: key, position: [x, y, z] });
    return key;
  }));
  polygon(id + '/front', material, rows[0]);
  polygon(id + '/back', material, rows[1].slice().reverse());
  for (let i = 0; i < profile.length; i++) {
    const j = (i + 1) % profile.length;
    polygon(id + '/side-' + i, material, [rows[0][j], rows[0][i], rows[1][i], rows[1][j]]);
  }
}
const corners = (x, y, width, height, edge) => [
  [x-width+edge,y-height],[x+width-edge,y-height],[x+width,y-height+edge],[x+width,y+height-edge],
  [x+width-edge,y+height],[x-width+edge,y+height],[x-width,y+height-edge],[x-width,y-height+edge]
];
const disc = (x, y, r, count = 10) => Array.from({ length: count }, (_, i) => {
  const theta = 2 * Math.PI * i / count;
  return [x + r * Math.cos(theta), y + r * Math.sin(theta)];
});
extrude('cap', corners(-.30, 1.26, 1.22, .58, .17), -.48, .48, 'copper');
extrude('plinth', corners(0, .49, 1.54, .19, .09), -.68, .65, 'slate');
extrude('knuckle', corners(.89, .98, .52, .43, .084), -.46, .59, 'slate');
extrude('roller-rim', disc(.93, .98, .41), .59, .79, 'copper');
extrude('roller-hub', disc(.93, .98, .25, 8), .79, .86, 'slate');
extrude('roller-pin', disc(.93, .98, .10, 6), .86, .94, 'brass');
extrude('latch', corners(-.35, 1.83, .70, .078, .034), -.41, .50, 'brass');
for (const x of [-1.10, -.95]) extrude('vent-' + x, corners(x, .87, .042, .23, .018), .48, .53, 'slate');
const labelVertices = [[-.88,1.05,.483],[.62,1.05,.483],[.62,1.7166666666666668,.483],[-.88,1.7166666666666668,.483]]
  .map((position, i) => {
    const id = 'label-v' + i;
    vertices.push({ id, position });
    return id;
  });
polygon('signal-label', 'label', labelVertices, { pin: true, uv: [[5,14],[23,14],[23,6],[5,6]].map(([x,y]) => [x / 34, y / 23]) });

const document = T.create({ id: 'relay-carrier', vertices, faces });
const scene = { id: 'switchback-relay', style: 'slate', solids: [],
  camera: { target: [-.02, 1.02, .18], dist: 3.65, yaw: -.29, pitch: .23, projection: 'orthographic' },
  tilesets: { 'signal-label': ink.readTilesetImage(encoded) },
  topologyMeshes: { relay: { document, materials: [{ id: 'copper', color: 0xaf6d52 }, { id: 'slate', color: 0x4d6471 },
    { id: 'brass', color: 0xd7a76d }, { id: 'label', texture: { tileset: 'signal-label' } }] } } };
save('source.json', scene);
save('paint-request.json', { tileset: 'signal-label' });
run('tileset', 'paint', 'open', 'paint-request.json', '--scene', 'source.json', '--out', 'paint-canvas');
const paint = ink.createPixelEditor(read('paint-canvas/paint.json'));
const marks = [[18,9],[20,9],[17,10],[18,10],[19,10],[20,10],[21,10],[18,11],[19,11],[20,11],[19,12]];
save('touchup.json', { id: 'teal-warning', frame: 'artwork', revision: paint.describe().revision,
  operation: { tool: 'rgba', layer: 'image', pixels: marks.map(at => ({ at, rgba: [146, 220, 183, 255] })) } });
run('pixel-art', 'edit', 'paint-canvas/paint.json', 'touchup.json', '--out', 'label-edited.json');
run('tileset', 'paint', 'write', 'paint-canvas/binding.json', 'label-edited.json',
  '--scene', 'source.json', '--out', 'painted.json');
const painted = read('painted.json');
assert.notDeepEqual(painted.tilesets['signal-label'], scene.tilesets['signal-label']);

const settings = { atlas: [44,37], texelsPerUnit: 12, seamAngle: 53, densityTolerance: .18, maxStretch: 1.65,
  gutter: 2, maxTiles: 24, columns: 4 };
save('prepare-request.json', { ...settings, revision: T.revision(painted.topologyMeshes.relay.document) });
run('mesh-uv', 'prepare', 'painted.json', 'prepare-request.json', '--out', 'prepared.json',
  '--layout-out', 'uv-pages.json', '--report', 'prepare-report.json');
const prepared = read('prepared.json'), preparedMesh = prepared.topologyMeshes.relay.document;
const plan = read('prepare-report.json').meshes[0], tiles = read('uv-pages.json').meshes[0].layout.tiles;
assert(plan.canCommit && plan.before.overlapCount > 0 && plan.after.overlapCount === 0 && !plan.after.failedFaces.length);
assert(tiles.length >= 5 && plan.proposedSeams.length && plan.charts.some(row => row.method === 'planar'));
assert.deepEqual(painted.tilesets, prepared.tilesets);
const find = source => source.faces.find(row => row.id === 'signal-label');
assert.deepEqual(find(painted.topologyMeshes.relay.document), find(preparedMesh));

const batch = { format: 'ink-studio/uv-density-batch', version: 1,
  settings: { atlas: settings.atlas, texelsPerUnit: settings.texelsPerUnit, densityTolerance: settings.densityTolerance,
    maxStretch: settings.maxStretch },
  assets: [{ id: 'painted-source', file: 'painted.json' }, { id: 'prepared-relay', file: 'prepared.json', layout: 'uv-pages.json' }] };
save('batch.json', batch);
const review = spawnSync(process.execPath, [cli,'mesh-uv','validate-batch','batch.json','--out','batch-report.json'], shell);
assert.equal(review.status, 1, review.stderr);
const validation = read('batch-report.json');
assert.equal(validation.failed, 1);
assert.equal(validation.passed, 1);
save('approved-batch.json', { ...batch, assets: batch.assets.slice(1) });
run('mesh-uv', 'validate-batch', 'approved-batch.json', '--out', 'approved-report.json');

function render(scene) {
  const world = ink.createSceneEditor(scene).build();
  return R.render(world, { w: 269, h: 156, px: 1, raw: true, edges: false, lockCamera: true });
}
const [reference, hero] = [render(painted), render(prepared)];
let markPixels = 0;
for (let i = 0; i < hero.rgb.length; i += 3) {
  if (reference.rgb[i] === 146 && reference.rgb[i+1] === 220 && reference.rgb[i+2] === 183) {
    assert.deepEqual(hero.rgb.slice(i,i+3), reference.rgb.slice(i,i+3));
    markPixels++;
  }
}
assert(markPixels > 0);
PNG.write(file('model-prepared.png'), hero.w, hero.h, hero.rgb);

const palette = ['#73bdb4','#ebad71','#7e93b7','#b98186','#a7b480','#b5a083','#92b6e0','#ce9ac2'];
const before = T.uv.inspect(painted.topologyMeshes.relay.document), after = T.uv.inspect(preparedMesh);
const pagesWide = 4, gap = 9, tileWidth = 70, tileHeight = 62, startX = 301;
const pageRows = Math.ceil(tiles.length / pagesWide), W = 630, H = Math.max(380,132 + pageRows * 91);
const commands = [rect(0,0,W,H,'#152631'),text('SWITCHBACK RELAY',19,13,3),text('WHOLE-ASSET UV PREPARATION',19,45,1,'#a5c3bd'),
  text('SOURCE COPPER SHEET',20,230,1),text('NATIVE UV PAGES',startX,67,2),
  text(plan.before.overlapCount + ' OVERLAPS',20,246,1,'#e49b92')];
const tint = id => palette[K.procedural.data.hash(id) % palette.length];
function drawTile(layout, filter, box, style) {
  const [x,y,w,h] = box, lookup = new Map(layout.corners.map(row => [row.id,row.uv]));
  commands.push(rect(x,y,w,h,'#203743'));
  for (let k = 1; k < 4; k++) {
    commands.push(pathInk([[x+w*k/4,y],[x+w*k/4,y+h]],'#294652'));
    commands.push(pathInk([[x,y+h*k/4],[x+w,y+h*k/4]],'#294652'));
  }
  for (const row of layout.faces.filter(filter)) {
    const points = row.corners.map(id => lookup.get(id)).map(([u,v]) => [x+u*(w-1),y+v*(h-1)]);
    if (style !== 'source' && row.id !== 'signal-label') commands.push(poly(points,tint(row.island)));
    commands.push(pathInk([...points,points[0]], row.id === 'signal-label' ? '#ffe0a2' : style === 'source' ? tint(row.id) : '#30434d'));
  }
}
drawTile(before, row => row.material === 'copper', [20,263,99,86], 'source');
commands.push(text('PINNED LABEL',142,247,1),text('EDITED TEXELS RETAINED',142,345,1,'#a5c3bd'));
for (const [i,tile] of tiles.entries()) {
  const x = startX + (i % pagesWide) * (tileWidth + gap), y = 102 + Math.floor(i / pagesWide) * 91;
  drawTile(after, row => row.material === tile.material, [x,y,tileWidth,tileHeight]);
  commands.push(text('TILE ' + tile.at.join(' '),x,y+66,1,tile.material === 'label' ? '#ffe0a2' : '#a5c3bd'));
}
commands.push(text(plan.proposedSeams.length + ' SEAMS  /  ' + tiles.length + ' TILES  /  ZERO OVERLAPS',startX,H-27,1,'#d3b883'));
const board = art.render({ width: W, height: H, edges: 'hard', commands });
for (let y = 0; y < hero.h; y++) for (let x = 0; x < hero.w; x++) {
  const slot = (y * hero.w + x) * 3, color = hero.rgb.slice(slot,slot+3);
  board.data.set([...color,255], ((64+y)*W+13+x)*4);
}
const registry = K.authoring.tilesets.prepare(painted.tilesets);
const editedPixels = registry.resolve({ tileset: 'signal-label' }).pixels;
for (const [x, y] of marks) assert.deepEqual(Array.from(editedPixels.slice((y*35+x)*4, (y*35+x)*4+4)),
  [146, 220, 183, 255]);
assert.equal(editedPixels.length, 35 * 24 * 4);
for (let y = 2; y < 21; y++) for (let x = 0; x < 30; x++) {
  const start = (y*35+x+1)*4, color = editedPixels.slice(start,start+4);
  for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 4; dx++)
    board.data.set(color, ((263+(y-2)*4+dy)*W+141+x*4+dx)*4);
}
const sha = createHash('sha256').update(Buffer.from(editedPixels)).digest('hex');
const sheet = PNG.encode(W,H,board.data,4);
fs.writeFileSync(file('switchback-relay.png'), sheet);
save('report.json', { image: 'switchback-relay.png', tiles: tiles.length, proposedSeams: plan.proposedSeams.length,
  overlappingBefore: plan.before.overlapCount, overlappingAfter: plan.after.overlapCount,
  preserved: plan.preserved, editedPigmentSHA256: sha, renderedMarkedPixels: markPixels,
  originalAssetsFailed: validation.failed, approvedAssets: validation.passed });
console.log(file('switchback-relay.png'));
