'use strict';

const { isDeepStrictEqual } = require('node:util');
const Colors = require('../src/pixel-raster-colors.js');
const { readBinary } = require('./aseprite-binary.js');
const { sliceRows,taggedRanges } = require('./pixel-aseprite-sheet.js');

const supportedBlend = new Map([[0,'normal'],[1,'multiply'],[2,'screen'],[3,'overlay'],[16,'add']]);
const directions = ['forward','reverse','pingpong','pingpong_reverse'];
const frameId = index=>'frame-'+(index+1);
const layerId = index=>'layer-'+(index+1);
const pixelFormat = { format:'ink-studio/pixel-art',version:2 };
const tileId = (index,flip = 0)=>'tile-'+index+(flip ? '-flip-'+flip : '');

function swatchPlan(initial) {
  const entries = [], ids = new Map(), rgbSlots = new Map();
  initial.forEach(({rgba},index)=>{
    const color = Colors.fromBytes(rgba[0],rgba[1],rgba[2]);
    if (!rgbSlots.has(color)) rgbSlots.set(color,index);
  });
  function slot(rgba,index,label,optional = false) {
    const color = Colors.fromBytes(rgba[0],rgba[1],rgba[2]);
    const base = index === undefined ? 'rgb-'+color.slice(1) : 'slot-'+index;
    const original = initial[index]?.rgba;
    const id = index === undefined || original && original[0] === rgba[0] && original[1] === rgba[1] && original[2] === rgba[2] ?
      base : base+'-'+color.slice(1);
    if (ids.has(id)) return ids.get(id);
    if (entries.length >= Colors.limit) {
      if (optional) return;
      throw new RangeError('Aseprite drawing uses more than 255 distinct Ink swatches across its timeline');
    }
    const ordinal = entries.length;
    entries.push({ id,color,index,...(label?.trim() && { label }) });
    ids.set(id,ordinal);
    return ordinal;
  }
  function pixel(data,p,channels,palette,transparent) {
    const byte = p*channels;
    if (channels === 1) {
      const index = data[byte];
      if (index === transparent) return;
      const { rgba,label } = palette[index] ?? {};
      if (!rgba) throw new RangeError('Aseprite pixel references missing palette index '+index);
      return { slot:slot(rgba,index,label ?? initial[index]?.label),alpha:rgba[3] };
    }
    const alpha = data[byte+channels-1];
    const r = data[byte], g = channels === 2 ? r : data[byte+1], b = channels === 2 ? r : data[byte+2];
    if (!(alpha || r || g || b)) return;
    const index = rgbSlots.get(Colors.fromBytes(r,g,b));
    return { slot:slot([r,g,b,alpha],index,initial[index]?.label),alpha };
  }
  function finish() {
    // Keep author palette order and exact indexed identities, including duplicate RGB colors.
    const ids = entries.map(row=>row.id);
    const palette = Object.fromEntries(entries.slice().sort((a,b)=>(a.index ?? Number.MAX_SAFE_INTEGER)-(b.index ?? Number.MAX_SAFE_INTEGER))
      .map(({id,color,label})=>[id,label === undefined ? color : { color,label }]));
    if (!entries.length) palette.ink = '#000000';
    return { ids,palette };
  }
  return { pixel,slot,finish };
}

function layerPlan(source) {
  const parents = [], layers = [];
  for (const [index,row] of source.layers.entries()) {
    const { type,level,attributes,blend,opacity,label } = row;
    const id = layerId(index), parent = level ? parents[level-1] : undefined;
    if (level > parents.length || level && !parent) throw new RangeError('Aseprite layer '+id+' has an invalid group level');
    parents.length = level;
    if (type === 1) parents.push(id);
    const kind = type === 1 ? 'group' : type === 0 && attributes & 64 ? 'reference' : 'paint';
    const background = !!(attributes & 8), useBlend = !background && (kind !== 'group' || source.flags & 2);
    if (![0,1,2].includes(type))
      source.report('unsupported-layer','Unknown layer type is represented as an empty paint layer.',{layer:id,value:type});
    if (useBlend && !supportedBlend.has(blend))
      source.report('blend-mode','Unsupported Aseprite blend mode uses normal compositing.',{layer:id,value:blend});
    if (parent && !(source.flags & 2) && useBlend && blend)
      source.report('group-blend','A legacy pass-through group is composited as an isolated group in Ink.',{layer:id});
    if (attributes & ~(11|64))
      source.report('layer-flags','Movement locks, linked-cel preference and collapsed-group state are source metadata only.',
        {layer:id,value:attributes & ~(11|64)});
    layers.push({ id,kind,...(label.trim() && { label }),...(parent && { parent }),
      visible:!!(attributes & 1),locked:!(attributes & 2) || kind === 'reference',
      ...(useBlend && source.flags & 1 && opacity !== 255 && { opacity:opacity/255 }),
      ...(useBlend && blend && supportedBlend.has(blend) && { blend:supportedBlend.get(blend) }) });
  }
  return layers;
}

