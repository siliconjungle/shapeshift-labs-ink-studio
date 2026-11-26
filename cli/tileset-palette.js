'use strict';

const fs = require('node:fs'), path = require('node:path');
const files = require('./asset-files.js');
const native = require('../src/pixel-palette.js');
const {uniqueId} = require('../src/pixel-raster-colors.js');
const text = require('./look-palette.js');
const {digest,isRevision} = require('./pixel-edit-revisions.js');

const limits = {max:256}, supported = ['json','gpl','pal','hex'];
const reportFormat = 'ink-studio/tileset-palette-edit';
const extension = file=>path.extname(file).slice(1).toLowerCase();
const name = value=>typeof value==='string' && value.trim().length>0;
const record = value=>value && Object.getPrototypeOf(value)===Object.prototype;
const fields = (value,keys)=>record(value) && Object.keys(value).every(key=>keys.includes(key));
const read = file=>JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
const packed = row=>Number.parseInt(row.color.slice(1),16);
const opacity = (source,slot)=>source.alpha?.[slot] ?? 255;

function indexed(asset) {
  if (asset.encoding==='indexed8') return asset;
  const rgba = Buffer.from(asset.data,'base64'), slots = new Map();
  const data = Buffer.alloc(rgba.length/4), palette = [], alpha = [];
  for (let i=0;i<data.length;i++) {
    const value = rgba.readUInt32BE(i*4);
    if (!slots.has(value)) {
      if (palette.length===limits.max) return;
      slots.set(value,palette.length);
      palette.push(value>>>8);
      alpha.push(value&255);
    }
    data[i] = slots.get(value);
  }
  return {...asset,encoding:'indexed8',data:data.toString('base64'),palette,alpha};
}

function snapshot(editor,id,toolkit) {
  const scene = editor.snapshot(), api = toolkit.KIT.authoring.tilesets;
  const asset = api.prepare(scene.tilesets,scene.tilesetDefaults).source(id), source = indexed(asset);
  return {scene,api,asset,source,palette:source && api.namedPalette(source)};
}

function inspectPalette(editor,id,toolkit = require('..').load()) {
  const {asset,source,palette} = snapshot(editor,id,toolkit);
  const report = {format:'ink-studio/tileset-palette-inspection',version:1,tileset:id,encoding:asset.encoding};
  if (!source) return {...report,canEdit:false,blockers:[{reason:'too-many-exact-colors',limit:limits.max}]};
  const count = new Uint32Array(source.palette.length);
  for (const slot of Buffer.from(source.data,'base64')) count[slot]++;
  const exact = new Map(), byColor = new Map();
  const swatches = palette.swatches.map((row,slot)=>{
    const alpha = opacity(source,slot), color = text.hex(packed(row)), rgba = color+alpha.toString(16).padStart(2,'0');
    if (!exact.has(rgba)) exact.set(rgba,[]);
    if (!byColor.has(color)) byColor.set(color,new Map());
    const alphas = byColor.get(color);
    if (!alphas.has(alpha)) alphas.set(alpha,[]);
    exact.get(rgba).push(row.id);
    alphas.get(alpha).push(row.id);
    return {...row,slot,alpha,texels:count[slot]};
  });
  const duplicates = [...exact].filter(([,ids])=>ids.length>1).map(([rgba,ids])=>({rgba,ids}));
  const alphaVariants = [...byColor].filter(([,alphas])=>alphas.size>1).map(([color,alphas])=>
    ({color,variants:[...alphas].map(([alpha,ids])=>({alpha,ids}))}));
  return {...report,canEdit:true,named:Boolean(asset.paletteMetadata),swatches,ramps:palette.ramps,duplicates,alphaVariants};
}

function readPalette(file) {
  const format = extension(file);
  if (!supported.includes(format)) throw new TypeError('Use an Ink palette JSON, GIMP .gpl, JASC .pal or RGB .hex file');
  if (format==='json') return native.validate(read(file),limits);
  const ids = new Set(), {rows} = text.parse(fs.readFileSync(file,'utf8'),format);
  return native.asset(rows.map(({color,label})=>{
    const slug = label?.normalize('NFKD').replace(/\p{Mark}/gu,'').toLowerCase().replace(/[^a-z0-9]+/g,'-')
      .replace(/^-+|-+$/g,'').slice(0,52);
    const id = uniqueId(ids,slug && /^[a-z]/.test(slug) ? slug : 'rgb-'+text.hex(color).slice(1));
    ids.add(id);
    return {id,color:text.hex(color),...(label && {label})};
  }),[],limits);
}

