const fs = require('node:fs');
const path = require('node:path');
const ink = require('..');

if (!process.argv[2]) throw new Error('Usage: node examples/audio-world-events.cjs <demo.html>');
const { KIT: K } = ink.load(), A = K.procedural.mediaGraph;
const sampleRate = 24000, duration = 4.8, frames = Math.round(sampleRate * duration);
const melody = new Float64Array(frames), drums = melody.slice();
const notes = [
  { at: .46, name: 'Release the seed', hz: 400 },
  { at: 1.08, name: 'Start growth', hz: 585 },
  { at: 1.85, name: 'Glaze the tile', hz: 880 }
];
function strike(samples, at, hz, amplitude, fall) {
  const first = Math.round(at * sampleRate), length = Math.round(fall * 8 * sampleRate);
  for (let i = 0; i < length && first + i < frames; i++) {
    const t = i / sampleRate;
    const oscillator = Math.cos(2 * Math.PI * hz * t) * .8 + Math.cos(2 * Math.PI * hz * 1.67 * t) * .2;
    samples[first + i] += amplitude * oscillator * Math.exp(-t / fall);
  }
}
for (const note of notes) strike(melody, note.at, note.hz, .62, .073);
strike(drums, 2.44, 64, .86, .066);
strike(drums, 3.68, 56, .70, .062);
const audio = samples => ({ sampleRate, channels: 1, samples });
const detected = A.detectTransients(audio(melody), { minGap: .3 }).value;
const rows = notes.map(note => {
  const hit = detected.events.find(row => Math.abs(row.time - note.at) < .02);
  if (!hit) throw new Error('No cue detected at ' + note.at);
  return hit;
});
const named = A.editMusicalEvents(detected, [
  ...notes.map((note, i) => ({ op: 'rename', id: rows[i].id, name: note.name })),
  { op: 'move', id: rows[1].id, time: 1.14 }
]).value;
const rhythm = A.stemControls({ drums: audio(drums) }, {
  drums: { envelope: { measure: 'peak', attack: 0, release: .12, threshold: .46, resetThreshold: .25 } }
}).recording;

const rule = (name, ...actions) => ({ on: { kind: 'music-cue', system: 'world',
  where: { all: [{ path: '/cueTrack', value: 'melody' }, { path: '/name', value: name }] } }, actions });
const spec = { format: 'ink-studio/world', id: 'resonant-terrarium', dt: 1 / 40, takeClock: { simulationRate: 40, fps: 24 },
  systems: {
    flock: { kind: 'agents', config: { bounds: { min: [-8, -1, -6], max: [8, 8, 6] },
      species: { seed: { mode: 'fly', speed: 1.1 } }, agents: {} } },
    canopy: { kind: 'control', config: { op: 'timer', ticks: 104 } },
    rig: { kind: 'mechanics', config: { bodies: {
      tile: { fixed: true, position: [1, .22, 0], half: [.55, .22, .4] },
      bead: { position: [3, .15, 0], half: [.14, .14, .14], mass: .19 }
    } } }
  },
  timeline: { duration, cueTracks: { melody: { source: named },
    percussion: { source: rhythm, channels: ['stem:drums:envelope'] } } },
  eventActions: {
    spawn: rule(notes[0].name, { action: 'flock/spawn', args: { agent: 'seed', species: 'seed', position: [-4, 1.18, 0] } },
      { action: 'flock/seek', args: { agent: 'seed', to: [-1.6, 2.1, 0] } }),
    grow: rule(notes[1].name, { action: 'world/input', args: { port: 'canopy/enabled', value: true } }),
    glaze: rule(notes[2].name, { action: 'rig/surface-stamp', args: { body: 'tile', face: '+z',
      stamp: { channel: 'paint', value: '#ff8b92', brush: { kind: 'rect', min: [0, 0], max: [1, 1] } } } }),
    impulse: { on: { kind: 'audio-trigger', system: 'world',
      where: { path: '/channel', value: 'stem:drums:envelope' } }, limit: 2,
      actions: [{ action: 'rig/impulse', args: { body: 'bead', linear: [0, 1, 0] },
        bindings: { '/linear/1': '/value/level' } }] }
  } };
