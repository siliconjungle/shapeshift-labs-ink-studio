const fs = require('node:fs');
const path = require('node:path');
const ink = require('..');

const output = process.argv[2];
if (!output) throw new Error('Usage: node examples/dense-optical-flow.cjs <demo.html>');

const html = `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Dense optical flow · Ink Studio</title>
<style>
  * { box-sizing: border-box; }
  :root { color-scheme: dark; font: 15px system-ui, sans-serif; color: #edebe7; background: #171721; }
  body { width: min(1300px, calc(100% - 58px)); margin: 37px auto 24px; }
  header { display: flex; justify-content: space-between; align-items: end; gap: 22px; padding-bottom: 22px; border-bottom: 1px solid #49475b; margin-bottom: 15px; }
  h1 { margin: 5px 0 0; font-weight: 550; font-size: clamp(39px, 5.4vw, 67px); line-height: 1; letter-spacing: -.055em; }
  h2, .eyebrow, .meta { margin: 0; color: #c0bad5; font: 600 11px ui-monospace, monospace; letter-spacing: .1em; text-transform: uppercase; }
  .controls { display: flex; align-items: center; gap: 12px; }
  button { color: #f1ecff; background: #363149; border: 1px solid #76688b; font: inherit; padding: 8px 14px; min-width: 72px; cursor: pointer; }
  input { width: clamp(86px, 12vw, 168px); accent-color: #c6acf7; }
  output { min-width: 62px; text-align: right; font: 12px ui-monospace, monospace; }
  .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
  figure { margin: 0; background: #222135; border: 1px solid #49475b; min-width: 0; }
  figcaption { display: flex; gap: 8px; align-items: center; justify-content: space-between; flex-wrap: wrap; padding: 10px 12px; border-bottom: 1px solid #49475b; }
  canvas { display: block; width: 100%; height: auto; image-rendering: pixelated; background: #10111c; }
  p { margin: 12px 0 0; color: #c6c0d0; line-height: 1.5; }
  @media (max-width: 720px) { body { width: calc(100% - 26px); margin-top: 24px; } header { align-items: start; flex-direction: column; } .grid { grid-template-columns: 1fr; } }
</style>
<main>
  <header><div><p class="eyebrow">Ink Studio · raster motion</p><h1>Dense optical flow</h1></div>
    <div class="controls"><button id="play" type="button">Play</button><input id="seek" type="range" min="0" max="30" value="18" aria-label="Source frame"><output id="time" for="seek"></output></div>
  </header>
  <div class="grid">
    <figure><figcaption><h2>Measured motion</h2><span class="meta" id="pair"></span></figcaption>
      <canvas id="vectors" width="336" height="184" aria-label="Opposing motion shown by optical flow arrows"></canvas></figure>
    <figure><figcaption><h2>Advected ink and particles</h2><span class="meta" id="motion"></span></figcaption>
      <canvas id="advect" width="336" height="184" aria-label="Ink and particles moved by estimated flow"></canvas></figure>
    <figure><figcaption><h2>Fixed feedback</h2><span class="meta">History held in screen space</span></figcaption>
      <canvas id="fixed" width="336" height="184" aria-label="Earlier ink marks held where they originated"></canvas></figure>
    <figure><figcaption><h2>Flow-driven feedback</h2><span class="meta">Same ink advected each tick</span></figcaption>
      <canvas id="driven" width="336" height="184" aria-label="Earlier ink marks travel with the moving raster"></canvas></figure>
  </div>
  <p>Two textured regions move in opposite directions. The same measured motion moves the ink, particle trails, and retained feedback.</p>
</main>
<script>${ink.bundle()}</script>
<script>
(() => {
  const { graph, rasterWarp: W, drawing2d } = KIT.procedural;
  const width = 168, height = 92, fps = 12, count = 31;
  const teal = '#79edcf', coral = '#ffaf95';
  const cells = frame => [[44 + 2.25 * frame, 26 + 3 * Math.sin(frame * .15)],
    [123 - 2.05 * frame, 65 - 2.4 * Math.sin(frame * .13)]];
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  function frameAt(frame) {
    const centers = cells(frame);
    const data = Uint8Array.from({ length: width * height }, (_, p) => {
      let value = 14;
      for (const [index, [cx, cy]] of centers.entries()) {
        const x = p % width - cx, y = Math.floor(p / width) - cy;
        const r = Math.hypot(x / (index ? 24 : 26), y / (index ? 15 : 16));
        if (r >= 1) continue;
        const texture = .63 + .16 * Math.sin(.57 * x + .35 * y + index) +
          .10 * Math.sin(.32 * x - .73 * y) + .08 * Math.cos(.77 * x - .25 * y);
        value += 228 * texture * clamp((1 - r) * 7, 0, 1);
      }
      return Math.round(value);
    });
    return { width, height, channels: 1, data };
  }
  const frames = Array.from({ length: count }, (_, i) => frameAt(i));
  const port = (node, name = 'value') => ({ node, port: name });
  const pair = graph.create({
    inputs: { before: 'raster', after: 'raster' },
    nodes: Object.fromEntries(['forward', 'backward'].map(direction => [direction,
      { op: 'warp.opticalFlow', inputs: { before: { input: 'before' }, after: { input: 'after' },
        options: { value: { direction, levels: 3, search: 2, maxMotion: 8, radius: 4, iterations: 4 } } } }])),
    outputs: { forward: port('forward'), forwardConfidence: port('forward', 'confidence'),
      backward: port('backward'), backwardConfidence: port('backward', 'confidence') }
  });
  const motions = frames.slice(1).map((after, i) => pair.evaluate({ before: frames[i], after }).outputs);
  const ellipse = (x, y, r, fill) => ({ type: 'ellipse', rect: [x - r, y - r, 2 * r, 2 * r], fill });
  const paint = commands => drawing2d.render({ width, height, commands, edges: 'smooth' });
  const roots = cells(0);
  const points = [roots.flatMap(([x, y]) => [[x - 7, y - 2], [x - 3, y + 5],
    [x + 6, y - 5], [x + 8, y + 2], [x + 2, y + 1]])];
  const ink = [paint(roots.flatMap(([x, y], index) => {
    const fill = index ? coral : teal;
    return [ellipse(x - 5, y - 1, 4, fill + 'bd'), ellipse(x + 2, y - 3, 2, fill + 'de'),
      ellipse(x + 6, y + 2, 5, fill + 'a4'), ellipse(x - 2, y + 5, 2, fill)];
  }))];
  for (const { forward, forwardConfidence, backward, backwardConfidence } of motions) {
    points.push(W.flowPoints(points.at(-1), forward, { confidence: forwardConfidence, minConfidence: .18 }));
    ink.push(W.flow(ink.at(-1), backward, { confidence: backwardConfidence, minConfidence: .18, edge: 'transparent' }).value);
  }
  const emissions = frames.map((_, frame) => {
    if (frame % 6) return paint([]);
    return paint(cells(frame).flatMap(([x, y], index) => {
      const color = index ? coral : teal, ring = frame % 12 ? -3 : 3;
      return [ellipse(x + ring, y - 3, 3.7, color + 'bb'), ellipse(x - ring, y + 4, 2.7, color + 'a4')];
    }));
  });
  const flow = motions.map(({ backward, backwardConfidence }) => ({
    ...backward, data: Float32Array.from(backward.data, (value, i) => backwardConfidence.data[i >> 1] >= .18 ? value : 0)
  }));
  const feedback = graph.create({
    inputs: { frames: 'array<raster>', motion: 'array<raster>' },
    nodes: Object.fromEntries(['fixed', 'driven'].map(name => [name, {
      op: 'anim.feedback', inputs: { frames: { input: 'frames' },
        ...(name === 'driven' && { flow: { input: 'motion' } }),
        options: { value: { fps, dt: 1 / fps, halfLife: .75, every: 30, cache: 1, maxTicks: count } } }
    }])),
    outputs: { fixed: port('fixed'), driven: port('driven') }
  });
  const histories = frames.map((_, frame) => feedback.evaluate({ frames: emissions, motion: flow }, { time: frame / fps }).outputs);

  const layer = document.createElement('canvas');
  layer.width = width; layer.height = height;
  const pixels = layer.getContext('2d');
  const canvas = Object.fromEntries(['vectors', 'advect', 'fixed', 'driven'].map(id => [id, document.getElementById(id).getContext('2d')]));
  for (const ctx of Object.values(canvas)) { ctx.scale(2, 2); ctx.imageSmoothingEnabled = false; }
  function source(ctx, frame, gain) {
    const image = pixels.createImageData(width, height);
    for (let p = 0; p < frames[frame].data.length; p++) {
      const value = (frames[frame].data[p] - 14) * gain, y = Math.floor(p / width), i = p * 4;
      const grid = p % width % 12 === 0 && y % 8 === 0 ? 10 : 0;
      image.data[i] = 17 + grid + value * (y < 45 ? .34 : .84);
      image.data[i + 1] = 19 + grid + value * (y < 45 ? .82 : .47);
      image.data[i + 2] = 33 + grid + value * (y < 45 ? .75 : .49);
      image.data[i + 3] = 255;
    }
    pixels.putImageData(image, 0, 0); ctx.drawImage(layer, 0, 0);
  }
  function composite(ctx, raster) {
    pixels.putImageData(new ImageData(Uint8ClampedArray.from(raster.data), width, height), 0, 0);
    ctx.drawImage(layer, 0, 0);
  }
  function line(ctx, points, color, weight) {
    ctx.beginPath(); ctx.moveTo(...points[0]);
    for (let i = 1; i < points.length; i++) ctx.lineTo(...points[i]);
    ctx.lineWidth = weight; ctx.strokeStyle = color; ctx.stroke();
  }
  function dot(ctx, [x, y], r, fill) {
    ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI); ctx.fillStyle = fill; ctx.fill();
  }
  const signed = n => (n >= 0 ? '+' : '') + n.toFixed(1);
  function draw(frame) {
    const next = Math.min(frame + 1, count - 1), previous = next - 1;
    const { forward, forwardConfidence } = motions[previous];
    source(canvas.vectors, previous, .59);
    const ctx = canvas.vectors;
    for (let y = 7; y < height; y += 6) for (let x = 7; x < width; x += 6) {
      const p = y * width + x, confidence = forwardConfidence.data[p];
      if (confidence < .24) continue;
      const vx = forward.data[p * 2], vy = forward.data[p * 2 + 1];
      if (Math.hypot(vx, vy) < .4) continue;
      const end = [x + vx * 2.6, y + vy * 2.6], angle = Math.atan2(vy, vx), color = vx > 0 ? teal : coral;
      const tip = a => [end[0] - 2 * Math.cos(angle + a), end[1] - 2 * Math.sin(angle + a)];
      ctx.globalAlpha = .4 + .6 * confidence;
      line(ctx, [[x, y], end], color, .95);
      line(ctx, [tip(-.5), end, tip(.5)], color, .95);
    }
    ctx.globalAlpha = 1;
    source(canvas.advect, frame, .34); composite(canvas.advect, ink[frame]);
    for (const [i, point] of points[frame].entries()) {
      const color = i < 5 ? teal : coral, history = points.slice(Math.max(0, frame - 6), frame + 1).map(row => row[i]);
      line(canvas.advect, history, color + '91', .7);
      dot(canvas.advect, point, 1.1, '#fff0d9');
    }
    for (const name of ['fixed', 'driven']) {
      source(canvas[name], frame, .36); composite(canvas[name], histories[frame][name]);
    }
    const read = W.flowSampler(forward, { confidence: forwardConfidence });
    const [right, left] = cells(previous).map(point => read(...point)[0]);
    document.getElementById('pair').textContent = 'Frames ' + previous + ' → ' + next;
    document.getElementById('motion').textContent = signed(right) + ' / ' + signed(left) + ' px per pair';
    document.getElementById('time').value = (frame / fps).toFixed(2) + ' s';
  }
  const seek = document.getElementById('seek'), play = document.getElementById('play');
  let frame = Number(seek.value), first, start, request;
  function animate(now) {
    start ??= now;
    const next = (first + Math.floor((now - start) * fps / 1000)) % count;
    if (next !== frame) { frame = next; seek.value = frame; draw(frame); }
    request = requestAnimationFrame(animate);
  }
  function pause() {
    if (request === undefined) return;
    cancelAnimationFrame(request); request = undefined; play.textContent = 'Play';
  }
  play.addEventListener('click', () => {
    if (request !== undefined) { pause(); return; }
    start = undefined; first = frame; play.textContent = 'Pause'; request = requestAnimationFrame(animate);
  });
  seek.addEventListener('input', () => { pause(); frame = Number(seek.value); draw(frame); });
  draw(frame);
})();
</script>
</html>`;

fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
fs.writeFileSync(output, html);
