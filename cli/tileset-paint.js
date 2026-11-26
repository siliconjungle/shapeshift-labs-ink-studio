'use strict';

const fs = require('node:fs'), path = require('node:path');
const files = require('./asset-files.js'), PNG = require('./png.js'), Pixels = require('./pixel-art.js');
const Selection = require('../src/tileset-selection.js');
const {runs} = require('../src/pixel-paint-tools.js');
const {uniqueId} = require('../src/pixel-raster-colors.js');
const {digest,isRevision} = require('./pixel-edit-revisions.js');

const format = 'ink-studio/tileset-paint-binding', frame = 'artwork';
const name = value=>typeof value==='string' && !!value.trim();
const fields = (value,keys)=>value && Object.getPrototypeOf(value)===Object.prototype &&
  Object.keys(value).every(key=>keys.includes(key));
const hex = color=>'#'+color.toString(16).padStart(6,'0');
const read = file=>JSON.parse(fs.readFileSync(file,'utf8'));

function source(editor, id, kit) {
  const scene = editor.snapshot(), registry = kit.KIT.authoring.tilesets.prepare(scene.tilesets,scene.tilesetDefaults);
  return {scene:scene.id,asset:registry.source(id),grid:registry.grid(id).tileSize};
}

function pick(id, asset, saved) {
  if (saved===undefined) return Selection.pick(id,asset,{x:0,y:0,width:asset.width,height:asset.height});
  if (saved?.format==='ink-studio/tileset-face-pick') {
    if (saved.version!==1 || !saved.canStamp) throw new TypeError('Use a reusable version 1 face pick');
    saved = saved.stamp?.selection;
  }
  if (saved?.tileset!==id || saved.version!==1) throw new RangeError('Choose a saved pick from tileset '+id);
  if (saved.format==='ink-studio/tileset-brush') return Selection.readBrush(asset,saved);
  if (saved.format!=='ink-studio/tileset-selection') throw new TypeError('Use a saved texel selection or tile brush');
  return Selection.pick(id,asset,saved);
}

function visitRect(asset, [x,y,width,height], emit) {
  for (let row=0;row<height;row++) for (let col=0;col<width;col++)
    emit(row*width+col,(y+row)*asset.width+x+col);
}

function paintDocument(asset, rect) {
  const [,,width,height] = rect, data = Buffer.from(asset.data,'base64');
  if (width>512 || height>512)
    throw new RangeError('The pixel canvas accepts up to 512 pixels per side. Pick a crop of a larger sheet.');
  if (asset.encoding==='rgba8') {
    const rgba = new Uint8Array(width*height*4);
    visitRect(asset,rect,(i,at)=>rgba.set(data.subarray(at*4,at*4+4),i*4));
    return Pixels.documentFromPNG(PNG.encode(width,height,rgba,4));
  }
  const slots = Array(width*height), alpha = Array(width*height);
  visitRect(asset,rect,(i,at)=>{
    slots[i] = data[at];
    alpha[i] = asset.alpha?.[data[at]] ?? 255;
  });
  const used = [...new Set(slots)].sort((a,b)=>a-b), local = new Map(used.map((id,i)=>[id,i]));
  if (used.length>255) throw new RangeError('A pixel canvas can edit up to 255 swatches. Pick a crop with fewer used slots.');
  return Pixels.documentFromRaster({width,height,slots:slots.map(id=>local.get(id)),alpha,
    palette:used.map(id=>hex(asset.palette[id])),swatchIds:used.map(id=>'slot-'+id)});
}

function swatch(document, id, color) {
  const resolved = uniqueId(new Set(Object.keys(document.palette)),id);
  document.palette[resolved] = color;
  return resolved;
}

