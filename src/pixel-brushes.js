/* Portable indexed brush tips and deterministic native-grid placement. */
const PixelBrushes = (() => {
  const tools = typeof PixelPaintTools === 'undefined' ? require('./pixel-paint-tools.js') : PixelPaintTools;
  const format = 'ink-studio/pixel-brush';
  const integer = (n,lo,hi) => Number.isSafeInteger(n) && n >= lo && n <= hi;
  const fields = (value,keys) => value && Object.getPrototypeOf(value) === Object.prototype &&
    Object.keys(value).every(key => keys.includes(key));
  const xy = (point,width,height) => Array.isArray(point) && point.length === 2 &&
    integer(point[0],0,width-1) && integer(point[1],0,height-1);
  const color = value => typeof value === 'string' && /^#[a-f\d]{6}$/i.test(value);
  const swatch = value => fields(value,['id','color']) && color(value.color) &&
    (value.id === undefined || typeof value.id === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(value.id));

  function validate(brush) {
    if (!fields(brush,['format','version','width','height','anchor','palette','slots','settings']) ||
        brush.format !== format || brush.version !== 1 ||
        !integer(brush.width,1,512) || !integer(brush.height,1,512) ||
        !xy(brush.anchor,brush.width,brush.height) || !Array.isArray(brush.palette) ||
        !integer(brush.palette.length,1,255) || !Array.from(brush.palette).every(swatch) ||
        !Array.isArray(brush.slots) || brush.slots.length !== brush.width*brush.height ||
        !Array.from(brush.slots).every(slot => slot === null || integer(slot,0,brush.palette.length-1)) ||
        !brush.slots.some(slot => slot !== null))
      throw new TypeError('A pixel brush needs a painted indexed shape and a native anchor');
    const { settings } = brush, tone = settings?.swatch;
    if (!fields(settings,['angle','size','swatch']) || !Number.isFinite(settings.angle) ||
        Math.abs(settings.angle) > 360000 || !Array.isArray(settings.size) || settings.size.length !== 2 ||
        !Array.from(settings.size).every(n => integer(n,1,512)) ||
        !fields(tone,['mode','id','color']) ||
        !(tone.mode === 'original' && Object.keys(tone).length === 1 ||
          tone.mode === 'tint' && swatch({ color:tone.color,id:tone.id })))
      throw new TypeError('A pixel brush needs a finite angle, a bounded size and original or tint swatch settings');
    return brush;
  }

  function capture({ width,height,read,pixels,rect,anchor,settings } = {}) {
    if (!integer(width,1,512) || !integer(height,1,512) || typeof read !== 'function' ||
        (pixels === undefined) === (rect === undefined))
      throw new TypeError('Capture a brush from a pixel list or a rectangle on a native canvas');
    let selected, left = width, right = 0, top = height, bottom = 0;
    if (rect !== undefined) {
      if (!Array.isArray(rect) || rect.length !== 4 || !xy(rect.slice(0,2),width,height) ||
          !integer(rect[2],1,width-rect[0]) || !integer(rect[3],1,height-rect[1]))
        throw new RangeError('Brush selection rectangle must be inside the canvas');
      [left,top] = rect;
      right = left+rect[2]-1;
      bottom = top+rect[3]-1;
    } else {
      if (!Array.isArray(pixels) || !integer(pixels.length,1,width*height))
        throw new RangeError('Brush capture needs at least one selected pixel');
      selected = new Set();
      for (const point of pixels) {
        if (!xy(point,width,height)) throw new RangeError('Brush selection must be inside the canvas');
        const [x,y] = point, p = y*width+x;
        if (selected.has(p)) throw new RangeError('Brush selection repeats a pixel');
        selected.add(p);
        left = Math.min(left,x); right = Math.max(right,x);
        top = Math.min(top,y); bottom = Math.max(bottom,y);
      }
    }
    const w = right-left+1, h = bottom-top+1, palette = [], slots = [], indices = new Map();
    for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) {
      const value = !selected || selected.has(y*width+x) ? read(x,y) : null;
      if (value === null) { slots.push(null); continue; }
      if (!swatch(value)) throw new TypeError('Brush capture needs named or unnamed RGB swatches');
      const saved = { ...value,color:value.color.toLowerCase() }, key = JSON.stringify([saved.id,saved.color]);
      if (!indices.has(key)) { indices.set(key,palette.length); palette.push(saved); }
      slots.push(indices.get(key));
    }
    return validate({ format,version:1,width:w,height:h,anchor:anchor ?? [Math.floor((w-1)/2),Math.floor((h-1)/2)],
      palette,slots,settings:{ angle:0,size:[w,h],swatch:{ mode:'original' },...settings } });
  }

  function footprint(raw) {
    const { width,height,anchor,slots,settings } = validate(raw);
    const [w,h] = settings.size, sx = w/width, sy = h/height;
    const ox = anchor[0]+.5, oy = anchor[1]+.5, turn = ((settings.angle%360)+360)%360;
    const exact = turn%90 === 0, radians = turn*Math.PI/180;
    const cos = exact ? [1,0,-1,0][turn/90] : Math.cos(radians);
    const sin = exact ? [0,1,0,-1][turn/90] : Math.sin(radians);
    const corners = [-ox,width-ox].flatMap(x => [-oy,height-oy].map(y =>
      [cos*x*sx-sin*y*sy,sin*x*sx+cos*y*sy]));
    const xs = corners.map(p=>p[0]), ys = corners.map(p=>p[1]), tip = [];
    for (let y = Math.floor(Math.min(...ys)); y <= Math.ceil(Math.max(...ys)); y++)
      for (let x = Math.floor(Math.min(...xs)); x <= Math.ceil(Math.max(...xs)); x++) {
        const u = Math.floor((cos*x+sin*y)/sx+ox), v = Math.floor((-sin*x+cos*y)/sy+oy);
        if (!integer(u,0,width-1) || !integer(v,0,height-1)) continue;
        const slot = slots[v*width+u];
        if (slot !== null) tip.push([x,y,slot]);
      }
    return tip;
  }

  function stroke(width,height,tip,points,emit) {
    if (!integer(width,1,512) || !integer(height,1,512) || !Array.isArray(points) ||
        !integer(points.length,1,4096) || !Array.from(points).every(point=>xy(point,width,height)))
      throw new RangeError('Brush stroke needs a bounded path inside the native grid');
    let cost = 0;
    function dab(x,y) {
      if ((cost += tip.length) > 8e6) throw new RangeError('Brush stroke exceeds its native pixel budget');
      for (const [dx,dy,slot] of tip) {
        const u=x+dx, v=y+dy;
        if (integer(u,0,width-1) && integer(v,0,height-1)) emit(v*width+u,slot);
      }
    }
    const path = tools.freehand(dab);
    for (const point of points) path.add(point);
    const last = path.tip();
    if (last) dab(...last);
  }

  function resolvePalette(brush,entries,{ limit = 255,named = false,used } = {}) {
    const palette = entries.slice(), tone = brush.settings.swatch;
    const ids = new Set(palette.map(entry=>entry.id));
    function resolve({ id,color }) {
      const rgb = color.toLowerCase();
      const matches = entry => entry.color.toLowerCase() === rgb;
      const preferred = id === undefined ? -1 : palette.findIndex(entry => entry.id === id && matches(entry));
      const existing = preferred >= 0 ? preferred : palette.findIndex(matches);
      if (existing >= 0) return existing;
      if (palette.length >= limit) throw new RangeError('Brush colors exceed the target palette limit');
      let key;
      if (named) {
        const stem = id !== undefined && !ids.has(id) ? id : 'brush-'+rgb.slice(1);
        key = stem;
        let suffix = 2;
        while (ids.has(key)) key = stem+'-'+suffix++;
        ids.add(key);
      }
      palette.push({ ...(key !== undefined && { id:key }),color:rgb });
      return palette.length-1;
    }
    const mapping = brush.palette.map((entry,slot) =>
      !used || used.has(slot) ? resolve(tone.mode === 'tint' ? tone : entry) : undefined);
    return { palette,mapping };
  }

  return Object.freeze({ format,validate,capture,footprint,stroke,resolvePalette });
})();

if (typeof module !== 'undefined') module.exports = PixelBrushes;
