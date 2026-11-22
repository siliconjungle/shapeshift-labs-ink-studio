import { createRenderer } from '../../src/webgl/renderer.mjs';
import { createDrawingInput } from '../../src/webgl/drawing-input.mjs';
import { createGaussianMaterialPainter } from '../../src/webgl/splat-mask-painter.mjs';
import { compileGaussianMaterials } from '../../src/webgl/gaussian-materials.mjs';
import { decodeGaussianSplat, gaussianSplatWorld } from '../../src/gaussian-splats.mjs';
import { pelagicMaterialMasks, pelagicPalette, samplePly } from '../webgpu-graphs/sample.mjs';

const $ = id => document.getElementById(id), left = $('captured'), right = $('edited');
const { width, height } = right, status = $('status'), degrees = angle => angle * Math.PI / 180;
const controls = ['ambient', 'diffuse', 'specular', 'roughness'];
const names = ['Shell', 'Fabric', 'Tissue'];
const maxBytes = 768 * 1024 * 1024;
const recipeFormat = 'ink-studio/gaussian-materials';
const inputs = ['orbit', 'light', 'size', 'capture', ...controls];
function defaults() {
  return [
    { id: 'shell', ramp: [0x123544, 0x237976, 0x6cc5ae, 0xcff6ce],
      captured: .49, detail: .12, lighting: { ambient: .22, diffuse: .58, specular: .32, roughness: .34 } },
    { id: 'fabric', ramp: [0x4b282c, 0x9a4838, 0xe68d56, 0xf9d79b],
      captured: .12, detail: .07, lighting: { ambient: .47, diffuse: .52, specular: .02, roughness: .86 } },
    { id: 'tissue', ramp: [0x33213e, 0x814a75, 0xc67da3, 0xfbd7b2],
      captured: .62, detail: .17, lighting: { ambient: .43, diffuse: .46, specular: .09, roughness: .70 } }
  ];
}
const canvas = document.createElement('canvas');
const contexts = [left, right].map(view => view.getContext('2d', { alpha: false }));
let world, painter, materials = defaults(), plan, assetKey, assetLabel, ticket = 0, pending, renderer, pitch = .02;

function message(text, state = 'ready') {
  status.textContent = text;
  status.dataset.state = state;
}
const selected = () => Number($('part').value);
const settings = () => materials.map((entry, i) => ({ ...entry, mask: painter.masks[i] }));
function refreshPlan() {
  if (!painter) return;
  plan = compileGaussianMaterials(world, settings());
  updateBrush();
  redraw();
}

function frame() {
  const lightAngle = degrees(Number($('light').value));
  return {
    camera: { ...world.cam, yaw: degrees(Number($('orbit').value)), pitch, dist: world.cam.dist * .94 },
    gaussianColor: $('color-mode').value, colored: false, dither: 0, damp: false, width, height, changedRows: [],
    gaussianLight: { direction: [.76 * Math.sin(lightAngle), .65, .76 * Math.cos(lightAngle)] }
  };
}
function render() {
  pending = undefined;
  if (!world || !plan) return;
  try {
    const view = frame(), mask = painter.masks[selected()];
    const tint = $('preview').checked && view.gaussianColor === 'palette' && mask.indices.length;
    renderer.render(world, { ...view, gaussianMaterials: false });
    contexts[0].drawImage(canvas, 0, 0);
    renderer.render(world, { ...view, gaussianMaterials: plan,
      splatPaint: tint ? { mask, preview: true } : false });
    contexts[1].drawImage(canvas, 0, 0);
  } catch (error) {
    message(error.message, 'error');
  }
}
function redraw() { pending ??= requestAnimationFrame(render); }
function output(id) {
  const value = Number($(id).value);
  document.querySelector('output[for="' + id + '"]').value = value +
    (id === 'orbit' || id === 'light' ? '°' : id === 'size' ? ' px' : '%');
}
function updateBrush() {
  const count = painter?.masks[selected()].indices.length ?? 0;
  const painting = $('tool').value !== 'orbit';
  right.toggleAttribute('data-paint', painting);
  $('brush-cursor').hidden = true;
  $('undo').disabled = !painter?.canUndo;
  $('clear').disabled = !count;
  $('count').textContent = count.toLocaleString() + ' splats assigned';
  $('preview').disabled = $('color-mode').value === 'rgb';
  $('preview').title = $('preview').disabled ? 'Mask preview is available in indexed palette mode' : '';
}

