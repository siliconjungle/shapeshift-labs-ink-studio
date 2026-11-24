/* Portable indexed brush tips and deterministic native-grid placement. */
const PixelBrushes = (() => {
  const tools = typeof PixelPaintTools === 'undefined' ? require('./pixel-paint-tools.js') : PixelPaintTools;
  const format = 'ink-studio/pixel-brush';
  const integer = (n,lo,hi) => Number.isSafeInteger(n) && n >= lo && n <= hi;
  const fields = (value,keys) => value && Object.getPrototypeOf(value) === Object.prototype &&
    Object.keys(value).every(key => keys.includes(key));
  const bounded = (n,lo,hi) => Number.isFinite(n) && n >= lo && n <= hi;
  const clamp = (n,lo,hi) => Math.max(lo,Math.min(hi,n));
  const scaleRange = pair => Array.isArray(pair) && pair.length === 2 &&
    Array.from(pair).every(n => bounded(n,0,4));
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
    if (!fields(settings,['angle','size','swatch','dynamics']) || !Number.isFinite(settings.angle) ||
        Math.abs(settings.angle) > 360000 || !Array.isArray(settings.size) || settings.size.length !== 2 ||
        !Array.from(settings.size).every(n => integer(n,1,512)) ||
        !fields(tone,['mode','id','color']) ||
        !(tone.mode === 'original' && Object.keys(tone).length === 1 ||
          tone.mode === 'tint' && swatch({ color:tone.color,id:tone.id })))
      throw new TypeError('A pixel brush needs a finite angle, a bounded size and original or tint swatch settings');
    const { dynamics } = settings;
    if (dynamics !== undefined && (!fields(dynamics,['stabilization','pressure','velocity']) ||
        dynamics.stabilization !== undefined && !bounded(dynamics.stabilization,0,500) ||
        dynamics.pressure !== undefined && !scaleRange(dynamics.pressure) ||
        dynamics.velocity !== undefined && (!fields(dynamics.velocity,['speed','size']) ||
          !bounded(dynamics.velocity.speed,1,10000) || !scaleRange(dynamics.velocity.size))))
      throw new TypeError('Brush dynamics need stabilization in 0–500 ms, size scales in 0–4 and velocity speed in 1–10000 px/s');
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
    const brush = validate(raw);
    return rasterTip(brush,brush.settings.size);
  }

  function retained(raw) {
    const brush = validate(raw), {size,swatch:tone} = brush.settings;
    if (size.some(n=>n>128)) throw new RangeError('A retained brush tip needs a size of at most 128 × 128 pixels');
    const tip = rasterTip(brush,size);
    if (!tip.length) throw new RangeError('The retained brush tip has no painted pixels at this size and angle');
    const min = tip[0].slice(0,2), max = min.slice();
    for (const [x,y] of tip) {
      min[0]=Math.min(min[0],x); min[1]=Math.min(min[1],y);
      max[0]=Math.max(max[0],x); max[1]=Math.max(max[1],y);
    }
    const width=max[0]-min[0]+1, height=max[1]-min[1]+1;
    const slots=new Int16Array(width*height).fill(-1);
    for (const [x,y,slot] of tip) slots[(y-min[1])*width+x-min[0]]=slot;
    const {mode,...tint}=tone;
    const palette=brush.palette.map(entry=>({...(mode==='tint' ? tint : entry)}));
    function slotAt(x,y) {
      const u=Math.floor(x+.5)-min[0], v=Math.floor(y+.5)-min[1];
      return u>=0&&v>=0&&u<width&&v<height ? slots[v*width+u] : -1;
    }
    return {min,width,height,slots,palette,slotAt};
  }

  function rasterTip({ width,height,anchor,slots,settings },[w,h],charge) {
    const sx = w/width, sy = h/height;
    const ox = anchor[0]+.5, oy = anchor[1]+.5, turn = ((settings.angle%360)+360)%360;
    const exact = turn%90 === 0, radians = turn*Math.PI/180;
    const cos = exact ? [1,0,-1,0][turn/90] : Math.cos(radians);
    const sin = exact ? [0,1,0,-1][turn/90] : Math.sin(radians);
    const corners = [-ox,width-ox].flatMap(x => [-oy,height-oy].map(y =>
      [cos*x*sx-sin*y*sy,sin*x*sx+cos*y*sy]));
    const xs = corners.map(p=>p[0]), ys = corners.map(p=>p[1]), tip = [];
    const left = Math.floor(Math.min(...xs)), right = Math.ceil(Math.max(...xs));
    const top = Math.floor(Math.min(...ys)), bottom = Math.ceil(Math.max(...ys));
    charge?.((right-left+1)*(bottom-top+1));
    for (let y = top; y <= bottom; y++)
      for (let x = left; x <= right; x++) {
        const u = Math.floor((cos*x+sin*y)/sx+ox), v = Math.floor((-sin*x+cos*y)/sy+oy);
        if (!integer(u,0,width-1) || !integer(v,0,height-1)) continue;
        const slot = slots[v*width+u];
        if (slot !== null) tip.push([x,y,slot]);
      }
    return tip;
  }

  function stroke(width,height,tip,points,emit,grid) {
    if (!integer(width,1,512) || !integer(height,1,512) || !Array.isArray(points) ||
        !integer(points.length,1,4096) || !Array.from(points).every(point=>grid ? grid.contains(point) : xy(point,width,height)))
      throw new RangeError('Brush stroke needs a bounded path inside the native grid');
    let cost = 0;
    function dab(x,y) {
      if ((cost += tip.length) > 8e6) throw new RangeError('Brush stroke exceeds its native pixel budget');
      place(width,height,tip,x,y,emit,grid);
    }
    const path = tools.freehand(dab);
    for (const point of points) path.add(point);
    const last = path.tip();
    if (last) dab(...last);
  }

  function place(width,height,tip,x,y,emit,grid) {
    for (const [dx,dy,slot] of tip) {
      const u = x+dx, v = y+dy;
      if (grid) grid.pixels(u,v,p=>emit(p,slot));
      else if (integer(u,0,width-1) && integer(v,0,height-1)) emit(v*width+u,slot);
    }
  }

  function beginDynamicStroke(width,height,raw,emit,grid) {
    if (!integer(width,1,512) || !integer(height,1,512) || typeof emit !== 'function')
      throw new TypeError('Brush dynamics need a native canvas and pixel callback');
    const brush = validate(raw), { size } = brush.settings;
    const { stabilization = 0,pressure = [1,1],velocity } = brush.settings.dynamics ?? {};
    let previous, position, anchor, scale, lastDab, lastTip, lastSize, count = 0, cost = 0, ended = false;
    const smallTips = new Map();
    const mix = (a,b,t) => a+(b-a)*t;
    function charge(work) {
      if ((cost += work) > 8e6) throw new RangeError('Brush stroke exceeds its native pixel budget');
    }

    function dab(x,y,value) {
      const dimensions = size.map(n => clamp(Math.round(n*value),1,512)), key = dimensions.join(',');
      if (lastDab?.[0] === x && lastDab[1] === y && lastSize === key) return;
      if (key !== lastSize) {
        lastTip = smallTips.get(key) ?? rasterTip(brush,dimensions,charge);
        if (lastTip.length <= 4096 && smallTips.size < 16) smallTips.set(key,lastTip);
        lastSize = key;
      }
      charge(lastTip.length+1);
      place(width,height,lastTip,x,y,emit,grid);
      lastDab = [x,y];
    }

    function extend(next,nextScale) {
      const at = grid ? grid.quantize(next) : next.map((n,i) => clamp(Math.round(n),0,(i === 0 ? width : height)-1));
      const steps = anchor && Math.max(Math.abs(at[0]-anchor[0]),Math.abs(at[1]-anchor[1]));
      if (steps) {
        let step = 0;
        tools.segment(anchor,at,(x,y) => dab(x,y,mix(scale,nextScale,++step/steps)));
      } else dab(...at,nextScale);
      anchor = at;
      scale = nextScale;
    }

    function add(sample) {
      if (ended || count >= 4096 || !fields(sample,['at','pressure','time']) ||
          !Array.isArray(sample.at) || sample.at.length !== 2 ||
          (grid ? !grid.contains(sample.at,true) :
            !bounded(sample.at[0],-.5,width-.5) || !bounded(sample.at[1],-.5,height-.5)) ||
          !bounded(sample.pressure,0,1) || !bounded(sample.time,previous?.time ?? 0,Number.MAX_SAFE_INTEGER))
        throw new RangeError('Brush samples need in-grid positions, pressure in 0–1 and ordered elapsed milliseconds (up to 4096 samples)');
      const at = sample.at.slice();
      const elapsed = previous ? sample.time-previous.time : 0;
      const distance = previous ? Math.hypot(at[0]-previous.at[0],at[1]-previous.at[1]) : 0;
      const speed = distance ? (elapsed ? distance*1000/elapsed : Infinity) : 0;
      const velocityScale = velocity ? mix(...velocity.size,Math.min(1,speed/velocity.speed)) : 1;
      const nextScale = mix(...pressure,sample.pressure)*velocityScale;
      // Smooth in continuous art space and quantize only when placing a dab.
      const follow = previous && stabilization ? -Math.expm1(-elapsed/stabilization) : 1;
      position = position ? position.map((n,i) => mix(n,at[i],follow)) : at;
      extend(position,nextScale);
      previous = { at,time:sample.time };
      count++;
    }

    function finish() {
      if (!count) throw new RangeError('A dynamic brush stroke needs at least one sample');
      if (ended) return;
      // Bring the stabilized path to the release point without changing its last size.
      extend(previous.at,scale);
      ended = true;
    }

    return { add,finish };
  }

  function dynamicStroke(width,height,brush,samples,emit,grid) {
    if (!Array.isArray(samples) || !integer(samples.length,1,4096))
      throw new RangeError('A dynamic brush stroke needs 1–4096 samples');
    const stroke = beginDynamicStroke(width,height,brush,emit,grid);
    for (const sample of samples) stroke.add(sample);
    stroke.finish();
  }

  function shade(shading,swatches) {
    if (fields(shading,['mode']) && shading.mode === 'recolor')
      return (slot,alpha) => slot !== null && slot >= 0 && alpha > 0 ? slot : undefined;
    if (fields(shading,['mode','value']) && shading.mode === 'alpha' && integer(shading.value,0,255))
      return (slot,alpha) => slot !== null && slot >= 0 && alpha !== shading.value ? shading.value : undefined;
    if (!fields(shading,['mode','ramp','step']) || shading.mode !== 'ramp' ||
        !Array.isArray(shading.ramp) || !integer(shading.ramp.length,2,255) ||
        !integer(shading.step,-254,254) || !shading.step)
      throw new TypeError('Brush shading needs recolor, a ramp with a nonzero step, or an alpha byte');
    const ramp = Array.from(shading.ramp,id=>swatches.indexOf(id));
    if (ramp.includes(-1) || new Set(ramp).size !== ramp.length)
      throw new RangeError('A brush ramp needs distinct, existing target swatches');
    const positions = new Map(ramp.map((slot,index)=>[slot,index]));
    return (slot,alpha) => {
      const index = positions.get(slot);
      if (!alpha || index === undefined) return;
      const next = ramp[clamp(index+shading.step,0,ramp.length-1)];
      return next === slot ? undefined : next;
    };
  }

  function resolvePalette(brush,entries,{ limit = 255,named = false,used,preserveIds = false } = {}) {
    const palette = entries.slice(), tone = brush.settings.swatch;
    const ids = new Set(palette.map(entry=>entry.id));
    function resolve({ id,color }) {
      const rgb = color.toLowerCase();
      const matches = entry => entry.color.toLowerCase() === rgb;
      const preferred = id === undefined ? -1 : palette.findIndex(entry => entry.id === id && matches(entry));
      const distinct = preserveIds && id !== undefined;
      if (preferred >= 0) return preferred;
      let renamed;
      if (distinct && ids.has(id)) {
        const stem = id.slice(0,51)+'-'+rgb.slice(1);
        renamed = stem;
        let suffix = 2;
        while (ids.has(renamed)) {
          const existing = palette.findIndex(entry=>entry.id === renamed && matches(entry));
          if (existing >= 0) return existing;
          renamed = stem+'-'+suffix++;
        }
      } else if (!distinct) {
        const existing = palette.findIndex(matches);
        if (existing >= 0) return existing;
      }
      if (palette.length >= limit) throw new RangeError('Brush colors exceed the target palette limit');
      let key;
      if (named) {
        const stem = id !== undefined && !ids.has(id) ? id : renamed ?? 'brush-'+rgb.slice(1);
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

  return Object.freeze({ format,validate,capture,footprint,retained,stroke,beginDynamicStroke,dynamicStroke,shade,resolvePalette });
})();

if (typeof module !== 'undefined') module.exports = PixelBrushes;
