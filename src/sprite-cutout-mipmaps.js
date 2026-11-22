/* Area-preserving hard cutouts, reduced one registered atlas view at a time. */
const SpriteCutoutMipmaps = (() => {
  const pixelLimit = 262144;
  const cacheLimit = 24 * 1024 * 1024;
  const keys = new WeakMap(), cache = new Map();
  let bytes = 0;

  function prepare(value) {
    if (value === undefined || value === false) return null;
    const settings = value === true ? {} : value;
    if (!settings || Object.getPrototypeOf(settings) !== Object.prototype ||
        Object.keys(settings).some(key => key !== 'mode' && key !== 'cutoff'))
      throw new TypeError('Cutout mipmaps need a mode and alpha cutoff');
    const { mode = 'coverage', cutoff = .5 } = settings;
    if (!['coverage', 'average'].includes(mode) || !Number.isFinite(cutoff) || cutoff <= 0 || cutoff > 1)
      throw new RangeError('Cutout mipmaps need coverage or average and a cutoff in (0, 1]');
    return Object.freeze({ mode, cutoff });
  }

  function maxLevel(view) {
    return Math.floor(Math.log2(Math.max(view.rect.width, view.rect.height)));
  }

  function level(view, pixelsPerTexel) {
    if (!(pixelsPerTexel > 0) || pixelsPerTexel >= 1) return 0;
    return Math.min(maxLevel(view), Math.floor(.5 - Math.log2(pixelsPerTexel)));
  }

  function cached(view, index, build) {
    let ids = keys.get(view);
    if (!ids) keys.set(view, (ids = []));
    const key = ids[index] ??= {};
    let image = cache.get(key);
    if (image) {
      cache.delete(key);
      cache.set(key, image);
      return image;
    }
    image = build();
    while (bytes + image.values.byteLength > cacheLimit && cache.size) {
      const [oldest, previous] = cache.entries().next().value;
      bytes -= previous.values.byteLength;
      cache.delete(oldest);
    }
    cache.set(key, image);
    bytes += image.values.byteLength;
    return image;
  }

  function firstLevel(view, sample, cutoff) {
    const { width, height } = view.rect, pixels = width * height;
    const values = new Float32Array(pixels * 12);
    const channels = { depth: true, emission: true };
    const texel = { color: [0, 0, 0], normal: [0, 0, 0], emission: [0, 0, 0] };
    let covered = 0;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      if (!sample(view, x, y, channels, texel) || texel.alpha < cutoff) continue;
      const at = (y * width + x) * 4;
      values.set(texel.color, at);
      values[at + 3] = 1;
      if (texel.hasNormal) values.set(texel.normal, pixels * 4 + at);
      values[pixels * 4 + at + 3] = texel.depth;
      if (texel.hasEmission) {
        values.set(texel.emission, pixels * 8 + at);
        values[pixels * 8 + at + 3] = 1;
      }
      covered++;
    }
    return { width, height, covered, values };
  }

  // Resolve equal coverage in Bayer order across the whole level. This keeps
  // a repeated thin pattern from collapsing into the first few rows.
  function spatialRank(x, y, size) {
    let rank = 0;
    for (let step = 1; step < size; step <<= 1)
      rank = rank * 4 + (((x ^ y) & step) ? 2 : 0) + ((y & step) ? 1 : 0);
    return rank;
  }

  function reduce(base, index, { mode, cutoff }) {
    const sw = base.width, sh = base.height, sourcePixels = sw * sh;
    const width = Math.max(1, sw >> index), height = Math.max(1, sh >> index), pixels = width * height;
    const values = new Float32Array(pixels * 12), chosen = new Int32Array(pixels).fill(-1);
    const scores = new Uint16Array(pixels), ranks = new Uint32Array(pixels), candidates = [];
    const stepX = sw / width, stepY = sh / height, footprint = stepX * stepY;
    const rankSize = Math.max(width, height);
    let covered = 0;
    // Always filter the original mask. Quantization at one level must not
    // feed into the next, including when an odd dimension shrinks to one.
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const left = x * stepX, right = (x + 1) * stepX, top = y * stepY, bottom = (y + 1) * stepY;
      const cx = (left + right) / 2, cy = (top + bottom) / 2;
      let area = 0, best = -1, bestDistance = Infinity, bestDepth = Infinity;
      for (let sy = Math.floor(top); sy < Math.min(sh, Math.ceil(bottom)); sy++) {
        const vertical = Math.min(bottom, sy + 1) - Math.max(top, sy);
        for (let sx = Math.floor(left); sx < Math.min(sw, Math.ceil(right)); sx++) {
          const source = (sy * sw + sx) * 4;
          if (!base.values[source + 3]) continue;
          const horizontal = Math.min(right, sx + 1) - Math.max(left, sx);
          const weight = vertical * horizontal;
          if (weight <= 1e-10) continue;
          area += weight;
          const distance = (sx + .5 - cx) ** 2 + (sy + .5 - cy) ** 2;
          const depth = base.values[sourcePixels * 4 + source + 3];
          if (distance < bestDistance || distance === bestDistance && depth < bestDepth) {
            best = source;
            bestDistance = distance;
            bestDepth = depth;
          }
        }
      }
      if (best < 0) continue;
      const coverage = area / footprint, pixel = y * width + x;
      if (mode === 'average' && coverage + 1e-10 < cutoff) continue;
      chosen[pixel] = best;
      if (mode === 'coverage') {
        scores[pixel] = Math.round(coverage * 65535);
        ranks[pixel] = spatialRank(x, y, rankSize);
      }
      candidates.push(pixel);
    }

    if (mode === 'coverage') candidates.sort((a, b) => scores[b] - scores[a] || ranks[a] - ranks[b]);
    const target = mode === 'coverage' ? Math.min(candidates.length, Math.round(base.covered * pixels / sourcePixels)) : candidates.length;
    for (let i = 0; i < target; i++) {
      const pixel = candidates[i];
      const from = chosen[pixel], to = pixel * 4;
      for (let channel = 0; channel < 3; channel++) {
        const at = from + channel * sourcePixels * 4;
        values.set(base.values.subarray(at, at + 4), to + channel * pixels * 4);
      }
      covered++;
    }
    return { width, height, covered, values };
  }

  function image(view, sample, settings, index) {
    return cached(view, index, () => index === 0 ? firstLevel(view, sample, settings.cutoff) :
      reduce(image(view, sample, settings, 0), index, settings));
  }

  function sample(view, image, x, y, channels, out) {
    if (!(x >= 0 && y >= 0 && x < view.rect.width && y < view.rect.height)) return false;
    const { width, height, values } = image, lane = width * height * 4;
    const at = (Math.floor(y * height / view.rect.height) * width + Math.floor(x * width / view.rect.width)) * 4;
    if (!values[at + 3]) return false;
    out.alpha = 1;
    out.depth = channels.depth ? values[lane + at + 3] : 0;
    out.hasNormal = Boolean(values[lane + at] || values[lane + at + 1] || values[lane + at + 2]);
    out.hasEmission = Boolean(channels.emission && values[2 * lane + at + 3]);
    for (let c = 0; c < 3; c++) {
      out.color[c] = values[at + c];
      out.normal[c] = values[lane + at + c];
      out.emission[c] = out.hasEmission ? values[2 * lane + at + c] : 0;
    }
    return true;
  }

  return Object.freeze({ prepare, level, maxLevel, pixelLimit, image, sample });
})();
if (typeof module !== 'undefined') module.exports = SpriteCutoutMipmaps;
