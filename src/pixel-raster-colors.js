/* Keep the editable index plane independent of straight RGBA display bytes. */
const PixelRasterColors = (() => {
  const limit = 255;
  const metadataLimit = pixels => pixels*14+8_388_608;
  const paletteTools = () => typeof module !== 'undefined' ? require('./pixel-palette.js') :
    globalThis[Symbol.for('ink-studio.pixel-palette')];
  const byte = n => Number.isInteger(n) && n >= 0 && n <= 255;
  const hex = n => '#' + n.toString(16).padStart(6,'0');
  const rgb = color => typeof color === 'string' && /^#[a-f\d]{6}$/i.test(color);
  const id = value => typeof value === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(value);
  const rgbaPixel = value => Array.isArray(value) && value.length === 4 && Array.from(value).every(byte);
  const fromBytes = (r,g,b) => hex(r*65536+g*256+b);
  const bytes = color => [1,3,5].map(i=>Number.parseInt(color.slice(i,i+2),16));

  function swatchIds(palette,ids) {
    if (ids === undefined) return palette.map((_,slot)=>'slot-'+slot);
    if (!Array.isArray(ids) || ids.length !== palette.length || !Array.from(ids).every(id) ||
        new Set(ids).size !== ids.length)
      throw new TypeError('Swatch IDs must be unique and match the palette order');
    return ids;
  }

  function uniqueId(ids,stem) {
    let key = stem, suffix = 2;
    while (ids.has(key)) key = stem+'-'+suffix++;
    return key;
  }

  // Preserve a pixel's current swatch when RGBA changes only its opacity.
  function paletteEditor(entries,max = limit) {
    const palette = entries.slice(), byId = new Map(), byColor = new Map();
    function index({ id,color },slot) {
      byId.set(id,slot);
      const key = color.toLowerCase();
      if (!byColor.has(key)) byColor.set(key,slot);
    }
    palette.forEach(index);
    function resolve(color,swatch,prefer) {
      if (!rgb(color) || swatch !== undefined && !id(swatch)) throw new TypeError('Invalid RGB swatch');
      color = color.toLowerCase();
      const preferred = swatch === undefined ? prefer : byId.get(swatch);
      if (palette[preferred]?.color.toLowerCase() === color) return preferred;
      if (swatch !== undefined && preferred !== undefined) throw new RangeError('RGBA does not match swatch '+swatch);
      if (swatch === undefined && byColor.has(color)) return byColor.get(color);
      if (palette.length >= max) throw new RangeError('Exact color editing needs at most '+max+' swatches');
      const entry = { id:swatch ?? uniqueId(byId,'rgb-'+color.slice(1)),color };
      const slot = palette.push(entry)-1;
      index(entry,slot);
      return slot;
    }
    return { palette,resolve };
  }

  function normalize({ width,height,palette,swatchIds:ids,slots,alpha,knockouts,swatchLabels,lockedSwatches,ramps }) {
    if (![width,height].every(n=>Number.isInteger(n) && n >= 1 && n <= 512) ||
        !Array.isArray(palette) || !palette.length || palette.length > width*height+limit ||
        !Array.from(palette).every(rgb) || !Array.isArray(slots) || slots.length !== width*height ||
        !Array.from(slots).every(slot=>slot === null || Number.isInteger(slot) && slot >= 0 && slot < palette.length) ||
        (alpha !== undefined && (!Array.isArray(alpha) || alpha.length !== slots.length || !Array.from(alpha).every(byte))))
      throw new TypeError('Expected native indexed pixels, RGB swatches and optional alpha bytes');
    if (knockouts !== undefined && (!Array.isArray(knockouts) ||
        !Array.from(knockouts).every((p,i)=>slots[p] === null && Number.isInteger(p) && (i === 0 || p > knockouts[i-1]))))
      throw new TypeError('Knockouts must be sorted locations of transparent pixels');
    ids = swatchIds(palette,ids);
    let metadata;
    if (swatchLabels !== undefined || lockedSwatches !== undefined || ramps !== undefined) {
      const tools = paletteTools();
      metadata = tools.stampMetadata(tools.fromStamp(
        { palette,swatchIds:ids,swatchLabels,lockedSwatches,ramps },{ max:width*height+limit }));
    }
    return { width,height,palette,swatchIds:ids,slots,alpha,knockouts,metadata };
  }

  function straight({ palette,slots,alpha }) {
    const colors = palette.map(bytes), out = new Uint8Array(slots.length*4);
    for (let p = 0; p < slots.length; p++) {
      const slot = slots[p];
      if (slot === null) continue;
      const i = p*4;
      out.set(colors[slot],i);
      out[i+3] = alpha?.[p] ?? 255;
    }
    return out;
  }

  // PNG attaches alpha to palette entries. Keep each native index as the first
  // entry for that swatch and allocate extra entries for further alpha values.
  function indexed({ palette,slots,alpha }) {
    if (palette.length > 256) return;
    const colors = palette.map(bytes), coverage = Array(palette.length).fill(255);
    const primary = new Int16Array(palette.length).fill(-1), variants = new Map();
    const pixels = new Uint8Array(slots.length);
    let hole;
    for (let p = 0; p < slots.length; p++) {
      const slot = slots[p], value = alpha?.[p] ?? 255;
      if (slot === null) {
        if (hole === undefined) {
          if (colors.length === 256) return;
          hole = colors.length;
          colors.push([0,0,0]);
          coverage.push(0);
        }
        pixels[p] = hole;
      } else if (primary[slot] < 0 || primary[slot] === value) {
        coverage[slot] = primary[slot] = value;
        pixels[p] = slot;
      } else {
        const key = slot*256+value;
        if (!variants.has(key)) {
          if (colors.length === 256) return;
          variants.set(key,colors.length);
          colors.push(colors[slot]);
          coverage.push(value);
        }
        pixels[p] = variants.get(key);
      }
    }
    return { pixels,colors:Uint8Array.from(colors.flat()),
      alpha:coverage.some(a=>a !== 255) ? Uint8Array.from(coverage) : undefined };
  }

  function encode(raster,colorMode = 'auto') {
    if (!['auto','indexed','rgba'].includes(colorMode)) throw new TypeError('Choose auto, indexed, or rgba PNG color mode');
    const paint = normalize(raster), { width,height,palette,swatchIds:ids,slots,knockouts,metadata } = paint;
    const png = colorMode === 'rgba' ? undefined : indexed(paint);
    if (colorMode === 'indexed' && !png) throw new RangeError('An exact indexed PNG needs at most 256 color/alpha entries');
    const ink = new TextEncoder().encode(JSON.stringify({ version:1,palette,swatchIds:ids,slots,knockouts,...metadata }));
    if (ink.length > metadataLimit(slots.length)) throw new RangeError('Ink PNG palette metadata exceeds the export budget');
    return png ? { width,height,...png,channels:1,ink } :
      { width,height,pixels:straight(paint),channels:4,ink };
  }

  function decode(source) {
    const width = source.w ?? source.value.width, height = source.h ?? source.value.height;
    const count = width*height;
    const pngPalette = source.palette?.map(hex);
    const scale = pngPalette ? 1 : 255/source.max;
    const sample = pngPalette ? p=>[pngPalette[source.value.data[p]],source.alpha.data[p]] :
      p=>[fromBytes(source.data[p*4]*scale,source.data[p*4+1]*scale,source.data[p*4+2]*scale),source.data[p*4+3]*scale];
    let palette, ids, slots, alpha, knockouts, metadata;
    if (source.ink) {
      // Check that the editable metadata still describes the actual PNG samples.
      const record = JSON.parse(new TextDecoder('utf-8',{ fatal:true }).decode(source.ink));
      if (record?.version !== 1) throw new TypeError('Unsupported Ink PNG palette metadata');
      ({ palette,slots,swatchIds:ids,knockouts,metadata } = normalize({ ...record,width,height }));
      if (palette.length > limit) throw new RangeError('Exact color editing needs at most '+limit+' swatches');
      alpha = slots.map((slot,p)=>{
        const [color,value] = sample(p);
        if (slot === null ? (color !== '#000000' || value !== 0) : color !== palette[slot].toLowerCase())
          throw new Error('Ink PNG palette metadata does not match its pixels');
        return slot === null ? 255 : value;
      });
      if (pngPalette && !indexed({ palette,slots,alpha })?.pixels.every((slot,p)=>slot === source.value.data[p]))
        throw new Error('Ink PNG palette metadata does not match its indices');
    } else if (pngPalette) {
      if (pngPalette.length > limit) throw new RangeError('Exact color editing needs at most '+limit+' swatches');
      palette = pngPalette;
      slots = Array.from(source.value.data);
      alpha = Array.from(source.alpha.data);
    } else {
      const editor = paletteEditor([]);
      alpha = Array(count).fill(255);
      slots = Array.from({ length:count },(_,p)=>{
        const [color,value] = sample(p);
        if (color === '#000000' && value === 0) return null;
        alpha[p] = value;
        return editor.resolve(color);
      });
      palette = editor.palette.map(row=>row.color);
      ids = editor.palette.map(row=>row.id);
      if (!palette.length) { palette.push('#000000'); ids.push('rgb-000000'); }
    }
    return { width,height,origin:'top-left',palette,swatchIds:swatchIds(palette,ids),slots,...metadata,
      ...(alpha.some(value=>value !== 255) && { alpha }),...(knockouts?.length && { knockouts }) };
  }

  return Object.freeze({ limit,metadataLimit,rgbaPixel,fromBytes,swatchIds,uniqueId,paletteEditor,encode,decode });
})();
if (typeof module !== 'undefined') module.exports = PixelRasterColors;
else globalThis[Symbol.for('ink-studio.pixel-raster-colors')] = PixelRasterColors;
