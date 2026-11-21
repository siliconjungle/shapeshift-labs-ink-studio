const fs = require('node:fs');
const { gzipSync } = require('node:zlib');
const ink = require('..');

if (!process.argv[2]) throw new Error('Usage: node examples/subject-feedback.cjs <demo.html>');

const width = 208, height = 116, chartWidth = 96, chartHeight = 54, fps = 12, count = 48;
const { KIT, makeBuilder, SpriteSurface } = ink.load(), P = KIT.procedural;
const atlasBuilder = SpriteSurface.make(256, 384);
const atmosphere = (x, y) => {
  const skyline = 78 + 4 * Math.sin(x * .09) - 3 * Math.cos(x * .2);
  if (y >= 88) {
    if (y % 7 === 0 || Math.floor(x + (x - 104) * (y - 87) * .018) % 22 === 1) return 0x344657;
    return y % 3 === 0 ? 0x1d2e3c : 0x202f40;
  }
  if (y > skyline) return x % 7 < 2 ? 0x243c4a : 0x182b3d;
  if (x % 17 === 6 && y % 13 === 9) return 0x536577;
  if ((x * 13 + y * 7 + x * y) % 81 === 0 && y > 13) return 0x3a536a;
  return y > 59 ? 0x203244 : y > 39 ? 0x1c2b3e : 0x18273a;
};
atlasBuilder.face([-4.8, -2.7, -2.6], [9.6, 0, 0], [0, 5.4, 0], width, height, atmosphere);
const region = atlasBuilder.reserve(chartWidth, chartHeight, (x, y) => {
  const edge = Math.min(x, chartWidth - 1 - x), rim = Math.min(y, chartHeight - 1 - y);
  if (edge + rim < 6) return;
  if (edge < 2 || rim < 2 || edge + rim === 6) return y > chartHeight / 2 ? 0x344c62 : 0x76939e;
  if (rim < 6 && x % 5 === 2) return 0x89a0a2;
  if (y === 10 || y === chartHeight - 10 || x % 16 === 5 && y % 8 === 3) return 0x42626c;
  return (x + y * 2) % 13 === 0 ? 0x304754 : 0x243b4c;
});
const points = [], uvs = [], triangles = [], cols = 19, rows = 5;
for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) {
  const u = i / cols, v = j / rows;
  points.push((u - .5) * 2.25, (.5 - v) * 1.27, 0);
  uvs.push(u, v);
  if (i < cols && j < rows) {
    const p = j * (cols + 1) + i;
    triangles.push(p, p + 1, p + cols + 1, p + 1, p + cols + 2, p + cols + 1);
  }
}
atlasBuilder.meshRegion({ points, uvs, triangles }, region, { id: 'receiver' });
const frontStart = 6 + triangles.length;
atlasBuilder.face([-.5, -1.59, .95], [1, 0, 0], [0, 3.15, 0], 33, 92, (x, y) => {
  if (x < 2 || x > 30) return x < 2 ? 0x657582 : 0x152a38;
  if (y < 7 || y > 85) return (x + y) % 7 < 3 ? 0xbaa074 : 0x414b53;
  if (y === 12 || y === 77) return 0x9b8d6f;
  if (x === 4 || x === 28 || y % 12 === 0) return 0x3f5260;
  if (x > 11 && x < 23 && (y > 36 && y < 42 || y > 68 && y < 72)) return y % 2 ? 0x9aa98d : 0xb8bf96;
  return x < 10 ? 0x2b4150 : 0x263747;
});
const atlas = atlasBuilder.finish(), world = makeBuilder(51, [0x172638]).finish({
  cam: { target: [0, .04, 0], dist: 4.5, yaw: 0, pitch: 0 }, radius: 6, spriteSurfaces: atlas
});
const chart = P.subjectFeedback.create({ width: chartWidth, height: chartHeight, halfLife: 2.55,
  filter: 'linear', velocity: [5, -2.1], gain: .94 });
const binding = P.subjectFeedback.bindAtlas(atlas, region), chartMesh = atlas.vertices.subarray(6 * 5, frontStart * 5);
const smooth = t => t * t * (3 - 2 * t);
const view = { w: width, h: height, px: 1, raw: true, ortho: true };
const asText = bytes => Buffer.from(bytes).toString('base64');

