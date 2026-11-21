const fs = require('node:fs');
const ink = require('..');

if (!process.argv[2]) throw new Error('Usage: node examples/scanline-deformation.cjs <demo.html>');

fs.writeFileSync(process.argv[2], `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Registration Drift</title>
<style>
:root { color-scheme: dark; background: #11181c; color: #f6ead7; font-family: system-ui, sans-serif; }
* { box-sizing: border-box; }
body { margin: 0; padding: 42px 24px; }
main { max-width: 1160px; margin: auto; }
header { display: flex; justify-content: space-between; align-items: end; margin-bottom: 27px; gap: 14px; }
h1 { margin: 7px 0 13px; font: 500 clamp(45px,8vw,90px)/.9 Georgia,serif; letter-spacing: -.065em; }
p { margin: 0; color: #b7c7c4; line-height: 1.5; font-size: 14px; }
.mono, nav, button, output, figcaption, time, label { font-family: ui-monospace,SFMono-Regular,Consolas,monospace; }
.mono { font-size: 11px; letter-spacing: .15em; color: #eeb77c; }
nav { display: flex; gap: 7px; }
button { cursor: pointer; padding: 9px 14px; border: 1px solid #536d6e; border-radius: 2px; background: #1e3036; color: #f6ead7; }
button[aria-pressed="true"] { background: #d9efdf; color: #183137; border-color: #d9efdf; }
button:focus-visible, input:focus-visible { outline: 2px solid #f5bb7e; outline-offset: 3px; }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 13px; }
figure { margin: 0; min-width: 0; border: 1px solid #496365; background: #1d3035; }
figcaption { display: flex; justify-content: space-between; align-items: center; gap: 7px; padding: 11px 13px;
 border-bottom: 1px solid #496365; font-size: 11px; letter-spacing: .08em; }
figcaption output { color: #f7c084; }
canvas { display: block; width: 100%; aspect-ratio: 238 / 124; image-rendering: pixelated; }
.transport { display: flex; align-items: center; gap: 13px; margin: 14px 0 18px; }
#play { min-width: 73px; }
#scrub { flex: 1; min-width: 38px; accent-color: #eeb77c; }
time { min-width: 56px; text-align: right; font-size: 12px; color: #f0cba3; }
.info { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 20px; padding: 15px 0; border-top: 1px solid #496365; }
h2 { font: 500 25px/1 Georgia,serif; margin: 0 0 8px; }
.settings { display: flex; flex-wrap: wrap; align-items: center; gap: 14px; font-size: 12px; }
.settings label { white-space: nowrap; display: flex; align-items: center; gap: 6px; }
.settings input { accent-color: #eeb77c; }
.legend { display: flex; flex-wrap: wrap; gap: 14px; font-size: 11px; color: #b7c7c4; }
.legend span::before { content: ''; display: inline-block; width: 7px; height: 7px; border: 1px solid #f7c084; margin-right: 6px; }
.legend span:last-child::before { border-color: #81e6dc; }
@media(max-width: 730px) {
  body { padding: 24px 13px; }
  header { align-items: start; flex-direction: column; margin-bottom: 15px; }
  .grid { grid-template-columns: 1fr; gap: 9px; }
  figcaption { padding: 8px 10px; }
}
</style>
<main>
<header>
  <div><div class="mono">INK STUDIO / SCANLINE DEFORMATION</div>
    <h1>Registration Drift</h1>
    <p>Warp a raster row by row and keep its layout anchors available for placement.</p>
  </div>
  <nav aria-label="Asset">
    <button data-mode="type" aria-pressed="true">Bitmap text</button>
    <button data-mode="sprite" aria-pressed="false">Sprite</button>
  </nav>
</header>
<div class="grid">
  <figure><figcaption>AUTHORED <output id="base-position"></output></figcaption>
    <canvas id="base" width="238" height="124" aria-label="Authored raster and registration marks"></canvas></figure>
  <figure><figcaption>DEFORMED <output id="warp-position"></output></figcaption>
    <canvas id="warped" width="238" height="124" aria-label="Scanline-deformed raster and relocated registration marks"></canvas></figure>
</div>
<div class="transport">
  <button id="play">Play</button>
  <input id="scrub" aria-label="Frame" type="range" min="0" max="59" value="11">
  <time id="clock"></time>
</div>
<section class="info">
  <div><h2 id="asset-title"></h2><p id="asset-copy"></p></div>
  <div class="settings">
    <label><input id="pin" type="checkbox" checked> Pin pivot</label>
    <label><input id="marks" type="checkbox" checked> Show anchors</label>
    <div class="legend mono"><span>Pivot</span><span id="anchor-key"></span></div>
  </div>
</section>
</main>
<script>${ink.bundle().replace(/<\/script/gi, '<\\/script')}</script>
<script>
const { drawing2d: D, raster: R, rasterWarp: W } = KIT.procedural;
const el = id => document.getElementById(id);
const width = 198, height = 104, padding = [20, 10, 20, 10], fps = 15;
const plate = document.createElement('canvas');
plate.width = 238;
plate.height = 124;
const context = plate.getContext('2d');
context.fillStyle = '#14252d';
context.fillRect(0, 0, plate.width, plate.height);
for (let y = 0; y < plate.height; y += 2) {
  context.fillStyle = y % 8 ? '#162831' : '#192d36';
  context.fillRect(0, y, plate.width, 1);
}
for (let y = 10; y < plate.height; y += 8) for (let x = 12; x < plate.width; x += 8) {
  context.fillStyle = (x + y) % 24 === 6 ? '#2c4850' : '#243b45';
  context.fillRect(x, y, 1, 1);
}
context.strokeStyle = '#36535c';
context.strokeRect(10.5, 8.5, 217, 107);
for (let y = 14; y < 116; y += 4) {
  context.fillStyle = y % 16 === 14 ? '#607275' : '#3a565e';
  context.fillRect(9, y, y % 16 === 14 ? 4 : 2, 1);
  context.fillRect(226, y, y % 16 === 14 ? 4 : 2, 1);
}

function makeType() {
  const main = D.text('AVALON', { scale: 4, tracking: 3, kerning: { AV: -4, VA: -3, AL: -2 }, color: '#ffe5ac' });
  const sub = D.text('CHANNEL 04', { scale: 2, tracking: 1, color: '#6cd8ca' });
  const place = (line, x, y) => ({ source: line.value, x, y });
  const tx = 20, ty = 21, sx = 32, sy = 68;
  const source = R.stack({ width, height, layers: [place(main, tx, ty), place(sub, sx, sy)] }).value;
  const at = ([x, y], dx, dy) => [x + dx, y + dy];
  const pivot = at(main.anchors['line:0'], tx, ty);
  const anchors = Object.fromEntries(Object.entries(main.anchors)
    .filter(([name]) => name.startsWith('glyph:'))
    .map(([name, point]) => [name, at(point, tx, ty)]));
  anchors.subtitle = at(sub.anchors['line:0'], sx, sy);
  return { source, pivot, anchors, title: 'Avalon / bitmap lettering', legend: 'Baseline anchors',
    copy: 'Pair spacing sets the glyph positions. Cyan marks follow the two deformed baselines.' };
}

function makeSprite() {
  const rect = (x, y, w, h, fill) => ({ type: 'rect', rect: [x,y,w,h], fill });
  const poly = (fill, points) => ({ type: 'polygon', fill, points });
  const shade = '#0e1421', hull = '#71909d', steel = '#b3c6bd', white = '#f4e7bf',
    gold = '#ffbd70', rust = '#b65a48', glass = '#408d97', light = '#83f1d9';
  const commands = [
    poly(shade, [[66,46],[63,26],[80,22],[94,40],[124,37],[148,24],[171,23],[178,31],[161,53],
      [176,63],[175,80],[155,83],[136,70],[95,75],[81,89],[61,88],[61,68],[39,65],[28,59],[30,51],[46,47]]),
    poly(hull, [[91,46],[80,27],[69,31],[72,57],[122,54],[159,33],[170,28],[149,28],[123,41]]),
    poly(steel, [[147,31],[168,29],[149,45],[130,46]]),
    rect(146,30,12,2,white), rect(159,29,9,2,gold), rect(71,31,4,13,rust),
    poly(hull, [[98,61],[151,61],[173,66],[170,77],[156,78],[138,67],[84,70],[78,84],[66,85],[65,71]]),
    poly(glass, [[143,65],[165,65],[170,67],[168,73],[156,74]]),
    rect(160,68,7,2,light), rect(69,77,8,4,rust),
    poly(hull, [[34,53],[58,48],[68,43],[100,42],[116,46],[146,45],[153,51],[145,61],[106,67],[56,66],[37,61],[32,58]]),
    poly(steel, [[35,54],[57,51],[70,46],[100,45],[112,47],[140,47],[147,51],[128,54],[77,55],[57,59],[36,57]]),
    poly(white, [[35,54],[60,50],[72,46],[96,46],[99,48],[77,50],[61,54],[38,56]]),
    poly(glass, [[63,52],[75,46],[89,45],[91,49],[84,53]]),
    rect(75,47,13,2,light), rect(64,54,22,2,glass), rect(96,47,5,10,rust), rect(97,46,3,6,gold),
    rect(51,59,23,2,'#435b71'), rect(76,59,4,2,'#344b61'), rect(82,58,4,2,'#344b61'),
    rect(114,55,26,3,'#45566b'), rect(116,55,3,2,light), rect(121,55,3,2,light),
    rect(145,49,8,10,rust), rect(147,51,9,5,gold), rect(151,52,10,2,white),
    rect(163,52,4,2,gold), rect(170,52,3,1,rust), rect(81,40,2,7,hull), rect(80,37,4,3,gold)
  ];
  const pivot = [99, 56], anchors = { beacon: [82,38], wing: [164,30], exhaust: [152,54], skid: [72,82] };
  const source = { ...D.render({ width, height, edges: 'hard', commands }), pivot };
  return { source, pivot, anchors, title: 'Survey craft / registered sprite', legend: 'Sprite sockets',
    copy: 'The beacon, wing, exhaust, and skid sockets travel with the sprite pixels.' };
}

const assets = { type: makeType(), sprite: makeSprite() };
for (const asset of Object.values(assets)) {
  asset.reference = W.scanlines(asset.source, { anchors: asset.anchors, pivot: asset.pivot, padding });
}
const rows = [{ row: 0, offset: [2,0] }, { row: 32, offset: [8,-1], scale: 1.02 },
  { row: 52, offset: [-1,2], scale: .96 }, { row: 79, offset: [5,6], scale: 1.03 },
  { row: 104, offset: [0,4] }];
const buffer = document.createElement('canvas');
buffer.width = plate.width;
buffer.height = plate.height;
const pixels = buffer.getContext('2d');

function paint(id, result) {
  const canvas = el(id), ctx = canvas.getContext('2d'), value = result.value;
  pixels.putImageData(new ImageData(new Uint8ClampedArray(value.data), value.width, value.height), 0, 0);
  ctx.drawImage(plate, 0, 0);
  ctx.drawImage(buffer, 0, 0);
  const [x, y] = value.pivot;
  canvas.dataset.pivot = value.pivot.map(n => n.toFixed(2)).join(',');
  if (!el('marks').checked) return;
  ctx.strokeStyle = '#80e5db';
  ctx.fillStyle = '#80e5db';
  for (const [ax, ay] of Object.values(result.anchors)) {
    const u = Math.round(ax), v = Math.round(ay);
    ctx.strokeRect(u - 1.5, v - 1.5, 3, 3);
  }
  const px = Math.round(x), py = Math.round(y);
  ctx.strokeStyle = '#ffc183';
  ctx.strokeRect(px - 3.5, py - 3.5, 7, 7);
  ctx.fillStyle = '#ffc183';
  ctx.fillRect(px - 6, py, 3, 1);
  ctx.fillRect(px + 4, py, 3, 1);
}

let mode = 'type', frame = 11, timer;
function render() {
  const asset = assets[mode], pin = el('pin').checked, time = frame / fps;
  const result = W.scanlines(asset.source, { rows, anchors: asset.anchors, pivot: asset.pivot, pin, padding, time,
    wave: { amplitude: 10, period: 26, rate: .5, phase: .09 }, horizontal: 'linear' });
  paint('base', asset.reference);
  paint('warped', result);
  el('base-position').textContent = 'PIVOT ' + asset.reference.value.pivot.join(', ');
  el('warp-position').textContent = (pin ? 'PINNED ' : 'FOLLOWING ') + result.value.pivot.map(n => +n.toFixed(1)).join(', ');
  el('asset-title').textContent = asset.title;
  el('asset-copy').textContent = asset.copy;
  el('anchor-key').textContent = asset.legend;
  el('scrub').value = frame;
  el('clock').textContent = time.toFixed(2) + ' s';
  Object.assign(el('warped').dataset, { mode, frame });
}
for (const button of document.querySelectorAll('[data-mode]')) button.addEventListener('click', () => {
  mode = button.dataset.mode;
  for (const item of document.querySelectorAll('nav button')) item.setAttribute('aria-pressed', item === button);
  render();
});
for (const control of ['pin', 'marks']) el(control).addEventListener('change', render);
el('scrub').addEventListener('input', event => { frame = Number(event.target.value); render(); });
el('play').addEventListener('click', () => {
  if (timer) {
    clearInterval(timer);
    timer = null;
  } else timer = setInterval(() => { frame = (frame + 1) % 60; render(); }, 1000 / fps);
  el('play').textContent = timer ? 'Pause' : 'Play';
});
render();
</script>
</html>`);
