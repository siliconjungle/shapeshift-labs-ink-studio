/* Indexed clipboard and floating selections on the native art grid. */
const PixelSelectionTransforms = (() => {
  const brushes = typeof PixelBrushes === 'undefined' ? require('./pixel-brushes.js') : PixelBrushes;
  const format = 'ink-studio/pixel-clipboard';
  const fields = (value,keys) => value && Object.getPrototypeOf(value) === Object.prototype &&
    Object.keys(value).every(key=>keys.includes(key));
  const integer = (n,min,max) => Number.isSafeInteger(n) && n >= min && n <= max;
  const pair = (value,min,max) => Array.isArray(value) && value.length === 2 &&
    Array.from(value).every(n=>integer(n,min,max));
  const rgb = value => typeof value === 'string' && /^#[a-f\d]{6}$/i.test(value);
  const id = value => typeof value === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(value);

  function validate(clip) {
    if (!fields(clip,['format','version','width','height','origin','palette','slots','alpha']) ||
        clip.format !== format || ![1,2].includes(clip.version) || !integer(clip.width,1,512) || !integer(clip.height,1,512) ||
        !pair(clip.origin,0,511) || !Array.isArray(clip.palette) || clip.palette.length > 255 ||
        !Array.from(clip.palette).every(value=>fields(value,['id','color']) && rgb(value.color) &&
          (value.id === undefined || id(value.id))) ||
        !Array.isArray(clip.slots) || clip.slots.length !== clip.width*clip.height ||
        !Array.from(clip.slots).every(value=>value === null || integer(value,-2,clip.palette.length-1)) ||
        !clip.slots.some(value=>value !== null) ||
        clip.alpha !== undefined && (!Array.isArray(clip.alpha) || clip.alpha.length !== clip.slots.length ||
          !Array.from(clip.alpha).every(value=>integer(value,0,255))))
      throw new TypeError('Invalid indexed pixel clipboard');
    return clip;
  }

  function selectionBounds(width,height,mask) {
    let left = width, right = -1, top = height, bottom = -1;
    for (let p = 0; p < mask.length; p++) {
      if (!mask[p]) continue;
      const x = p%width, y = Math.floor(p/width);
      left = Math.min(left,x); right = Math.max(right,x);
      top = Math.min(top,y); bottom = Math.max(bottom,y);
    }
    if (right >= left) return [left,top,right-left+1,bottom-top+1];
  }

  function capture(width,height,{ slots,alpha,palette },mask) {
    if (!integer(width,1,512) || !integer(height,1,512) ||
        !(mask instanceof Uint8Array) || mask.length !== width*height || slots.length !== mask.length)
      throw new RangeError('Capture needs a native selection on the pixel grid');
    const bounds = selectionBounds(width,height,mask);
    if (!bounds) throw new RangeError('Select at least one pixel to capture');
    const [left,top,w,h] = bounds;
    const colors = [], indices = new Map(), out = [], opacity = [];
    for (let y = top; y < top+h; y++) for (let x = left; x < left+w; x++) {
      const p = y*width+x;
      let slot = mask[p] ? slots[p] ?? -1 : null, coverage = 255;
      if (slot !== null && slot >= 0) {
        const { id,color } = palette[slot];
        if (!indices.has(slot)) {
          indices.set(slot,colors.length);
          colors.push({ ...(id !== undefined && { id }),color });
        }
        coverage = alpha?.[p] ?? 255;
        slot = indices.get(slot);
      }
      out.push(slot);
      opacity.push(coverage);
    }
    return validate({ format,version:2,width:w,height:h,origin:[left,top],
      palette:colors,slots:out,...(opacity.some(value=>value !== 255) && { alpha:opacity }) });
  }

  function geometry(clip,settings,maxSize=512) {
    if (!fields(settings,['at','offset','angle','size','flipX','flipY','rotation']))
      throw new TypeError('Invalid pixel transform settings');
    const { at,offset,angle = 0,size = [clip.width,clip.height],flipX = false,flipY = false,rotation = 'nearest' } = settings;
    if ((at !== undefined && offset !== undefined) || (at !== undefined && !pair(at,-4096,4096)) ||
        (offset !== undefined && !pair(offset,-4096,4096)) || !pair(size,1,maxSize) ||
        typeof flipX !== 'boolean' || typeof flipY !== 'boolean' ||
        !Number.isFinite(angle) || Math.abs(angle) > 360000 || !['nearest','pixel-aware'].includes(rotation))
      throw new RangeError('Use integer pixel positions and dimensions, a finite angle, and nearest or pixel-aware rotation');
    const [x,y] = at ?? clip.origin.map((value,i)=>value+(offset?.[i] ?? 0)), [w,h] = size;
    const turn = ((angle%360)+360)%360, rightAngle = turn%90 === 0, radians = turn*Math.PI/180;
    const cos = rightAngle ? [1,0,-1,0][turn/90] : Math.cos(radians);
    const sin = rightAngle ? [0,1,0,-1][turn/90] : Math.sin(radians);
    // Keep the center on the original lattice parity during oblique turns so a one-pixel tip has a sample.
    const extent = (value,original) => {
      const rounded = Math.ceil(value);
      return rightAngle || rounded%2 === original%2 ? rounded : rounded+1;
    };
    const ow = extent(Math.abs(cos)*w+Math.abs(sin)*h,w);
    const oh = extent(Math.abs(sin)*w+Math.abs(cos)*h,h);
    return { x,y,ow,oh,scaleX:clip.width/w,scaleY:clip.height/h,w,h,flipX,flipY,cos,sin,rightAngle,
      refine:rotation === 'pixel-aware' && !rightAngle };
  }

  // Scale2x corner rules, sampled on demand before inverse rotation.
  function corner(clip,x,y,fx,fy) {
    const { width,height,slots,alpha } = clip, p = y*width+x;
    const above = y ? p-width : p, below = y+1 < height ? p+width : p;
    const left = x ? p-1 : p, right = x+1 < width ? p+1 : p;
    const same = (a,b) => slots[a] === slots[b] &&
      (slots[a] === null || slots[a] < 0 || alpha?.[a] === alpha?.[b]);
    if (same(above,below) || same(left,right)) return p;
    const h = fx < .5 ? left : right, v = fy < .5 ? above : below;
    return same(h,v) ? h : p;
  }

  function resample(clip,g,included) {
    const { ow,oh,cos,sin,flipX,flipY,scaleX,scaleY,refine } = g;
    const samples = new Int32Array(ow*oh).fill(-1);
    let left = ow, top = oh, right = -1, bottom = -1;
    for (let row = 0; row < oh; row++) for (let col = 0; col < ow; col++) {
      const u = col+.5-ow/2, v = row+.5-oh/2;
      const sx = (cos*u+sin*v+g.w/2)*scaleX, sy = (-sin*u+cos*v+g.h/2)*scaleY;
      const i = Math.floor(sx), j = Math.floor(sy);
      if (!integer(i,0,clip.width-1) || !integer(j,0,clip.height-1)) continue;
      const a = flipX ? clip.width-1-i : i, b = flipY ? clip.height-1-j : j;
      const from = refine ? corner(clip,a,b,flipX ? 1-(sx-i) : sx-i,flipY ? 1-(sy-j) : sy-j) : b*clip.width+a;
      if (!included(from)) continue;
      samples[row*ow+col] = from;
      left = Math.min(left,col); right = Math.max(right,col);
      top = Math.min(top,row); bottom = Math.max(bottom,row);
    }
    // Hidden rotation padding keeps centers on the pixel lattice. Exclude it from placement.
    if (g.rightAngle || right < left) return { samples,left:0,top:0,right:ow-1,bottom:oh-1 };
    return { samples,left,top,right,bottom };
  }

  function placement(clip,settings,included,emit,maxSize) {
    const g = geometry(clip,settings,maxSize), { x,y,ow } = g;
    const { samples,left,top,right,bottom } = resample(clip,g,included);
    for (let row = top; row <= bottom; row++) for (let col = left; col <= right; col++) {
      const from = samples[row*ow+col];
      if (from >= 0) emit(x+col-left,y+row-top,from);
    }
    return [x,y,right-left+1,bottom-top+1];
  }

  // Atlas callers keep raw colors and slot IDs. Use the same geometry and sampling without a clipboard palette.
  function placeMask(width,height,mask,origin,settings,emit,maxSize=512) {
    if (!integer(width,1,maxSize) || !integer(height,1,maxSize) || !pair(origin,0,4096) ||
        !(mask instanceof Uint8Array) || mask.length !== width*height ||
        !fields(settings,['at','offset','size','flipX','flipY']))
      throw new TypeError('Mask placement needs a native grid, atlas origin, and whole-pixel transform settings');
    const local = selectionBounds(width,height,mask);
    if (!local) return;
    const [x,y,w,h] = local, at = [origin[0]+x,origin[1]+y];
    const sourceIndex = p => (y+Math.floor(p/w))*width+x+p%w;
    const bounds = placement({ width:w,height:h,origin:at },settings,
      p=>mask[sourceIndex(p)],(u,v,p)=>emit(u,v,sourceIndex(p)),maxSize);
    return { sourceBounds:[...at,w,h],bounds };
  }

  function stage(width,height,current,raw,settings = {},{ move = false, named = false, limit = 255, captureSources = false } = {}) {
    if (!integer(width,1,512) || !integer(height,1,512) || current?.slots?.length !== width*height ||
        !Array.isArray(current.palette) || current.alpha !== undefined && current.alpha.length !== current.slots.length)
      throw new RangeError('A transform needs a native target raster and its palette');
    const clip = validate(raw);
    const native = (u,v) => integer(u,0,width-1) && integer(v,0,height-1);
    const mask = new Uint8Array(width*height), placed = new Map(), used = new Set(), writes = new Map();
    const sources = captureSources ? new Map() : undefined;
    let clippedPixels = 0;
    const set = (p,slot,alpha = 255) => { writes.set(p,{ slot,alpha }); };

    if (move) {
      const [left,top] = clip.origin;
      for (let p = 0; p < clip.slots.length; p++) {
        const u = left+p%clip.width, v = top+Math.floor(p/clip.width);
        if (clip.slots[p] !== null && clip.slots[p] !== -1 && native(u,v)) set(v*width+u,-1);
      }
    }
    const bounds = placement(clip,settings,p=>clip.slots[p] !== null,(u,v,from)=>{
      const slot = clip.slots[from];
      if (!native(u,v)) { clippedPixels++; return; }
      const p = v*width+u;
      mask[p] = 1;
      if (sources) {
        const [u,v] = clip.origin;
        sources.set(p,(v+Math.floor(from/clip.width))*width+u+from%clip.width);
      }
      if (slot === -1) return;
      placed.set(p,from);
      if (slot >= 0) used.add(slot);
    });

    const { palette,mapping } = brushes.resolvePalette({ palette:clip.palette,settings:{ swatch:{ mode:'original' } } },
      current.palette,{ named,limit,used,preserveIds:named && clip.version === 2 });
    for (const [p,from] of placed) {
      const slot = clip.slots[from];
      set(p,slot < 0 ? slot : mapping[slot],slot < 0 ? 255 : clip.alpha?.[from] ?? 255);
    }
    for (const [p,{ slot,alpha }] of writes) {
      const before = current.slots[p] ?? -1;
      if (slot === before && alpha === (before < 0 ? 255 : current.alpha?.[p] ?? 255)) writes.delete(p);
    }
    return { mask,palette,writes,bounds,clippedPixels,...(sources && { sources }) };
  }

  return Object.freeze({ format,validate,capture,stage,placeMask });
})();

if (typeof module !== 'undefined') module.exports = PixelSelectionTransforms;
