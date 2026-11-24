/* Indexed art cels shared by projected paint, sprite atlases and the editor. */
const PixelStamps = (() => {
  const composite = typeof FrameComposite === 'undefined' ? require('./frame-composite.js') : FrameComposite;
  const cels = typeof SpriteCels === 'undefined' ? require('./sprite-cels.js') : SpriteCels;
  const atlases = typeof AtlasSprites === 'undefined' ? require('./atlas-sprites.js') : AtlasSprites;
  const presets = typeof PixelStampPresets === 'undefined' ? require('./pixel-stamp-presets.js') : PixelStampPresets;
  const guides = typeof PixelGuides === 'undefined' ? require('./pixel-guides.js') : PixelGuides;
  const ranges = typeof PixelPlaybackRanges === 'undefined' ? require('./pixel-playback-ranges.js') : PixelPlaybackRanges;
  const record = value => value && Object.getPrototypeOf(value) === Object.prototype;
  const index = value => Number.isSafeInteger(value) && value >= 0 && value < 0xfffffe;
  const colorString = value => typeof value === 'string' && /^#[a-f\d]{6}$/i.test(value);
  const colorValue = value => index(value) || typeof value === 'string' && value.trim() &&
    (!value.startsWith('#') || colorString(value)) ||
    Array.isArray(value) && value.length === 3 && Array.from(value).every(Number.isFinite);
  const maxCells = 2 ** 20;
  const rowSlots = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

  function paint(width, height, { slots, rows, strokes } = {}) {
    const cells = width * height;
    if (![width, height].every(n => Number.isSafeInteger(n) && n > 0) || cells > maxCells)
      throw new RangeError('Pixel stamp dimensions exceed the art-pixel budget');
    if (slots !== undefined && (!Array.isArray(slots) || slots.length !== cells ||
        !Array.from(slots).every(slot => slot === null || index(slot))))
      throw new TypeError('Pixel stamp slots need a palette index or null at every texel');
    if (rows !== undefined && (slots !== undefined || !Array.isArray(rows) || rows.length !== height ||
        !Array.from(rows).every(row => typeof row === 'string' && row.length === width && /^[.\da-z]+$/i.test(row))))
      throw new TypeError('Pixel stamp rows need one palette character or dot at every texel');
    const result = rows ? rows.flatMap(row => [...row].map(cell => cell === '.' ? null : rowSlots.indexOf(cell))) :
      slots ? slots.slice() : Array(cells).fill(null);
    if (strokes === undefined) return result;
    if (!Array.isArray(strokes) || strokes.length > 4096)
      throw new TypeError('Pixel stamp paint needs at most 4096 ordered strokes');
    if (!strokes.length) return result;
    const marks = Array.from(strokes, stroke => {
      if (!record(stroke) || !record(stroke.shape) || !(stroke.slot === null || index(stroke.slot)))
        throw new TypeError('Pixel stamp strokes need a shape and an integer palette slot or null');
      const value = stroke.slot === null ? 0 : stroke.slot + 1;
      return { ...stroke.shape, color: '#' + value.toString(16).padStart(6, '0') };
    });
    const map = composite.paintMap(width, height, marks, 32e6);
    for (let p = 0, i = 0; p < cells; p++, i += 4) {
      if (!map[i + 3]) continue;
      const value = (map[i] << 16) | (map[i + 1] << 8) | map[i + 2];
      result[p] = value ? value - 1 : null;
    }
    return result;
  }

  function prepare(spec,{ preserveHidden = false,tag } = {}) {
    if (!record(spec)) throw new TypeError('Pixel stamps need an indexed raster object');
    const { width, height, slots, rows, strokes, alpha, frames, fps = 12, playback = 'loop', phase = 0, palette } = spec;
    if (![width, height].every(n => Number.isSafeInteger(n) && n > 0) || width * height > maxCells ||
        (frames !== undefined && (!Array.isArray(frames) || !frames.length || frames.length > 2048 ||
          width * height * frames.length > maxCells || slots !== undefined || rows !== undefined || strokes !== undefined || alpha !== undefined)))
      throw new RangeError('Pixel stamp needs bounded dimensions and either a single cel or a frame list');
    if (frames === undefined && slots === undefined && rows === undefined && strokes === undefined)
      throw new TypeError('Pixel stamps need texels or paint strokes');
    if (!Number.isFinite(phase) || !Number.isFinite(fps) || fps <= 0 || !['once', 'loop'].includes(playback) ||
        (palette !== undefined && (!Array.isArray(palette) || !palette.length ||
          !Array.from(palette).every(colorValue))))
      throw new RangeError('Pixel stamp needs valid playback and palette swatches');
    const sharedGuides = guides.prepare(spec.guides);
    const entries = Array.from(frames ?? [{ slots, rows, strokes, alpha }], (entry, frame) => {
      if (!record(entry)) throw new TypeError('Pixel stamp frames need slots, strokes or an empty cel');
      const { duration = 1 / fps } = entry;
      if (!Number.isFinite(duration) || duration <= 0) throw new RangeError('Pixel stamp frames need positive durations');
      const texels = paint(width, height, entry);
      if (palette && texels.some(slot => slot !== null && slot >= palette.length))
        throw new RangeError('Pixel stamp slots must be valid palette indices within its palette');
      const opacity = entry.alpha;
      if (opacity !== undefined) {
        if (!Array.isArray(opacity) || opacity.length !== texels.length ||
            !Array.from(opacity).every(value => index(value) && value <= 255))
          throw new TypeError('Pixel stamp alpha needs one byte per texel');
        if (!preserveHidden) for (let p = 0; p < texels.length; p++)
          if (opacity[p] === 0) texels[p] = null;
      }
      const visibleGuides = entry.guides === undefined ? sharedGuides : guides.prepare([...sharedGuides,...guides.prepare(entry.guides)]);
      return { frame, duration, slots: texels, ...(opacity && { alpha:opacity.slice() }), ...(visibleGuides.length && { guides:visibleGuides }) };
    });
    const tags = ranges.resolve(frames ?? [{}],spec.tags);
    const range = tags.find(row=>row.id === tag);
    if (tag !== undefined && !range) throw new RangeError('Unknown pixel playback tag '+tag);
    const tagged = range && ranges.plan(entries.map(entry=>entry.duration),range);
    const clock = tagged?.at ?? cels.playback(entries, fps, playback);
    const duration = tagged?.duration ?? entries.reduce((sum, entry) => sum + entry.duration, 0);
    return { width, height, duration, entries, palette: palette?.slice(),...(range && { range }),
      at: time => clock((Number.isFinite(time) ? time : 0) + phase) };
  }

  function layout(spec) {
    const { width, height, size = [1, 1], wrap = false, origin = 'bottom-left' } = spec;
    if (!Array.isArray(size) || size.length !== 2 || !Array.from(size).every(value => Number.isFinite(value) && value > 0) ||
        typeof wrap !== 'boolean' || !['top-left', 'bottom-left'].includes(origin))
      throw new TypeError('Indexed rasters need a valid origin and a positive size');
    const [spanU, spanV] = size;
    return (u, v) => {
      u /= spanU;
      v /= spanV;
      if (!Number.isFinite(u) || !Number.isFinite(v) || (!wrap && (u < 0 || v < 0 || u >= 1 || v >= 1))) return -1;
      const x = Math.min(width - 1, Math.floor((u - Math.floor(u)) * width));
      const y = Math.min(height - 1, Math.floor((v - Math.floor(v)) * height));
      return (origin === 'top-left' ? height - 1 - y : y) * width + x;
    };
  }

  function paletteColor(value, scenePalette, roles) {
    const palette = () => typeof PixelLook === 'undefined' ? require('./pixel-look.js') : PixelLook;
    const color = colorString(value) ? Number.parseInt(value.slice(1), 16) : Array.isArray(value) ?
      value.reduce((packed, component) => packed * 256 + Math.round(255 * Math.min(1, Math.max(0, component))), 0) :
      typeof value === 'string' && roles ? palette().roleColor(value, scenePalette, roles) : scenePalette?.[value];
    if (!Number.isInteger(color) || color < 0 || color > 0xffffff)
      throw new RangeError('Pixel stamp needs a known scene palette index or a #rrggbb swatch');
    return color;
  }

  function raster(width, height, { slots,alpha }, palette, scenePalette, paletteRoles, emissive, colors = new Map()) {
    const length = width * height;
    const rgba = new Uint8Array(length * 4);
    const emission = emissive.size ? new Uint8Array(length * 4) : undefined;
    for (let i = 0; i < length; i++) {
      const slot = slots[i];
      if (slot === null) continue;
      if (!colors.has(slot)) colors.set(slot, paletteColor(palette?.[slot] ?? slot, scenePalette, paletteRoles));
      const packed = colors.get(slot), p = i * 4;
      rgba.set([packed >> 16, (packed >> 8) & 255, packed & 255, alpha?.[i] ?? 255], p);
      if (emissive.has(slot)) emission.set(rgba.subarray(p, p + 4), p);
    }
    return { rgba, emission };
  }

  function image(spec, { time = 0, scenePalette, paletteRoles, preserveHidden = false,tag } = {}) {
    const { width, height, entries, palette, at } = prepare(spec,{ preserveHidden,tag });
    const { rgba } = raster(width, height, entries[at(time)], palette, scenePalette, paletteRoles, new Set());
    return { width, height, rgba };
  }

  function buildAtlas({ width, height, entries, palette },
      { scenePalette, paletteRoles, pivot, pivotGuide, unitsPerPixel = 1, emissionSlots = [], yaw = 0, pitch = 0, keepSwatches = false } = {}) {
    if (!Array.isArray(emissionSlots) || !Array.from(emissionSlots).every(slot => index(slot) && (!palette || slot < palette.length)))
      throw new RangeError('Pixel stamp emission slots must be valid palette indices');
    if (typeof keepSwatches !== 'boolean') throw new TypeError('Pixel stamp keepSwatches needs a boolean');
    if (pivotGuide !== undefined && (pivot !== undefined || pivotGuide !== true &&
        (typeof pivotGuide !== 'string' || !pivotGuide.trim())))
      throw new TypeError('Use a sprite pivot or a pivot guide ID (or true for the sole pivot)');
    if (width > 8192 || height > 8192) throw new RangeError('Pixel stamp frames do not fit the atlas dimensions');
    const minColumns = Math.ceil(entries.length / Math.floor(8192 / height));
    const columns = Math.min(entries.length, Math.floor(8192 / width),
      Math.max(minColumns, Math.ceil(Math.sqrt(entries.length * height / width))));
    const w = width * columns, h = height * Math.ceil(entries.length / columns);
    if (w < 1 || h > 8192) throw new RangeError('Pixel stamp frames do not fit the atlas dimensions');
    const emissive = new Set(emissionSlots), known = new Map();
    const color = new Uint8Array(w * h * 4), emission = emissive.size ? new Uint8Array(color.length) : undefined;
    const frames = entries.map(({ frame, duration, slots, alpha, guides }) => {
      let anchor = pivot;
      if (pivotGuide !== undefined) {
        const options = guides?.filter(guide => guide.kind === 'pivot' && (pivotGuide === true || guide.id === pivotGuide)) ?? [];
        if (options.length !== 1) throw new RangeError('Expected one matching pivot guide on stamp frame ' + frame);
        const [x,y] = options[0].at;
        anchor = { x:x+.5,y:y+.5 };
      }
      const x = frame % columns * width, y = Math.floor(frame / columns) * height;
      const result = raster(width, height, { slots,alpha }, palette, scenePalette, paletteRoles, emissive, known);
      for (let row = 0; row < height; row++) {
        const from = row * width * 4, to = ((y + row) * w + x) * 4;
        color.set(result.rgba.subarray(from, from + width * 4), to);
        if (emission) emission.set(result.emission.subarray(from, from + width * 4), to);
      }
      return { frame, duration, rect: { x, y, width, height }, unitsPerPixel, pivot:anchor, yaw, pitch };
    });
    const outputPalette = keepSwatches && [...new Set(known.values())];
    return atlases.compile({ metadata: { width: w, height: h, frames, emissionMode: 'baked',
      ...(outputPalette?.length && {outputPalette}) },
      images: { color, ...(emission && { emission }) } });
  }

  function atlas(spec, options) {
    return buildAtlas(prepare(spec), options);
  }

  function cueClock(cue, duration) {
    if (!record(cue) || Object.keys(cue).some(key => !['start','period'].includes(key)))
      throw new TypeError('Pixel stamp cue needs a start and optional repeat period');
    const { start = 0, period } = cue;
    if (!Number.isFinite(start) || !Number.isFinite(start+duration) ||
        (period !== undefined && (!Number.isFinite(period) || period<=0 || period < duration-4*Number.EPSILON*Math.max(1,duration))))
      throw new RangeError('Pixel stamp cue needs a finite start and a period at least as long as its clip');
    const epsilon = Math.min(duration*1e-6,Math.max(1,duration,period??0)*4*Number.EPSILON);
    return time => {
      const elapsed = (Number.isFinite(time) ? time : 0) - start;
      if (!Number.isFinite(elapsed) || elapsed < -epsilon) return null;
      let age = Math.max(0,elapsed);
      if (period !== undefined) {
        age %= period;
        if (period-age<=epsilon) age=0;
      }
      return age < duration-epsilon ? age : null;
    };
  }

  function pixelTrack(keys) {
    if (!Array.isArray(keys) || !keys.length || keys.length>256)
      throw new TypeError('Pixel stamp offsets need 1 to 256 [seconds, x, y] keys');
    let last=-1;
    const points=Array.from(keys,key=>{
      if (!Array.isArray(key) || key.length!==3 || !Number.isFinite(key[0]) || key[0]<0 || key[0]<=last ||
          ![key[1],key[2]].every(value=>Number.isInteger(value)&&Math.abs(value)<=65536))
        throw new RangeError('Pixel stamp offsets need ascending times and integer pixel positions');
      last=key[0];
      return key.slice();
    });
    return time=>{
      let lo=0, hi=points.length;
      while (hi-lo>1) {
        const mid=(lo+hi)>>1;
        if (points[mid][0]<=time) lo=mid;
        else hi=mid;
      }
      const [start,x,y]=points[lo];
      if (time<=start || hi===points.length) return [x,y];
      const [end,u,v]=points[hi], f=(time-start)/(end-start);
      return [Math.round(x+(u-x)*f),Math.round(y+(v-y)*f)];
    };
  }

  function place(spec, { scenePalette, paletteRoles, pivot, pivotGuide, unitsPerPixel, emissionSlots, mode = 'card',
      pitch = 0, viewYaw = 0, phase = spec?.phase ?? 0,
      playback = spec?.playback ?? 'loop', tag, cue, offsets, keepSwatches, ...placement } = {}) {
    if (!Number.isFinite(phase)) throw new RangeError('Pixel stamp phase must be finite');
    const art = prepare(spec,{ tag });
    const age = cue === undefined ? null : cueClock(cue,art.duration);
    const offsetAt = offsets === undefined ? null : pixelTrack(offsets);
    const asset = buildAtlas(art, { scenePalette, paletteRoles, pivot, pivotGuide, unitsPerPixel, emissionSlots, yaw: viewYaw, pitch, keepSwatches });
    const clock = art.range ? ranges.plan(art.entries.map(entry=>entry.duration),art.range).at : asset.playback(playback);
    const loop = art.range?.loop ?? (playback !== 'once');
    const elapsed = time => age ? age(time) ?? 0 : Number.isFinite(time) ? time : 0;
    const trackTime = age || !loop ? elapsed : time => {
      const value=elapsed(time), wrapped=value%art.duration;
      return wrapped<0 ? wrapped+art.duration : wrapped;
    };
    return atlases.place({ ...placement, atlas: asset, mode, frame: time => clock(elapsed(time)+phase),
      ...(age&&{visibleAt:time=>age(time)!==null}),
      ...(offsetAt&&{pixelOffset:time=>offsetAt(trackTime(time))}) });
  }

  function placements(definitions, { scenePalette, paletteRoles } = {}) {
    if (!Array.isArray(definitions) || definitions.length > 128)
      throw new TypeError('Pixel stamps need a list of up to 128 placements');
    const expanded=[];
    for (const definition of definitions) {
      if (!record(definition) || (definition.stamp===undefined)===(definition.preset===undefined))
        throw new TypeError('Each pixel stamp placement needs an anchor and either art or a preset');
      if (definition.preset===undefined) expanded.push(definition);
      else {
        const {preset,...options}=definition;
        expanded.push(...presets.preset(preset,options));
      }
      if (expanded.length>128) throw new RangeError('Pixel stamp presets expand to more than 128 placements');
    }
    return expanded.map(({stamp,...options})=>place(stamp,{...options,scenePalette,paletteRoles}));
  }

  return Object.freeze({ paint, prepare, layout, image, atlas, place, placements,
    clip:presets.clip, preset:presets.preset, catalog:presets.list });
})();
if (typeof module !== 'undefined') module.exports = PixelStamps;
