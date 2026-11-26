const el = id => document.getElementById(id);
const controls = { carrier: el('carrier'), slot: el('slot'), tile: el('tile'), channel: el('channel'), orbit: el('orbit') };
const { width, height, targets } = linkedMaterial;
const canvas = el('overlay'), context = canvas.getContext('2d');
canvas.width = width;
canvas.height = height;
el('viewport').style.setProperty('--view-ratio', width / height);
el('title').textContent = linkedMaterial.label;
document.title = linkedMaterial.label + ' · Ink Studio';
const names = { baseColor: 'Base color', normal: 'Tangent normal', roughness: 'Roughness', metalness: 'Metalness',
  height: 'Height', emission: 'Emission', opacity: 'Opacity', ao: 'Ambient occlusion' };
let target, region, map, current, hits, uv, drag, serial = 0;
const cache = new Map();

function options(control, rows, preferred) {
  control.replaceChildren(...rows.map(([key, label]) => new Option(label, key)));
  if (rows.some(([key]) => key === preferred)) control.value = preferred;
  control.disabled = rows.length < 2;
}
function chooseTarget() {
  const old = region;
  target = targets.find(row => row.id === controls.carrier.value);
  const selected = target.regions.find(row => row.slot === old?.slot && row.tile === old?.tile) ??
    target.regions[target.initialRegion];
  options(controls.slot, [...new Set(target.regions.map(row => row.slot))].map(name => [name, name]), selected.slot);
  chooseSlot(selected.tile);
  controls.orbit.value = 0;
  controls.orbit.max = target.views.length - 1;
  controls.orbit.disabled = target.views.length === 1;
  drawView();
}
function chooseSlot(tile) {
  const rows = target.regions.filter(row => row.slot === controls.slot.value);
  options(controls.tile, rows.map(row => [row.tile, row.tile]), tile ?? rows.find(row => row.maps.length)?.tile);
  chooseTile();
}
function chooseTile() {
  region = target.regions.find(row => row.slot === controls.slot.value && row.tile === controls.tile.value);
  const preferred = map?.name ?? 'baseColor';
  options(controls.channel, region.maps.map(row => [row.name, names[row.name] ?? row.name]), preferred);
  uv = undefined;
  chooseMap();
}
function chooseMap() {
  map = region.maps.find(row => row.name === controls.channel.value);
  el('empty').hidden = !!map;
  el('map-wrap').hidden = !map;
  el('map-title').textContent = map ? names[map.name] ?? map.name : '';
  el('dimensions').textContent = map ? map.width + ' × ' + map.height + ' px' +
    (map.mode === 'height' && map.range ? ' · ' + map.range.map(n => Number(n.toFixed(3))).join(' to ') + ' ' + map.units : '') : '';
  if (map) {
    el('map').src = map.image;
    el('map').alt = names[map.name] ?? map.name;
    el('map-wrap').style.setProperty('--map-ratio', map.width / map.height);
  }
  updateSelection();
}

function decode(view) {
  if (cache.has(view)) return cache.get(view);
  const promise = new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const sheet = document.createElement('canvas');
      sheet.width = width * 2;
      sheet.height = height;
      const reader = sheet.getContext('2d', { willReadFrequently: true });
      reader.drawImage(image, 0, 0);
      resolve(reader.getImageData(0, 0, sheet.width, sheet.height).data);
    };
    image.onerror = () => reject(new Error('Pick data could not be read'));
    image.src = view.pick;
  });
  cache.set(view, promise);
  if (cache.size > 6) cache.delete(cache.keys().next().value);
  return promise;
}

async function drawView() {
  const index = Number(controls.orbit.value), token = ++serial;
  const view = current = target.views[index];
  hits = undefined;
  el('angle').value = Math.round(index * 360 / target.views.length) + '°';
  el('render').src = view.image;
  el('render').alt = target.label + ' material preview';
  updateSelection();
  try {
    const samples = await decode(view);
    if (token !== serial) return;
    hits = samples;
    updateSelection();
  } catch (error) {
    if (token === serial) el('status').textContent = error.message;
  }
}

