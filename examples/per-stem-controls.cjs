const fs = require('node:fs');
const path = require('node:path');
const ink = require('..');

if (!process.argv[2]) throw new Error('Usage: node examples/per-stem-controls.cjs <demo.html>');

const sampleRate = 24000, duration = 4.8, frames = Math.round(sampleRate * duration);
const bank = Object.fromEntries(['drums', 'bass', 'air'].map(name => [name, new Float64Array(frames)]));
function note(stem, time, length, render) {
  const begin = Math.round(time * sampleRate), count = Math.min(Math.round(length * sampleRate), frames - begin);
  for (let i = 0; i < count; i++) bank[stem][begin + i] += render(i / sampleRate, i / count);
}
for (const time of [.22, .91, 1.58, 2.31, 2.98, 3.68, 4.35]) {
  note('drums', time, .28, t => .87 * Math.exp(-20 * t) *
    Math.cos(2 * Math.PI * (48 * t + .8 * (1 - Math.exp(-46 * t)))));
}
for (const [time, length, hz] of [[.48,.62,84], [1.25,.83,70], [2.24,1.05,94], [3.39,.56,77], [4.02,.63,83]]) {
  note('bass', time, length, (t, phase) => .71 * Math.sin(Math.PI * phase) ** 1.4 * Math.sin(Math.PI * 2 * hz * t));
}
for (const time of [.68, 1.09, 1.88, 2.63, 3.21, 3.91, 4.47]) {
  note('air', time, .31, t => .52 * Math.exp(-10 * t) *
    (.65 * Math.cos(Math.PI * 2 * 2730 * t) + .35 * Math.sin(Math.PI * 2 * 3100 * t)));
}
const mix = Float64Array.from(bank.drums, (n, i) => .48 * (n + bank.bass[i] + bank.air[i]));
const waves = Object.fromEntries(Object.entries({ ...bank, mix }).map(([name, samples]) =>
  [name, ink.encodeWav({ sampleRate, channels: 1, samples }).toString('base64')]));
const settings = {
  drums: { envelope: { measure: 'peak', attack: .004, release: .075, threshold: .40, resetThreshold: .21 } },
  bass: { fft: { size: 2048 }, bands: { low: { hz: [50, 135], attack: .105, release: .20, threshold: .24, resetThreshold: .16 } } },
  air: { fft: { size: 1024 }, bands: { high: { hz: [2200, 3300], attack: .009, release: .18, threshold: .16, resetThreshold: .09 } } }
};
const panels = [
  { name: 'drums', title: 'Drums', lane: 'envelope', caption: 'Peak envelope', tint: '#ffb17f', shape: 'diamond' },
  { name: 'bass', title: 'Bass', lane: 'low', caption: '50–135 Hz', tint: '#a6eac1', shape: 'orbit' },
  { name: 'air', title: 'Air', lane: 'high', caption: '2.2–3.3 kHz', tint: '#c3b9ff', shape: 'prism' }
];