const run = K.world.runtime.create(spec, { recordRun: true });
const schedule = [];
const labels = { spawn: 'Spawn seed', grow: 'Grow canopy', glaze: 'Paint tile', impulse: 'Lift bead' };
const colors = { spawn: '#efd096', grow: '#99ddac', glaze: '#ff9da5', impulse: '#9ccefa' };
for (let tick = 1; tick <= Math.round(duration / spec.dt); tick++) {
  run.step();
  for (const row of run.events) if (row.kind === 'event-action-scheduled') {
    const trigger = run.events.find(event => event.id === row.trigger);
    schedule.push({ cue: trigger.name ?? 'Drum peak', source: trigger.cueTrack,
      time: trigger.timeline.time, tick, due: row.due, rule: row.rule,
      label: labels[row.rule], color: colors[row.rule] });
  }
}
if (schedule.length !== 5) throw new Error('Expected three edited cues and two drum reactions, got ' + schedule.length);
const saved = run.recording();
const mix = Float64Array.from(melody, (n, i) => .78 * (n + drums[i]));
const wav = ink.encodeWav(audio(mix)).toString('base64');
const peaks = Array.from({ length: 384 }, (_, i) => {
  let value = 0;
  for (let n = Math.floor(i * frames / 384); n < Math.floor((i + 1) * frames / 384); n++)
    value = Math.max(value, Math.abs(mix[n]));
  return Number(value.toFixed(4));
});

