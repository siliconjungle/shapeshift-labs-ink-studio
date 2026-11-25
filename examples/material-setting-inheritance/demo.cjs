const fs = require('node:fs');
const path = require('node:path');
const Ink = require('../..');

const directory = path.resolve(process.argv[2] ?? 'outputs/material-setting-inheritance');
fs.mkdirSync(directory, { recursive: true });
const file = name => path.join(directory, name);
const save = (name, value) => fs.writeFileSync(file(name), JSON.stringify(value) + '\n');

const context = { parent: { id: 'ceramic-catalog', settings: { output: { format: 'png', bitDepth: 16 }, seed: 28 } } };
const graph = Ink.openMaterialGraph({
  format: 'ink-studio/graph-project', version: 1,
  base: { tiling: { u: 'wrap', v: 'mirror' } },
  inheritance: {
    size: { mode: 'primary', scale: [0.5, 0.5] },
    output: { mode: 'parent' },
    pixelSizeMm: { mode: 'primary', scale: 2 },
    pixelRatio: { mode: 'primary' },
    tiling: { mode: 'absolute' },
    seed: { mode: 'parent', offset: 9 }
  },
  primaryInput: 'artwork',
  inputs: { artwork: 'colorImage' },
  nodes: { finish: { op: 'material.imageOutput', inputs: { source: { input: 'artwork' }, settings: { input: 'materialBase' } } } },
  outputs: { glaze: { node: 'finish', port: 'value' } },
  exports: { glaze: { output: 'glaze', format: 'material-image' } }
}, { id: 'waypoint-enamel' });
Ink.writeMaterialGraph(file('waypoint.material.json'), graph);
save('context.json', context);
const material = Ink.readGraphProject(file('waypoint.material.json'), { baseContext: context });

const { graphImages, materialBase } = Ink.load().KIT.procedural;
const colors = {
  shadow: [8, 23, 31], bevel: [113, 153, 144], edge: [40, 82, 86],
  glaze: [21, 84, 91], deep: [16, 55, 68], aqua: [68, 145, 137],
  ivory: [246, 223, 157], gold: [227, 150, 68], burnt: [162, 80, 47], night: [12, 39, 51]
};
const roundedRect = (x, y, w, h, r) => Math.hypot(Math.max(Math.abs(x) - w + r, 0), Math.max(Math.abs(y) - h + r, 0)) - r;
function paint(x, y) {
  const plate = roundedRect(x, y, 34.5, 21, 3.3);
  if (plate > 0.6) return colors.shadow;
  if (plate > -0.55) return x + 1.5 * y < 1 ? colors.bevel : colors.night;
  if (plate > -1.45) return x + y < 13 ? colors.edge : colors.deep;
  for (const dx of [-29.8, 29.8]) for (const dy of [-16.4, 16.4]) {
    const distance = Math.hypot(x - dx, y - dy);
    if (distance < 1.25) return x - dx + y - dy < -.25 ? colors.ivory : colors.burnt;
    if (distance < 1.85) return colors.deep;
  }
  const radius = Math.hypot(x, y);
  const angle = Math.atan2(y, x);
  const ticks = Math.abs(Math.sin(angle * 12));
  const ax = Math.abs(x), ay = Math.abs(y);
  if (ax / 3.15 + ay / 10.6 < 1)
    return y < 0 ? x < 0 ? colors.ivory : colors.gold : x < 0 ? colors.burnt : colors.gold;
  if (ax / 10.6 + ay / 2.55 < 1)
    return x > 0 ? y < 0 ? colors.ivory : colors.gold : y < 0 ? colors.gold : colors.burnt;
  if (radius < 2.05) return colors.gold;
  if (radius > 14.8 && radius < 15.65 || radius > 12.8 && radius < 14.1 && ticks < .24)
    return y < 2 ? colors.ivory : colors.gold;
  if (radius < 14.8) return radius > 13.95 ? colors.aqua : colors.night;

  const wave = Math.sin((x + 6) * 0.23) * 1.4;
  if (ax < 28 && ay > 6 && ax > 15 && Math.abs(ay - 10.8 - wave) < .56) return colors.aqua;
  if (ax < 30.4 && ax > 16 && Math.abs(ay - 13.1 - wave) < .48) return colors.deep;
  if (Math.abs(ax - 21.5) / 3.6 + ay / 1.6 < 1) return colors.gold;
  const grains = Math.sin(x * 12.2 + y * 19.5) * Math.sin(x * 8.7 - y * 4.3);
  const tone = Math.round(Math.sin(x * .17 - y * .23) * 2 + grains * 2 - y * .25);
  return colors.glaze.map(component => component + tone);
}

function render(name, width, height, pitch) {
  const rgba = new Uint8Array(width * height * 4);
  for (let row = 0; row < height; row++) for (let col = 0; col < width; col++) {
    const rgb = paint((col + .5) / width * 72 - 36, (row + .5) / height * 45 - 22.5);
    rgba.set([...rgb, 255], (row * width + col) * 4);
  }
  const image = graphImages.declare({ width, height, channels: 4, data: rgba },
    { intent: 'color', pixelPitchMm: [pitch, pitch * .75] });
  const inputs = { artwork: { ...image, raster: { ...image.raster, data: Array.from(rgba) } } };
  save(name + '.inputs.json', inputs);
  const { report, artifacts: [png] } = material.run({ inputs });
  fs.writeFileSync(file(name + '.png'), png.bytes);
  save(name + '.report.json', report);
  return { report, width, height, uri: 'data:image/png;base64,' + png.bytes.toString('base64') };
}