function sampleAt(pixel) {
  const i = pixel * 8;
  return [(hits[i + 1] * 256 + hits[i + 2]) / 65535, (hits[i + 4] * 256 + hits[i + 5]) / 65535];
}
function updateSelection() {
  const marker = el('marker'), reading = el('uv');
  marker.hidden = !map || !uv;
  if (uv) {
    marker.style.left = uv[0] * 100 + '%';
    marker.style.top = uv[1] * 100 + '%';
  }
  reading.textContent = map && uv ? '(' +
    [Math.round(uv[0] * (map.width - 1)), Math.round(uv[1] * (map.height - 1))].join(', ') + ')' : '';
  context.clearRect(0, 0, width, height);
  if (!hits || !region) {
    el('status').textContent = '';
    return;
  }
  const selected = region.index + 1;
  const isOwn = p => hits[p * 8] === selected;
  const overlay = context.createImageData(width, height);
  let nearest = -1, error = Infinity;
  for (let y = 0, p = 0; y < height; y++) for (let x = 0; x < width; x++, p++) {
    if (!isOwn(p)) continue;
    if (x === 0 || x === width - 1 || y === 0 || y === height - 1 ||
        !isOwn(p - 1) || !isOwn(p + 1) || !isOwn(p - width) || !isOwn(p + width))
      overlay.data.set([249, 210, 148, 194], p * 4);
    if (uv) {
      const [u, v] = sampleAt(p), delta = (uv[0] - u) ** 2 + (uv[1] - v) ** 2;
      if (delta < error) {
        error = delta;
        nearest = p;
      }
    }
  }
  context.putImageData(overlay, 0, 0);
  const visible = current.pixels[region.index] > 0;
  const near = nearest >= 0 && error < .035 ** 2;
  if (near) {
    const x = nearest % width + .5, y = Math.floor(nearest / width) + .5;
    context.strokeStyle = '#172622';
    context.lineWidth = 3.5;
    context.beginPath();
    context.arc(x, y, 6, 0, Math.PI * 2);
    context.stroke();
    context.strokeStyle = '#ffe0a6';
    context.lineWidth = 1.5;
    context.stroke();
  }
  el('status').textContent = !visible ? 'Tile out of view' : uv && !near ? 'Texel out of view' : 'Tile ' + region.tile;
}

function coordinates(event, node) {
  const rect = node.getBoundingClientRect();
  return [(event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height];
}
function point(event) {
  if (!hits) return;
  const pos = coordinates(event, el('viewport'));
  if (pos.some(n => n < 0 || n >= 1)) return;
  const pixel = Math.floor(pos[1] * height) * width + Math.floor(pos[0] * width);
  const selected = target.regions[hits[pixel * 8] - 1];
  if (!selected) return;
  controls.slot.value = selected.slot;
  chooseSlot(selected.tile);
  uv = sampleAt(pixel);
  updateSelection();
}

const viewport = el('viewport');
viewport.onpointerdown = event => {
  if (event.button !== 0) return;
  drag = { id: event.pointerId, x: event.clientX, start: Number(controls.orbit.value), moved: false };
  viewport.setPointerCapture(event.pointerId);
};
viewport.onpointermove = event => {
  if (!drag || drag.id !== event.pointerId) return;
  const delta = event.clientX - drag.x;
  if (!drag.moved && Math.abs(delta) < 6) return;
  drag.moved = true;
  const count = target.views.length;
  const index = ((drag.start - Math.round(delta / 26)) % count + count) % count;
  if (index === Number(controls.orbit.value)) return;
  controls.orbit.value = index;
  drawView();
};
viewport.onpointerup = event => {
  if (drag?.id === event.pointerId && !drag.moved) point(event);
  drag = undefined;
};
viewport.onpointercancel = () => { drag = undefined; };
el('map-wrap').onclick = event => {
  if (!map) return;
  uv = coordinates(event, el('map-wrap')).map(n => Math.max(0, Math.min(1, n)));
  updateSelection();
};
controls.carrier.onchange = chooseTarget;
controls.slot.onchange = () => chooseSlot();
controls.tile.onchange = chooseTile;
controls.channel.onchange = chooseMap;
controls.orbit.oninput = drawView;
options(controls.carrier, targets.map(row => [row.id, row.label]));
chooseTarget();