function decodeCells(cel,tileset,report,location) {
  if (!cel.data || !tileset) return [];
  const [mask,xMask,yMask,dMask] = cel.masks, fields = [mask,xMask,yMask,dMask];
  const assigned = fields.reduce((bits,value)=>bits|value,0)>>>0;
  if (!mask || fields.some((value,i)=>fields.slice(i+1).some(next=>value&next)))
    throw new RangeError('Aseprite tile masks must have a distinct tile ID field and nonoverlapping flip flags');
  const shift = 31-Math.clz32(mask & -mask), cells = [];
  const unsupported = new Set(), missing = new Set();
  for (let p=0;p<cel.width*cel.height;p++) {
    const word = cel.data.readUInt32LE(p*4), index = (word & mask)>>>shift;
    if (tileset.flags & 4 ? index === 0 : word === 0xffffffff) continue;
    if ((word & assigned)>>>0 !== word) unsupported.add((word & ~assigned)>>>0);
    if (index >= tileset.count) { missing.add(index); continue; }
    const has = field=>!!field && ((word & field)>>>0) === field;
    const flip = Number(has(xMask))+2*Number(has(yMask))+4*Number(has(dMask));
    cells.push({ at:[p%cel.width,Math.floor(p/cel.width)],index,flip });
  }
  if (unsupported.size) report('tile-flags','Unrecognized tile flags are ignored.',{...location,values:[...unsupported].slice(0,32)});
  if (missing.size) report('missing-tile','Placements outside the embedded tileset were skipped.',{...location,values:[...missing].slice(0,32)});
  return cells;
}

function tileSampler(tileset,index,flip) {
  const { width,height } = tileset, start = width*height*index;
  return (x,y)=>{
    let u = flip & 1 ? width-1-x : x, v = flip & 2 ? height-1-y : y;
    if (flip & 4) [u,v] = [v,u];
    return u >= width || v >= height ? -1 : start+v*width+u;
  };
}

function emptyRaster(width,height) {
  const cells = width*height;
  return { slots:Array(cells).fill(null),alpha:new Uint8Array(cells).fill(255) };
}

function placePixel(destination,at,sample) {
  if (!sample) return;
  destination.slots[at] = sample.slot;
  destination.alpha[at] = sample.alpha;
}

