/* Exact native-grid paths and connected regions used by raster tools. */
const PixelPaintTools = (() => {
  const steps = values => Object.freeze(values.map(value => Object.freeze(value)));
  const four = steps([[1,0],[-1,0],[0,1],[0,-1]]);
  const eight = steps([...four,[1,1],[-1,1],[1,-1],[-1,-1]]);
  const integer = (n,lo,hi) => Number.isSafeInteger(n) && n >= lo && n <= hi;

  function visit(seed, marks, id, matches, { width,height,steps,queue }) {
    const startX = seed%width, startY = Math.floor(seed/width);
    let left=startX, right=startX, top=startY, bottom=startY, area=1;
    marks[seed]=id; queue[0]=seed;
    for (let i=0; i<area; i++) {
      const p=queue[i], x=p%width, y=Math.floor(p/width);
      left=Math.min(left,x); right=Math.max(right,x);
      top=Math.min(top,y); bottom=Math.max(bottom,y);
      for (const [dx,dy] of steps) {
        const u=x+dx, v=y+dy;
        if (u<0 || u>=width || v<0 || v>=height) continue;
        const key=v*width+u;
        if (!marks[key] && matches(key)) {
          marks[key]=id;
          queue[area++]=key;
        }
      }
    }
    return { id,area,seed:[startX,startY],rect:{ x:left,y:top,width:right-left+1,height:bottom-top+1 } };
  }

  function region(width,height,point,matches) {
    const start = point[1]*width+point[0];
    if (!matches(start)) return new Uint32Array();
    const queue = new Uint32Array(width*height), marks = new Uint8Array(queue.length);
    const { area } = visit(start,marks,1,matches,{ width,height,steps:four,queue });
    return queue.subarray(0,area);
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

  function staircase(width,height,spec) {
    const { from,axis,direction,lengths } = spec ?? {};
    const inside = point => Array.isArray(point) && point.length === 2 &&
      integer(point[0],0,width-1) && integer(point[1],0,height-1);
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

  return Object.freeze({ four,eight,visit,region,segment,freehand,runs,staircase });
})();

if (typeof module !== 'undefined') module.exports = PixelPaintTools;
