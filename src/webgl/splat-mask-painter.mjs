import { makeCamera } from './view.mjs';
import { splatScreenRays } from './splat-screen-ray.mjs';
import { maxGaussianMaterials, visitGaussianMask } from './gaussian-materials.mjs';

const minimumWeight = .018;

function createStrokePicker(renderer, world, { width, height }) {
  if (!world?.gaussianHarmonics || typeof renderer?.pick !== 'function' ||
      ![width, height].every(n => Number.isSafeInteger(n) && n > 0))
    throw new TypeError('A splat mask brush needs a live imported cloud and an art grid');

  const count = world.gaussianHarmonics.count;
  return function pick(points, frame, radius) {
    if (!Array.isArray(points) || !points.length || points.some(point => !Array.isArray(point) ||
        point.length !== 2 || !point.every(Number.isFinite)) || !Number.isFinite(radius) || radius < 1 || radius > 64)
      throw new RangeError('A splat brush needs screen points and a radius of 1–64 art pixels');
    const rays = splatScreenRays(makeCamera(world, frame, width, height), width, height);
    const spacing = Math.min(3, Math.max(1, radius / 2));
    const covered = new Set(), picked = new Set();
    function dab(x, y) {
      const left = Math.max(0, Math.ceil((x - radius - .5) / spacing));
      const right = Math.min(Math.floor((width - .5) / spacing), Math.floor((x + radius - .5) / spacing));
      const top = Math.max(0, Math.ceil((y - radius - .5) / spacing));
      const bottom = Math.min(Math.floor((height - .5) / spacing), Math.floor((y + radius - .5) / spacing));
      for (let row = top; row <= bottom; row++) for (let col = left; col <= right; col++) {
        const px = col * spacing + .5, py = row * spacing + .5, key = row * (width + 1) + col;
        if (covered.has(key) || Math.hypot(px - x, py - y) > radius) continue;
        covered.add(key);
        const { dominant, contributions } = renderer.pick(world, { ...rays(px, py), threshold: minimumWeight }, frame);
        if (!Number.isInteger(dominant?.index) || dominant.index < 0 || dominant.index >= count || dominant.weight < minimumWeight) continue;
        const offset = dominant.index * 16;
        // Keep the neighboring dabs of the picked surface, within its Gaussian support.
        const support = 3 * Math.sqrt(world.data[offset+4] + world.data[offset+8] + world.data[offset+10]);
        for (const hit of contributions) {
          if (!Number.isInteger(hit.index) || hit.index < 0 || hit.index >= count || hit.weight < minimumWeight ||
              Math.abs(hit.distance - dominant.distance) > support) continue;
          picked.add(hit.index);
        }
      }
    }
    let previous;
    for (const [u, v] of points) {
      const x = Math.min(width + radius + 1, Math.max(-radius - 1, u * width));
      const y = Math.min(height + radius + 1, Math.max(-radius - 1, v * height));
      const steps = previous ? Math.max(1, Math.ceil(Math.hypot(x - previous[0], y - previous[1]) / spacing)) : 1;
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        dab(previous ? previous[0] + (x - previous[0]) * t : x,
          previous ? previous[1] + (y - previous[1]) * t : y);
      }
      previous = [x, y];
    }
    return picked;
  };
}

const maskSnapshot = (count, marked) =>
  Object.freeze({ count, indices: Object.freeze([...marked].sort((a, b) => a - b)) });

export function createSplatMaskPainter(renderer, world, grid) {
  const pick = createStrokePicker(renderer, world, grid), count = world.gaussianHarmonics.count;
  const marked = new Set(), history = [];
  let snapshot = maskSnapshot(count, marked);
  function publish() {
    snapshot = maskSnapshot(count, marked);
    return snapshot;
  }

  function stroke(points, frame, { radius = 8, erase = false } = {}) {
    const changed = new Set([...pick(points, frame, radius)].filter(index => marked.has(index) === erase));
    if (!changed.size) return snapshot;
    for (const index of changed) if (erase) marked.delete(index); else marked.add(index);
    history.push({ indices: changed, erase });
    return publish();
  }

  return Object.freeze({
    stroke,
    get mask() { return snapshot; },
    get canUndo() { return history.length > 0; },
    undo() {
      const last = history.pop();
      if (!last) return snapshot;
      for (const index of last.indices) if (last.erase) marked.add(index); else marked.delete(index);
      return publish();
    },
    clear() {
      if (!marked.size) return snapshot;
      history.push({ indices: new Set(marked), erase: true });
      marked.clear();
      return publish();
    }
  });
}


// Paint discrete material membership with the same surface picker as a mask.
export function createGaussianMaterialPainter(renderer, world, grid, { slots = 3, masks = [] } = {}) {
  const pick = createStrokePicker(renderer, world, grid), count = world.gaussianHarmonics.count;
  if (!Number.isInteger(slots) || slots < 1 || slots > maxGaussianMaterials || !Array.isArray(masks) || masks.length > slots)
    throw new RangeError('Choose 1–' + maxGaussianMaterials + ' material brush slots');
  const owner = new Uint8Array(count), marked = Array.from({ length: slots }, () => new Set()), history = [];
  for (const [slot, mask] of masks.entries()) visitGaussianMask(mask, count, index => {
    if (owner[index]) throw new RangeError('Initial material masks must be non-overlapping');
    owner[index] = slot + 1;
    marked[slot].add(index);
  });
  let snapshot = Object.freeze(marked.map(set => maskSnapshot(count, set)));
  function assign(index, next, dirty) {
    const previous = owner[index];
    if (previous) {
      marked[previous - 1].delete(index);
      dirty.add(previous - 1);
    }
    owner[index] = next;
    if (next) {
      marked[next - 1].add(index);
      dirty.add(next - 1);
    }
  }
  function publish(dirty) {
    if (dirty.size) snapshot = Object.freeze(snapshot.map((mask, slot) =>
      dirty.has(slot) ? maskSnapshot(count, marked[slot]) : mask));
    return snapshot;
  }
  function slotCode(slot) {
    if (!Number.isInteger(slot) || slot < 0 || slot >= slots)
      throw new RangeError('Choose an existing material brush slot');
    return slot + 1;
  }
  function commit(indices, code, erase) {
    const changed = new Map(), dirty = new Set();
    for (const index of indices) {
      const previous = owner[index];
      if (erase ? previous !== code : previous === code) continue;
      changed.set(index, previous);
      assign(index, erase ? 0 : code, dirty);
    }
    if (changed.size) history.push(changed);
    return publish(dirty);
  }
  return Object.freeze({
    get masks() { return snapshot; },
    get canUndo() { return history.length > 0; },
    stroke(slot, points, frame, { radius = 8, erase = false } = {}) {
      const code = slotCode(slot);
      return commit(pick(points, frame, radius), code, erase);
    },
    clear(slot) {
      const code = slotCode(slot);
      return commit(marked[slot], code, true);
    },
    undo() {
      const dirty = new Set(), changed = history.pop();
      if (changed) for (const [index, previous] of changed) assign(index, previous, dirty);
      return publish(dirty);
    }
  });
}