const variants = [
  { id: 'field', title: 'Field marker', ...render('field', 144, 90, .25) },
  { id: 'archive', title: 'Archive plate', ...render('archive', 288, 180, .125) }
];
const footprint = materialBase.measure(variants[0].report.base).physicalSizeMm.join(' × ');
const size = ({ width, height }) => width + ' × ' + height;
const rows = {
  size: { name: 'Output size', view: size, rule: '½ on both axes' },
  output: { name: 'Format', view: value => 'PNG ' + value.bitDepth + '-bit', rule: 'Copy' },
  pixelSizeMm: { name: 'Pixel width', view: value => value + ' mm', rule: '×2 pitch' },
  pixelRatio: { name: 'Pixel ratio', view: value => value.join(' : '), rule: 'Copy' },
  tiling: { name: 'Tiling', view: value => value.u + ' / ' + value.v, rule: 'Set here' },
  seed: { name: 'Seed', view: String, rule: '+9' }
};
const cards = variants.map(({ id, title, uri, report, width, height }) => `
  <button type="button" class="sample" data-id="${id}" aria-pressed="${id === 'field'}">
    <img src="${uri}" alt="Blue and gold ceramic compass plaque">
    <span class="caption"><span><strong>${title}</strong><small>${width} × ${height} source</small></span><b>${size(report.base.size)}</b></span>
  </button>`).join('');
const legend = { authored: 'Absolute · material', parent: 'Parent · ceramic catalog', primary: 'Primary · artwork' };
const body = Object.entries(rows).map(([key, { name, view, rule }]) => {
  const entry = variants[0].report.baseProvenance[key];
  return `<tr><th scope="row">${name}</th><td data-kind="${entry.source.kind}">${legend[entry.source.kind]}</td><td>${rule}</td>
    ${variants.map(({ id, report }) => `<td class="value" data-column="${id}">${view(report.baseProvenance[key].value)}</td>`).join('')}</tr>`;
}).join('');

fs.writeFileSync(file('demo.html'), `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Waypoint enamel · Ink Studio</title>
<style>
:root{color-scheme:dark;--bg:#0e1b20;--paper:#142930;--line:#29404a;--ink:#f4e7c9;--muted:#a1b4b3;--gold:#e5b873;--aqua:#8ecfbe}
*{box-sizing:border-box}body{margin:0;background:radial-gradient(ellipse at top,#1c3238 0,transparent 620px),var(--bg);color:var(--ink);font:15px/1.45 system-ui,sans-serif}
main{width:min(100% - 48px,1018px);margin:0 auto;padding:34px 0 28px}header{display:flex;justify-content:space-between;align-items:end;gap:16px;margin-bottom:21px}
h1{font:500 clamp(36px,6vw,65px)/1 Georgia,serif;letter-spacing:-.044em;margin:5px 0 0}header small{display:block;color:var(--gold);letter-spacing:.16em;font:600 11px system-ui;text-transform:uppercase}
header p{color:var(--muted);margin:0 0 2px;text-align:right;font-size:14px}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
.sample{min-width:0;text-align:left;color:inherit;font:inherit;padding:11px;border:1px solid var(--line);background:var(--paper);cursor:pointer;border-radius:10px}
.sample[aria-pressed="true"]{border-color:#aa8a58}.sample:hover{border-color:var(--gold)}.sample:focus-visible{outline:2px solid var(--aqua);outline-offset:2px}
.sample img{display:block;width:100%;max-width:432px;margin:auto;aspect-ratio:8/5;image-rendering:pixelated;object-fit:contain;background:#08171f}
.caption{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:9px 8px 1px}.caption strong,.caption small{display:block}
.caption small{color:var(--muted);font-size:12px}.caption b{color:var(--gold);font:500 20px ui-monospace,monospace;font-variant-numeric:tabular-nums}
.inspector{margin-top:18px;overflow:auto;border:1px solid var(--line);border-radius:10px;background:#102229}
table{width:100%;min-width:585px;border-collapse:collapse;white-space:nowrap}th,td{padding:9px 12px;border-bottom:1px solid #263b43;text-align:left}tr:last-child th,tr:last-child td{border-bottom:0}
thead th{font-size:11px;text-transform:uppercase;letter-spacing:.065em;background:#172d34;color:var(--muted)}tbody th{font-weight:600}
tbody td{color:var(--muted)}td[data-kind="parent"]{color:var(--gold)}td[data-kind="primary"]{color:var(--aqua)}td[data-kind="authored"]{color:#c9b4df}
td.value{font-family:ui-monospace,monospace;color:var(--ink)}main[data-active="field"] [data-column="field"],main[data-active="archive"] [data-column="archive"]{background:#21363a;color:#f7dfaa}
@media(max-width:560px){main{width:calc(100% - 28px);padding-top:20px}header{display:block}header p{text-align:left;margin-top:9px}.grid{grid-template-columns:1fr}}
</style></head>
<body><main data-active="field"><header><div><small>Ink Studio · Material inheritance</small><h1>Waypoint enamel</h1></div>
<p>One graph · Two primary textures<br>Both cover ${footprint} mm</p></header>
<div class="grid">${cards}</div>
<section class="inspector" aria-label="Resolved settings"><table>
<thead><tr><th>Setting</th><th>Source</th><th>Adjustment</th><th data-column="field">Field effective</th><th data-column="archive">Archive effective</th></tr></thead>
<tbody>${body}</tbody></table></section></main>
<script>
const samples = document.querySelectorAll('.sample');
for (const sample of samples) sample.addEventListener('click', () => {
  document.querySelector('main').dataset.active = sample.dataset.id;
  for (const button of samples) button.setAttribute('aria-pressed', String(button === sample));
});
</script></body></html>`);
console.log(file('demo.html'));