function paint(frame) {
  if (frame > 14) return null;
  const data = new Uint8Array(chartWidth * chartHeight * 4);
  for (let k = 0; k < 2; k++) {
    const u = 16 + frame * (3.4 - .31 * k), v = 27 + 6 * Math.sin(frame * .32) + k * 9 - 4;
    for (let y = 4; y < chartHeight - 4; y++) for (let x = 5; x < chartWidth - 5; x++) {
      const r = Math.hypot((x - u) * .84, y - v), p = (y * chartWidth + x) * 4;
      if (r > 5.35 || r > 3.9 && (x + 3 * y) % 5 === 0) continue;
      const color = k ? (r < 2 ? [204, 255, 225] : [77, 206, 173]) :
        (r < 2 ? [255, 236, 155] : r < 3.8 ? [255, 177, 88] : [236, 110, 68]);
      data.set([...color, r < 3.8 ? 255 : 154], p);
    }
  }
  return { width: chartWidth, height: chartHeight, channels: 4, data };
}
const encoded = Array.from({ length: count }, (_, index) => {
  const time = index / fps, t = index / (count - 1), slide = -1.96 + 3.92 * smooth(t);
  const angle = .37 * Math.sin(time * 1.96) + .07, c = Math.cos(angle), s = Math.sin(angle);
  for (let i = 0; i < triangles.length; i++) {
    const u = uvs[triangles[i] * 2], v = uvs[triangles[i] * 2 + 1];
    const x = (u - .5) * 2.25;
    const z = .27 * Math.sin(Math.PI * u) + .065 * Math.sin(u * 8 + time * 2) * Math.sin(Math.PI * v);
    chartMesh[i * 5] = slide + c * x + s * z;
    chartMesh[i * 5 + 1] = (.5 - v) * 1.27 + .075 * Math.cos(time * 1.4 + u * 4);
    chartMesh[i * 5 + 2] = -s * x + c * z;
  }
  SpriteSurface.markGeometryDirty(atlas, { first: 6, count: triangles.length });
  const { value } = chart.sample(paint(index), time);
  binding.apply(value);
  const visible = ink.render(world, { ...view, t: time }).rgb;
  const hidden = ink.render({ ...world, spriteSurfaces: { ...atlas, vertices: atlas.vertices.slice(0, frontStart * 5) } },
    { ...view, t: time }).rgb;
  return [asText(visible), asText(hidden), asText(value.data)];
});
const packed = gzipSync(JSON.stringify(encoded)).toString('base64');

