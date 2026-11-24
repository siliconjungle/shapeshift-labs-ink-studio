/* Selection-bounded pixel repairs shared by the Workshop and document editor. */
const PixelCleanup = (() => {
  const tools = typeof PixelPaintTools === 'undefined' ? require('./pixel-paint-tools.js') : PixelPaintTools;
  const craft = typeof PixelCraft === 'undefined' ? require('./pixel-craft.js') : PixelCraft;
  const kinds = Object.freeze(['stair','fragment','outline','cluster']);
  const maxSelection = 2048, maxBudget = 256, defaultBudget = 64;

  function reject(code,message,details) {
    throw Object.assign(new RangeError(message),{ conflicts:[{ code,message,...details }] });
  }

  function plan({ width,height,slots,alpha,clipping,locks,swatches,colors },mask,settings) {
    const { kind,at,swatch,mode,maxChanges = defaultBudget } = settings;
    if (!kinds.includes(kind) || !Number.isSafeInteger(maxChanges) || maxChanges < 1 || maxChanges > maxBudget ||
        (kind === 'cluster' ? !['grow','shrink'].includes(mode) : mode !== undefined) ||
        (at !== undefined && !['cluster','fragment'].includes(kind)) ||
        (swatch !== undefined && (kind !== 'fragment' || !swatches.includes(swatch))))
      throw new TypeError('Choose a cleanup kind and an integer budget from 1 to '+maxBudget+' pixels');
    if (!(mask instanceof Uint8Array) || mask.length !== width*height)
      throw new TypeError('Cleanup needs an explicit selection on the native grid');
    const selected = [];
    for (let p = 0; p < mask.length; p++) if (mask[p]) {
      if (selected.length === maxSelection) reject('cleanup-selection','Select at most '+maxSelection+' pixels for one cleanup');
      selected.push(p);
    }
    if (!selected.length) reject('cleanup-selection','Select the pixels where cleanup may write');
    const inside = (x,y)=>x >= 0 && x < width && y >= 0 && y < height;
    const xy = p=>[p%width,Math.floor(p/width)];
    let seed;
    if (at !== undefined) {
      if (!Array.isArray(at) || at.length !== 2 || !Array.from(at).every(Number.isSafeInteger) || !inside(...at) ||
          !mask[at[1]*width+at[0]])
        reject('cleanup-selection','Choose a seed pixel inside the selection',{ at });
      seed = at[1]*width+at[0];
    }
    const original = p=>slots[p] ?? -1;
    const opacity = p=>original(p) >= 0 ? alpha?.[p] ?? 255 : 255;
    const painted = p=>original(p) >= 0 && opacity(p) > 0;
    const writes = new Map(), slotAt = p=>writes.has(p) ? writes.get(p).slot : painted(p) ? original(p) : -1;
    const neighbors = (p,diagonal = false)=>{
      const [x,y] = xy(p), result = [];
      for (const [dx,dy] of diagonal ? tools.eight : tools.four)
        if (inside(x+dx,y+dy)) result.push((y+dy)*width+x+dx);
      return result;
    };
    function write(p,slot,coverage = 255) {
      if (original(p) === slot && opacity(p) === coverage) return;
      const at = xy(p);
      if (!mask[p]) reject('cleanup-selection','Extend the selection to cover the proposed repair',{ at });
      if (locks?.[p] || clipping && !clipping[p])
        reject(locks?.[p] ? 'protected-pixel' : 'clipped-pixel','Cleanup cannot change this pixel',{ at });
      writes.set(p,{ slot,alpha:coverage });
      if (writes.size > maxChanges)
        reject('cleanup-budget','Cleanup exceeds the '+maxChanges+' pixel budget',{ maxChanges,at });
    }

    function stair() {
      const pixels = selected.filter(painted);
      const pigment = original(pixels[0]);
      const points = pixels.map(xy);
      if (pixels.length < 3 || pixels.some(p=>original(p) !== pigment))
        reject('cleanup-shape','Select one thin staircase in a single swatch');
      const extent = axis=>Math.max(...points.map(point=>point[axis]))-Math.min(...points.map(point=>point[axis]));
      const major = Number(extent(1) > extent(0)), minor = 1-major;
      points.sort((a,b)=>a[major]-b[major]);
      const first = points[0], last = points.at(-1), direction = Math.sign(last[minor]-first[minor]);
      if (!direction || points.some((point,i)=>{
        if (!i) return false;
        const previous = points[i-1], step = (point[minor]-previous[minor])*direction;
        return point[major] !== previous[major]+1 || step < 0 || step > 1;
      })) reject('cleanup-shape','The selected staircase needs one monotone pixel per row or column');
      // Match the new path to the old coverage in order from the first endpoint.
      let i = 0;
      tools.segment(first,last,(x,y)=>{
        const [u,v] = points[++i], previous = v*width+u, next = y*width+x;
        if (previous === next) return;
        if (original(next) !== -1) reject('cleanup-occupied','The repaired staircase would overwrite an authored cell',{ at:[x,y] });
        write(previous,-1);
        write(next,pigment,opacity(previous));
      });
    }

    function fragment() {
      const isolated = p=>painted(p) && neighbors(p,true).every(q=>!painted(q) || original(q) !== original(p));
      const candidates = seed === undefined ? selected.filter(isolated) : [seed].filter(isolated);
      if (candidates.length !== 1) reject('cleanup-shape','Choose one isolated painted pixel to merge');
      const p = candidates[0], votes = new Map(), cardinal = neighbors(p);
      for (const q of neighbors(p,true)) {
        if (!painted(q)) continue;
        const slot = original(q);
        if (!neighbors(q).some(r=>painted(r) && original(r) === slot)) continue;
        const weight = cardinal.includes(q) ? 2 : 1;
        votes.set(slot,(votes.get(slot) ?? 0)+weight);
      }
      const ranked = [...votes].sort((a,b)=>b[1]-a[1] || a[0]-b[0]);
      const target = swatch === undefined ? ranked[0]?.[0] : swatches.indexOf(swatch);
      if (!votes.has(target) || swatch === undefined && ranked[0]?.[1] === ranked[1]?.[1])
        reject('cleanup-shape','Choose a swatch from a neighboring cluster with a clear connection',{ at:xy(p) });
      write(p,target,opacity(p));
    }

    // A local ring check prevents a removal from splitting the stroke or cluster.
    function canRemove(p,slot,diagonal) {
      const full = neighbors(p,true).filter(q=>slotAt(q) === slot);
      const required = neighbors(p,diagonal).filter(q=>slotAt(q) === slot);
      if (required.length < (diagonal ? 2 : 1)) return false;
      const ring = new Set(full), reached = new Set([required[0]]), queue = [required[0]];
      for (const q of queue) for (const next of neighbors(q,diagonal)) if (ring.has(next) && !reached.has(next)) {
        reached.add(next);
        queue.push(next);
      }
      return required.every(q=>reached.has(q));
    }

    function outline() {
      const { result } = craft.analyze({ width,height,slots,opacity:alpha,colors });
      const candidates = selected.filter(p=>result.mark.double[p]);
      if (!candidates.length) reject('cleanup-shape','Select a doubled inside corner on a thin outline');
      for (const p of candidates) if (canRemove(p,original(p),true)) write(p,-1);
    }

    function cluster() {
      const root = seed ?? selected.find(painted);
      if (root === undefined || !painted(root)) reject('cleanup-shape','Include a painted seed from the cluster');
      const pigment = original(root);
      const group = new Set(tools.region(width,height,xy(root),p=>painted(p) && original(p) === pigment));
      if (seed === undefined && selected.some(p=>painted(p) && !group.has(p)))
        reject('cleanup-shape','Select one swatch cluster or specify its seed pixel');
      for (const p of selected) {
        const adjacent = neighbors(p);
        if (mode === 'grow' && original(p) === -1) {
          const donor = adjacent.filter(q=>group.has(q)).sort((a,b)=>a-b)[0];
          if (donor !== undefined && !adjacent.some(q=>painted(q) && original(q) === pigment && !group.has(q)))
            write(p,pigment,opacity(donor));
        } else if (mode === 'shrink' && group.has(p) &&
            (adjacent.length < 4 || adjacent.some(q=>!group.has(q))) &&
            canRemove(p,pigment,false)) write(p,-1);
      }
    }

    ({ stair,fragment,outline,cluster })[kind]();
    const indices = [...writes.keys()].sort((a,b)=>a-b);
    const pixel = (slot,coverage)=>({ state:slot === -2 ? 'knockout' : slot < 0 ? 'clear' : 'paint',
      swatch:swatches[slot] ?? null,
      rgba:slot < 0 ? null : [(colors[slot]>>>16)&255,(colors[slot]>>>8)&255,colors[slot]&255,coverage] });
    return { writes,indices,maxChanges,changes:indices.map(p=>{
      const { slot,alpha } = writes.get(p);
      return { at:xy(p),before:pixel(original(p),opacity(p)),after:pixel(slot,alpha) };
    }) };
  }

  return Object.freeze({ kinds,defaultBudget,maxBudget,maxSelection,plan });
})();
if (typeof module !== 'undefined') module.exports = PixelCleanup;
