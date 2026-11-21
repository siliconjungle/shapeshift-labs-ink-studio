const fs = require('node:fs');
const ink = require('..');

if (!process.argv[2]) throw new Error('Usage: node examples/indexed-plasma.cjs <demo.html>');

fs.writeFileSync(process.argv[2], `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Phase Garden</title>
<style>
:root { color-scheme: dark; background: #171823; color: #f5e7d4; font-family: system-ui, sans-serif; }
* { box-sizing: border-box; }
body { margin: 0; padding: 29px 26px; }
main { max-width: 1160px; margin: auto; }
header { display: flex; justify-content: space-between; align-items: end; gap: 15px; margin-bottom: 19px; }
h1 { margin: 5px 0 11px; font: 500 clamp(45px,7vw,86px)/.88 Georgia,serif; letter-spacing: -.059em; }
p { margin: 0; color: #ccc4c5; font-size: 14px; line-height: 1.46; }
.mono, nav, button, figcaption, time, label, output, select { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; }
.mono { color: #deb3c7; letter-spacing: .13em; font-size: 11px; }
nav { display: flex; flex-wrap: wrap; gap: 7px; }
button, select { padding: 8px 11px; border: 1px solid #63596b; border-radius: 3px; background: #2a2838; color: #eee5dc; }
button { cursor: pointer; }
button[aria-pressed="true"] { background: #4d3549; border-color: #e7a5ab; color: #ffe3cf; }
button:focus-visible, input:focus-visible, select:focus-visible { outline: 2px solid #ecb0a8; outline-offset: 2px; }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
figure, .spec { min-width: 0; margin: 0; border: 1px solid #5e5467; background: #262637; }
figcaption { display: flex; justify-content: space-between; align-items: center; padding: 8px 11px; min-height: 34px; gap: 6px;
 border-bottom: 1px solid #5e5467; color: #e1d7d6; font-size: 11px; letter-spacing: .06em; }
figcaption span:last-child, time, output { color: #fac4a2; }
canvas { display: block; width: 100%; aspect-ratio: 232 / 134; image-rendering: pixelated; }
.ramp { display: flex; height: 14px; border-top: 1px solid #705b63; }
.ramp span { flex: 1; }
.transport { display: flex; align-items: center; gap: 11px; margin: 13px 0; }
#play { min-width: 65px; }
#scrub { flex: 1; min-width: 44px; width: 100%; }
input { accent-color: #e7a0ad; }
time { min-width: 58px; text-align: right; font-size: 12px; white-space: nowrap; }
label, output { color: #e2d5db; font-size: 11px; }
label { display: flex; align-items: center; gap: 7px; }
.controls { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.spec { padding: 12px 15px; }
.spec h2 { font: 500 26px/1 Georgia,serif; margin: 0 0 6px; }
.settings { display: flex; flex-wrap: wrap; align-items: center; gap: 9px 15px; margin-top: 10px; }
#speed { width: 126px; }
@media(max-width: 730px) {
 body { padding: 18px 12px; }
 header { align-items: start; flex-direction: column; gap: 11px; margin-bottom: 12px; }
 .grid, .controls { grid-template-columns: 1fr; gap: 8px; }
 figcaption { min-height: 29px; padding: 5px 7px; font-size: 10px; }
 .transport { gap: 7px; }
}
</style>
<main>
<header>
 <div><span class="mono">INK STUDIO / PALETTE-INDEXED PLASMA</span><h1>Phase Garden</h1><p>Oscillating fields set the shapes. Two color ramps draw the same index grid.</p></div>
 <nav aria-label="Geometry">
  <button type="button" data-mode="interference" aria-pressed="true">Interference</button>
  <button type="button" data-mode="rings" aria-pressed="false">Ripple basin</button>
  <button type="button" data-mode="spiral" aria-pressed="false">Spiral fold</button>
 </nav>
</header>
<div class="grid">
 <figure><figcaption><span id="primary-label">EMBER</span><span>PLASMA</span></figcaption>
  <canvas id="primary" width="232" height="134" aria-label="Indexed plasma in the selected primary palette"></canvas>
  <div id="ramp-a" class="ramp" aria-label="Primary palette"></div></figure>
 <figure><figcaption><span id="secondary-label">ESTUARY</span><span id="shared">SAME INDEX GRID</span></figcaption>
  <canvas id="secondary" width="232" height="134" aria-label="Same plasma shown in a second palette or as a diagnostic"></canvas>
  <div id="ramp-b" class="ramp" aria-label="Comparison palette"></div></figure>
</div>
<div class="transport"><button type="button" id="play">Play</button><input id="scrub" type="range" min="0" max="95" value="17" step="1" aria-label="Animation frame"><time id="clock"></time></div>
<div class="controls">
 <section class="spec"><h2 id="title"></h2><p id="copy"></p></section>
 <section class="spec"><span class="mono">COLOR AND MOTION</span><div class="settings">
  <label for="palette">Palette <select id="palette"><option value="ember">Ember</option><option value="orchid">Orchid</option><option value="estuary">Estuary</option></select></label>
  <label for="speed">Speed <input type="range" id="speed" min="0" max="200" step="10" value="100"> <output id="speed-label" for="speed"></output></label>
  <label for="view">Compare <select id="view"><option value="estuary">Estuary</option><option value="indices">Index grid</option><option value="field">Scalar field</option></select></label>
 </div></section>
</div>
</main>
<script>${ink.bundle().replace(/<\/script/gi, '<\\/script')}</script>
<script>
const P = KIT.procedural, w = 232, h = 134, fps = 12, count = 96;
const el = id => document.getElementById(id), pal = el('palette'), speed = el('speed'), comparison = el('view');
const palettes = {
  ember: ['#201b36','#2b2147','#3b2a57','#4a305e','#5c3865','#71416b','#894973','#a05175','#b85d79','#cb6c7c',
    '#dd7d82','#e68e8a','#eda093','#f2b29a','#f4c3a3','#f5d0a5','#f7ddad','#f9e6b6','#fbefc1','#fff5d5'],
  estuary: ['#122436','#183448','#204457','#255362','#2c626d','#357177','#407f81','#4b8e8b','#589e95','#68ad9e',
    '#77bba7','#84c8af','#95d4b7','#a7ddbd','#b4e4c0','#c3ecc3','#d0efc8','#def3d4','#e8f4df','#f6f9eb'],
  orchid: ['#1b182d','#25213e','#322952','#453363','#573d77','#6a4989','#7d579b','#9363aa','#a971b4','#bd81bb',
    '#ce8dc0','#da9ac3','#e4a8c6','#eab7cc','#e4c6cf','#d7d6d2','#c7e3d3','#d7eedb','#e4f3e4','#f4faf0']
};
const shades = palettes.ember.map((_, i, colors) => '#' + Math.round(18 + 228 * i / (colors.length - 1)).toString(16).repeat(3));
const presets = {
  interference: {
    title: 'Interference', copy: 'A ring, a two-arm spiral, and two plane waves sweep through each other.',
    geometry: [{ id: 'ring', type: 'radial', center: [.34,.48], frequency: 2.7, weight: 1.1 },
      { id: 'curl', type: 'spiral', center: [.64,.47], frequency: 1.9, arms: 2, weight: .9 },
      { id: 'light', type: 'plane', frequency: 2.2, angle: .08, weight: .65 },
      { id: 'fold', type: 'plane', frequency: 1.15, angle: .36, weight: -.5 }],
    motion: { ring: { rate: .19 }, curl: { rate: -.36, phase: .13, velocity: [.022,-.036] },
      light: { rate: .24, phase: .12 }, fold: { rate: -.16, phase: -.15 } }
  },
  rings: {
    title: 'Ripple basin', copy: 'Three radial waves move at different rates as their centers drift.',
    geometry: [{ id: 'west', type: 'radial', center: [.28,.36], frequency: 3.6 },
      { id: 'east', type: 'radial', center: [.66,.56], frequency: 2.55, weight: .88 },
      { id: 'low', type: 'radial', center: [.42,.80], frequency: 1.65, weight: .55, wave: 'triangle' }],
    motion: { west: { rate: .21, velocity: [.035,.014] }, east: { rate: -.32, phase: .25 }, low: { rate: .14, phase: .35 } }
  },
  spiral: {
    title: 'Spiral fold', copy: 'Two opposed spiral fields fold around a diagonal plane wave.',
    geometry: [{ id: 'near', type: 'spiral', center: [.43,.62], frequency: 1.7, arms: 3, weight: 1.2 },
      { id: 'far', type: 'spiral', center: [.62,.37], frequency: 2.1, arms: -2, weight: .6 },
      { id: 'line', type: 'plane', frequency: 1.55, angle: .39, weight: .73, wave: 'triangle' }],
    motion: { near: { rate: -.35 }, far: { rate: .32, phase: .28 }, line: { rate: .22, phase: .12 } }
  }
};
const node = (id, port) => ({ node: id, ...(port && { port }) });
const graph = P.graph.create({ inputs: { geometry: 'array<record>', motion: 'record', warm: 'palette', cool: 'palette' }, nodes: {
  plasma: { op: 'proc.plasma', inputs: { geometry: { input: 'geometry' }, motion: { input: 'motion' },
    palette: { input: 'warm' }, options: { width: w, height: h, range: [-.68,.68] } } },
  color: { op: 'fx.paletteCycle', inputs: { source: node('plasma','indices'), palette: { input: 'cool' } } }
}, outputs: { primary: node('plasma'), secondary: node('color'), field: node('plasma','field'), indices: node('plasma','indices') } });
const play = el('play'), scrub = el('scrub'), buttons = [...document.querySelectorAll('[data-mode]')];
const contexts = Object.fromEntries(['primary','secondary'].map(id => [id, el(id).getContext('2d', { willReadFrequently: true })]));
let mode = 'interference', frame = Number(scrub.value), playing = false, last, request;
function draw(id, raster) {
  const context = contexts[id], image = context.createImageData(w, h);
  image.data.set(raster.data); context.putImageData(image, 0, 0);
}
function ramp(id, colors) {
  el(id).replaceChildren(...colors.map(color => {
    const chip = document.createElement('span'); chip.style.background = color; return chip;
  }));
}
function render() {
  const time = frame / fps * Number(speed.value) / 100, { title, copy, geometry, motion } = presets[mode];
  const main = pal.value, view = comparison.value, fieldMode = view === 'field';
  const { outputs } = graph.evaluate({ geometry, motion, warm: palettes[main], cool: palettes[view] ?? shades }, { time });
  draw('primary', outputs.primary);
  if (fieldMode) {
    const values = Uint8Array.from(outputs.field.data, n => Math.round((n + 1) * 127.5));
    draw('secondary', P.raster.rgba({ width: w, height: h, channels: 1, data: values }));
  } else draw('secondary', outputs.secondary);
  ramp('ramp-a', palettes[main]); ramp('ramp-b', palettes[view] ?? shades);
  el('primary-label').textContent = main.toUpperCase();
  el('secondary-label').textContent = fieldMode ? 'SCALAR FIELD' : view === 'indices' ? 'INDEX GRID' : 'ESTUARY';
  el('shared').textContent = fieldMode ? 'BEFORE QUANTIZATION' : 'SAME INDEX GRID';
  el('title').textContent = title; el('copy').textContent = copy;
  el('clock').textContent = time.toFixed(2) + ' s';
  el('speed-label').textContent = speed.value + '%';
  let slots = 0;
  for (const index of outputs.indices.data) slots = Math.imul(slots ^ index, 16777619);
  Object.assign(el('primary').dataset, { frame, mode, slots, view });
}
function step(now) {
  if (!playing) return;
  last ??= now;
  const elapsed = Math.floor((now - last) * fps / 1000);
  if (elapsed > 0) { last += elapsed * 1000 / fps; frame = (frame + elapsed) % count; scrub.value = frame; render(); }
  request = requestAnimationFrame(step);
}
function transport(on) {
  playing = on; last = undefined; play.textContent = on ? 'Pause' : 'Play';
  if (on) request = requestAnimationFrame(step); else cancelAnimationFrame(request);
}
play.addEventListener('click', () => transport(!playing));
scrub.addEventListener('input', () => { transport(false); frame = Number(scrub.value); render(); });
speed.addEventListener('input', render);
pal.addEventListener('change', render);
comparison.addEventListener('change', render);
buttons.forEach(button => button.addEventListener('click', () => {
  mode = button.dataset.mode;
  buttons.forEach(other => other.setAttribute('aria-pressed', other === button));
  render();
}));
render();
</script>
</html>`);
