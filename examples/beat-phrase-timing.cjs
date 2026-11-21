const fs = require('node:fs');
const path = require('node:path');
const ink = require('..');

if (!process.argv[2]) throw new Error('Usage: node examples/beat-phrase-timing.cjs <demo.html>');

const K = ink.load().KIT, { musicTiming } = K.procedural;
const tempoMap = { tempo: 120, beatsPerBar: 4, barsPerPhrase: 2,
  changes: [{ beat: 8, tempo: 150, swing: { numerator: 2, denominator: 3 } }] };
const clock = musicTiming.compile(tempoMap), duration = clock.timeAt({ phrase: 2 });
const early = { beat: 7.5, offset: -.06 }, late = { bar: 2, beat: .5, offset: .09 };
const key = (time, value) => ({ time, value });
const score = {
  tempoMap, duration: { phrase: 2 },
  tracks: [
    { target: '/form/size', keys: Array.from({ length: 16 }, (_, beat) =>
      [key({ beat }, 1.06), key({ beat: beat + .3 }, .91), key({ beat: beat + .78 }, .92)]).flat() },
    { target: '/form/angle', keys: [0, 1.7, 3.1, 4.35, 6.5].map((angle, bar) => key({ bar }, angle)) },
    { target: '/form/palette', mode: 'step', keys: [key({ phrase: 0 }, 'copper'), key({ phrase: 1 }, 'jade')] },
    { target: '/form/accent', keys: [key(0, 0), key({ beat: 7.5, offset: -.14 }, 0), key(early, 1),
      key({ beat: 7.5, offset: .12 }, 0), key({ bar: 2, beat: .5 }, 0), key(late, 1),
      key({ bar: 2, beat: .5, offset: .27 }, 0)] }
  ],
  markers: [{ id: 'phrase-open', time: { phrase: 1 }, label: 'Phrase 2' },
    { id: 'early', time: early, label: 'Early accent' }, { id: 'late', time: late, label: 'Late accent' }]
};

const sampleRate = 24000, samples = new Float64Array(Math.round(duration * sampleRate));
function hit(at, pitch, volume, decay) {
  const start = Math.round(at * sampleRate), count = Math.round(decay * 7 * sampleRate);
  for (let i = 0; i < count && start + i < samples.length; i++) {
    const t = i / sampleRate, pitchBend = pitch < 150 ? .54 * (1 - Math.exp(-t * 85)) : 0;
    const phase = 2 * Math.PI * (pitch * t + pitchBend);
    samples[start + i] += Math.exp(-t / decay) * volume * (.7 * Math.cos(phase) + .3 * Math.cos(phase * 1.72));
  }
}
for (let beat = 0; beat < 16; beat++) {
  hit(clock.timeAt({ beat }), beat % 4 === 0 ? 65 : 103, beat % 4 === 0 ? .82 : .47, .045);
  hit(clock.timeAt({ beat: beat + .5 }), 1360 + 50 * (beat % 4), .21, .018);
}
for (const position of [early, late]) hit(clock.timeAt(position), 540, .32, .065);
const audio = ink.encodeWav({ sampleRate, channels: 1, samples }).toString('base64');

