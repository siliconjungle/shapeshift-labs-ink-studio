/* Bounded front-to-back fragment buffers on the native art grid. */
const kinds = Object.freeze({ splat: 1, glass: 2, sprite: 3, ink: 4 });
const stride = 11, idStride = 4;
const channels = { value: 4, surface: 4, depth: 1, mask: 1, valid: 1, ids: 4, scatter: 3, transmission: 3 };
const storage = { value: Uint8Array, surface: Uint8Array, depth: Float64Array, mask: Float32Array,
  valid: Uint8Array, ids: Uint32Array, scatter: Float32Array, transmission: Float32Array };
const record = value => value && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const name = value => typeof value === 'string' && !!value.trim();
const clamp = value => Math.min(1, Math.max(0, value));

function settings(value) {
  if (value === undefined || value === false) return null;
  if (value === true) value = {};
  if (!record(value) || Object.keys(value).some(key => !['layers', 'reflections', 'slots', 'coalesce'].includes(key)))
    throw new TypeError('Deep compositing needs a layer count and optional reflection plane names');
  const { layers = 4, reflections = [], slots = {}, coalesce = true } = value;
  if (!Number.isSafeInteger(layers) || layers < 1 || layers > 16 || !Array.isArray(reflections) ||
      reflections.length > 4 || !Array.from(reflections).every(name) || new Set(reflections).size !== reflections.length)
    throw new RangeError('Deep compositing supports 1–16 layers and up to four distinct reflection planes');
  if (typeof coalesce !== 'boolean') throw new TypeError('Deep coalesce needs a boolean');
  if (!record(slots) || Object.keys(slots).length > 8) throw new RangeError('Deep compositing supports up to eight raster slots');
  const bindings = Object.entries(slots).map(([slot, value]) => {
    if (!name(slot) || !record(value)) throw new TypeError('Deep raster slots need names and layer selectors');
    const { channel = 'value', ...query } = value;
    if (!Object.hasOwn(channels, channel)) throw new TypeError('Unknown deep raster slot channel ' + channel);
    layerOptions(query);
    return [slot, channel, query];
  });
  return { layers, reflections: new Set(reflections), bindings, coalesce, remaining: 2_000_000 };
}

