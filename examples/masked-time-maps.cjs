const fs = require('node:fs');
const ink = require('..');

if (!process.argv[2]) throw new Error('Usage: node examples/masked-time-maps.cjs <demo.html>');

fs.writeFileSync(process.argv[2], `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tidal Delay</title>
<style>
:root { color-scheme: dark; background: #171820; color: #f2e9d8; font-family: system-ui, sans-serif; }
* { box-sizing: border-box; }
body { margin: 0; padding: 32px 25px; }
main { max-width: 1150px; margin: auto; }
header { display: flex; align-items: end; justify-content: space-between; gap: 18px; margin-bottom: 20px; }
h1 { font: 500 clamp(48px, 7vw, 91px)/.86 Georgia, serif; margin: 5px 0 11px; letter-spacing: -.06em; }
p { color: #c5c0b5; margin: 0; font-size: 14px; line-height: 1.5; }
nav, .transport { display: flex; flex-wrap: wrap; gap: 7px; align-items: center; }
.mono, button, figcaption, label, output, time { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; }
.mono { font-size: 11px; color: #a5c6b0; letter-spacing: .13em; }
button { padding: 8px 11px; background: #262c34; color: #ede4d7; border: 1px solid #535c62; border-radius: 3px; cursor: pointer; }
button[aria-pressed="true"] { background: #51403b; color: #ffecc4; border-color: #eca673; }
button:focus-visible, input:focus-visible { outline: 2px solid #f7b77b; outline-offset: 2px; }
.plate { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
figure { margin: 0; min-width: 0; background: #212831; border: 1px solid #555962; }
figcaption { color: #ddd1be; padding: 8px 11px; border-bottom: 1px solid #555962; display: flex;
 justify-content: space-between; align-items: center; min-height: 34px; gap: 7px; font-size: 11px; letter-spacing: .05em; }
figcaption span:last-child, time, output { color: #f2c692; }
canvas { display: block; width: 100%; aspect-ratio: 220 / 120; image-rendering: pixelated; }
.transport { flex-wrap: nowrap; margin: 14px 0; gap: 12px; }
#play { min-width: 67px; }
#scrub { flex: 1; width: 100%; min-width: 44px; }
input { accent-color: #eeaa76; }
time { min-width: 58px; font-size: 12px; text-align: right; }
.details { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
#delay { aspect-ratio: 220 / 52; }
.settings { border: 1px solid #555962; background: #262a34; padding: 13px 16px; display: grid; align-content: center; gap: 10px; }
.settings h2 { font: 500 27px/1 Georgia, serif; margin: 0; }
.settings label { display: grid; grid-template-columns: auto 1fr auto; gap: 10px; align-items: center; font-size: 11px; color: #d6c9b9; }
#strength { width: 100%; min-width: 44px; }
#strength-output { min-width: 36px; text-align: right; }
@media (max-width: 720px) {
 body { padding: 18px 12px; }
 header { align-items: start; flex-direction: column; gap: 12px; margin-bottom: 12px; }
 .plate, .details { grid-template-columns: 1fr; gap: 7px; }
 figcaption { min-height: 27px; padding: 5px 7px; font-size: 10px; }
}
</style>
<main>
<header>
 <div><span class="mono">INK STUDIO / MASKED TIME MAPS</span><h1>Tidal Delay</h1><p>Choose which moments of a moving harbor appear in the same image.</p></div>
 <nav aria-label="Timing source">
  <button type="button" data-mode="stencil" aria-pressed="true">Stencil</button>
  <button type="button" data-mode="depth" aria-pressed="false">Depth</button>
  <button type="button" data-mode="field" aria-pressed="false">Field</button>
  <button type="button" data-mode="motion" aria-pressed="false">Tracked motion</button>
 </nav>
</header>
<div class="plate">
 <figure><figcaption><span>CURRENT FRAME</span><span id="live-label"></span></figcaption><canvas id="source" width="220" height="120" aria-label="Current harbor frame"></canvas></figure>
 <figure><figcaption><span>TIME-MAPPED FRAME</span><span id="mode-label"></span></figcaption><canvas id="result" width="220" height="120" aria-label="Harbor pixels read at different times"></canvas></figure>
</div>
<div class="transport"><button type="button" id="play">Play</button><input id="scrub" type="range" min="0" max="55" value="35" step="1" aria-label="Source frame"><time id="clock"></time></div>
<div class="details">
 <figure><figcaption><span>PER-PIXEL DELAY</span><span id="delay-label"></span></figcaption><canvas id="delay" width="220" height="120" aria-label="Darker pixels follow current time and brighter pixels read earlier frames"></canvas></figure>
 <section class="settings"><h2 id="mode-title"></h2><p id="mode-description"></p>
 <label for="strength">Delay strength <input id="strength" type="range" min="0" max="100" value="100"> <output id="strength-output" for="strength"></output></label></section>
</div>
</main>
<script>${ink.bundle().replace(/<\/script/gi, '<\\/script')}</script>
<script>
const P = KIT.procedural, w = 220, h = 120, fps = 12, count = 56, n = w * h;
const el = id => document.getElementById(id);
const clamp = value => Math.min(1, Math.max(0, value));
const smooth = value => { const t = clamp(value); return t * t * (3 - 2 * t); };
const mono = data => ({ width: w, height: h, channels: 1, data });
const all = mono(new Uint8Array(n).fill(255));
const modeSettings = {
  stencil: { title: 'Cut-paper stencil', label: 'STENCIL', copy: 'Six angled bands read progressively older images. The rest of the harbor keeps the current time.' },
  depth: { title: 'Depth separates time', label: 'DEPTH', copy: 'Farther water reads earlier; the foreground dock and pixels without depth keep the current time.' },
  field: { title: 'Traveling wave', label: 'SCALAR FIELD', copy: 'A moving field sweeps through the channel. Each ripple bends the current time farther back.' },
  motion: { title: 'Delay follows a track', label: 'TRACKED MOTION', copy: 'The region tracker follows the amber craft. Its velocity sets the delay within a soft mask trailing its center.' }
};
const graphFor = mode => P.graph.create({
  inputs: { history: 'any', map: 'raster', mask: 'raster', valid: 'raster' },
  nodes: { delay: { op: 'warp.timeRemap', inputs: {
    history: { input: 'history' }, map: { input: 'map' }, mask: { input: 'mask' }, valid: { input: 'valid' },
    options: { channel: mode === 'motion' ? 'magnitude' : 0, scale: mode === 'motion' ? -.032 : -1,
      filter: 'nearest', interpolation: 'linear' }
  } } }, outputs: { image: { node: 'delay' } }
});
const graphs = Object.fromEntries(Object.keys(modeSettings).map(mode => [mode, graphFor(mode)]));
const tracker = P.pixelEffects.createRegionTracker({ threshold: 128, minArea: 20, maxDistance: 13 });
const bank = P.frameBanks.create({ fps, history: 25, regions: [{}] });

function build(frame) {
  const image = new Uint8Array(n * 4), object = new Uint8Array(n);
  const xA = 18 + frame * 3.34, xB = 214 - frame * 3.47;
  for (let y = 0, p = 0; y < h; y++) for (let x = 0; x < w; x++, p++) {
    const hash = (x * 37 + y * 87 + x * y * 13) % 101, skyline = 44 + (Math.floor(x / 8) * 19 % 14);
    let rgb = y < 29 ? [26, 33, 48] : y < 42 ? [36, 47, 60] : [103, 75, 79];
    const moon = Math.hypot((x - 175) * 1.04, y - 24);
    if (moon < 16 && y < 42) rgb = y > 30 && y % 3 === 0 ? [153, 94, 88] : [224, 149, 108];
    if (hash === 10 && y < 32 && moon > 16) rgb = [98, 111, 118];
    if (y >= skyline) rgb = (x % 8 === 4 && (y + (x >> 3)) % 7 === 0) ? [160, 121, 87] : [23, 30, 46];
    if ((x > 22 && x < 24 || x > 66 && x < 68) && y >= 26 && y < 62 ||
        x > 22 && x < 69 && y > 26 && y < 29 || x > 38 && x < 40 && y > 28 && y < 40) rgb = [15, 23, 33];
    if (y >= 61) {
      const water = Math.sin(x * .067 + frame * .13 + y * .41) + Math.cos(x * .119 - frame * .13 - y * .6);
      rgb = y < 74 ? [26, 64, 77] : y < 93 ? [23, 52, 67] : [19, 38, 53];
      if (y % 5 === 2 && water > .4) rgb = water > 1.24 ? [68, 113, 113] : [44, 84, 96];
      if (Math.abs(x - 175) < (y - 59) * .42 && y % 4 === 2 && water > -.15) rgb = [122, 93, 81];
      if (x % 22 === 0 && y === 79) rgb = [98, 177, 168];
    }
    const a = x - xA, b = y - 77 - 1.65 * Math.sin(frame * .21);
    const jet = a > -22 && a < -8 && Math.abs(b - 1) < 1.5 && (x + frame) % 4 < 2;
    if (jet) rgb = [187, 97, 66];
    if (a >= -11 && a < 13 && b >= -4 && b <= 4 && !(a > 8 && Math.abs(b) > 2.6)) {
      rgb = b < -2 ? [241, 174, 98] : b < 1 && a > -6 ? [255, 221, 152] : b < 2.7 ? [232, 128, 78] : [140, 75, 67];
      if (a > -7 && a < 3 && b < .4 && b > -2.5) rgb = [67, 84, 87];
      object[p] = 255;
    }
    const c = x - xB, d = y - 96 - 1.2 * Math.cos(frame * .2);
    if (c > -14 && c < 15 && d > -2.5 && d < 4 && !(c < -10 && d < -1)) {
      rgb = d < 0 ? [162, 231, 193] : d < 1.5 ? [87, 167, 160] : [52, 106, 119];
      if (c < 7 && c > 0 && d > -2.5 && d < .1) rgb = [42, 82, 94];
    }
    if (y >= 111 || y > 102 && x % 52 < 3) {
      rgb = y === 111 ? [83, 116, 118] : y < 114 ? [48, 70, 81] : [17, 27, 39];
      if (y >= 115 && y <= 117 && x % 52 > 11 && x % 52 < 17) rgb = [208, 132, 88];
    }
    image.set(rgb, p * 4); image[p * 4 + 3] = 255;
  }
  return { source: { width: w, height: h, channels: 4, data: image }, object: mono(object) };
}
const timeline = Array.from({ length: count }, (_, frame) => {
  const { source, object } = build(frame), time = frame / fps;
  const tracking = tracker.update(object, time);
  return { source, time, tracking, history: bank.sample(source, time).history };
});

function signals(mode, shot, amount) {
  const scalar = new Float32Array(n), vectors = mode === 'motion' ? new Float32Array(n * 2) : null;
  const coverage = new Uint8Array(n), valid = mode === 'depth' ? new Uint8Array(n) : null;
  const heat = new Uint8Array(n * 4);
  const track = shot.tracking.value[0], [cx, cy] = track?.center ?? [0, 0], [vx, vy] = track?.velocity ?? [0, 0];
  let maxDelay = 0;
  for (let y = 0, p = 0; y < h; y++) for (let x = 0; x < w; x++, p++) {
    let delay, weight;
    if (mode === 'stencil') {
      const a = x + (y - 75) * 1.8, b = y - 56 - x * .11;
      const band = Math.floor((a - 27) / 26);
      delay = (5 - band) * .29 + .24;
      weight = band >= 0 && band < 6 ? smooth((20 - Math.abs(b - 11)) / 4) *
        smooth((13 - Math.abs((a - 27) % 26 - 13)) / 3) : 0;
    } else if (mode === 'depth') {
      const water = y >= 61 && y < 111;
      valid[p] = water ? 255 : 0;
      delay = .22 + (111 - y) * .03;
      weight = 1;
    } else if (mode === 'field') {
      delay = .23 + 1.4 * (.5 + .5 * Math.sin(x * .068 + y * .14 - shot.time * 4)) ** 2;
      weight = smooth((y - 55) / 15) * smooth((111 - y) / 10);
    } else {
      const inTrack = shot.tracking.labels.data[p] === track?.id;
      delay = Math.hypot(vx, vy) * .032;
      vectors[p * 2] = vx; vectors[p * 2 + 1] = vy;
      weight = Math.max(Number(inTrack), smooth((1 - Math.hypot((x - cx + 43) / 67, (y - cy) / 25)) * 2));
    }
    scalar[p] = delay;
    coverage[p] = Math.round(weight * amount * 255);
    const actual = valid && !valid[p] ? 0 : Math.min(shot.time - shot.history.origin, delay * coverage[p] / 255);
    const light = clamp(actual / 1.6);
    heat.set([23 + light * 222, 31 + light * 143, 43 + light * 71, 255], p * 4);
    maxDelay = Math.max(maxDelay, actual);
  }
  return { map: vectors ? { width: w, height: h, channels: 2, data: vectors } : mono(scalar),
    mask: mono(coverage), valid: valid ? mono(valid) : all, heat, maxDelay };
}

const contexts = Object.fromEntries(['source', 'result', 'delay'].map(id =>
  [id, el(id).getContext('2d', { willReadFrequently: true })]));
const buttons = [...document.querySelectorAll('[data-mode]')], play = el('play'), scrub = el('scrub'), strength = el('strength');
let mode = 'stencil', frame = Number(scrub.value), playing = false, last, request;
function paint(id, bytes) {
  const ctx = contexts[id], image = ctx.createImageData(w, h);
  image.data.set(bytes);
  ctx.putImageData(image, 0, 0);
}
function render() {
  const shot = timeline[frame], control = modeSettings[mode];
  const { heat, maxDelay, ...input } = signals(mode, shot, Number(strength.value) / 100);
  const { outputs } = graphs[mode].evaluate({ history: shot.history, ...input }, { time: shot.time });
  paint('source', shot.source.data); paint('result', outputs.image.data); paint('delay', heat);
  el('result').dataset.frame = frame;
  el('result').dataset.mode = mode;
  el('clock').textContent = shot.time.toFixed(2) + ' s';
  el('mode-label').textContent = control.label;
  el('mode-title').textContent = control.title;
  el('mode-description').textContent = control.copy;
  el('live-label').textContent = shot.history.frames.length + ' STORED FRAMES';
  el('delay-label').textContent = '0–' + maxDelay.toFixed(2) + ' s EARLIER';
  el('strength-output').textContent = strength.value + '%';
}
function step(now) {
  if (!playing) return;
  last ??= now;
  const elapsed = Math.floor((now - last) * fps / 1000);
  if (elapsed > 0) {
    last += elapsed * 1000 / fps;
    frame = (frame + elapsed) % count; scrub.value = frame; render();
  }
  request = requestAnimationFrame(step);
}
function transport(on) {
  playing = on; last = undefined; play.textContent = on ? 'Pause' : 'Play';
  if (on) request = requestAnimationFrame(step); else cancelAnimationFrame(request);
}
play.addEventListener('click', () => transport(!playing));
scrub.addEventListener('input', () => { transport(false); frame = Number(scrub.value); render(); });
strength.addEventListener('input', render);
buttons.forEach(button => button.addEventListener('click', () => {
  mode = button.dataset.mode;
  buttons.forEach(other => other.setAttribute('aria-pressed', other === button));
  render();
}));
render();
</script>
</html>`);
