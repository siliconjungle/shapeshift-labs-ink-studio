const fs = require('node:fs');
const path = require('node:path');
const ink = require('..');

if (!process.argv[2]) throw new Error('Usage: node examples/live-modulation.cjs <demo.html>');

const { mediaGraph: A } = ink.load().KIT.procedural;
const capture = A.modulationCapture({ origin: 0, initial: {
  'midi:ch1:cc74': .19, 'pointer:x': .5, 'pointer:y': .5, 'pointer:pressure': 0, 'pointer:active': false
} });
let level = 0;
const mic = capture.microphone({
  context: { sampleRate: 48000 }, fftSize: 128, frequencyBinCount: 64,
  getFloatTimeDomainData(target) { target.forEach((_, i) => { target[i] = level * Math.sin(i * Math.PI / 16); }); },
  getFloatFrequencyData(target) { target.fill(-Infinity); target[1] = level ? 20 * Math.log10(level * .6) : -Infinity; }
}, { bands: { body: [120, 600] } });
for (let i = 0; i <= 90; i++) {
  const time = i / 20;
  level = Math.min(.94, [.52, 1.34, 2.03, 2.85, 3.73].reduce((sum, peak, j) =>
    sum + (j % 2 ? .8 : .54) * Math.exp(-((time - peak) ** 2) / (.016 + j * .008)), 0));
  mic(time);
}
for (const [at, value] of [[.42, 41], [1.28, 105], [2.38, 53], [3.01, 118], [3.96, 49]])
  capture.midi([0xb0, 74, value], { at });
for (const at of [.66, 2.12, 3.44]) {
  capture.midi([0x90, 60, 92], { at });
  capture.midi([0x80, 60, 0], { at: at + .08 });
}
for (let i = 0; i <= 80; i++) {
  const at = (.4 + i * .045), angle = i * .118, radius = .09 + .185 * i / 80;
  capture.gesture({ phase: i === 0 ? 'start' : i === 80 ? 'end' : 'move',
    x: .5 + radius * Math.cos(angle), y: .5 + radius * Math.sin(angle),
    pressure: .24 + .52 * (.5 + .5 * Math.sin(i * .157 + .3)) }, { prefix: 'pointer', at });
}
const preset = capture.snapshot();
const marker = preset.events.findIndex(row => row.channel === 'midi:ch1:cc74' && row.time === 1.28);

