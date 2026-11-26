const $ = id => document.getElementById(id);
const P = KIT.procedural, Bitmap = BitmapResources;
const png = globalThis[Symbol.for('ink-studio.png-raster')];
const plate = $('plate');
const root = structuredClone(demo.saved), links = { ...demo.links }, prepared = new Map();
const originals = new Map();
const state = { resource: 'lantern', frame: 1001, tile: [0, 0], stops: 0, animated: false };
const graph = P.graph.create(demo.spec, { operations: { bitmapAsset: Bitmap.operation(name => prepared.get(name)) } });
let rendered, cursor, timer, candidateFile;
const definition = () => root.resources[state.resource].definition;

function put(canvas, raster) {
  const { width, height, data } = raster;
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(data), width, height), 0, 0);
}
function blobBytes(buffer) {
  const bytes = new Uint8Array(buffer), chunks = [];
  for (let i = 0; i < bytes.length; i += 8192) chunks.push(String.fromCharCode(...bytes.subarray(i, i + 8192)));
  return btoa(chunks.join(''));
}
async function decode(row, base64) {
  const encoding = Bitmap.encoding(row), key = encoding + '/' + (row.rowOrder ?? '') + '/' + base64;
  if (originals.has(key)) return originals.get(key);
  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  if (bytes.length > Bitmap.maxFileBytes) throw new RangeError('Bitmap exceeds 32 MiB');
  let raster;
  if (encoding === 'pfm') raster = Bitmap.pfm(bytes, row);
  else {
    const decoder = png.decode(bytes), { parts, scanlineSize } = decoder.next().value;
    const stream = new Blob(parts).stream().pipeThrough(new DecompressionStream('deflate')).getReader();
    const samples = new Uint8Array(scanlineSize);
    let at = 0;
    try {
      for (;;) {
        const { value, done } = await stream.read();
        if (done) break;
        if (at + value.length > samples.length) throw new RangeError('Unexpected PNG sample count');
        samples.set(value, at);
        at += value.length;
      }
      if (at !== samples.length) throw new RangeError('Truncated PNG samples');
    } finally {
      await stream.cancel().catch(() => {});
    }
    raster = Bitmap.png(decoder.next(samples).value);
  }
  originals.set(key, raster);
  return raster;
}

function payload(row, sources = links) {
  return row?.base64 ?? (row?.file && sources[row.file]);
}
async function compile(def, sources = links) {
  const decoded = new Map();
  const { rows } = Bitmap.layout(def);
  for (const row of rows) {
    const base64 = payload(row, sources);
    if (base64) decoded.set(row.key, await decode(row, base64));
  }
  return Bitmap.compile(def, decoded, P.graphImages.declare);
}
function commit(id, next, compiled) {
  root.resources[id].definition = next;
  prepared.set(id, compiled);
  graph.clear();
  if (id === state.resource) {
    panes();
    draw();
  }
}
async function update(next) {
  const id = state.resource, before = definition();
  const compiled = await compile(next);
  if (root.resources[id].definition !== before) throw new Error('Choose the edit again after the source update.');
  commit(id, next, compiled);
}
function stop() {
  state.animated = false;
  clearInterval(timer);
  $('play').setAttribute('aria-pressed', 'false');
  $('play').textContent = 'Play sequence';
}
function args(key) {
  const { kind } = Bitmap.layout(definition());
  return { frame: kind === 'sequence' ? Number(key) : -1, tile: kind === 'tiles' ? key.split(',').map(Number) : [0, 0] };
}
function selection() {
  const { kind } = Bitmap.layout(definition());
  return kind === 'sequence' ? String(state.frame) : kind === 'tiles' ? state.tile.join(',') : 'single';
}
function activeMember() {
  return Bitmap.layout(definition()).rows.find(row => row.key === selection());
}

function draw(time = 0) {
  try {
    const outputs = graph.evaluate({ resource: state.resource, frame: state.animated ? -1 : state.frame,
      tile: state.tile, stops: state.stops }, { time }).outputs;
    const { display, status, native } = outputs;
    if (status.frame !== undefined) state.frame = status.frame;
    rendered = native;
    put(plate, display);
    $('status').value = status.status === 'held' ? 'Frame ' + status.requested + ' holds ' + status.resolved :
      status.status === 'blank' ? 'Missing tile · blank' : status.frame !== undefined ? 'Frame ' + status.frame :
      status.tile ? 'Tile ' + status.tile.join(', ') : 'Single image';
    $('status').dataset.status = status.status;
    $('precision').value = native.descriptor.precision + ' · ' + native.descriptor.colorSpace;
    $('dims').value = native.raster.width + ' × ' + native.raster.height;
  } catch (error) {
    rendered = null;
    plate.getContext('2d').clearRect(0, 0, plate.width, plate.height);
    $('status').value = error.message;
    $('status').dataset.status = 'error';
    $('precision').value = $('dims').value = '—';
  }
  const member = activeMember(), ready = !!payload(member);
  $('storage').value = member?.base64 ? 'Embedded' : member?.file ?
    (ready ? 'Linked · ' : 'Missing · ') + member.file.split('/').at(-1) : 'Missing';
  $('embed').disabled = !member?.file || !ready;
  $('reload').disabled = !member?.file && !member?.origin;
  $('relink').disabled = !member?.origin || !links[member.origin];
  $('replace').disabled = !member;
  $('undoPaint').disabled = !member?.pixels?.length;
  $('ev').value = state.stops + ' EV';
  for (const button of $('members').querySelectorAll('button'))
    button.setAttribute('aria-pressed', String(button.dataset.key === selection()));
  probe();
}

