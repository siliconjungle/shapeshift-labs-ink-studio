const fs = require('node:fs');
const path = require('node:path');
const { gzipSync } = require('node:zlib');
const ink = require('..');

const width = 144, height = 86, fps = 16, frames = 36, tau = Math.PI * 2;
const link = (node, port = 'value') => ({ node, port });
const graph = { output: 'scene', passes: [
  { id: 'field-stop', type: 'mask', rect: [21, 9, 89, 67], feather: 5 },
  { id: 'signal', type: 'composite', isolated: true, source: 'scene', mask: 'field-stop', opacity: .86 }
] };

function relay(kit) {
  const B = kit.makeBuilder(31, [0x0b1423, 0x224555, 0x3b7f82, 0x73cdb7, 0xc5f3c2, 0xffdf8a, 0xf68e62, 0x734454, 0xb85c77]);
  const actors = [];
  function lantern(x, y, scale, colors, phase) {
    const first = B.count();
    const dab = (a, b, c, radius, color, opacity = 2.15, facing = [0, 0, 1]) =>
      B.disc(x + a * scale, y + b * scale, c * scale, facing, radius * scale, .025 * scale, B.P[colors[color]], opacity);
    for (let j = 1; j < 10; j++) for (let i = 0; i < 29; i++) {
      const tilt = j / 10 * Math.PI, turn = tau * i / 29;
      const nx = Math.sin(tilt) * Math.cos(turn), nz = Math.sin(tilt) * Math.sin(turn), ny = Math.cos(tilt);
      const highlight = ny + nz * .55 - nx * .3;
      const flute = Math.cos(turn * 7 + tilt * 1.25);
      dab(nx * .54, ny * .46, nz * .44, .077,
        highlight > .55 && flute > -.25 ? 3 : highlight > .07 ? 2 : highlight > -.5 ? 1 : 0,
        2.5, [nx, ny, nz]);
    }
    for (let i = 0; i < 56; i++) {
      const angle = tau * i / 56, cosine = Math.cos(angle), sine = Math.sin(angle);
      dab(cosine * .7, -.16 + sine * .17, sine * .55, .052, i % 8 < 3 ? 4 : 2);
      if (i % 3 === 0) dab(cosine * .66, .2 + sine * .13, sine * .55, .035, 3);
    }
    for (let i = 0; i < 9; i++) for (let j = 0; j < 12; j++) {
      const u = j / 11, edge = (i - 4) / 4;
      const bend = Math.sin(4.25 * u + i * .76);
      dab(edge * (.48 - u * .16) + .15 * bend * u, -.32 - u * (.63 + .25 * Math.cos(i)),
        .16 + .23 * Math.cos(i * 1.3) * (1 - u), .045 - u * .017, j % 5 === 0 ? 4 : j < 5 ? 2 : 1,
        2.3 - u * 1.2);
    }
    actors.push({ first, end: B.count(), phase, scale });
  }
  lantern(-.98, .42, 1, [1, 2, 3, 4, 5], 0);
  lantern(1.08, -.13, .66, [7, 8, 6, 5, 4], 1.3);
  const world = B.finish({ cam: { target: [0, 0, 0], dist: 5, yaw: -.15, pitch: .08 },
    radius: 4, dither: .18, look: { splatCoverage: 'continuous' } });
  return ({ time }) => {
    const data = world.data.slice(), pulse = time / (frames / fps) * tau;
    for (const { first, end, phase, scale } of actors) {
      const dx = Math.sin(pulse + phase) * .23;
      const dy = Math.cos(pulse + phase) * .14;
      const dz = Math.sin(pulse * 2 + phase) * .11;
      for (let i = first; i < end; i++) {
        const at = i * 16;
        data[at] += dx;
        data[at + 1] += dy;
        data[at + 2] += dz * scale;
      }
    }
    return { ...world, data };
  };
}
function record(kit) {
  const build = relay(kit);
  const project = ink.createGraphProject({
    format: 'ink-studio/graph-project', version: 1, nodes: {
      world: { op: 'relay.world' },
      render: { op: 'scene.render', inputs: { source: link('world'), channels: ['depth', 'motion'],
        renderGraphCapture: ['signal'], options: { width, height, transparent: true, raw: true, renderGraph: graph } } }
    }, outputs: { image: link('render', 'frame') }
  }, { kit, operations: { 'relay.world': { time: true, outputs: { value: 'world' },
    run(_, clock) { return { value: build(clock) }; } } } });
  const span = { output: 'image', from: 0, to: frames, format: 'sample', clock: { fps } };
  const capture = settings => project.clip({ ...span, capture: settings }).artifacts[0].bytes.toString();
  return {
    live: capture({ depth: false, motion: false }),
    pass: capture({ pass: 'graph:signal' }),
    region: capture({ region: 1, tracking: { threshold: 38, minArea: 24, maxDistance: 22 } })
  };
}