fs.writeFileSync(process.argv[2], `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Wakeplate</title>
<style>
:root { color-scheme: dark; background: #131922; color: #ecede3; font-family: system-ui, sans-serif; }
* { box-sizing: border-box; }
body { margin: 0; padding: 34px 28px 27px; }
main { max-width: 1170px; margin: auto; }
header { display: flex; align-items: end; justify-content: space-between; gap: 18px; margin-bottom: 22px; }
h1 { margin: 4px 0 9px; font: 500 clamp(45px, 8vw, 91px)/.87 Georgia, serif; letter-spacing: -.055em; }
p { margin: 0; color: #b5c5cb; font-size: 14px; }
.mono, figcaption, button, label, output, time { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; }
.mono { color: #accfc1; font-size: 11px; letter-spacing: .14em; }
button { cursor: pointer; border: 1px solid #516674; border-radius: 3px; background: #263743; color: #e0ede7; padding: 8px 12px; }
button[aria-pressed="true"] { background: #314a4b; border-color: #83b39d; color: #dbf3d5; }
button:focus-visible, input:focus-visible { outline: 2px solid #a0d2bb; outline-offset: 2px; }
.controls { display: flex; flex-wrap: wrap; gap: 7px; justify-content: end; }
.grid { display: grid; grid-template-columns: 1.62fr 1fr; gap: 13px; align-items: stretch; }
figure { min-width: 0; margin: 0; background: #192936; border: 1px solid #455c69; }
figcaption { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 38px;
  padding: 8px 12px; border-bottom: 1px solid #455c69; color: #c7d8db; font-size: 11px; letter-spacing: .065em; }
figcaption span:last-child { text-align: right; color: #b7e0c8; }
canvas { width: 100%; display: block; image-rendering: pixelated; }
#scene { aspect-ratio: 208 / 116; }
.chart { display: flex; flex-direction: column; }
.chart-sheet { flex: 1; padding: 17px; display: grid; place-items: center; min-height: 160px;
  background: repeating-linear-gradient(0deg, transparent 0px, transparent 17px, #4a656848 17px, #4a656848 18px),
    repeating-linear-gradient(90deg, transparent 0px, transparent 17px, #4a656848 17px, #4a656848 18px), #1a2b36; }
#chart { aspect-ratio: 96 / 54; border: 1px solid #6a8a85; background: #182630aa; }
.chart p { padding: 13px 14px 14px; border-top: 1px solid #455c69; }
.transport { display: flex; align-items: center; gap: 13px; padding: 15px 0 10px; }
#play { min-width: 67px; }
#scrub { flex: 1; width: 100%; min-width: 48px; accent-color: #90c0ad; }
time { color: #bcddcb; white-space: nowrap; font-size: 12px; }
.cues { display: flex; gap: 8px; flex-wrap: wrap; }
@media(max-width: 705px) {
  body { padding: 19px 12px; }
  header { flex-direction: column; align-items: start; gap: 12px; margin-bottom: 14px; }
  .controls { justify-content: start; }
  .grid { grid-template-columns: 1fr; gap: 8px; }
  .chart-sheet { min-height: 0; padding: 8px 12px; }
  #chart { max-width: 220px; }
  .chart p { font-size: 12px; padding: 8px 10px; }
  figcaption { padding: 7px; min-height: 32px; font-size: 10px; }
}
</style>
<main>
<header>
  <div><span class="mono">INK STUDIO / SUBJECT-ATTACHED FEEDBACK</span><h1>Wakeplate</h1><p>Feedback keeps moving across a curved surface as the receiver passes behind the gate.</p></div>
  <div class="controls" aria-label="Occlusion">
    <button id="gate" type="button" aria-pressed="true">Show gate</button>
    <button id="reveal" type="button" aria-pressed="false">Reveal receiver</button>
  </div>
</header>
<div class="grid">
  <figure><figcaption><span>DEPTH-TESTED SCENE</span><span id="stage"></span></figcaption>
    <canvas id="scene" width="${width}" height="${height}" aria-label="Curved receiver moving behind a foreground gate"></canvas></figure>
  <figure class="chart"><figcaption><span>RETAINED SURFACE CHART</span><span id="source"></span></figcaption>
    <div class="chart-sheet"><canvas id="chart" width="${chartWidth}" height="${chartHeight}" aria-label="UV history stays on the moving receiver"></canvas></div>
    <p>The same stored texels stay on the receiver as it moves, turns, and bends.</p>
  </figure>
</div>
<div class="transport">
  <button id="play" type="button">Play</button>
  <input id="scrub" aria-label="Source frame" type="range" min="0" max="${count - 1}" step="1" value="22">
  <time id="time"></time>
</div>
<div class="cues" aria-label="Shot moments">
  <button type="button" data-at="12">Approach</button>
  <button type="button" data-at="22">Behind the gate</button>
  <button type="button" data-at="37">Emergence</button>
</div>
</main>
<script type="module">
const packed = Uint8Array.from(atob('${packed}'), c => c.charCodeAt(0));
const decoded = await new Response(new Blob([packed]).stream().pipeThrough(new DecompressionStream('gzip'))).json();
const el = id => document.getElementById(id);
const scene = el('scene'), chart = el('chart'), scrub = el('scrub'), play = el('play');
const cues = [...document.querySelectorAll('[data-at]')];
const count = decoded.length, fps = ${fps};
let frame = +scrub.value, gate = true, playing = false, last, request;
function draw(target, bytes, channels) {
  const data = atob(bytes), context = target.getContext('2d', { willReadFrequently: true }), image = context.createImageData(target.width, target.height);
  for (let p = 0; p < image.data.length / 4; p++) {
    for (let c = 0; c < 3; c++) image.data[p * 4 + c] = data.charCodeAt(p * channels + c);
    image.data[p * 4 + 3] = channels === 4 ? data.charCodeAt(p * channels + 3) : 255;
  }
  context.putImageData(image, 0, 0);
}
function render(at) {
  frame = at; scrub.value = at;
  draw(scene, decoded[at][gate ? 0 : 1], 3); draw(chart, decoded[at][2], 4);
  scene.dataset.frame = at;
  el('time').textContent = (at / fps).toFixed(2) + ' s';
  el('stage').textContent = gate ? at < 17 ? 'APPROACH' : at < 31 ? 'BEHIND GATE' : 'EMERGENCE' : 'GATE HIDDEN';
  el('source').textContent = at <= 14 ? 'FEED ACTIVE' : 'RETAINED ONLY';
  cues.forEach(cue => cue.setAttribute('aria-pressed', +cue.dataset.at === at));
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
  play.textContent = on ? 'Pause' : 'Play';
  if (on) request = requestAnimationFrame(step); else cancelAnimationFrame(request);
}
play.addEventListener('click', () => transport(!playing));
scrub.addEventListener('input', () => { transport(false); render(+scrub.value); });
cues.forEach(cue => cue.addEventListener('click', () => { transport(false); render(+cue.dataset.at); }));
for (const id of ['gate', 'reveal']) el(id).addEventListener('click', () => {
  gate = id === 'gate';
  el('gate').setAttribute('aria-pressed', gate);
  el('reveal').setAttribute('aria-pressed', !gate);
  render(frame);
});
render(frame);
</script>
</html>`);