function panes() {
  const def = definition(), info = prepared.get(state.resource).info;
  $('viewTitle').textContent = root.resources[state.resource].label;
  $('sequenceControls').hidden = info.kind !== 'sequence';
  $('playback').value = info.playback ?? 'clamp';
  $('space').value = info.descriptor?.colorSpace ?? 'srgb';
  $('fallback').value = def.missing?.policy ?? 'error';
  $('fallback').querySelector('option[value=hold]').disabled = info.kind !== 'sequence';
  $('members').hidden = info.kind === 'single';
  $('members').dataset.kind = info.kind;
  const rows = info.kind === 'tiles' && !info.members.some(row => row.key === '1,1') ?
    [...info.members, { key: '1,1', tile: [1, 1], udim: 1012, available: false, storage: 'missing' }] : info.members;
  $('members').replaceChildren(...rows.map(row => {
    const button = document.createElement('button'), canvas = document.createElement('canvas');
    const title = document.createElement('span'), status = document.createElement('small');
    button.className = 'member';
    button.type = 'button';
    button.dataset.key = row.key;
    canvas.width = 80;
    canvas.height = 72;
    canvas.setAttribute('aria-hidden', 'true');
    title.textContent = row.frame ?? row.udim ?? row.key;
    status.textContent = row.available ? row.storage : 'missing';
    button.append(canvas, title, status);
    if (row.available) {
      const { value } = prepared.get(state.resource).select(args(row.key));
      put(canvas, P.graphImages.toDisplay(value));
    }
    button.addEventListener('click', () => {
      stop();
      Object.assign(state, args(row.key));
      draw();
    });
    return button;
  }));
  for (const button of $('resources').querySelectorAll('button'))
    button.setAttribute('aria-pressed', String(button.dataset.resource === state.resource));
}

function probe() {
  const position = cursor;
  if (!position || !rendered || position[0] >= plate.width || position[1] >= plate.height) {
    $('sample').value = '—';
    return;
  }
  const { raster, descriptor } = rendered;
  const [x, y] = position, p = (y * raster.width + x) * 4;
  const values = Array.from(raster.data.subarray(p, p + 4), n => descriptor.precision === 'float32' ? n.toFixed(3) : n);
  $('sample').value = x + ',' + y + ' · ' + values.join(' / ');
}
function point(event) {
  const { left, top, width, height } = plate.getBoundingClientRect();
  const x = Math.floor((event.clientX - left) / width * plate.width);
  const y = Math.floor((event.clientY - top) / height * plate.height);
  return x >= 0 && x < plate.width && y >= 0 && y < plate.height ? [x, y] : null;
}
function describeError(error) { $('notice').textContent = error.message; }
function mutateMember(map) {
  const def = definition(), key = selection();
  return Bitmap.mapMembers(def, (member, name) => name === key ? map(member) : member);
}

