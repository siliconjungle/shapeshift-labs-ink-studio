const fs = require('node:fs');
const path = require('node:path');
const ink = require('..');

const output = process.argv[2];
if (!output) throw new Error('Usage: node examples/camera-motion-compensation.cjs <demo.html>');

const html = `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Camera motion compensation · Ink Studio</title>
<style>
  * { box-sizing: border-box; }
  :root { color-scheme: dark; background: #121c21; color: #ecf2ec; font: 15px system-ui, sans-serif; }
  body { width: min(1280px, calc(100% - 58px)); margin: 33px auto 24px; }
  header { display: flex; gap: 18px; justify-content: space-between; align-items: end; border-bottom: 1px solid #455960; margin-bottom: 15px; padding-bottom: 18px; }
  h1 { margin: 6px 0 0; font-size: clamp(37px, 5.2vw, 64px); line-height: .98; letter-spacing: -.055em; font-weight: 560; }
  .kicker, h2, .meta { margin: 0; color: #adcbcc; font: 600 11px ui-monospace, monospace; letter-spacing: .09em; text-transform: uppercase; }
  .controls { display: flex; align-items: center; gap: 12px; }
  button { min-width: 70px; padding: 8px 12px; background: #2a444d; color: inherit; border: 1px solid #6d9298; font: inherit; cursor: pointer; }
  input { width: clamp(90px, 11vw, 160px); accent-color: #ecaa82; }
  output { min-width: 62px; text-align: right; font: 12px ui-monospace, monospace; }
  .grid { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 12px; }
  figure { min-width: 0; margin: 0; background: #1b2b32; border: 1px solid #455960; }
  figcaption { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; padding: 10px 12px; border-bottom: 1px solid #455960; }
  canvas { width: 100%; height: auto; display: block; background: #17262e; image-rendering: pixelated; }
  .caption { color: #bbcbcb; line-height: 1.5; margin: 11px 0 0; }
  @media (max-width: 740px) { body { width: calc(100% - 24px); margin-top: 25px; } header { display: grid; } .grid { grid-template-columns: 1fr; } }
</style>
<main>
  <header><div><p class="kicker">Ink Studio · raster tracking</p><h1>Camera motion compensation</h1></div>
    <div class="controls"><button type="button" id="play">Play</button><input id="seek" type="range" min="0" max="28" value="28" aria-label="Source frame"><output id="clock" for="seek"></output></div>
  </header>
  <div class="grid">
    <figure><figcaption><h2>Moving camera</h2><span class="meta" id="camera"></span></figcaption>
      <canvas id="raw" width="288" height="188" aria-label="Original panning and zooming raster with a subject marker"></canvas></figure>
    <figure><figcaption><h2>Stabilized shot</h2><span class="meta" id="subject"></span></figcaption>
      <canvas id="stabilized" width="288" height="188" aria-label="Camera-compensated shot with the same marker on the subject"></canvas></figure>
    <figure><figcaption><h2>Screen-space motion</h2><span class="meta">Camera and subject</span></figcaption>
      <canvas id="screenMotion" width="288" height="188" aria-label="Optical flow vectors across the original image"></canvas></figure>
    <figure><figcaption><h2>Compensated motion</h2><span class="meta">Vectors above 1.5 px</span></figcaption>
      <canvas id="local" width="288" height="188" aria-label="Local motion vectors after camera compensation"></canvas></figure>
  </div>
  <p class="caption">Scrub to see the camera pan and zoom. The copper disc drifts independently, and its marker follows that local motion in both views.</p>
</main>
<script>${ink.bundle()}</script>
<script>
(() => {
  const { graph } = KIT.procedural;
  const width = 144, height = 94, fps = 12, count = 29, origin = [68.5, 46.5];
  const clamp = (x, low, high) => Math.max(low, Math.min(high, x));
  const texture = (x, y) => .47 + .16 * Math.sin(.51 * x + .32 * y) + .10 * Math.cos(.34 * x - .63 * y) +
    .16 * Math.sin(.19 * x) * Math.cos(.56 * y) + .08 * Math.sin(.09 * x + .11 * y);
  function scene(frame) {
    const t = frame / (count - 1), scale = 1 + .10 * t, dx = 6 * t, dy = -3 * t;
    const luma = new Uint8Array(width * height), rgba = new Uint8Array(luma.length * 4);
    for (let p = 0; p < luma.length; p++) {
      const x = (p % width + .5 - width / 2 - dx) / scale + width / 2;
      const y = (Math.floor(p / width) + .5 - height / 2 - dy) / scale + height / 2;
      const a = x - 68 - 5 * t, b = y - 46 - .6 * Math.sin(Math.PI * t);
      const radius = Math.hypot(a, b), cover = clamp((13 - radius) / 2, 0, 1);
      const bg = texture(x, y), fg = .62 + .15 * Math.sin(.8 * a - .5 * b) + .11 * Math.cos(.3 * a + .82 * b);
      luma[p] = Math.round(255 * (bg * (1 - cover) + fg * cover));
      const grid = (Math.abs(x - 18 * Math.round(x / 18)) < .4 || Math.abs(y - 18 * Math.round(y / 18)) < .4) ? 17 : 0;
      const ring = Math.abs(radius - 10) < .65 ? 24 : 0;
      const ground = [13 + 28 * bg + grid, 24 + 56 * bg + grid, 33 + 65 * bg + grid];
      const copper = [75 + 183 * fg + ring, 42 + 113 * fg + ring, 30 + 77 * fg + ring];
      for (let channel = 0; channel < 3; channel++)
        rgba[p * 4 + channel] = clamp(Math.round(ground[channel] * (1 - cover) + copper[channel] * cover), 0, 255);
      rgba[p * 4 + 3] = 255;
    }
    return { image: { width, height, channels: 1, data: luma }, color: { width, height, channels: 4, data: rgba } };
  }
  const frames = Array.from({ length: count }, (_, i) => scene(i));
  const at = (node, port) => ({ node, ...(port && { port }) });
  const session = graph.create({
    inputs: { before: 'raster', after: 'raster', color: 'raster' },
    nodes: {
      flow: { op: 'warp.opticalFlow', inputs: { before: { input: 'before' }, after: { input: 'after' } } },
      camera: { op: 'warp.cameraMotion', inputs: { motion: at('flow'), confidence: at('flow', 'confidence') } },
      stable: { op: 'warp.sample', inputs: { source: { input: 'color' }, field: at('camera', 'field'),
        options: { value: { edge: 'transparent' } } } },
      anchor: { op: 'warp.flowPoints', inputs: { points: { value: [origin] }, motion: at('camera'),
        confidence: at('flow', 'confidence') } }
    },
    outputs: { raw: at('flow'), confidence: at('flow', 'confidence'), local: at('camera'), camera: at('camera', 'transform'),
      stable: at('stable'), anchor: at('anchor') }
  });
  const samples = frames.map(frame => session.evaluate({ before: frames[0].image, after: frame.image, color: frame.color }).outputs);
  const layer = document.createElement('canvas');
  layer.width = width; layer.height = height;
  const pixels = layer.getContext('2d');
  const contexts = Object.fromEntries(['raw', 'stabilized', 'screenMotion', 'local'].map(id => [id, document.getElementById(id).getContext('2d')]));
  for (const ctx of Object.values(contexts)) { ctx.scale(2, 2); ctx.imageSmoothingEnabled = false; }
  function underlay(ctx) {
    ctx.fillStyle = '#16232a'; ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#23333c';
    for (let y = 0; y < height; y += 6) for (let x = (y % 12 ? 6 : 0); x < width; x += 12) ctx.fillRect(x, y, 6, 6);
  }
  function raster(ctx, image, opacity = 1) {
    underlay(ctx);
    pixels.putImageData(new ImageData(Uint8ClampedArray.from(image.data), width, height), 0, 0);
    ctx.globalAlpha = opacity; ctx.drawImage(layer, 0, 0); ctx.globalAlpha = 1;
  }
  function line(ctx, points, color, weight = .55) {
    ctx.beginPath(); ctx.moveTo(...points[0]);
    for (let i = 1; i < points.length; i++) ctx.lineTo(...points[i]);
    ctx.lineWidth = weight; ctx.strokeStyle = color; ctx.stroke();
  }
  function tag(ctx, text, x, y) {
    ctx.font = '5.5px ui-monospace, monospace';
    ctx.fillStyle = '#18242c'; ctx.fillRect(x - 1.2, y - 4.8, ctx.measureText(text).width + 2.4, 6.2);
    ctx.fillStyle = '#fff2cf'; ctx.fillText(text, x, y);
  }
  function reticle(ctx, [x, y]) {
    const tint = '#ffdc9e';
    ctx.beginPath(); ctx.arc(x, y, 11, 0, 2 * Math.PI); ctx.strokeStyle = tint; ctx.lineWidth = .6; ctx.stroke();
    line(ctx, [[x - 3.3, y], [x + 3.3, y]], tint);
    line(ctx, [[x, y - 3.3], [x, y + 3.3]], tint);
    line(ctx, [[x + 10, y - 4], [x + 16, y - 13], [x + 27, y - 13]], tint);
    tag(ctx, 'SUBJECT', x + 17, y - 15);
  }
  const pins = [[18, 18], [126, 18], [18, 72], [126, 72]];
  const map = (matrix, [x, y]) => matrix.map(([a, b, c]) => a * x + b * y + c);
  function guides(ctx, points) {
    for (const [x, y] of points) {
      line(ctx, [[x - 2, y], [x + 2, y]], '#bcf3ea', .55);
      line(ctx, [[x, y - 2], [x, y + 2]], '#bcf3ea', .55);
    }
  }
  function vectors(ctx, motion, confidence, color, gate) {
    for (let y = 9; y < height - 5; y += 7) for (let x = 9; x < width - 5; x += 7) {
      const p = y * width + x, trust = confidence.data[p];
      if (trust < .48) continue;
      const dx = motion.data[p * 2], dy = motion.data[p * 2 + 1], length = Math.hypot(dx, dy);
      if (length < gate || length > 22) continue;
      const size = Math.min(6, length), angle = Math.atan2(dy, dx), tip = [x + dx * size / length, y + dy * size / length];
      const head = a => [tip[0] - 1.5 * Math.cos(angle + a), tip[1] - 1.5 * Math.sin(angle + a)];
      ctx.globalAlpha = .55 + .45 * trust;
      line(ctx, [[x, y], tip], color, .65);
      line(ctx, [head(-.5), tip, head(.5)], color, .65);
    }
    ctx.globalAlpha = 1;
  }
  const sign = n => (n >= 0 ? '+' : '') + n.toFixed(1);
  function draw(frame) {
    const { camera, stable, anchor: [anchor], raw, local, confidence } = samples[frame];
    raster(contexts.raw, frames[frame].color); raster(contexts.stabilized, stable);
    guides(contexts.raw, pins.map(point => map(camera.matrix, point)));
    guides(contexts.stabilized, pins);
    reticle(contexts.raw, map(camera.matrix, anchor)); reticle(contexts.stabilized, anchor);
    raster(contexts.screenMotion, frames[0].color, .5); raster(contexts.local, frames[0].color, .5);
    vectors(contexts.screenMotion, raw, confidence, '#b8fcf1', .85);
    vectors(contexts.local, local, confidence, '#ffd09c', 1.5);
    document.getElementById('camera').textContent = camera.valid ?
      'Pan ' + camera.pan.map(sign).join(' / ') + ' px · ' + camera.scale.toFixed(2) + '×' : 'Fit unavailable';
    document.getElementById('subject').textContent = 'Subject ' + sign(anchor[0] - origin[0]) + ' / ' + sign(anchor[1] - origin[1]) + ' px';
    document.getElementById('clock').value = (frame / fps).toFixed(2) + ' s';
  }
  const play = document.getElementById('play'), seek = document.getElementById('seek');
  let frame = Number(seek.value), first, start, request;
  function animate(now) {
    start ??= now;
    const next = (first + Math.floor((now - start) * fps / 1000)) % count;
    if (next !== frame) { seek.value = frame = next; draw(frame); }
    request = requestAnimationFrame(animate);
  }
  function pause() {
    if (request === undefined) return;
    cancelAnimationFrame(request); request = undefined; play.textContent = 'Play';
  }
  play.addEventListener('click', () => {
    if (request !== undefined) { pause(); return; }
    first = frame === count - 1 ? 0 : frame; start = undefined;
    play.textContent = 'Pause'; request = requestAnimationFrame(animate);
  });
  seek.addEventListener('input', () => { pause(); frame = Number(seek.value); draw(frame); });
  draw(frame);
})();
</script>
</html>`;

fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
fs.writeFileSync(output, html);