function readLayered(sourceFile,authoredCel) {
  const source = readBinary(sourceFile);
  const { width,height,channels,transparentIndex,frames,tilesets,report } = source;
  const layers = layerPlan(source), initial = channels === 1 ? frames[0].palette :
    frames.find(frame=>frame.paletteChanged)?.palette ?? [];
  const plan = swatchPlan(initial);
  for (const {id,external} of tilesets.values()) if (external)
    report('external-tileset','External tileset links are retained as metadata. Only embedded art is loaded.',{tileset:id});
  const tags = source.tags.map(({color,direction,...tag})=>{
    if (color.some(Boolean)) report('tag-color','Aseprite tag colors are source metadata only.',{tag:tag.name,value:color});
    return { ...tag,direction:directions[direction] };
  });
  const slices = sliceRows(source.slices.map(slice=>({ ...slice,keys:slice.keys.filter(({bounds:b,pivot,center,frame})=>{
    if (b.w && b.h && (b.x < 0 || b.y < 0 || b.x+b.w > width || b.y+b.h > height ||
        pivot && (Math.abs(pivot.x) > 8192 || Math.abs(pivot.y) > 8192) ||
        center && (center.x < 0 || center.y < 0 || center.x+center.w > b.w || center.y+center.h > b.h))) {
      report('slice-bounds','Slice key is outside the native slice or pivot bounds.',{slice:slice.name,frame:frameId(frame)});
      return false;
    }
    return true;
  }) })),frames);
  const tilemaps = [], normalizedMaps = new Map(), celsSource = [], seen = new Map(), rawFrames = [];
  const cached = new Map();
  let drawingBudget = 4_000_000, tileCellBudget = 1_048_576, paletteFrame = frames[0].id;

  function root(cel,index,layer) {
    const visited = new Set([index]);
    let rootIndex = index;
    while (cel.link !== undefined) {
      rootIndex = cel.link;
      if (visited.has(rootIndex)) throw new RangeError('Aseprite cel links contain a cycle');
      visited.add(rootIndex);
      cel = frames[rootIndex]?.cels.get(layer);
      if (!cel) throw new RangeError('Missing linked Aseprite cel in '+frameId(index)+' on '+layerId(layer));
    }
    return { cel,rootIndex };
  }

  function mappedCel(raw,tileset,sourceIndex,layer,location) {
    const key = frameId(sourceIndex)+'/'+layerId(layer);
    if (!normalizedMaps.has(key)) {
      const { width,height,bits } = raw;
      if (bits !== 32) report('tile-word-size','Only 32-bit Aseprite tile cells are supported.',{...location,value:bits});
      if (!width || !height || width > 256 || height > 256 || (tileCellBudget -= width*height) < 0) {
        report('tile-map-budget','Tile grid exceeds Ink tile import limits.',{...location,value:[width,height]});
        normalizedMaps.set(key,null);
      } else {
        const cells = decodeCells(raw,tileset,report,location);
        normalizedMaps.set(key,{ width,height,cells });
      }
    }
    return normalizedMaps.get(key);
  }

  for (const [index,frame] of frames.entries()) {
    if (frame.paletteChanged) paletteFrame = frame.id;
    if (index && frame.paletteChanged)
      report('palette-timeline','Palette changes are preserved in source history and baked into the affected artwork.',{frame:frame.id});
    const cels = {};
    for (const [layer,cel] of frame.cels) {
      const row = source.layers[layer], id = layerId(layer), location = { frame:frame.id,layer:id };
      if (!row || row.type === 1) throw new RangeError('Aseprite cel refers to an invalid image layer '+id);
      const { cel:raw,rootIndex } = root(cel,index,layer), linked = cel.link !== undefined;
      const link = linked ? frameId(cel.link)+'/'+id : undefined, rootKey = frameId(rootIndex)+'/'+id;
      if (cel.zIndex) report('cel-z-index','Per-cel z-index does not change Ink layer order.',{...location,value:cel.zIndex});
      if (cel.preciseBounds)
        report('precise-cel-bounds','Scaled or fractional reference bounds use integer cel placement.',{...location,value:cel.preciseBounds});
      const isTilemap = raw.type === 3, ts = isTilemap && tilesets.get(row.tileset);
      if (isTilemap && !ts?.data)
        report('tileset-unavailable','Missing or external-only tileset is unavailable for raster and tile export.',{...location,value:row.tileset});
      const map = isTilemap && mappedCel(raw,ts,rootIndex,layer,location);
      if (map) {
        tilemaps.push({ ...location,tileset:row.tileset,paletteFrame,offset:cel.offset,...(linked ? { link:rootKey } : map) });
        if (ts && (ts.width > 512 || ts.height > 512 || ts.count > 2048 || ts.width*ts.height*ts.count > 2**20 ||
            ts.width*map.width > 4096 || ts.height*map.height > 4096 || ts.width*ts.height*map.width*map.height > 4_000_000))
          report('tile-export-budget','Tile data can be viewed as a cel but exceeds the editable tile document budget.',location);
      }
      if (![0,2,3].includes(raw.type) || ![0,2].includes(row.type)) {
        report('cel-type','Unsupported cel or layer type was skipped.',{...location,value:raw.type});
        continue;
      }

      const w = isTilemap ? raw.width*(ts?.width ?? 1) : raw.width, h = isTilemap ? raw.height*(ts?.height ?? 1) : raw.height;
      const [x,y] = cel.offset;
      const cropX = Math.max(0,Math.min(w-width,-x)), cropY = Math.max(0,Math.min(h-height,-y));
      if ((w > width || h > height) && !isTilemap)
        report('cel-crop','Oversized cel artwork was cropped to a bounded native drawing.',location);
      const offset = [x+cropX,y+cropY], options = {
        ...(offset.some(Boolean) && { offset }),...(cel.opacity !== 255 && { opacity:cel.opacity })
      };
      celsSource.push({ ...location,offset:cel.offset,size:[w,h],opacity:cel.opacity,
        ...(cel.zIndex && { zIndex:cel.zIndex }),...(link && { link }) });
      const palette = channels === 1 ? frame.palette : null;
      const context = [palette,cropX,cropY];
      const rasters = cached.get(rootKey) ?? [];
      let render = rasters.find(entry=>entry.context[0] === palette && entry.context[1] === cropX && entry.context[2] === cropY);
      if (!render) {
        const raster = emptyRaster(width,height);
        const draw = (data,p,dst)=>placePixel(raster,dst,plan.pixel(data,p,channels,palette,row.attributes & 8 ? -1 : transparentIndex));
        if (map && ts?.data) {
          for (const {at:[column,line],index,flip} of map.cells) {
            const ox = column*ts.width-cropX, oy = line*ts.height-cropY, sample = tileSampler(ts,index,flip);
            for (let v=Math.max(0,-oy);v<Math.min(ts.height,height-oy);v++)
              for (let u=Math.max(0,-ox);u<Math.min(ts.width,width-ox);u++) {
                const p = sample(u,v);
                if (p >= 0) draw(ts.data,p,(oy+v)*width+ox+u);
              }
          }
        } else if (!isTilemap && raw.data) {
          for (let v=0;v<Math.min(h-cropY,height);v++) for (let u=0;u<Math.min(w-cropX,width);u++)
            draw(raw.data,(v+cropY)*w+cropX+u,v*width+u);
        }
        const same = rasters.find(({raster:prior})=>isDeepStrictEqual(prior,raster));
        if (!same && (drawingBudget -= width*height) < 0)
          throw new RangeError('Aseprite artwork exceeds the authored cel import budget');
        render = { context,raster:same?.raster ?? raster };
        rasters.push(render);
        cached.set(rootKey,rasters);
      }
      const cell = { options,raster:render.raster,link,rootKey,location };
      seen.set(frame.id+'/'+id,cell);
      cels[id] = cell;
    }
    rawFrames.push({ id:frame.id,durationMs:frame.durationMs,cels });
  }
  let omittedSwatches = 0;
  if (source.hasPalette) initial.forEach(({rgba,label},i)=>{
    if ((channels !== 1 || i !== transparentIndex) && plan.slot(rgba,i,label,true) === undefined) omittedSwatches++;
  });
  if (omittedSwatches) report('palette-swatches','Unused source swatches beyond the Ink palette limit are available in source history.',
    {count:omittedSwatches});
  const { ids,palette } = plan.finish();
  const artwork = rawFrames.map(frame=>({ ...frame,cels:Object.fromEntries(Object.entries(frame.cels).map(([layer,entry])=>{
    const { options,raster,link,rootKey,location } = entry;
    if (link) {
      const hold = [link,rootKey].find(id=>seen.get(id)?.raster === raster);
      if (hold) return [layer,{ ...options,hold }];
    }
    if (link) report('link-materialized','Palette or crop differences required an independent cel.',{...location,link});
    return [layer,{ ...options,...authoredCel(width,raster,ids) }];
  })) }));
  const paletteHistory = frames.filter((frame,i)=>frame.paletteChanged || i === 0 && channels === 1)
    .map(({id,palette})=>({ frame:id,entries:palette }));
  const metadata = { version:1,colorDepth:source.depth,transparentIndex,grid:source.grid,
    layers:source.layers.map(({type,attributes,blend,tileset,uuid},index)=>({ id:layerId(index),type,attributes,blend,tileset,uuid })),
    cels:celsSource,paletteHistory,tilemaps,
    tilesets:[...tilesets.values()].map(({data,...tileset})=>({ ...tileset,...(data && { pixels:data.toString('base64') }) })),
    report:{ version:1,frames:frames.length,layers:layers.length,tilesets:tilesets.size,tilemaps:tilemaps.length,issues:source.issues,omittedIssues:source.issueOverflow } };
  return { ...pixelFormat,width,height,pixelAspect:source.aspect,palette,layers,frames:artwork,
    ...(tags.length && { tags:taggedRanges(tags,frames) }),...(slices.length && { slices }),legacyMetadata:{ asepriteFile:metadata } };
}

