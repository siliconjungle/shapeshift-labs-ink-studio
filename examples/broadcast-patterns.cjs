const fs = require('node:fs');
const path = require('node:path');
const ink = require('..');

const output = process.argv[2];
if (!output) throw new Error('Usage: node examples/broadcast-patterns.cjs <demo.html>');

const patterns = [
  ['sd', 'EG 1', '4:3 · reverse-blue strip and PLUGE', 320, 240],
  ['hd', 'RP 219', '16:9 · luminance ramp and PLUGE', 416, 234]
];
const presets = [
  ['snow', 'Snow', 'Fine monochrome grain', 300, 168],
  ['chroma', 'Chroma', 'Color interference', 300, 168],
  ['weak-signal', 'Weak signal', 'Horizontal streaks', 300, 168],
  ['tracking', 'Tracking', 'Rolling interference band', 300, 168]
];
const feed = [
  ['source', 'Original feed', 'Pixel-art raster', 320, 144],
  ['interference', 'Interference', 'Tracking static at 38% opacity', 320, 144]
];

function cards(specs) {
  return specs.map(([id, title, description, width, height]) => `
    <figure>
      <canvas id="${id}" width="${width}" height="${height}" aria-label="${title}"></canvas>
      <figcaption><strong>${title}</strong><span>${description}</span></figcaption>
    </figure>`).join('');
}

