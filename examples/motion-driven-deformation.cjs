const fs = require('node:fs');
const path = require('node:path');
const ink = require('..');
const { encode } = require('../cli/png.js');

if (!process.argv[2]) throw new Error('Usage: node examples/motion-driven-deformation.cjs <demo.html>');

const kit = ink.load(), K = kit.KIT;
const { graph, rasterWarp, drawing2d, raster, sceneGraph, motionDeformation } = K.procedural;
const width = 208, height = 120, fps = 12, count = 36;
const colors = [0x141d2a, 0x2b386a, 0x536ea4, 0x97b9db, 0xffad76, 0xffe0ad, 0x6de2c0];
const rgb = color => [color >> 16, color >> 8 & 255, color & 255];
const palette = colors.map(rgb);
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const slotColors = [1, 2, 3, 4, 5, 6];

function shape(x, y, frame) {
  const phase = 2 * Math.PI * frame / count;
  const cx = 103 + 10 * Math.sin(phase), cy = 60 + 7 * Math.sin(phase * 2);
  const dx = (x - cx) / (65 + 7 * Math.sin(phase)), dy = (y - cy) / (33 - 5 * Math.sin(phase));
  const angle = Math.atan2(dy, dx), turn = Math.sin(phase) * 1.24;
  const radius = .87 + .16 * Math.cos(3 * angle + turn) + .15 * Math.sin(2 * angle + turn);
  return Math.hypot(dx, dy) / radius;
}

const mask = frame => ({ width, height, channels: 1,
  data: Uint8Array.from({ length: width * height }, (_, i) =>
    shape(i % width + .5, Math.floor(i / width) + .5, frame) <= 1 ? 255 : 0) });

function pigment(x, y) {
  const distance = shape(x, y, 0);
  if (distance > 1) return 0;
  const dx = x - 102, dy = y - 60, orbit = Math.hypot(dx * .83, dy);
  const grain = (Math.floor(x) * 29 ^ Math.floor(y) * 67 ^ Math.floor(x * y)) & 7;
  if (distance > .94) return 3;
  if (Math.abs(orbit - 17) < 1.8 || Math.abs(dx) < 1.5 && Math.abs(dy) < 23 ||
      Math.abs(dy) < 1.5 && Math.abs(dx) < 24) return 5;
  if (Math.abs(orbit - 22) < 1.15 || Math.abs(orbit - 7) < 1.5) return 4;
  if ((x + 2 * y) % 23 < 3 || dx < -24 && (x + 2 * y) % 11 < 1.5) return 6;
  return slotColors[clamp(Math.floor(distance * 2 + (grain > 6 ? 1 : 0)), 0, 2)];
}

const art = { width, height, channels: 4, data: new Uint8Array(width * height * 4) };
for (let i = 0; i < width * height; i++) {
  const slot = pigment(i % width + .5, Math.floor(i / width) + .5);
  if (slot) art.data.set([...palette[slot], 255], i * 4);
}

const builder = kit.makeBuilder(9, colors), unit = .028;
const chart = { origin: [-width * unit / 2, height * unit / 2, 0], u: [unit, 0, 0], v: [0, -unit, 0] };
for (let y = 0; y < height; y += 2.2) for (let x = 0; x < width; x += 2.6) {
  const slot = pigment(x, y);
  if (!slot) continue;
  const frame = K.surfaceBrush.direction({ axis: [1, .2 * Math.sin((x + y) / 19), 0], direction: 'axis',
    length: unit * (slot === 5 ? 2.9 : 4.4), width: unit * 2.9 },
  [chart.origin[0] + x * unit, chart.origin[1] - y * unit, 0], [0, 0, 1]);
  K.surfaceBrush.stamp(builder, frame, builder.P[slot], { style: slot === 4 || slot === 5 ? 'ink' : 'gouache' });
}
const baked = builder.finish({ radius: 8, dither: 0, outline: { c: 0, edge: 0 } });
const ids = Array.from({ length: baked.count }, (_, i) => i);

const bones = [{ id: 'spine', pivot: [70, 60], tip: [108, 60] },
  { id: 'wing', parent: 'spine', pivot: [108, 60], tip: [148, 57] }];
const bind = sceneGraph.bindSprite(art, bones, { segments: [28, 18] });
const grid = kit.TexturedSurface.grid({ segments: [20, 13], point: (u, v) => [u * width, v * height, 0] });
const mesh = { pos: grid.points, tri: grid.triangles, uvs: grid.uvs };

const frames = Array.from({ length: count }, (_, i) => mask(i));
const directions = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
const probe = [{ id: 'center', track: 1 }, ...directions.map((direction, i) =>
  ({ id: 'rim' + i, track: 1, silhouetteDirection: direction }))];
