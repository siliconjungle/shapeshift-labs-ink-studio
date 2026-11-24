/* Named native pixel locks shared by the document editor and Workshop. */
const PixelProtection = (() => {
  const kinds = Object.freeze(['pixel','gap','contour','accent']);
  const validId = id => typeof id === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(id);
  const point = (width,height,xy) => Array.isArray(xy) && xy.length === 2 &&
    Number.isSafeInteger(xy[0]) && xy[0] >= 0 && xy[0] < width &&
    Number.isSafeInteger(xy[1]) && xy[1] >= 0 && xy[1] < height;

  function validate(details,width,height,frames) {
    if (details === undefined) return;
    if (!Array.isArray(details)) throw new TypeError('Protected pixel details must be an array');
    const ids = new Set(), order = new Map(frames.map((id,i)=>[id,i]));
    for (const row of details) {
      if (!row || Object.getPrototypeOf(row) !== Object.prototype ||
          Object.keys(row).some(key=>!['id','kind','frame','frames','pixels'].includes(key)) ||
          !validId(row.id) || ids.has(row.id) || !Array.isArray(row.pixels) ||
          row.kind !== undefined && (!kinds.includes(row.kind) || !row.pixels.length) ||
          row.frame !== undefined && (!validId(row.frame) || !order.has(row.frame) || row.frames !== undefined) ||
          row.frames !== undefined && (!Array.isArray(row.frames) || row.frames.length !== 2 ||
            !Array.from(row.frames).every(id=>validId(id) && order.has(id)) || order.get(row.frames[0]) > order.get(row.frames[1])))
        throw new TypeError('Protected pixel details need unique IDs, pixel lists, and optional known frames in document order');
      ids.add(row.id);
      const pixels = new Set();
      for (const xy of row.pixels) {
        if (!point(width,height,xy)) throw new RangeError('Protected detail '+row.id+' has a pixel outside the native grid');
        const p = xy[1]*width+xy[0];
        if (pixels.has(p)) throw new RangeError('Protected detail '+row.id+' repeats pixel '+xy.join(','));
        pixels.add(p);
      }
    }
  }

  function active(details,frames,index) {
    return (details ?? []).filter(row=>row.frames ? index >= frames.indexOf(row.frames[0]) && index <= frames.indexOf(row.frames[1]) :
      row.frame === undefined || row.frame === frames[index]);
  }

  const at = (details,x,y) => details.filter(row=>row.pixels.some(xy=>xy[0] === x && xy[1] === y))
    .map(({ id,kind = 'pixel',frame,frames })=>({ id,kind,...(frame && { frame }),...(frames && { frames }) }));

  function pigment(raster,p) {
    const slot = raster.slots[p];
    const alpha = !(slot >= 0) ? 0 : (raster.opacity?.[p] ?? 255);
    return alpha ? [raster.swatches[slot],raster.mixedColors?.[p] ?? raster.colors[slot],alpha] : [null,null,0];
  }

  function same(left,a,right,b) {
    const before = pigment(left,a), after = pigment(right,b);
    return before.every((value,i)=>value === after[i]);
  }

  function paintLocks(details,width,raster,{ validateGaps = true } = {}) {
    for (const row of details) for (const [x,y] of row.pixels) {
      const p = y*width+x;
      if (validateGaps && row.kind === 'gap' && pigment(raster,p)[2])
        throw new RangeError('Protected gap '+row.id+' must be transparent at '+[x,y].join(', '));
      raster.locks[p] = 1;
    }
  }

  function changed(details,width,before,after) {
    for (const row of details) for (const [x,y] of row.pixels) {
      const p = y*width+x;
      if (!same(before,p,after,p)) return { id:row.id,at:[x,y] };
    }
  }

  // Use all nearest copies, and give an unsampled protected cell its center's output pixel.
  function remap(map,details,region,onLoss) {
    const [width] = map.before, [w,h] = map.size;
    const sources = new Map();
    for (const detail of details ?? []) if (detail.kind)
      for (const [x,y] of detail.pixels) sources.set(y*width+x,[]);
    for (let p = 0; p < map.index.length; p++) sources.get(map.index[p])?.push(p);
    for (const [source,targets] of sources) {
      if (targets.length) continue;
      const x = Math.floor((source%width+.5-map.offset[0])/map.scale[0]);
      const y = Math.floor((Math.floor(source/width)+.5-map.offset[1])/map.scale[1]);
      if (x >= 0 && x < w && y >= 0 && y < h) targets.push(y*w+x);
    }
    const rows = details?.map(row=>{
      if (!row.kind) {
        const { pixels,discarded } = region(map,row.pixels);
        if (discarded) onLoss?.(row.id,discarded);
        return { ...row,pixels };
      }
      const indices = new Set();
      for (const [x,y] of row.pixels) {
        const targets = sources.get(y*width+x);
        if (!targets.length) throw new RangeError('Canvas transform would discard protected detail '+row.id+' at '+[x,y].join(', '));
        for (const p of targets) indices.add(p);
      }
      const pixels = [...indices].sort((a,b)=>a-b).map(p=>[p%w,Math.floor(p/w)]);
      return { ...row,pixels };
    });
    function forFrame(activeRows,raster) {
      const chosen = new Map();
      for (const row of activeRows) if (row.kind) for (const [x,y] of row.pixels) {
        const source = y*width+x;
        for (const p of sources.get(source)) {
          if (chosen.has(p) && !same(raster,chosen.get(p),raster,source))
            throw new RangeError('Canvas transform would combine different protected pixels at '+[p%w,Math.floor(p/w)].join(', '));
          chosen.set(p,source);
        }
      }
      if (!chosen.size) return map;
      const index = map.index.slice();
      for (const [p,source] of chosen) index[p] = source;
      return { ...map,index,protectedSamples:chosen };
    }
    return { rows,forFrame };
  }

  function carry(details,frame,width,selection,sources) {
    const bySource = new Map(), moved = new Map(), checks = [];
    for (const [p,source] of sources) {
      if (!bySource.has(source)) bySource.set(source,[]);
      bySource.get(source).push(p);
    }
    for (const row of details) {
      const pixels = row.pixels.map(([x,y])=>y*width+x);
      if (!pixels.some(p=>selection[p])) continue;
      if (!row.kind || !row.frame || row.frame !== frame || !pixels.every(p=>selection[p]))
        throw new RangeError('Select all pixels of a detail locked to this frame to carry '+row.id);
      const targets = new Set();
      for (const source of pixels) {
        const mapped = bySource.get(source);
        if (!mapped?.length) throw new RangeError('Transform would discard protected detail '+row.id);
        for (const p of mapped) {
          targets.add(p);
          checks.push({ id:row.id,source,target:p });
        }
      }
      moved.set(row.id,{ ...row,pixels:[...targets].sort((a,b)=>a-b).map(p=>[p%width,Math.floor(p/width)]) });
    }
    const remaining = details.filter(row=>!moved.has(row.id)).flatMap(row=>row.pixels);
    const locked = new Set(remaining.map(([x,y])=>y*width+x));
    return { moved,checks,locked };
  }

  function carriedChange(carry,width,before,after) {
    const check = carry.checks.find(({ source,target })=>!same(before,source,after,target));
    return check && { id:check.id,at:[check.target%width,Math.floor(check.target/width)] };
  }

  return Object.freeze({ kinds,validate,active,at,paintLocks,changed,remap,carry,carriedChange });
})();
if (typeof module !== 'undefined') module.exports = PixelProtection;
