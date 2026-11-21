const fs = require('node:fs');
const path = require('node:path');
const ink = require('..');

if (!process.argv[2]) throw new Error('Usage: node examples/editable-musical-events.cjs <demo.html>');

const { mediaGraph } = ink.load().KIT.procedural;
const sampleRate = 24000, duration = 4.2, samples = new Float64Array(Math.round(sampleRate * duration));
const strikes = [
  [.22, 58, .78, .18], [.65, 2550, .34, .11], [1.09, 72, .67, .16], [1.55, 830, .49, .18],
  [1.98, 55, .80, .22], [2.42, 2820, .32, .10], [3.03, 158, .69, .17], [3.58, 1080, .53, .23]
];
for (const [onset, pitch, gain, decay] of strikes) {
  const first = Math.round(onset * sampleRate), isBass = pitch < 200;
  const length = Math.min(samples.length - first, Math.round(decay * 2.4 * sampleRate));
  for (let i = 0; i < length; i++) {
    const t = i / sampleRate, envelope = Math.exp(-t * 5 / decay);
    const bend = isBass ? 45 * .013 * (1 - Math.exp(-t / .013)) : 0;
    const fundamental = Math.cos(2 * Math.PI * (pitch * t + bend));
    const overtone = Math.cos(2 * Math.PI * pitch * (isBass ? 2.16 : 1.47) * t);
    const tail = 1 - Math.max(0, (i / length - .9) * 10);
    samples[first + i] += gain * envelope * (.83 * fundamental + .17 * overtone) * tail;
  }
}
const source = { sampleRate, channels: 1, samples };
const detected = mediaGraph.detectTransients(source, { minGap: .14, name: 'Hit' }).value;
const at = seconds => {
  const cue = detected.events.find(row => Math.abs(row.time - seconds) < .02);
  if (!cue) throw new Error('No transient near ' + seconds);
  return cue.id;
};
const selected = at(1.09);
const initialEdits = [
  { op: 'rename', id: at(.22), name: 'Downbeat' },
  { op: 'rename', id: selected, name: 'Open iris' },
  { op: 'move', id: selected, time: 1.27 },
  { op: 'rename', id: at(1.98), name: 'Bass cut' },
  { op: 'delete', id: at(2.42) },
  { op: 'add', id: 'hold-frame', name: 'Hold frame', time: 2.69 },
  { op: 'rename', id: at(3.58), name: 'Release' }
];

const peak = Array.from({ length: 600 }, (_, column) => {
  const left = Math.floor(column * samples.length / 600), right = Math.floor((column + 1) * samples.length / 600);
  let low = 0, high = 0;
  for (let i = left; i < right; i++) {
    low = Math.min(low, samples[i]);
    high = Math.max(high, samples[i]);
  }
  return [Math.round(low * 1000) / 1000, Math.round(high * 1000) / 1000];
});
const audio = ink.encodeWav(source).toString('base64');

