/* Native selections shared by the stamp editor and versioned document tools. */
const PixelSelections = (() => {
  const tools = typeof PixelPaintTools === 'undefined' ? require('./pixel-paint-tools.js') : PixelPaintTools;
  const fields = (value, keys) => value && Object.getPrototypeOf(value) === Object.prototype &&
    Object.keys(value).every(key => keys.includes(key));
  const integer = (value,min,max) => Number.isSafeInteger(value) && value >= min && value <= max;
  const types = new Map([
    ['rectangle',['rect']],['ellipse',['rect']],['lasso',['points']],['polygon',['points']],
    ['wand',['at','tolerance','connected']]
  ]);
  const mergeTypes = ['combine','subtract','intersect'];
  const modifyTypes = new Map([
    ['invert',[]],['grow',['amount']],['shrink',['amount']],['outline',['amount','side']]
  ]);

  function gridSize(width,height) {
    if (!integer(width,1,512) || !integer(height,1,512))
      throw new RangeError('Pixel selections need a canvas from 1 to 512 pixels on each axis');
    return width*height;
  }

  function contains(width,height,value) {
    return Array.isArray(value) && value.length === 2 &&
      integer(value[0],0,width-1) && integer(value[1],0,height-1);
  }

  function fromPixels(width,height,pixels) {
    const result = new Uint8Array(gridSize(width,height));
    if (!Array.isArray(pixels) || pixels.length > result.length)
      throw new TypeError('A pixel mask needs a list of native coordinates');
    for (const at of pixels) {
      if (!contains(width,height,at)) throw new RangeError('A selection pixel is outside the native grid');
      const p = at[1]*width+at[0];
      if (result[p]) throw new RangeError('A selection mask repeats a pixel');
      result[p] = 1;
    }
    return result;
  }

  function mask(width,height,query,read,recall) {
    gridSize(width,height);
    let remaining = 32;
    function evaluate(query) {
      if (--remaining < 0) throw new RangeError('A selection query supports at most 32 operations');
      const type = query?.type;
      if (type === 'recall') {
        if (!fields(query,['type','id']) || typeof query.id !== 'string' || typeof recall !== 'function')
          throw new TypeError('Recall needs a saved selection ID');
        return fromPixels(width,height,recall(query.id));
      }
      if (type === 'pixels') {
        if (!fields(query,['type','pixels'])) throw new TypeError('A literal selection needs native pixels');
        return fromPixels(width,height,query.pixels);
      }
      if (mergeTypes.includes(type)) {
        if (!fields(query,['type','base','with'])) throw new TypeError('Combine, subtract and intersect need base and with masks');
        return combine(type,evaluate(query.base),evaluate(query.with));
      }
      if (modifyTypes.has(type)) {
        const { source,...operation } = query;
        if (!fields(query,['type','source',...modifyTypes.get(type)]))
          throw new TypeError('A selection modifier needs a source mask and valid options');
        return modify(width,height,evaluate(source),operation);
      }
      const keys = types.get(type);
      if (!keys || !fields(query,['type',...keys]))
        throw new TypeError('Choose a rectangle, ellipse, lasso, polygon, wand or selection operation');
      return toolMask(width,height,query,read);
    }
    return evaluate(query);
  }

  function requireMask(value,size) {
    if (!(value instanceof Uint8Array) || value.length !== size)
      throw new TypeError('A selection mask must match the native grid');
  }

  function combine(type,base,operand) {
    if (!mergeTypes.includes(type) || !(base instanceof Uint8Array))
      throw new TypeError('Choose combine, subtract or intersect for two selection masks');
    requireMask(operand,base.length);
    return base.map((on,p) => {
      const selected = operand[p];
      if (type === 'combine') return Number(Boolean(on || selected));
      if (type === 'subtract') return Number(Boolean(on && !selected));
      return Number(Boolean(on && selected));
    });
  }

  function distances(width,height,mask,toSelected) {
    const result = new Uint16Array(mask.length);
    const far = 0xffff;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const p = y*width+x;
      let distance = toSelected ? (mask[p] ? 0 : far) :
        (mask[p] ? Math.min(x+1,y+1,width-x,height-y) : 0);
      if (x) distance = Math.min(distance,result[p-1]+1);
      if (y) distance = Math.min(distance,result[p-width]+1);
      result[p] = distance;
    }
    for (let y = height-1; y >= 0; y--) for (let x = width-1; x >= 0; x--) {
      const p = y*width+x;
      if (x+1 < width) result[p] = Math.min(result[p],result[p+1]+1);
      if (y+1 < height) result[p] = Math.min(result[p],result[p+width]+1);
    }
    return result;
  }

  function modify(width,height,mask,operation) {
    requireMask(mask,gridSize(width,height));
    const keys = modifyTypes.get(operation?.type);
    if (!keys || !fields(operation,['type',...keys]))
      throw new TypeError('Choose invert, grow, shrink or outline for the selection');
    const { type,amount = 1,side = 'inside' } = operation;
    if (type === 'invert') return mask.map(value=>Number(!value));
    if (!integer(amount,1,512) || !['inside','outside','both'].includes(side))
      throw new RangeError('Selection radius must be 1–512 pixels and outline side must be inside, outside or both');
    if (type === 'grow') {
      const distance = distances(width,height,mask,true);
      return mask.map((_,p)=>Number(distance[p] <= amount));
    }
    const inward = type === 'shrink' || side !== 'outside' ? distances(width,height,mask,false) : null;
    if (type === 'shrink') return mask.map((_,p)=>Number(inward[p] > amount));
    const outward = side !== 'inside' ? distances(width,height,mask,true) : null;
    return mask.map((on,p)=>Number(on ? inward !== null && inward[p] <= amount :
      outward !== null && outward[p] <= amount));
  }

  function toolMask(width,height,query,read) {
    const result = new Uint8Array(width*height), { type } = query;
    const point = value => contains(width,height,value);

    if (type === 'rectangle' || type === 'ellipse') {
      const { rect } = query;
      if (!Array.isArray(rect) || rect.length !== 4 || !point(rect.slice(0,2)) ||
          !integer(rect[2],1,width-rect[0]) || !integer(rect[3],1,height-rect[1]))
        throw new RangeError('A marquee needs an in-bounds [x, y, width, height] rectangle');
      const [x,y,w,h] = rect;
      for (let v = 0; v < h; v++) {
        const start = (y+v)*width+x;
        if (type === 'rectangle') result.fill(1,start,start+w);
        else for (let u = 0; u < w; u++)
          if (tools.insideEllipse(u,v,w,h)) result[start+u] = 1;
      }
    } else if (type === 'wand') {
      const { at,tolerance = 0,connected = true } = query;
      if (!point(at) || !integer(tolerance,0,255) || typeof connected !== 'boolean' || typeof read !== 'function')
        throw new TypeError('A wand needs a native seed, a tolerance from 0 to 255, and an optional connected flag');
      const seed = read(at[1]*width+at[0]), opacity = seed&255;
      const matches = p => {
        const value = read(p), alpha = value&255;
        if (!opacity || !alpha) return opacity === alpha;
        if (!tolerance) return seed === value;
        return Math.abs(alpha-opacity) <= tolerance &&
          Math.abs((value>>>24)-(seed>>>24)) <= tolerance &&
          Math.abs((value>>>16&255)-(seed>>>16&255)) <= tolerance &&
          Math.abs((value>>>8&255)-(seed>>>8&255)) <= tolerance;
      };
      if (connected) {
        for (const p of tools.region(width,height,at,matches)) result[p] = 1;
      } else {
        for (let p = 0; p < result.length; p++) result[p] = Number(matches(p));
      }
    } else {
      const { points } = query;
      const polygon = type === 'polygon';
      if (!Array.isArray(points) || !integer(points.length,polygon ? 3 : 1,polygon ? 128 : 4096) ||
          !Array.from(points).every(point))
        throw new RangeError('A lasso needs 1–4096 native points or a polygon needs 3–128 native vertices');
      lasso(width,height,points,result);
    }
    return result;
  }

  function lasso(width,height,points,result) {
    const intersections = Array.from({ length:height },()=>[]);
    const boundary = (x,y) => { result[y*width+x] = 1; };
    for (let i = 0; i < points.length; i++) {
      const a = points[i], b = points[(i+1)%points.length];
      boundary(...a);
      tools.segment(a,b,boundary);
      const [[x,y],[u,v]] = a[1] < b[1] ? [a,b] : [b,a];
      for (let row = y; row < v; row++)
        intersections[row].push(x+(row-y)*(u-x)/(v-y));
    }
    // The half-open edge rule counts a shared vertex once for the even-odd fill.
    for (let y = 0; y < height; y++) {
      const crossings = intersections[y].sort((a,b)=>a-b);
      for (let j = 0; j+1 < crossings.length; j+=2) {
        const start = Math.ceil(crossings[j]), end = Math.floor(crossings[j+1]);
        if (end >= start) result.fill(1,y*width+start,y*width+end+1);
      }
    }
  }

  function pixels(width,mask) {
    const result = [];
    for (let p = 0; p < mask.length; p++)
      if (mask[p]) result.push([p%width,Math.floor(p/width)]);
    return result;
  }

  return Object.freeze({ mask,pixels,fromPixels,combine,modify });
})();

if (typeof module !== 'undefined') module.exports = PixelSelections;
