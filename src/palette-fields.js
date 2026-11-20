/* Scoped, dependency-free palette fields for textures and material samplers. */
const PaletteFields = (() => {
  const pixels = typeof PixelLook === 'undefined' ? require('./pixel-look.js') : PixelLook;
  const fraction = n => Number.isFinite(n) && n >= 0 && n <= 1;
  const coord = n => Math.max(0, Math.min(1, n));
  const wrap = n => n - Math.floor(n);
  const record = value => value && Object.getPrototypeOf(value) === Object.prototype;
  const channel = (offset, hue, saturation, value) => {
    const k = (offset + hue) % 6;
    return value * (1 - saturation * Math.max(0, Math.min(k, 4 - k, 1)));
  };

  function swatch(value) {
    if (typeof value === 'string' && /^#[\da-f]{6}$/i.test(value)) {
      const packed = parseInt(value.slice(1), 16);
      return [packed >> 16, packed >> 8 & 255, packed & 255].map(n => n / 255);
    }
    return value;
  }

  const pair = values => Array.isArray(values) && values.length === 2 && Array.from(values).every(Number.isFinite);
  function hueBrightness(definition, resolveColor = swatch) {
    if (!record(definition) || Object.keys(definition).some(key => !['palette', 'hue', 'brightness', 'saturation'].includes(key)))
      throw new TypeError('A hue–brightness field needs a palette and optional hue, brightness and saturation');
    const { palette, hue = [0, 1], brightness = [0, 1], saturation = 1 } = definition;
    if (!pair(hue) || hue[1] <= hue[0] || hue[1] - hue[0] > 1 ||
        !pair(brightness) || !brightness.every(fraction) || brightness[0] > brightness[1] || !fraction(saturation))
      throw new RangeError('Use an increasing hue range up to one turn, ordered brightness in [0, 1], and saturation in [0, 1]');
    const startHue = wrap(hue[0]), hueSpan = hue[1] - hue[0], [dark, light] = brightness;
    return field(palette, resolveColor, match => (u, v) =>
      match(startHue + hueSpan * coord(u), saturation, dark + (light - dark) * coord(v)));
  }

  function polar(definition, resolveColor = swatch) {
    if (!record(definition) || Object.keys(definition).some(key =>
      !['palette', 'radial', 'range', 'rotation', 'brightness', 'saturation'].includes(key)))
      throw new TypeError('A polar field needs a palette and optional radial, range, rotation, brightness or saturation');
    const { palette, radial = 'brightness', range = [0, 1], rotation = 0, brightness, saturation } = definition;
    if (!['brightness', 'saturation'].includes(radial) || !pair(range) || !range.every(fraction) || !Number.isFinite(rotation))
      throw new RangeError('Use a brightness or saturation radius, radial endpoints in [0, 1], and a finite rotation in turns');
    const byBrightness = radial === 'brightness', supplied = byBrightness ? saturation : brightness;
    const fixed = supplied === undefined ? 1 : supplied;
    if ((byBrightness ? brightness : saturation) !== undefined || !fraction(fixed))
      throw new RangeError('Set only the fixed axis in [0, 1]. Use range to control the radial axis');
    const startHue = wrap(rotation), [inner, outer] = range;
    return field(palette, resolveColor, match => (u, v) => {
      const x = u * 2 - 1, y = v * 2 - 1, radius = Math.hypot(x, y);
      if (radius > 1) return -1;
      const hue = startHue + Math.atan2(y, x) / (2 * Math.PI);
      const value = inner + (outer - inner) * radius;
      return byBrightness ? match(hue, fixed, value) : match(hue, value, fixed);
    }, true);
  }

  function field(palette, resolveColor, sampler, disk = false) {
    if (!Array.isArray(palette) || !palette.length || palette.length > 48)
      throw new RangeError('A palette field needs 1–48 palette swatches');
    const swatches = Object.freeze(Array.from(palette, value => {
      if (value === undefined) throw new TypeError('Invalid palette field swatch');
      const rgb = resolveColor(value);
      if (!Array.isArray(rgb) || rgb.length !== 3 || !Array.from(rgb).every(fraction))
        throw new TypeError('Palette fields require hex colors or normalized RGB swatches');
      return Object.freeze(rgb.slice());
    }));
    const rgb = [0, 0, 0];
    const pick = sampler((hue, saturation, value) => {
      const h = wrap(hue) * 6;
      rgb[0] = channel(5, h, saturation, value);
      rgb[1] = channel(3, h, saturation, value);
      rgb[2] = channel(1, h, saturation, value);
      return pixels.nearest(rgb, swatches);
    });
    function index(u, v) {
      if (!Number.isFinite(u) || !Number.isFinite(v)) throw new TypeError('Palette field coordinates must be finite');
      return pick(u, v);
    }
    function sample(u, v, out = [0, 0, 0]) {
      const slot = index(u, v);
      if (slot < 0) return null;
      const swatch = swatches[slot];
      for (let k = 0; k < 3; k++) out[k] = swatch[k];
      return out;
    }
    function raster(w, h) {
      if (!Number.isSafeInteger(w) || !Number.isSafeInteger(h) || Math.min(w, h) < 1 || w * h > 2 ** 20)
        throw new RangeError('Palette field raster needs positive integer dimensions and at most 1,048,576 pixels');
      const count = w * h, rgb = new Uint8Array(count * 3);
      const indices = disk ? new Int16Array(count) : new Uint8Array(count);
      const alpha = disk ? new Uint8Array(count) : undefined;
      const bytes = swatches.map(color => color.map(value => Math.round(value * 255)));
      const diameter = Math.min(w, h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const p = y * w + x;
        const slot = indices[p] = disk ? pick(.5 + (x + .5 - w / 2) / diameter, .5 + (h / 2 - y - .5) / diameter) :
          pick((x + .5) / w, 1 - (y + .5) / h);
        if (slot < 0) continue;
        rgb.set(bytes[slot], p * 3);
        if (alpha) alpha[p] = 255;
      }
      return { w, h, rgb, indices, palette: swatches, ...(alpha && { alpha }) };
    }
    return Object.freeze({ palette: swatches, index, sample, raster });
  }

  return Object.freeze({ hueBrightness, polar });
})();
if (typeof module !== 'undefined') module.exports = PaletteFields;
