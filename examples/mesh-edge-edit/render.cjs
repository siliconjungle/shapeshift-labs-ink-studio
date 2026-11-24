'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ink = require('../..');
const PNG = require('../../cli/png.js');
const R = require('../../cli/render.js');
const files = require('../../cli/asset-files.js');
const example = require('./fixture.cjs');

function texture(width, height, pigment) {
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++)
    pixels.set([...pigment(x, y), 255], (y * width + x) * 4);
  return { width, height, pixels };
}

const logo = ['11101010111', '10001010100', '11001110110', '10000010100', '10000010111'];
const badge = texture(44, 28, (x, y) => {
  const mark = logo[Math.floor((y - 9) / 2)]?.[Math.floor((x - 11) / 2)] === '1';
  const border = [2, 41].includes(x) || [2, 25].includes(y);
  return mark ? [241, 218, 147] : border ? [125, 155, 147] : x + y < 16 ? [55, 95, 100] : [37, 67, 73];
});
const screen = texture(48, 28, (x, y) => {
  const edge = Math.min(x, 47 - x, y, 27 - y);
  const cell = Math.floor((x - 5) / 5), slot = (x - 5) % 5;
  const bar = cell >= 0 && cell <= 7 && slot < 3 && y >= 22 - (cell * 4 % 9 + cell + 2) && y < 22;
  if (edge === 1) return [108, 173, 150];
  if (bar) return cell > 5 ? [237, 193, 110] : [101, 206, 160];
  if (y === 23 && x > 3 && x < 44 || x % 5 === 0 && y % 5 === 0) return [58, 112, 104];
  return [22, 51, 58];
});
const joint = texture(24, 20, (x, y) => {
  if (y < 2 || y > 17) return [207, 147, 94];
  if ((x + 4 * y) % 14 === 0 || y === 5 || y === 13) return [89, 110, 110];
  return [53, 76, 83];
});
const colors = { oxide: 0x9b6d50, 'oxide-edge': 0xca985f, enamel: 0x487e77, 'enamel-edge': 0x74a59d,
  'joint-edge': 0x57737a, repair: 0x957449 };
const materials = Object.entries(colors).map(([id, color]) => ({ id, color })).concat(
  { id: 'badge', color: 0xffffff, texture: badge }, { id: 'screen', color: 0xffffff, texture: screen },
  { id: 'joint', color: 0xffffff, texture: joint });

function overlay(image, camera, mesh, api, doc, ids, pin) {
  const visible = new Set(api.captureVisibility(mesh, image, camera).visible.edges);
  const rows = new Map(doc.vertices.map(row => [row.id, row.position]));
  const { view, focal, ortho } = camera;
  const at = ([x, y, z]) => {
    const depth = -(view[2] * x + view[6] * y + view[10] * z + view[14]);
    const scale = focal / (ortho ? 1 : depth);
    return [image.w * .5 + (view[0] * x + view[4] * y + view[8] * z + view[12]) * scale,
      image.h * .5 - (view[1] * x + view[5] * y + view[9] * z + view[13]) * scale];
  };
  const rgb = image.rgb.slice();
  function pixel(x, y, color) {
    x = Math.floor(x);
    y = Math.floor(y);
    if (x >= 0 && x < image.w && y >= 0 && y < image.h) rgb.set(color, (x + y * image.w) * 3);
  }
  for (const edge of doc.edges) if (visible.has(edge.id) && edge.vertices.every(id => ids.has(id))) {
    const [a, b] = edge.vertices.map(id => at(rows.get(id)));
    const dx = b[0] - a[0], dy = b[1] - a[1], steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy))));
    for (let i = 0; i <= steps; i++) pixel(a[0] + dx * i / steps, a[1] + dy * i / steps, [248, 188, 104]);
  }
  if (pin) {
    const [x, y] = at(rows.get(pin));
    for (const [dx, dy] of [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]]) pixel(x + dx, y + dy, [161, 238, 184]);
  }
  return { ...image, rgb };
}

function run(directory) {
  const { KIT, makeBuilder } = ink.load(), api = KIT.meshTopology, dir = path.resolve(directory);
  const body = api.create(example.coupler(false)), gap = api.create(example.coupler()), panel = api.create(example.panel());
  const edits = [];
  function edit(id, doc, operation, pins, accepted = true) {
    const request = example.request(api, doc, id, operation, pins);
    const result = api.planEdgeEdit(doc, request);
    assert.equal(result.report.canCommit, accepted, JSON.stringify(result.report.issues));
    edits.push({ id, doc, request, result });
    return result;
  }
  const selection = example.edgeSelection(api, body, ends => ends.includes('heel/0') && ends.includes('nose/0'));
  const inserted = edit('insert-loop', body, { kind: 'insert-loop', selection, start: 'heel/0', fraction: .4 });
  const middle = inserted.document, newIds = new Set(inserted.report.detail.vertices.map(row => row.id));
  const pin = inserted.report.detail.vertices.find(row => row.samples[0][0] === 'heel/4').id;
  const loop = example.edgeSelection(api, middle, ends => ends.every(id => newIds.has(id)));
  const slide = edit('slide-loop', middle, { kind: 'slide', selection: loop, amount: .35 }, { vertices: [pin] });
  const bridge = { kind: 'bridge', first: example.rim(api, gap, 'heel'), second: example.rim(api, gap, 'nose'),
    material: 'repair', segments: 2, uv: 'strip' };
  const patched = edit('bridge-joint', gap, bridge, { boundary: true });
  edit('twisted-bridge', gap, { ...bridge, offset: 4 }, { boundary: true }, false);
  const filled = edit('fill-port', panel, { kind: 'grid-fill', selection: example.rim(api, panel, 'inner'),
    start: 'inner/0', columns: 4, material: 'screen' }, { boundary: true });

  function stage(doc, view, selected, pin) {
    const mesh = api.toSceneMesh(doc, { materials }), cam = { target: [0, 0, 0], dist: 4.9, ortho: true, ...view };
    const world = makeBuilder(72, [0x14242e]).finish({ meshes: [mesh], dither: 0, radius: 6, cam });
    let camera;
    const frame = ink.render(world, { w: 148, h: 108, px: 1, raw: true, ...(selected && {
      passes: ['sourceSurface'],
      ...R.cameraCapture(null, (raster, sample) => { camera = { ...raster, focal: sample.focal }; })
    }) });
    return selected ? overlay(frame, camera, mesh, api, doc, selected, pin) : frame;
  }
  const jointView = { yaw: -.94, pitch: .34 }, screenView = { yaw: -.22, pitch: .19 };
  const frames = [stage(body, jointView), stage(middle, jointView, newIds, pin), stage(gap, jointView), stage(panel, screenView),
    stage(middle, jointView, newIds), stage(slide.document, jointView, newIds, pin),
    stage(patched.document, jointView), stage(filled.document, screenView)];
  const combined = R.upscale(R.grid(frames, 4), 2);
  fs.mkdirSync(dir, { recursive: true });
  PNG.write(path.join(dir, 'comparison.png'), combined.w, combined.h, combined.rgb);
  const save = (name, data) => files.json(path.join(dir, name + '.json'), data);
  for (const { id, doc, request, result } of edits) {
    save(id + '-before', doc);
    save(id + '-request', request);
    save(id + '-report', result.report);
    if (result.report.canCommit) save(id + '-after', result.document);
  }
}

if (require.main === module) run(process.argv[2] ?? 'output/mesh-edge-edit');
