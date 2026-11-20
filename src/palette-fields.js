/* Scoped, dependency-free palette fields for textures and material samplers. */
const PaletteFields = (() => {
  let pixels, spaces;
  try {
    pixels = PixelLook;
    spaces = ColorSpace;
  } catch {
    pixels = require('./pixel-look.js');
    spaces = require('./color-space.js');
  }
  const rgbScale = pixels.rgbWeights.map(Math.sqrt), identity = [1, 1, 1];
  const diagnosticRamp = ['#162135','#334f77','#597fa6','#65b4b4','#a3d5ae','#f1dc8e','#f59b65','#ed6258'];
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

  function vector(values, length) {
    return Array.isArray(values) && values.length === length && Array.from(values).every(Number.isFinite);
  }
  const pair = values => vector(values, 2);
  const dot = (a, b) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
  const minus = (a, b) => a.map((value, i) => value - b[i]);
  const rgbaBytes = palette => palette.map(color => color.map(value => Math.round(value * 255)));
  function rasterSize(w, h) {
    if (!Number.isSafeInteger(w) || !Number.isSafeInteger(h) || Math.min(w, h) < 1 || w * h > 2 ** 20)
      throw new RangeError('Palette field raster needs positive integer dimensions and at most 1,048,576 pixels');
  }
  function checkCoordinates(u, v) {
    if (!Number.isFinite(u) || !Number.isFinite(v)) throw new TypeError('Palette field coordinates must be finite');
  }
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

  function readSwatches(palette, resolveColor) {
    if (!Array.isArray(palette) || !palette.length || palette.length > 48)
      throw new RangeError('A palette field needs 1–48 palette swatches');
    return Object.freeze(Array.from(palette, value => {
      if (value === undefined) throw new TypeError('Invalid palette field swatch');
      const rgb = resolveColor(value);
      if (!Array.isArray(rgb) || rgb.length !== 3 || !Array.from(rgb).every(fraction))
        throw new TypeError('Palette fields require hex colors or normalized RGB swatches');
      return Object.freeze(rgb.slice());
    }));
  }

  function field(palette, resolveColor, sampler, disk = false) {
    const swatches = readSwatches(palette, resolveColor);
    const rgb = [0, 0, 0];
    const pick = sampler((hue, saturation, value) => {
      const h = wrap(hue) * 6;
      rgb[0] = channel(5, h, saturation, value);
      rgb[1] = channel(3, h, saturation, value);
      rgb[2] = channel(1, h, saturation, value);
      return pixels.nearest(rgb, swatches);
    });
    function index(u, v) {
      checkCoordinates(u, v);
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
      rasterSize(w, h);
      const count = w * h, rgb = new Uint8Array(count * 3);
      const indices = disk ? new Int16Array(count) : new Uint8Array(count);
      const alpha = disk ? new Uint8Array(count) : undefined;
      const bytes = rgbaBytes(swatches);
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

  function coverage(definition, resolveColor = swatch) {
    if (!record(definition) || Object.keys(definition).some(key =>
      !['palette','space','slice','view','displayRange','ramp','edge'].includes(key)))
      throw new TypeError('A coverage field needs a palette and optional space, slice, view, display range, ramp or edge');
    const { palette, space = 'rgb', view = 'nearest', edge: lead } = definition;
    if (!['rgb','oklab'].includes(space) || !['nearest','error','boundary'].includes(view))
      throw new RangeError('Coverage fields use rgb or oklab and a nearest, error or boundary view');
    const displayRange = definition.displayRange ?? (view === 'boundary' ? [0,.09] : [0,.25]);
    if (!pair(displayRange) || displayRange[0] < 0 || displayRange[1] <= displayRange[0])
      throw new RangeError('Coverage display range must be finite, nonnegative and increasing');
    if (lead !== undefined && (!record(lead) || Object.keys(lead).some(key => !['width','color'].includes(key)) ||
        !Number.isFinite(lead.width) || lead.width <= 0 || lead.color === undefined))
      throw new TypeError('Coverage edge requires a positive width and a color');
    const edge = view === 'nearest' ? lead : undefined;
    const slice = definition.slice ?? (space === 'rgb'
      ? { origin:[0,0,.5], along:[1,0,0], across:[0,1,0] }
      : { origin:[.62,-.24,-.24], along:[0,.48,0], across:[0,0,.48] });
    if (!record(slice) || Object.keys(slice).some(key => !['origin','along','across'].includes(key)) ||
        ![slice.origin,slice.along,slice.across].every(row => vector(row,3) && row.every(n => Math.abs(n) <= 10)))
      throw new TypeError('Coverage slice needs bounded XYZ vectors for origin, along and across');
    const swatches = readSwatches(palette,resolveColor);
    const scale = space === 'rgb' ? rgbScale : identity;
    const metric = rgb => rgb.map((n,i) => n*scale[i]);
    const origin = metric(slice.origin), uAxis = metric(slice.along), vAxis = metric(slice.across);
    const uLength = Math.hypot(...uAxis), basisU = uAxis.map(n => n/uLength);
    const projection = dot(vAxis,basisU), vPerpendicular = vAxis.map((n,i) => n-projection*basisU[i]);
    const vLength = Math.hypot(...vPerpendicular), basisV = vPerpendicular.map(n => n/vLength);
    if (!(uLength > 1e-10 && vLength > 1e-10))
      throw new RangeError('Coverage slice axes must span a plane');
    const sites = swatches.map(value => space === 'oklab' ? spaces.toOKLab(value) : metric(value));
    // Each cell is the intersection of pairwise half-planes on this slice.
    const inverseNormals = sites.map(site => sites.map(other => {
      const delta = minus(other,site);
      const inPlane = Math.hypot(dot(delta,basisU),dot(delta,basisV));
      return inPlane > 1e-12*Math.hypot(...delta) ? .5/inPlane : 0;
    }));
    let outputPalette = swatches, edgeSlot;
    if (edge) {
      const [color] = readSwatches([edge.color],resolveColor);
      edgeSlot = swatches.findIndex(row => row.every((n,i) => n === color[i]));
      if (edgeSlot < 0) {
        if (swatches.length === 48) throw new RangeError('Coverage edge and swatches must fit in 48 output colors');
        edgeSlot = swatches.length;
        outputPalette = Object.freeze([...swatches,color]);
      }
    } else if (view !== 'nearest') {
      outputPalette = readSwatches(definition.ramp ?? diagnosticRamp, definition.ramp === undefined ? swatch : resolveColor);
      if (outputPalette.length < 2) throw new RangeError('A diagnostic ramp needs at least two colors');
    }
    const bytes = rgbaBytes(outputPalette), count = sites.length;
    const squared = new Float64Array(count);
    const [r0,g0,b0] = origin, [ur,ug,ub] = uAxis, [vr,vg,vb] = vAxis;
    function evaluate(u, v, boundaryNeeded) {
      const x = coord(u), y = coord(v);
      const a = r0 + ur*x + vr*y, b = g0 + ug*x + vg*y, c = b0 + ub*x + vb*y;
      let index = 0, best = Infinity;
      for (let i = 0; i < count; i++) {
        const [r,g,h] = sites[i];
        squared[i] = (a-r)**2 + (b-g)**2 + (c-h)**2;
        if (squared[i] < best) { best = squared[i]; index = i; }
      }
      let boundary = Infinity;
      if (boundaryNeeded) for (let i = 0; i < count; i++) {
        const inverse = inverseNormals[index][i];
        if (inverse) boundary = Math.min(boundary,(squared[i]-best)*inverse);
      }
      return { index, error:Math.sqrt(best), boundary };
    }
    const low = displayRange[0], span = displayRange[1]-low, bands = outputPalette.length-1;
    function outputSlot(row) {
      if (view === 'nearest') return edge && row.boundary <= edge.width ? edgeSlot : row.index;
      return Math.round(coord((row[view]-low)/span)*bands);
    }
    function measure(u,v) {
      checkCoordinates(u,v);
      return evaluate(u,v,true);
    }
    function index(u,v) {
      checkCoordinates(u,v);
      return evaluate(u,v,false).index;
    }
    function sample(u,v,out=[0,0,0]) {
      checkCoordinates(u,v);
      const color = outputPalette[outputSlot(evaluate(u,v,edge || view === 'boundary'))];
      for (let k=0;k<3;k++) out[k] = color[k];
      return out;
    }
    function raster(w,h) {
      rasterSize(w,h);
      const rgb = new Uint8Array(w*h*3), indices = new Uint8Array(w*h);
      const errors = new Float32Array(w*h), boundaries = new Float32Array(w*h);
      for (let y=0;y<h;y++) for (let x=0;x<w;x++) {
        const p = y*w+x, row = evaluate((x+.5)/w,1-(y+.5)/h,true);
        indices[p] = row.index;
        errors[p] = row.error;
        boundaries[p] = row.boundary;
        rgb.set(bytes[outputSlot(row)],p*3);
      }
      return {w,h,rgb,indices,errors,boundaries,palette:swatches,outputPalette};
    }
    return Object.freeze({palette:swatches,outputPalette,index,sample,measure,raster});
  }

  return Object.freeze({ hueBrightness, polar, coverage });
})();
if (typeof module !== 'undefined') module.exports = PaletteFields;
