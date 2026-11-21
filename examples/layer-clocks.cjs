const fs = require('node:fs');
const ink = require('..');

if (!process.argv[2]) throw new Error('Usage: node examples/layer-clocks.cjs <demo.html>');

const tracks = [
  { id: 'carrier', name: 'Carrier', color: '#7bffc7', clock: { rate: 1, phase: 0 } },
  { id: 'orbit', name: 'Orbit', color: '#ffd183', clock: { rate: .65, phase: 1.3,
    cues: [{ time: 1.6, rate: 0 }, { time: 3.5, seek: 0, rate: 1.4 }, { time: 5.5, seek: 'parent', rate: 1 }] } },
  { id: 'echo', name: 'Echo', color: '#c5acff', clock: { rate: 1.35, phase: .65,
    cues: [{ time: 5.5, seek: 'parent', rate: 1 }] } }
];

fs.writeFileSync(process.argv[2], `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Phase observatory</title>
<style>
:root { color-scheme: dark; font-family: system-ui, sans-serif; background: #101413; color: #edf0dc; }
* { box-sizing: border-box; }
body { margin: 0; padding: 32px 32px 24px; }
main { max-width: 1120px; margin: auto; }
header { display: flex; justify-content: space-between; align-items: end; gap: 20px; margin-bottom: 18px; }
h1 { margin: 0 0 4px; font: 500 clamp(37px, 5vw, 68px)/.94 Georgia, serif; letter-spacing: -.055em; }
p { margin: 8px 0 0; color: #adb9a7; font-size: 14px; }
time, .cue, .state, .row, .caption { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; }
time { color: #a8eacb; font-size: 24px; white-space: nowrap; }
.field { position: relative; background: #0d1917; border: 1px solid #3b574c; overflow: hidden; }
canvas { display: block; width: 100%; }
#art { aspect-ratio: 216 / 94; image-rendering: pixelated; }
.caption, .state { position: absolute; padding: 9px 11px; font-size: 11px; letter-spacing: .075em; top: 12px; }
.caption { left: 12px; color: #a7c9b9; }
.state { right: 12px; color: #edf0dc; background: #10231e; border: 1px solid #315347; }
.transport { display: flex; gap: 12px; align-items: center; padding: 12px 0; }
button { color: inherit; background: #1b2a24; border: 1px solid #3c5347; border-radius: 4px; padding: 7px 12px; cursor: pointer; }
button:hover { background: #2a4036; }
button:focus-visible, input:focus-visible { outline: 2px solid #7bffc7; outline-offset: 3px; }
#play { min-width: 70px; }
input { accent-color: #91e8c1; width: 100%; min-width: 55px; }
.tracks { border: 1px solid #35473f; background: #141c19; }
.grid { display: grid; grid-template-columns: 112px minmax(0, 1fr) 104px; align-items: center; }
.events { position: relative; min-height: 36px; border-bottom: 1px solid #2e4139; }
.cue { position: absolute; padding: 3px 6px; font-size: 11px; top: 7px; transform: translateX(-50%); letter-spacing: .04em; }
.cue[data-on="true"] { border-color: #e4c688; color: #fce4aa; }
.row { --hint: #edf0dc; font-size: 12px; color: var(--hint); padding: 0 12px; white-space: nowrap; }
.row output { text-align: right; font-variant-numeric: tabular-nums; }
#plot { height: 108px; }
.stack { display: grid; grid-template-rows: repeat(3, 36px); }
.stack span, .stack output { display: flex; align-items: center; }
.stack output { justify-content: end; }
@media (max-width: 620px) {
  body { padding: 20px 12px; }
  header { align-items: start; }
  p { font-size: 12px; }
  time { font-size: 16px; padding-top: 5px; }
  .caption { display: none; }
  .state { font-size: 9px; top: 6px; right: 6px; }
  .grid { grid-template-columns: 66px minmax(0, 1fr) 60px; }
  .row { padding: 0 7px; font-size: 10px; }
  .cue { padding: 3px; font-size: 9px; }
}
</style>
<main>
  <header>
    <div><h1>Phase observatory</h1><p>Three sprite layers on independent clocks. Scrub to see them converge at 5.5 seconds.</p></div>
    <time id="readout">02.70 s</time>
  </header>
  <div class="field">
    <canvas id="art" width="216" height="94" aria-label="An instrument made of three separately timed pixel art layers"></canvas>
    <span class="caption">LAYER CLOCKS / SIGNAL STUDY</span>
    <span class="state" id="state">ORBIT HELD</span>
  </div>
  <div class="transport">
    <button id="play" type="button">Play</button>
    <input id="scrub" aria-label="Master playhead in seconds" type="range" min="0" max="8" step=".01" value="2.70">
  </div>
  <div class="tracks">
    <div class="grid"><span class="row">MASTER</span><div class="events">
      <button class="cue" type="button" style="left:20%" data-at="1.6">Hold</button>
      <button class="cue" type="button" style="left:43.75%" data-at="3.5">Restart</button>
      <button class="cue" type="button" style="left:68.75%" data-at="5.5">Sync</button>
    </div><span class="row">LOCAL</span></div>
    <div class="grid">
      <div class="stack" id="names"></div>
      <canvas id="plot" role="img" aria-label="Tracks of local time against master time. The orbit track plateaus, restarts at zero and rejoins the other clocks at 5.5 seconds."></canvas>
      <div class="stack" id="locals"></div>
    </div>
  </div>
</main>
<script>${ink.bundle().replace(/<\/script/gi, '<\\/script')}</script>
<script>
const tracks = ${JSON.stringify(tracks)};
const P = KIT.procedural;
const width = 216, height = 94, fps = 8, count = 64, tau = 2 * Math.PI, duration = count / fps;
const art = document.getElementById('art'), ctx = art.getContext('2d', { alpha: false });
const plot = document.getElementById('plot'), graph = plot.getContext('2d');
const scrub = document.getElementById('scrub'), play = document.getElementById('play');
const buttons = [...document.querySelectorAll('.cue')];
const times = Object.fromEntries(tracks.map(({id, clock}) =>
  [id, P.animationGraph.compileClock({ ...clock, range: [0, duration], mode: 'loop' })]));
const phase = t => t * tau / duration;
const surface = document.createElement('canvas');
surface.width = width;
surface.height = height;
const layerCtx = surface.getContext('2d', { willReadFrequently: true });
const pixel = (x, y, color, w = 1, h = 1, pen = layerCtx) => {
  pen.fillStyle = color;
  pen.fillRect(Math.round(x), Math.round(y), w, h);
};
function helix(t, index, base, tilt) {
  const a = phase(t) + index, x = Math.cos(a) * base, y = Math.sin(a) * base * .56;
  return [108 + x * Math.cos(tilt) - y * Math.sin(tilt), 46 + y * Math.cos(tilt) + x * Math.sin(tilt)];
}
function ring(t, r, tilt, light, dark, offset, length) {
  for (let i = 0; i < length; i++) {
    const a = offset + i * .025, [x, y] = helix(t, a, r, tilt);
    pixel(x, y, i % 9 < 5 ? light : dark);
  }
}
const lanterns = {
  carrier(t, light) {
    ring(0, 31, -.32, '#204e3c', '#36654f', 0, 252);
    for (let row = -22; row <= 22; row += 3) {
      for (let column = -23; column <= 23; column++) {
        const r = (column / 24) ** 2 + (row / 24) ** 2;
        if (r > 1) continue;
        const value = Math.cos(column * .31 + phase(t) * 3 + row * .13) * .56
          + Math.sin(row * .43 + phase(t) * 2) * .44;
        if (value > .63) pixel(108 + column, 46 + row, light);
        else if (value > -.35) pixel(108 + column, 46 + row, value > .22 ? '#4aab82' : '#2b654e');
      }
    }
    for (let i = 0; i < 7; i++) {
      const corner = .9 + i * tau / 7;
      const [x, y] = helix(t, corner, 35, -.32);
      pixel(x - 1, y, i ? '#3f9974' : light, i ? 3 : 6, 1);
    }
  },
  orbit(t, light) {
    ring(0, 62, -.32, '#504a35', '#544b3a', 0, 252);
    ring(t, 62, -.32, light, '#9c7951', -.16, 72);
    ring(t, 62, -.32, '#b89363', '#63543d', Math.PI, 48);
    const [x, y] = helix(t, 0, 62, -.32);
    pixel(x - 4, y, light, 9, 1); pixel(x, y - 4, light, 1, 9);
    pixel(x - 1, y - 1, '#fff0c8', 3, 3);
    pixel(x + 7, y - 7, light, 8, 1); pixel(x + 7, y - 6, '#a77d4f', 3, 1);
  },
  echo(t, light) {
    ring(0, 55, .49, '#463d60', '#302d54', 0, 252);
    ring(t, 55, .49, light, '#826da5', .2, 78);
    ring(t, 55, .49, '#806ea0', '#483b64', Math.PI + .7, 55);
    for (let i = 0; i < 4; i++) {
      const [x, y] = helix(t, .24 + i * Math.PI / 2, 55, .49);
      pixel(x - 2, y - 1, i === 0 ? light : '#8c77ad', 5, 3);
      pixel(x - 3, y, light, 7, 1);
    }
    for (let i = 0; i < 11; i++) {
      const x = 44 + i * 13, y = 46 + Math.sin(phase(t) + i * .9) * 8;
      pixel(x, y, '#645179');
      pixel(x, y + 2, '#645179');
    }
  }
};
const layers = Object.fromEntries(tracks.map(({id, color}) => [id, { frames: Array.from({length: count}, (_, i) => {
  layerCtx.clearRect(0, 0, width, height);
  lanterns[id](i / fps, color);
  return layerCtx.getImageData(0, 0, width, height).data;
}) }]));
const sprite = P.graph.raster({ width, height, fps, layers });
const parts = Object.fromEntries(tracks.map(({id, clock}) => [id, { clock }]));
for (const {id, name, color} of tracks) {
  const label = document.createElement('span'), value = document.createElement('output');
  label.className = value.className = 'row';
  label.style.setProperty('--hint', color); value.style.setProperty('--hint', color);
  label.textContent = name; value.id = id + '-time';
  document.getElementById('names').append(label);
  document.getElementById('locals').append(value);
}
const plate = document.createElement('canvas');
plate.width = width; plate.height = height;
const bg = plate.getContext('2d');
const wash = bg.createRadialGradient(108, 46, 5, 108, 46, 100);
wash.addColorStop(0, '#20382d'); wash.addColorStop(.55, '#152824'); wash.addColorStop(1, '#0c1615');
bg.fillStyle = wash; bg.fillRect(0, 0, width, height);
for (let y = 7; y < height - 5; y += 4) for (let x = 6; x < width - 5; x += 4)
  pixel(x, y, (x + y) % 12 ? '#20352d' : '#2b4639', 1, 1, bg);
for (const side of [0, 1]) {
  const x = side ? 199 : 16;
  pixel(x, 23, '#3b6150', 1, 48, bg);
  for (let i = 0; i <= 12; i++) pixel(x + (side ? -1 : 1), 23 + i * 4, '#527965', i % 3 ? 2 : 4, 1, bg);
}
pixel(32, 46, '#53725e', 14, 1, bg); pixel(173, 46, '#53725e', 14, 1, bg);
const pathSamples = tracks.map(({id}) => {
  // Break the trace at each jump. Sample both sides of the authored time.
  const marks = [...new Set([...Array.from({length: 401}, (_, i) => i / 50),
    ...parts[id].clock.cues?.flatMap(({time}) => [time - .000001, time]) ?? []])].sort((a, b) => a - b);
  return marks.map(time => [time, times[id].sample(time).value]);
});
function timeline(time) {
  const w = Math.round(plot.clientWidth * devicePixelRatio), h = Math.round(plot.clientHeight * devicePixelRatio);
  if (!w || !h) return;
  if (plot.width !== w || plot.height !== h) { plot.width = w; plot.height = h; }
  const row = h / 3;
  graph.clearRect(0, 0, w, h);
  for (let i = 0; i <= 8; i++) {
    graph.fillStyle = '#2c4136'; graph.fillRect(w * i / 8, 0, 1, h);
  }
  [1.6, 3.5, 5.5].forEach(t => {
    graph.fillStyle = '#516756'; graph.fillRect(w * t / duration, 0, 1, h);
  });
  tracks.forEach(({id, color}, i) => {
    const y = value => row * (i + 1) - (6 + value * 2.8) * devicePixelRatio;
    graph.fillStyle = '#2c4136'; graph.fillRect(0, row * (i + 1), w, 1);
    graph.beginPath();
    let prior;
    for (const [at, value] of pathSamples[i]) {
      const x = w * at / duration;
      if (prior !== undefined && Math.abs(value - prior) < .2) graph.lineTo(x, y(value));
      else graph.moveTo(x, y(value));
      prior = value;
    }
    graph.strokeStyle = color; graph.lineWidth = 1.5 * devicePixelRatio; graph.stroke();
    graph.beginPath(); graph.arc(w * time / duration, y(times[id].sample(time).value), 3.5 * devicePixelRatio, 0, tau);
    graph.fillStyle = color; graph.fill();
  });
  graph.fillStyle = '#edf0dcad'; graph.fillRect(w * time / duration - .5, 0, 1, h);
}
let current = +scrub.value, playing = false, then, request;
const number = new Intl.NumberFormat('en', { minimumIntegerDigits: 2, minimumFractionDigits: 2, maximumFractionDigits: 2 });
const display = t => number.format(t) + ' s';
function render(time) {
  current = time;
  scrub.value = time;
  document.getElementById('readout').textContent = display(time);
  const { value, frames } = sprite.spriteDesync({ time, parts });
  layerCtx.putImageData(new ImageData(new Uint8ClampedArray(value.data), width, height), 0, 0);
  ctx.drawImage(plate, 0, 0);
  ctx.drawImage(surface, 0, 0);
  tracks.forEach(({id}) => { document.getElementById(id + '-time').textContent = display(times[id].sample(time).value); });
  let stage = 'INDEPENDENT';
  if (time >= 5.5) stage = 'IN SYNC';
  else if (time >= 3.5) stage = 'ORBIT RESTARTED';
  else if (time >= 1.6) stage = 'ORBIT HELD';
  document.getElementById('state').textContent = stage;
  art.dataset.frames = JSON.stringify(frames.parts);
  buttons.forEach((button, i) => {
    button.dataset.on = time >= Number(button.dataset.at) && (!buttons[i + 1] || time < Number(buttons[i + 1].dataset.at));
  });
  timeline(time);
}
function step(now) {
  if (!playing) return;
  if (then !== undefined) render((current + Math.min(.1, (now - then) / 1000)) % duration);
  then = now;
  request = requestAnimationFrame(step);
}
function transport(active) {
  if (active === playing) return;
  playing = active;
  play.textContent = playing ? 'Pause' : 'Play';
  then = undefined;
  if (playing) request = requestAnimationFrame(step);
  else cancelAnimationFrame(request);
}
play.addEventListener('click', () => transport(!playing));
scrub.addEventListener('input', () => { transport(false); render(+scrub.value); });
buttons.forEach(button => button.addEventListener('click', () => { transport(false); render(+button.dataset.at); }));
addEventListener('resize', () => timeline(current));
render(current);
</script>
</html>
`);
