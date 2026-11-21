const fs = require('node:fs');
const ink = require('..');

if (!process.argv[2]) throw new Error('Usage: node examples/frame-banks.cjs <demo.html>');

fs.writeFileSync(process.argv[2], `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Signal loom</title>
<style>
:root { color-scheme: dark; background: #14131a; color: #f2e6d6; font-family: system-ui, sans-serif; }
* { box-sizing: border-box; }
body { margin: 0; padding: 28px 28px 22px; }
main { max-width: 1152px; margin: auto; }
header { display: flex; align-items: end; justify-content: space-between; gap: 16px; padding-bottom: 18px; }
h1 { font: 500 clamp(42px, 7vw, 82px)/.88 Georgia, serif; margin: 4px 0 11px; letter-spacing: -.055em; }
p { margin: 0; color: #bcb1bd; font-size: 14px; }
.mono, figcaption, button, label, output, time, dt, dd { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; }
.mono { color: #e3aa87; letter-spacing: .12em; font-size: 11px; }
nav { display: flex; flex-wrap: wrap; justify-content: end; gap: 7px; }
button { cursor: pointer; padding: 8px 11px; border-radius: 3px; border: 1px solid #605064; background: #292334; color: #f2e6d6; }
button[aria-pressed="true"] { background: #593843; border-color: #dc946f; color: #ffe7c3; }
button:focus-visible, input:focus-visible { outline: 2px solid #fbc48e; outline-offset: 2px; }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
figure { min-width: 0; margin: 0; border: 1px solid #4c4254; background: #1a1822; }
figcaption { display:flex; justify-content:space-between; align-items:center; min-height: 35px; gap: 8px;
 padding: 8px 11px; color: #d2bfc9; font-size: 11px; letter-spacing: .06em; border-bottom: 1px solid #4c4254; }
figcaption span:last-child, figcaption time { color: #efc0a0; text-align: right; }
canvas { width: 100%; display: block; image-rendering: pixelated; aspect-ratio: 192 / 100; }
.transport { display: flex; align-items: center; gap: 12px; padding: 13px 0; }
#play { min-width: 66px; }
#scrub { flex: 1; min-width: 48px; width: 100%; }
input { accent-color: #e7a880; }
label { font-size: 11px; white-space: nowrap; color: #e1c1b6; display: flex; align-items: center; gap: 5px; }
.details { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); align-items: stretch; gap: 12px; }
.detail { padding: 14px 17px; background: #201c28; border: 1px solid #4c4254; }
.detail h2 { margin: 0 0 8px; font: 500 26px/1.1 Georgia, serif; }
.detail p { line-height: 1.5; }
dl { margin: 17px 0 0; display: flex; gap: 26px; flex-wrap: wrap; }
dt { margin: 0 0 3px; font-size: 11px; color: #bfa6b6; }
dd { margin: 0; font-size: 20px; color: #ffc897; }
.matte { max-width: 100%; aspect-ratio: 192 / 53; background: #201c28; }
@media (max-width: 660px) {
  body { padding: 18px 12px; }
  header { align-items: start; flex-direction: column; gap: 12px; }
  nav { justify-content: start; }
  figcaption { padding: 6px; font-size: 9px; min-height: 33px; }
  .grid, .details { gap: 7px; }
  .transport { gap: 6px; }
  .detail { padding: 9px; }
  .detail h2 { font-size: 20px; }
  .detail p { font-size: 12px; }
  dl { margin-top: 10px; gap: 8px; }
  dt { font-size: 9px; }
  dd { font-size: 15px; }
}
</style>
<main>
<header>
  <div><span class="mono">INK STUDIO / SELECTIVE REFRESH</span><h1>Signal loom</h1><p>Keep old pixels until a tile, mask, or tracked region gets a new frame.</p></div>
  <nav aria-label="Refresh pattern">
    <button type="button" data-mode="tiles" aria-pressed="true">Tiles</button>
    <button type="button" data-mode="masks" aria-pressed="false">Masks</button>
    <button type="button" data-mode="track" aria-pressed="false">Tracked region</button>
  </nav>
</header>
<div class="grid">
  <figure><figcaption><span>LIVE FEED</span><time id="clock"></time></figcaption>
  <canvas id="source" width="192" height="100" aria-label="Current frame"></canvas></figure>
  <figure><figcaption><span>FRAME BANK</span><span id="bank-label">STAGGERED TILES</span></figcaption>
  <canvas id="bank" width="192" height="100" aria-label="Retained frame with selective refresh"></canvas></figure>
</div>
<div class="transport">
  <button type="button" id="play">Play</button>
  <input id="scrub" type="range" min="0" max="59" value="18" step="1" aria-label="Source frame">
  <label><input id="sweep" type="checkbox">Sweep refresh</label>
</div>
<div class="details">
  <figure><figcaption><span>PIXELS REFRESHED NOW</span><span id="frame-label"></span></figcaption>
  <canvas id="matte" class="matte" width="192" height="53" aria-label="Current refresh mask in peach"></canvas></figure>
  <section class="detail"><h2 id="mode-title"></h2><p id="mode-copy"></p>
  <dl><div><dt>Refreshed</dt><dd id="refreshed"></dd></div><div><dt>Retained</dt><dd id="retained"></dd></div></dl></section>
</div>
</main>
<script>${ink.bundle().replace(/<\/script/gi, '<\\/script')}</script>
<script>
const P = KIT.procedural, w = 192, h = 100, fps = 12, count = 60, tau = Math.PI * 2;
const el = id => document.getElementById(id);
const scrub = el('scrub'), play = el('play'), sweep = el('sweep');
const buttons = [...document.querySelectorAll('[data-mode]')];
const tracker = P.pixelEffects.createRegionTracker({ threshold: 128, minArea: 30, maxDistance: 15 });
const modes = {
  tiles: { label: 'STAGGERED TILES', title: 'Tile cadence', copy: 'Each tile is offset by one tick in a nine-tick cycle. Only the tiles due now take fresh pixels.',
    settings: { tiles: { size: [24, 20], every: 9, step: 1 } } },
  masks: { label: 'INDEPENDENT MASKS', title: 'Two mask clocks', copy: 'The left mask refreshes every seven ticks and the right every eleven. The lower band refreshes every tick.',
    settings: { regions: [{ mask: 'left', every: 7, phase: 4 }, { mask: 'right', every: 11, phase: 1 },
      { rect: [0, 85, w, 15] }] } },
  track: { label: 'MOVING REGION 01', title: 'Tracked footprint', copy: 'Region 01 refreshes its current footprint every three ticks. Older footprints remain until the next full refresh.',
    settings: { regions: [{ mask: 'tracked', every: 3 }, { every: 24 }] } }
};
const palette = {
  night: [18, 27, 43], lilac: [58, 51, 83], violet: [99, 67, 108], rose: [176, 91, 119],
  coral: [240, 124, 101], amber: [255, 193, 112], cream: [255, 239, 172],
  jade: [40, 90, 101], aqua: [103, 185, 170], mint: [167, 230, 189]
};
const rgba = data => ({ width: w, height: h, channels: 4, data });
const mono = data => ({ width: w, height: h, channels: 1, data });
const matte = fn => mono(Uint8Array.from({ length: w * h }, (_, p) => fn(p % w, Math.floor(p / w))));
const left = matte((x, y) => x < 94 + 14 * Math.sin(y * .103) ? 255 : 0);
const right = mono(left.data.map(value => 255 - value));
const frames = Array.from({ length: count }, (_, frame) => {
  const t = frame * tau / count, data = new Uint8Array(w * h * 4), subject = new Uint8Array(w * h);
  const firstX = 95 + 68 * Math.sin(t - 1.2), firstY = 35 + 8 * Math.sin(t * 2 + .2);
  const secondX = 96 - 56 * Math.sin(t - .4), secondY = 69 + 5 * Math.cos(t * 2 - 1.1);
  const ink = (p, color) => { data.set(color, p * 4); data[p * 4 + 3] = 255; };
  for (let y = 0, p = 0; y < h; y++) for (let x = 0; x < w; x++, p++) {
    const noise = ((x * 71 + y * 109 + (x ^ y) * 37) % 103) / 103;
    const wave = y - 72 - 6 * Math.sin(x * .046 - t) - 5 * Math.sin(x * .091 + t * 2);
    const cross = x % 16 === 8 && (y + frame) % 16 === 2;
    let color = cross ? palette.lilac : palette.night;
    if (wave >= 0) {
      const strand = (wave + 2.6 * Math.sin(x * .23 + t)) % 11;
      color = strand < 2 ? palette.rose : strand < 3.5 || y % 4 === 0 ? palette.violet : palette.lilac;
      if (noise > .89 && strand > 4) color = palette.night;
    }
    if ((x + y * 2) % 47 === 0 && y < 62 && noise > .75) color = palette.violet;
    const u = (x - firstX) / 1.32, v = y - firstY, r = Math.hypot(u, v);
    if (r < 16.4) {
      subject[p] = 255;
      const shade = (u * -.65 - v) / 24;
      color = r > 14.9 ? (shade > -.12 ? palette.cream : palette.coral)
        : r > 12.6 ? palette.rose : Math.sin(v * .36 + t * 3 + u * .08) > .35 ? palette.coral
          : shade > .25 + noise * .18 ? palette.cream : palette.amber;
      if (Math.abs(v + 2 * Math.sin(u * .4)) < 1.6 && Math.abs(u) < 10) color = palette.night;
    }
    const a = (x - secondX) / 1.5, b = y - secondY, q = Math.abs(a) + Math.abs(b) * .93;
    if (q < 9.5) {
      subject[p] = 255;
      color = q > 7.1 ? palette.aqua : (x + y + frame) % 5 < 2 ? palette.jade : palette.mint;
    }
    if ((x === 5 || x === w - 6) && y > 11 && y < 88 && y % 5 === 0) color = palette.violet;
    ink(p, color);
  }
  const { labels } = tracker.update(mono(subject), frame / fps);
  const tracked = mono(Uint8Array.from(labels.data, id => id === 1 ? 255 : 0));
  const scan = matte(x => Math.abs(x - (frame * 5 % w)) < 3 ? 255 : 0);
  return { source: rgba(data), tracked, scan };
});
const cache = new Map();
function tape(mode, scanning) {
  const key = mode + scanning;
  if (!cache.has(key)) {
    const bank = P.frameBanks.create({ fps, ...modes[mode].settings, ...(scanning && { refresh: 'scan' }) });
    cache.set(key, frames.map(({ source, tracked, scan }, frame) => bank.sample(source, frame / fps,
      { masks: { left, right, tracked, scan } })));
  }
  return cache.get(key);
}
function draw(target, raster) {
  el(target).getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(raster.data), w, h), 0, 0);
}
function drawMatte(source) {
  const canvas = el('matte'), ctx = canvas.getContext('2d'), height = canvas.height, image = ctx.createImageData(w, height);
  for (let y = 0, p = 0; y < height; y++) for (let x = 0; x < w; x++, p++) {
    const weight = source.data[Math.floor((y + .5) * h / height) * w + x] / 255;
    const background = x % 12 === 0 || y % 10 === 0 ? [55, 48, 67] : [31, 27, 40];
    for (let c = 0; c < 3; c++) image.data[p * 4 + c] = background[c] * (1 - weight) + [238, 157, 107][c] * weight;
    image.data[p * 4 + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
}
let mode = 'tiles', frame = +scrub.value, playing = false, last, request;
function render(at) {
  frame = at; scrub.value = at;
  const data = tape(mode, sweep.checked)[at];
  draw('source', frames[at].source); draw('bank', data.value); drawMatte(data.refreshed);
  const changed = data.refreshed.data.reduce((total, amount) => total + Number(amount > 0), 0);
  const percent = 100 * changed / (w * h);
  el('clock').textContent = (at / fps).toFixed(2) + ' s';
  el('frame-label').textContent = 'TICK ' + String(data.tick).padStart(2, '0');
  el('bank-label').textContent = modes[mode].label;
  el('mode-title').textContent = modes[mode].title;
  el('mode-copy').textContent = modes[mode].copy;
  el('refreshed').textContent = percent.toFixed(1) + '%';
  el('retained').textContent = (100 - percent).toFixed(1) + '%';
  el('bank').dataset.refreshed = changed;
}
function update(now) {
  if (!playing) return;
  if (last === undefined) last = now;
  const crossed = Math.floor((now - last) * fps / 1000);
  if (crossed > 0) { last += crossed * 1000 / fps; render((frame + crossed) % count); }
  request = requestAnimationFrame(update);
}
function transport(active) {
  playing = active; last = undefined;
  play.textContent = active ? 'Pause' : 'Play';
  if (active) request = requestAnimationFrame(update);
  else cancelAnimationFrame(request);
}
play.addEventListener('click', () => transport(!playing));
scrub.addEventListener('input', () => { transport(false); render(+scrub.value); });
sweep.addEventListener('change', () => render(frame));
buttons.forEach(button => button.addEventListener('click', () => {
  mode = button.dataset.mode;
  for (const choice of buttons) choice.setAttribute('aria-pressed', choice === button);
  render(frame);
}));
render(frame);
</script>
</html>`);
