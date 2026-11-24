/* Exact native-grid paths and connected regions used by raster tools. */
const PixelPaintTools = (() => {
  const steps = values => Object.freeze(values.map(value => Object.freeze(value)));
  const four = steps([[1,0],[-1,0],[0,1],[0,-1]]);
  const eight = steps([...four,[1,1],[-1,1],[1,-1],[-1,-1]]);

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

  function runs(width,indices) {
    const result = [];
    for (const p of indices) {
      const x = p%width, y = Math.floor(p/width), last = result.at(-1);
      if (last && last[0] === y && last[1]+last[2] === x) last[2]++;
      else result.push([y,x,1]);
    }
    return result;
  }

  return Object.freeze({ four,eight,visit,region,segment,runs });
})();

if (typeof module !== 'undefined') module.exports = PixelPaintTools;
