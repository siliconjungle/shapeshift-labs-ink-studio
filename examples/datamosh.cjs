const fs = require('node:fs');
const ink = require('..');

if (!process.argv[2]) throw new Error('Usage: node examples/datamosh.cjs <demo.html>');

fs.writeFileSync(process.argv[2], `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Crosswind decoder</title>
<style>
:root { color-scheme: dark; font-family: system-ui, sans-serif; background: #111621; color: #ede7dc; }
* { box-sizing: border-box; }
body { margin: 0; padding: 28px 28px 22px; }
main { max-width: 1152px; margin: auto; }
header { display: flex; justify-content: space-between; align-items: end; gap: 14px; margin-bottom: 19px; }
h1 { margin: 4px 0 9px; font: 500 clamp(40px, 6vw, 76px)/.9 Georgia, serif; letter-spacing: -.055em; }
p { margin: 0; color: #b4bfd0; font-size: 14px; }
.mono, button, figcaption, label, output { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; }
.mono { color: #edac82; font-size: 11px; letter-spacing: .13em; }
nav { display: flex; gap: 7px; flex-wrap: wrap; justify-content: end; }
button { padding: 8px 11px; background: #25334a; border: 1px solid #49627b; color: #e7edf3; border-radius: 3px; cursor: pointer; }
button[aria-pressed="true"] { background: #394258; border-color: #d7a777; color: #ffdcaa; }
button:focus-visible, input:focus-visible { outline: 2px solid #e8bd95; outline-offset: 3px; }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
figure { min-width: 0; margin: 0; border: 1px solid #364b63; background: #171f30; }
figcaption { display: flex; align-items: center; justify-content: space-between; gap: 8px;
  min-height: 34px; padding: 8px 11px; border-bottom: 1px solid #364b63; color: #b7c9dd; font-size: 11px; letter-spacing: .06em; }
figcaption span:last-child { color: #ecc6a0; text-align: right; }
canvas { display: block; width: 100%; aspect-ratio: 192 / 96; image-rendering: pixelated; }
.aux canvas { aspect-ratio: 192 / 51; }
.transport { display: flex; align-items: center; gap: 12px; padding: 13px 0; }
#play { min-width: 66px; }
#scrub { flex: 1; width: 100%; min-width: 44px; }
input { accent-color: #e3ab7e; }
label { display: flex; align-items: center; gap: 6px; font-size: 11px; color: #b7c9dd; white-space: nowrap; }
#life { width: 92px; }
output { min-width: 42px; font-size: 11px; color: #f1cfaa; }
@media(max-width: 640px) {
  body { padding: 18px 12px; }
  header { align-items: start; flex-direction: column; gap: 12px; }
  nav { justify-content: start; }
  .grid { gap: 7px; }
  figcaption { font-size: 9px; padding: 7px; }
  .transport { gap: 6px; }
  #life { width: 46px; }
}
</style>
<main>
<header>
  <div><span class="mono">INK STUDIO / MOTION-VECTOR DATAMOSH</span><h1>Crosswind decoder</h1><p>Signed motion carries the warm plate into the blue feed.</p></div>
  <nav aria-label="Refresh mode">
    <button id="drift" type="button" aria-pressed="true">Retain across frame</button>
    <button id="refresh" type="button" aria-pressed="false">Refresh bands</button>
  </nav>
</header>
<div class="grid">
  <figure><figcaption><span>CURRENT FRAME</span><span id="source-label"></span></figcaption>
    <canvas id="source" width="192" height="96" aria-label="Clean source frame"></canvas></figure>
  <figure><figcaption><span>DATAMOSH</span><span id="time"></span></figcaption>
    <canvas id="mosh" width="192" height="96" aria-label="Previous image carried along signed motion"></canvas></figure>
</div>
<div class="transport">
  <button id="play" type="button">Play</button>
  <input id="scrub" aria-label="Source frame" type="range" min="0" max="47" value="20" step="1">
  <label>Half-life <input id="life" aria-label="Half-life in seconds" type="range" min=".1" max="4" step=".1" value="2.4"></label>
  <output id="life-text" for="life"></output>
</div>
<div class="grid aux">
  <figure><figcaption><span>SIGNED MOTION VECTORS</span><span>XY PIXELS PER FRAME</span></figcaption>
    <canvas id="vectors" width="192" height="51" aria-label="Motion arrows point in alternating directions across the image"></canvas></figure>
  <figure><figcaption><span>RETAINED WEIGHT / REFRESH</span><span id="mask-label"></span></figcaption>
    <canvas id="mask" width="192" height="51" aria-label="Orange holds previous imagery, cyan refreshes from the current image"></canvas></figure>
</div>
</main>
<script>${ink.bundle().replace(/<\/script/gi, '<\\/script')}</script>
<script>
const P = KIT.procedural, w = 192, h = 96, fps = 15, count = 48, change = 8;
const el = id => document.getElementById(id);
const scrub = el('scrub'), life = el('life'), play = el('play'), controls = [el('drift'), el('refresh')];
const warm = [[20, 17, 33], [53, 29, 51], [107, 54, 61], [173, 71, 64], [230, 112, 73], [254, 174, 111], [255, 224, 156]];
const cool = [[12, 22, 39], [19, 41, 65], [36, 67, 91], [43, 107, 126], [60, 151, 152], [124, 204, 174], [204, 235, 181]];
const ny = time => 6 * Math.sin(time * 1.52);
const nx = (y, time) => time * (23 * Math.sin(y * .072 + .51) + 5 * Math.cos(Math.floor(y / 6))) + 5 * Math.sin(time * 2 - y * .065);
const raster = (channels, data) => ({ width: w, height: h, channels, data });
const frames = Array.from({ length: count }, (_, frame) => {
  const time = frame / fps, last = (frame - 1) / fps, isWarm = frame < change, palette = isWarm ? warm : cool;
  const image = new Uint8Array(w * h * 4), motion = new Float32Array(w * h * 2);
  const confidence = new Float32Array(w * h), refresh = new Uint8Array(w * h);
  for (let y = 0, p = 0; y < h; y++) for (let x = 0; x < w; x++, p++) {
    const v = y - ny(time), u = x - nx(v, time), a = u - (isWarm ? 79 : 122), b = v - (isWarm ? 48 : 45);
    const dither = ((x * 17 + y * 43 + (x ^ y) * 27) % 71) / 71;
    const sphere = Math.hypot(a * .81, b), ring = Math.hypot(a / 1.25, b + .18 * a);
    const filament = Math.sin(u * .153 + v * .31) + .44 * Math.cos(u * .188 - v * .26);
    let c = dither > .86 ? 1 : 0;
    if (Math.abs(v - 73 - 5 * Math.sin(u * .05)) < 12) c = filament > .68 ? 3 : filament > -.3 ? 2 : 1;
    if ((Math.floor(u) % 18 + 18) % 18 === 1 && (Math.floor(v) % 14 + 14) % 14 === 3) c = 2;
    if (sphere < 25) {
      const light = 1.12 - (a + b * 2) / 64;
      c = sphere > 23.5 ? 4 : light + filament * .19 + dither * .12 > 1.42 ? 6 : light + filament * .32 > .8 ? 5 : 3;
      if ((Math.floor(v) + 1) % 7 === 0 && filament > .48) c = Math.max(2, c - 2);
    }
    if (Math.abs(ring - 30) < 1.1 || Math.abs(ring - 34) < .8 && ((Math.floor(a) + 120) % 8 < 5))
      c = b > -2 ? 6 : 4;
    const beacon = Math.abs(u - (isWarm ? 145 : 54)) + 1.4 * Math.abs(v - 30);
    if (beacon < 9) c = beacon > 7 ? 4 : 5;
    if (y > 83 && (x % 15 === 6 || x % 15 === 7)) c = 3;
    image.set(palette[c], p * 4); image[p * 4 + 3] = 255;
    motion[p * 2] = frame ? nx(v, time) - nx(v, last) : 0;
    motion[p * 2 + 1] = frame ? ny(time) - ny(last) : 0;
    confidence[p] = y < 8 || y > 86 ? .55 : 1;
    const edge = Math.abs(x - (118 - y * .32));
    refresh[p] = y >= 80 || edge < 4.5 ? 255 : edge < 7 ? 128 : 0;
  }
  return { image: raster(4, image), motion: raster(2, motion), confidence: raster(1, confidence), refresh: raster(1, refresh) };
});
let session, sampled = -1, packet, mode = false, frame = +scrub.value, playing = false, last, request;
function reset() {
  session = P.datamosh.create({ halfLife: +life.value, fieldScale: [1.65, 1.35], blockSize: [6, 4] });
  sampled = -1;
}
reset();
function visual(id, raster) {
  el(id).getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(raster.data), w, h), 0, 0);
}
function vectors(field) {
  const canvas = el('vectors'), context = canvas.getContext('2d'), height = canvas.height;
  context.fillStyle = '#192438'; context.fillRect(0, 0, w, height);
  context.lineWidth = 1;
  for (let y = 5; y < height; y += 8) for (let x = 7; x < w - 3; x += 12) {
    const p = (Math.floor(y * h / height) * w + x) * 2, dx = field.data[p], dy = field.data[p + 1];
    context.strokeStyle = dx >= 0 ? '#f4ba83' : '#83d5ce';
    context.fillStyle = context.strokeStyle;
    context.fillRect(x, y, 1, 1);
    context.beginPath(); context.moveTo(x + .5, y + .5);
    context.lineTo(x + .5 + 3.1 * dx, y + .5 + 2.5 * dy); context.stroke();
  }
}
function mask(carry, refresh) {
  const canvas = el('mask'), context = canvas.getContext('2d'), height = canvas.height;
  const colors = [[22, 29, 47], [220, 141, 90], [88, 187, 191]];
  const image = context.createImageData(w, height);
  for (let y = 0, p = 0; y < height; y++) for (let x = 0; x < w; x++, p++) {
    const i = Math.floor((y + .5) * h / height) * w + x;
    const retained = carry.data[i], clean = mode ? refresh.data[i] / 255 : 0;
    for (let c = 0; c < 3; c++) image.data[p * 4 + c] =
      colors[0][c] * (1 - retained) * (1 - clean) + colors[1][c] * retained * (1 - clean) + colors[2][c] * clean;
    image.data[p * 4 + 3] = 255;
  }
  context.putImageData(image, 0, 0);
}
function render(at) {
  if (at < sampled) reset();
  while (sampled < at) {
    sampled++;
    const { image, motion, confidence, refresh } = frames[sampled];
    packet = session.sample(image, motion, sampled / fps, { confidence, refresh: mode ? refresh : undefined });
  }
  frame = at; scrub.value = at;
  const { image, motion, refresh } = frames[at];
  visual('source', image); visual('mosh', packet.value); vectors(motion); mask(packet.carry, refresh);
  el('source-label').textContent = at < change ? 'WARM PLATE' : 'BLUE PLATE';
  el('time').textContent = (at / fps).toFixed(2) + ' s';
  el('life-text').textContent = (+life.value).toFixed(1) + ' s';
  el('mask-label').textContent = mode ? 'CYAN REFRESH' : 'AMBER CARRY';
  el('mosh').dataset.mode = mode ? 'refresh' : 'drift';
  el('mosh').dataset.frame = at;
}
function step(now) {
  if (!playing) return;
  if (last === undefined) last = now;
  const n = Math.floor((now - last) * fps / 1000);
  if (n > 0) { last += n * 1000 / fps; render((frame + n) % count); }
  request = requestAnimationFrame(step);
}
function transport(on) {
  playing = on; last = undefined;
  play.textContent = playing ? 'Pause' : 'Play';
  if (playing) request = requestAnimationFrame(step); else cancelAnimationFrame(request);
}
play.addEventListener('click', () => transport(!playing));
scrub.addEventListener('input', () => { transport(false); render(+scrub.value); });
life.addEventListener('input', () => { reset(); render(frame); });
controls.forEach((button, i) => button.addEventListener('click', () => {
  mode = Boolean(i);
  for (const ctrl of controls) ctrl.setAttribute('aria-pressed', ctrl === button);
  reset(); render(frame);
}));
render(frame);
</script>
</html>`);
