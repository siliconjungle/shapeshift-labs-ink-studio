/* Whole-canvas transforms and native scene registration for indexed artwork. */
const PixelCanvasTransforms = (() => {
  const schemas = {
    crop:['rect'], trim:[], pad:['margins'], resize:['size','anchor'], resample:['size','filter']
  };
  const anchors = {
    'top-left':[0,0], top:[.5,0], 'top-right':[1,0], left:[0,.5], center:[.5,.5], right:[1,.5],
    'bottom-left':[0,1], bottom:[.5,1], 'bottom-right':[1,1]
  };
  const integer = (n,lo,hi) => Number.isSafeInteger(n) && n >= lo && n <= hi;
  const pair = (v,test) => Array.isArray(v) && v.length === 2 && Array.from(v).every(test);
  const record = value => value && Object.getPrototypeOf(value) === Object.prototype;
  const dimensions = value => pair(value,n=>integer(n,1,512));
  const half = value => Math.round(value*2)/2 || 0;

  function extent(width,height) {
    let left = width, top = height, right = -1, bottom = -1;
    return {
      include(x,y) {
        left = Math.min(left,x); top = Math.min(top,y);
        right = Math.max(right,x); bottom = Math.max(bottom,y);
      },
      rect:()=>right < left ? [0,0,width,height] : [left,top,right-left+1,bottom-top+1]
    };
  }

  function plan(width,height,operation,trim) {
    if (!dimensions([width,height]) || !record(operation) || !Object.hasOwn(schemas,operation.type) ||
        Object.keys(operation).some(key=>key !== 'type' && !schemas[operation.type].includes(key)))
      throw new TypeError('Choose a crop, trim, pad, resize, or resample canvas operation');
    const { type } = operation;
    let size = [width,height], offset = [0,0], scale = [1,1], filter = 'nearest';
    if (type === 'crop' || type === 'trim') {
      const rect = type === 'trim' ? trim?.rect() : operation.rect;
      if (!Array.isArray(rect) || rect.length !== 4 || !integer(rect[0],0,width-1) ||
          !integer(rect[1],0,height-1) || !integer(rect[2],1,width-rect[0]) || !integer(rect[3],1,height-rect[1]))
        throw new RangeError('Crop needs an in-bounds [x,y,width,height] rectangle');
      offset = rect.slice(0,2);
      size = rect.slice(2);
    } else if (type === 'pad') {
      const { margins } = operation;
      if (!Array.isArray(margins) || margins.length !== 4 || !Array.from(margins).every(n=>integer(n,0,511)))
        throw new RangeError('Padding needs nonnegative whole [left,top,right,bottom] margins');
      offset = [-margins[0] || 0,-margins[1] || 0];
      size = [width+margins[0]+margins[2],height+margins[1]+margins[3]];
    } else {
      size = operation.size;
      if (!dimensions(size)) throw new RangeError('Canvas dimensions must be whole pixels from 1 to 512');
      if (type === 'resize') {
        const { anchor = 'top-left' } = operation;
        if (!Object.hasOwn(anchors,anchor)) throw new RangeError('Choose a canvas resize anchor');
        offset = anchors[anchor].map((f,i)=>Math.ceil(([width,height][i]-size[i])*f) || 0);
      } else {
        filter = operation.filter ?? 'nearest';
        if (!['nearest','area'].includes(filter)) throw new RangeError('Choose nearest or area resampling');
        scale = [width/size[0],height/size[1]];
      }
    }
    if (!dimensions(size)) throw new RangeError('Canvas dimensions must be whole pixels from 1 to 512');
    const [w,h] = size, index = new Int32Array(w*h).fill(-1);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const u = Math.floor(offset[0]+(x+.5)*scale[0]), v = Math.floor(offset[1]+(y+.5)*scale[1]);
      if (u >= 0 && u < width && v >= 0 && v < height) index[y*w+x] = v*width+u;
    }
    return { before:[width,height],size:size.slice(),offset,scale,filter,index };
  }

  function areaWeights(before,after) {
    return Array.from({ length:after },(_,p)=>{
      const a = p*before/after, b = (p+1)*before/after, result = [];
      for (let i = Math.floor(a); i < Math.min(before,Math.ceil(b)); i++)
        result.push([i,Math.min(b,i+1)-Math.max(a,i)]);
      return result;
    });
  }

  function raster(map,slots,alpha) {
    const { before:[width,height],size:[w,h],filter,index } = map;
    const output = Array(w*h).fill(null);
    let opacity;
    function set(p,slot,a) {
      output[p] = slot;
      if (slot !== null && slot >= 0 && a !== 255) {
        opacity ??= Array(output.length).fill(255);
        opacity[p] = a;
      }
    }
    if (filter === 'nearest' || w === width && h === height) {
      for (let p = 0; p < index.length; p++) {
        const source = index[p], slot = slots[source];
        if (source < 0 || slot === -1 || slot === null) continue;
        set(p,slot,alpha?.[source] ?? 255);
      }
    } else {
      const horizontal = areaWeights(width,w), vertical = areaWeights(height,h);
      const area = width/w*height/h;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const weights = new Map();
        let pigment = 0, knockout = 0, coverage = 0;
        for (const [v,yWeight] of vertical[y]) for (const [u,xWeight] of horizontal[x]) {
          const source = v*width+u, slot = slots[source], weight = xWeight*yWeight;
          if (slot === -2) { knockout += weight; continue; }
          if (slot === null || slot < 0) continue;
          const amount = weight*(alpha?.[source] ?? 255);
          const entry = weights.get(slot) ?? [0,0];
          entry[0] += amount;
          entry[1] += weight;
          weights.set(slot,entry);
          pigment += weight;
          coverage += amount;
        }
        const p = y*w+x;
        if (knockout > pigment) { set(p,-2,255); continue; }
        let best, swatch;
        for (const [slot,weight] of weights) {
          if (!best || weight[0] > best[0] || weight[0] === best[0] &&
              (weight[0] === 0 ? weight[1] > best[1] || weight[1] === best[1] && slot < swatch : slot < swatch)) {
            best = weight; swatch = slot;
          }
        }
        if (best) set(p,swatch,Math.min(255,Math.round(coverage/area)));
      }
    }
    return { slots:output,...(opacity && { alpha:opacity }) };
  }

  function region(map,pixels) {
    const [width] = map.before, [w] = map.size;
    const source = new Set(pixels.map(([x,y])=>y*width+x)), result = [], kept = new Set();
    for (let p = 0; p < map.index.length; p++) {
      const i = map.index[p];
      if (!source.has(i)) continue;
      result.push([p%w,Math.floor(p/w)]);
      kept.add(i);
    }
    return { pixels:result,discarded:source.size-kept.size };
  }

  function coordinate(map,value,axis) {
    return (value+.5-map.offset[axis])/map.scale[axis]-.5;
  }

  function guides(map,rows) {
    return rows?.map(guide => {
      if (guide.kind === 'axis') return { ...guide,at:half(coordinate(map,guide.at,Number(guide.axis === 'y'))) };
      if (guide.kind === 'grid') return { ...guide,
        at:guide.at.map((value,axis)=>Math.round((value-map.offset[axis])/map.scale[axis]) || 0),
        step:guide.step.map((value,axis)=>Math.max(1,Math.min(8192,Math.round(value/map.scale[axis])))) };
      return { ...guide,at:guide.at.map((value,axis)=>half(coordinate(map,value,axis))) };
    });
  }

  function registered(value) {
    return record(value) && Object.keys(value).every(key=>['size','offset','scale'].includes(key)) &&
      dimensions(value.size) && pair(value.offset,Number.isFinite) &&
      pair(value.scale,n=>Number.isFinite(n) && n > 0);
  }

  function preserve(map,previous) {
    const { size,offset,scale } = previous ?? { size:map.before,offset:[0,0],scale:[1,1] };
    const result = { size,offset:offset.map((n,i)=>n+map.offset[i]*scale[i]),
      scale:scale.map((n,i)=>n*map.scale[i]) };
    if (!registered(result)) throw new RangeError('Canvas registration is outside the numeric range');
    if (result.size.every((n,i)=>n === map.size[i] && result.offset[i] === 0 && result.scale[i] === 1)) return;
    return result;
  }

  function sourcePoint(grid,point,registration) {
    const { size,offset,scale } = registration ?? { size:grid,offset:[0,0],scale:[1,1] };
    const mapped = point.map((n,i)=>offset[i]+(n+.5)*scale[i]);
    return mapped.every((n,i)=>n >= 0 && n < size[i]) ? mapped : null;
  }

  function uv(grid,point,registration) {
    const mapped = sourcePoint(grid,point,registration);
    const size = registration?.size ?? grid;
    return mapped && [mapped[0]/size[0],1-mapped[1]/size[1]];
  }

  return Object.freeze({ extent,plan,raster,region,coordinate,guides,registered,preserve,sourcePoint,uv });
})();

if (typeof module !== 'undefined') module.exports = PixelCanvasTransforms;
