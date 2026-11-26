const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const ink = require('..');
const { KIT: K, makeBuilder } = ink.load();
const PNG = require('../cli/png.js');
const Render = require('../cli/render.js');
const Composite = require('../src/frame-composite.js');

const out = path.resolve(process.argv[2] ?? 'windgate-demo');
fs.mkdirSync(out, { recursive: true });
const file = name => path.join(out, name);
const save = (name, value) => fs.writeFileSync(file(name), JSON.stringify(value, null, 2) + '\n');
const read = name => JSON.parse(fs.readFileSync(file(name), 'utf8'));
const cli = path.resolve(__dirname, '../cli/ink-studio.js');
const run = (...args) => execFileSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
const S = K.procedural.rationalSurface, C = K.curve.retained;

function eyelet(cx, cy, rx, ry) {
  const x = cx + rx, a = cx - rx, y = cy + ry, b = cy - ry;
  return { id: 'eyelet', kind: 'hole', degree: 2, steps: 14,
    knots: [0, 0, 0, .25, .25, .5, .5, .75, .75, 1, 1, 1],
    controls: [[x, cy], [x, y], [cx, y], [a, y], [a, cy], [a, b], [cx, b], [x, b], [x, cy]]
      .map((position, i) => ({ position, weight: i % 2 ? Math.SQRT1_2 : 1 })) };
}

const axis = { degree: 3, knots: [0, 0, 0, 0, 1, 1, 1, 1] };
const patch = { format: S.format, version: 1, id: 'windgate', u: axis, v: axis,
  controls: [
    [[-1.54, -.28, 0], [-.71, -.55, .16], [.77, -.46, .15], [1.59, -.16, -.04]],
    [[-1.52, .24, -.07], [-.67, .11, .58], [.7, .26, .58], [1.61, .37, -.07]],
    [[-1.49, .78, -.05], [-.77, .71, .6], [.72, .92, .61], [1.64, .88, -.11]],
    [[-1.47, 1.17, -.04], [-.64, 1.46, .14], [.74, 1.54, .26], [1.67, 1.23, -.07]]
  ].map(row => row.map(position => ({ position }))),
  trims: [eyelet(.52, .55, .116, .123)] };
save('sail.json', patch);
const before = JSON.parse(run('surface', 'inspect', file('sail.json')));
save('sail-edit.json', { revision: before.revision, operations: [
  { op: 'set-control', row: 2, column: 1, position: [-.77, .78, 1.1], weight: 1.8 },
  { op: 'set-trim', trim: eyelet(.52, .55, .161, .23) }
] });
run('surface', 'edit', file('sail.json'), file('sail-edit.json'), '--out', file('sail-edited.json'), '--report', file('sail-edit-report.json'));
save('uv-pairs.json', [[.52, .55], [.52, .72], [.24, .58]]);
for (const name of ['sail', 'sail-edited']) {
  run('surface', 'mesh', file(name + '.json'), '--resolution', '26', '--out', file(name + '-mesh.json'),
    '--report', file(name + '-mesh-report.json'));
  run('surface', 'sample', file(name + '.json'), file('uv-pairs.json'), '--out', file(name + '-samples.json'));
}
assert.equal(read('sail-samples.json').samples[1].retained, true);
assert.equal(read('sail-edited-samples.json').samples[1].retained, false);
assert(read('sail-edited-mesh-report.json').parameterArea < read('sail-mesh-report.json').parameterArea);

const points = [-1.55, -.7, .12, .92, 1.58].map((x, i) => ({ id: 'knot-' + i, position: [x, -.58, .2],
  inHandle: [-.27, 0, 0], outHandle: [.27, 0, 0], radius: .048 }));
const segments = points.slice(1).map((b, i) => ({ id: 'reach-' + i, from: points[i].id, to: b.id }));
const rope = { format: C.format, version: 1, id: 'rig', splines: [{ id: 'line', points, segments }],
  attachments: segments.map((seg, i) => ({ id: 'marker-' + i, spline: 'line', segment: seg.id, t: .75 })) };
save('rope.json', rope);
save('rope-bend.json', { format: K.curve.bend.format, version: 1, revision: C.revision(rope), spline: 'line',
  origin: points[0].position, axis: [1, 0, 0], toward: [0, -1, .29], length: 3.13,
  keys: [{ time: 0, angle: 0, ease: 'linear' }, { time: 1.2, angle: 1.33 }] });
for (const [tag, t] of [['rest', 0], ['mid', .6], ['pull', 1.2]]) {
  run('curve', 'bend', file('rope.json'), file('rope-bend.json'), '--at', String(t),
    '--out', file('rope-' + tag + '.json'), '--report', file('rope-' + tag + '-report.json'));
}
assert.deepEqual(read('rope-pull.json').attachments, rope.attachments);
assert(read('rope-pull-report.json').attachments.at(-1).distance > 1);

save('corners.json', { domain: 'corner' });
save('controls.json', { domain: 'curve-control' });
function author(domain, source, name, values) {
  run('attributes', 'init', file(source), file(domain + '.json'), '--out', file(domain + '-blank.json'));
  const table = read(domain + '-blank.json'), ids = table.entities.slice(0, values.length).map(row => row.id);
  const { revision } = JSON.parse(run('attributes', 'inspect', file(domain + '-blank.json')));
  const operations = [{ op: 'add-channel', name, type: domain === 'corners' ? 'label' : 'number' },
    ...ids.map((id, i) => ({ op: 'set', name, id, value: values[i] }))];
  save(domain + '-edit.json', { revision, operations });
  run('attributes', 'edit', file(domain + '-blank.json'), file(domain + '-edit.json'),
    '--out', file(domain + '-authored.json'), '--report', file(domain + '-edit-report.json'));
  save(domain + '-selection.json', { channels: [name], ids });
  run('attributes', 'inspect', file(domain + '-authored.json'), file(domain + '-selection.json'),
    '--out', file(domain + '-selection-report.json'));
  const result = read(domain + '-selection-report.json');
  assert.deepEqual(result.selected.map(row => row.values[name]), values);
  return result;
}
const pigment = author('corners', 'sail-edited-mesh.json', 'pigment', ['apricot', 'teal', 'teal']);
const tension = author('controls', 'rope-pull.json', 'tension', [.9, .65, .46, .32, .12]);