const html = `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Musical event tracks · Ink Studio</title>
<style>
  * { box-sizing: border-box; }
  :root { color-scheme: dark; background: #1d191c; color: #fff3e0; font: 15px system-ui, sans-serif; }
  body { width: min(1180px, calc(100% - 64px)); margin: 34px auto; }
  h1, h2, p { margin: 0; }
  h1 { font: 400 clamp(38px, 6.5vw, 86px)/1 Georgia, serif; letter-spacing: -.065em; margin: 4px 0 11px; }
  h2 { font-size: 16px; font-weight: 650; }
  .lede { max-width: 65ch; color: #d9c9c5; line-height: 1.5; }
  .mono, label, button { font: 600 11px/1.4 ui-monospace, monospace; letter-spacing: .065em; }
  .kicker { color: #eda58b; text-transform: uppercase; }
  .panel { border: 1px solid #68545a; background: #2c232a; }
  .head { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; padding: 13px 16px; }
  .transport { display: flex; align-items: center; gap: 12px; }
  button { color: inherit; background: #392c36; border: 1px solid #785b66; padding: 8px 11px; cursor: pointer; }
  button:hover, button:focus-visible, input:focus-visible { border-color: #ffd09c; outline: 1px solid #ffd09c; }
  button:disabled { opacity: .45; cursor: default; }
  #play { min-width: 67px; }
  #seek { width: clamp(90px, 16vw, 170px); accent-color: #ecad8e; }
  #clock { min-width: 58px; color: #f4bf9e; white-space: nowrap; }
  .board { margin-top: 26px; }
  .scale, .row { display: grid; grid-template-columns: 111px minmax(0, 1fr); }
  .scale, .row { border-top: 1px solid #59464f; }
  .row h3 { padding: 12px; margin: 0; color: #e4cdd1; }
  .track { position: relative; margin: 0 28px 0 4px; min-width: 0; }
  .track::before { content: ''; position: absolute; inset: 0; pointer-events: none;
    background: repeating-linear-gradient(to right, #7e667051 0 1px, transparent 1px calc(100% / 8.4)); }
  .ruler { height: 33px; --ink: #c6adb5; }
  .tick { position: absolute; top: 8px; color: var(--ink); padding-left: 5px; white-space: nowrap; }
  .waveform { height: 174px; cursor: crosshair; }
  canvas { display: block; width: 100%; height: 100%; }
  .lane { min-height: 68px; }
  .marker { position: absolute; z-index: 2; top: 12px; margin-left: -5px; padding: 4px 5px; border-color: transparent;
    background: transparent; color: #e5ccdc; white-space: nowrap; letter-spacing: .015em; touch-action: pan-y; }
  .marker::before { content: ''; display: inline-block; margin-right: 5px; width: 7px; height: 7px;
    transform: rotate(45deg); background: currentColor; }
  .marker[data-variant="removed"] { color: #d0a3ae; text-decoration: line-through; }
  .marker[data-variant="removed"]::before { background: transparent; border: 1px solid currentColor; }
  .marker[data-variant="moved"] { color: #ffb489; }
  .marker[data-variant="added"] { color: #a6ecce; }
  .marker[aria-pressed="true"] { border-color: #f3b487; background: #41303a; }
  .marker.goal { top: 34px; }
  .marker.end { display: flex; flex-direction: row-reverse; align-items: center; gap: 5px; transform: translateX(calc(-100% + 17px)); }
  .marker.end::before { flex: 0 0 7px; margin: 0; }
  .now { position: absolute; z-index: 1; inset-block: 0; width: 1px; background: #ffd4a3; pointer-events: none; }
  .now::before { content: ''; position: absolute; width: 7px; height: 7px; background: inherit; top: 0; left: -3px; }
  .lane .now::before { display: none; }
  .legend { color: #d8c2c8; display: flex; flex-wrap: wrap; gap: 16px; padding: 12px 16px; border-top: 1px solid #59464f; }
  .swatch::before { content: ''; display: inline-block; margin-right: 6px; width: 7px; height: 7px; background: var(--color); }
  .editor { margin-top: 14px; }
  .editor .head { border-bottom: 1px solid #59464f; }
  .editor form { display: grid; grid-template-columns: minmax(0, 1fr) 105px auto; align-items: end; gap: 11px; padding: 14px 16px; }
  label { display: grid; gap: 5px; color: #d8c2c8; }
  label input { width: 100%; height: 34px; padding: 6px 8px; border: 1px solid #785b66; color: #fff3e0; background: #221b22; font: 14px system-ui, sans-serif; }
  .actions { display: flex; flex-wrap: wrap; gap: 8px; }
  #status { min-height: 19px; color: #e7bdab; }
  #fired { color: #bde2cc; }
  @media (max-width: 760px) {
    body { width: calc(100% - 28px); margin-top: 22px; }
    .scale, .row { grid-template-columns: 74px minmax(0,1fr); }
    .track { margin-right: 11px; }
    .row h3 { padding: 8px 5px; font-size: 10px; }
    .editor form { grid-template-columns: minmax(0,1fr) 86px; }
    .actions { grid-column: 1 / -1; }
    .marker { max-width: 56px; overflow: hidden; text-overflow: ellipsis; }
  }
</style>
<main>
  <header>
    <p class="mono kicker">Ink Studio · Audio</p>
    <h1>Musical event tracks</h1>
    <p class="lede">Detect attacks in a soundtrack, then move, name, remove, or add cues. Play the edit to see each cue fire against the original audio.</p>
  </header>
  <section class="panel board" aria-label="Soundtrack and cue comparison">
    <div class="head"><h2>Soundtrack</h2><div class="transport mono">
      <button type="button" id="play">Play</button>
      <input id="seek" type="range" min="0" max="${duration}" step=".001" value="1.27" aria-label="Playback time">
      <output for="seek" id="clock"></output></div></div>
    <div class="scale"><div></div><div class="track ruler mono" id="ruler"></div></div>
    <div class="row"><h3 class="mono">Waveform</h3><div class="track waveform" id="waveform">
      <canvas width="1200" height="174" aria-label="Waveform of the original synthesized soundtrack"></canvas><div class="now"></div>
    </div></div>
    <div class="row"><h3 class="mono">Detected</h3><div class="track lane" id="detected"><div class="now"></div><div class="marks"></div></div></div>
    <div class="row"><h3 class="mono">Edited</h3><div class="track lane" id="edited"><div class="now"></div><div class="marks"></div></div></div>
    <div class="legend mono"><span class="swatch" style="--color:#ffb489">Moved</span>
      <span class="swatch" style="--color:#d0a3ae">Removed</span><span class="swatch" style="--color:#a6ecce">Added</span>
      <output id="fired" aria-label="Last cue fired"></output></div>
  </section>
  <section class="panel editor" aria-label="Edit selected cue">
    <div class="head"><h2>Selected cue</h2><output class="mono" id="status" aria-live="polite"></output></div>
    <form id="editor">
      <label>Name<input id="name" required maxlength="128" spellcheck="false"></label>
      <label>Time (s)<input id="time" type="number" min="0" max="${duration}" step="any" required></label>
      <div class="actions"><button id="save" type="submit">Save cue</button><button id="remove" type="button">Delete</button>
        <button id="add" type="button">Add at playhead</button><button id="reset" type="button">Reset</button>
        <button id="export" type="button">Export JSON</button></div>
    </form>
  </section>
  <audio id="audio" preload="auto" src="data:audio/wav;base64,${audio}"></audio>
</main>
<script>${ink.bundle()}</script>
<script>
(() => {
  const A = KIT.procedural.mediaGraph, baseline = ${JSON.stringify(detected)}, edits = ${JSON.stringify(initialEdits)};
  const duration = ${duration}, samples = ${JSON.stringify(peak)};
  const el = id => document.getElementById(id);
  const seek = el('seek'), audio = el('audio'), play = el('play'), name = el('name'), time = el('time');
  const positions = [...document.querySelectorAll('.now')];
  const original = new Map(baseline.events.map(row => [row.id, row]));
  let current, replay, selected = ${JSON.stringify(selected)}, manual = 0, previous = Number(seek.value), raf = 0;
  let drag = null, ignoreClick = false;
  const percentage = seconds => (100 * seconds / duration) + '%';
  function clock(seconds) {
    seek.value = seconds;
    el('clock').value = seconds.toFixed(3) + ' s';
    for (const line of positions) line.style.left = percentage(seconds);
  }
  function jump(seconds) {
    previous = Math.max(0, Math.min(duration, seconds));
    audio.currentTime = previous;
    clock(previous);
  }
  function frame() {
    const seconds = audio.currentTime;
    if (seconds > previous) {
      const cues = replay.sample({ from: previous, time: seconds }).pulses;
      if (cues.length) el('fired').value = 'Fired · ' + cues.at(-1).value.name;
    }
    previous = seconds;
    clock(seconds);
    if (!audio.paused) raf = requestAnimationFrame(frame);
  }
  for (let mark = 0; mark <= 4; mark += .5) {
    const tick = document.createElement('span');
    tick.className = 'tick'; tick.style.left = percentage(mark); tick.textContent = mark.toFixed(1);
    el('ruler').append(tick);
  }
  const canvas = el('waveform').querySelector('canvas'), ctx = canvas.getContext('2d');
  ctx.fillStyle = '#d491a6'; ctx.fillRect(0, 87, 1200, 1);
  ctx.fillStyle = '#edaec1';
  samples.forEach(([low, high], i) => ctx.fillRect(i * 2, 87 - high * 94, 1.6, Math.max(1, (high - low) * 94)));

  function marker(parent, row, label, variant, index, choose) {
    const item = document.createElement('button');
    item.className = 'marker' + (index % 2 ? ' goal' : '') + (row.time > .9 * duration ? ' end' : '');
    item.type = 'button'; item.textContent = label; item.style.left = percentage(row.time);
    item.dataset.id = row.id; item.dataset.variant = variant;
    item.title = label + ' at ' + row.time.toFixed(3) + ' s';
    item.setAttribute('aria-label', item.title);
    if (choose) {
      item.setAttribute('aria-pressed', row.id === selected);
      item.addEventListener('click', () => { if (!ignoreClick) select(row.id); });
    } else item.addEventListener('click', () => jump(row.time));
    parent.append(item);
  }
  function lanes() {
    const after = new Map(current.events.map(row => [row.id, row]));
    const detectedLane = el('detected').querySelector('.marks'), editedLane = el('edited').querySelector('.marks');
    detectedLane.replaceChildren(); editedLane.replaceChildren();
    baseline.events.forEach((row, i) => marker(detectedLane, row, 'Hit ' + (i + 1),
      after.has(row.id) ? '' : 'removed', i, false));
    current.events.forEach((row, i) => marker(editedLane, row, row.name,
      !original.has(row.id) ? 'added' : original.get(row.id).time !== row.time ? 'moved' : '', i, true));
  }
  function select(key) {
    const row = current.events.find(entry => entry.id === key);
    selected = row?.id ?? null;
    name.value = row?.name ?? '';
    time.value = row ? Number(row.time.toFixed(6)) : '';
    name.disabled = time.disabled = el('save').disabled = el('remove').disabled = !row;
    lanes();
  }
  function use(result, key, message) {
    current = result.value;
    replay = A.inputReplay(result.recording);
    select(key);
    el('status').value = message;
  }
  function edit(operations, key, message) {
    try { use(A.editMusicalEvents(current, operations), key, message); }
    catch (error) { el('status').value = error.message; }
  }

  const secondsAt = (event, lane) => {
    const rect = lane.getBoundingClientRect();
    return Math.round(1000 * Math.max(0, Math.min(duration, (event.clientX - rect.left) / rect.width * duration))) / 1000;
  };
  el('waveform').addEventListener('click', event => jump(secondsAt(event, el('waveform'))));
  seek.addEventListener('input', () => jump(Number(seek.value)));
  play.addEventListener('click', () => {
    if (audio.paused) audio.play().catch(error => { el('status').value = error.message; });
    else audio.pause();
  });
  audio.addEventListener('play', () => { play.textContent = 'Pause'; raf = requestAnimationFrame(frame); });
  audio.addEventListener('pause', () => { play.textContent = 'Play'; cancelAnimationFrame(raf); });
  audio.addEventListener('ended', () => clock(duration));

  el('editor').addEventListener('submit', event => {
    event.preventDefault();
    const row = current.events.find(entry => entry.id === selected), operations = [];
    if (name.value !== row.name) operations.push({ op: 'rename', id: selected, name: name.value });
    if (Number(time.value) !== Number(row.time.toFixed(6))) operations.push({ op: 'move', id: selected, time: Number(time.value) });
    edit(operations, selected, 'Cue saved');
  });
  el('remove').addEventListener('click', () => edit([{ op: 'delete', id: selected }], null, 'Cue removed'));
  el('add').addEventListener('click', () => {
    const id = 'cue-' + (++manual);
    edit([{ op: 'add', id, name: 'New cue', time: Number(seek.value) }], id, 'Cue added at playhead');
    name.focus(); name.select();
  });
  el('reset').addEventListener('click', () =>
    use(A.editMusicalEvents(baseline, edits), ${JSON.stringify(selected)}, 'Comparison restored'));
  el('export').addEventListener('click', () => {
    const object = new Blob([JSON.stringify(current, null, 2) + '\\n'], { type: 'application/json' });
    const url = URL.createObjectURL(object), link = document.createElement('a');
    link.href = url; link.download = 'musical-events.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  const lane = el('edited');
  lane.addEventListener('pointerdown', event => {
    const item = event.target.closest('.marker');
    if (item && event.button === 0) drag = { item, start: event.clientX, key: item.dataset.id };
  });
  lane.addEventListener('pointermove', event => {
    if (!drag || Math.abs(event.clientX - drag.start) < 4 && !drag.active) return;
    if (!drag.active) { drag.active = true; lane.setPointerCapture(event.pointerId); }
    drag.item.style.left = percentage(secondsAt(event, lane));
  });
  lane.addEventListener('pointerup', event => {
    if (drag?.active) {
      ignoreClick = true;
      edit([{ op: 'move', id: drag.key, time: secondsAt(event, lane) }], drag.key, 'Cue moved');
      setTimeout(() => { ignoreClick = false; }, 0);
    }
    drag = null;
  });
  lane.addEventListener('pointercancel', () => { drag = null; lanes(); });
  lane.addEventListener('pointerleave', () => { if (!drag?.active) drag = null; });
  use(A.editMusicalEvents(baseline, edits), selected, 'Detected at 1.090 s');
  jump(previous);
})();
</script>`;

const output = path.resolve(process.argv[2]);
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, html);
console.log(output);