function tileDocument(document,{ layer,frame } = {},authoredCel) {
  const source = document.legacyMetadata?.asepriteFile;
  if (source?.version !== 1) throw new TypeError('Expected an Ink document imported from binary Aseprite');
  const requested = source.tilemaps.find(row=>row.layer === layer && row.frame === frame);
  if (!requested) throw new RangeError('No imported tilemap for '+layer+' on '+frame);
  const map = requested.link ? source.tilemaps.find(row=>row.frame+'/'+row.layer === requested.link) : requested;
  const tileset = source.tilesets.find(row=>row.id === requested.tileset);
  if (!tileset?.pixels) throw new RangeError('This Aseprite tilemap has no embedded tile art');
  const { width,height,count } = tileset, channels = source.colorDepth/8;
  const axes = [width,height,count,map?.width,map?.height];
  if (!axes.every(n=>Number.isInteger(n) && n > 0) || ![1,2,4].includes(channels) ||
      width > 512 || height > 512 || count > 2048 || map.width > 256 || map.height > 256 ||
      width*map.width > 4096 || height*map.height > 4096 ||
      width*height*map.width*map.height > 4_000_000 || width*height*count > 2**20)
    throw new RangeError('Aseprite tilemap exceeds native tile document limits');
  const bytes = width*height*count*channels;
  if (tileset.pixels.length !== Math.ceil(bytes/3)*4) throw new RangeError('Invalid embedded Aseprite tile byte count');
  const data = Buffer.from(tileset.pixels,'base64');
  if (data.length !== bytes) throw new RangeError('Invalid embedded Aseprite tile byte count');
  const paletteData = source.paletteHistory.find(row=>row.frame === requested.paletteFrame)?.entries ?? [];
  const plan = swatchPlan(paletteData);
  const records = new Map(Array.from({length:count},(_,i)=>[tileId(i),{index:i,flip:0}]));
  const cells = map.cells.map(({at,index,flip})=>{
    if (!Number.isInteger(index) || index < 0 || index >= count || !Number.isInteger(flip) || flip < 0 || flip > 7)
      throw new RangeError('Invalid imported Aseprite tile placement');
    const tile = tileId(index,flip);
    records.set(tile,{index,flip});
    return { at,tile };
  });
  if (records.size > 2048 || width*height*records.size > 2**20)
    throw new RangeError('Aseprite tile variants exceed the Ink tile artwork budget');
  const rasters = [...records].map(([id,{index,flip}])=>{
    const raster = emptyRaster(width,height), sample = tileSampler(tileset,index,flip);
    if (index !== 0 || !(tileset.flags & 4))
      for (let y=0;y<height;y++) for (let x=0;x<width;x++) {
        const p = sample(x,y);
        if (p >= 0) placePixel(raster,y*width+x,plan.pixel(data,p,channels,paletteData,source.transparentIndex));
      }
    return { id,raster,label:'Tile '+(index+tileset.base-(tileset.flags & 4 ? 1 : 0))+(flip ? ' (flip '+flip+')' : '') };
  });
  const { ids,palette } = plan.finish();
  return { ...pixelFormat,width,height,pixelAspect:document.pixelAspect,palette,layers:[{ id:'tile-art' }],
    frames:rasters.map(({id,label,raster})=>({ id,label,durationMs:100,cels:{'tile-art':authoredCel(width,raster,ids)} })),
    tilemap:{version:1,width:map.width,height:map.height,cells},
    legacyMetadata:{ asepriteTilemap:{ version:1,layer,frame,offset:requested.offset,tileset:tileset.id,label:tileset.label } } };
}

module.exports = { readLayered,tileDocument };