function updateResponse() {
  const slot = selected(), material = materials[slot];
  $('part-title').textContent = names[slot] + ' response';
  const colors = material.ramp.map((color, index) => {
    const input = document.createElement('input');
    input.type = 'color';
    input.value = '#' + color.toString(16).padStart(6, '0');
    input.setAttribute('aria-label', names[slot] + ' ramp swatch ' + (index + 1));
    input.addEventListener('input', () => {
      material.ramp[index] = parseInt(input.value.slice(1), 16);
      refreshPlan();
    });
    return input;
  });
  $('ramp').replaceChildren(...colors);
  $('capture').value = Math.round(material.captured * 100);
  for (const key of controls) $(key).value = Math.round(material.lighting[key] * 100);
  for (const id of ['capture', ...controls]) output(id);
  updateBrush();
}
function position(element, event) {
  const rect = element.getBoundingClientRect();
  return [(event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height];
}
function brushAt(point) {
  const cursor = $('brush-cursor');
  cursor.hidden = !point;
  if (!point) return;
  cursor.style.left = point[0] * 100 + '%';
  cursor.style.top = point[1] * 100 + '%';
  cursor.style.width = 200 * Number($('size').value) / width + '%';
}
function attachOrbit(element) {
  let drag;
  element.addEventListener('pointerdown', event => {
    if (element === right && $('tool').value !== 'orbit') return;
    drag = { x: event.clientX, y: event.clientY, yaw: Number($('orbit').value), pitch };
    element.setPointerCapture(event.pointerId);
  });
  element.addEventListener('pointermove', event => {
    if (!drag) return;
    const angle = drag.yaw - (event.clientX - drag.x) * .75;
    $('orbit').value = Math.round(((angle + 180) % 360 + 360) % 360 - 180);
    pitch = Math.max(-1.1, Math.min(1.1, drag.pitch + (event.clientY - drag.y) * .006));
    output('orbit');
    redraw();
  });
  element.addEventListener('lostpointercapture', () => { drag = undefined; });
}
function attachBrush() {
  createDrawingInput(right, {
    brush() {
      if (!painter || $('tool').value === 'orbit') return null;
      return { kind: 'stroke', surface: 'view', painter, slot: selected(), radius: Number($('size').value),
        erase: $('tool').value === 'erase', frame: frame() };
    },
    project: event => position(right, event),
    preview: draft => brushAt(draft?.points.at(-1)),
    commit({ painter: source, slot, points, frame, radius, erase }) {
      if (source !== painter) return;
      try {
        painter.stroke(slot, points, frame, { radius, erase });
        refreshPlan();
      } catch (error) { message(error.message, 'error'); }
    }
  });
  right.addEventListener('pointermove', event => {
    if (!event.buttons && $('tool').value !== 'orbit') brushAt(position(right, event));
  });
  right.addEventListener('pointerleave', () => brushAt(null));
}

async function open(read, name, preset = false) {
  const job = ++ticket;
  message('Opening ' + name + '…', 'loading');
  $('save').disabled = $('load').disabled = true;
  try {
    const bytes = await read();
    const digest = globalThis.crypto?.subtle && await crypto.subtle.digest('SHA-256', bytes);
    const cloud = await decodeGaussianSplat(bytes, { maxPoints: 2_000_000 });
    if (job !== ticket) return;
    const imported = gaussianSplatWorld(cloud, { colorMode: 'rgb', palette: pelagicPalette });
    const masks = preset ? pelagicMaterialMasks(cloud.count) : [];
    const next = createGaussianMaterialPainter(renderer, imported, { width, height }, { masks });
    world = imported;
    painter = next;
    materials = defaults();
    assetKey = digest && Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
    assetLabel = name + ' · ' + cloud.count.toLocaleString() + ' splats · SH degree ' + cloud.degree;
    $('save').disabled = $('load').disabled = !assetKey;
    updateResponse();
    refreshPlan();
    message(assetLabel);
  } catch (error) {
    if (job !== ticket) return;
    $('save').disabled = $('load').disabled = !assetKey;
    message(error.message, 'error');
  }
}
function openSample() { void open(() => samplePly({ materialSurface: true }), 'Pelagic PLY', true); }
function download() {
  const data = JSON.stringify({ format: recipeFormat, version: 1, asset: assetKey, materials: settings() }, null, 2);
  const url = URL.createObjectURL(new Blob([data + '\n'], { type: 'application/json' }));
  Object.assign(document.createElement('a'), { href: url, download: 'splat-materials.json' }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function restore(file) {
  if (!file || !world) return;
  const source = world;
  try {
    const saved = JSON.parse(await file.text());
    if (source !== world) return;
    if (saved.format !== recipeFormat || saved.version !== 1 || !assetKey || saved.asset !== assetKey)
      throw new RangeError('Open the original PLY or SPZ before loading its materials');
    const preset = defaults();
    if (!Array.isArray(saved.materials) || saved.materials.length !== preset.length ||
        saved.materials.some((m, i) => m?.id !== preset[i].id))
      throw new TypeError('This workshop expects shell, fabric and tissue slots');
    const next = createGaussianMaterialPainter(renderer, world, { width, height },
      { masks: saved.materials.map(m => m.mask) });
    const recipes = preset.map((base, i) => {
      const { mask, ...savedLayer } = saved.materials[i];
      return { ...base, ...savedLayer, lighting: { ...base.lighting, ...savedLayer.lighting } };
    });
    const nextPlan = compileGaussianMaterials(world, recipes.map((entry, i) => ({ ...entry, mask: next.masks[i] })));
    painter = next;
    materials = recipes;
    plan = nextPlan;
    updateResponse();
    redraw();
    message(assetLabel + ' · Materials loaded');
  } catch (error) { message(error.message, 'error'); }
}

try {
  renderer = createRenderer(canvas, { toolkit: { KIT, PixelLook } });
  attachOrbit(left);
  attachOrbit(right);
  attachBrush();
  $('sample').addEventListener('click', openSample);
  $('asset').addEventListener('change', ({ target }) => {
    const file = target.files[0];
    if (!file) return;
    void open(() => {
      if (file.size > maxBytes) throw new RangeError('This asset exceeds the 768 MB limit');
      return file.arrayBuffer();
    }, file.name);
    target.value = '';
  });
  $('load').addEventListener('change', ({ target }) => {
    void restore(target.files[0]);
    target.value = '';
  });
  $('save').addEventListener('click', download);
  $('part').addEventListener('change', () => { updateResponse(); redraw(); });
  $('tool').addEventListener('change', updateBrush);
  $('undo').addEventListener('click', () => { painter.undo(); refreshPlan(); });
  $('clear').addEventListener('click', () => { painter.clear(selected()); refreshPlan(); });
  $('preview').addEventListener('change', redraw);
  $('color-mode').addEventListener('change', () => { updateBrush(); redraw(); });
  for (const id of inputs) {
    output(id);
    $(id).addEventListener('input', () => {
      output(id);
      const n = Number($(id).value) / 100, active = materials[selected()];
      if (id === 'capture') active.captured = n;
      else if (controls.includes(id)) active.lighting[id] = n;
      if (id === 'capture' || controls.includes(id)) refreshPlan();
      else redraw();
    });
  }
  openSample();
} catch (error) {
  message(error.message, 'error');
}
