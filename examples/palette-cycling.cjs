const fs = require('node:fs');
const ink = require('..');

if (!process.argv[2]) throw new Error('Usage: node examples/palette-cycling.cjs <demo.html>');

fs.writeFileSync(process.argv[2], `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Chromatic Current</title>
<style>
:root { color-scheme: dark; background: #141a23; color: #f1e7d5; font-family: system-ui, sans-serif; }
* { box-sizing: border-box; }
body { margin: 0; padding: 30px 25px; }
main { max-width: 1150px; margin: auto; }
header { display: flex; justify-content: space-between; align-items: end; gap: 16px; margin-bottom: 19px; }
h1 { font: 500 clamp(44px, 7vw, 83px)/.88 Georgia, serif; margin: 5px 0 10px; letter-spacing: -.06em; }
p { margin: 0; color: #c5ccd1; font-size: 14px; line-height: 1.45; }
.mono, figcaption, button, time, label, .swatches { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; }
.mono { color: #a6cba9; letter-spacing: .13em; font-size: 11px; }
nav { display: flex; flex-wrap: wrap; gap: 7px; }
button { cursor: pointer; padding: 8px 11px; border: 1px solid #566773; border-radius: 3px; background: #293340; color: #ede5d8; }
button[aria-pressed="true"] { background: #344a45; border-color: #92c5a6; color: #dbf0cd; }
button:focus-visible, input:focus-visible { outline: 2px solid #b3dfb9; outline-offset: 2px; }
.grid, .bands { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
figure, .band { margin: 0; min-width: 0; border: 1px solid #52626e; background: #202a35; }
figcaption { display: flex; justify-content: space-between; align-items: center; padding: 8px 11px; gap: 8px; min-height: 34px;
 border-bottom: 1px solid #52626e; color: #d6ded6; font-size: 11px; letter-spacing: .06em; }
figcaption span:last-child, time { color: #baf0bf; }
canvas { display: block; width: 100%; aspect-ratio: 224 / 120; image-rendering: pixelated; }
.transport { display: flex; align-items: center; gap: 12px; margin: 13px 0; }
#play { min-width: 66px; }
#scrub { flex: 1; width: 100%; min-width: 42px; }
input { accent-color: #a2d3ae; }
time { min-width: 58px; font-size: 12px; text-align: right; }
label { white-space: nowrap; color: #d3ddce; font-size: 11px; display: flex; align-items: center; gap: 6px; }
.band { padding: 12px 14px 13px; }
h2 { margin: 0 0 6px; font: 500 27px/1 Georgia, serif; color: #f2e6ce; }
.swatches { display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; gap: 6px; margin-top: 11px; }
.swatches span { min-height: 34px; display: grid; grid-template-rows: 17px auto; gap: 3px; text-align: center; color: #d3d7ce; font-size: 10px; }
.swatches i { display: block; border: 1px solid #a1b3ad65; }
@media(max-width: 720px) {
 body { padding: 18px 12px; }
 header { align-items: start; flex-direction: column; gap: 12px; margin-bottom: 12px; }
 .grid, .bands { grid-template-columns: 1fr; gap: 8px; }
 figcaption { padding: 6px 8px; min-height: 28px; font-size: 10px; }
 .transport { gap: 7px; }
}
</style>
<main>
<header>
 <div><span class="mono">INK STUDIO / PALETTE CYCLING</span><h1>Chromatic Current</h1><p>Two palette ranges animate the sky and river while the pixel indices stay in place.</p></div>
 <nav aria-label="Active cycles">
  <button type="button" data-mode="both" aria-pressed="true">Both cycles</button>
  <button type="button" data-mode="water" aria-pressed="false">River</button>
  <button type="button" data-mode="sky" aria-pressed="false">Aurora</button>
  <button type="button" data-mode="none" aria-pressed="false">Pause colors</button>
 </nav>
</header>
<div class="grid">
 <figure><figcaption><span id="reference-label">BASE PALETTE</span><span>FIXED</span></figcaption><canvas id="source" width="224" height="120" aria-label="Base image or fixed palette index map"></canvas></figure>
 <figure><figcaption><span>CYCLED PALETTE</span><span id="active"></span></figcaption><canvas id="result" width="224" height="120" aria-label="Same pixels with animated swatch colors"></canvas></figure>
</div>
<div class="transport"><button type="button" id="play">Play</button><input id="scrub" type="range" min="0" max="239" value="18" step="1" aria-label="Sample frame"><time id="clock"></time>
 <label><input type="checkbox" id="show-indices"> Show indices</label></div>
<div class="bands">
 <section class="band"><h2>River</h2><p>Slots 5–9 · Forward · 2.5 s per turn</p><div id="water" class="swatches" aria-label="Current river palette"></div></section>
 <section class="band"><h2>Aurora</h2><p>Slots 10–13 · Reverse · 4 s per turn · ¼-turn phase</p><div id="sky" class="swatches" aria-label="Current aurora palette"></div></section>
</div>
</main>
<script>${ink.bundle().replace(/<\/script/gi, '<\\/script')}</script>
<script>
const P = KIT.procedural, w = 224, h = 120, fps = 12, count = 240;
const el = id => document.getElementById(id), indices = new Uint8Array(w * h);
const colors = ['#19263b', '#2a3451', '#423957', '#263953', '#214552', '#345c66', '#387780', '#58a19c',
  '#9adbc2', '#cef1c8', '#693964', '#965685', '#c882a0', '#f0b49e', '#f9e1ab', '#61475d', '#387780'];
const cycles = {
  water: { range: [5, 9], period: 2.5, direction: 'forward' },
  sky: { range: [10, 13], period: 4, direction: 'reverse', phase: .25 }
};
const mod = (n, size) => (n % size + size) % size;
for (let y = 0, p = 0; y < h; y++) for (let x = 0; x < w; x++, p++) {
  const ridge = 68 + 4 * Math.cos(x * .075) + 7 * Math.sin(x * .041 + .53);
  const riverX = 120 + Math.sin(y * .10) * (y - 51) * .44, riverWidth = Math.max(0, (y - 65) * 1.92);
  const cloud = (x * 83 + y * 47 + x * y * 9) % 101;
  let slot = y < 27 ? 0 : y < 46 ? 1 : 2;
  const arc = y - (22 + .13 * x + 11 * Math.sin(x * .045 + .4));
  const ribbon = y - (15 + .16 * x + 11 * Math.sin(x * .042 + 1.2));
  if (Math.abs(arc) < 5.8 && x > 10 && x < 182) slot = 10 + mod(Math.floor((arc + x * .065) / 2.7), 4);
  if (Math.abs(ribbon) < 1.7 && x > 22 && x < 154 && (x + y) % 5 !== 0) slot = 10 + mod(x >> 3, 4);
  if (cloud === 8 && y < 52) slot = 14;
  if (Math.hypot((x - 184) * .96, y - 30) < 13) slot = y > 27 && y % 4 === 0 ? 15 : 14;
  if (y >= ridge) slot = cloud % 19 < 4 ? 1 : 3;
  if (y > 72 && Math.abs(x - riverX) <= riverWidth) {
    const stripes = Math.floor(y * .71 + 3.1 * Math.sin(x * .056 + y * .095));
    slot = y % 4 === 0 && cloud < 43 ? 4 : 5 + mod(stripes, 5);
    if (x % 21 === 0 && y % 4 === 2 && cloud < 44) slot = 16;
  }
  if (y >= 82 && y <= 85 && x >= 29 && x <= 175) slot = y === 82 ? 16 : y === 83 ? 3 : 0;
  if (y > 80 && y < 95 && x % 26 < 2 && x > 37 && x < 175) slot = y === 81 ? 14 : 3;
  if (y >= 109 && (x < 20 + 2 * (y - 109) || x > 202 - 2 * (y - 109))) slot = cloud < 20 ? 16 : 0;
  indices[p] = slot;
}
const source = { width: w, height: h, channels: 1, data: indices };
const base = P.pixelEffects.paletteCycle(source, colors).value;
const mono = colors.map((_, i) => '#' + (21 + i * 13).toString(16).padStart(2, '0').repeat(3));
const indexView = P.pixelEffects.paletteCycle(source, mono).value;
const graph = P.graph.create({ inputs: { source: 'raster', cycles: 'record' },
  nodes: { frame: { op: 'fx.paletteCycle', inputs: { source: { input: 'source' }, palette: colors, cycles: { input: 'cycles' } } } },
  outputs: Object.fromEntries(['value', 'indices', 'palette'].map(port => [port, { node: 'frame', port }])) });
const toggles = [...document.querySelectorAll('[data-mode]')], show = el('show-indices'), play = el('play'), scrub = el('scrub');
const contexts = Object.fromEntries(['source', 'result'].map(id => [id, el(id).getContext('2d', { willReadFrequently: true })]));
let mode = 'both', frame = Number(scrub.value), playing = false, last, request;
function draw(id, raster) {
  const context = contexts[id], image = context.createImageData(w, h);
  image.data.set(raster.data); context.putImageData(image, 0, 0);
}
function swatches(id, palette) {
  const [first, end] = cycles[id].range;
  el(id).replaceChildren(...palette.slice(first, end + 1).map((color, index) => {
    const chip = document.createElement('span'), tint = document.createElement('i');
    tint.style.background = color; chip.title = color;
    chip.append(tint, String(index + first)); return chip;
  }));
}
function render() {
  const settings = mode === 'both' ? cycles : mode === 'none' ? {} : { [mode]: cycles[mode] };
  const { outputs } = graph.evaluate({ source, cycles: settings }, { time: frame / fps });
  draw('source', show.checked ? indexView : base); draw('result', outputs.value);
  swatches('water', outputs.palette); swatches('sky', outputs.palette);
  el('clock').textContent = (frame / fps).toFixed(2) + ' s';
  el('reference-label').textContent = show.checked ? 'PIXEL INDICES' : 'BASE PALETTE';
  el('active').textContent = ({ both: 'BOTH CYCLES', water: 'RIVER', sky: 'AURORA', none: 'CYCLES OFF' })[mode];
  Object.assign(el('result').dataset, { frame, mode });
}
function step(now) {
  if (!playing) return;
  last ??= now;
  const elapsed = Math.floor((now - last) * fps / 1000);
  if (elapsed > 0) {
    last += elapsed * 1000 / fps; frame = (frame + elapsed) % count; scrub.value = frame; render();
  }
  request = requestAnimationFrame(step);
}
function transport(on) {
  playing = on; last = undefined; play.textContent = on ? 'Pause' : 'Play';
  if (on) request = requestAnimationFrame(step); else cancelAnimationFrame(request);
}
play.addEventListener('click', () => transport(!playing));
scrub.addEventListener('input', () => { transport(false); frame = Number(scrub.value); render(); });
show.addEventListener('change', render);
toggles.forEach(button => button.addEventListener('click', () => {
  mode = button.dataset.mode;
  toggles.forEach(other => other.setAttribute('aria-pressed', other === button));
  render();
}));
render();
</script>
</html>`);