function exportPalette(editor,id,file,toolkit) {
  const format = extension(file), {source,palette} = snapshot(editor,id,toolkit);
  if (!supported.includes(format)) throw new TypeError('Use --out with .json, .gpl, .pal or .hex');
  if (!source) throw new RangeError('This tileset has more than 256 exact RGBA values');
  const losses = [];
  if (source.alpha?.some(alpha=>alpha!==255)) losses.push('alpha');
  if (format==='json') files.publishJson(file,palette,'A different palette exists at '+file);
  else {
    losses.push('swatch-ids');
    if (palette.swatches.some(row=>row.locked)) losses.push('locks');
    if (palette.ramps.length) losses.push('ramps');
    if (format!=='gpl' && palette.swatches.some(row=>row.label!==undefined)) losses.push('labels');
    const rows = palette.swatches.map(row=>({color:packed(row),label:row.label?.replace(/[\r\n]+/g,' ').trim()}));
    if (format==='gpl' && palette.swatches.some((row,i)=>row.label!==rows[i].label)) losses.push('label-formatting');
    files.write(file,text.print({rows,title:id},format));
  }
  return {tileset:id,format,swatches:palette.swatches.length,losses};
}

function adopt(palette,incoming) {
  // Anonymous slots have no authored identity. Match the first imported names by RGB without merging slots.
  const reserved = new Set(incoming.swatches.map(row=>row.id)), assigned = new Map();
  for (const row of incoming.swatches) {
    const matches = (old,i)=>!assigned.has(i) && packed(old)===packed(row);
    let slot = palette.swatches.findIndex((old,i)=>matches(old,i) && old.id===row.id);
    if (slot<0) slot = palette.swatches.findIndex(matches);
    if (slot>=0) assigned.set(slot,row);
  }
  return native.asset(palette.swatches.map((row,i)=>{
    if (assigned.has(i)) return assigned.get(i);
    const id = uniqueId(reserved,row.id);
    reserved.add(id);
    return {...row,id};
  }),[],limits);
}

function consolidate(palette,source,map) {
  if (!record(map) || !Object.keys(map).length)
    throw new TypeError('Consolidation needs an explicit map of duplicate IDs to retained IDs');
  const indices = new Map(palette.swatches.map((row,i)=>[row.id,i]));
  for (const [from,to] of Object.entries(map)) {
    const a = indices.get(from), b = indices.get(to);
    if (a===undefined || b===undefined || from===to)
      throw new RangeError('Choose distinct existing source and retained swatch IDs');
    if (source.palette[a]!==source.palette[b] || opacity(source,a)!==opacity(source,b))
      throw new RangeError('Swatches '+from+' and '+to+' differ in RGB or alpha');
  }
  return native.edit(palette,{type:'remap',map,removeSources:true},limits);
}

