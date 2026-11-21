const fs = require('node:fs');
const path = require('node:path');
const ink = require('..');

const output = process.argv[2];
if (!output) throw new Error('Usage: node examples/region-lineage-events.cjs <demo.html>');

const html = `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Region lineage · Ink Studio</title>
<style>
  * { box-sizing: border-box; }
  :root { color-scheme: dark; font: 15px system-ui, sans-serif; color: #eef3e9; background: #101817; }
  body { margin: 40px auto; width: min(calc(100% - 56px), 1310px); }
  header { padding: 0 0 24px; margin-bottom: 21px; border-bottom: 1px solid #3f5149; }
  .eyebrow, h2, .meta { margin: 0; color: #afc3b9; font: 600 11px ui-monospace, monospace; letter-spacing: .11em; text-transform: uppercase; }
  h1 { margin: 8px 0 0; font-weight: 560; font-size: clamp(42px, 6vw, 72px); line-height: .98; letter-spacing: -.06em; }
  .grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(292px, 360px); align-items: start; gap: 18px; }
  figure, aside { margin: 0; border: 1px solid #41564d; background: #1b2824; }
  .heading { min-height: 43px; display: flex; padding: 10px 13px; align-items: center; justify-content: space-between; gap: 9px; border-bottom: 1px solid #41564d; }
  canvas { display: block; background: #15201f; width: 100%; height: auto; }
  .controls { display: flex; align-items: center; gap: 12px; padding: 12px 13px; border-top: 1px solid #41564d; }
  button { color: inherit; cursor: pointer; font: inherit; text-align: left; }
  button:focus-visible, input:focus-visible { outline: 2px solid #e6ba93; outline-offset: 2px; }
  #play { min-width: 72px; padding: 8px 12px; border: 1px solid #648377; background: #264036; }
  input { flex: 1; min-width: 55px; accent-color: #efa77f; }
  output { font: 12px ui-monospace, monospace; white-space: nowrap; color: #b9cbc4; }
  .events { padding: 10px; display: grid; gap: 8px; }
  .event { display: grid; grid-template-columns: 90px 1fr; align-items: center; gap: 10px; padding: 7px; border: 1px solid #3e554a; background: #182520; }
  .event[aria-current="true"] { border-color: #e6a27f; background: #342d25; }
  .event canvas { border: 1px solid #42594f; }
  .event strong, .event small, .event code { display: block; }
  .event small { color: #b9c9be; font: 10px ui-monospace, monospace; margin-top: 3px; }
  .event code { color: #d7e9d7; font: 11px ui-monospace, monospace; margin-top: 4px; }
  .caption { margin: 13px 0 0; max-width: 70ch; color: #b9cac0; line-height: 1.55; }
  @media (max-width: 780px) { body { width: calc(100% - 28px); margin-top: 25px; } .grid { grid-template-columns: 1fr; } }
</style>
<main>
  <header><p class="eyebrow">Ink Studio · Raster tracking</p><h1>Region lineage</h1></header>
  <div class="grid">
    <figure>
      <figcaption class="heading"><h2>Tracked regions</h2><span class="meta" id="summary"></span></figcaption>
      <canvas id="stage" width="640" height="352" aria-label="Animated split, merge, disappearance, and reappearance of labeled raster regions"></canvas>
      <div class="controls">
        <button id="play" type="button">Play</button>
        <input id="seek" aria-label="Source frame" type="range" min="0" max="83" value="16">
        <output id="clock" for="seek"></output>
      </div>
    </figure>
    <aside aria-labelledby="events-title">
      <div class="heading"><h2 id="events-title">Detected events</h2><span id="event-count" class="meta"></span></div>
      <div class="events" id="events"></div>
    </aside>
  </div>
  <p class="caption">Select an event to jump to its source frame. The arrows show which region IDs entered and left the event. The stage draws a pulse at the position supplied by the tracker.</p>
</main>
<script>${ink.bundle()}</script>
<script>
(() => {
  const { drawing2d, graph } = KIT.procedural;
  const width = 320, height = 176, fps = 15, count = 84;
  const palettes = [[244, 155, 112], [144, 167, 241], [123, 218, 180]];
  const accent = id => { const [r, g, b] = palettes[(id - 1) % palettes.length]; return 'rgb(' + r + ',' + g + ',' + b + ')'; };
  const showId = id => String(id).padStart(2, '0');
  const ellipse = (x, y, rx, ry) => ({ type: 'ellipse', rect: [x - rx, y - ry, rx * 2, ry * 2], fill: '#ffffff' });
  function source(frame) {
    const divided = frame >= 16 && frame < 42;
    const phase = divided ? Math.PI * (frame - 16) / 26 : 0;
    const distance = divided ? 4 + 19 * Math.sin(phase) : 0;
    const y = 81 + 3 * Math.sin(frame / 12);
    const commands = [
      ellipse(109 - distance, y - 5 * Math.sin(phase), 24, 19),
      ellipse(154 + distance, y + 6 * Math.sin(phase), 17, 13)
    ];
    if (!divided) commands.push({ type: 'rect', rect: [124, y - 4, 20, 8], fill: '#ffffff' });
    if (frame < 55 || frame >= 63)
      commands.push(ellipse(243 + 8 * Math.sin(frame / 17), 125 + 4 * Math.sin(frame / 10), 12, 10));
    const { data } = drawing2d.render({ width, height, edges: 'hard', commands });
    const alpha = new Uint8Array(width * height);
    for (let p = 0; p < alpha.length; p++) alpha[p] = data[p * 4 + 3];
    return { width, height, channels: 1, data: alpha };
  }
  const frames = Array.from({ length: count }, (_, i) => source(i));
  const session = graph.create({
    inputs: { frames: 'array<raster>' },
    nodes: { track: { op: 'fx.trackRegions', inputs: { frames: { input: 'frames' },
      options: { value: { fps, maxDistance: 24, maxMissed: 10, minArea: 25 } } } } },
    outputs: { regions: { node: 'track' }, labels: { node: 'track', port: 'labels' }, events: { node: 'track', port: 'events' } }
  });
  const samples = frames.map((_, i) => session.evaluate({ frames }, { time: i / fps }).outputs);
  const events = samples.flatMap(({ events }, frame) => events.map(event => ({ ...event, frame })));
  const names = { split: 'Split', merge: 'Merge', disappear: 'Disappear', reappear: 'Reappear' };
  const relation = ({ from, to }) => (from.map(showId).join(' + ') || '—') + ' → ' + (to.map(showId).join(' + ') || '—');
  const layer = document.createElement('canvas');
  layer.width = width; layer.height = height;
  const pixels = layer.getContext('2d');
  const backdrop = document.createElement('canvas');
  backdrop.width = width; backdrop.height = height;
  const ground = backdrop.getContext('2d');
  const gradient = ground.createRadialGradient(145, 73, 5, 147, 87, 215);
  gradient.addColorStop(0, '#2c3f36'); gradient.addColorStop(1, '#101a1c');
  ground.fillStyle = gradient; ground.fillRect(0, 0, width, height);
  function path(ctx, points, color, weight = .65) {
    ctx.beginPath(); ctx.moveTo(...points[0]);
    for (let i = 1; i < points.length; i++) ctx.lineTo(...points[i]);
    ctx.lineWidth = weight; ctx.strokeStyle = color; ctx.stroke();
  }
  for (let y = 13; y < height; y += 11) {
    const points = Array.from({ length: 81 }, (_, i) => [i * 4, y + 2.5 * Math.sin(i / 8 + y / 15)]);
    path(ground, points, '#789a8133', .55);
  }
  for (let x = 16; x < width; x += 24) for (let y = 13; y < height; y += 22) {
    ground.fillStyle = '#a8bd9d4d'; ground.fillRect(x, y, .8, .8);
  }
  function caption(ctx, text, x, y, color, size = 7) {
    ctx.fillStyle = color; ctx.font = size + 'px ui-monospace, monospace'; ctx.fillText(text, x, y);
  }
  function paint(canvas, frame, event, compact = false) {
    const { regions, labels } = samples[frame];
    const ctx = canvas.getContext('2d'), ratio = canvas.width / width;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(backdrop, 0, 0);
    const image = pixels.createImageData(width, height);
    for (let p = 0; p < labels.data.length; p++) {
      const id = labels.data[p];
      if (!id) continue;
      const color = palettes[(id - 1) % palettes.length];
      const grain = ((p * 47) % 19) / 72 + .59;
      image.data.set([color[0] * grain, color[1] * grain, color[2] * grain, 220], p * 4);
    }
    pixels.putImageData(image, 0, 0);
    ctx.drawImage(layer, 0, 0);
    for (const { id, contours, bounds, center } of regions) {
      const color = accent(id);
      for (const contour of contours) path(ctx, contour.points, color, 1.05);
      if (compact) continue;
      const y = bounds.y - 7, x = center[0];
      path(ctx, [[x, y + 3], [x, bounds.y]], color);
      caption(ctx, 'ID ' + showId(id), x - 10, y, color);
    }
    if (!event) return;
    const elapsed = Math.min(frame - event.frame, 10), [x, y] = event.center;
    ctx.setLineDash([2.5, 2.5]);
    ctx.strokeStyle = '#fff1cb'; ctx.lineWidth = .65;
    ctx.beginPath(); ctx.ellipse(x, y, 9 + elapsed * 1.1, 9 + elapsed * 1.1, 0, 0, 2 * Math.PI); ctx.stroke();
    ctx.setLineDash([]);
    if (compact) return;
    const callout = names[event.type].toUpperCase() + '  ' + relation(event);
    ctx.font = '7px ui-monospace, monospace';
    const labelWidth = ctx.measureText(callout).width;
    const u = Math.min(width - labelWidth - 11, Math.max(10, x - labelWidth / 2));
    ctx.fillStyle = '#141c1a'; ctx.fillRect(u - 4, y + 23, labelWidth + 8, 13);
    caption(ctx, callout, u, y + 32, '#fff1cb');
  }
  const canvas = document.getElementById('stage'), seek = document.getElementById('seek'), play = document.getElementById('play');
  let current = Number(seek.value), request, start, first;
  const entries = events.map(event => {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'event';
    button.dataset.type = event.type; button.dataset.frame = event.frame;
    const thumbnail = document.createElement('canvas'); thumbnail.width = 160; thumbnail.height = 88; thumbnail.setAttribute('aria-hidden', 'true');
    const detail = document.createElement('div');
    const name = document.createElement('strong'); name.textContent = names[event.type];
    const meta = document.createElement('small'); meta.textContent = (event.frame / fps).toFixed(2) + ' s · FRAME ' + event.frame;
    const ids = document.createElement('code'); ids.textContent = relation(event);
    detail.append(name, meta, ids);
    button.append(thumbnail, detail);
    paint(thumbnail, event.frame, event, true);
    button.addEventListener('click', () => { pause(); select(event.frame); });
    document.getElementById('events').append(button);
    return { button, event };
  });
  document.getElementById('event-count').textContent = events.length + ' events';
  function select(frame) {
    current = frame; seek.value = frame;
    const recent = entries.findLast(({ event }) => event.frame <= frame);
    for (const entry of entries) entry.button.setAttribute('aria-current', String(entry === recent));
    paint(canvas, frame, recent && frame - recent.event.frame < 11 ? recent.event : undefined);
    document.getElementById('summary').textContent = samples[frame].regions.length + ' visible · Frame ' + showId(frame);
    document.getElementById('clock').value = (frame / fps).toFixed(2) + ' s';
  }
  function animate(now) {
    start ??= now;
    const frame = (first + Math.floor((now - start) * fps / 1000)) % count;
    if (frame !== current) select(frame);
    request = requestAnimationFrame(animate);
  }
  function pause() {
    if (request === undefined) return;
    cancelAnimationFrame(request); request = undefined; play.textContent = 'Play';
  }
  play.addEventListener('click', () => {
    if (request !== undefined) { pause(); return; }
    start = undefined; first = current; play.textContent = 'Pause'; request = requestAnimationFrame(animate);
  });
  seek.addEventListener('input', () => { pause(); select(Number(seek.value)); });
  select(current);
})();
</script>
</html>`;

fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
fs.writeFileSync(output, html);