const observations = K.procedural.pixelEffects.regionObservations(frames, { fps, contours: true, minArea: 30 });
const rest = motionDeformation.track(observations, probe.map((binding, i) => ({ ...binding, rest: [i, 0] }))).sample(0).value.to;
const bindings = probe.map((binding, i) => ({ ...binding, rest: rest[i] }));

const link = (node, port = 'value') => ({ node, port }), input = input => ({ input });
const runner = graph.create({
  inputs: { mesh: 'mesh', art: 'raster', world: 'world', pose: 'record', observations: 'array<record>' },
  nodes: {
    landmarks: { op: 'motion.landmarks', inputs: { observations: input('observations'), bindings } },
    mesh: { op: 'geo.motionMesh', inputs: { source: input('mesh'), control: link('landmarks') } },
    sprite: { op: 'rig.skinSprite', inputs: { source: input('art'), bind, pose: input('pose'), motion: link('landmarks') } },
    splats: { op: 'scene.motionSplats', inputs: { source: input('world'), control: link('landmarks'), ids, options: { chart } } }
  },
  outputs: { landmarks: link('landmarks', 'landmarks'), mesh: link('mesh'), sprite: link('sprite'),
    joints: link('sprite', 'joints'), splats: link('splats') }
});

const renderDraw = commands => drawing2d.render({ width, height, commands, edges: 'hard' });
const overlay = (source, commands) => raster.stack({ width, height, layers: [{ source }, { source: renderDraw(commands) }] }).value;
const pathLine = (points, color, size = 1) => ({ type: 'path', points, color, width: size });
const dot = ([x, y], size, color) => ({ type: 'ellipse', rect: [x - size / 2, y - size / 2, size, size], fill: color });
function tracked(frame, marks) {
  const source = { ...art, data: new Uint8Array(width * height * 4) };
  for (let i = 0; i < frames[frame].data.length; i++) if (frames[frame].data[i])
    source.data.set([49, 86, 92, 255], i * 4);
  const contours = observations[frame].regions[0].contours.map(ring =>
    pathLine([...ring.points, ring.points[0]], '#79dfbf'));
  const center = marks[0].position;
  const rays = marks.slice(1).map(({ position }) => pathLine([center, position], '#7fbaa9'));
  return overlay(source, [...rays, ...contours, ...marks.map(({ position }, i) => dot(position, i ? 4 : 5, '#fbbe85'))]);
}

function textured(mesh) {
  const from = Array.from({ length: mesh.uvs.length / 2 }, (_, i) => Array.from(mesh.uvs.subarray(i * 2, i * 2 + 2)));
  const to = from.map((_, i) => [mesh.pos[i * 3] / width, mesh.pos[i * 3 + 1] / height]);
  return rasterWarp.mesh(art, { from, to, triangles: mesh.tri }, { filter: 'nearest' }).value;
}

function painted(world) {
  const fov = Math.PI / 3;
  return sceneGraph.rasterFrame(ink.render(world, { w: width, h: height, px: 1, transparent: true,
    yaw: 0, pitch: 0, target: [0, 0, 0], ortho: true, fov, lockCamera: true,
    dist: height * unit / (2 * Math.tan(fov / 2)), raw: true }));
}

function png(image) {
  return 'data:image/png;base64,' + encode(width, height, image.data, 4).toString('base64');
}
const sequence = frames.map((_, i) => {
  const time = i / fps, pose = { wing: { angle: .18 * Math.sin(2 * Math.PI * i / count) } };
  const shot = runner.evaluate({ mesh, art, world: baked, pose, observations }, { time }).outputs;
  const joints = Object.values(shot.joints).flatMap(({ pivot, tip }) =>
    [pathLine([pivot, tip], '#fffce8'), dot(pivot, 4, '#fd976f'), dot(tip, 3, '#fd976f')]);
  return [tracked(i, shot.landmarks), textured(shot.mesh), overlay(shot.sprite, joints), painted(shot.splats)].map(png);
});

