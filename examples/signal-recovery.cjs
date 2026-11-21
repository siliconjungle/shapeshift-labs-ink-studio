const fs = require('node:fs');
const ink = require('..');

if (!process.argv[2]) throw new Error('Usage: node examples/signal-recovery.cjs <demo.html>');

fs.writeFileSync(process.argv[2], `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Carrier Return</title>
<style>
:root { color-scheme: dark; background: #15181f; color: #f1e6d3; font-family: system-ui, sans-serif; }
* { box-sizing: border-box; }
body { margin: 0; padding: 31px 26px; }
main { max-width: 1150px; margin: auto; }
header { display: flex; align-items: end; justify-content: space-between; gap: 13px; margin-bottom: 20px; }
h1 { font: 500 clamp(46px, 7vw, 88px)/.88 Georgia, serif; margin: 4px 0 12px; letter-spacing: -.059em; }
p { margin: 0; color: #c6c9c4; font-size: 14px; line-height: 1.45; }
.mono, figcaption, nav, button, time, dt, dd { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; }
.mono { color: #b3cdba; font-size: 11px; letter-spacing: .13em; }
nav { display: flex; flex-wrap: wrap; gap: 8px; }
button { background: #262d34; border: 1px solid #536164; color: #ece5d5; padding: 8px 11px; border-radius: 3px; cursor: pointer; }
button[aria-pressed="true"] { background: #4b4136; border-color: #e0a471; color: #ffe2bb; }
button:focus-visible, input:focus-visible { outline: 2px solid #f4ba81; outline-offset: 2px; }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
figure, .sequence, .reading { margin: 0; min-width: 0; border: 1px solid #505c60; background: #222831; }
figcaption { display: flex; justify-content: space-between; align-items: center; min-height: 35px; padding: 8px 11px;
 gap: 8px; font-size: 11px; letter-spacing: .06em; border-bottom: 1px solid #505c60; color: #d5d6c9; }
figcaption span:last-child { color: #f0bd87; text-align: right; }
canvas { display: block; width: 100%; aspect-ratio: 216 / 116; image-rendering: pixelated; }
.transport { display: flex; align-items: center; gap: 12px; margin: 12px 0; }
#play { min-width: 66px; }
#scrub { flex: 1; width: 100%; min-width: 45px; accent-color: #e6ae79; }
time { min-width: 57px; text-align: right; font-size: 12px; color: #e8c395; }
.details { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.sequence, .reading { padding: 12px 14px 14px; }
.timeline { position: relative; display: flex; height: 10px; margin: 9px 0 13px; border: 1px solid #6b7774; }
.timeline span[data-stage="locked"] { background: #75aa91; }
.timeline span[data-stage="losing"] { background: #ec8f77; }
.timeline span[data-stage="holding"] { background: #9c664f; }
.timeline span[data-stage="relocking"] { background: #e4ba79; }
#cursor { width: 2px; height: 18px; top: -5px; background: #fff5da; position: absolute; left: 0; transform: translateX(-1px); }
.cues button { font-size: 11px; }
.cues button[aria-current="true"] { border-color: #dbad76; color: #ffd9a4; }
h2 { font: 500 25px/1 Georgia, serif; margin: 0 0 6px; color: #f3e3c6; }
dl { display: flex; flex-wrap: wrap; margin: 10px 0 0; gap: 8px 20px; }
dt { color: #b8c7c0; font-size: 10px; }
dd { margin: 3px 0 0; color: #f3cb96; font-size: 12px; }
@media (max-width: 710px) {
 body { padding: 18px 12px; }
 header { align-items: start; flex-direction: column; gap: 12px; margin-bottom: 12px; }
 .grid, .details { grid-template-columns: 1fr; gap: 8px; }
 figcaption { padding: 5px 7px; min-height: 29px; font-size: 10px; }
}
</style>
<main>
<header>
 <div><span class="mono">INK STUDIO / SIGNAL RECOVERY</span><h1>Carrier Return</h1><p>Watch a receiver hold the last usable image and resolve back to a live feed.</p></div>
 <nav aria-label="Fault source">
  <button type="button" data-mode="dropout" aria-pressed="true">Carrier dropout</button>
  <button type="button" data-mode="tracking" aria-pressed="false">Track loss</button>
 </nav>
</header>
<div class="grid">
 <figure><figcaption><span>INCOMING FEED</span><span id="input-label"></span></figcaption><canvas id="input" width="216" height="116" aria-label="Live feed with a simulated dropout or missing marker"></canvas></figure>
 <figure><figcaption><span>RECOVERED OUTPUT</span><span id="output-label"></span></figcaption><canvas id="output" width="216" height="116" aria-label="Receiver output holds steady while its input drops"></canvas></figure>
</div>
<div class="transport"><button type="button" id="play">Play</button><input id="scrub" type="range" min="0" max="51" value="20" step="1" aria-label="Source frame"><time id="clock"></time></div>
<div class="details">
 <section class="sequence"><span class="mono">RECEIVER STAGES</span><div id="timeline" class="timeline" aria-hidden="true"></div>
 <nav class="cues" aria-label="Jump to receiver stage">
  <button type="button" data-stage="losing">Losing sync</button>
  <button type="button" data-stage="holding">Holding</button>
  <button type="button" data-stage="relocking">Relocking</button>
  <button type="button" data-stage="locked">Locked again</button>
 </nav></section>
 <section class="reading"><h2 id="stage-title"></h2><p id="stage-copy"></p>
 <dl><div><dt>LAST USABLE FRAME</dt><dd id="held"></dd></div><div><dt>QUALITY</dt><dd id="quality"></dd></div><div><dt>LIVE MIX</dt><dd id="mix"></dd></div></dl></section>
</div>
</main>
<script>${ink.bundle().replace(/<\/script/gi, '<\\/script')}</script>
<script>
const P = KIT.procedural, w = 216, h = 116, fps = 12, count = 52;
const el = id => document.getElementById(id);
const wrap = (x, span) => (x % span + span) % span;
const mono = data => ({ width: w, height: h, channels: 1, data });
const labels = { locked: 'Locked', losing: 'Losing sync', holding: 'Holding', relocking: 'Relocking' };
const captions = {
  locked: 'The live frame is accepted and becomes the next hold image.',
  losing: 'The carrier has failed. The receiver keeps its usable frame while it checks for another miss.',
  holding: 'The held frame stays fixed while the receiver waits for a strong input.',
  relocking: 'The receiver confirms the returning feed, then blends out of the held frame.'
};

function terrain(x, y) {
  const ridge = 75 + 8 * Math.sin(x * .058 + .5) + 4 * Math.cos(x * .12);
  if (y < ridge) return y < 31 ? [29, 38, 59] : y < 53 ? [53, 57, 79] : [85, 68, 83];
  if (y < 91 + Math.sin(x * .074) * 4) return y % 3 && (x % 7 < 5) ? [49, 52, 66] : [57, 56, 72];
  return ((x * 23 + y * 71) % 23 > 16 || (x + y * 3) % 19 === 0) ? [50, 60, 69] : [33, 43, 54];
}

function art(frame, targetVisible) {
  const data = new Uint8Array(w * h * 4), detect = new Uint8Array(w * h);
  const xA = 24 + frame * 3.03, yA = 35 + Math.round(3 * Math.sin(frame * .21));
  const xB = 200 - frame * 1.64, yB = 51 + Math.round(2 * Math.sin(frame * .31));
  for (let y = 0, p = 0; y < h; y++) for (let x = 0; x < w; x++, p++) {
    let color = terrain(x, y);
    const hash = (x * 37 + y * 87 + x * y * 13) % 103;
    const sun = Math.hypot((x - 170) * .95, y - 32), lagoon = y >= 68 && y < 76;
    if (sun < 21 && y < 56) color = y > 22 && y % 4 === 0 ? [142, 78, 88] : y < 32 ? [217, 142, 100] : [187, 104, 91];
    if (hash === 7 && sun > 24 && y < 50) color = [124, 119, 127];
    if (lagoon && (hash + frame * 3) % 33 < 3) color = [120, 88, 95];
    const dx = x - 102, dy = y - 75, u = dx * .92 + dy * .39, v = -dx * .39 + dy * .92;
    const rim = 4.5 - u * u * .014;
    if ((x > 89 && x < 103 && y > 78 && y < 111) || x >= 80 && x <= 108 && y >= 104 && y <= 114)
      color = x % 5 === 0 && y < 104 ? [98, 109, 111] : y === 104 || y === 105 ? [138, 134, 119] : [35, 44, 52];
    if (Math.abs(u) < 29 && v >= rim && v <= rim + 7 - Math.abs(u) * .13) {
      color = v < rim + 1.35 ? [216, 184, 137] : Math.floor(u / 4) % 2 === 0 ? [135, 131, 121] : [99, 106, 111];
      if (v > rim + 4) color = [73, 85, 96];
    }
    if (v < rim && v >= -15 && Math.abs(Math.abs(u - 2) - (v + 15) * .89) < .8) color = [156, 159, 138];
    if (Math.abs(u - 2) < 2.3 && Math.abs(v + 16) < 2.5) color = frame % 11 < 7 ? [243, 187, 116] : [131, 79, 78];
    if (x > 146 && x < 151 && y > 60 && y < 109 || x > 133 && x < 158 && y > 96 && y < 99)
      color = y % 6 ? [35, 46, 56] : [95, 102, 105];
    if (x > 146 && x < 151 && y === 61) color = frame % 12 > 5 ? [220, 112, 85] : [93, 61, 71];
    const a = x - xA, b = y - yA, c = x - xB, d = y - yB;
    if (targetVisible && Math.abs(a) < 17 && a < -8 && b === 1 && wrap(x + frame, 5) < 3) color = [173, 85, 84];
    if (targetVisible && a > -9 && a <= 11 && Math.abs(b) < (a > 7 ? 2 : 4)) {
      color = b < -1 ? [238, 163, 112] : b < 1 ? [255, 217, 149] : [194, 96, 79];
      if (a > -2 && a < 5 && b < 0) color = [84, 68, 87];
      detect[p] = 255;
    }
    if (Math.abs(c) < 7 && Math.abs(d) < 2.5) {
      color = d < 1 ? [150, 213, 187] : [70, 129, 140];
      detect[p] = 255;
    }
    data.set(color, p * 4); data[p * 4 + 3] = 255;
  }
  return { source: { width: w, height: h, channels: 4, data }, detect: mono(detect) };
}

function damaged(source, time, heavy) {
  if (heavy) return P.generator.tvStatic({ width: w, height: h, preset: 'weak-signal', seed: 31, time,
    opacity: 1, grain: [3, 1], contrast: .55, chroma: .24, scanlines: .38 });
  const at = 20 + Math.floor(time * 111) % 53;
  const slip = P.pixelEffects.scanlineRemap(source, {
    edits: [{ mode: 'repeat', start: at, count: 7, source: Math.max(0, at - 14) }]
  }).value;
  return P.pixelEffects.tvStatic(slip, { preset: 'tracking', opacity: .57, density: .72, time, seed: 8 });
}

function markTarget(source, tracks) {
  const target = tracks.find(item => item.id === 1);
  if (!target) return source;
  const { x, y, width, height } = target.bounds;
  const data = source.data.slice(), left = x - 3, right = x + width + 2, top = y - 3, bottom = y + height + 2;
  for (const [a, b] of [[left, top], [right, top], [left, bottom], [right, bottom]]) {
    for (let k = 0; k < 4; k++) for (const [dx, dy] of [[k * (a === left ? 1 : -1), 0], [0, k * (b === top ? 1 : -1)]]) {
      if (a + dx >= 0 && a + dx < w && b + dy >= 0 && b + dy < h)
        data.set([165, 222, 186, 255], ((b + dy) * w + a + dx) * 4);
    }
  }
  return { ...source, data };
}

function shots(mode) {
  const isTrack = mode === 'tracking', tracker = P.pixelEffects.createRegionTracker({ minArea: 16, maxMissed: 24, maxDistance: 13 });
  const graph = P.graph.create({
    inputs: { source: 'raster', tracks: 'array<record>', available: 'boolean', quality: 'number' },
    nodes: { receiver: { op: 'fx.signalRecovery', inputs: {
      source: { input: 'source' }, tracks: { input: 'tracks' }, available: { input: 'available' }, quality: { input: 'quality' },
      options: { lossFrames: 3, lockFrames: 3, blendSeconds: .58, ...(isTrack && { trackId: 1, lockAbove: .45 }) }
    } } }, outputs: Object.fromEntries(['value', 'status', 'events'].map(port => [port, { node: 'receiver', port }]))
  });
  return Array.from({ length: count }, (_, frame) => {
    const time = frame / fps, targetVisible = !isTrack || frame < 15 || frame >= 28;
    const { source, detect } = art(frame, targetVisible);
    const tracks = isTrack ? tracker.update(detect, time).value : [];
    const available = isTrack || frame < 15 || frame === 23 || frame >= 28;
    const incoming = !available ? damaged(source, time, frame >= 18 && frame !== 25) :
      isTrack ? markTarget(source, tracks) : source;
    const quality = available ? .97 : 0;
    const { outputs } = graph.evaluate({ source: incoming, available, tracks, quality }, { time });
    const inputLabel = isTrack ? tracks.some(item => item.id === 1) ? 'TRACK 01 VISIBLE' : 'TRACK 01 MISSING' :
      available ? 'CARRIER PRESENT' : 'NO CARRIER';
    return { ...outputs, incoming, inputLabel, time };
  });
}

const timelines = { dropout: shots('dropout'), tracking: shots('tracking') };
const canvas = Object.fromEntries(['input', 'output'].map(id => [id, el(id).getContext('2d', { willReadFrequently: true })]));
const nav = [...document.querySelectorAll('[data-mode]')], cues = [...document.querySelectorAll('button[data-stage]')];
const play = el('play'), scrub = el('scrub');
let mode = 'dropout', frame = Number(scrub.value), playing = false, last, request;
function draw(id, raster) {
  const context = canvas[id], image = context.createImageData(w, h);
  image.data.set(raster.data);
  context.putImageData(image, 0, 0);
}
function timeline() {
  const segments = [];
  for (const row of timelines[mode]) {
    const stage = row.status.stage, last = segments.at(-1);
    if (last?.stage === stage) last.length++;
    else segments.push({ stage, length: 1 });
  }
  el('timeline').replaceChildren(...segments.map(segment => {
    const band = document.createElement('span');
    band.dataset.stage = segment.stage;
    band.style.flex = segment.length;
    return band;
  }));
  const cursor = document.createElement('i'); cursor.id = 'cursor'; el('timeline').append(cursor);
}
function render() {
  const row = timelines[mode][frame], { stage, lastUsableTime, mix, quality } = row.status;
  draw('input', row.incoming); draw('output', row.value);
  Object.assign(el('output').dataset, { frame, stage, mode });
  el('input-label').textContent = row.inputLabel;
  el('output-label').textContent = labels[stage].toUpperCase();
  el('clock').textContent = row.time.toFixed(2) + ' s';
  el('cursor').style.left = (100 * frame / (count - 1)).toFixed(2) + '%';
  el('stage-title').textContent = labels[stage];
  el('stage-copy').textContent = captions[stage];
  el('held').textContent = lastUsableTime == null ? '—' : lastUsableTime.toFixed(2) + ' s';
  el('quality').textContent = Math.round(quality * 100) + '%';
  el('mix').textContent = Math.round(mix * 100) + '%';
  cues.forEach(button => button.setAttribute('aria-current', stage === button.dataset.stage));
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
function seek(at) { transport(false); frame = at; scrub.value = at; render(); }
play.addEventListener('click', () => transport(!playing));
scrub.addEventListener('input', () => seek(Number(scrub.value)));
nav.forEach(button => button.addEventListener('click', () => {
  mode = button.dataset.mode;
  nav.forEach(other => other.setAttribute('aria-pressed', other === button));
  timeline(); render();
}));
cues.forEach(button => button.addEventListener('click', () => {
  const stage = button.dataset.stage;
  const at = timelines[mode].findIndex((row, i) => row.status.stage === stage &&
    (stage === 'relocking' ? row.status.mix >= .3 : stage !== 'locked' || i > 30));
  if (at >= 0) seek(at);
}));
timeline(); render();
</script>
</html>`);
