import { createRenderer } from '../src/webgl/renderer.mjs';

const kit = { KIT, makeBuilder, makeSculpt, PixelLook, SpriteSurface, TexturedSurface, RenderStages, TargetSelectors, SplatProvenance };
const lantern = turntableShapeLantern(kit), S = KIT.turntableShape, $ = id => document.getElementById(id);
const prior = S.fromSdf(lantern.distance, lantern), reference = S.fromSdf(lantern.target, lantern);
const degrees = [-55, 0, 55], radians = angle => angle * Math.PI / 180;
const artWidth = 144, artHeight = 96;
const edits = degrees.map(yaw => {
  const camera = S.camera(prior, { yaw: radians(yaw), width: artWidth, height: artHeight });
  const before = S.silhouette(prior, camera), initial = S.silhouette(reference, camera);
  return { camera, before, initial, mask: initial.slice() };
});
const views = [[$('source'), lantern.build(prior)], [$('fit'), null]].map(([canvas, world]) =>
  ({ canvas, world, renderer: createRenderer(canvas, { toolkit: kit }) }));
const degreeLabel = n => (n < 0 ? '−' + -n : String(n)) + '°';
let yaw = 28, pitch = 12, brush = 1, fitted, drag, pending = false;

function render() {
  pending = false;
  const authored = degrees.includes(yaw) && pitch === 0;
  $('angle-label').textContent = degreeLabel(yaw) + (authored ? ' · Edited view' : ' · Held-out view');
  for (const { canvas, world, renderer } of views) {
    if (!world) continue;
    renderer.render(world, {
      camera: { ...world.cam, yaw: radians(yaw), pitch: radians(pitch) },
      width: canvas.width, height: canvas.height, time: 0, damp: false, raw: true
    });
  }
}
function redraw() {
  if (!pending) requestAnimationFrame(render);
  pending = true;
}
function setView(nextYaw, nextPitch) {
  yaw = ((Math.round(nextYaw) + 180) % 360 + 360) % 360 - 180;
  pitch = Math.max(-65, Math.min(65, Math.round(nextPitch)));
  $('yaw').value = yaw;
  redraw();
}
$('yaw').addEventListener('input', e => setView(Number(e.target.value), pitch));
$('between').addEventListener('click', () => setView(28, 12));
for (const { canvas } of views) {
  canvas.addEventListener('pointerdown', e => {
    drag = { x: e.clientX, y: e.clientY, yaw, pitch };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', e => {
    if (drag) setView(drag.yaw - (e.clientX - drag.x) * 0.6, drag.pitch + (e.clientY - drag.y) * 0.5);
  });
  for (const event of ['pointerup', 'lostpointercapture']) canvas.addEventListener(event, () => { drag = null; });
}

const colors = [[17, 27, 33], [144, 234, 211], [239, 142, 122], [237, 218, 177]];
const sheets = edits.map((edit, i) => {
  const item = document.createElement('figure'), caption = document.createElement('figcaption');
  const name = document.createElement('button'), counts = document.createElement('span'), canvas = document.createElement('canvas');
  name.textContent = degreeLabel(degrees[i]);
  name.setAttribute('aria-label', 'Orbit to edited view ' + name.textContent);
  name.addEventListener('click', () => setView(degrees[i], 0));
  counts.className = 'counts';
  caption.append(name, counts);
  canvas.width = artWidth;
  canvas.height = artHeight;
  canvas.setAttribute('aria-label', 'Editable silhouette at ' + name.textContent);
  item.append(caption, canvas);
  $('edits').append(item);
  const ctx = canvas.getContext('2d'), image = ctx.createImageData(artWidth, artHeight);
  function paintSheet() {
    let add = 0, erase = 0;
    for (let p = 0; p < edit.before.length; p++) {
      const before = edit.before[p], after = edit.mask[p];
      add += !before && after;
      erase += before && !after;
      image.data.set([...colors[before * 2 + after], 255], p * 4);
    }
    ctx.putImageData(image, 0, 0);
    counts.textContent = '+' + add + ' / −' + erase;
  }
  let previous;
  function stroke(event) {
    const box = canvas.getBoundingClientRect();
    const next = [
      Math.max(0, Math.min(artWidth - 1, Math.floor((event.clientX - box.left) * artWidth / box.width))),
      Math.max(0, Math.min(artHeight - 1, Math.floor((event.clientY - box.top) * artHeight / box.height)))
    ];
    const from = previous ?? next, dx = next[0] - from[0], dy = next[1] - from[1];
    const steps = Math.max(1, Math.abs(dx), Math.abs(dy));
    for (let i = 0; i <= steps; i++)
      edit.mask[Math.round(from[0] + dx * i / steps) + artWidth * Math.round(from[1] + dy * i / steps)] = brush;
    previous = next;
    $('result').textContent = 'Edits ready to fit.';
    $('save').disabled = true;
    paintSheet();
  }
  canvas.addEventListener('pointerdown', event => {
    canvas.setPointerCapture(event.pointerId);
    stroke(event);
  });
  canvas.addEventListener('pointermove', event => { if (previous) stroke(event); });
  canvas.addEventListener('lostpointercapture', () => { previous = null; });
  paintSheet();
  return paintSheet;
});
function fit() {
  try {
    const result = S.fit(prior, edits);
    views[1].world = lantern.build(result.shape);
    fitted = result.shape;
    $('save').disabled = false;
    const missing = result.report.views.reduce((n, view) => n + view.missing, 0);
    $('result').textContent = missing ? missing + ' edited-view pixels unresolved.' : 'All edited-view pixels matched.';
    redraw();
  } catch (error) {
    $('result').textContent = error.message;
  }
}
$('add').addEventListener('click', () => setBrush(1));
$('erase').addEventListener('click', () => setBrush(0));
function setBrush(value) {
  brush = value;
  $('add').setAttribute('aria-pressed', brush === 1);
  $('erase').setAttribute('aria-pressed', brush === 0);
}
$('reset').addEventListener('click', () => {
  edits.forEach((edit, i) => { edit.mask.set(edit.initial); sheets[i](); });
  fit();
});
$('refit').addEventListener('click', fit);
$('save').addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(fitted, null, 2) + '\n'], { type: 'application/json' }));
  const anchor = Object.assign(document.createElement('a'), { href: url, download: 'lantern-handle-proxy.json' });
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
fit();