const html = `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Per-stem control signals · Ink Studio</title>
<style>
  * { box-sizing: border-box; }
  :root { color-scheme: dark; background: #191f2a; color: #edf0e9; font: 15px system-ui,sans-serif; }
  body { width: min(1220px, calc(100% - 64px)); margin: 34px auto; }
  h1, h2, p { margin: 0; }
  header { display: grid; grid-template-columns: minmax(0,1fr) auto; align-items: end; gap: 20px; margin-bottom: 24px; }
  h1 { margin: 6px 0 10px; font: 410 clamp(38px, 6.1vw, 86px)/.98 Georgia,serif; letter-spacing: -.06em; }
  .lede { color: #cbd4df; max-width: 64ch; line-height: 1.5; }
  .mono, button { font: 600 11px/1.4 ui-monospace,monospace; letter-spacing: .06em; }
  .kicker { color: #ffb783; text-transform: uppercase; }
  .controls { display: flex; align-items: center; gap: 10px; }
  button { color: inherit; cursor: pointer; background: #2e384b; border: 1px solid #677591; padding: 7px 10px; }
  button:hover, button:focus-visible { border-color: #fcd09d; outline: 1px solid #fcd09d; }
  #play { min-width: 68px; }
  #seek { width: clamp(94px, 14vw, 159px); accent-color: #ffb783; }
  #time { min-width: 56px; color: #ffcb9c; white-space: nowrap; }
  .grid { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: 12px; }
  article { min-width: 0; background: #252e3f; border: 1px solid #5d6a84; }
  .lane-head, .trace-head { display: flex; flex-wrap: wrap; gap: 7px; align-items: center; justify-content: space-between; padding: 10px 12px; }
  .lane-head h2 { font-size: 16px; } .lane-head p { color: var(--ink); }
  .solo[aria-pressed="true"] { color: var(--ink); border-color: var(--ink); background: #1c2536; }
  canvas { width: 100%; height: auto; display: block; image-rendering: pixelated; border-block: 1px solid #5d6a84; }
  .trace-head { padding-block: 8px; }
  .meter { color: var(--ink); }
  .gate { color: #bdc6d6; }
  .gate[data-open="true"] { color: var(--ink); }
  .gate::before { content: ''; display: inline-block; background: currentColor; height: 6px; width: 6px; margin-right: 6px; }
  .settings { padding: 10px 12px; color: #d0d8e4; }
  .legend { display: flex; flex-wrap: wrap; gap: 10px 19px; margin-top: 15px; color: #cbd4df; }
  .legend i { color: #ffcfaa; margin-right: 5px; font-style: normal; }
  @media (max-width: 770px) {
    body { width: calc(100% - 27px); margin-top: 24px; }
    header, .grid { grid-template-columns: 1fr; }
  }
</style>
<main>
  <header><div><p class="kicker mono">Ink Studio · Audio control</p><h1>Per-stem control signals</h1>
    <p class="lede">Three stems drive separate forms. Each trace shows its smoothed level, trigger threshold, and the moments it fired.</p></div>
    <div class="controls mono"><button type="button" id="play">Play</button>
      <input id="seek" type="range" min="0" max="${duration}" step=".001" value="2.84" aria-label="Playback time"><output id="time" for="seek"></output></div>
  </header>
  <section class="grid" aria-label="Stem controls">
    ${panels.map(panel => `<article id="${panel.name}" style="--ink:${panel.tint}">
      <div class="lane-head"><div><h2>${panel.title}</h2><p class="mono">${panel.caption}</p></div>
        <button type="button" class="solo" aria-pressed="false" aria-label="Solo ${panel.title}">Solo</button></div>
      <canvas class="figure" width="192" height="111" aria-label="Pixel form driven by ${panel.title}"></canvas>
      <div class="trace-head mono"><output class="meter"></output><output class="gate"></output></div>
      <canvas class="trace" width="384" height="82" aria-label="Level, trigger threshold, and trigger timestamps for ${panel.title}"></canvas>
      <p class="settings mono"></p></article>`).join('')}
  </section>
  <div class="legend mono"><span><i>┄</i>Trigger threshold</span><span><i>◆</i>Trigger pulse</span><span><i>│</i>Playhead</span></div>
  <audio id="audio" preload="auto"></audio>
</main>
<script>${ink.bundle()}</script>
<script>
(() => {
  const panels = ${JSON.stringify(panels)}, settings = ${JSON.stringify(settings)}, waves = ${JSON.stringify(waves)};
  const sampleRate = ${sampleRate}, duration = ${duration};
  // These demo WAVs are generated as mono PCM16 with one 44-byte header.
  function audioFrom(wave) {
    const bytes = Uint8Array.from(atob(wave), ch => ch.charCodeAt(0)), view = new DataView(bytes.buffer);
    return { sampleRate, channels: 1, samples: Float32Array.from({ length: (bytes.length - 44) / 2 },
      (_, i) => view.getInt16(44 + i * 2, true) / 32768) };
  }
  const stems = Object.fromEntries(panels.map(panel => [panel.name, audioFrom(waves[panel.name])]));
  const { graph } = KIT.procedural, session = graph.create({
    inputs: { stems: 'record' },
    nodes: { bank: { op: 'audio.stemControls', inputs: { stems: { input: 'stems' }, settings, options: { rate: 60 } } } },
    outputs: { levels: { node: 'bank' }, recording: { node: 'bank', port: 'recording' } }
  });
  const values = time => session.evaluate({ stems }, { time }).outputs;
  const recording = values(0).recording, rate = 60;
  const trace = Array.from({ length: Math.ceil(duration * rate) + 1 }, (_, i) => values(i / rate).levels);
  const at = (row, lane) => lane === 'envelope' ? row.envelope : row.bands[lane];
  const el = id => document.getElementById(id), seek = el('seek'), clock = el('time'), button = el('play'), audio = el('audio');
  let active = 'mix', animation;
  const paper = '#1a2435';

  for (const track of panels) {
    const { name, lane } = track;
    const article = el(name), figure = article.querySelector('.figure'), plot = article.querySelector('.trace');
    track.view = figure.getContext('2d');
    track.plot = plot.getContext('2d');
    track.chart = document.createElement('canvas');
    track.chart.width = plot.width; track.chart.height = plot.height;
    track.gate = article.querySelector('.gate'); track.meter = article.querySelector('.meter');
    track.solo = article.querySelector('.solo');
    const follow = lane === 'envelope' ? settings[name].envelope : settings[name].bands[lane];
    const description = article.querySelector('.settings');
    description.append(Math.round(follow.attack * 1000) + ' ms attack · ' + Math.round(follow.release * 1000) + ' ms release',
      document.createElement('br'), 'Trigger ' + follow.threshold.toFixed(2) + ' · reset ' + follow.resetThreshold.toFixed(2));
    const ctx = track.chart.getContext('2d'), w = plot.width, h = plot.height, top = 9, bottom = h - 9;
    const y = level => bottom - level * (bottom - top);
    ctx.fillStyle = paper; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#75849a'; ctx.setLineDash([4, 4]); ctx.beginPath();
    ctx.moveTo(0, y(follow.threshold)); ctx.lineTo(w, y(follow.threshold)); ctx.stroke(); ctx.setLineDash([]);
    ctx.strokeStyle = track.tint; ctx.lineWidth = 1.5; ctx.beginPath();
    trace.forEach((frame, i) => ctx[i ? 'lineTo' : 'moveTo'](i * w / (trace.length - 1), y(at(frame[name], lane))));
    ctx.stroke();
    track.hits = recording.events.filter(row => row.value.stem === name && row.value.signal === lane).map(row => row.time);
    ctx.fillStyle = '#ffe0af';
    for (const time of track.hits) {
      const x = time / duration * w;
      ctx.beginPath(); ctx.moveTo(x, 3); ctx.lineTo(x + 4, 7); ctx.lineTo(x, 11); ctx.lineTo(x - 4, 7); ctx.fill();
    }
    track.solo.addEventListener('click', () => listen(active === name ? 'mix' : name));
  }

  function picture({ view: ctx, tint, shape }, level, open, time, hit) {
    const { width, height } = ctx.canvas, cx = width / 2, cy = height / 2;
    ctx.fillStyle = paper; ctx.fillRect(0, 0, width, height);
    for (let y = 8; y < height; y += 8) for (let x = 8; x < width; x += 8) {
      ctx.fillStyle = (x + y) % 32 ? '#343f53' : '#50627c'; ctx.fillRect(x, y, 1, 1);
    }
    const size = 17 + 24 * level, turn = time * .65, phase = Math.sin(time * 2.5), tau = 2 * Math.PI;
    for (let ring = 0; ring < 4; ring++) for (let i = 0; i < 95; i++) {
      const a = i * tau / 95, c = Math.cos(a), s = Math.sin(a), r = size + ring * 4;
      let x, y;
      if (shape === 'diamond') {
        const norm = Math.abs(c) + Math.abs(s), rotate = a + .14 * phase;
        x = Math.cos(rotate) * r * 1.22 / norm; y = Math.sin(rotate) * r / norm;
      } else if (shape === 'orbit') {
        x = c * r * 1.55 + Math.sin(a * 2 + turn) * (8 + ring);
        y = s * r * .6 + Math.cos(a * 3 - turn + ring * .45) * (6 + 6 * level);
      } else {
        x = (i / 94 - .5) * 126;
        y = s * r * .78 * Math.abs(Math.cos(a * 2 + turn + ring * .6)) + (ring - 1.5) * 4;
      }
      ctx.globalAlpha = .3 + (open ? .25 : .10) + ((i + ring) % 7) / 17;
      ctx.fillStyle = hit && ring === 3 ? '#fff0c3' : tint;
      ctx.fillRect(Math.floor(cx + x), Math.floor(cy + y), i % 3 ? 1 : 2, 1 + Number(ring === 3));
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = hit ? '#fff0c3' : tint;
    ctx.fillRect(cx - 5, cy, 11, 1); ctx.fillRect(cx, cy - 5, 1, 11);
  }

  function show(time) {
    seek.value = time;
    clock.value = time.toFixed(3) + ' s';
    const { levels } = values(time);
    for (const track of panels) {
      const row = levels[track.name], level = at(row, track.lane), gate = row.gates[track.lane];
      const hit = track.hits.some(stamp => time >= stamp && time - stamp < .12);
      picture(track, level, gate, time, hit);
      track.meter.value = level.toFixed(3);
      track.gate.value = gate ? 'Gate open' : 'Gate closed';
      track.gate.dataset.open = String(gate);
      const { plot, chart } = track;
      plot.drawImage(chart, 0, 0);
      plot.fillStyle = '#fff0c3'; plot.fillRect(Math.floor(time * chart.width / duration), 0, 1, chart.height);
    }
  }
  function listen(name) {
    const time = Number(seek.value), playing = !audio.paused;
    active = name;
    audio.src = 'data:audio/wav;base64,' + waves[name];
    audio.currentTime = time;
    for (const panel of panels) panel.solo.setAttribute('aria-pressed', String(panel.name === active));
    if (playing) audio.play().catch(() => {});
  }
  function frame() { show(audio.currentTime); if (!audio.paused) animation = requestAnimationFrame(frame); }
  seek.addEventListener('input', () => { audio.currentTime = Number(seek.value); show(Number(seek.value)); });
  button.addEventListener('click', () => {
    if (audio.paused) audio.play().catch(error => { button.textContent = error.message; });
    else audio.pause();
  });
  audio.addEventListener('play', () => { button.textContent = 'Pause'; animation = requestAnimationFrame(frame); });
  audio.addEventListener('pause', () => { button.textContent = 'Play'; cancelAnimationFrame(animation); });
  audio.addEventListener('ended', () => show(duration));
  listen('mix'); show(Number(seek.value));
})();
</script>`;

const output = path.resolve(process.argv[2]);
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, html);
console.log(output);
