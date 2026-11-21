const fs = require('node:fs');
const ink = require('..');

if (!process.argv[2]) throw new Error('Usage: node examples/raster-schedule.cjs <demo.html>');

fs.writeFileSync(process.argv[2], `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Raster Relay</title>
<style>
:root { color-scheme: dark; background: #161a24; color: #f4e9d6; font-family: system-ui, sans-serif; }
* { box-sizing: border-box; }
body { margin: 0; padding: 29px 25px; }
main { max-width: 1160px; margin: auto; }
header { display: flex; justify-content: space-between; align-items: end; gap: 16px; margin-bottom: 18px; }
h1 { font: 500 clamp(46px, 7vw, 87px)/.87 Georgia, serif; letter-spacing: -.055em; margin: 4px 0 11px; }
p { margin: 0; color: #c7c6c5; font-size: 14px; line-height: 1.45; }
.mono, figcaption, button, label, output, table, .guide { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; }
.mono { color: #a4c4c5; font-size: 11px; letter-spacing: .13em; }
nav { display: flex; flex-wrap: wrap; gap: 7px; }
button { background: #2a3242; border: 1px solid #536479; color: #ede5dc; padding: 8px 11px; border-radius: 3px; cursor: pointer; }
button[aria-pressed="true"] { background: #433444; border-color: #db9fa8; color: #fce8d3; }
button:focus-visible, input:focus-visible { outline: 2px solid #e7aaa4; outline-offset: 2px; }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
figure, .registers, .controls { margin: 0; min-width: 0; border: 1px solid #556176; background: #242b3a; }
figcaption { color: #dfd7cd; padding: 8px 11px; display: flex; justify-content: space-between; align-items: center; gap: 8px;
 border-bottom: 1px solid #556176; min-height: 34px; font-size: 11px; letter-spacing: .065em; }
figcaption span:last-child { color: #eebf9a; text-align: right; }
canvas { display: block; width: 100%; aspect-ratio: 224 / 120; image-rendering: pixelated; }
.screen { position: relative; overflow: hidden; }
.guide { position: absolute; left: 0; right: 0; height: 0; border-top: 1px dashed #e5d7bf99; pointer-events: none; }
.guide b { color: #fff4d4; font-size: 10px; font-weight: 500; background: #292637de; padding: 2px 4px; position: absolute; right: 4px; top: 2px; }
.details { display: grid; grid-template-columns: .74fr 1.26fr; gap: 12px; margin-top: 12px; }
.controls, .registers { padding: 13px 16px 14px; }
h2 { margin: 0 0 7px; color: #f2e5d3; font: 500 27px/1 Georgia, serif; }
fieldset { border: none; display: grid; gap: 10px; margin: 14px 0 0; padding: 0; }
label { color: #d6d0cc; font-size: 11px; display: flex; gap: 8px; align-items: center; }
input { accent-color: #e2a59f; }
#row-shift { flex: 1; min-width: 42px; }
output { min-width: 36px; color: #ffd0ac; }
table { width: 100%; border-collapse: collapse; text-align: left; margin-top: 8px; font-size: 11px; }
th { font-weight: 500; color: #b4c1cd; }
th, td { padding: 6px 5px; border-bottom: 1px solid #4b5667; }
tbody tr:last-child td { border: none; }
td:first-child { color: #f1bda7; }
.chips { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; }
.chip { display: inline-flex; align-items: center; border: 1px solid #7c8b96; color: #f5e7d8; padding: 1px 4px; gap: 4px; }
.chip i { width: 10px; height: 9px; }
@media(max-width: 725px) {
 body { padding: 18px 12px; }
 header { align-items: start; flex-direction: column; gap: 12px; margin-bottom: 12px; }
 .grid, .details { grid-template-columns: 1fr; gap: 8px; }
 figcaption { padding: 5px 7px; min-height: 28px; font-size: 10px; }
 .controls, .registers { padding: 10px; }
}
</style>
<main>
<header>
 <div><span class="mono">INK STUDIO / COPPER-STYLE SCHEDULES</span><h1>Raster Relay</h1><p>One image switches palette, address, and pixel size as the raster crosses authored rows.</p></div>
 <nav aria-label="Register writes">
  <button type="button" data-mode="all" aria-pressed="true">All writes</button>
  <button type="button" data-mode="palette" aria-pressed="false">Palette</button>
  <button type="button" data-mode="offset" aria-pressed="false">Source offset</button>
  <button type="button" data-mode="scale" aria-pressed="false">Pixel size</button>
 </nav>
</header>
<div class="grid">
 <figure><figcaption><span>INDEXED INPUT</span><span>14 SLOTS</span></figcaption><canvas id="source" width="224" height="120" aria-label="Original indexed landscape"></canvas></figure>
 <figure><figcaption><span>SCHEDULED OUTPUT</span><span id="mode-label"></span></figcaption>
  <div class="screen"><canvas id="output" width="224" height="120" aria-label="Rendered landscape with row-specific palette and sampling"></canvas><div id="guides" aria-hidden="true"></div></div></figure>
</div>
<div class="details">
 <section class="controls"><h2 id="mode-title"></h2><p id="copy"></p>
 <fieldset>
  <label for="row-shift">Move write rows <input id="row-shift" type="range" value="0" min="-12" max="12" step="1"> <output id="row-read" for="row-shift">0 px</output></label>
  <label><input id="show-guides" type="checkbox" checked> Mark register writes</label>
 </fieldset></section>
 <section class="registers"><span class="mono">REGISTER WRITES</span>
 <table><thead><tr><th scope="col">Row</th><th scope="col">Palette slots</th><th scope="col">Source offset</th><th scope="col">Pixel size</th></tr></thead><tbody id="registers"></tbody></table></section>
</div>
</main>
<script>${ink.bundle().replace(/<\/script/gi, '<\\/script')}</script>
<script>
const w = 224, h = 120, P = KIT.procedural;
const el = id => document.getElementById(id);
const palette = ['#1a253f', '#26374f', '#44516a', '#4b5e6b', '#33716f', '#4fa496', '#9cd8b3',
  '#eabc8b', '#af7f90', '#7a5979', '#1d3048', '#2c4c5c', '#fae5ad', '#8aab9d'];
const indices = new Uint8Array(w * h);
for (let y = 0, p = 0; y < h; y++) for (let x = 0; x < w; x++, p++) {
  const ridge = 73 + 4 * Math.sin(x * .09) + 6 * Math.sin(x * .033 + .5);
  const r = Math.hypot(x - 169, (y - 34) * 1.07), hash = (x * 91 + y * 51 + x * y * 7) % 97;
  let slot = y < 22 ? 0 : y < 47 ? 1 : 2;
  if (y < 62 && r > 27 && hash === 11) slot = x % 15 ? 3 : 13;
  if (r < 23) slot = y > 30 && y % 4 === 1 ? 8 : y < 34 ? 12 : 7;
  const ring = Math.hypot((x - 169) / 1.43, (y - 34 + (x - 169) * .23) * 3.5);
  if (Math.abs(ring - 25) < 1.4 && (r > 23 || x < 169)) slot = 13;
  if (y >= ridge && y < 83) slot = x % 6 < 2 && y % 5 < 2 ? 3 : 10;
  if (y >= 82) {
    slot = y < 95 ? 11 : 10;
    const water = Math.sin(x * .08 + y * .46) + .6 * Math.cos(x * .19 - y * .57);
    if (y % 4 === 1 && water > 0) slot = water > .85 ? 4 : 3;
    if (Math.abs(x - 169) < (y - 79) * .81 && y % 5 === 2 && water > -.2) slot = r > 72 ? 8 : 7;
    if ((x * 3 + y * 11) % 79 < 3) slot = 13;
  }
  const arc = Math.hypot((x - 103) * .92, y - 74), arch = y < 75 && arc > 32 && arc < 37;
  if (arch) slot = arc >= 35.9 ? 6 : (x + y) % 8 < 3 ? 4 : 5;
  if (y >= 58 && y < 82 && (Math.abs(x - 64) <= 2 || Math.abs(x - 141) <= 2)) slot = y % 6 ? 4 : 6;
  if (y >= 74 && y <= 79 && x > 34 && x < 160) slot = y === 74 ? 13 : x % 12 < 2 ? 3 : 10;
  if (y === 81 && x > 38 && x < 158 && x % 11 === 0) slot = 5;
  if (y >= 91 && Math.abs(x - 103) + (y - 91) * 1.2 < 34 && Math.abs((y - 91) % 6) < 1) slot = x % 7 < 2 ? 6 : 4;
  if (y >= 110 || y > 99 && (x + 14) % 49 < 3) slot = y === 110 ? 13 : y <= 113 ? 3 : 10;
  if (y >= 114 && y <= 117 && x % 49 > 5 && x % 49 < 13) slot = 7;
  indices[p] = slot;
}
const source = { width: w, height: h, channels: 1, data: indices };
const writes = [
  { row: 27, palette: [[1, '#583e59'], [2, '#714c61'], [7, '#f09183'], [12, '#f6baa7']] },
  { row: 54, offset: [-13, 0], pixelScale: [3, 2], palette: [[4, '#67476a'], [5, '#db8aa0'], [6, '#f3bba9']] },
  { row: 79, offset: [14, 1], pixelScale: [5, 3], palette: [[3, '#80746a'], [10, '#193c43'], [11, '#2f5750']] },
  { row: 105, offset: [0, 0], pixelScale: [1, 1], palette: [[7, '#ffc486'], [10, '#1d3048']] }
];
const modes = {
  all: ['ALL REGISTERS', 'The full schedule', 'The palette changes at one boundary and the address and pixel grid switch at later boundaries.'],
  palette: ['PALETTE WRITES', 'Change individual slots', 'Each write changes the color attached to an index. The edited slot persists down the frame until the next write to it.'],
  offset: ['SOURCE OFFSETS', 'Read a different address', 'An offset shifts where a band reads from the source. Both edges wrap on this plate.'],
  scale: ['PIXEL SIZE', 'Switch pixel size', 'Each band samples a larger pixel block. The sampling grid starts afresh when a pixel-size write takes effect.']
};
const controls = [...document.querySelectorAll('[data-mode]')], shift = el('row-shift'), show = el('show-guides');
const contexts = Object.fromEntries(['source', 'output'].map(id => [id, el(id).getContext('2d', { willReadFrequently: true })]));
let mode = 'all';
function draw(id, value) {
  const context = contexts[id], image = context.createImageData(w, h);
  image.data.set(value.data); context.putImageData(image, 0, 0);
}
function program() {
  const amount = Number(shift.value);
  return writes.flatMap(({ row, palette, offset, pixelScale }) => {
    const event = { row: row + amount,
      ...((mode === 'all' || mode === 'palette') && palette && { palette }),
      ...((mode === 'all' || mode === 'offset') && offset && { offset }),
      ...((mode === 'all' || mode === 'scale') && pixelScale && { pixelScale }) };
    return Object.keys(event).length > 1 ? [event] : [];
  });
}
function rowTable(entries) {
  el('registers').replaceChildren(...entries.map(({ row, palette, offset, pixelScale }) => {
    const tr = document.createElement('tr'), body = [String(row), '—', offset?.join(', ') ?? '—', pixelScale?.join(' × ') ?? '—'];
    for (const text of body) { const cell = document.createElement('td'); cell.textContent = text; tr.append(cell); }
    if (palette) {
      const cell = tr.children[1], chips = document.createElement('div'); chips.className = 'chips';
      for (const [slot, color] of palette) {
        const chip = document.createElement('span'), swatch = document.createElement('i');
        chip.className = 'chip'; chip.title = color; swatch.style.background = color;
        chip.append(swatch, String(slot)); chips.append(chip);
      }
      cell.replaceChildren(chips);
    }
    return tr;
  }));
}
function render() {
  const schedule = program();
  draw('output', P.pixelEffects.rasterSchedule(source, { palette, schedule, wrap: true }));
  const [label, title, description] = modes[mode];
  el('mode-label').textContent = label;
  el('mode-title').textContent = title;
  el('copy').textContent = description;
  el('row-read').textContent = (Number(shift.value) > 0 ? '+' : '') + shift.value + ' px';
  Object.assign(el('output').dataset, { mode, rows: schedule.map(entry => entry.row).join(',') });
  rowTable(schedule);
  el('guides').replaceChildren(...(show.checked ? schedule.map(({ row }) => {
    const guide = document.createElement('div'), label = document.createElement('b');
    guide.className = 'guide'; guide.style.top = (row * 100 / h) + '%';
    label.textContent = 'ROW ' + row; guide.append(label); return guide;
  }) : []));
}
controls.forEach(button => button.addEventListener('click', () => {
  mode = button.dataset.mode;
  controls.forEach(other => other.setAttribute('aria-pressed', other === button));
  render();
}));
shift.addEventListener('input', render);
show.addEventListener('change', render);
draw('source', P.pixelEffects.rasterSchedule(source, { palette }));
render();
</script>
</html>`);