function capture(w, h, scope, metadata, view, sprites) {
  if (!scope) return null;
  const { layers } = scope, size = w * h, slots = size * layers;
  if (slots > scope.remaining) throw new RangeError('Deep compositing exceeded the shared two-million-slot budget');
  scope.remaining -= slots;
  const top = p => (h - 1 - Math.floor(p / w)) * w + p % w;
  const count = new Uint32Array(size), colors = new Float32Array(slots * stride), ids = new Uint32Array(slots * idStride);
  const depthGate = view ? null : new Float32Array(size);
  const donorGate = view ? null : new Float32Array(size).fill(-1);
  const donor = view ? null : new Int32Array(size).fill(-1);
  const donorWeight = view ? null : new Float32Array(size), localWeight = view ? null : new Float32Array(size).fill(1);
  const reflections = Object.create(null), routes = [];
  const objects = metadata?.objects?.slice() ?? [null], materials = metadata?.materials?.slice() ?? [null];
  const labels = names => new Map(names.flatMap((label, index) => typeof label === 'string' ? [[label, index]] : []));
  const objectLabels = labels(objects), materialLabels = labels(materials);
  const reserved = property => new Set(sprites.map(sprite => sprite[property]).filter(Number.isSafeInteger));
  const objectNumbers = reserved('objectId'), materialNumbers = reserved('materialId');
  function identify(value, fallback, names, known, reserved) {
    if (typeof value !== 'string') return value ?? fallback ?? 0;
    if (!known.has(value)) {
      while (reserved.has(names.length)) names.push(null);
      known.set(value, names.length);
      names.push(value);
    }
    return known.get(value);
  }
  const worldIds = metadata?.objectIds, materialIds = metadata?.materialIds;

  function fragment(bottom, depth, coverage, r, g, b, index, kind, medium, sprite) {
    const pixel = top(bottom), base = pixel * layers;
    const at = base * stride, tag = base * idStride;
    const object = identify(sprite?.objectId, worldIds?.[index], objects, objectLabels, objectNumbers);
    const material = identify(sprite?.materialId, materialIds?.[index], materials, materialLabels, materialNumbers);
    if (scope.coalesce && count[pixel] && object && ids[tag + 2] === object && ids[tag + 3] === material &&
        ids[tag] === kinds[kind] && Math.abs(colors[at] - depth) < 1e-4) {
      // Coincident dabs from one surface consume a single layer.
      const rear = colors[at + 1] * (1 - coverage), a = coverage + rear;
      colors[at + 1] = a;
      colors[at + 2] = (r * coverage + colors[at + 2] * rear) / a;
      colors[at + 3] = (g * coverage + colors[at + 3] * rear) / a;
      colors[at + 4] = (b * coverage + colors[at + 4] * rear) / a;
      if (coverage >= rear) ids[tag + 1] = index + 1;
      return;
    }
    const retained = Math.min(count[pixel]++, layers - 1);
    colors.copyWithin(at + stride, at, at + retained * stride);
    ids.copyWithin(tag + idStride, tag, tag + retained * idStride);
    colors[at] = depth;
    colors[at + 1] = coverage;
    colors[at + 2] = r;
    colors[at + 3] = g;
    colors[at + 4] = b;
    for (let c = 0; c < 3; c++) {
      colors[at + 5 + c] = medium?.[c] ?? 0;
      colors[at + 8 + c] = medium?.[c + 3] ?? 1;
    }
    ids[tag] = kinds[kind];
    ids[tag + 1] = index + 1;
    ids[tag + 2] = object;
    ids[tag + 3] = material;
  }

  function transmit(bottom, source, receiverDepth, sourceDepth, weight) {
    if (!donor) return;
    const p = top(bottom);
    localWeight[p] -= weight;
    if (weight > donorWeight[p]) {
      donorWeight[p] = weight;
      donor[p] = top(source);
      depthGate[p] = receiverDepth;
      donorGate[p] = Number.isFinite(sourceDepth) ? sourceDepth : -1;
    }
  }

  function route(plane, frame) {
    if (!scope.reflections.has(plane) || !frame) return;
    const view = { frame, source: new Int32Array(size).fill(-1), weight: new Float32Array(size) };
    reflections[plane] = view;
    routes.push([plane, view]);
  }

  function reflect(bottom, address, opacity) {
    if (!routes.length) return;
    const p = top(bottom);
    for (const [plane, view] of routes) {
      const remaining = view.weight[p] * (1 - opacity);
      const added = plane === address?.plane ? address.amount * opacity : 0;
      if (added > remaining) view.source[p] = address.pixel;
      view.weight[p] = remaining + added;
    }
  }

  function finish() {
    if (donor) for (let p = 0; p < size; p++) if (donorWeight[p] < localWeight[p]) donor[p] = -1;
    return { w, h, layers, count, colors, ids, objects, materials, donor, depthGate, donorGate, reflections };
  }

  return { fragment, transmit, route, reflect, finish };
}

function layerOptions(options) {
  if (!record(options) || Object.keys(options).some(key => !['view', 'plane', 'rank', 'kind', 'object', 'material', 'emptyDepth'].includes(key)))
    throw new TypeError('Deep layer options need a view and optional fragment selectors');
  const { view = 'camera', plane, rank = 0, kind, object, material, emptyDepth = 1e9 } = options;
  if (!['camera', 'transmitted', 'reflection', 'reflected'].includes(view) ||
      (['reflection', 'reflected'].includes(view) ? !name(plane) : plane !== undefined) ||
      !Number.isSafeInteger(rank) || rank < 0 || rank > 15 || kind !== undefined && !Object.hasOwn(kinds, kind) ||
      [object, material].some(value => value !== undefined && !name(value) &&
        !(Number.isSafeInteger(value) && value >= 0 && value <= 0xffffffff)) || !Number.isFinite(emptyDepth))
    throw new RangeError('Invalid deep layer view, rank, or fragment selector');
  return { view, plane, rank, kind, object, material, emptyDepth };
}