const html = `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Modulation Take · Ink Studio</title>
<style>
  * { box-sizing: border-box; }
  :root { color-scheme: dark; background: #211a27; color: #f9eee4; font: 15px system-ui,sans-serif; }
  body { width: min(1210px, calc(100% - 64px)); margin: 34px auto; }
  h1, h2, p { margin: 0; }
  header { display: grid; grid-template-columns: minmax(0,1fr) auto; align-items: end; gap: 20px; margin-bottom: 23px; }
  h1 { font: 420 clamp(40px, 6.5vw, 91px)/.99 Georgia,serif; letter-spacing: -.065em; margin: 6px 0 9px; }
  h2 { font-size: 15px; font-weight: 650; }
  .lede { color: #dacbdc; max-width: 61ch; line-height: 1.45; }
  .mono, button, label { font: 600 11px/1.35 ui-monospace,monospace; letter-spacing: .055em; }
  .kicker { color: #ffc092; text-transform: uppercase; }
  .transport { display: flex; align-items: center; gap: 10px; }
  button { color: inherit; background: #3a2e42; border: 1px solid #755e7d; padding: 8px 10px; cursor: pointer; }
  button:disabled { opacity: .45; cursor: default; }
  button:hover:not(:disabled), button:focus-visible, input:focus-visible { outline: 1px solid #ffcfa0; border-color: #ffcfa0; }
  #play { min-width: 66px; } #seek { width: clamp(92px, 15vw, 157px); accent-color: #f9b687; }
  #clock { color: #ffcfa0; min-width: 63px; white-space: nowrap; }
  .grid { display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 1fr); gap: 12px; }
  .panel { min-width: 0; background: #2f2537; border: 1px solid #755e7d; }
  .head { display: flex; align-items: center; gap: 8px; justify-content: space-between; flex-wrap: wrap;
    padding: 10px 13px; border-bottom: 1px solid #755e7d; }
  .head output { color: #ddc8df; }
  canvas { display: block; width: 100%; height: auto; image-rendering: pixelated; }
  #stage { touch-action: pan-y; }
  #stage.live { touch-action: none; cursor: crosshair; }
  .trace { border-bottom: 1px solid #5f4b67; }
  .trace h3 { margin: 0; padding: 7px 10px; display: flex; gap: 8px; justify-content: space-between; color: var(--ink); }
  .rows { display: grid; grid-template-rows: repeat(3,1fr); }
  .row { display: grid; grid-template-columns: 1fr auto; gap: 10px; padding: 9px 12px; align-items: end; }
  .row label { display: grid; gap: 5px; color: #e6d5e6; }
  .row input { width: 100%; height: 32px; background: #211a27; color: inherit; border: 1px solid #755e7d; padding: 6px 8px; }
  .foot { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 14px; margin-top: 12px; }
  .capture { padding: 11px 13px; display: flex; flex-wrap: wrap; gap: 8px; }
  .caption { color: #cdb8d1; padding: 6px 12px 9px; }
  #status { color: #edc1aa; display: block; padding: 0 13px 11px; }
  .actions { display: flex; flex-wrap: wrap; justify-content: end; gap: 8px; }
  @media (max-width: 790px) {
    body { width: calc(100% - 28px); margin-top: 23px; }
    header, .grid, .foot { grid-template-columns: 1fr; }
    .actions { justify-content: start; }
  }
</style>
<main>
  <header><div><p class="mono kicker">Ink Studio · Live control capture</p><h1>Modulation Take</h1>
    <p class="lede">Microphone level drives the halo, MIDI opens the iris, and a recorded gesture moves the tracer. Scrub the take or move a captured control sample.</p></div>
    <div class="transport mono"><button id="play" type="button">Play</button>
      <input id="seek" type="range" min="0" max="4.5" step=".001" value="1.86" aria-label="Playback time"><output id="clock" for="seek"></output></div>
  </header>
  <div class="grid">
    <section class="panel"><div class="head"><h2>Modulated form</h2><output id="mode" class="mono">Prepared take</output></div>
      <canvas id="stage" width="304" height="157" aria-label="Pixel iris modulated by the recording and used as a pointer surface during live capture"></canvas></section>
    <aside class="panel">
      <div class="head"><h2>Recorded channels</h2><output id="count" class="mono"></output></div>
      <div class="rows">
        <section class="trace" style="--ink:#f7b789"><h3 class="mono">Microphone RMS <output id="mic-level"></output></h3>
          <canvas id="mic-chart" width="320" height="51" aria-label="Recorded microphone level"></canvas></section>
        <section class="trace" style="--ink:#b3e3ce"><h3 class="mono">MIDI CC74 <output id="midi-level"></output></h3>
          <canvas id="midi-chart" width="320" height="51" aria-label="MIDI control and original timing"></canvas></section>
        <section class="trace" style="--ink:#d7bbff"><h3 class="mono">Gesture pressure <output id="pen-level"></output></h3>
          <canvas id="pen-chart" width="320" height="51" aria-label="Recorded gesture pressure"></canvas></section>
      </div>
      <form id="edit" class="row"><label>Selected time (s)<input id="key" type="number" min="0" step=".001" required></label>
        <button type="submit">Move sample</button></form>
      <p class="caption mono" id="key-note"></p>
    </aside>
  </div>
  <div class="foot">
    <div class="panel"><div class="capture">
      <button id="capture" type="button">Start live take</button><button id="mic" type="button" disabled>Enable microphone</button>
      <button id="midi" type="button" disabled>Connect MIDI</button></div>
      <output id="status" class="mono" aria-live="polite">Prepared take uses simulated sources</output></div>
    <div class="actions"><button id="restore" type="button">Restore prepared take</button><button id="export" type="button">Export JSON</button></div>
  </div>
</main>
<script>${ink.bundle()}</script>
<script>
(() => {
  const A = KIT.procedural.mediaGraph;
  const prepared = ${JSON.stringify(preset)}, defaultIndex = ${marker};
  const el = id => document.getElementById(id), seek = el('seek'), stage = el('stage'), art = stage.getContext('2d');
  const tracks = [
    { id: 'mic', channel: 'mic:rms', tint: '#f7b789' },
    { id: 'midi', channel: 'midi:ch1:cc74', tint: '#b3e3ce' },
    { id: 'pen', channel: 'pointer:pressure', tint: '#d7bbff' }
  ];
  let source, edited, replay, selected, moved, duration, traces, before, live = null, animation = 0;
  const clock = () => performance.now() / 1000;

  function prepare(recording, index, destination) {
    const next = destination === undefined ? recording : A.editRecording(recording, [{ op: 'move', index, time: destination }]);
    source = recording; selected = index; moved = destination; edited = next;
    replay = A.inputReplay(edited);
    const previous = A.inputReplay(source);
    duration = Math.max(.25, Math.ceil(Math.max(edited.events.at(-1)?.time ?? 0, source.events.at(-1)?.time ?? 0) * 20) / 20);
    seek.max = duration;
    traces = Array.from({ length: 241 }, (_, i) => replay.sample({ time: i * duration / 240 }).value);
    before = Array.from({ length: 241 }, (_, i) => previous.sample({ time: i * duration / 240 }).value);
    el('count').value = edited.events.length + ' samples';
    const key = source.events[index];
    el('key').disabled = !key;
    el('edit').querySelector('button').disabled = !key;
    el('key').value = key ? (moved ?? key.time).toFixed(3) : '';
    el('key-note').textContent = key ? key.channel + ' · from ' + key.time.toFixed(3) + ' s' : 'Capture a sample to edit';
  }
  function point(ctx, x, y, color, size = 1) {
    ctx.fillStyle = color; ctx.fillRect(Math.floor(x), Math.floor(y), size, size);
  }
  function drawForm(fields, time) {
    const { width, height } = art.canvas, x0 = width / 2, y0 = height / 2;
    const rms = fields['mic:rms'] ?? 0, filter = fields['midi:ch1:cc74'] ?? .3;
    const pressure = fields['pointer:pressure'] ?? 0;
    const x = (fields['pointer:x'] ?? .5) * width, y = (fields['pointer:y'] ?? .5) * height;
    art.fillStyle = '#251d32'; art.fillRect(0, 0, width, height);
    for (let v = 7; v < height; v += 7) for (let u = 7; u < width; u += 7)
      point(art, u, v, (u + v) % 28 ? '#3b2d4c' : '#55415b');
    for (let j = 0; j < 6; j++) for (let i = 0; i < 178; i++) {
      const a = i * Math.PI / 89, petal = Math.cos(a * 7 + j * .39 + time * .56);
      const r = 18 + 21 * filter + j * (4.7 + 2.7 * rms) + 8.4 * petal;
      const color = petal > .52 ? '#ded5b0' : (i + j) % 3 ? '#a3d6b4' : '#d8a4e5';
      const stretch = 1.32 + .2 * Math.cos(a * 2 + time * .3);
      if ((i + 2 * j) % 7) point(art, x0 + Math.cos(a) * r * stretch, y0 + Math.sin(a) * r * .82, color, j < 2 ? 1 : 2);
    }
    const halo = 61 + rms * 35;
    for (let i = 0; i < 176; i++) if (i % 5 < 3) {
      const a = i * Math.PI / 88;
      point(art, x0 + Math.cos(a) * halo * 1.17, y0 + Math.sin(a) * halo * .79, '#f3b282');
    }
    const cursor = Math.round(4 + 7 * pressure);
    art.fillStyle = fields['pointer:active'] ? '#fff1ce' : '#9076a6';
    art.fillRect(Math.round(x - cursor), Math.round(y), cursor * 2 + 1, 1);
    art.fillRect(Math.round(x), Math.round(y - cursor), 1, cursor * 2 + 1);
  }
  function plot(track, time, value) {
    const ctx = el(track.id + '-chart').getContext('2d'), { width, height } = ctx.canvas;
    ctx.fillStyle = '#251d32'; ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#4c3b58'; ctx.fillRect(0, height - 6, width, 1);
    const line = frames => {
      ctx.beginPath();
      frames.forEach((row, i) => ctx[i ? 'lineTo' : 'moveTo'](i / 240 * width,
        height - 7 - Math.max(0, Math.min(1, row[track.channel] ?? 0)) * (height - 13)));
      ctx.stroke();
    };
    const selectedChannel = source.events[selected]?.channel === track.channel && moved !== undefined;
    if (selectedChannel) {
      ctx.setLineDash([3, 3]); ctx.strokeStyle = '#897592'; line(before); ctx.setLineDash([]);
    }
    ctx.lineWidth = 1.5; ctx.strokeStyle = track.tint; line(traces);
    if (selectedChannel) {
      ctx.fillStyle = '#fbd5a1'; ctx.fillRect(Math.min(width - 2, Math.round(moved / duration * width)), 2, 2, 5);
    }
    ctx.fillStyle = '#fff2cf'; ctx.fillRect(Math.min(width - 1, Math.floor(time / duration * width)), 0, 1, height);
    el(track.id + '-level').value = value === undefined ? '—' : value.toFixed(3);
  }
  function show(time) {
    seek.value = time; el('clock').value = time.toFixed(3) + ' s';
    const fields = replay.sample({ time }).value;
    stage.dataset.values = JSON.stringify(fields);
    drawForm(fields, time);
    for (const track of tracks) plot(track, time, fields[track.channel]);
  }
  function stop() { cancelAnimationFrame(animation); animation = 0; el('play').textContent = 'Play'; }
  function play() {
    if (animation) return stop();
    el('play').textContent = 'Pause';
    const start = clock(), initial = Number(seek.value) >= duration ? 0 : Number(seek.value);
    function frame() {
      const time = Math.min(duration, initial + clock() - start);
      show(time);
      if (time >= duration) stop();
      else animation = requestAnimationFrame(frame);
    }
    animation = requestAnimationFrame(frame);
  }
  seek.addEventListener('input', () => { stop(); show(Number(seek.value)); });
  el('play').addEventListener('click', play);
  el('edit').addEventListener('submit', event => {
    event.preventDefault();
    try {
      prepare(source, selected, Number(el('key').value)); show(Number(seek.value));
    } catch (error) { el('status').value = error.message; }
  });
  function restore() {
    stop(); prepare(prepared, defaultIndex, 1.63); el('mode').value = 'Prepared take'; show(1.86);
    el('status').value = 'Prepared take uses simulated sources';
  }
  el('restore').addEventListener('click', restore);
  el('export').addEventListener('click', () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(edited, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url; link.download = 'modulation.take.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  el('capture').addEventListener('click', () => {
    if (!live) {
      stop();
      const session = A.modulationCapture();
      live = { session, detach: session.attachPointer(stage) };
      stage.classList.add('live');
      el('capture').textContent = 'Stop and review'; el('mode').value = 'Recording pointer';
      el('status').value = 'Draw on the form or enable another source';
      el('mic').disabled = el('midi').disabled = false;
      el('play').disabled = seek.disabled = el('restore').disabled = el('export').disabled = true;
      el('key').disabled = el('edit').querySelector('button').disabled = true;
      return;
    }
    const current = live; live = null;
    current.detach(); current.detachMIDI?.(); clearInterval(current.timer);
    current.stream?.getTracks().forEach(track => track.stop()); current.context?.close();
    const recording = current.session.snapshot();
    stage.classList.remove('live');
    el('capture').textContent = 'Start live take';
    el('mic').disabled = el('midi').disabled = true;
    el('play').disabled = seek.disabled = el('restore').disabled = el('export').disabled = false;
    if (recording.events.length) {
      const midi = recording.events.findIndex(row => row.channel.endsWith(':cc74'));
      prepare(recording, Math.max(0, midi));
      el('mode').value = 'Captured take'; show(duration);
      el('status').value = 'Recorded ' + recording.events.length + ' samples';
    } else restore();
  });
  stage.addEventListener('pointermove', event => {
    if (!live || !event.buttons) return;
    const rect = stage.getBoundingClientRect();
    drawForm({ 'pointer:x': (event.clientX - rect.left) / rect.width, 'pointer:y': (event.clientY - rect.top) / rect.height,
      'pointer:pressure': event.pressure, 'pointer:active': true }, clock());
  });
  el('mic').addEventListener('click', async () => {
    const owner = live;
    el('mic').disabled = true;
    let context, stream;
    try {
      context = new AudioContext();
      await context.resume();
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (owner !== live) {
        stream.getTracks().forEach(track => track.stop()); await context.close(); return;
      }
      const analyser = context.createAnalyser();
      context.createMediaStreamSource(stream).connect(analyser);
      const sample = owner.session.microphone(analyser, { bands: { body: [120, 600] } });
      owner.context = context; owner.stream = stream;
      owner.timer = setInterval(() => {
        try { sample(); }
        catch (error) {
          clearInterval(owner.timer);
          stream.getTracks().forEach(track => track.stop());
          context.close();
          owner.context = owner.stream = null;
          el('status').value = error.message;
        }
      }, 40);
      el('status').value = 'Recording microphone features and pointer';
    } catch (error) {
      stream?.getTracks().forEach(track => track.stop()); await context?.close();
      if (owner === live) { el('status').value = error.message; el('mic').disabled = false; }
    }
  });
  el('midi').addEventListener('click', async () => {
    const owner = live;
    el('midi').disabled = true;
    try {
      const access = await navigator.requestMIDIAccess(), input = access.inputs.values().next().value;
      if (owner !== live) return;
      if (!input) throw new Error('Connect a MIDI input and try again');
      owner.detachMIDI = owner.session.attachMIDI(input);
      el('status').value = 'Recording MIDI and pointer';
    } catch (error) {
      if (owner === live) { el('status').value = error.message; el('midi').disabled = false; }
    }
  });
  restore();
})();
</script>`;

const out = path.resolve(process.argv[2]);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log(out);
