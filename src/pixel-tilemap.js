/* An editable grid of references to shared pixel document frames. */
const PixelTilemap = (() => {
  const fields = (row,names)=>row && Object.getPrototypeOf(row) === Object.prototype &&
    Object.keys(row).every(key=>names.includes(key));
  const dimension = value=>Number.isSafeInteger(value) && value > 0 && value <= 256;
  const validPoint = (at,width,height)=>Array.isArray(at) && at.length === 2 &&
    Number.isSafeInteger(at[0]) && Number.isSafeInteger(at[1]) && at[0] >= 0 && at[0] < width && at[1] >= 0 && at[1] < height;
  const sides = [['N',0,-1],['E',1,0],['S',0,1],['W',-1,0]];

  function variants(definitions,frameIds) {
    if (definitions === undefined) return new Map();
    if (!definitions || Object.getPrototypeOf(definitions) !== Object.prototype)
      throw new TypeError('Tile variants need an object keyed by tile frame ID');
    const plans = new Map();
    for (const [id,row] of Object.entries(definitions)) {
      if (!frameIds.has(id) || !fields(row,['connects','neighbors','animation']) || (!row.neighbors && !row.animation) ||
          row.connects !== undefined && (!row.neighbors || !Array.isArray(row.connects) || !row.connects.length ||
            !Array.from(row.connects).every(key=>frameIds.has(key)) || new Set(row.connects).size !== row.connects.length))
        throw new TypeError('Tile variants need known tile IDs and an animation or neighbor rule');
      const { neighbors,animation } = row;
      if (neighbors !== undefined && (!neighbors || Object.getPrototypeOf(neighbors) !== Object.prototype ||
          !Object.keys(neighbors).length || Object.entries(neighbors).some(([mask,frame])=>
            (mask !== 'none' && (!mask || !/^N?E?S?W?$/.test(mask))) || !frameIds.has(frame))))
        throw new TypeError('Neighbor rules need canonical NESW masks or none and known tile frame IDs');
      if (animation !== undefined && (!fields(animation,['frames','direction','loop']) || !Array.isArray(animation.frames) ||
          !animation.frames.length || animation.frames.length > 256 || !Array.from(animation.frames).every(id=>frameIds.has(id)) ||
          animation.direction !== undefined && !['forward','reverse','ping-pong'].includes(animation.direction) ||
          animation.loop !== undefined && typeof animation.loop !== 'boolean'))
        throw new TypeError('Tile animation needs 1–256 known frames and valid playback settings');
      plans.set(id,{ neighbors,connects:new Set(row.connects ?? [id]),animation });
    }
    return plans;
  }

  function prepare(source,frameIds,tileWidth,tileHeight) {
    if (source === undefined) return;
    if (!fields(source,['version','width','height','cells','variants']) || source.version !== 1 ||
        !dimension(source.width) || !dimension(source.height) || !Array.isArray(source.cells))
      throw new TypeError('Use a version 1 tilemap with 1–256 columns and rows and a list of cells');
    const { width,height,cells } = source, w = width*tileWidth, h = height*tileHeight;
    if (w > 4096 || h > 4096 || w*h > 4_000_000 || cells.length > width*height)
      throw new RangeError('Tilemap exceeds the native raster budget');
    const placed = new Map();
    for (const row of cells) {
      if (!fields(row,['at','tile']) || !validPoint(row.at,width,height) ||
          typeof row.tile !== 'string' || !frameIds.has(row.tile))
        throw new RangeError('Map cells need native cell coordinates and a known tile frame ID');
      const key = row.at[1]*width+row.at[0];
      if (placed.has(key)) throw new RangeError('Tilemap repeats cell '+row.at.join(', '));
      placed.set(key,row.tile);
    }
    return { width,height,w,h,tileWidth,tileHeight,placed,variants:variants(source.variants,frameIds) };
  }

  function place(source,frameIds,tileWidth,tileHeight,points,tile) {
    const grid = prepare(source,frameIds,tileWidth,tileHeight);
    if (!grid) throw new RangeError('Create a tilemap before placing tiles');
    const { width,height,placed } = grid;
    if (tile !== null && (typeof tile !== 'string' || !frameIds.has(tile)))
      throw new RangeError('Place a known tile frame ID or use null to erase');
    if (!Array.isArray(points) || !points.length || points.length > width*height ||
        !Array.from(points).every(at=>validPoint(at,width,height)))
      throw new RangeError('A tile stroke needs cell coordinates inside the map');
    const changes = [];
    for (const at of points) {
      const key = at[1]*width+at[0], before = placed.get(key) ?? null;
      if (before === tile) continue;
      if (tile === null) placed.delete(key);
      else placed.set(key,tile);
      changes.push({ at:[...at],before,after:tile });
    }
    if (!changes.length) return { tilemap:source,changes };
    const cells = [...placed].sort(([a],[b])=>a-b).map(([key,tile])=>({ at:[key%width,Math.floor(key/width)],tile }));
    return { tilemap:{ ...source,cells },changes };
  }

  function pick(grid,at) {
    if (!validPoint(at,grid.width,grid.height)) throw new RangeError('Pick a cell inside the tilemap');
    return grid.placed.get(at[1]*grid.width+at[0]) ?? null;
  }

  function variantReferences(source) {
    return new Set(Object.entries(source ?? {}).flatMap(([id,row])=>[
      id,...(row.connects ?? []),...Object.values(row.neighbors ?? {}),...(row.animation?.frames ?? [])
    ]));
  }

  function sameBehavior(grid,a,b) {
    if (!grid.variants.size) return true;
    const key = id=>{
      const {neighbors,connects,animation} = grid.variants.get(id) ?? {};
      return JSON.stringify([neighbors && [Object.entries(neighbors).sort(([a],[b])=>a.localeCompare(b)),[...connects].sort()],
        animation && [animation.frames,animation.direction ?? 'forward',animation.loop ?? true]]);
    };
    return key(a) === key(b) && [...grid.variants.values()].every(row=>
      !row.neighbors || row.connects.has(a) === row.connects.has(b));
  }

  function elapsed(time) {
    if (!Number.isFinite(time) || time < 0 || time*1000 > Number.MAX_SAFE_INTEGER)
      throw new RangeError('Tile preview time needs finite nonnegative seconds');
    return time*1000;
  }

  function presentation(grid,durationOf,plan) {
    const clocks = new Map(), cells = new Map();
    for (const [id,{ animation }] of grid.variants) if (animation) {
      const { frames,...settings } = animation;
      clocks.set(id,{ frames,clock:plan(frames.map(durationOf),settings) });
    }
    function resolve(at,time = 0) {
      const [x,y] = at, { width,height,placed } = grid;
      if (!validPoint(at,width,height)) return { tile:null,variant:null,frame:null,outside:true };
      const key = y*width+x, tile = placed.get(key);
      if (tile === undefined) return { tile:null,variant:null,frame:null };
      if (!cells.has(key)) {
        const row = grid.variants.get(tile);
        let mask;
        if (row?.neighbors) {
          mask = sides.filter(([,dx,dy])=>{
            const u = x+dx, v = y+dy;
            return u >= 0 && u < width && v >= 0 && v < height && row.connects.has(placed.get(v*width+u));
          }).map(([side])=>side).join('') || 'none';
        }
        const variant = row?.neighbors?.[mask] ?? tile;
        cells.set(key,{ tile,variant,frame:variant,...(mask && { mask }) });
      }
      const resolved = cells.get(key), schedule = clocks.get(resolved.variant);
      if (!schedule) return resolved;
      const step = schedule.clock.at(elapsed(time));
      return { ...resolved,step,frame:schedule.frames[step] };
    }
    function contains(at,frame) {
      const { tile,variant } = resolve(at);
      return tile === frame || variant === frame || !!clocks.get(variant)?.frames.includes(frame);
    }
    return { resolve,contains,animated:clocks.size > 0 };
  }

  function protectionKey(details) {
    const groups = details.map(({ kind,pixels })=>JSON.stringify([kind ?? null,pixels.map(at=>at.join(',')).sort()]));
    return JSON.stringify(groups.sort());
  }

  function sameArt(a,b) {
    for (const layer of new Set([...a.layers.keys(),...b.layers.keys()])) {
      const left = a.layers.get(layer), right = b.layers.get(layer);
      if (left && right && left.slots.length !== right.slots.length) return false;
      const offsetsEqual = (left?.offset ?? [0,0]).every((value,i)=>value === (right?.offset?.[i] ?? 0));
      for (let p=0,n=(left ?? right).slots.length;p<n;p++) {
        const before = left?.slots[p] ?? -1, after = right?.slots[p] ?? -1;
        if (before !== after) return false;
        if (before === -1) continue;
        if (!offsetsEqual || before >= 0 && (left?.alpha?.[p] ?? 255) !== (right?.alpha?.[p] ?? 255)) return false;
      }
    }
    return a.protection === b.protection;
  }

  function exactMatches(ids,source,read) {
    const art = read(source);
    return [...ids].filter(id=>id !== source && sameArt(art,read(id)));
  }

  function cloneRecords(rows,existing) {
    const ids = new Set(existing.map(row=>row.id));
    return rows.map(row=>{
      const stem = row.id.slice(0,48)+'-variant';
      let id = stem, suffix = 2;
      while (ids.has(id)) id = stem+'-'+suffix++;
      ids.add(id);
      return { ...structuredClone(row),id };
    });
  }

  function variantProtection(rows,active,variant) {
    const scoped = active.filter(row=>row.frame !== undefined || row.frames !== undefined);
    if (!scoped.length) return rows;
    return [...rows,...cloneRecords(scoped,rows).map(({ frames,...row })=>({ ...row,frame:variant }))];
  }

  function raster(grid,read,resolver,time = 0) {
    const { width,w,h,tileWidth,tileHeight,placed } = grid, rgba = new Uint8Array(w*h*4), tiles = new Map();
    for (const [key,tile] of placed) {
      const column = key%width, row = Math.floor(key/width), id = resolver ? resolver.resolve([column,row],time).frame : tile;
      if (!tiles.has(id)) {
        const image = read(id);
        if (image?.width !== tileWidth || image?.height !== tileHeight || image.rgba?.length !== tileWidth*tileHeight*4)
          throw new RangeError('Tile raster needs the native document dimensions for '+id);
        tiles.set(id,image.rgba);
      }
      const pixels = tiles.get(id), x = column*tileWidth, y = row*tileHeight;
      for (let row=0;row<tileHeight;row++) {
        const start = row*tileWidth*4;
        rgba.set(pixels.subarray(start,start+tileWidth*4),((y+row)*w+x)*4);
      }
    }
    return { w,h,rgba };
  }

  function neighborhood(grid,at,resolver,time,read,editing) {
    pick(grid,at);
    elapsed(time);
    const { tileWidth:w,tileHeight:h } = grid, cells = [], images = [], cache = new Map();
    for (const dy of [-1,0,1]) for (const dx of [-1,0,1]) {
      const xy = [at[0]+dx,at[1]+dy], state = resolver.resolve(xy,time);
      cells.push({ at:xy,offset:[dx,dy],...state });
      if (state.frame && !cache.has(state.frame))
        cache.set(state.frame,state.frame === editing?.frame ? editing.image : read(state.frame));
      images.push(state.frame ? cache.get(state.frame) : null);
    }
    const center = editing?.image ?? images[4], seams = sides.map(([side,dx,dy])=>{
      const index = (dy+1)*3+dx+1, neighbor = images[index], length = dx ? h : w;
      let coverage = 0, color = 0;
      for (let i=0;i<length;i++) {
        const a = dx ? (i*w+(dx > 0 ? w-1 : 0))*4 : ((dy > 0 ? h-1 : 0)*w+i)*4;
        const b = dx ? (i*w+(dx > 0 ? 0 : w-1))*4 : ((dy > 0 ? 0 : h-1)*w+i)*4;
        const before = center?.rgba[a+3] ?? 0, after = neighbor?.rgba[b+3] ?? 0;
        if (before !== after) coverage++;
        if (before && after && (center.rgba[a] !== neighbor.rgba[b] || center.rgba[a+1] !== neighbor.rgba[b+1] ||
            center.rgba[a+2] !== neighbor.rgba[b+2])) color++;
      }
      return { side,at:cells[index].at,length,coverage,color };
    });
    return { cells,images,seams };
  }

  function neighborhoodRaster({tileWidth,tileHeight},images) {
    const placed = new Map(images.flatMap((image,i)=>image ? [[i,i]] : []));
    return raster({ width:3,w:3*tileWidth,h:3*tileHeight,tileWidth,tileHeight,placed },i=>images[i]);
  }

  return Object.freeze({ prepare,place,pick,variantReferences,sameBehavior,elapsed,presentation,protectionKey,sameArt,exactMatches,
    cloneRecords,variantProtection,raster,neighborhood,neighborhoodRaster });
})();
if (typeof module !== 'undefined') module.exports = PixelTilemap;
else globalThis[Symbol.for('ink-studio.pixel-tilemap')] = PixelTilemap;