function editPalette(editor,id,operation,{apply=false,expect} = {},toolkit = require('..').load()) {
  if (typeof apply!=='boolean' || expect!==undefined && !isRevision(expect) ||
      !record(operation) || !Object.hasOwn({import:1,reorder:1,consolidate:1},operation.type))
    throw new TypeError('Use palette import, reorder, or consolidate with an optional preview revision');
  const {scene,api,asset,source,palette} = snapshot(editor,id,toolkit), {type} = operation;
  const dependencies = editor.sourceDependencies?.();
  if (editor.sourceDependencies && dependencies===undefined) throw new RangeError('Cannot verify palette scene dependencies');
  const previewRevision = digest([scene,dependencies,id,operation]);
  const report = {format:reportFormat,version:1,tileset:id,type,previewRevision};
  const blocked = (reason,detail)=>({...report,canCommit:false,blockers:[{reason,...detail}]});
  if (expect!==undefined && expect!==previewRevision) return blocked('stale-preview');
  if (!source) return blocked('too-many-exact-colors',{limit:limits.max});

  let baseline = palette, result;
  if (type==='consolidate') {
    if (!fields(operation,['type','map'])) throw new TypeError('Consolidation needs only type and map');
    result = consolidate(palette,source,operation.map);
  } else if (type==='import') {
    if (!fields(operation,['type','palette'])) throw new TypeError('Import needs an Ink palette asset');
    const incoming = native.validate(operation.palette,limits);
    if (!asset.paletteMetadata) baseline = adopt(palette,incoming);
    result = native.edit(baseline,operation,limits);
    if (!asset.paletteMetadata) {
      const order = new Set(incoming.swatches.map(row=>row.id));
      for (const row of result.palette.swatches) order.add(row.id);
      result = native.edit(result.palette,{type:'reorder',order:[...order]},limits);
    }
  } else {
    result = native.edit(baseline,operation,limits);
  }
  const output = result.palette;
  const slots = new Map(output.swatches.map((row,i)=>[row.id,i]));
  const sourceSlots = new Map(baseline.swatches.map((row,i)=>[row.id,i]));
  const remap = baseline.swatches.map(row=>slots.get(result.replacements?.get(row.id) ?? row.id));
  const data = Buffer.from(source.data,'base64');
  let changedIndices = 0;
  for (let i=0;i<data.length;i++) {
    const before = data[i], after = remap[before];
    if (before!==after) changedIndices++;
    data[i] = after;
  }
  const alpha = output.swatches.map(row=>opacity(source,sourceSlots.get(row.id)));
  while (alpha.at(-1)===255) alpha.pop();
  const {alpha:oldAlpha,...image} = source;
  const next = {...image,data:data.toString('base64'),palette:output.swatches.map(packed),
    ...(alpha.length && {alpha}),paletteMetadata:api.paletteMetadata(output)};
  const request = {type:'palette',id,asset:next};
  const revision = editor.planTilesetRevision(request);
  if (apply && revision.canCommit && digest(asset)!==digest(next)) editor.editTilesetRevision(request);
  return {...report,canCommit:revision.canCommit,blockers:revision.blockers,revision,
    encoding:{before:asset.encoding,after:next.encoding},changedIndices,
    slots:palette.swatches.map((row,from)=>({from,id:row.id,to:remap[from],swatch:output.swatches[remap[from]].id})),
    added:output.swatches.filter(row=>!sourceSlots.has(row.id)).map(row=>row.id),removed:result.removed};
}

function command([action,file,...rest],options,toolkit,openEditor,sceneOutput) {
  const {scene,id,out,expect} = options, writing = ['import','edit'].includes(action);
  const usage = 'Use tileset palette inspect, export, import or edit with --scene and --id';
  const allowed = ['scene','id',...(action==='export' || writing ? ['out'] : []),...(writing ? ['expect'] : [])];
  if (rest.length || !['inspect','export','import','edit'].includes(action) || ![scene,id].every(name) ||
      !fields(options,allowed) || !Object.values(options).every(name) || (writing ? !name(file) : file!==undefined) ||
      action==='export' && !name(out))
    throw new TypeError(usage);
  const input = path.resolve(scene), editor = openEditor(input);
  let report;
  if (action==='inspect') report = inspectPalette(editor,id,toolkit);
  else if (action==='export') {
    const output = path.resolve(out);
    if (output===input) throw new RangeError('Write the palette separately from the scene');
    report = exportPalette(editor,id,output,toolkit);
  } else {
    const output = out && sceneOutput(input,out,file);
    if (output && expect && output===path.resolve(expect)) throw new RangeError('Write the scene separately from the receipt');
    const prior = expect && read(expect);
    if (expect && (prior?.format!==reportFormat || prior.version!==1 || prior.canCommit!==true || !isRevision(prior.previewRevision)))
      throw new TypeError('Expect a successful tileset palette preview receipt');
    const op = action==='import' ? {type:'import',palette:readPalette(file)} : read(file);
    report = editPalette(editor,id,op,{apply:!!output,expect:prior?.previewRevision},toolkit);
    if (output && report.canCommit) files.publishJson(output,editor.snapshot(),'A different scene already exists at '+output);
    if (output && !report.canCommit) process.exitCode = 1;
  }
  process.stdout.write(JSON.stringify(report,null,2)+'\n');
}

module.exports = {command,inspectPalette,editPalette};
