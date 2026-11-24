/* Scoped adjustments over original indexed pixels, shared by the document and Workshop. */
const PixelAdjustments = (() => {
  const curves = typeof ColorCurves === 'undefined' ? require('./color-curves.js') : ColorCurves;
  const stack = typeof ColorStack === 'undefined' ? require('./color-stack.js') : ColorStack;
  const look = typeof PixelLook === 'undefined' ? require('./pixel-look.js') : PixelLook;
  const selections = typeof PixelSelections === 'undefined' ? require('./pixel-selections.js') : PixelSelections;
  const record = value => value && Object.getPrototypeOf(value) === Object.prototype;
  const pair = value => Array.isArray(value) && value.length === 2 && Array.from(value).every(n=>Number.isFinite(n) && Math.abs(n) <= 8192);
  const clamp = value => Math.max(0,Math.min(1,value));
  const rgb = value => typeof value === 'string' && /^#[a-f\d]{6}$/i.test(value);
  const fields = {
    curves:['curve','channels','match'],
    'hue-saturation':['degrees','saturation','match'],
    gradient:['stops','interpolation','axis','from','to','match'],
    replace:['map'],
    dither:['dark','light','pattern'],
    outline:['swatch','radius','side']
  };

  function gradientLine(width,height,mask,{ axis = 'x',from,to }) {
    if (from) {
      const [x,y] = from, dx = to[0]-x, dy = to[1]-y, square = dx*dx+dy*dy;
      return (u,v)=>clamp(((u-x)*dx+(v-y)*dy)/square);
    }
    const xAxis = axis === 'x', size = xAxis ? width : height;
    const coordinate = p=>xAxis ? p%width : Math.floor(p/width);
    let low = 0, high = size-1;
    if (mask) {
      low = size-1;
      high = 0;
      for (let p = 0; p < mask.length; p++) if (mask[p]) {
        const at = coordinate(p);
        low = Math.min(low,at);
        high = Math.max(high,at);
      }
    }
    return (x,y)=>clamp(((xAxis ? x : y)-low)/Math.max(1,high-low));
  }

  function prepare(operation,paletteEditor) {
    const { palette,resolve } = paletteEditor, type = operation?.type;
    if (!record(operation) || !Object.hasOwn(fields,type) ||
        Object.keys(operation).some(key=>key !== 'type' && !fields[type].includes(key)))
      throw new TypeError('Choose curves, hue-saturation, gradient, replace, dither, or outline');
    const { match = 'exact' } = operation;
    if (!['exact','palette'].includes(match)) throw new TypeError('Choose exact or palette color matching');
    const entries = palette.slice(), ids = new Map(entries.map((row,i)=>[row.id,i]));
    const colors = entries.map(row=>curves.color(row.color)), packed = entries.map(row=>row.color.toLowerCase());
    const swatch = id=>{
      if (!ids.has(id)) throw new RangeError('Unknown adjustment swatch '+id);
      return ids.get(id);
    };
    const matched = new Map();
    function colorSlot(value,previous) {
      const bytes = value.map(n=>Math.round(clamp(n)*255));
      const key = '#'+bytes.map(n=>n.toString(16).padStart(2,'0')).join('');
      if (key === packed[previous]) return previous;
      if (match === 'exact') return resolve(key,undefined,previous);
      if (!matched.has(key)) matched.set(key,look.nearest(bytes.map(n=>n/255),colors));
      return matched.get(key);
    }

    let grade, paint, outline, ramp;
    if (type === 'curves') {
      const master = operation.curve === undefined ? null : curves.scalar(operation.curve,true);
      const channels = operation.channels === undefined ? null : curves.prepare({ channels:operation.channels });
      if (!master && !channels) throw new TypeError('Curves need a master or RGB channel curve');
      grade = input=>{
        const toned = master ? input.map(master) : input;
        return channels ? channels(toned) : toned;
      };
    } else if (type === 'hue-saturation') {
      const { degrees = 0,saturation = 1 } = operation;
      if (!Number.isFinite(degrees) || !Number.isFinite(saturation) || saturation < 0 || saturation > 4)
        throw new RangeError('Hue and saturation need finite degrees and a saturation factor from 0 to 4');
      const color = stack.prepare({ name:'Hue and saturation',steps:[{ type:'hue',degrees },{ type:'saturation',factor:saturation }] });
      grade = input=>color.sample(input);
    } else if (type === 'gradient') {
      const { stops,interpolation,axis = 'x',from,to } = operation;
      const points = from !== undefined || to !== undefined;
      if (!['x','y'].includes(axis) || (points &&
          (!pair(from) || !pair(to) || (to[0]-from[0])**2+(to[1]-from[1])**2 === 0)) ||
          !Array.isArray(stops) || !Array.from(stops).every(row=>Array.isArray(row) && row.length === 2 &&
            Number.isFinite(row[0]) && row[0] >= 0 && row[0] <= 1))
        throw new RangeError('Gradient needs unit stops and a valid axis or two distinct native points');
      const resolveStop = id=>rgb(id) ? curves.color(id) : colors[swatch(id)];
      const sample = curves.ramp({ stops,interpolation },resolveStop);
      const keys = stops.map(([at,color])=>({ at,slot:rgb(color) ? undefined : swatch(color) }));
      ramp = t=>{
        const high = curves.segmentIndex(keys,t), point = keys[high];
        const slot = !high || t >= point.at ? point.slot :
          interpolation === 'step' ? keys[high-1].slot : undefined;
        return slot ?? colorSlot(sample(t));
      };
    } else if (type === 'replace') {
      if (!record(operation.map) || !Object.keys(operation.map).length)
        throw new TypeError('Replacement needs a map from original swatch IDs to target IDs');
      const mapping = new Map(Object.entries(operation.map).map(([from,to])=>[swatch(from),swatch(to)]));
      paint = slot=>mapping.get(slot) ?? slot;
    } else if (type === 'dither') {
      const dark = swatch(operation.dark), light = swatch(operation.light), pattern = operation.pattern ?? 'bayer';
      if (dark === light || !['bayer','checker'].includes(pattern))
        throw new RangeError('Dithering needs two distinct swatches and the bayer or checker pattern');
      const tone = colors.map(curves.luminance);
      const rank = pattern === 'bayer' ? look.bayerRank : (x,y)=>(x+y)%2 ? .75 : .25;
      paint = (slot,x,y)=>tone[slot] >= rank(x,y) ? light : dark;
    } else {
      const slot = swatch(operation.swatch), { radius = 1,side = 'outside' } = operation;
      if (!Number.isInteger(radius) || radius < 1 || radius > 512 || !['inside','outside','both'].includes(side))
        throw new RangeError('Outline needs a radius from 1 to 512 and side inside, outside, or both');
      outline = { slot,radius,side };
    }
    if (grade) {
      const graded = new Map();
      paint = slot=>{
        if (!graded.has(slot)) graded.set(slot,colorSlot(grade(colors[slot]),slot));
        return graded.get(slot);
      };
    }

    function apply(width,height,source,mask) {
      const { slots,alpha,clipping } = source;
      const outside = slot=>slot === null || slot < 0;
      const blank = slot=>slot === null || slot === -1;
      const coordinate = ramp && gradientLine(width,height,mask,operation);
      const solid = outline && Uint8Array.from(slots,(slot,p)=>
        Number(!outside(slot) && (alpha?.[p] ?? 255) > 0 && (!clipping || clipping[p])));
      const rim = solid && selections.modify(width,height,solid,
        { type:'outline',amount:outline.radius,side:outline.side });
      const writes = new Map();
      for (let p = 0; p < slots.length; p++) {
        if (mask && !mask[p]) continue;
        const slot = slots[p], coverage = alpha?.[p] ?? 255;
        let next;
        if (rim) {
          if (!rim[p] || !solid[p] && !blank(slot)) continue;
          next = outline.slot;
        } else {
          if (outside(slot)) continue;
          const x = p%width, y = Math.floor(p/width);
          next = coordinate ? ramp(coordinate(x,y)) : paint(slot,x,y);
        }
        if (slot !== next) writes.set(p,{ slot:next,alpha:outside(slot) ? 255 : coverage });
      }
      return writes;
    }
    return { apply };
  }

  return Object.freeze({ prepare });
})();
if (typeof module !== 'undefined') module.exports = PixelAdjustments;