const html = `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Broadcast patterns · Ink Studio</title>
<style>
  * { box-sizing: border-box; }
  :root { color-scheme: dark; font: 15px system-ui, sans-serif; background: #111513; color: #e8ebe1; }
  body { width: min(1380px, calc(100% - 64px)); margin: 36px auto 30px; }
  header { display: flex; align-items: end; justify-content: space-between; gap: 24px; padding-bottom: 22px; border-bottom: 1px solid #3b453d; }
  h1 { margin: 0; font-size: clamp(32px, 5vw, 58px); font-weight: 570; line-height: 1.04; letter-spacing: -.055em; }
  h2 { margin: 18px 0 9px; font-size: 13px; font-weight: 650; letter-spacing: .1em; text-transform: uppercase; color: #b8cca4; }
  .controls { display: flex; gap: 14px; align-items: center; flex-wrap: wrap; }
  button { padding: 9px 14px; border: 1px solid #75866a; background: #273329; color: inherit; font: inherit; cursor: pointer; }
  input { width: clamp(85px, 11vw, 180px); accent-color: #b4d58e; }
  output { min-width: 7ch; color: #cbd5c6; font: 12px ui-monospace, monospace; }
  .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
  .presets { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  figure { margin: 0; background: #1b211d; border: 1px solid #374139; }
  canvas { display: block; width: 100%; height: 224px; object-fit: contain; background: #080b09; image-rendering: pixelated; }
  .presets canvas { height: auto; aspect-ratio: 25 / 14; }
  .feed canvas { height: 164px; }
  figcaption { padding: 9px 12px; display: flex; justify-content: space-between; gap: 8px; flex-wrap: wrap; align-items: center; }
  strong { font-weight: 640; }
  span { color: #b1bdb0; font: 11px ui-monospace, monospace; }
  @media (max-width: 800px) { body { width: calc(100% - 32px); margin-top: 22px; } header { align-items: start; flex-direction: column; } .presets { grid-template-columns: repeat(2, minmax(0, 1fr)); } canvas { height: 152px; } }
  @media (max-width: 460px) { .grid:not(.presets) { grid-template-columns: 1fr; } }
</style>
<main>
  <header><h1>Broadcast patterns</h1><div class="controls">
    <button type="button" id="play">Play static</button>
    <input id="seek" aria-label="Static time" type="range" min="0" max="5" step=".01" value=".5">
    <output id="clock" for="seek">0.50 s</output>
  </div></header>
  <section aria-labelledby="bars-title"><h2 id="bars-title">SMPTE color bars</h2><div class="grid">${cards(patterns)}</div></section>
  <section aria-labelledby="static-title"><h2 id="static-title">TV static</h2><div class="grid presets">${cards(presets)}</div></section>
  <section aria-labelledby="overlay-title"><h2 id="overlay-title">Static over a raster</h2><div class="grid feed">${cards(feed)}</div></section>
</main>
<script>${ink.bundle()}</script>
<script>
  const { graph, drawing2d } = KIT.procedural;
  const rect = (x, y, w, h, fill) => ({ type: 'rect', rect: [x, y, w, h], fill });
  const poly = (points, fill) => ({ type: 'polygon', points, fill });
  const text = (x, y, label, color) => ({ type: 'text', at: [x, y], text: label, color });
  const source = drawing2d.render({ width: 320, height: 144, edges: 'hard', commands: [
    rect(0, 0, 320, 144, '#243443'), rect(0, 18, 320, 55, '#425765'),
    { type: 'ellipse', rect: [246, 28, 34, 34], fill: '#c48163' },
    rect(0, 70, 320, 74, '#263d4b'),
    poly([[0, 88], [42, 63], [67, 66], [87, 83], [114, 87], [139, 107], [0, 107]], '#242c37'),
    poly([[0, 98], [46, 86], [90, 89], [129, 106], [167, 119], [0, 119]], '#374854'),
    poly([[73, 93], [79, 48], [98, 48], [104, 94]], '#b06353'),
    rect(81, 42, 15, 10, '#e0b980'), rect(78, 53, 20, 5, '#ede0c4'),
    poly([[77, 42], [88, 33], [100, 42]], '#282e39'),
    poly([[94, 44], [223, 30], [223, 55], [94, 48]], '#b08d69'),
    ...[0, 1, 2, 3, 4, 5].map(i => rect(159 + 18 * i, 84 + 6 * i, 28 + 3 * i, 1, '#59777a')),
    rect(0, 0, 320, 15, '#202b37'), rect(0, 129, 320, 15, '#202b37'),
    text(8, 3, 'NORTH LIGHT', '#e8d4a0'), text(271, 3, 'CAM 04', '#c9dfcc'),
    text(8, 132, 'COASTAL RELAY', '#b0cabc')
  ] });

  const opts = value => ({ value });
  const nodes = {
    sd: { op: 'proc.smpteColorBars', inputs: { options: opts({ pattern: 'eg1', width: 320, height: 240 }) } },
    hd: { op: 'proc.smpteColorBars', inputs: { options: opts({ pattern: 'rp219', width: 416, height: 234 }) } },
    interference: { op: 'fx.tvStatic', inputs: { source: { input: 'source' },
      options: opts({ preset: 'tracking', opacity: .38, density: .92 }) } }
  };
  for (const [preset, , , width, height] of ${JSON.stringify(presets)}) {
    nodes[preset] = { op: 'proc.tvStatic', inputs: { options: opts({ preset, width, height }) } };
  }
  const names = Object.keys(nodes);
  const session = graph.create({
    inputs: { source: 'raster' }, nodes,
    outputs: Object.fromEntries(names.map(node => [node, { node }]))
  });
  const contexts = Object.fromEntries(names.concat('source').map(id =>
    [id, document.getElementById(id).getContext('2d')]));
  const play = document.getElementById('play'), seek = document.getElementById('seek'), clock = document.getElementById('clock');
  function paint(id, { data, width, height }) {
    contexts[id].putImageData(new ImageData(Uint8ClampedArray.from(data), width, height), 0, 0);
  }
  let running = false, previous, raf, time = Number(seek.value);
  function draw() {
    const { outputs } = session.evaluate({ source }, { time, seed: 127 });
    for (const id of names) paint(id, outputs[id]);
    clock.value = time.toFixed(2) + ' s';
  }
  function tick(now) {
    if (previous === undefined || now - previous >= 40) {
      time = (time + (previous === undefined ? 0 : (now - previous) / 1000)) % 5;
      previous = now;
      seek.value = time;
      draw();
    }
    if (running) raf = requestAnimationFrame(tick);
  }
  play.addEventListener('click', () => {
    running = !running;
    play.textContent = running ? 'Pause static' : 'Play static';
    if (running) { previous = undefined; raf = requestAnimationFrame(tick); }
    else cancelAnimationFrame(raf);
  });
  seek.addEventListener('input', () => { time = Number(seek.value); draw(); });
  paint('source', source);
  draw();
</script>
</html>`;

fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
fs.writeFileSync(output, html);
