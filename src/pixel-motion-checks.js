/* Compare committed, aligned samples on their native art grid. */
const PixelMotionChecks = (() => {
  const craft = typeof PixelCraft === 'undefined' ? require('./pixel-craft.js') : PixelCraft;
  const kinds = Object.freeze({
    highlight:'Highlight drift',cluster:'Unstable clusters',gap:'Lost gaps',flicker:'Flicker'
  });
  const integer = (n,lo,hi)=>Number.isSafeInteger(n) && n >= lo && n <= hi;
  const point = (v,test)=>Array.isArray(v) && v.length === 2 && Array.from(v).every(test);
  const anchor = v=>point(v,n=>Number.isSafeInteger(n*2) && Math.abs(n) <= 8192);
  const record = v=>v && Object.getPrototypeOf(v) === Object.prototype;
  const id = v=>typeof v === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(v);
  const maxCells = 8_000_000, maxFrames = 128, maxFindings = 512;
  const xy = (p,w)=>[p%w,Math.floor(p/w)];
  const luma = color=>.299*(color>>>16)+.587*((color>>>8)&255)+.114*(color&255);
  const inGrid = (x,y,w,h)=>x >= 0 && y >= 0 && x < w && y < h;
  const rgba = n=>[n>>>24,n>>>16&255,n>>>8&255,n&255];
  const sameOwner = (a,b)=>!a || !b || a === b;
  const cardinal = [[1,0],[-1,0],[0,1],[0,-1]];

  function settings(value = {}) {
    if (!record(value) || Object.keys(value).some(key=>!['alignment','coverage','colorDelta','drift','search','highlights','ignore'].includes(key)))
      throw new TypeError('Unknown pixel motion setting');
    const { alignment = 'registered',coverage = 128,colorDelta = 18,drift = .5,search = 3,highlights,ignore = [] } = value;
    if (!['registered','screen','surface'].includes(alignment) || !integer(coverage,1,255) ||
        !integer(colorDelta,1,255) || !Number.isFinite(drift) || drift < 0 ||
        !integer(search,1,8) || drift > search ||
        (highlights !== undefined && (!Array.isArray(highlights) || highlights.length > 48 ||
          !Array.from(highlights).every(color=>typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color)))) ||
        !Array.isArray(ignore) || ignore.length > 128)
      throw new TypeError('Invalid motion alignment, threshold, highlight colors, or exception list');
    for (const row of ignore) {
      if (!record(row) || Object.keys(row).some(key=>!['kind','sample','rect','reason'].includes(key)) ||
          !Object.hasOwn(kinds,row.kind) || !id(row.sample) || typeof row.reason !== 'string' || !row.reason.trim() ||
          (row.rect !== undefined && (!Array.isArray(row.rect) || row.rect.length !== 4 ||
            !Array.from(row.rect).every((n,i)=>integer(n,i<2 ? 0 : 1,512)))))
        throw new TypeError('Motion exceptions need a check, sample ID, reason, and optional native rectangle');
    }
    return { alignment,coverage,colorDelta,drift,search,highlights,ignore };
  }

  function budget(w,h,count) {
    if (!integer(w,1,512) || !integer(h,1,512) || !integer(count,1,maxFrames) || w*h*count > maxCells)
      throw new RangeError('Motion checks need up to 128 samples and eight million native pixels');
  }

  function registration(guides = [],guide) {
    const candidates = guides.filter(row=>['registration','pivot'].includes(row.kind));
    if (guide !== undefined) {
      const found = candidates.find(row=>row.id === guide);
      if (!found) throw new RangeError('Unknown motion registration guide '+guide);
      return found.at;
    }
    const markers = candidates.filter(row=>row.kind === 'registration');
    if (markers.length === 1) return markers[0].at;
    if (!markers.length && candidates.length === 1) return candidates[0].at;
  }

  function fromRaster(raster,metadata) {
    const { width,height,slots,opacity,colors,mixedColors,owners,layerIds } = raster;
    const bytes = new Uint8Array(width*height*4);
    for (let p = 0; p < slots.length; p++) {
      const slot = slots[p], alpha = opacity?.[p] ?? 255;
      if (slot == null || slot < 0 || !alpha) continue;
      const color = mixedColors?.[p] ?? colors[slot], offset = p*4;
      bytes[offset] = color>>>16;
      bytes[offset+1] = color>>>8;
      bytes[offset+2] = color;
      bytes[offset+3] = alpha;
    }
    return { ...metadata,width,height,rgba:bytes,owners,ownerNames:layerIds };
  }

  function normalize(frame,threshold,names) {
    const { width,height,rgba,owners,ownerNames } = frame, size = width*height;
    if (!(rgba instanceof Uint8Array || rgba instanceof Uint8ClampedArray) || rgba.length !== size*4 ||
        (owners && (!ArrayBuffer.isView(owners) || owners.length !== size)) ||
        (frame.valid && (frame.valid.length !== size || frame.vectors?.length !== size*2)))
      throw new TypeError('Motion samples need native RGBA bytes and aligned owner and motion data');
    const pixels = new Uint32Array(size), labels = new Uint32Array(size), bg = new Uint8Array(size);
    for (let p = 0; p < size; p++) {
      const i = p*4, a = rgba[i+3];
      pixels[p] = a ? (rgba[i]<<24)|(rgba[i+1]<<16)|(rgba[i+2]<<8)|a : 0;
      bg[p] = Number(a < threshold);
      const owner = ownerNames?.[owners?.[p]];
      if (owner == null || bg[p]) continue;
      if (!names.has(owner)) names.set(owner,names.size+1);
      labels[p] = names.get(owner);
    }
    return { ...frame,pixels,labels,bg };
  }

  function connect(a,b,mode) {
    if (b.cut) return { skipped:'cut' };
    const { width:w,height:h,pixels } = b;
    let dx = 0, dy = 0;
    if (mode === 'registered') {
      if (a.anchor && b.anchor) {
        dx = a.anchor[0]-b.anchor[0];
        dy = a.anchor[1]-b.anchor[1];
        if (!Number.isInteger(dx) || !Number.isInteger(dy)) return { skipped:'fractional-registration' };
      } else if (a.anchor || b.anchor) return { skipped:'missing-registration' };
      else if (a.cameraKey !== b.cameraKey) return { skipped:'unregistered-camera' };
    }
    const prior = new Int32Array(pixels.length).fill(-1), next = prior.slice();
    for (let p = 0; p < pixels.length; p++) {
      const [x,y] = xy(p,w);
      if (mode === 'surface' && !b.valid?.[p]) continue;
      const u = mode === 'surface' ? Math.round(x-b.vectors[2*p]) : x+dx;
      const v = mode === 'surface' ? Math.round(y-b.vectors[2*p+1]) : y+dy;
      if (!inGrid(u,v,w,h)) continue;
      const q = v*w+u;
      if (mode === 'surface' && (a.bg[q] || b.bg[p] || !sameOwner(a.labels[q],b.labels[p]))) continue;
      if (next[q] !== -1) {
        if (next[q] >= 0) prior[next[q]] = -1;
        next[q] = -2;
        continue;
      }
      prior[p] = q;
      next[q] = p;
    }
    const pairedPixels = prior.reduce((n,p)=>n+Number(p >= 0),0);
    return { prior,next,pairedPixels,...(mode !== 'surface' && { shift:[-dx || 0,-dy || 0] }) };
  }

  function clusters(frame,highlightColors) {
    const { width:w,height:h,pixels,bg,labels:owners } = frame, labels = new Uint32Array(bg.length);
    const parts = [null], queue = new Uint32Array(bg.length);
    for (let p = 0; p < bg.length; p++) {
      if (bg[p] || labels[p]) continue;
      const label = parts.length, color = pixels[p]>>>8, owner = owners[p], light = luma(color);
      let size = 1, sx = 0, sy = 0, dark = false;
      queue[0] = p;
      labels[p] = label;
      for (let i = 0; i < size; i++) {
        const [x,y] = xy(queue[i],w);
        sx += x;
        sy += y;
        for (const [dx,dy] of cardinal) {
          const u = x+dx, v = y+dy, q = v*w+u;
          if (!inGrid(u,v,w,h) || bg[q] || owners[q] !== owner) continue;
          if (pixels[q]>>>8 !== color) {
            if (light-luma(pixels[q]>>>8) >= 24) dark = true;
            continue;
          }
          if (labels[q]) continue;
          labels[q] = label;
          queue[size++] = q;
        }
      }
      const highlight = size <= 8 && (highlightColors ? highlightColors.has(color) : light >= 195 && dark);
      parts.push({ label,p,owner,color,size,center:[sx/size,sy/size],highlight });
    }
    return { labels,parts };
  }

  function changes(a,b,map,options,colors) {
    const { width:w,height:h,bg } = b, size = bg.length;
    const mark = { highlight:new Uint8Array(size),cluster:new Uint8Array(size),gap:new Uint8Array(size) };
    const details = new Map(), old = a.groups ??= clusters(a,colors), now = b.groups ??= clusters(b,colors);
    const forwards = new Map(), backwards = new Map();
    function link(graph,from,to) {
      if (!graph.has(from)) graph.set(from,new Set());
      graph.get(from).add(to);
    }
    const holes = craft.pockets(w,h,a.bg);
    for (const [x,y] of a.gaps ?? []) if (inGrid(x,y,w,h) && a.bg[y*w+x]) holes[y*w+x] = 1;
    for (let p = 0; p < size; p++) {
      const q = map.prior[p];
      if (q < 0 || bg[p]) continue;
      if (holes[q]) mark.gap[p] = 1;
      const before = old.labels[q], after = now.labels[p];
      if (before && after && a.pixels[q]>>>8 === b.pixels[p]>>>8 && a.labels[q] === b.labels[p]) {
        link(forwards,before,after);
        link(backwards,after,before);
      }
    }
    const splits = [...forwards.values()].filter(links=>links.size > 1);
    const merges = [...backwards].filter(([,links])=>links.size > 1);
    const unstable = new Set([...splits.flatMap(links=>[...links]),...merges.map(([label])=>label)]);
    const candidates = [];
    for (const part of now.parts) {
      if (!part?.highlight || map.prior[part.p] < 0) continue;
      const [x,y] = xy(map.prior[part.p],w), [u,v] = xy(part.p,w);
      const expected = [part.center[0]+x-u,part.center[1]+y-v];
      const found = new Set();
      for (let row = Math.max(0,y-options.search); row <= Math.min(h-1,y+options.search); row++)
        for (let col = Math.max(0,x-options.search); col <= Math.min(w-1,x+options.search); col++) {
          const label = old.labels[row*w+col];
          if (label) found.add(label);
        }
      const nearby = [...found].map(label=>old.parts[label]).filter(prior=>
        prior.highlight && prior.color === part.color && prior.owner === part.owner && prior.size === part.size)
        .map(prior=>({ part,prior,distance:Math.hypot(expected[0]-prior.center[0],expected[1]-prior.center[1]) }))
        .filter(row=>row.distance <= options.search).sort((a,b)=>a.distance-b.distance);
      if (nearby.length && nearby[0].distance !== nearby[1]?.distance) candidates.push(nearby[0]);
    }
    const uses = new Map();
    for (const row of candidates) uses.set(row.prior.label,(uses.get(row.prior.label) ?? 0)+1);
    const drifting = new Map(candidates.filter(row=>uses.get(row.prior.label) === 1 && row.distance > options.drift)
      .map(row=>[row.part.label,row]));
    for (let p = 0; p < size; p++) {
      const label = now.labels[p];
      if (unstable.has(label)) mark.cluster[p] = 1;
      const drift = drifting.get(label);
      if (drift) {
        mark.highlight[p] = 1;
        details.set(p,{ prior:drift.prior.p, distance:drift.distance, from:drift.prior.center,to:drift.part.center });
      }
    }
    return { mark,details,splits:splits.length,merges:merges.length };
  }

  function audit(frames,raw) {
    const options = settings(raw);
    const w = frames[0]?.width, h = frames[0]?.height;
    budget(w,h,frames.length);
    const names = new Map(), ids = new Set(), transitions = [], findings = [], exceptions = [];
    const counts = Object.fromEntries(Object.keys(kinds).map(kind=>[kind,{ regions:0,pixels:0,acceptedPixels:0 }]));
    for (const frame of frames) {
      if (!id(frame.id) || ids.has(frame.id) || frame.width !== w || frame.height !== h ||
          (frame.anchor !== undefined && !anchor(frame.anchor)))
        throw new TypeError('Motion samples need unique IDs, a common native grid and finite pixel anchors');
      ids.add(frame.id);
    }
    if (options.ignore.some(row=>!ids.has(row.sample) || row.rect && (row.rect[0]+row.rect[2]>w || row.rect[1]+row.rect[3]>h)))
      throw new RangeError('Motion exceptions must address a known sample and stay inside the native grid');
    const highlightColors = options.highlights && new Set(options.highlights.map(color=>Number.parseInt(color.slice(1),16)));
    const sample = (frame,p)=>({ sample:frame.id,at:p < 0 ? null : xy(p,w),rgba:p < 0 ? null : rgba(frame.pixels[p]),
      owner:p < 0 ? null : frame.ownerNames?.[frame.owners?.[p]] ?? null });
    function recordMarks(mark,atIndex,frame,evidence,extra) {
      for (const [kind,flags] of Object.entries(mark)) for (const row of options.ignore) {
        if (row.sample !== frame.id || row.kind !== kind) continue;
        const [x,y,width,height] = row.rect ?? [0,0,w,h];
        let pixels = 0;
        for (let v = y; v < Math.min(h,y+height); v++) for (let u = x; u < Math.min(w,x+width); u++) {
          const p = v*w+u;
          if (!flags[p]) continue;
          flags[p] = 0;
          pixels++;
        }
        if (pixels) {
          counts[kind].acceptedPixels += pixels;
          exceptions.push({ ...row,pixels });
        }
      }
      for (const finding of craft.regions(mark,w,h,undefined,frame.labels,[null,...names.keys()])) {
        counts[finding.kind].regions++;
        counts[finding.kind].pixels += finding.pixelCount;
        if (findings.length === maxFindings) continue;
        const p = finding.at[1]*w+finding.at[0];
        findings.push({ ...finding,id:frame.id+'/'+finding.id,sample:frame.id,index:atIndex,
          evidence:evidence(p,finding.kind),...(finding.kind === 'highlight' && { drift:extra(p) }) });
      }
    }
    let older, previous = normalize(frames[0],options.coverage,names), incoming;
    for (let i = 1; i < frames.length; i++) {
      const current = normalize(frames[i],options.coverage,names), map = connect(previous,current,options.alignment);
      const summary = { from:previous.id,to:current.id };
      transitions.push(summary);
      if (map.skipped || !map.pairedPixels) summary.skipped = map.skipped ?? 'no-correspondences';
      else {
        const { mark,details,splits,merges } = changes(previous,current,map,options,highlightColors);
        Object.assign(summary,{ pairedPixels:map.pairedPixels,...(map.shift && { shift:map.shift }),splits,merges });
        recordMarks(mark,i,current,(p,kind)=>[sample(previous,kind === 'highlight' ? details.get(p)?.prior ?? map.prior[p] : map.prior[p]),
          sample(current,p)],p=>details.get(p));
        if (incoming?.pairedPixels) {
          const flicker = new Uint8Array(w*h);
          for (let p = 0; p < flicker.length; p++) {
            const q = incoming.prior[p], r = map.next[p];
            if (q < 0 || r < 0 || older.pixels[q] !== current.pixels[r] ||
                !sameOwner(older.labels[q],current.labels[r]) || !sameOwner(older.labels[q],previous.labels[p]) ||
                !sameOwner(previous.labels[p],current.labels[r]) || older.bg[q] && previous.bg[p] && current.bg[r]) continue;
            const a = rgba(older.pixels[q]), b = rgba(previous.pixels[p]);
            if (a.some((n,c)=>Math.abs(n-b[c]) >= options.colorDelta)) flicker[p] = 1;
          }
          recordMarks({ flicker },i-1,previous,p=>[sample(older,incoming.prior[p]),sample(previous,p),sample(current,map.next[p])]);
        }
      }
      older = previous;
      previous = current;
      incoming = map;
    }
    return { format:'ink-studio/pixel-motion-review',version:1,grid:[w,h],settings:options,
      samples:frames.map(({ id,label,time,durationMs,anchor,cut,camera })=>({ id,label:label ?? id,time,durationMs,anchor,cut,camera })),
      transitions,counts,exceptions,findings,
      truncated:Object.values(counts).reduce((n,row)=>n+row.regions,0) > findings.length };
  }

  return Object.freeze({ audit,settings,budget,registration,fromRaster,kinds });
})();
if (typeof module !== 'undefined') module.exports = PixelMotionChecks;
