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

  function mask(width,height,query,read) {
    if (!integer(width,1,512) || !integer(height,1,512))
      throw new RangeError('Pixel selections need a canvas from 1 to 512 pixels on each axis');
    const keys = types.get(query?.type);
    if (!keys || !fields(query,['type',...keys]))
      throw new TypeError('Choose a rectangle, ellipse, lasso, polygon or wand selection');
    const result = new Uint8Array(width*height), { type } = query;
    const point = value => Array.isArray(value) && value.length === 2 &&
      integer(value[0],0,width-1) && integer(value[1],0,height-1);

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

  return Object.freeze({ mask,pixels });
})();

if (typeof module !== 'undefined') module.exports = PixelSelections;
