const fs = require('node:fs');
const ink = require('..');

if (!process.argv[2]) throw new Error('Usage: node examples/texture-addressing.cjs <demo.html>');

fs.writeFileSync(process.argv[2], `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Helix Signal</title>
<style>
:root { color-scheme: dark; background: #151923; color: #f5e7d7; font-family: system-ui, sans-serif; }
* { box-sizing: border-box; }
body { margin: 0; padding: 30px 26px; }
main { max-width: 1162px; margin: auto; }
header { display: flex; justify-content: space-between; align-items: end; gap: 15px; margin-bottom: 20px; }
h1 { font: 500 clamp(45px, 7vw, 86px)/.88 Georgia, serif; margin: 4px 0 12px; letter-spacing: -.06em; }
p { margin: 0; color: #c7c7cf; font-size: 14px; line-height: 1.45; }
.mono, figcaption, button, time, label, ol { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; }
.mono { font-size: 11px; letter-spacing: .13em; color: #a8c9c5; }
nav { display: flex; gap: 7px; flex-wrap: wrap; }
button { cursor: pointer; background: #293340; border: 1px solid #586572; border-radius: 3px; color: #f0e4d7; padding: 8px 11px; }
button[aria-pressed="true"] { background: #55424b; border-color: #efa994; color: #ffe3ca; }
button:focus-visible, input:focus-visible { outline: 2px solid #efbd9e; outline-offset: 2px; }
.plates { display: grid; grid-template-columns: .75fr 1.25fr; gap: 12px; }
figure, .program, .brief { margin: 0; min-width: 0; border: 1px solid #566373; background: #242b3a; }
figcaption { display: flex; justify-content: space-between; align-items: center; gap: 7px; padding: 8px 11px; min-height: 34px;
 color: #dad8ce; border-bottom: 1px solid #566373; font-size: 11px; letter-spacing: .06em; }
figcaption span:last-child, time { color: #ecc7a6; }
canvas { width: 100%; height: 100%; display: block; image-rendering: pixelated; }
.tile, .view { aspect-ratio: 224 / 126; background: #121c29; }
.tile { aspect-ratio: auto; height: calc(100% - 34px); min-height: 180px; }
.transport { display: flex; align-items: center; gap: 12px; margin: 13px 0; }
#play { min-width: 65px; }
#scrub { flex: 1; width: 100%; min-width: 44px; }
input { accent-color: #e8a995; }
time { min-width: 54px; text-align: right; white-space: nowrap; font-size: 12px; }
label { display: flex; align-items: center; gap: 5px; color: #e1d4cb; font-size: 11px; }
.details { display: grid; grid-template-columns: 1.18fr .82fr; gap: 12px; }
.program, .brief { padding: 13px 15px; }
ol { display: flex; padding: 0; margin: 9px 0 12px; gap: 6px; flex-wrap: wrap; list-style: none; }
li { padding: 5px 8px; border: 1px solid #687787; background: #2c3747; color: #f4ddc7; font-size: 11px; }
h2 { margin: 0 0 7px; font: 500 26px/1 Georgia, serif; color: #f2dfc5; }
@media(max-width: 750px) {
 body { padding: 18px 12px; }
 header { align-items: start; flex-direction: column; gap: 12px; margin-bottom: 12px; }
 .plates, .details { grid-template-columns: 1fr; gap: 8px; }
 .tile { aspect-ratio: 160 / 112; height: auto; }
 figcaption { min-height: 29px; padding: 5px 7px; font-size: 10px; }
 .transport { gap: 7px; }
}
</style>
<main>
<header>
 <div><span class="mono">INK STUDIO / PROGRAMMABLE TEXTURE ADDRESSING</span><h1>Helix Signal</h1><p>Route pixels through a chain of coordinates, then sample one repeating tile.</p></div>
 <nav aria-label="Texture transform presets">
  <button type="button" data-mode="chain" aria-pressed="true">Full chain</button>
  <button type="button" data-mode="tunnel" aria-pressed="false">Tunnel</button>
  <button type="button" data-mode="affine" aria-pressed="false">Rotate &amp; zoom</button>
  <button type="button" data-mode="rows" aria-pressed="false">Scanlines</button>
 </nav>
</header>
<div class="plates">
 <figure><figcaption><span>SOURCE TILE</span><span>U × V</span></figcaption><div class="tile"><canvas id="source" width="160" height="112" aria-label="Repeating pixel-art texture tile"></canvas></div></figure>
 <figure><figcaption><span id="output-label">ADDRESSED OUTPUT</span><span id="mode-label"></span></figcaption><div class="view"><canvas id="result" width="224" height="126" aria-label="Result of sampling the texture through the current UV field"></canvas></div></figure>
</div>
<div class="transport">
 <button type="button" id="play">Play</button><input id="scrub" type="range" min="0" max="95" value="11" step="1" aria-label="Sample frame"><time id="clock"></time>
 <label><input id="uv" type="checkbox"> Show UVs</label>
</div>
<div class="details">
 <section class="program"><span class="mono">PULL ORDER</span><ol id="stages"></ol>
 <label><input id="after-rotation" type="checkbox"> Apply scanlines after rotation</label></section>
 <section class="brief"><h2 id="mode-title"></h2><p id="copy"></p></section>
</div>
</main>
<script>${ink.bundle().replace(/<\/script/gi, '<\\/script')}</script>
<script>
const P = KIT.procedural, sourceW = 160, sourceH = 112, w = 224, h = 126, fps = 12, count = 96;
const el = id => document.getElementById(id), W = P.rasterWarp;
const colors = ['#151e31', '#213049', '#2d435b', '#354c64', '#39717b', '#64aba4',
  '#9bd5af', '#4f3c61', '#75536f', '#ac677c', '#d39276', '#f2c98d', '#f8e5b9'];
const data = new Uint8Array(sourceW * sourceH * 4);
const rgb = colors.map(hex => hex.slice(1).match(/../g).map(pair => parseInt(pair, 16)));
for (let y = 0, p = 0; y < sourceH; y++) for (let x = 0; x < sourceW; x++, p++) {
  const row = Math.floor(y / 16), u = (x + 16 * (row % 2)) % 32, v = y % 16;
  const noise = (x * 67 + y * 49 + x * y * 9) % 97;
  const warm = row % 3 === 1 || Math.floor(x / 40) % 2 === 0 && row % 4 === 3;
  let slot = v < 3 ? 1 : v === 3 ? 0 : v < 11 ? warm ? 7 : 2 : warm ? 8 : 3;
  if (u < 2 || v === 15) slot = 0;
  if (v === 1 && u > 2) slot = warm ? 10 : 5;
  if (v === 14 && u % 3 < 2) slot = warm ? 9 : 4;
  if (u > 5 && u < 9 && v > 5 && v < 10) slot = warm ? 11 : 6;
  if (u > 11 && u < 26 && v > 5 && v < 11 && (u + v) % 5 < 2) slot = warm ? 9 : 4;
  if (u > 25 && v >= 10 && v <= 12) slot = warm ? 10 : 5;
  if (noise === 12 && v > 3 && u > 2) slot = 12;
  data.set(rgb[slot], p * 4); data[p * 4 + 3] = 255;
}
const source = { width: sourceW, height: sourceH, channels: 4, data };
const graph = P.graph.create({ inputs: { transforms: 'array<record>', tile: 'raster' }, nodes: {
  uv: { op: 'warp.address', inputs: { width: w, height: h, transforms: { input: 'transforms' } } },
  finish: { op: 'warp.sample', inputs: { source: { input: 'tile' }, field: { node: 'uv' },
    options: { filter: 'nearest', edge: 'wrap' } } }
}, outputs: { image: { node: 'finish' }, uv: { node: 'uv' } } });
const modes = {
  chain: ['FULL CHAIN', 'One texture lookup', 'Row writes shift selected rays. Rotation and zoom turn the field before it reads the tunnel wall.'],
  tunnel: ['POLAR TUNNEL', 'Angle and reciprocal depth', 'Angle runs across the tile. Depth repeats along it, compressing the pattern toward the center.'],
  affine: ['ROTATE + ZOOM', 'Turn and magnify', 'Rotate about the frame center, then magnify the texture. Its edges repeat on both axes.'],
  rows: ['ROW ADDRESSING', 'Shift the read address', 'Whole bands read from different coordinates. Two bands also repeat pixels across larger sampling blocks.']
};
const names = { rows: 'Row writes', rotate: 'Rotate', zoom: 'Zoom', tunnel: 'Polar tunnel' };
const rotate = { type: 'rotate', turns: -.04, rate: .085 }, tunnel = { type: 'tunnel', depth: .27, inner: .045,
  turns: .04, spinRate: -.036, travelRate: .39 };
const rows = { type: 'rows', schedule: [
  { row: 27, offset: [-12, 1], pixelScale: [2, 1] }, { row: 43, offset: [0, 0], pixelScale: [1, 1] },
  { row: 71, offset: [16, 1], pixelScale: [3, 2] }, { row: 95, offset: [-5, 0], pixelScale: [1, 1] },
  { row: 111, offset: [0, 0] }
] };
const show = el('uv'), reorder = el('after-rotation'), play = el('play'), scrub = el('scrub');
const buttons = [...document.querySelectorAll('[data-mode]')];
const context = Object.fromEntries(['source', 'result'].map(id => [id, el(id).getContext('2d', { willReadFrequently: true })]));
let mode = 'chain', frame = Number(scrub.value), playing = false, last, request;
function draw(id, raster) {
  const at = context[id], image = at.createImageData(raster.width, raster.height);
  image.data.set(raster.data); at.putImageData(image, 0, 0);
}
function diagnostic(uv) {
  const pixels = new Uint8Array(w * h * 4);
  for (let i = 0, j = 0; i < uv.data.length; i += 3, j += 4) {
    const u = uv.data[i], v = uv.data[i + 1], a = uv.data[i + 2];
    pixels.set([a * (34 + 199 * (u - Math.floor(u))), a * (38 + 145 * (v - Math.floor(v))), a * 130, 255], j);
  }
  return { width: w, height: h, channels: 4, data: pixels };
}
function render() {
  const time = frame / fps, zoom = { type: 'zoom', scale: 1.24 + .17 * Math.sin(time * 1.4) };
  const transforms = mode === 'chain' ? [...(reorder.checked ? [rotate, rows] : [rows, rotate]), zoom, tunnel] :
    mode === 'tunnel' ? [tunnel] : mode === 'affine' ? [rotate, zoom] : [rows];
  const { outputs } = graph.evaluate({ tile: source, transforms }, { time });
  draw('result', show.checked ? diagnostic(outputs.uv) : outputs.image);
  Object.assign(el('result').dataset, { frame, mode, order: transforms.map(step => step.type).join(',') });
  const [label, title, description] = modes[mode];
  el('mode-label').textContent = label; el('mode-title').textContent = title; el('copy').textContent = description;
  el('clock').textContent = time.toFixed(2) + ' s';
  el('output-label').textContent = show.checked ? 'UV FIELD' : 'ADDRESSED OUTPUT';
  reorder.disabled = mode !== 'chain';
  el('stages').replaceChildren(...[...transforms.map(step => names[step.type]), 'Sample tile'].map(label => {
    const li = document.createElement('li'); li.textContent = label; return li;
  }));
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
show.addEventListener('change', render);
reorder.addEventListener('change', render);
buttons.forEach(button => button.addEventListener('click', () => {
  mode = button.dataset.mode;
  buttons.forEach(other => other.setAttribute('aria-pressed', other === button));
  render();
}));
draw('source', source); render();
</script>
</html>`);