function gridLayer(document, rect, asset, grid) {
  if (!grid) throw new RangeError('Set the tileset grid before opening a grid overlay');
  const [left,top,width,height] = rect;
  const {width:w,height:h,paddingX=0,paddingY=0,offsetX=0,offsetY=0} = grid;
  function lines(offset, step, span, limit, start, size) {
    const result = new Set();
    for (let n=offset;n+span<=limit;n+=step) for (const edge of [n,n+span])
      if (edge>=start && edge<start+size) result.add(edge-start);
    return result;
  }
  const cols = lines(offsetX,w+paddingX,w,asset.width,left,width);
  const rows = lines(offsetY,h+paddingY,h,asset.height,top,height), indices = [];
  for (let p=0;p<width*height;p++) if (cols.has(p%width) || rows.has(Math.floor(p/width))) indices.push(p);
  if (!indices.length) return {columns:[],rows:[],pixels:0};
  const id = 'tile-grid', color = swatch(document,id,'#79cdd3');
  document.layers.push({id,label:'Tile grid',kind:'reference',opacity:.7});
  document.frames[0].cels[id] = {marks:[{swatch:color,runs:runs(width,indices)}]};
  return {layer:id,columns:[...cols],rows:[...rows],pixels:indices.length};
}

function uvRevision(editor, object, kit) {
  const row = editor.meshTopology(object);
  return digest([kit.KIT.meshTopology.revision(row.document),row.materials,row.bakes]);
}

function uvLayer(document, editor, id, asset, rect, option, kit) {
  const {object,material,mode='charts'} = option;
  if (!fields(option,['object','material','mode']) || !name(object) ||
      material!==undefined && !name(material) || !['charts','faces'].includes(mode))
    throw new TypeError('Choose a UV overlay mesh, optional material, and chart or face outlines');
  const row = editor.meshTopology(object);
  const slots = new Set((row.materials ?? []).filter(item=>item.texture?.tileset===id &&
    (material===undefined || item.id===material) && !row.bakes?.some(bake=>
      bake.material===item.id && !bake.invalidated && bake.maps.texture!==undefined)).map(item=>item.id));
  const ids = row.document.faces.filter(face=>slots.has(face.material)).map(face=>face.id);
  if (!ids.length) throw new RangeError('The UV overlay needs faces sampling tileset '+id);
  const output = editor.guideMeshUV(object,{uvSet:'pigment',atlas:[asset.width,asset.height],crop:rect,
    ids,domain:'faces',outline:{mode}});
  const layer = 'uv-outline', color = swatch(document,layer,output.document.palette['uv-ink']);
  document.layers.push({id:layer,label:'UV outlines',kind:'reference'});
  document.frames[0].cels[layer] = {marks:output.document.frames[0].cels[layer].marks.map(mark=>({...mark,swatch:color}))};
  return {layer,object,sourceRevision:uvRevision(editor,object,kit),meshRevision:output.report.revision,
    mode,faces:output.report.faces,pixels:output.report.layers[0].pixels};
}

function revision(board, binding) {
  return digest([board.scene,board.asset,board.grid,binding.tileset,binding.scope,binding.rect,binding.frame,binding.overlays]);
}

function open(editor, request, kit = require('..').load()) {
  if (!fields(request,['tileset','selection','grid','uv']) || !kit.KIT.authoring.tilesets.validId(request.tileset) ||
      request.grid!==undefined && typeof request.grid!=='boolean' ||
      request.uv!==undefined && (!request.uv || Object.getPrototypeOf(request.uv)!==Object.prototype))
    throw new TypeError('Open a registered tileset with an optional pick, grid, and UV overlay');
  const {tileset,selection,grid,uv} = request, board = source(editor,tileset,kit);
  const {x,y,width,height} = pick(tileset,board.asset,selection), rect = [x,y,width,height];
  const document = paintDocument(board.asset,rect), overlays = {};
  if (grid) overlays.grid = gridLayer(document,rect,board.asset,board.grid);
  if (uv) overlays.uv = uvLayer(document,editor,tileset,board.asset,rect,uv,kit);
  const binding = {format,version:1,scene:board.scene,tileset,scope:selection===undefined ? 'sheet' : 'crop',
    rect,frame,overlays};
  binding.sourceRevision = revision(board,binding);
  Pixels.validate(document);
  return {document,binding};
}

function pixelValues(stamp) {
  const colors = stamp.palette.map(value=>Number.parseInt(value.slice(1),16));
  return stamp.slots.map((slot,i)=>slot===null ? {value:0,slot:null} :
    {value:colors[slot]*256+(stamp.alpha?.[i] ?? 255),slot:stamp.swatchIds[slot]});
}

