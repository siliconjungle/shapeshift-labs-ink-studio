/* Indexed sprite and tile lighting on one shared art grid. Coordinates use Q4 and light energy uses Q8. */
const PixelLighting = (() => {
  const format = 'ink-studio/pixel-lighting';
  const maxSize = 512, maxLights = 8, maxRadius = 256, maxShadowSteps = 512;
  // Keep prepared handles interoperable between the Node modules and the bundled KIT.
  const packed = Symbol.for('ink-studio.pixel-lighting.prepared');
  const list = value => Array.isArray(value) || ArrayBuffer.isView(value) && !(value instanceof DataView);
  const bounded = (value, min, max) => Number.isFinite(value) && value >= min && value <= max;
  const integer = (value, min, max) => Number.isInteger(value) && bounded(value, min, max);
  const record = value => value && typeof value === 'object' && !list(value);
  const q4 = value => Math.round(value * 16);

  function height(value, name) {
    if (!bounded(value, 0, maxSize)) throw new RangeError(name + ' must be a height from 0 to ' + maxSize);
    return q4(value);
  }

  function ambientValue(value) {
    if (!bounded(value, 0, 1)) throw new RangeError('Pixel lighting ambient must be in [0, 1]');
    return Math.round(value * 256);
  }

  function lamps(values) {
    if (!Array.isArray(values) || values.length > maxLights)
      throw new RangeError('Pixel lighting supports up to ' + maxLights + ' point lights');
    const sources = new Int32Array(maxLights * 4);
    const settings = new Int32Array(maxLights * 2);
    for (const [i, light] of values.entries()) {
      const { at, radius, strength = 1, castsShadow = true } = light ?? {};
      if (!Array.isArray(at) || at.length !== 3 || !bounded(at[0], -maxSize, maxSize * 2) ||
          !bounded(at[1], -maxSize, maxSize * 2) || !bounded(at[2], 0, maxSize * 2) ||
          !bounded(radius, 1 / 16, maxRadius) || !bounded(strength, 0, 4) || typeof castsShadow !== 'boolean')
        throw new RangeError('Pixel light needs bounded XYZ, a radius of 1/16–256, strength of 0–4 and optional castsShadow');
      sources.set([q4(at[0]), q4(at[1]), q4(at[2]), q4(radius)], i * 4);
      settings.set([Math.round(strength * 256), Number(castsShadow)], i * 2);
    }
    return { sources, settings, count: values.length };
  }

  function palette(ramps) {
    if (!Array.isArray(ramps) || ramps.length < 1 || ramps.length > 256)
      throw new RangeError('Pixel lighting needs 1–256 palette ramps');
    const bands = ramps[0]?.length;
    if (!integer(bands, 2, 16)) throw new RangeError('Pixel lighting ramps need 2–16 swatches each');
    const colors = new Uint8Array(ramps.length * bands * 4);
    for (const [row, ramp] of ramps.entries()) {
      if (!Array.isArray(ramp) || ramp.length !== bands)
        throw new RangeError('Pixel lighting ramps must have the same number of swatches');
      for (const [band, swatch] of ramp.entries()) {
        if (typeof swatch !== 'string' || !/^#[0-9a-f]{6}$/i.test(swatch))
          throw new TypeError('Pixel lighting swatches must use #rrggbb');
        const rgb = Number.parseInt(swatch.slice(1), 16);
        colors.set([rgb >> 16, (rgb >> 8) & 255, rgb & 255, 255], (row * bands + band) * 4);
      }
    }
    return { colors, bands, rows: ramps.length };
  }

  function normal(x, y, z) {
    const length = Math.hypot(x, y, z);
    return length > 0 ? [x, y, z].map(n => Math.round(n * 64 / length)) : [0, 0, 64];
  }

  function asset(value, rows) {
    const { width: w, height: h, slots, heightMap, normalMap } = value ?? {};
    const size = w * h;
    if (!integer(w, 1, maxSize) || !integer(h, 1, maxSize) || !list(slots) || slots.length !== size)
      throw new RangeError('Pixel lighting assets need dimensions and one slot per pixel');
    if (heightMap !== undefined && (!list(heightMap) || heightMap.length !== size))
      throw new RangeError('A height map needs one height per art pixel');
    if (normalMap !== undefined && (!list(normalMap) || normalMap.length !== size * 3))
      throw new RangeError('A normal map needs three RGB bytes per art pixel');
    const indices = Uint16Array.from(slots, slot => {
      if (slot === null || slot === -1) return 0;
      if (!integer(slot, 0, rows - 1)) throw new RangeError('Pixel lighting asset references a missing palette ramp');
      return slot + 1;
    });
    const heights = heightMap ? Int16Array.from(heightMap, n => height(n, 'Pixel lighting asset height')) : new Int16Array(size);
    if (normalMap) for (const n of normalMap) {
      if (!integer(n, 0, 255)) throw new RangeError('Pixel lighting normal maps need RGB bytes');
    }
    const normals = new Int8Array(size * 4);
    const sample = (i, neighbor, valid) => valid && indices[neighbor] ? heights[neighbor] : heights[i];
    for (let i = 0; i < size; i++) {
      if (!indices[i]) continue;
      const x = i % w, y = Math.floor(i / w);
      if (normalMap) {
        // Midpoint byte 128 encodes a zero axis. +Y points up in the image.
        const j = i * 3;
        normals.set(normal(normalMap[j] - 128, normalMap[j + 1] - 128, normalMap[j + 2] - 128), i * 4);
      } else if (heightMap) {
        const dx = sample(i, i + 1, x + 1 < w) - sample(i, i - 1, x > 0);
        const dy = sample(i, i + w, y + 1 < h) - sample(i, i - w, y > 0);
        normals.set(normal(-dx, dy, 32), i * 4);
      } else normals[i * 4 + 2] = 64;
    }
    return { w, h, indices, heights, normals };
  }

  function prepare(spec) {
    if (spec?.[packed]) return spec;
    const { width: w, height: h, ramps, assets = {}, tiles = [], tileSize = 1, sprites = [],
      lights = [], ambient = .2, shadows = true } = spec ?? {};
    if (spec?.format !== format || spec.version !== 1)
      throw new TypeError('Expected ink-studio/pixel-lighting version 1');
    if (!integer(w, 1, maxSize) || !integer(h, 1, maxSize) || !integer(tileSize, 1, maxSize) ||
        !record(assets) || !Array.isArray(tiles) || !Array.isArray(sprites) || typeof shadows !== 'boolean')
      throw new RangeError('Pixel lighting needs a bounded art grid, assets, ordered tiles and sprites, and optional shadows');
    const swatches = palette(ramps);
    const surfaces = new Int16Array(w * h * 4);
    const normals = new Int8Array(w * h * 4);
    // R is ramp + 1, G is receiving height, B is the highest blocker, zero reserved for an empty R.
    for (let i = 2; i < surfaces.length; i += 4) surfaces[i] = -1;
    const atlas = new Map();
    let visits = 0, decoded = 0;
    function stamp(placement, cell) {
      const { asset: name, at, elevation = 0, shadowHeight = 0, castsShadow = true } = placement ?? {};
      if (typeof name !== 'string' || !Object.hasOwn(assets, name))
        throw new TypeError('Missing pixel lighting asset: ' + name);
      if (!Array.isArray(at) || at.length !== 2 || !integer(at[0], -maxSize, maxSize) ||
          !integer(at[1], -maxSize, maxSize) || typeof castsShadow !== 'boolean')
        throw new RangeError('Pixel lighting placement needs integer XY and optional castsShadow');
      const base = height(elevation, 'Pixel lighting elevation');
      const extrusion = height(shadowHeight, 'Pixel lighting shadowHeight');
      if (!atlas.has(name)) {
        const value = assets[name];
        decoded += value?.width * value?.height;
        if (decoded > 4 * maxSize * maxSize) throw new RangeError('Pixel lighting asset budget exceeded');
        atlas.set(name, asset(value, swatches.rows));
      }
      const image = atlas.get(name);
      if (cell && (image.w !== tileSize || image.h !== tileSize))
        throw new RangeError('Pixel lighting tile assets must match tileSize');
      const x = at[0] * (cell ? tileSize : 1), y = at[1] * (cell ? tileSize : 1);
      const startX = Math.max(0, x), endX = Math.min(w, x + image.w);
      const startY = Math.max(0, y), endY = Math.min(h, y + image.h);
      if (endX <= startX || endY <= startY) return;
      visits += (endX - startX) * (endY - startY);
      if (visits > 16 * maxSize * maxSize) throw new RangeError('Pixel lighting placement budget exceeded');
      for (let row = startY; row < endY; row++) for (let col = startX; col < endX; col++) {
        const i = (row - y) * image.w + col - x;
        if (!image.indices[i]) continue;
        const j = (row * w + col) * 4, k = i * 4;
        const top = base + image.heights[i];
        surfaces[j] = image.indices[i];
        surfaces[j + 1] = top;
        if (castsShadow) surfaces[j + 2] = Math.max(surfaces[j + 2], top + extrusion);
        normals[j] = image.normals[k];
        normals[j + 1] = image.normals[k + 1];
        normals[j + 2] = image.normals[k + 2];
      }
    }
    for (const tile of tiles) stamp(tile, true);
    for (const sprite of sprites) stamp(sprite, false);
    const result = Object.assign(Object.create(null), { w, h });
    Object.defineProperty(result, packed, { value:{
      w, h, surfaces, normals, ...swatches, lights:lamps(lights), ambient:ambientValue(ambient), shadows
    } });
    return Object.freeze(result);
  }

  function frame(spec, options = {}) {
    const scene = prepare(spec)[packed];
    const { lights, ambient, shadows = scene.shadows } = options;
    if (typeof shadows !== 'boolean') throw new TypeError('Pixel lighting shadows must be boolean');
    return { scene, shadows, lights: lights === undefined ? scene.lights : lamps(lights),
      ambient: ambient === undefined ? scene.ambient : ambientValue(ambient) };
  }

  function blocked(scene, x, y, z, dx, dy, dz) {
    const ax = Math.abs(dx), ay = Math.abs(dy);
    const stepX = Math.sign(dx), stepY = Math.sign(dy);
    let nextX = 8, nextY = 8;
    // Compare the rational times of the next grid boundaries. Corner ties enter the diagonal cell.
    for (let step = 0; step < maxShadowSteps; step++) {
      const tx = ax ? nextX * ay : Infinity, ty = ay ? nextY * ax : Infinity;
      if (tx === Infinity && ty === Infinity) return false;
      const numerator = tx <= ty ? nextX : nextY, denominator = tx <= ty ? ax : ay;
      if (numerator >= denominator) return false;
      if (tx <= ty) { x += stepX; nextX += 16; }
      if (ty <= tx) { y += stepY; nextY += 16; }
      if (x < 0 || y < 0 || x >= scene.w || y >= scene.h) return false;
      if (scene.surfaces[(y * scene.w + x) * 4 + 2] > z + Math.floor(dz * numerator / denominator) + 1)
        return true;
    }
    return false;
  }

  function render(spec, options) {
    const { scene, lights, ambient, shadows } = frame(spec, options);
    const { w, h, surfaces, normals, bands, colors } = scene;
    const { sources, settings, count } = lights;
    const rgba = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const p = (y * w + x) * 4, slot = surfaces[p];
      if (!slot) continue;
      const z = surfaces[p + 1];
      const nx = normals[p], ny = normals[p + 1], nz = normals[p + 2];
      let energy = ambient;
      for (let light = 0; light < count && energy < 256; light++) {
        const j = light * 4;
        const dx = sources[j] - (x * 16 + 8), dy = sources[j + 1] - (y * 16 + 8), dz = sources[j + 2] - z;
        const radius = sources[j + 3], strength = settings[light * 2];
        if (!strength || dz <= 0 || Math.max(Math.abs(dx), Math.abs(dy), dz) >= radius) continue;
        const distanceSquared = dx * dx + dy * dy + dz * dz;
        const dot = nx * dx - ny * dy + nz * dz;
        if (dot <= 0 || distanceSquared >= radius * radius) continue;
        const distance = Math.floor(Math.sqrt(distanceSquared));
        const facing = Math.min(256, Math.floor(dot * 4 / distance));
        const fade = Math.floor((radius - distance) * 256 / radius);
        const power = Math.floor(strength * facing * fade / 65536);
        if (power && (!shadows || !settings[light * 2 + 1] || !blocked(scene, x, y, z, dx, dy, dz))) energy += power;
      }
      const band = Math.floor((Math.min(energy, 256) * (bands - 1) + 128) / 256);
      const c = ((slot - 1) * bands + band) * 4;
      rgba[p] = colors[c]; rgba[p + 1] = colors[c + 1]; rgba[p + 2] = colors[c + 2]; rgba[p + 3] = 255;
    }
    return { w, h, rgba };
  }

  return Object.freeze({ format, maxLights, maxShadowSteps, prepare, frame, render });
})();

if (typeof module !== 'undefined') module.exports = PixelLighting;