function layer(frame, options = {}, channel) {
  const { view, plane, rank, kind, object, material, emptyDepth } = layerOptions(options);
  const root = frame?.deep;
  if (!root) throw new RangeError('Render did not capture deep fragments');
  const reflection = plane === undefined ? undefined : root.reflections[plane];
  const source = reflection?.frame ?? root;
  const { w: width, h: height } = view === 'reflection' ? source : root;
  const size = width * height, output = {};
  for (const key of channel ? [channel] : Object.keys(channels)) {
    const Type = storage[key], data = new Type(size * channels[key]);
    if (key === 'depth') data.fill(emptyDepth);
    output[key] = { width, height, channels: channels[key], data };
  }
  const byte = value => Math.round(clamp(value) * 255);
  const { value, surface, depth, mask, ids, valid, scatter, transmission } = output;
  function through(buffer, pixel) {
    let visibility = 1;
    const base = pixel * buffer.layers;
    for (let k = 0; k < Math.min(buffer.count[pixel], buffer.layers); k++) {
      const slot = base + k;
      if (buffer.ids[slot * idStride] === kinds.glass) return { slot, visibility };
      visibility *= 1 - buffer.colors[slot * stride + 1];
      if (visibility <= 1e-6) break;
    }
  }
  const matches = (selector, id, names) => selector === undefined || (typeof selector === 'number' ? id === selector : names[id] === selector);
  const hasView = plane === undefined || reflection;
  for (let p = 0; hasView && p < size; p++) {
    let donor = p, minimum = 0, visibility = 1;
    if (view === 'reflected') {
      donor = reflection.source[p];
      visibility = reflection.weight[p];
      if (donor < 0 || visibility <= 1e-6) continue;
    } else if (view === 'transmitted') {
      const glass = through(root, p);
      if (!glass) continue;
      const at = glass.slot * stride;
      visibility = glass.visibility * (1 - root.colors[at + 1]);
      if (visibility <= 1e-6) continue;
      const route = root.donor?.[p] ?? -1;
      if (route >= 0 && Math.abs(root.depthGate[p] - root.colors[at]) < 1e-4) {
        donor = route;
        const gate = root.donorGate[p];
        const base = donor * root.layers;
        if (gate >= 0) {
          while (minimum < Math.min(root.count[donor], root.layers) &&
                 root.colors[(base + minimum) * stride] <= gate + 1e-4) minimum++;
        }
      }
      if (donor === p) {
        const base = p * root.layers, pane = root.ids[glass.slot * idStride + 2];
        minimum = glass.slot - base + 1;
        while (pane && minimum < Math.min(root.count[p], root.layers)) {
          const slot = base + minimum, tag = slot * idStride;
          if (root.ids[tag] !== kinds.glass || root.ids[tag + 2] !== pane) break;
          visibility *= 1 - root.colors[slot * stride + 1];
          minimum++;
        }
      } else if (!minimum) {
        const base = donor * root.layers;
        while (minimum < Math.min(root.count[donor], root.layers) &&
               root.colors[(base + minimum) * stride] < root.colors[at]) minimum++;
      }
    }
    const base = donor * source.layers;
    let match = 0;
    for (let k = minimum; k < Math.min(source.count[donor], source.layers); k++) {
      const at = (base + k) * stride, tag = (base + k) * idStride;
      const type = source.ids[tag], objectId = source.ids[tag + 2], materialId = source.ids[tag + 3];
      const a = source.colors[at + 1];
      if ((kind === undefined || type === kinds[kind]) && matches(object, objectId, source.objects) &&
          matches(material, materialId, source.materials) && match++ === rank) {
        for (let c = 0; c < 3; c++) {
          const color = source.colors[at + 2 + c], glow = source.colors[at + 5 + c], through = source.colors[at + 8 + c];
          if (surface) surface.data[p * 4 + c] = byte(color);
          if (value) value.data[p * 4 + c] = byte(glow + through * color);
          if (scatter) scatter.data[p * 3 + c] = glow;
          if (transmission) transmission.data[p * 3 + c] = through;
        }
        if (value) value.data[p * 4 + 3] = byte(a);
        if (surface) surface.data[p * 4 + 3] = byte(a);
        if (depth) depth.data[p] = source.colors[at];
        if (mask) mask.data[p] = a * visibility;
        if (ids) ids.data.set(source.ids.subarray(tag, tag + idStride), p * idStride);
        if (valid) valid.data[p] = 255;
        break;
      }
      visibility *= 1 - a;
    }
  }
  if (channel) return output[channel];
  return { ...output, report: { width, height, view, rank, ...(plane !== undefined && { plane }),
      objects: source.objects, materials: source.materials, kinds } };
}

module.exports = { settings, capture, layer };
