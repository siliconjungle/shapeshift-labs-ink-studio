/* Exact native-grid paths and connected regions used by raster tools. */
const PixelPaintTools = (() => {
  const steps = values => Object.freeze(values.map(value => Object.freeze(value)));
  const four = steps([[1,0],[-1,0],[0,1],[0,-1]]);
  const eight = steps([...four,[1,1],[-1,1],[1,-1],[-1,-1]]);
  const integer = (n,lo,hi) => Number.isSafeInteger(n) && n >= lo && n <= hi;

  const modulo = (x,n) => (x%n+n)%n;

  function dimensions(width,height,large = false) {
    return [width,height].every(n=>integer(n,1,large ? 8192 : 512)) && (!large || width*height <= 16777216);
  }

  function drawingGrid(width,height,settings = {},large = false) {
    const fields = ['mirrorX','mirrorY','wrapX','wrapY'];
    if (!settings || Object.getPrototypeOf(settings) !== Object.prototype ||
        !Object.keys(settings).every(key => fields.includes(key)))
      throw new TypeError('Drawing grid accepts mirrorX, mirrorY, wrapX and wrapY');
    const { mirrorX,mirrorY,wrapX = false,wrapY = false } = settings;
    if (typeof wrapX !== 'boolean' || typeof wrapY !== 'boolean' ||
        !dimensions(width,height,large) ||
        ![mirrorX,mirrorY].every((n,i)=>n === undefined || typeof n === 'number' && integer(n*2,-1,2*(i ? height : width)-1)))
      throw new RangeError('Mirror axes need pixel or half-pixel positions on the canvas. Wrap flags must be boolean.');

    function axis(size,mirror,wrap) {
      const min = wrap ? -size : 0, max = wrap ? 2*size-1 : size-1;
      return { size,mirror,wrap,min,max,
        normalize:wrap ? value=>modulo(value,size) : value=>value >= 0 && value < size ? value : -1 };
    }
    const x = axis(width,mirrorX,wrapX), y = axis(height,mirrorY,wrapY);
    function contains(point,fractional = false) {
      if (!Array.isArray(point) || point.length !== 2) return false;
      const inAxis = (n,d) => fractional ? Number.isFinite(n) && n >= d.min-.5 && n <= d.max+.5 : integer(n,d.min,d.max);
      return inAxis(point[0],x) && inAxis(point[1],y);
    }
    function quantize([u,v]) {
      return [Math.max(x.min,Math.min(x.max,Math.round(u))),Math.max(y.min,Math.min(y.max,Math.round(v)))];
    }
    function primary([u,v]) {
      const a = x.normalize(u), b = y.normalize(v);
      return a < 0 || b < 0 ? -1 : b*width+a;
    }
    function pixels(u,v,emit) {
      oriented(u,v,p=>emit(p));
    }

    function oriented(u,v,emit) {
      const a = x.normalize(u), b = y.normalize(v);
      const c = mirrorX === undefined ? -1 : x.normalize(2*mirrorX-u);
      const d = mirrorY === undefined ? -1 : y.normalize(2*mirrorY-v);
      if (a >= 0 && b >= 0) emit(b*width+a,1,1);
      if (c >= 0 && c !== a && b >= 0) emit(b*width+c,-1,1);
      if (a >= 0 && d >= 0 && d !== b) emit(d*width+a,1,-1);
      if (c >= 0 && c !== a && d >= 0 && d !== b) emit(d*width+c,-1,-1);
    }

    // Screen-space strokes use half-integer centers. Include only copies that reach the art.
    function copies([left,top,right,bottom]) {
      function placements(d,lo,hi) {
        const result = [];
        for (const sign of d.mirror === undefined ? [1] : [1,-1]) {
          const offset = sign < 0 ? 2*d.mirror+1 : 0;
          const near = offset+(sign < 0 ? -hi : lo), far = offset+(sign < 0 ? -lo : hi);
          if (!d.wrap && (far <= 0 || near >= d.size)) continue;
          const start = d.wrap ? Math.ceil(-far/d.size) : 0;
          const end = d.wrap ? Math.floor((d.size-near)/d.size) : 0;
          for (let i = start; i <= end; i++) result.push([sign,offset+i*d.size]);
        }
        return result;
      }
      return placements(x,left,right).flatMap(horizontal=>placements(y,top,bottom)
        .map(vertical=>[horizontal,vertical]));
    }
    return { width,height,wrapX,wrapY,contains,quantize,primary,pixels,oriented,copies };
  }

  function visit(seed, marks, id, matches, { width,height,steps,queue,wrapX,wrapY,chart }) {
    const startX = seed%width, startY = Math.floor(seed/width);
    let left=startX, right=startX, top=startY, bottom=startY, area=1;
    marks[seed]=id; queue[0]=seed;
    const chartX = chart?.x, chartY = chart?.y;
    if (chartX) chartX[seed] = startX;
    if (chartY) chartY[seed] = startY;
    for (let i=0; i<area; i++) {
      const p=queue[i], x=p%width, y=Math.floor(p/width);
      left=Math.min(left,x); right=Math.max(right,x);
      top=Math.min(top,y); bottom=Math.max(bottom,y);
      for (const [dx,dy] of steps) {
        let u=x+dx, v=y+dy;
        if (wrapX) u = modulo(u,width);
        if (wrapY) v = modulo(v,height);
        if (u<0 || u>=width || v<0 || v>=height) continue;
        const key=v*width+u;
        if (!marks[key] && matches(key)) {
          marks[key]=id;
          queue[area++]=key;
          if (chartX) chartX[key] = chartX[p] + dx;
          if (chartY) chartY[key] = chartY[p] + dy;
        } else if (chart && marks[key] === id) {
          // Different lifts of the same texel identify a closed path around the tile.
          if (chartX && chartX[key] !== chartX[p] + dx) chart.winding[0] = true;
          if (chartY && chartY[key] !== chartY[p] + dy) chart.winding[1] = true;
        }
      }
    }
    return { id,area,seed:[startX,startY],rect:{ x:left,y:top,width:right-left+1,height:bottom-top+1 } };
  }

  function labelComponents(width, height, steps, selected, {
    minArea = 1, wrapX = false, wrapY = false, stable = false, chart, describe
  } = {}) {
    const count = width * height, blocked = 0xffffffff;
    const labels = new Uint32Array(count), queue = new Uint32Array(count), regions = [];
    const work = { width, height, steps, queue, wrapX, wrapY, chart };
    function active(p) {
      if (selected(p)) return true;
      labels[p] = blocked;
      return false;
    }
    for (let p = 0; p < count; p++) {
      if (labels[p] || !active(p)) continue;
      if (chart) chart.winding.fill(false);
      const region = visit(p, labels, stable ? p + 1 : regions.length + 1, active, work);
      if (region.area < minArea) for (let q = 0; q < region.area; q++) labels[queue[q]] = blocked;
      else {
        if (regions.length >= 32768) throw new RangeError('Raster exceeds its connected-component budget');
        regions.push(describe ? describe(region, queue) : region);
      }
    }
    for (let p = 0; p < count; p++) if (labels[p] === blocked) labels[p] = 0;
    return { regions, labels };
  }

  function region(width,height,point,matches,diagonal = false) {
    const start = point[1]*width+point[0];
    if (!matches(start)) return new Uint32Array();
    const queue = new Uint32Array(width*height), marks = new Uint8Array(queue.length);
    const { area } = visit(start,marks,1,matches,{ width,height,steps:diagonal ? eight : four,queue });
    return queue.subarray(0,area);
  }

  function fillPixels(grid,point,matches) {
    const { width,height,wrapX,wrapY } = grid;
    const queue = new Uint32Array(width*height), marks = new Uint8Array(queue.length), result = [];
    const work = { width,height,steps:four,queue,wrapX,wrapY };
    grid.pixels(...point,seed => {
      if (marks[seed] || !matches(seed,seed)) return;
      const { area } = visit(seed,marks,1,p=>matches(p,seed),work);
      for (let i = 0; i < area; i++) result.push(queue[i]);
    });
    return result.sort((a,b)=>a-b);
  }

  function segment([x,y],[toX,toY],emit) {
    const dx=Math.abs(toX-x), dy=-Math.abs(toY-y), sx=Math.sign(toX-x), sy=Math.sign(toY-y);
    let error=dx+dy;
    while (x!==toX || y!==toY) {
      const twice=2*error;
      if (twice>=dy) { error+=dy; x+=sx; }
      if (twice<=dx) { error+=dx; y+=sy; }
      if (emit(x,y) === false) return;
    }
  }

  function corner(previous,[x,y],[nextX,nextY]) {
    if (!previous) return false;
    const dx = x - previous[0], dy = y - previous[1];
    const sx = nextX - x, sy = nextY - y;
    return (Math.abs(dx) === 1 && dy === 0 && sx === 0 && Math.abs(sy) === 1) ||
      (dx === 0 && Math.abs(dy) === 1 && Math.abs(sx) === 1 && sy === 0);
  }

  function freehand(emit,{ pixelPerfect = false } = {}) {
    let previous, tip;
    // Hold the newest pixel until the next pixel can resolve its corner.
    function add(point) {
      if (!tip) {
        tip = point.slice();
        return;
      }
      segment(tip,point,(x,y) => {
        const next = [x,y];
        if (!pixelPerfect || !corner(previous,tip,next)) {
          if (emit(...tip) === false) return false;
          previous = tip;
        }
        tip = next;
      });
    }
    return { add, tip:() => tip };
  }

  function runs(width,indices) {
    const result = [];
    for (const p of indices) {
      const x = p%width, y = Math.floor(p/width), last = result.at(-1);
      if (last && last[0] === y && last[1]+last[2] === x) last[2]++;
      else result.push([y,x,1]);
    }
    return result;
  }

  function insideEllipse(x,y,w,h) {
    if (w <= 0 || h <= 0) return false;
    const sx = (2*(x+.5)-w)/w, sy = (2*(y+.5)-h)/h;
    return sx*sx + sy*sy <= 1;
  }

  function staircase(width,height,spec,grid) {
    const { from,axis,direction,lengths } = spec ?? {};
    const inside = grid?.contains ?? (point => Array.isArray(point) && point.length === 2 &&
      integer(point[0],0,width-1) && integer(point[1],0,height-1));
    if (!inside(from) || !['x','y'].includes(axis) || !Array.isArray(direction) ||
        direction.length !== 2 || !Array.from(direction).every(n => n === 1 || n === -1) ||
        !Array.isArray(lengths) || !integer(lengths.length,1,512) || !Array.from(lengths).every(n => integer(n,1,512)))
      throw new RangeError('Invalid pixel step stroke');
    const major = Number(axis === 'y'), minor = 1-major;
    const cursor = from.slice(), spans = [];
    for (const length of lengths) {
      const end = cursor.slice();
      end[major] += direction[major]*(length-1);
      if (!inside(cursor) || !inside(end)) throw new RangeError('A pixel step stroke leaves the native grid');
      spans.push([Math.min(cursor[0],end[0]),Math.min(cursor[1],end[1]),major ? 1 : length,major ? length : 1]);
      cursor[major] = end[major]+direction[major];
      cursor[minor] += direction[minor];
    }
    return spans;
  }

  return Object.freeze({ four,eight,visit,labelComponents,region,dimensions,drawingGrid,fillPixels,segment,freehand,runs,insideEllipse,staircase });
})();

if (typeof module !== 'undefined') module.exports = PixelPaintTools;