function revisedAsset(asset, rect, pixels, changedMask) {
  const data = Buffer.from(asset.data,'base64'), indexed = asset.encoding==='indexed8';
  const palette = asset.palette?.slice(), alpha = asset.alpha?.slice() ?? [], slots = new Map();
  const valueAt = slot=>palette[slot]*256+(alpha[slot] ?? 255);
  let empty;
  if (indexed) for (let slot=0;slot<palette.length;slot++) {
    const value = valueAt(slot);
    if (!slots.has(value)) slots.set(value,slot);
    if (value%256===0 && empty===undefined) empty = slot;
  }
  let changedTexels = 0, paletteFull = false;
  const samples = [], [x,y,width] = rect;
  const pixelAt = typeof pixels==='function' ? pixels : i=>pixels[i];
  visitRect(asset,rect,(i,at)=>{
    const pixel = pixelAt(i);
    if (!pixel) return;
    const {value,slot} = pixel;
    let after = value;
    let before;
    if (indexed) {
      before = data[at];
      const prior = valueAt(before);
      const explicit = /^slot-(\d+)$/.exec(slot ?? '');
      const preferred = explicit && Number(explicit[1])<palette.length ? Number(explicit[1]) : undefined;
      if (slot===null && prior%256===0) return;
      if (preferred!==undefined && valueAt(preferred)===value) after = preferred;
      else if (prior===value) return;
      else if (slot===null && empty!==undefined) after = empty;
      else if (slots.has(value)) after = slots.get(value);
      else {
        if (palette.length===256) {paletteFull = true; return;}
        after = palette.length;
        palette.push(value>>>8);
        slots.set(value,after);
        const opacity = value%256;
        if (opacity!==255) {
          while (alpha.length<after) alpha.push(255);
          alpha[after] = opacity;
          if (opacity===0 && empty===undefined) empty = after;
        }
      }
      if (before===after) return;
      data[at] = after;
    } else {
      before = data.readUInt32BE(at*4);
      if (before===after || slot===null && before%256===0) return;
      data.writeUInt32BE(after,at*4);
    }
    changedTexels++;
    if (changedMask) changedMask[i] = 1;
    if (samples.length<32) samples.push({at:[x+i%width,y+Math.floor(i/width)],before,after});
  });
  return {asset:changedTexels ? {...asset,data:data.toString('base64'),
    ...(indexed && {palette,...(alpha.length && {alpha})})} : asset,changedTexels,samples,paletteFull};
}

function write(editor, binding, document, {apply=false} = {}, kit = require('..').load()) {
  if (!fields(binding,['format','version','scene','tileset','scope','rect','frame','overlays','sourceRevision']) ||
      binding.format!==format || binding.version!==1 || !name(binding.scene) || binding.frame!==frame ||
      !kit.KIT.authoring.tilesets.validId(binding.tileset) || !isRevision(binding.sourceRevision) ||
      !['crop','sheet'].includes(binding.scope) || !Array.isArray(binding.rect) || binding.rect.length!==4 ||
      !binding.rect.every(Number.isSafeInteger) || !fields(binding.overlays,['grid','uv']) || typeof apply!=='boolean')
    throw new TypeError('Use a version 1 tileset paint binding');
  const {tileset,rect,overlays,sourceRevision} = binding, board = source(editor,tileset,kit);
  const report = {format:'ink-studio/tileset-paint-write',version:1,tileset,scope:binding.scope,rect,sourceRevision};
  const blocked = code=>({...report,canCommit:false,conflicts:[{code}]});
  if (binding.scene!==board.scene || revision(board,binding)!==sourceRevision) return blocked('stale-tileset-paint');
  if (overlays.uv && uvRevision(editor,overlays.uv.object,kit)!==overlays.uv.sourceRevision) return blocked('stale-uv-overlay');
  const [x,y,width,height] = rect;
  Selection.pick(tileset,board.asset,{x,y,width,height});
  if (document?.version!==2 || document.width!==width || document.height!==height)
    return blocked('canvas-size-changed');
  const loaded = Pixels.compile(document,binding.frame);
  for (const item of Object.values(overlays)) if (item.layer &&
    document.layers.some(row=>row.id===item.layer && row.kind!=='reference')) return blocked('overlay-is-paint');
  const planned = planPixels(editor,tileset,board.asset,rect,pixelValues(Pixels.stamp(loaded)));
  if (!planned.detail) return blocked('indexed-palette-full');
  if (apply && planned.edit?.canCommit) editor.editTilesetRevision(planned.request);
  return {...report,...planned.detail};
}

