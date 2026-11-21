const fs = require('node:fs');
const path = require('node:path');
const ink = require('..');

const output = process.argv[2];
if (!output) throw new Error('Usage: node examples/tracked-drawing-anchors.cjs <demo.html>');

const html = `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tracked drawing anchors · Ink Studio</title>
<style>
  * { box-sizing: border-box; }
  :root { color-scheme: dark; background: #1b1823; color: #fff0de; font: 15px system-ui, sans-serif; }
  body { width: min(1248px, calc(100% - 64px)); margin: 40px auto; }
  header { display: grid; grid-template-columns: minmax(0,1fr) auto; align-items: end; gap: 20px; margin-bottom: 24px; }
  h1 { margin: 5px 0 10px; font: 400 clamp(38px, 5.9vw, 86px)/.95 Georgia, serif; letter-spacing: -.06em; }
  p { margin: 0; line-height: 1.55; }
  .lede { max-width: 54ch; color: #d4c6d6; }
  .kicker, .toolbar, .tag, .legend, .status { font: 600 11px/1.35 ui-monospace, monospace; letter-spacing: .07em; }
  .kicker { color: #f4b98c; text-transform: uppercase; }
  .toolbar { display: flex; align-items: center; gap: 12px; }
  button { color: inherit; background: #2b2636; border: 1px solid #62556c; padding: 9px 13px; cursor: pointer; font: inherit; }
  button:hover, button:focus-visible { border-color: #ffc498; }
  #play { min-width: 70px; }
  #seek { width: clamp(95px, 12vw, 165px); accent-color: #ffc498; }
  #clock { min-width: 57px; color: #f4b98c; }
  .grid { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 15px; }
  figure { margin: 0; min-width: 0; border: 1px solid #63546a; background: #282333; }
  figcaption { padding: 12px 15px; display: flex; flex-wrap: wrap; gap: 5px 10px; align-items: baseline; justify-content: space-between; }
  h2 { font-size: 16px; margin: 0; font-weight: 620; }
  .status { color: #bcecdf; text-transform: uppercase; }
  .status[data-state="held"] { color: #ffbc92; }
  .status[data-state="hidden"] { color: #d0b8d0; }
  canvas { display: block; width: 100%; height: auto; image-rendering: pixelated; }
  .settings { min-height: 34px; padding: 8px 15px; color: #d5c7d9; font-size: 12px; }
  .legend { list-style: none; display: flex; flex-wrap: wrap; gap: 8px 20px; padding: 0; margin: 15px 0 25px; color: #ddd1df; }
  .legend li::before { content: ''; display: inline-block; width: 9px; height: 9px; margin-right: 8px; background: var(--ink); }
  .strip { display: grid; grid-template-columns: repeat(4,minmax(0,1fr)); gap: 10px; margin-top: 8px; }
  .strip button { padding: 0; text-align: left; min-width: 0; }
  .strip button[aria-pressed="true"] { border-color: #ffc498; }
  .tag { display: flex; justify-content: space-between; gap: 4px; padding: 7px 10px; }
  .tag span { color: #c7afd2; }
  @media (max-width: 775px) { body { width: calc(100% - 30px); margin-top: 24px; } header, .grid { grid-template-columns: 1fr; } }
  @media (max-width: 520px) { .strip { grid-template-columns: 1fr 1fr; } }
</style>
<main>
  <header>
    <div><p class="kicker">Ink Studio · Raster tracking</p><h1>Tracked drawing anchors</h1>
      <p class="lede">One moving signal carries a path, label, brush stroke and masking window. Drag the timeline through the shutter to see which marks persist.</p></div>
    <div class="toolbar"><button id="play" type="button">Play</button>
      <input id="seek" type="range" min="0" max="47" value="19" aria-label="Frame"><output id="clock" for="seek"></output></div>
  </header>
  <div class="grid">
    <figure><figcaption><h2>Immediate</h2><output class="status" id="raw-state"></output></figcaption>
      <canvas id="raw" width="240" height="138" aria-label="Unfiltered drawing attached to a tracked region"></canvas>
      <p class="settings">No smoothing, delay or hold</p></figure>
    <figure><figcaption><h2>Smoothed and held</h2><output class="status" id="held-state"></output></figcaption>
      <canvas id="held" width="240" height="138" aria-label="Filtered drawing and aperture held after tracking loss"></canvas>
      <p class="settings">100 ms smoothing half-life · 80 ms delay · 370 ms hold</p></figure>
  </div>
  <ul class="legend"><li style="--ink:#8cfae3">Path and leader</li><li style="--ink:#fff0de">Bitmap label</li>
    <li style="--ink:#ffb290">Brush stroke</li><li style="--ink:#c493ff">Masked texture</li></ul>
  <h2>Tracking through the shutter</h2>
  <div class="strip" aria-label="Jump to a tracking state">
    <button type="button" data-frame="12"><canvas width="240" height="138" aria-hidden="true"></canvas><span class="tag">Tracked <span>1.00 s</span></span></button>
    <button type="button" data-frame="19"><canvas width="240" height="138" aria-hidden="true"></canvas><span class="tag">Held <span>1.58 s</span></span></button>
    <button type="button" data-frame="24"><canvas width="240" height="138" aria-hidden="true"></canvas><span class="tag">Expired <span>2.00 s</span></span></button>
    <button type="button" data-frame="29"><canvas width="240" height="138" aria-hidden="true"></canvas><span class="tag">Reacquired <span>2.42 s</span></span></button>
  </div>
</main>
<script>${ink.bundle()}</script>
<script>
(() => {
  const { graph, raster } = KIT.procedural;
  const width = 240, height = 138, fps = 12;
  const place = node => ({ node });
  const port = (node, port) => ({ node, port });
  const literal = value => ({ value });
  const input = input => ({ input });

  function plate(frame) {
    const source = new Uint8Array(width * height * 4), gate = new Uint8Array(width * height);
    const cx = 55 + frame * 2.38 + 1.4 * Math.sin(frame * 1.9);
    const cy = 79 + 10 * Math.sin(frame * .093) + 1.7 * Math.cos(frame * 1.7);
    for (let p = 0; p < gate.length; p++) {
      const x = p % width, y = Math.floor(p / width), i = p * 4;
      const dist = Math.hypot((x - cx) * .91, y - cy), noise = (x * 29 ^ y * 13 ^ (x * y * 7)) & 7;
      const grid = x % 12 === 0 && y % 12 === 0 ? 19 : 0;
      const surface = Math.cos(x * .026 + y * .096) * 5 + noise + grid;
      let r = 27 + surface, g = 28 + surface, b = 42 + surface;
      if ((x === 12 || x === 227) && y % 6 === 0 || (y === 13 || y === 124) && x % 6 === 0)
        [r, g, b] = [107, 93, 122];
      if (dist < 11 && (frame < 17 || frame >= 26)) {
        gate[p] = 255;
        const pulse = Math.sin((x - cx) * .7 - (y - cy) * .9) * 13;
        [r, g, b] = dist > 9.6 ? [255, 204, 147] : [172 + pulse + noise, 68 + pulse, 88 + noise];
        if (Math.abs(x - cx) < 1.2 || Math.abs(y - cy) < 1.2) [r, g, b] = [255, 225, 175];
      }
      if (x >= 95 && x <= 120) {
        const stripe = ((x + y) % 7 < 2 ? 6 : 0) + (x === 95 || x === 120 ? 25 : 0);
        [r, g, b] = [48 + stripe + noise, 39 + stripe + noise, 62 + stripe + noise];
        if (x > 99 && x < 116 && (y === 20 || y === 117)) [r, g, b] = [229, 159, 129];
      }
      source.set([r, g, b, 255], i);
    }
    return { color: { width, height, channels: 4, data: source }, region: { width, height, channels: 1, data: gate } };
  }

  function pattern() {
    const data = new Uint8Array(width * height * 4);
    for (let y = 0, p = 0; y < height; y++) for (let x = 0; x < width; x++, p += 4) {
      const arc = Math.hypot(1.2 * (x % 42 - 21), y % 34 - 16);
      const line = (Math.floor(arc * .7) % 4 < 1 ? 45 : 0) + ((x + y) % 6 < 1 ? 22 : 0);
      data.set([90 + line, 50 + line, 140 + line, 255], p);
    }
    return { width, height, channels: 4, data };
  }

  const bindings = [{ id: 'signal', track: 1, commands: [
    { type: 'path', d: 'M -19 -6 V -13 H -12 M 12 -13 H 19 V -6 M -19 6 V 13 H -12 M 12 13 H 19 V 6 M 19 -13 L 25 -27 H 31',
      stroke: '#8cfae3', width: 1 },
    { type: 'rect', rect: [30, -33, 33, 12], fill: '#261f32', stroke: '#8cfae3', width: 1 },
    { type: 'text', text: 'SIG 1', at: [32, -31], color: '#fff0de' },
    { type: 'ribbon', points: [[-25, 19], [-19, 24], [-9, 27], [5, 24], [17, 16]], width: [1, 4, 6, 3, 1], fill: '#ffb290' }
  ], masks: [
    { type: 'ellipse', rect: [-28, -22, 56, 44], fill: '#ffffff' }
  ] }];

  const frames = Array.from({ length: 48 }, (_, frame) => plate(frame));
  const sceneInputs = { regions: frames.map(frame => frame.region) };
  const texture = pattern();
  const draw = commands => ({ op: 'draw.render', inputs: { width, height, commands, edges: 'hard' } });
  const follow = controls => ({ op: 'draw.trackedAnchors', inputs: { observations: place('observations'),
    bindings: literal(bindings.map(binding => ({ ...binding, ...controls }))) } });
  const scene = graph.create({
    inputs: { regions: 'array<raster>' },
    nodes: {
      observations: { op: 'fx.regionObservations', inputs: { frames: input('regions'),
        options: literal({ fps, minArea: 30, maxMissed: 12 }) } },
      raw: follow({}),
      held: follow({ smoothing: .10, lag: .08, hold: .37 }),
      rawDrawing: draw(place('raw')),
      heldDrawing: draw(place('held')),
      rawMask: draw(port('raw', 'masks')),
      heldMask: draw(port('held', 'masks'))
    },
    outputs: {
      raw: place('rawDrawing'), held: place('heldDrawing'), rawMask: place('rawMask'), heldMask: place('heldMask'),
      rawAnchor: port('raw', 'anchors'), heldAnchor: port('held', 'anchors')
    }
  });
  const cache = new Map();
  function images(frame) {
    if (!cache.has(frame)) {
      const art = scene.evaluate(sceneInputs, { time: frame / fps }).outputs;
      const combine = (source, mask) => raster.stack({ width, height, layers: [
        { source: frames[frame].color }, { source: texture, mask, opacity: .63 }, { source }
      ] }).value;
      cache.set(frame, { raw: combine(art.raw, art.rawMask), held: combine(art.held, art.heldMask),
        rawState: art.rawAnchor[0], heldState: art.heldAnchor[0] });
    }
    return cache.get(frame);
  }

  const seek = document.getElementById('seek'), clock = document.getElementById('clock'), play = document.getElementById('play');
  const jumps = [...document.querySelectorAll('[data-frame]')];
  const image = (target, source) => target.getContext('2d').putImageData(
    new ImageData(Uint8ClampedArray.from(source.data), width, height), 0, 0);
  let timer = null;
  function stop() { clearInterval(timer); timer = null; play.textContent = 'Play'; }
  function render(frame) {
    seek.value = frame;
    clock.value = (frame / fps).toFixed(2) + ' s';
    const sample = images(frame);
    for (const name of ['raw', 'held']) {
      image(document.getElementById(name), sample[name]);
      const status = document.getElementById(name + '-state');
      const { position, status: state } = sample[name + 'State'];
      status.dataset.state = state;
      status.value = position ? state + ' · ' + position.map(n => n.toFixed(1)).join(', ') + ' px' : state;
    }
    for (const button of jumps) button.setAttribute('aria-pressed', Number(button.dataset.frame) === frame);
  }
  for (const button of jumps) {
    const frame = Number(button.dataset.frame);
    image(button.querySelector('canvas'), images(frame).held);
    button.addEventListener('click', () => { stop(); render(frame); });
  }
  seek.addEventListener('input', () => { stop(); render(Number(seek.value)); });
  play.addEventListener('click', () => {
    if (timer !== null) return stop();
    play.textContent = 'Pause';
    timer = setInterval(() => render((Number(seek.value) + 1) % frames.length), 1000 / fps);
  });
  render(Number(seek.value));
})();
</script>`;

const target = path.resolve(output);
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, html);
console.log(target);