for (const [id, note] of Object.entries({ lantern: 'PNG16 sequence', atlas: 'UDIM tiles', radiance: 'Float32 PFM' })) {
  const button = document.createElement('button'), label = document.createElement('span'), detail = document.createElement('small');
  button.className = 'resource';
  button.type = 'button';
  button.dataset.resource = id;
  label.textContent = root.resources[id].label;
  detail.textContent = note;
  button.append(label, detail);
  button.addEventListener('click', () => {
    if (!prepared.has(id)) return;
    stop();
    state.resource = id;
    state.frame = 1001;
    state.tile = [0, 0];
    state.stops = id === 'radiance' ? -2 : 0;
    $('exposure').value = state.stops;
    $('notice').textContent = '';
    panes();
    draw();
  });
  $('resources').append(button);
}
$('play').addEventListener('click', () => {
  if (state.animated) { stop(); draw(); return; }
  if (Bitmap.layout(definition()).kind !== 'sequence') return;
  const now = performance.now();
  state.animated = true;
  $('play').setAttribute('aria-pressed', 'true');
  $('play').textContent = 'Pause sequence';
  timer = setInterval(() => draw((performance.now() - now) / 1000), 1000 / 24);
  draw();
});
$('exposure').addEventListener('input', () => { state.stops = $('exposure').valueAsNumber; if (!state.animated) draw(); });
$('paint').addEventListener('change', () => {
  plate.dataset.painting = String($('paint').checked);
  if ($('paint').checked && state.animated) { stop(); draw(); }
});
plate.addEventListener('pointermove', event => { cursor = point(event); probe(); });
plate.addEventListener('pointerleave', () => { cursor = null; probe(); });
plate.addEventListener('pointerdown', async event => {
  cursor = point(event);
  if (!cursor || !$('paint').checked || !payload(activeMember())) return;
  const [x, y] = cursor, value = [...$('dab').value.slice(1).match(/../g).map(n => parseInt(n, 16) / 255), 1];
  try {
    await update(mutateMember(member => {
      const pixels = (member.pixels ?? []).filter(row => row.x !== x || row.y !== y);
      return { ...member, pixels: [...pixels, { x, y, value }] };
    }));
    $('notice').textContent = 'Pixel edit saved on this member.';
  } catch (error) { describeError(error); }
});
$('undoPaint').addEventListener('click', async () => {
  try {
    await update(mutateMember(member => ({ ...member, pixels: [] })));
    $('notice').textContent = '';
  } catch (error) { describeError(error); }
});
for (const [id, change] of [
  ['space', value => ({ interpretation: { ...definition().interpretation, colorSpace: value } })],
  ['fallback', policy => ({ missing: { policy } })],
  ['playback', playback => ({ sequence: { ...definition().sequence, playback } })]
]) $(id).addEventListener('change', async () => {
  stop();
  try {
    await update({ ...definition(), ...change($(id).value) });
    $('notice').textContent = '';
  } catch (error) { panes(); draw(); describeError(error); }
});

$('embed').addEventListener('click', async () => {
  try {
    await update(mutateMember(({ file, ...member }) => ({
      ...member, encoding: Bitmap.encoding({ ...member, file }), base64: links[file], origin: file
    })));
    $('notice').textContent = 'Original file bytes embedded.';
  } catch (error) { describeError(error); }
});
$('relink').addEventListener('click', async () => {
  try {
    await update(mutateMember(({ base64, origin, ...member }) => ({ ...member, file: origin })));
    $('notice').textContent = 'Linked to the original file.';
  } catch (error) { describeError(error); }
});
for (const mode of ['reload', 'replace']) $(mode).addEventListener('click', () => {
  stop();
  candidateFile = { mode, resource: state.resource, key: selection() };
  $('file').value = '';
  $('file').click();
});
$('file').addEventListener('change', async () => {
  const file = $('file').files[0], { mode, resource, key } = candidateFile;
  if (!file) return;
  try {
    if (file.size > Bitmap.maxFileBytes) throw new RangeError('Bitmap exceeds 32 MiB');
    const base64 = blobBytes(await file.arrayBuffer()), def = root.resources[resource].definition, nextLinks = { ...links };
    const next = Bitmap.mapMembers(def, (member, name) => {
      if (name !== key) return member;
      if (mode === 'replace') return { base64, encoding: Bitmap.encoding({ file: file.name }) };
      if (member.file) nextLinks[member.file] = base64;
      return member.file ? member : { ...member, base64 };
    });
    const compiled = await compile(next, nextLinks);
    if (root.resources[resource].definition !== def) throw new Error('Choose the file again after the source edit.');
    const origin = Bitmap.layout(def).rows.find(row => row.key === key)?.file;
    if (mode === 'reload' && origin) links[origin] = base64;
    commit(resource, next, compiled);
    $('notice').textContent = mode === 'replace' ? 'Replacement embedded at the same resource ID.' : 'Source bytes refreshed.';
  } catch (error) { describeError(error); }
});
$('download').addEventListener('click', () => {
  const portable = structuredClone(root);
  for (const entry of Object.values(portable.resources)) {
    const def = entry.definition, { kind } = Bitmap.layout(def);
    entry.definition = Bitmap.mapMembers(def, member => {
      if (!member?.file) return member;
      const { file, ...rest } = member, base64 = links[file];
      return base64 ? { ...rest, encoding: Bitmap.encoding(member), origin: file, base64 } : kind === 'sequence' ? null : member;
    });
  }
  for (const [id, value] of Object.entries({ resource: state.resource, frame: state.frame, tile: state.tile, stops: state.stops }))
    portable.graph.inputs[id].definition.default = value;
  const blob = new Blob([JSON.stringify(portable, null, 2) + '\n'], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'switchyard-glass.material.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
});

(async () => {
  try {
    for (const [id, resource] of Object.entries(root.resources)) prepared.set(id, await compile(resource.definition));
    panes();
    draw();
  } catch (error) { describeError(error); }
})();
