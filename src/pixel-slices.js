/* Native slice rectangles, held registration keys, and stretch guides. */
const PixelSlices = (() => {
  const id = value=>typeof value === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(value);
  const label = value=>value === undefined || typeof value === 'string' && !!value.trim();
  const fields = (value,keys)=>value && Object.getPrototypeOf(value) === Object.prototype &&
    Object.keys(value).every(key=>keys.includes(key));
  const vector = (value,n,test)=>Array.isArray(value) && value.length === n && Array.from(value).every(test);
  const integer = n=>Number.isSafeInteger(n) && n >= 0;
  const half = n=>typeof n === 'number' && Number.isSafeInteger(n*2) && Math.abs(n) <= 8192;

  function prepare(rows,frameIds,width,height) {
    if (rows === undefined) return;
    if (!Array.isArray(rows) || rows.length > 256) throw new RangeError('Use a list of up to 256 pixel slices');
    const known = new Set(frameIds), slices = new Set();
    for (const slice of rows) {
      if (!fields(slice,['id','label','keys']) || !id(slice.id) || !label(slice.label) || slices.has(slice.id) ||
          !Array.isArray(slice.keys) || slice.keys.length > known.size)
        throw new TypeError('Pixel slices need a unique ID and a list of frame keys');
      slices.add(slice.id);
      const keys = new Set();
      for (const key of slice.keys) {
        if (!fields(key,['frame','bounds','pivot','nineSlice']) || !id(key.frame) || !known.has(key.frame) || keys.has(key.frame))
          throw new TypeError('Slice '+slice.id+' needs distinct keys on known frames');
        keys.add(key.frame);
        if (key.bounds === null && key.pivot === undefined && key.nineSlice === undefined) continue;
        if (!vector(key.bounds,4,integer)) throw new RangeError('Slice '+slice.id+' needs integer [x,y,width,height] bounds');
        const [x,y,w,h] = key.bounds;
        if (w < 1 || h < 1 || x+w > width || y+h > height)
          throw new RangeError('Slice '+slice.id+' bounds must be inside the native canvas');
        if (key.pivot !== undefined && !vector(key.pivot,2,half))
          throw new RangeError('Slice '+slice.id+' pivot needs finite half-pixel coordinates');
        if (key.nineSlice !== undefined) {
          if (!vector(key.nineSlice,4,integer))
            throw new RangeError('Slice '+slice.id+' nine-slice needs [left,top,right,bottom] insets');
          const [left,top,right,bottom] = key.nineSlice;
          if (left+right >= w || top+bottom >= h)
            throw new RangeError('Slice '+slice.id+' nine-slice needs a nonempty stretch rectangle');
        }
      }
    }
    return rows;
  }

  function active(rows,frameIds,index) {
    if (!rows?.length) return [];
    const order = new Map(frameIds.map((id,i)=>[id,i]));
    return rows.flatMap(slice=>{
      let last = -1, key;
      for (const row of slice.keys) {
        const position = order.get(row.frame);
        if (position <= index && position > last) {
          last = position;
          key = row;
        }
      }
      if (!key?.bounds) return [];
      const { frame:keyFrame,bounds,pivot,nineSlice } = key, [x,y,w,h] = bounds;
      const stretch = nineSlice && [nineSlice[0],nineSlice[1],w-nineSlice[0]-nineSlice[2],h-nineSlice[1]-nineSlice[3]];
      return [{ id:slice.id,...(slice.label !== undefined && { label:slice.label }),keyFrame,bounds,
        ...(pivot && { pivot,registration:[x+pivot[0],y+pivot[1]] }),
        ...(stretch && { nineSlice,stretch }) }];
    });
  }

  function edit(rows,operation,frameIds,width,height) {
    const { type,id:key,label:name,key:frameKey,frame } = operation ?? {};
    const schema = { 'set-slice-key':['label','key'],'remove-slice-key':['frame'],'remove-slice':[] };
    if (!Object.hasOwn(schema,type) || !fields(operation,['type','id',...schema[type]]) || !id(key))
      throw new TypeError('Choose a slice ID and set-slice-key, remove-slice-key, or remove-slice');
    const slices = new Map((rows ?? []).map(slice=>[slice.id,slice])), before = slices.get(key);
    if (type === 'set-slice-key') {
      if ((name !== null && !label(name)) || !frameKey) throw new TypeError('Set a slice key with frame and bounds');
      const keys = new Map((before?.keys ?? []).map(row=>[row.frame,row]));
      keys.set(frameKey.frame,frameKey);
      const nextLabel = name === null ? undefined : name ?? before?.label;
      slices.set(key,{ id:key,...(nextLabel !== undefined && { label:nextLabel }),keys:[...keys.values()] });
    } else {
      if (!before) throw new RangeError('Unknown pixel slice '+key);
      if (type === 'remove-slice') slices.delete(key);
      else {
        if (!before.keys.some(row=>row.frame === frame))
          throw new RangeError('Slice '+key+' has no key on frame '+frame);
        const keys = before.keys.filter(row=>row.frame !== frame);
        if (keys.length) slices.set(key,{ ...before,keys });
        else slices.delete(key);
      }
    }
    const result = [...slices.values()];
    prepare(result,frameIds,width,height);
    return { slices:result,before:before ?? null,after:slices.get(key) ?? null };
  }

  function includeBounds(rows,extent) {
    for (const slice of rows ?? []) for (const { bounds } of slice.keys) {
      if (!bounds) continue;
      const [x,y,w,h] = bounds;
      extent.include(x,y);
      extent.include(x+w-1,y+h-1);
    }
  }

  function remap(rows,map) {
    if (!rows) return;
    const clipped = (value,axis,upper)=>{
      const edge = (value-map.offset[axis])/map.scale[axis];
      const rounded = upper ? Math.ceil(edge-1e-9) : Math.floor(edge+1e-9);
      return Math.max(0,Math.min(map.size[axis],rounded));
    };
    function rectangle(i,j,w,h) {
      const x = clipped(i,0,false), y = clipped(j,1,false);
      return [x,y,clipped(i+w,0,true)-x,clipped(j+h,1,true)-y];
    }
    return rows.map(slice=>({ ...slice,keys:slice.keys.map(key=>{
      if (!key.bounds) return key;
      const { bounds:[x,y,w,h],pivot,nineSlice } = key, bounds = rectangle(x,y,w,h), [u,v,a,b] = bounds;
      if (!a || !b) throw new RangeError('Canvas edit would remove slice '+slice.id+' on frame '+key.frame);
      const result = { ...key,bounds };
      if (pivot) result.pivot = pivot.map((value,axis)=>{
        const point = value+[x,y][axis], transformed = (point+.5-map.offset[axis])/map.scale[axis]-.5;
        return (Math.round(transformed*2)/2-bounds[axis]) || 0;
      });
      if (nineSlice) {
        const [l,t,r,d] = nineSlice, [c,e,f,g] = rectangle(x+l,y+t,w-l-r,h-t-d);
        if (!f || !g) throw new RangeError('Canvas edit would remove the stretch area of slice '+slice.id+' on frame '+key.frame);
        result.nineSlice = [c-u,e-v,u+a-c-f,v+b-e-g];
      }
      return result;
    }) }));
  }

  function crop({width,rgba},[x,y,w,h]) {
    const data = new Uint8Array(w*h*4);
    for (let row=0;row<h;row++) {
      const start = ((y+row)*width+x)*4;
      data.set(rgba.subarray(start,start+w*4),row*w*4);
    }
    return { w,h,rgba:data };
  }

  return Object.freeze({ prepare,active,edit,includeBounds,remap,crop });
})();
if (typeof module !== 'undefined') module.exports = PixelSlices;
else globalThis[Symbol.for('ink-studio.pixel-slices')] = PixelSlices;