const html = `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Motion-driven deformation · Ink Studio</title>
<style>
  * { box-sizing: border-box; }
  :root { color-scheme: dark; background: #161d28; color: #f3efdf; font: 14px system-ui, sans-serif; }
  body { width: min(1150px, calc(100% - 64px)); margin: 26px auto; }
  header { display: grid; grid-template-columns: minmax(0,1fr) auto; align-items: end; column-gap: 20px; margin: 0 0 17px; }
  h1 { margin: 2px 0 5px; font: 650 clamp(32px, 5.5vw, 70px)/1.04 system-ui, sans-serif; letter-spacing: -.065em; }
  h2, p { margin: 0; }
  header p { max-width: 58ch; line-height: 1.4; color: #cbd1dd; }
  .kicker, .controls, .tag { font: 600 11px/1.35 ui-monospace, monospace; letter-spacing: .07em; }
  .kicker { color: #9ee1cb; text-transform: uppercase; }
  .controls { display: flex; align-items: center; gap: 10px; }
  button { min-width: 67px; padding: 8px 10px; border: 1px solid #596984; background: #242f43; color: inherit; cursor: pointer; font: inherit; }
  button:hover, button:focus-visible { border-color: #9ee1cb; }
  input { width: clamp(95px, 12vw, 160px); accent-color: #9ee1cb; }
  output { width: 49px; color: #a4ead5; white-space: nowrap; }
  .grid { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 12px; }
  figure { margin: 0; min-width: 0; border: 1px solid #56647e; background: #202c3e; }
  figcaption { padding: 8px 12px; display: flex; flex-wrap: wrap; gap: 5px 10px; justify-content: space-between; align-items: baseline; }
  h2 { font-size: 15px; font-weight: 650; }
  .tag { color: #bbc9e0; }
  canvas { display: block; width: 100%; height: auto; image-rendering: pixelated; }
  @media (max-width: 775px) { body { width: calc(100% - 30px); } header, .grid { grid-template-columns: 1fr; } .controls { margin-top: 12px; } }
</style>
<main>
  <header>
    <div><p class="kicker">Ink Studio · Raster tracking</p><h1>Motion-driven deformation</h1>
      <p>Nine measured landmarks drive a mesh, a sprite rig, and a painted splat group. Scrub to see the same printed mark stretch with each surface.</p></div>
    <div class="controls"><button id="play" type="button">Play</button>
      <input id="seek" type="range" min="0" max="${count - 1}" value="10" aria-label="Frame"><output id="clock" for="seek"></output></div>
  </header>
  <div class="grid">
    <figure><figcaption><h2>Tracked silhouette</h2><span class="tag">Center and 8 contour rays</span></figcaption>
      <canvas id="tracking" width="${width}" height="${height}" aria-label="Measured silhouette and tracked control points"></canvas></figure>
    <figure><figcaption><h2>Textured mesh</h2><span class="tag">Rest UVs</span></figcaption>
      <canvas id="mesh" width="${width}" height="${height}" aria-label="Deformed mesh with its original printed texture"></canvas></figure>
    <figure><figcaption><h2>Skinned sprite</h2><span class="tag">Pose + landmarks</span></figcaption>
      <canvas id="sprite" width="${width}" height="${height}" aria-label="Posed and deformed sprite with the joints overlaid"></canvas></figure>
    <figure><figcaption><h2>Painted splats</h2><span class="tag">Ink + brush footprints</span></figcaption>
      <canvas id="splats" width="${width}" height="${height}" aria-label="Painted splats with their deformed brush footprints"></canvas></figure>
  </div>
</main>
<script>
const sources = ${JSON.stringify(sequence)}, width = ${width}, height = ${height}, fps = ${fps};
const canvases = ['tracking', 'mesh', 'sprite', 'splats'].map(id => document.getElementById(id));
const contexts = canvases.map(canvas => canvas.getContext('2d'));
const seek = document.getElementById('seek'), clock = document.getElementById('clock'), play = document.getElementById('play');
const plates = sources.map(rows => rows.map(source => { const image = new Image(); image.src = source; return image; }));
const background = document.createElement('canvas');
background.width = width; background.height = height;
const grid = background.getContext('2d');
grid.fillStyle = '#151e2c'; grid.fillRect(0, 0, width, height);
for (let y = 9; y < height; y += 9) for (let x = 9; x < width; x += 9) {
  grid.fillStyle = x % 36 === 0 && y % 36 === 0 ? '#576783' : '#29364c';
  grid.fillRect(x, y, 1, 1);
}
let timer = null, revision = 0;
async function show(frame) {
  const current = ++revision;
  seek.value = frame;
  await Promise.all(plates[frame].map(image => image.decode()));
  if (current !== revision) return;
  contexts.forEach((ctx, i) => {
    ctx.drawImage(background, 0, 0);
    ctx.drawImage(plates[frame][i], 0, 0);
  });
  clock.value = (frame / fps).toFixed(2) + ' s';
}
function stop() { clearInterval(timer); timer = null; play.textContent = 'Play'; }
seek.addEventListener('input', () => { stop(); show(Number(seek.value)); });
play.addEventListener('click', () => {
  if (timer !== null) return stop();
  play.textContent = 'Pause';
  timer = setInterval(() => show((Number(seek.value) + 1) % plates.length), 1000 / fps);
});
show(Number(seek.value));
</script>`;

const out = path.resolve(process.argv[2]);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log(out);