function page(samples) {
  const json = '{"live":' + samples.live + ',"pass":' + samples.pass + ',"region":' + samples.region + '}';
  const packed = gzipSync(json).toString('base64');
  return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Afterimage relay</title>
<style>
:root { color-scheme: dark; background: #0b121b; color: #ece7d6; font-family: system-ui, sans-serif; }
* { box-sizing: border-box; }
body { margin: 0; padding: 30px 28px 26px; }
main { margin: auto; max-width: 1152px; }
header { display: flex; justify-content: space-between; gap: 18px; align-items: end; padding-bottom: 18px; }
h1 { font: 500 clamp(37px, 5.8vw, 74px)/.93 Georgia, serif; letter-spacing: -.055em; margin: 2px 0 8px; }
p { margin: 0; color: #aebccb; font-size: 14px; }
.mono, button, label, figcaption, time { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; }
.mono { color: #97c8c2; font-size: 11px; letter-spacing: .1em; }
button, select { border-radius: 3px; border: 1px solid #395268; background: #152536; color: #e6e7d9; padding: 8px 11px; }
button { cursor: pointer; }
button[aria-pressed="true"] { background: #234151; border-color: #70b0aa; color: #c4f6dc; }
button:focus-visible, input:focus-visible, select:focus-visible { outline: 2px solid #95d7c7; outline-offset: 2px; }
.switcher { display: flex; gap: 8px; flex-wrap: wrap; justify-content: end; }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
figure { min-width: 0; margin: 0; border: 1px solid #334859; background: #101d2a; }
figcaption { min-height: 35px; display: flex; align-items: center; justify-content: space-between; gap: 8px;
  padding: 8px 12px; font-size: 11px; letter-spacing: .065em; color: #aac2ce; border-bottom: 1px solid #334859; }
figcaption span:last-child { color: #c9ebd6; text-align: right; }
.view { position: relative; background:
  radial-gradient(ellipse at 50% 30%, #243e4b9e, transparent 75%),
  repeating-linear-gradient(0deg, #3d697320 0px, #3d697320 1px, transparent 1px, transparent 24px),
  repeating-linear-gradient(90deg, #3d697320 0px, #3d697320 1px, transparent 1px, transparent 24px),
  #101d2a; }
.reuse { background:
  conic-gradient(#1d3040 25%, #152736 0 50%, #1d3040 0 75%, #152736 0) 0 0 / 20px 20px; }
canvas { width: 100%; display: block; image-rendering: pixelated; }
.view canvas { aspect-ratio: 144 / 86; }
.hud { position: absolute; top: 10px; left: 12px; color: #afd2d7; pointer-events: none; }
.transport { display: flex; align-items: center; gap: 13px; padding: 13px 0; }
input { accent-color: #93d7c5; width: 100%; min-width: 60px; }
label, time { white-space: nowrap; font-size: 11px; color: #bcd1d7; }
select { padding: 5px 5px; font-size: 12px; }
.aux canvas { aspect-ratio: 144 / 43; background: #101b28; }
@media (max-width: 720px) {
  body { padding: 18px 12px; }
  header { align-items: start; flex-direction: column; gap: 12px; }
  .switcher { justify-content: start; }
  .grid { gap: 8px; }
  figcaption { padding: 6px; font-size: 9px; }
  .hud { display: none; }
  .transport { gap: 8px; }
  .aux canvas { aspect-ratio: 144 / 55; }
}
</style>
<main>
<header>
  <div><span class="mono">INK STUDIO / VISUAL RESAMPLING</span><h1>Afterimage relay</h1><p>Replay an isolated pass or tracked lantern on a separate clock.</p></div>
  <div class="switcher" aria-label="Captured source">
    <button id="pass" type="button" aria-pressed="false">Render pass</button>
    <button id="region" type="button" aria-pressed="true">Tracked region</button>
  </div>
</header>
<div class="grid">
  <figure><figcaption><span>ORIGINAL SPAN</span><span id="live-frame"></span></figcaption>
    <div class="view"><span class="hud mono">SOURCE</span><canvas id="live-view" width="${width}" height="${height}" aria-label="Original rendered scene"></canvas></div>
  </figure>
  <figure><figcaption><span id="sample-title">TRACKED REGION 01</span><span id="sample-frame"></span></figcaption>
    <div class="view reuse"><span class="hud mono">REPLAY</span><canvas id="sample-view" width="${width}" height="${height}" aria-label="Captured layer over a transparency checkerboard"></canvas></div>
  </figure>
</div>
<div class="transport">
  <button id="play" type="button">Play</button>
  <input id="scrub" type="range" aria-label="Master playhead" min="0" max="4.48" step=".01" value="1.36">
  <time id="time"></time>
  <label>Rate <select id="rate" aria-label="Replay rate"><option value=".5">½×</option><option value="1">1×</option><option value="1.5">1½×</option></select></label>
</div>
<div class="grid aux">
  <figure><figcaption><span>RETAINED DEPTH</span><span>AXIAL</span></figcaption><canvas id="depth" width="${width}" height="${height / 2}" aria-label="Retained depth visualized from near to far"></canvas></figure>
  <figure><figcaption><span>RETAINED MOTION</span><span>XY PIXELS</span></figcaption><canvas id="motion" width="${width}" height="${height / 2}" aria-label="Retained motion vector visualization"></canvas></figure>
</div>
</main>
<script>${ink.bundle().replace(/<\/script/gi, '<\\/script')}</script>
<script type="module">
const P = KIT.procedural, V = P.visualResampling;
const packed = Uint8Array.from(atob('${packed}'), value => value.charCodeAt(0));
const source = await new Response(new Blob([packed]).stream().pipeThrough(new DecompressionStream('gzip'))).json();
const clips = Object.fromEntries(Object.entries(source).map(([id, clip]) => [id, V.compile(clip)]));
const el = id => document.getElementById(id);
const scrub = el('scrub'), play = el('play'), rate = el('rate'), length = ${frames / fps};
const canvas = el('sample-view'), width = canvas.width, height = canvas.height;
const backing = document.createElement('canvas');
backing.width = width; backing.height = height;
const staging = backing.getContext('2d');
let current = +scrub.value, mode = 'region', playing = false, then, request;
function paint(target, raster, bounds) {
  const ctx = target.getContext('2d');
  ctx.clearRect(0, 0, target.width, target.height);
  if (!raster) return;
  staging.putImageData(new ImageData(Uint8ClampedArray.from(raster.data), width, height), 0, 0);
  ctx.imageSmoothingEnabled = false;
  if (!bounds) return;
  const { left, right, top, bottom } = bounds;
  const w = right - left + 1, h = bottom - top + 1, scale = Math.min(1.25, (target.height - 6) / h, target.width / w);
  ctx.drawImage(backing, (target.width - w * scale) / 2 - left * scale,
    (target.height - h * scale) / 2 - top * scale, width * scale, height * scale);
}
function show(id, { data }) {
  const ctx = el(id).getContext('2d');
  ctx.putImageData(new ImageData(Uint8ClampedArray.from(data), width, height), 0, 0);
}
function getBounds(raster) {
  let left = width, top = height, right = -1, bottom = -1;
  for (let i = 0; i < width * height; i++) if (raster.data[i * 4 + 3] > 64) {
    const x = i % width, y = Math.floor(i / width);
    left = Math.min(left, x); right = Math.max(right, x);
    top = Math.min(top, y); bottom = Math.max(bottom, y);
  }
  return right >= 0 ? { left, right, top, bottom } : null;
}
function depth(showing) {
  if (!showing.depth) return null;
  const values = showing.depth.data, valid = showing.depthValid.data;
  let near = Infinity, far = -Infinity;
  for (let i = 0; i < values.length; i++) if (valid[i]) {
    near = Math.min(near, values[i]); far = Math.max(far, values[i]);
  }
  const image = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < values.length; i++) if (valid[i]) {
    const blend = (values[i] - near) / (far - near || 1), p = i * 4;
    image[p] = 100 - blend * 73; image[p + 1] = 227 - blend * 125;
    image[p + 2] = 186 - blend * 69; image[p + 3] = 255;
  }
  return { data: image };
}
function vectors(showing) {
  if (!showing.motion) return null;
  const values = showing.motion.data, valid = showing.motionValid.data;
  staging.clearRect(0, 0, width, height);
  staging.fillStyle = '#255864';
  for (let i = 0; i < valid.length; i++) if (valid[i]) staging.fillRect(i % width, Math.floor(i / width), 1, 1);
  for (let y = 3; y < height; y += 5) for (let x = 3; x < width; x += 5) {
    const i = y * width + x;
    if (!valid[i]) continue;
    const dx = values[i * 2], dy = values[i * 2 + 1];
    staging.strokeStyle = dx >= 0 ? '#ebc977' : '#ee9476';
    staging.fillStyle = staging.strokeStyle;
    staging.fillRect(x, y, 1, 1);
    staging.beginPath(); staging.moveTo(x + .5, y + .5);
    staging.lineTo(x + .5 + 3 * dx, y + .5 + 3 * dy); staging.stroke();
  }
  return staging.getImageData(0, 0, width, height);
}
function render(time) {
  current = time; scrub.value = time;
  const live = clips.live.sample(time, { mode: 'loop' });
  const sample = clips[mode].sample(time, { mode: 'loop', rate: +rate.value, phase: mode === 'pass' ? .07 : .29 });
  show('live-view', live.value);
  show('sample-view', sample.value);
  const bounds = getBounds(sample.value);
  paint(el('depth'), depth(sample), bounds);
  paint(el('motion'), vectors(sample), bounds);
  el('time').textContent = time.toFixed(2) + ' s';
  el('live-frame').textContent = 'FRAME ' + String(live.info.sourceFrame).padStart(2, '0');
  el('sample-frame').textContent = 'FRAME ' + String(sample.info.sourceFrame).padStart(2, '0');
  el('sample-title').textContent = mode === 'pass' ? 'PASS / SIGNAL' : 'TRACKED REGION 01';
  canvas.dataset.frame = sample.info.sourceFrame;
  canvas.dataset.validDepth = sample.depthValid ? sample.depthValid.data.filter(Boolean).length : 0;
  canvas.dataset.validMotion = sample.motionValid ? sample.motionValid.data.filter(Boolean).length : 0;
}
function step(now) {
  if (!playing) return;
  if (then !== undefined) render((current + Math.min(.1, (now - then) / 1000)) % (2 * length));
  then = now;
  request = requestAnimationFrame(step);
}
function transport(on) {
  playing = on; then = undefined;
  play.textContent = on ? 'Pause' : 'Play';
  if (on) request = requestAnimationFrame(step);
  else cancelAnimationFrame(request);
}
play.addEventListener('click', () => transport(!playing));
scrub.addEventListener('input', () => { transport(false); render(+scrub.value); });
rate.addEventListener('change', () => render(current));
for (const name of ['region', 'pass']) el(name).addEventListener('click', () => {
  mode = name;
  for (const button of ['region', 'pass']) el(button).setAttribute('aria-pressed', button === name);
  render(current);
});
render(current);
</script>
</html>`;
}

if (!process.argv[2]) throw new Error('Usage: node examples/visual-resampling.cjs <demo.html>');
const samples = record(ink.load()), target = path.resolve(process.argv[2]);
fs.mkdirSync(path.dirname(target), { recursive: true });
for (const name of ['pass', 'region']) fs.writeFileSync(target.replace(/\.html$/i, '') + '-' + name + '.json', samples[name]);
fs.writeFileSync(target, page(samples));
