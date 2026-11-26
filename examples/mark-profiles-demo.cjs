'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { KIT } = require('..').load();
const PNG = require('../cli/png.js');
const output = path.resolve(process.argv[2] ?? 'mark-profiles-demo');
const cli = path.resolve(__dirname, '../cli/ink-studio.js');
fs.mkdirSync(output, { recursive: true });
const run = (...args) => execFileSync(process.execPath, [cli, ...args], { cwd: output, encoding: 'utf8', stdio: 'pipe' });
const put = (name, json) => fs.writeFileSync(path.join(output, name + '.json'), JSON.stringify(json, null, 2) + '\n');

const palette = [0x171824, 0x282436, 0x493342, 0x684554, 0x83595a,
  0x322635, 0x49303b, 0x694440, 0x88584b, 0xaa7259,
  0x50313a, 0x81504b, 0xaa745b, 0xc89367, 0xe0ba89,
  0x783c37, 0xa75c47, 0xc8815b, 0xe5a771, 0xf9d39b];
const roles = { stone: [0, 1, 2, 3, 4], brown: [5, 6, 7, 8, 9], trim: [10, 11, 12, 13, 14], glaze: [15, 16, 17, 18, 19] };
const box = (id, at, half, mat, round, res) => ({ kind: 'box', id, at, half, mat, round, res });
put('base', { id: 'clay-grain-study', seed: 17, style: { palette, roles, amb: .27, sky: .25, sun: [-.63, .77, .40] },
  camera: { target: [0, 1.36, .12], dist: 7.12, yaw: .105, pitch: .21, sway: 0 }, finish: { detail: 16, dither: 0 },
  solids: [
    box('plinth', [0, -.13, -.16], [2.90, .16, .76], 'stone', .09, .076),
    box('tile', [0, 1.28, 0], [2.75, 1.25, .24], 'trim', .14, .066),
    box('face', [0, 1.28, .12], [2.66, 1.16, .23], 'brown', .085, .046)
  ] });

function nib(a, b, width) {
  const dx = b[0] - a[0], dy = b[1] - a[1], length = Math.hypot(dx, dy);
  const x = -dy * width / length, y = dx * width / length;
  return [[a[0] - x, a[1] - y], [b[0] - x * .78, b[1] - y * .78], [b[0] + x, b[1] + y], [a[0] + x * .83, a[1] + y * .83]];
}
const fine = {
  silhouette: [nib([-.11, -.087], [.076, .104], .021), nib([-.096, .09], [.09, -.079], .016)],
  spacing: .205, coverage: { opacity: .94, feather: .005 }, grain: { amount: .18, scale: .028, seed: 51 },
  depth: { back: .02, curve: [[0, .012], [.013, .042], [.027, .054]] }
};
const bark = {
  silhouette: [[[-.31,-.029],[-.246,-.075],[-.128,-.063],[-.072,-.086],[.069,-.057],[.166,-.071],[.29,-.032],
    [.324,.017],[.183,.069],[.052,.053],[-.026,.08],[-.19,.046],[-.266,.057]],
    nib([-.224,.108],[.11,.097],.015)],
  spacing: .335, coverage: { opacity: .97, feather: .009 }, grain: { amount: .23, scale: .044, seed: 90 },
  depth: { back: .028, curve: [[0, .018], [.025, .073], [.062, .141]] }
};
const bind = { kind: 'surface', slot: 'ceramic', snap: { mode: 'surface', direction: [0, 0, 1], maxDistance: .48, spacing: .085, offset: .025 } };
const rotation = angle => [0, 0, Math.sin(angle / 2), Math.cos(angle / 2)];
const marks = Array.from({ length: 8 }, (_, j) => {
  const y = .37 + j * .255, start = -2.24 + (j % 2) * .10, end = 2.19 - (j % 3) * .075;
  const range = [.29 + (j % 2) * .035, .72 + (j % 3) * .022];
  return { id: 'row-' + j, mat: 'glaze', res: .022, attachment: bind,
    brush: { kind: 'mark-profile', profile: 'crosshatch', mix: { profile: 'bark', range } },
    pressureResponse: { width: [.75, 1.08] },
    poses: Array.from({ length: 13 }, (_, i) => {
      const t = i / 12, wobble = Math.sin(t * Math.PI * 3 + j * .85),
        ripple = Math.sin(t * Math.PI * 7 + j * .96);
      return { point: [start + (end - start) * t, y + .031 * wobble + .019 * ripple, .57],
        rotation: rotation(.086 * Math.cos(t * Math.PI * 3 + j * .65)), pressure: .78 + .18 * ripple };
    }) };
});
const placement = { id: 'glazing', bindings: { ceramic: 'face' },
  painting: { format: KIT.authoring.paintings3d.format, version: 1, id: 'crosshatch-and-bark',
    profiles: { crosshatch: fine, bark }, marks } };
put('placement', placement);
put('edit', { id: 'glazing', profiles: { bark: { ...bark, spacing: .455,
  depth: { back: .028, curve: [[0, .018], [.026, .089], [.055, .190]] } } },
  edits: marks.map((m, i) => ({ op: 'set', id: m.id, patch: {
    brush: { ...m.brush, mix: { profile: 'bark', range: [.18 + (i % 2) * .035, .51 + (i % 3) * .025] } }
  } })) });
fs.writeFileSync(path.join(output, 'placement-report.json'),
  run('painting-3d', 'apply', 'base.json', 'placement.json', '--out', 'painted.json'));
fs.writeFileSync(path.join(output, 'edit-report.json'),
  run('painting-3d', 'update', 'painted.json', 'edit.json', '--out', 'revised.json'));
run('painting-3d', 'extract', 'revised.json', '--id', 'glazing', '--out', 'painting.json');

const w = 515, h = 332, gap = 10, title = 37, footer = 32, width = 2 * w + 3 * gap, height = title + h + footer;
const sheet = Buffer.alloc(width * height * 3);
for (let i = 0; i < sheet.length; i += 3) sheet.set([24, 23, 34], i);
function label(text, x, y, scale, color) {
  const { width: tw, height: th, data } = KIT.procedural.drawing2d.text(text, { color, scale }).value;
  for (let row = 0; row < th; row++) for (let col = 0; col < tw; col++) {
    const i = (row * tw + col) * 4;
    if (data[i + 3]) sheet.set(data.subarray(i, i + 3), ((y + row) * width + x + col) * 3);
  }
}
for (const [i, [scene, heading, caption]] of [
  ['painted', 'CROSSHATCH INTO BARK', 'FINE CROSSHATCH / SOFT MIX / WIDE RELIEF RIDGES'],
  ['revised', 'SHARED PROFILE EDITED', 'SAME POSES / EARLIER MIX / TALLER, WIDER-SPACED RIDGES']
].entries()) {
  run('render', scene + '.json', '--ortho', '--raw', '--px', '1', '--w', String(w), '--h', String(h), '--out', scene + '.png');
  const img = PNG.read(path.join(output, scene + '.png')).rgb, x = gap + i * (w + gap);
  label(heading, x + 13, 13, 2, '#ffe4bd');
  for (let y = 0; y < h; y++) sheet.set(img.subarray(y * w * 3, (y + 1) * w * 3), ((title + y) * width + x) * 3);
  label(caption, x + 13, title + h + 11, 1, '#d5b9ac');
}
const demo = path.join(output, 'mark-profiles-demo.png');
fs.writeFileSync(demo, PNG.encode(width, height, sheet));
console.log(demo);