const html = `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Resonant Terrarium · Ink Studio</title>
<style>
  * { box-sizing: border-box; }
  :root { color-scheme: dark; background: #161e22; color: #f2e9da; font: 15px system-ui,sans-serif; }
  body { width: min(1230px, calc(100% - 65px)); margin: 33px auto; }
  h1, h2, p { margin: 0; }
  h1 { margin: 5px 0 9px; font: 420 clamp(40px,6.6vw,90px)/.98 Georgia,serif; letter-spacing: -.067em; }
  h2 { font-size: 15px; font-weight: 650; }
  header { display: grid; grid-template-columns: minmax(0,1fr) auto; align-items: end; gap: 20px; margin-bottom: 24px; }
  .lede { max-width: 66ch; line-height: 1.45; color: #ccd8d6; }
  .mono, button { font: 600 11px/1.4 ui-monospace,monospace; letter-spacing: .055em; }
  .kicker { color: #f6b292; text-transform: uppercase; }
  .controls { display: flex; align-items: center; gap: 10px; }
  button { color: inherit; cursor: pointer; background: #283c41; border: 1px solid #6a8585; padding: 8px 11px; }
  button:hover, button:focus-visible { border-color: #ffd3a6; outline: 1px solid #ffd3a6; }
  #play { min-width: 67px; }
  #seek { width: clamp(94px, 15vw, 164px); accent-color: #a9d9ad; }
  #clock { min-width: 60px; color: #ffcfaa; white-space: nowrap; }
  .grid { display: grid; grid-template-columns: minmax(0, 2.55fr) minmax(0, 1fr); gap: 13px; }
  .panel { min-width: 0; border: 1px solid #58736f; background: #233236; }
  .head { padding: 10px 13px; display: flex; align-items: center; justify-content: space-between; gap: 8px;
    min-height: 40px; border-bottom: 1px solid #58736f; }
  .head output { color: #c6d7d5; }
  canvas { display: block; width: 100%; height: auto; image-rendering: pixelated; }
  .routes { display: flex; flex-direction: column; }
  #routes { margin: 0; padding: 0; list-style: none; }
  #routes li { border-bottom: 1px solid #405858; }
  .route { display: grid; width: 100%; grid-template-columns: auto minmax(0,1fr) auto; gap: 9px; align-items: start;
    text-align: left; background: transparent; border: 0; padding: 11px 10px; }
  .route:not([data-status="waiting"]) { background: #2b4142; }
  .route .stamp { color: var(--cue); white-space: nowrap; }
  .route strong { font: 650 13px/1.15 system-ui,sans-serif; }
  .route small { display: block; margin-top: 3px; color: #c5d5d2; font: inherit; letter-spacing: 0; }
  .route .status { color: #b6cdca; font-size: 9px; white-space: nowrap; }
  .route[data-status="applied"] .status { color: var(--cue); }
  .footer { margin-top: auto; padding: 11px 12px; }
  .wave { margin-top: 12px; }
  #timeline { cursor: crosshair; }
  @media (max-width: 800px) {
    body { width: calc(100% - 26px); margin-top: 24px; }
    header, .grid { grid-template-columns: 1fr; }
  }
</style>
<main>
  <header><div><p class="kicker mono">Ink Studio · Audio-driven world events</p><h1>Resonant Terrarium</h1>
    <p class="lede">Edited notes release a seed, grow a canopy, and paint a tile. Drum triggers pass their measured strength into the bead’s impulse.</p></div>
    <div class="controls mono"><button id="play" type="button">Play</button>
      <input type="range" id="seek" min="0" max="${duration}" step=".001" value="2.780" aria-label="Playback time">
      <output id="clock" for="seek"></output></div>
  </header>
  <div class="grid">
    <section class="panel"><div class="head"><h2>World replay</h2><output id="tick" class="mono"></output></div>
      <canvas id="scene" width="320" height="156" aria-label="Pixel art of the simulated seed, growing canopy, glazed tile, and moving bead"></canvas></section>
    <aside class="panel routes"><div class="head"><h2>Cue routing</h2></div>
      <ul id="routes"></ul><div class="footer"><button type="button" id="save">Download run JSON</button></div></aside>
  </div>
  <section class="panel wave"><div class="head"><h2>Soundtrack</h2><output class="mono">Click the waveform to seek</output></div>
    <canvas id="timeline" width="768" height="56" aria-label="Audio waveform, cue times and playhead"></canvas></section>
  <audio id="audio" preload="auto" src="data:audio/wav;base64,${wav}"></audio>
</main>
<script>${ink.bundle()}</script>
<script>
(() => {
  const recording = ${JSON.stringify(saved)}, routes = ${JSON.stringify(schedule)}, peaks = ${JSON.stringify(peaks)};
  const scrub = KIT.world.scrub.create(recording, { checkpointEvery: 12, checkpointCache: 24 });
  const duration = ${duration}, dt = recording.origin.world.dt;
  const el = name => document.getElementById(name);
  const seek = el('seek'), play = el('play'), audio = el('audio');
  const ctx = el('scene').getContext('2d'), wave = el('timeline').getContext('2d');
  const items = routes.map(row => {
    const item = document.createElement('li'), trigger = document.createElement('button');
    const stamp = document.createElement('span'), label = document.createElement('strong'), status = document.createElement('span');
    const source = document.createElement('small');
    trigger.type = 'button'; trigger.className = 'route'; trigger.style.setProperty('--cue', row.color);
    stamp.className = 'stamp'; stamp.textContent = row.time.toFixed(2) + ' s';
    label.textContent = row.label; status.className = 'status'; source.textContent = row.cue + ' · ' + row.source;
    label.append(source); trigger.append(stamp, label, status); item.append(trigger); el('routes').append(item);
    trigger.addEventListener('click', () => jump(row.due * dt + .05));
    return { row, trigger, status };
  });

  function fill(color, x, y, w, h) { ctx.fillStyle = color; ctx.fillRect(Math.round(x), Math.round(y), w, h); }
  function poly(color, points) {
    ctx.fillStyle = color; ctx.beginPath();
    points.forEach(([x, y], i) => ctx[i ? 'lineTo' : 'moveTo'](Math.round(x), Math.round(y)));
    ctx.closePath(); ctx.fill();
  }
  function canopy(progress) {
    const stem = '#639375', tip = '#c6e7a5';
    for (let i = -6; i <= 6; i++) {
      const length = (74 - Math.abs(i) * 5) * progress;
      for (let p = 0; p < length; p++) {
        const rise = p / 74, x = 130 + i * (rise * 8) + Math.sin(rise * 5 + i) * 7 * rise;
        const y = 117 - p;
        fill(p > length - 5 ? tip : stem, x, y, 2, 2);
        if (p > 7 && (p + i * 3) % 8 === 0) {
          const side = (i + p) % 2 ? -1 : 1;
          for (let h = 1; h < 8; h++) fill(h > 5 ? tip : '#86b689', x + h * side, y - h * .66, 2, 1);
        }
      }
    }
  }
  function image(state, time) {
    fill('#18282d', 0, 0, 320, 156);
    for (let y = 7; y < 139; y += 7) for (let x = 7; x < 320; x += 7)
      fill((x + y) % 28 ? '#2b4244' : '#395856', x, y, 1, 1);
    poly('#355052', [[20,116],[69,106],[277,106],[304,116],[279,137],[41,137]]);
    poly('#284043', [[20,116],[304,116],[278,127],[42,127]]);
    for (let x = 37; x < 291; x += 5) fill('#647b61', x, 118, 2, 1);
    for (const [x, radius] of [[43,14],[129,22],[203,21],[271,20]]) {
      poly('#233638', [[x-radius,115],[x+radius,115],[x+radius-6,119],[x-radius+6,119]]);
      fill('#759080', x - 3, 114, 7, 1);
    }

    if (state.seed) {
      const [x, y] = state.seed.position, cx = 20 + (x + 4) * 22, cy = 109 - y * 26;
      const wing = 4 + Math.sin(time * 18) * 4;
      poly('#f3d8a1', [[cx-10,cy-wing],[cx,cy-1],[cx+11,cy-wing],[cx+7,cy+3],[cx,cy+5],[cx-7,cy+3]]);
      fill('#fff2bf', cx - 1, cy - 4, 3, 7);
      for (let i = 1; i <= 5; i++) fill('#ae9471', cx - 5 - i * 3, cy + Math.cos(time * 7 + i) * i, 2, 1);
    }
    canopy(state.growth);
    const glaze = state.paint?.color ? state.paint.color.map(value => Math.round(value * 255)) : null;
    const color = glaze ? 'rgb(' + glaze.join(',') + ')' : '#738a86';
    poly('#426267', [[176,105],[185,91],[216,91],[225,98],[216,111],[184,111]]);
    poly(color, [[176,105],[185,91],[216,91],[209,105]]);
    for (let i = 1; i < 6; i++) fill(glaze ? '#ffcad0' : '#9caf99', 185 + i * 4, 99 - i * .7, 2, 1);

    const y = Math.min(112, 110 - (state.bead.position[1] - .14) * 43), x = 270;
    for (let h = 6; h > 0; h--) fill('#91bbd1', x - 1, y + h * 4, 2, 1);
    poly('#9ecdf0', [[x,y-11],[x+8,y-6],[x+8,y+4],[x,y+10],[x-8,y+4],[x-8,y-6]]);
    fill('#def3f6', x - 3, y - 5, 6, 4); fill('#658ca8', x - 3, y + 5, 6, 2);
  }

  function soundtrack(time) {
    const w = wave.canvas.width, h = wave.canvas.height, mid = h / 2;
    wave.fillStyle = '#18282d'; wave.fillRect(0, 0, w, h);
    wave.fillStyle = '#59766f'; wave.fillRect(0, mid, w, 1);
    wave.fillStyle = '#a0b6a1';
    peaks.forEach((peak, i) => wave.fillRect(i * 2, mid - peak * 18, 1, Math.max(1, peak * 36)));
    for (const route of routes) {
      wave.fillStyle = route.color; wave.fillRect(Math.round(route.time / duration * w), 3, 1, h - 6);
    }
    wave.fillStyle = '#fff1c6'; wave.fillRect(Math.min(w - 1, Math.round(time / duration * w)), 0, 1, h);
  }
  function show(time) {
    seek.value = time; el('clock').value = time.toFixed(3) + ' s';
    const tick = Math.floor(time / dt + 1e-9);
    scrub.seek(tick);
    const query = scrub.query(), state = scrub.checkpoint().states;
    const seed = query.probe('flock/agents').value.seed;
    const paint = query.probe('rig/surface-state', {}, { body: 'tile', face: '+z', uv: [.5, .5] }).value?.values.paint;
    const bead = query.probe('rig/bodies').value.bead, growth = state.canopy.value / 104;
    el('tick').value = 'Tick ' + tick;
    ctx.canvas.dataset.state = JSON.stringify({ seed: !!seed, growth, paint: !!paint, bead: bead.position[1] });
    image({ seed, growth, paint, bead }, tick * dt);
    soundtrack(time);
    for (const { row, trigger, status } of items) {
      const phase = tick >= row.due ? 'applied' : tick >= row.tick ? 'queued' : 'waiting';
      trigger.dataset.status = phase; status.textContent = phase === 'applied' ? 'Tick ' + row.due : phase;
    }
  }
  let animation;
  function jump(time) { audio.currentTime = time; show(time); }
  function frame() { show(audio.currentTime); if (!audio.paused) animation = requestAnimationFrame(frame); }
  seek.addEventListener('input', () => jump(Number(seek.value)));
  el('timeline').addEventListener('click', event => {
    const box = wave.canvas.getBoundingClientRect();
    jump(Math.max(0, Math.min(duration, (event.clientX - box.left) / box.width * duration)));
  });
  play.addEventListener('click', () => {
    if (audio.paused) audio.play().catch(error => { play.textContent = error.message; });
    else audio.pause();
  });
  audio.addEventListener('play', () => { play.textContent = 'Pause'; animation = requestAnimationFrame(frame); });
  audio.addEventListener('pause', () => { play.textContent = 'Play'; cancelAnimationFrame(animation); });
  audio.addEventListener('ended', () => show(duration));
  el('save').addEventListener('click', () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(recording, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url; link.download = 'resonant-terrarium.run.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  jump(Number(seek.value));
})();
</script>`;

const out = path.resolve(process.argv[2]);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log(out);
