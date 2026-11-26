const $ = id => document.getElementById(id);
const P = KIT.procedural;
const { spec, controls, swatches, saved } = moonlock;
const groups = { Moonlock: P.graph.group(spec.groups.Moonlock) };
const runner = P.graph.create(spec, { groups });
const fields = new Map();
const orbit = $('orbit');
let frame, scheduled = 0, drag, pointer;

function schedule() {
  if (!scheduled) scheduled = requestAnimationFrame(draw);
}
for (const [id, { label, min, max, step, default: value, unit = '' }] of Object.entries(controls)) {
  const row = document.createElement('div'), caption = document.createElement('label');
  const range = document.createElement('input'), readout = document.createElement('output');
  row.className = 'field';
  caption.textContent = label;
  caption.htmlFor = range.id = id;
  range.type = 'range';
  Object.assign(range, { min, max, step, value });
  readout.htmlFor.add(id);
  function read() {
    readout.value = range.valueAsNumber.toFixed(step === 1 ? 0 : 3) + unit;
  }
  function set(next) {
    range.value = id === 'yaw' ? ((next + 180) % 360 + 360) % 360 - 180 : next;
    read();
  }
  range.addEventListener('input', () => {
    read();
    schedule();
  });
  fields.set(id, { range, set, value });
  row.append(caption, readout, range);
  $('controls').append(row);
  read();
}
for (const [name, color] of Object.entries(swatches)) {
  const item = document.createElement('span'), swatch = document.createElement('i');
  item.className = 'swatch';
  swatch.style.setProperty('--color', color);
  item.append(swatch, name);
  $('swatches').append(item);
}
const values = () => Object.fromEntries([...fields].map(([id, { range }]) => [id, range.valueAsNumber]));
function paint(canvas, { width, height, data }) {
  canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(data), width, height), 0, 0);
}
function idImage(width, height, data, names, materials) {
  const colors = names.map(name => {
    if (!name) return [0, 0, 0, 0];
    const tint = materials && swatches[name];
    if (tint) return [...tint.slice(1).match(/../g).map(value => parseInt(value, 16)), 255];
    const seed = P.data.hash(name);
    return [73 + (seed & 159), 73 + ((seed >>> 8) & 159), 73 + ((seed >>> 16) & 159), 255];
  });
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < data.length; i++) rgba.set(colors[data[i]], i * 4);
  return { width, height, data: rgba };
}
function paintOrbit() {
  if (!frame) return;
  const { orbit: shaded, frame: { passes } } = frame.outputs;
  const mode = $('orbitMode').value;
  const pic = mode === 'color' ? shaded : mode === 'object'
    ? idImage(shaded.width, shaded.height, passes.objectId, passes.objects, false)
    : idImage(shaded.width, shaded.height, passes.materialId, passes.materials, true);
  paint(orbit, pic);
  inspect();
}
function paintSection() {
  if (!frame) return;
  const { slices, sliceMaterials, sliceLayout } = frame.outputs;
  const i = $('sliceIndex').valueAsNumber;
  const { width, height, data } = sliceMaterials[i];
  const y = sliceLayout.center[1] + (i + .5 - slices.length / 2) * sliceLayout.spacing;
  $('sliceLevel').value = 'Y ' + y.toFixed(3) + ' · ' + (i + 1) + '/' + slices.length;
  paint($('slice'), $('sliceMode').value === 'color' ? slices[i] : idImage(width, height, data, sliceLayout.materials, true));
}
function paintScatter() {
  if (!frame) return;
  const { tile, relief, scatterMaterials, scatterLayout } = frame.outputs;
  const { width, height } = tile, mode = $('scatterMode').value;
  let image = tile;
  if (mode === 'material') image = idImage(width, height, scatterMaterials.raster.data, scatterLayout.materials, true);
  if (mode === 'height') {
    const data = new Uint8Array(width * height * 4), heightMap = relief.raster.data;
    for (let i = 0; i < heightMap.length; i++) {
      if (!heightMap[i]) continue;
      const q = Math.max(0, Math.min(1, heightMap[i] / .08));
      data.set([Math.round(32 + 130 * q), Math.round(50 + 163 * q), Math.round(65 + 145 * q), 255], i * 4);
    }
    image = { width, height, data };
  }
  paint($('tile'), image);
  $('stampCount').value = scatterLayout.placements.length;
}
function draw() {
  scheduled = 0;
  try {
    frame = runner.evaluate(values());
    paintOrbit();
    paintSection();
    paintScatter();
    $('status').textContent = '';
  } catch (error) {
    $('status').textContent = error.message;
  }
}

function inspect() {
  const passes = frame?.outputs.frame.passes;
  const object = pointer && passes?.objects[passes.objectId[pointer[1] * passes.w + pointer[0]]];
  const material = pointer && passes?.materials[passes.materialId[pointer[1] * passes.w + pointer[0]]];
  $('surface').value = object ? object + ' / ' + material : '—';
}
function point(event) {
  const rect = orbit.getBoundingClientRect();
  const x = Math.floor((event.clientX - rect.left) * orbit.width / rect.width);
  const y = Math.floor((event.clientY - rect.top) * orbit.height / rect.height);
  pointer = x >= 0 && x < orbit.width && y >= 0 && y < orbit.height ? [x, y] : null;
}
orbit.addEventListener('pointerdown', event => {
  if (!event.isPrimary || event.button !== 0) return;
  orbit.setPointerCapture(event.pointerId);
  drag = { id: event.pointerId, x: event.clientX, y: event.clientY, ...values() };
  orbit.dataset.dragging = 'true';
});
orbit.addEventListener('pointermove', event => {
  point(event);
  inspect();
  if (drag?.id !== event.pointerId) return;
  fields.get('yaw').set(drag.yaw + (event.clientX - drag.x) * .64);
  fields.get('pitch').set(drag.pitch + (event.clientY - drag.y) * .45);
  schedule();
});
orbit.addEventListener('pointerleave', () => { pointer = null; inspect(); });
orbit.addEventListener('lostpointercapture', () => {
  drag = null;
  orbit.dataset.dragging = 'false';
});
orbit.addEventListener('keydown', event => {
  const delta = { ArrowLeft: [-5, 0], ArrowRight: [5, 0], ArrowUp: [0, 5], ArrowDown: [0, -5] }[event.key];
  if (!delta) return;
  event.preventDefault();
  const { yaw, pitch } = values();
  fields.get('yaw').set(yaw + delta[0]);
  fields.get('pitch').set(pitch + delta[1]);
  schedule();
});
$('orbitMode').addEventListener('change', paintOrbit);
$('sliceMode').addEventListener('change', paintSection);
$('sliceIndex').addEventListener('input', paintSection);
$('scatterMode').addEventListener('change', paintScatter);
$('reset').addEventListener('click', () => {
  for (const field of fields.values()) field.set(field.value);
  schedule();
});
$('download').addEventListener('click', () => {
  const material = structuredClone(saved);
  for (const [id, value] of Object.entries(values())) material.graph.inputs[id].definition.default = value;
  const file = new Blob([JSON.stringify(material, null, 2) + '\n'], { type: 'application/json' });
  const anchor = document.createElement('a');
  anchor.href = URL.createObjectURL(file);
  anchor.download = 'moonlock.material.json';
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(anchor.href), 1000);
});
draw();