function paintPixels(before, rect, pixels, changedMask) {
  const {asset,changedTexels,samples,paletteFull} = revisedAsset(before,rect,pixels,changedMask);
  if (paletteFull) return;
  const detail = {encoding:asset.encoding,changedTexels,samples,
    sampleUnits:asset.encoding==='indexed8' ? 'palette-slot' : 'rgba32',
    paletteAdded:(asset.palette?.length ?? 0)-(before.palette?.length ?? 0)};
  return {asset,detail};
}

function planPixels(editor, tileset, before, rect, pixels, changedMask) {
  const painted = paintPixels(before,rect,pixels,changedMask);
  if (!painted) return {};
  const {asset,detail} = painted;
  if (!detail.changedTexels) return {detail:{...detail,canCommit:true,conflicts:[]}};
  const request = {type:'replace',id:tileset,asset}, edit = editor.planTilesetRevision(request);
  return {request,edit,detail:{...detail,canCommit:edit.canCommit,conflicts:edit.blockers,revision:edit}};
}

function command([action,...args], opt, kit, openEditor, sceneOutput) {
  if (action==='face') return require('./tileset-face-paint.js').command(args,opt,kit,openEditor,sceneOutput);
  const [file,editFile,...rest] = args;
  const {scene,out,selection} = opt, opening = action==='open';
  if (!['open','write'].includes(action) || rest.length || ![scene,file].every(name) ||
      (opening ? editFile!==undefined || !name(out) : !name(editFile)) ||
      Object.entries(opt).some(([key,value])=>!['scene','out',...(opening ? ['selection'] : [])].includes(key) || !name(value)))
    throw new TypeError('Use tileset paint open <request.json> --scene scene.json --out directory or tileset paint write <binding.json> <edited.json> --scene scene.json [--out revised.json]');
  const editor = openEditor(scene);
  if (opening) {
    const request = read(file);
    if (selection!==undefined) {
      if (!request || Object.getPrototypeOf(request)!==Object.prototype || Object.hasOwn(request,'selection'))
        throw new TypeError('Provide a pick in the request or with --selection');
      request.selection = read(selection);
    }
    const {document,binding} = open(editor,request,kit), pixels = Pixels.createEditor(document);
    const names = {document:'paint.json',binding:'binding.json',png:'paint.png',
      ...(Object.values(binding.overlays).some(row=>row.layer) && {overlay:'overlay.png'})};
    const inputs = [scene,file,selection].filter(Boolean).map(input=>path.resolve(input));
    if (Object.values(names).some(name=>inputs.includes(path.resolve(out,name))))
      throw new RangeError('Write paint canvas artifacts separately from the scene and pick');
    files.publishJson(path.resolve(out,names.document),document,'A different editable tileset canvas already exists');
    files.publishJson(path.resolve(out,names.binding),binding,'A different tileset paint binding already exists');
    files.write(path.resolve(out,names.png),pixels.png());
    if (names.overlay) files.write(path.resolve(out,names.overlay),PNG.encodePaint(pixels.stamp({references:true})));
    return process.stdout.write(JSON.stringify({...binding,files:names},null,2)+'\n');
  }
  const output = out && sceneOutput(path.resolve(scene),out,file);
  if (output===path.resolve(editFile)) throw new RangeError('Write the scene separately from the edited canvas');
  const result = write(editor,read(file),read(editFile),{apply:!!output},kit);
  if (output && result.canCommit) files.publishJson(output,editor.snapshot(),'A different scene already exists at '+output);
  if (output && !result.canCommit) process.exitCode = 1;
  process.stdout.write(JSON.stringify(result,null,2)+'\n');
}

module.exports = {open,write,command,paintPixels,planPixels};