const html = `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Beat and phrase timing · Ink Studio</title>
<style>
  * { box-sizing: border-box; }
  :root { color-scheme: dark; background: #142126; color: #fbf4de; font: 15px system-ui, sans-serif; }
  body { width: min(1220px, calc(100% - 64px)); margin: 35px auto; }
  header { display: grid; grid-template-columns: minmax(0,1fr) auto; gap: 20px; align-items: end; margin-bottom: 22px; }
  h1 { margin: 5px 0 8px; font: 450 clamp(39px, 6.15vw, 89px)/.98 Georgia, serif; letter-spacing: -.065em; }
  h2, p { margin: 0; }
  h2 { font-size: 15px; font-weight: 650; }
  .mono, button { font: 600 11px/1.35 ui-monospace, monospace; letter-spacing: .06em; }
  .kicker { color: #f8b985; text-transform: uppercase; }
  .lede { color: #d0dade; max-width: 64ch; line-height: 1.45; }
  .controls { display: flex; align-items: center; gap: 10px; }
  button { padding: 8px 11px; background: #263a40; color: inherit; cursor: pointer; border: 1px solid #5c7479; }
  button:hover, button:focus-visible { border-color: #ffd5a3; outline: 1px solid #ffd5a3; }
  #play { min-width: 67px; }
  #seek { width: clamp(88px, 13vw, 150px); accent-color: #b1e8c7; }
  #time { min-width: 59px; color: #f7cc9f; white-space: nowrap; }
  .main { display: grid; grid-template-columns: minmax(0, 3.35fr) minmax(0, 1fr); gap: 13px; }
  .panel { min-width: 0; border: 1px solid #5a7276; background: #203237; }
  .head { min-height: 39px; display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap;
    padding: 9px 13px; border-bottom: 1px solid #5a7276; }
  .head span { color: #bdcfd1; }
  canvas { width: 100%; height: auto; display: block; image-rendering: pixelated; }
  .stats { display: flex; flex-direction: column; gap: 16px; justify-content: space-between; padding: 17px 15px; }
  .stats h2 { color: #d0e5e1; }
  .tempo { white-space: nowrap; }
  .tempo b { font: 420 clamp(43px, 7vw, 88px)/.85 Georgia, serif; letter-spacing: -.06em; color: #c5edc3; }
  .tempo span { color: #c5edc3; }
  .data { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 8px 7px; margin: 0; }
  .data dt { color: #afc8c9; } .data dd { text-align: right; margin: 0; color: #ffeece; }
  .cue { color: #ffd29c; border-top: 1px solid #526968; padding-top: 10px; }
  .cue .mono { display: block; margin-top: 4px; color: #b7c9ca; }
  .score { margin-top: 12px; }
  .row { display: grid; grid-template-columns: 96px minmax(0,1fr); }
  .row + .row { border-top: 1px solid #426069; }
  .category { color: #d0dddd; align-self: center; padding: 8px 12px; }
  .lane { height: 39px; position: relative; margin: 0 23px 0 5px; }
  .lane.beats { height: 50px; } .lane.accents { height: 47px; }
  .strip { position: absolute; inset-block: 0; padding: 11px 8px; color: #e0f0e8; white-space: nowrap; overflow: hidden; }
  .strip.first { background: #31494c; } .strip.second { background: #3a5550; }
  .strip strong { color: #ffdaad; margin-right: 8px; }
  .division { position: absolute; width: 1px; top: 0; bottom: 0; background: #6b8789; }
  .beat, .half, .straight { position: absolute; bottom: 8px; width: 2px; height: 17px; background: #9bbfb3; }
  .beat.bar { height: 27px; background: #d6eadc; }
  .half { width: 1px; height: 11px; background: #f0ad79; }
  .straight { width: 1px; height: 11px; background: #728786; opacity: .8; bottom: 8px; }
  .accent { position: absolute; top: 9px; margin-left: -5px; background: #304741; border-color: #829a82; padding: 4px 6px; white-space: nowrap; }
  .accent::before { content: ''; display: inline-block; width: 6px; height: 6px; background: #fcd2a4; margin-right: 5px; transform: rotate(45deg); }
  .accent.early { transform: translateX(calc(-100% + 14px)); }
  .accent[aria-current="true"] { border-color: #ffdbab; background: #4b5948; }
  .playhead { position: absolute; z-index: 3; width: 1px; inset-block: 0; background: #ffdfaa; pointer-events: none; }
  .legend { color: #c2d5d3; padding: 10px 12px; display: flex; gap: 16px; flex-wrap: wrap; border-top: 1px solid #426069; }
  .legend i { display: inline-block; width: 8px; height: 8px; margin-right: 6px; background: var(--ink); }
  @media (max-width: 770px) {
    body { width: calc(100% - 26px); margin-top: 22px; }
    header, .main { grid-template-columns: 1fr; }
    .stats { display: grid; grid-template-columns: auto 1fr; align-items: center; }
    .stats h2, .cue { grid-column: 1 / -1; }
    .row { grid-template-columns: 65px minmax(0,1fr); }
    .category { padding: 6px 5px; }
    .lane { margin-right: 9px; }
    .strip { padding-inline: 4px; font-size: 9px; }
    .strip strong { margin-right: 3px; }
    .accent { font-size: 10px; }
  }
</style>
<main>
  <header><div><p class="mono kicker">Ink Studio · Musical timing</p><h1>Beat and phrase timing</h1>
    <p class="lede">The form pulses on beats, rotates across bars, and changes palette at the phrase boundary. Play the score to hear the tempo and swing change.</p></div>
    <div class="controls mono"><button id="play" type="button">Play</button>
      <input id="seek" type="range" min="0" max="${duration}" step=".001" value="4.357" aria-label="Playback time"><output id="time" for="seek"></output></div>
  </header>
  <div class="main">
    <section class="panel"><div class="head"><h2>Visual score</h2><span class="mono" id="palette"></span></div>
      <canvas width="304" height="140" aria-label="Pixel artwork pulsing, rotating, changing palette and lighting at musical keys"></canvas></section>
    <aside class="panel stats" aria-label="Current musical position"><h2>Playhead</h2>
      <div class="tempo"><b id="tempo"></b> <span class="mono">BPM</span></div>
      <dl class="data mono"><dt>Beat in bar</dt><dd id="beat"></dd><dt>Bar</dt><dd id="bar"></dd>
        <dt>Phrase</dt><dd id="phrase"></dd><dt>Swing</dt><dd id="swing"></dd></dl>
      <p class="cue" id="cue">Late accent<span class="mono">+90 ms from the swung offbeat</span></p></aside>
  </div>
  <section class="panel score" aria-label="Beat grid and displaced accents">
    <div class="head"><h2>Beat grid</h2><span class="mono">4 beats per bar · 2 bars per phrase</span></div>
    <div class="row"><span class="category mono">Phrase</span><div class="lane" id="phrases"><div class="playhead"></div></div></div>
    <div class="row"><span class="category mono">Beats</span><div class="lane beats" id="beats"><div class="playhead"></div></div></div>
    <div class="row"><span class="category mono">Accents</span><div class="lane accents" id="accents"><div class="playhead"></div></div></div>
    <div class="legend mono"><span><i style="--ink:#d6eadc"></i>Whole beat</span><span><i style="--ink:#f0ad79"></i>Played offbeat</span>
      <span><i style="--ink:#728786"></i>Straight reference</span></div>
  </section>
  <audio id="audio" preload="auto" src="data:audio/wav;base64,${audio}"></audio>
</main>
<script>${ink.bundle()}</script>
<script>
(() => {
  const definition = ${JSON.stringify(score)}, duration = ${duration};
  const K = KIT, { musicTiming, graph } = K.procedural, clock = musicTiming.compile(definition.tempoMap);
  const straight = musicTiming.compile({ tempo: 120, changes: [{ beat: 8, tempo: 150 }] });
  const timeline = K.timeline.compile(definition, { exact: true });
  const timing = graph.create({ nodes: { clock: { op: 'music.clock', inputs: { map: definition.tempoMap } } },
    outputs: { musical: { node: 'clock' } } });
  const byId = id => document.getElementById(id), canvas = document.querySelector('canvas'), ctx = canvas.getContext('2d');
  const seek = byId('seek'), audio = byId('audio'), transport = byId('play'), cursor = [...document.querySelectorAll('.playhead')];
  const width = canvas.width, height = canvas.height;
  const accents = new Map(), pct = time => (100 * time / duration) + '%';
  function mark(parent, time, className) {
    const line = document.createElement('span');
    line.className = className;
    line.style.left = pct(time);
    parent.append(line);
    return line;
  }
  for (let phase = 0; phase < 2; phase++) {
    const at = clock.timeAt({ phrase: phase }), strip = mark(byId('phrases'), at, 'strip mono ' + (phase ? 'second' : 'first'));
    strip.style.width = pct(clock.timeAt({ phrase: phase + 1 }) - at);
    const label = document.createElement('strong');
    label.textContent = 'Phrase ' + (phase + 1);
    strip.append(label, phase === 0 ? '120 BPM' : '150 BPM');
  }
  for (let n = 0; n < 16; n++) {
    mark(byId('beats'), clock.timeAt({ beat: n }), 'beat' + (n % 4 === 0 ? ' bar' : ''));
    if (n >= 8) mark(byId('beats'), straight.timeAt({ beat: n + .5 }), 'straight');
    mark(byId('beats'), clock.timeAt({ beat: n + .5 }), 'half');
  }
  for (const note of timeline.markers.filter(row => row.id !== 'phrase-open')) {
    const marker = document.createElement('button');
    marker.className = 'accent ' + note.id;
    marker.type = 'button';
    marker.style.left = pct(note.time);
    marker.textContent = note.id === 'early' ? '−60 ms' : '+90 ms';
    marker.setAttribute('aria-label', note.label + ' at ' + note.time.toFixed(3) + ' seconds');
    marker.addEventListener('click', () => move(note.time));
    byId('accents').append(marker);
    accents.set(note.id, { marker, time: note.time, label: note.label });
  }

  const ink = {
    copper: ['#31394a','#674052','#9e5854','#dc8360','#ffb57b','#ffe6af'],
    jade: ['#243e49','#366e6c','#449682','#76b88f','#b0e9b0','#f4efbe']
  };
  const points = [];
  for (const [band, radius] of [39, 56, 73].entries()) {
    for (let i = 0; i < 148; i++) for (let j = 0; j < 8; j++) {
      const a = Math.PI * 2 * i / 148, b = Math.PI * 2 * j / 8;
      const r = radius + (5.5 + .8 * band) * Math.cos(b);
      points.push({ x: r * Math.cos(a), y: r * Math.sin(a), z: 12 * Math.sin(b) + 7 * Math.sin(a * 3 + band),
        shade: Math.round(2 + Math.cos(b) * 1.6 + Math.sin(a + b)), band });
    }
  }
  function picture(form) {
    ctx.fillStyle = '#132328'; ctx.fillRect(0, 0, width, height);
    const x0 = width / 2, y0 = height / 2, palette = ink[form.palette];
    for (let y = 8; y < height; y += 8) for (let x = 8; x < width; x += 8) {
      ctx.fillStyle = (x + y) % 32 ? '#23383a' : '#3a5150';
      ctx.fillRect(x, y, 1, 1);
    }
    const tilt = .37 + .23 * Math.sin(form.angle), c = Math.cos(tilt), s = Math.sin(tilt);
    const turn = Math.cos(form.angle), side = Math.sin(form.angle);
    const flare = form.accent * 13;
    ctx.fillStyle = form.accent > .5 ? '#5d6552' : '#304743';
    ctx.fillRect(x0 - 96, y0, 192, 1); ctx.fillRect(x0, y0 - 53, 1, 106);
    const visible = points.map(p => {
      const x = p.x * turn - p.y * side, y = p.y * turn + p.x * side;
      const bent = (y * s + p.z * c), depth = y * c - p.z * s;
      const size = form.size * (1 + flare / (130 + p.band * 27)) * (1 + depth * .0024);
      const color = Math.max(0, Math.min(5, p.shade + Number(depth > 14) + Number(form.accent > .45)));
      return { x: Math.floor(x0 + x * size * 1.24), y: Math.floor(y0 + bent * size), depth, color };
    }).sort((a, b) => a.depth - b.depth);
    for (const p of visible) { ctx.fillStyle = palette[p.color]; ctx.fillRect(p.x, p.y, p.depth > 0 ? 2 : 1, 1); }
    ctx.fillStyle = form.accent > .5 ? '#f7dfad' : palette[4];
    const cross = Math.round(4 + form.accent * 7);
    ctx.fillRect(x0 - cross, y0, cross * 2 + 1, 1); ctx.fillRect(x0, y0 - cross, 1, cross * 2 + 1);
  }

  function show(seconds) {
    seek.value = seconds;
    byId('time').value = seconds.toFixed(3) + ' s';
    const beat = timing.evaluate({}, { time: seconds }).outputs.musical;
    const form = Object.fromEntries(timeline.sample(seconds).edits.map(row => [row.path.at(-1), row.value]));
    byId('tempo').textContent = beat.tempo;
    byId('beat').textContent = (1 + beat.beatInBar).toFixed(2);
    byId('bar').textContent = String(1 + beat.bar).padStart(2, '0');
    byId('phrase').textContent = String(1 + beat.phrase).padStart(2, '0');
    byId('swing').textContent = beat.swing === .5 ? 'Straight' : Math.round(100 * beat.swing) + '%';
    byId('palette').textContent = form.palette === 'jade' ? 'Jade palette' : 'Copper palette';
    let active;
    for (const [id, note] of accents) {
      const selected = Math.abs(seconds - note.time) < .02;
      note.marker.setAttribute('aria-current', selected);
      if (selected) active = id;
    }
    const cue = byId('cue');
    cue.firstChild.nodeValue = active ? accents.get(active).label : 'Accent timing';
    cue.querySelector('span').textContent = active === 'late' ? '+90 ms from the swung offbeat' :
      active === 'early' ? '−60 ms from the offbeat' : 'Select an accent to jump to it';
    for (const line of cursor) line.style.left = pct(seconds);
    canvas.dataset.accent = form.accent.toFixed(3);
    picture(form);
  }
  let animation;
  function move(time) { audio.currentTime = time; show(time); }
  function frame() { show(audio.currentTime); if (!audio.paused) animation = requestAnimationFrame(frame); }
  seek.addEventListener('input', () => move(Number(seek.value)));
  transport.addEventListener('click', () => {
    if (audio.paused) audio.play().catch(error => { transport.textContent = error.message; });
    else audio.pause();
  });
  audio.addEventListener('play', () => { transport.textContent = 'Pause'; animation = requestAnimationFrame(frame); });
  audio.addEventListener('pause', () => { transport.textContent = 'Play'; cancelAnimationFrame(animation); });
  audio.addEventListener('ended', () => show(duration));
  move(Number(seek.value));
})();
</script>`;

const output = path.resolve(process.argv[2]);
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, html);
console.log(output);
