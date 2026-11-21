const fs = require('node:fs');
const path = require('node:path');
const ink = require('..');

const output = process.argv[2];
if (!output) throw new Error('Usage: node examples/persistent-region-tracking.cjs <demo.html>');

const html = `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Persistent region tracking · Ink Studio</title>
<style>
  * { box-sizing: border-box; }
  :root { color-scheme: dark; background: #08171c; color: #ebf5eb; font: 14px system-ui, sans-serif; }
  body { width: min(1320px, calc(100% - 64px)); margin: 42px auto 28px; }
  header { border-bottom: 1px solid #34525a; padding-bottom: 20px; margin-bottom: 23px; }
  header p, h2, th { color: #9db9bb; font: 600 11px ui-monospace, monospace; letter-spacing: .13em; text-transform: uppercase; }
  header p { margin: 0 0 11px; }
  h1 { margin: 0; font-size: clamp(34px, 5.4vw, 69px); font-weight: 560; line-height: .98; letter-spacing: -.055em; }
  .layout { display: grid; grid-template-columns: minmax(0, 1fr) minmax(260px, 340px); gap: 22px; align-items: start; }
  figure, h2 { margin: 0; }
  canvas { display: block; width: 100%; height: auto; background: #0b2128; }
  figure, .telemetry { border: 1px solid #34525a; background: #10252c; }
  figcaption, .panel-heading { padding: 11px 14px; border-bottom: 1px solid #34525a; display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .state, output { font: 12px ui-monospace, monospace; color: #c5dedb; }
  .controls { display: flex; align-items: center; gap: 14px; padding: 13px 14px; border-top: 1px solid #34525a; }
  button { min-width: 76px; padding: 8px 10px; border: 1px solid #527778; background: #1b3d42; color: #ecf8ed; font: inherit; cursor: pointer; }
  input { min-width: 45px; flex: 1; accent-color: #7bd0ac; }
  output { min-width: 75px; text-align: end; }
  .telemetry { min-width: 0; }
  .regions { padding: 0 14px; }
  .region { display: grid; gap: 8px; padding: 11px 0; border-bottom: 1px solid #29444b; }
  .region > div { display: flex; gap: 12px; justify-content: space-between; }
  .region strong { font-size: 14px; }
  .region span { color: #abc2c2; font: 11px ui-monospace, monospace; }
  .region progress { width: 100%; height: 4px; accent-color: var(--track); }
  .source { margin: 14px; }
  .source canvas { image-rendering: pixelated; }
  .source figcaption { padding: 8px 9px; }
  .about { margin: 15px 0 0; max-width: 68ch; color: #b4cccb; line-height: 1.55; }
  @media (max-width: 900px) { body { margin-top: 26px; } .layout { grid-template-columns: minmax(0, 1fr) 260px; gap: 13px; } }
  @media (max-width: 720px) { body { width: calc(100% - 28px); } .layout { grid-template-columns: minmax(0, 1fr); } }
</style>
<main>
  <header><p>Ink Studio</p><h1>Persistent region tracking</h1></header>
  <div class="layout">
    <figure>
      <figcaption><h2>Tracked contours</h2><span id="state" class="state"></span></figcaption>
      <canvas id="view" width="768" height="432" aria-label="Three moving regions with persistent identifiers, outlines, trails, and velocity arrows"></canvas>
      <div class="controls">
        <button type="button" id="play">Play</button>
        <input id="seek" aria-label="Source frame" type="range" min="0" max="89" value="44">
        <output id="time" for="seek"></output>
      </div>
    </figure>
    <aside class="telemetry" aria-labelledby="objects">
      <div class="panel-heading"><h2 id="objects">Region measurements</h2><span class="state" id="frame"></span></div>
      <div class="regions" id="regions"></div>
      <figure class="source">
        <figcaption><h2>Input mask</h2></figcaption>
        <canvas id="source" width="384" height="216" aria-label="Unannotated grayscale tracking input"></canvas>
      </figure>
    </aside>
  </div>
  <p class="about">Scrub across the shaded strip to see region 01 disappear and return with the same ID. Each arrow shows the direction and speed measured from the raster.</p>
</main>
<script>${ink.bundle()}</script>
<script>
(() => {
  const { drawing2d, graph } = KIT.procedural;
  const w = 384, h = 216, fps = 15, count = 90, blank = [39, 44], tau = 2 * Math.PI;
  const colors = ['#f3bc7a', '#63d9b5', '#93baf7'];
  const rgb = [[243, 188, 122], [99, 217, 181], [147, 186, 247]];
  const maskColors = [[9, 22, 27, 255], [207, 224, 220, 255]];
  const polygon = (x, y, points) => ({ type: 'polygon', points: points.map(([u, v]) => [x + u, y + v]), fill: '#ffffff' });
  function mask(frame) {
    const u = frame / (count - 1), phase = tau * u;
    const ax = 47 + 285 * u, ay = 72 + Math.sin(phase) * 10;
    const bx = 338 - 270 * u, by = 128 - Math.sin(phase) * 10;
    const cx = 105 + 151 * u, cy = 173 + Math.sin(phase + .7) * 10;
    const commands = [
      { type: 'ellipse', rect: [bx - 16, by - 12, 32, 24], fill: false, stroke: '#ffffff', width: 4 },
      polygon(cx, cy, [[-17, 3], [-3, -7], [8, -6], [21, 4], [9, 2], [2, 8], [-5, 3]])
    ];
    if (frame < blank[0] || frame >= blank[1]) commands.push(
      polygon(ax, ay, [[-27, -10], [-15, -4], [-7, -8], [8, -8], [18, -5], [25, 0],
        [17, 5], [5, 7], [-9, 5], [-15, 2], [-27, 9], [-23, 0]])
    );
    const { data } = drawing2d.render({ width: w, height: h, commands, edges: 'hard' });
    const alpha = new Uint8Array(w * h);
    for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * 4 + 3];
    return { width: w, height: h, channels: 1, data: alpha };
  }
  const frames = Array.from({ length: count }, (_, i) => mask(i));
  const session = graph.create({
    inputs: { frames: 'array<raster>' },
    nodes: { region: { op: 'fx.trackRegions', inputs: { frames: { input: 'frames' },
      options: { value: { fps, maxDistance: 9, maxMissed: 6, minArea: 20 } } } } },
    outputs: { regions: { node: 'region' }, labels: { node: 'region', port: 'labels' } }
  });
  const observations = new Map();
  const sample = frame => {
    if (!observations.has(frame)) {
      observations.set(frame, session.evaluate({ frames }, { time: frame / fps }).outputs);
      if (observations.size > 22) observations.delete(observations.keys().next().value);
    }
    return observations.get(frame);
  };
  const canvas = document.getElementById('view'), view = canvas.getContext('2d');
  const raw = document.getElementById('source').getContext('2d');
  const background = document.createElement('canvas');
  background.width = w * 2; background.height = h * 2;
  const backdrop = background.getContext('2d');
  const layer = document.createElement('canvas');
  layer.width = w; layer.height = h;
  const pixels = layer.getContext('2d');
  view.scale(2, 2); backdrop.scale(2, 2);
  view.imageSmoothingEnabled = false;
  function line(ctx, points, color, width = .65) {
    if (!points.length) return;
    ctx.beginPath();
    ctx.moveTo(...points[0]);
    for (const point of points.slice(1)) ctx.lineTo(...point);
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke();
  }
  function text(ctx, content, x, y, color, size = 8) {
    ctx.font = size + 'px ui-monospace, monospace'; ctx.fillStyle = color; ctx.fillText(content, x, y);
  }
  const water = backdrop.createLinearGradient(0, 0, 0, h);
  water.addColorStop(0, '#102c3c'); water.addColorStop(.57, '#102e36'); water.addColorStop(1, '#071920');
  backdrop.fillStyle = water; backdrop.fillRect(0, 0, w, h);
  for (let y = 10; y < h; y += 9) {
    const points = Array.from({ length: 65 }, (_, i) => {
      const x = i * 6;
      return [x, y + (4 + y * .025) * Math.sin(x / 49 + y / 21) + 5 * Math.sin(x / 88 - y / 19)];
    });
    line(backdrop, points, y % 3 ? '#1d454d' : '#285256', .65);
  }
  for (let i = 0; i < 490; i++) {
    const x = (i * 163 + i * i * 43) % w, y = (i * 71 + i * i * 7) % h;
    backdrop.fillStyle = i % 7 ? '#20434a' : '#4d7272'; backdrop.fillRect(x, y, 1, .5);
  }
  for (let x = 24; x < w; x += 48) line(backdrop, [[x, 23], [x, h - 12]], '#30565c', .35);
  for (let y = 24; y < h; y += 36) line(backdrop, [[10, y], [w - 10, y]], '#30565c', .35);
  text(backdrop, 'PELAGIC SURVEY', 13, 15, '#a5c8c6', 8);
  const x0 = 168, x1 = 192;
  backdrop.fillStyle = '#73d6c015'; backdrop.fillRect(x0, 26, x1 - x0, h - 38);
  backdrop.setLineDash([2, 3]);
  for (const x of [x0, x1]) line(backdrop, [[x, 26], [x, h - 12]], '#65958e', .65);
  backdrop.setLineDash([]);
  text(backdrop, 'OCCLUSION', x0 + 1, 23, '#91b8b2', 5.5);

  const seek = document.getElementById('seek'), button = document.getElementById('play');
  const cards = document.getElementById('regions');
  const trackLabels = sample(0).regions.map(({ id }) => {
    const node = document.createElement('div'); node.className = 'region';
    node.style.setProperty('--track', colors[id - 1]);
    node.innerHTML = '<div><strong></strong><span class="confidence"></span></div>' +
      '<progress max="100"></progress><div><span class="position"></span><span class="velocity"></span></div>';
    node.querySelector('strong').textContent = 'Region ' + String(id).padStart(2, '0');
    node.querySelector('strong').style.color = colors[id - 1];
    node.querySelector('progress').setAttribute('aria-label', 'Region ' + id + ' confidence');
    cards.append(node);
    return { id, node };
  });
  const format = point => point.map(n => n.toFixed(1)).join(', ');
  function draw(frame) {
    const start = Math.max(frame - 16, 0), history = [];
    for (let i = start; i <= frame; i++) history.push(sample(i));
    const { regions, labels } = history.at(-1), mask = frames[frame];
    const displayMask = raw.createImageData(w, h), fill = pixels.createImageData(w, h);
    for (let p = 0; p < mask.data.length; p++) {
      const i = p * 4, alpha = mask.data[p], color = rgb[labels.data[p] - 1];
      displayMask.data.set(maskColors[Number(alpha > 0)], i);
      if (color) {
        const grain = .65 + ((p * 41) % 31) / 90;
        fill.data.set([color[0] * grain, color[1] * grain, color[2] * grain, 190], i);
      }
    }
    raw.putImageData(displayMask, 0, 0);
    pixels.putImageData(fill, 0, 0);
    view.drawImage(background, 0, 0, w, h);
    view.drawImage(layer, 0, 0);
    for (let i = 1; i < history.length; i++) {
      const before = history[i - 1].regions, after = history[i].regions;
      view.globalAlpha = .1 + .45 * i / history.length;
      for (const { id, center } of after) {
        const prior = before.find(region => region.id === id);
        if (prior) line(view, [prior.center, center], colors[id - 1], 1.05);
      }
    }
    view.globalAlpha = 1;
    for (const track of regions) {
      const { id, center: [x, y], velocity: [vx, vy], contours, bounds } = track, color = colors[id - 1];
      for (const contour of contours) line(view, contour.points, color, .9);
      line(view, [[x - 4, y], [x + 4, y]], '#f1fff2', .6);
      line(view, [[x, y - 4], [x, y + 4]], '#f1fff2', .6);
      const dx = vx * .25, dy = vy * .25, angle = Math.atan2(dy, dx), tip = [x + dx, y + dy];
      if (Math.hypot(dx, dy) >= 2) {
        line(view, [[x, y], tip], '#f1fff2', .75);
        const arrowHead = a => [tip[0] - 4 * Math.cos(angle + a), tip[1] - 4 * Math.sin(angle + a)];
        line(view, [arrowHead(-.54), tip, arrowHead(.54)], '#f1fff2', .75);
      }
      const labelX = x > 309 ? x - 63 : x + 16, labelY = bounds.y - 11;
      line(view, [[x, bounds.y], [x, labelY + 3], [labelX, labelY + 3]], color, .55);
      text(view, 'ID ' + String(id).padStart(2, '0'), labelX, labelY, color, 8);
    }
    for (const { id, node } of trackLabels) {
      const region = regions.find(track => track.id === id);
      const confidence = region ? Math.round(region.confidence * 100) : 0;
      node.dataset.visible = String(Boolean(region));
      node.querySelector('.confidence').textContent = region ? confidence + '% confidence' : 'Occluded';
      node.querySelector('progress').value = confidence;
      node.querySelector('.position').textContent = region ? format(region.center) + ' px' : '—';
      node.querySelector('.velocity').textContent = region ? format(region.velocity) + ' px/s' : '—';
    }
    document.getElementById('state').textContent = regions.length + ' visible';
    document.getElementById('frame').textContent = 'Frame ' + String(frame).padStart(2, '0');
    document.getElementById('time').value = (frame / fps).toFixed(2) + ' s';
  }
  let frame = Number(seek.value), start, first, request;
  function animate(now) {
    start ??= now;
    const next = (first + Math.floor((now - start) * fps / 1000)) % count;
    if (next !== frame) { seek.value = frame = next; draw(frame); }
    request = requestAnimationFrame(animate);
  }
  function pause() {
    if (request === undefined) return;
    cancelAnimationFrame(request); request = undefined; button.textContent = 'Play';
  }
  button.addEventListener('click', () => {
    if (request !== undefined) { pause(); return; }
    start = undefined; first = frame; button.textContent = 'Pause'; request = requestAnimationFrame(animate);
  });
  seek.addEventListener('input', () => { pause(); frame = Number(seek.value); draw(frame); });
  draw(frame);
})();
</script>
</html>`;

fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
fs.writeFileSync(output, html);