function cloth(loop) {
  const [right, cy] = loop.controls[0].position, [cx, top] = loop.controls[2].position;
  const rx = right - cx, ry = top - cy;
  const size = 96, rgba = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = (x + .5) / size, v = 1 - (y + .5) / size;
    const distance = Math.hypot((u - cx) / rx, (v - cy) / ry);
    const seam = Math.min(u, v, 1 - u, 1 - v), stripe = u * 5 - v * .45, phase = stripe - Math.floor(stripe);
    let color = Math.floor(stripe) % 2 ? [53, 128, 120] : [60, 146, 132];
    if (phase < .028) color = [43, 101, 98];
    if (seam < .047 || distance < 1.18) color = [167, 86, 67];
    if (seam < .018 || distance < 1.075) color = [245, 182, 111];
    if ((seam < .009 || distance < 1.033) && v > .40) color = [255, 216, 151];
    if (distance > 1.28 && distance < 1.34 && (Math.floor((u + v) * 88) % 3 === 0)) color = [168, 195, 156];
    rgba.set([...color, 255], (y * size + x) * 4);
  }
  return { width: size, height: size, pixels: rgba };
}

const palette = [0x152733, 0x704946, 0xedaa69, 0xffe3a6, 0x3a5e64, 0x567a77, 0x243f4b];
const view = { target: [.02, -.53, .12], dist: 7.75, yaw: -.28, pitch: .11, ortho: true, fov: .53 };
function frame(name, tag) {
  const { points, faces, normals, uvs } = read(name + '-mesh.json');
  const mesh = K.sceneMeshes.create({ id: 'windgate-sail', positions: points.flat(), indices: faces.flat(), normals, uvs,
    materials: [{ id: 'sailcloth', texture: cloth(read(name + '.json').trims[0]) }] });
  const posed = C.create(read('rope-' + tag + '.json')), rail = C.compile(posed);
  const builder = makeBuilder(17, palette);
  builder.tube([[-1.5, 1.35, -.07], [-1.57, -.66, .01], [-1.62, -1.65, -.05]], .069, .088, [6, 4, 5]);
  builder.tube([[1.68, 1.37, -.12], [1.63, -.25, -.08], [1.59, -1.65, -.12]], .051, .072, [6, 4, 5]);
  builder.tube([[-1.78, -1.65, -.11], [1.74, -1.65, -.11]], .065, .065, [6, 4, 5]);
  builder.tube(Array.from({ length: 50 }, (_, i) => rail.locate(i / 49).p),
    .045, .042, [1, 2, 3]);
  for (const [i, { segment, t }] of posed.attachments.entries()) {
    const { p } = rail.anchor(segment, t), load = tension.selected[i].values.tension;
    builder.disc(...p, [0, 0, 1], .045 + .044 * load, .023, builder.P[3], 2.2);
  }
  const world = builder.finish({ meshes: [mesh], cam: view, radius: 6, dither: 0 });
  return Render.render(world, { w: 204, h: 187, px: 1, raw: true, edges: false, lockCamera: true });
}

const panels = [frame('sail', 'rest'), frame('sail-edited', 'mid'), frame('sail-edited', 'pull')];
const strip = Render.upscale(Render.grid(panels, 3), 2), top = 58, bottom = 39;
const w = strip.w, h = strip.h + top + bottom;
const base = { w, h, rgb: new Uint8Array(w * h * 3) };
for (let i = 0; i < base.rgb.length; i += 3) base.rgb.set(strip.rgb.subarray(0, 3), i);
base.rgb.set(strip.rgb, top * w * 3);
const text = (text, x, y, size, color) => ({ type: 'text', text, at: [x, y], size, color });
const draw = [text('WINDGATE SAIL', w / 2, 21, 20, '#f6daa3'),
  ...['ORIGINAL  /  0.00 s', 'TRIM EDIT  /  0.60 s', 'FULL PULL  /  1.20 s'].map((label, i) =>
    text(label, w * (i + .5) / 3, 52, 14, '#a5c8bc')),
  text('RATIONAL EYELET', w / 6, h - 19, 13, '#a5c8bc'),
  text('CORNER PIGMENT  /  ' + pigment.selected[0].values.pigment.toUpperCase(), w / 2, h - 19, 13, '#a5c8bc'),
  text('CONTROL TENSION  /  ' + tension.channels[0].min + ' - ' + tension.channels[0].max, w * 5 / 6, h - 19, 13, '#a5c8bc')];
const layout = K.frameComposite.prepare({ layers: [{ draw }] }, w, h, 1);
const sheet = Composite.compose(base, K.frameComposite.layers(layout, {}, 0), w, h, 'nearest');
PNG.write(file('windgate-sail.png'), sheet.w, sheet.h, sheet.rgb);
save('report.json', { image: 'windgate-sail.png', surface: read('sail-edit-report.json'),
  trimAreas: [read('sail-mesh-report.json').parameterArea, read('sail-edited-mesh-report.json').parameterArea],
  bend: read('rope-pull-report.json'), attributes: { pigment, tension } });
console.log(file('windgate-sail.png'));
