'use strict';

const fs = require('node:fs');
const path = require('node:path');
const PNG = require('./png.js');
const files = require('./asset-files.js');
const Selection = require('../src/tileset-selection.js');

function readTilesetImage(source, toolkit = require('..').load()) {
  const bytes = source instanceof Uint8Array ? source : fs.readFileSync(source);
  const {w:width,h:height} = PNG.layout(bytes);
  toolkit.KIT.authoring.tilesets.dimensions(width,height);
  const {slots,palette,transparency,data,max} = PNG.tilesetRaster(bytes);
  if (slots) return {version:1,width,height,encoding:'indexed8',data:Buffer.from(slots).toString('base64'),palette,
    ...(transparency?.length && {alpha:Array.from(transparency)})};
  const rgba = max === 255 ? data : Uint8Array.from(data,value => Math.round(value*255/max));
  return {version:1,width,height,encoding:'rgba8',data:Buffer.from(rgba).toString('base64')};
}

const rectangleFields = ['x','y','width','height'];
const insetEdges = ['top','bottom','left','right'];
const layoutFlags = {'padding-x':'paddingX','padding-y':'paddingY','offset-x':'offsetX','offset-y':'offsetY'};
const tileFields = ['tile-width','tile-height',...Object.keys(layoutFlags)];
const integerText = value => typeof value === 'string' && /^-?\d+$/.test(value);

function tileOptions(options) {
  if (!tileFields.some(key => options[key] !== undefined)) return;
  if (!['tile-width','tile-height'].every(key => integerText(options[key])))
    throw new TypeError('Specify both --tile-width and --tile-height as integers');
  const size = {width:Number(options['tile-width']),height:Number(options['tile-height'])};
  for (const [flag,name] of Object.entries(layoutFlags)) {
    if (options[flag] === undefined) continue;
    if (!integerText(options[flag])) throw new TypeError('--'+flag+' needs an integer texel distance');
    size[name] = Number(options[flag]);
  }
  return size;
}

function numberOption(options, name) {
  const value = options[name];
  if (value === undefined) return;
  if (typeof value !== 'string' || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value))
    throw new TypeError('--'+name+' needs a number');
  return Number(value);
}

function prepare(scene, toolkit) {
  return toolkit.KIT.authoring.tilesets.prepare(scene.tilesets,scene.tilesetDefaults);
}

function configuredTileSize(tilesets, id) {
  const {tileSize} = tilesets.grid(id);
  if (!tileSize) throw new RangeError('Set tile dimensions with tileset grid or supply --tile-width and --tile-height');
  return tileSize;
}

function projectDensity(tilesets, projectTexelsPerUnit, toolkit) {
  if (tilesets.texelsPerUnit !== null) return tilesets.texelsPerUnit;
  return projectTexelsPerUnit === undefined ? null :
    toolkit.KIT.authoring.tilesets.positiveScale(projectTexelsPerUnit,'Project texels per unit');
}

function physicalSize(brush, texelsPerUnit, brushScale, toolkit) {
  if (texelsPerUnit === null) throw new RangeError('Set tileset texels per unit in the project config or with tileset world-scale');
  const {positiveScale} = toolkit.KIT.authoring.tilesets;
  positiveScale(texelsPerUnit,'Texels per unit');
  positiveScale(brushScale,'Brush scale');
  const unitsPerTexel = brushScale/texelsPerUnit;
  function extent(width,height) {
    return {width:positiveScale(width*unitsPerTexel,'World width'),height:positiveScale(height*unitsPerTexel,'World height')};
  }
  return {brush:{...brush,texelsPerUnit,brushScale},worldSize:extent(brush.columns*brush.tileWidth,brush.rows*brush.tileHeight),
    tileWorldSize:extent(brush.tileWidth,brush.tileHeight)};
}

function scaledPick(brush, density, scale, toolkit) {
  return density === null && scale === undefined ? brush : physicalSize(brush,density,scale ?? 1,toolkit).brush;
}

function pickTilesetRectangle(scene, id, rectangle, toolkit = require('..').load()) {
  const tilesets = prepare(scene, toolkit);
  return Selection.pick(id,tilesets.source(id),rectangle);
}

function pickTilesetBlock(scene, id, rectangle, tileSize, toolkit = require('..').load()) {
  const tilesets = prepare(scene, toolkit);
  const brush = Selection.block(id,tilesets.source(id),rectangle,tileSize === undefined ? configuredTileSize(tilesets,id) : tileSize);
  return scaledPick(brush,tilesets.texelsPerUnit,undefined,toolkit);
}

function brushSelection(tilesets, brush) {
  if (brush?.format !== 'ink-studio/tileset-brush' || brush.version !== 1)
    throw new TypeError('Expected a version 1 tileset brush');
  const layout = Object.fromEntries(Selection.layoutKeys.filter(key=>Object.hasOwn(brush,key)).map(key=>[key,brush[key]]));
  const selected = Selection.block(brush.tileset,tilesets.source(brush.tileset),brush,
    {width:brush.tileWidth,height:brush.tileHeight,...layout});
  if (brush.columns !== selected.columns || brush.rows !== selected.rows)
    throw new RangeError('Tile brush row and column counts do not match its bounds');
  return selected;
}

function brushMapping(scene, brush, insets, toolkit, cell) {
  const tilesets = prepare(scene,toolkit), selected = brushSelection(tilesets,brush);
  const sample = cell ?? (Selection.hasGaps(selected) ? {column:0,row:0} : null);
  return Selection.uvMapping(tilesets.source(selected.tileset),brush,insets,sample && Selection.cell(selected,sample));
}

function tilesetBrushUV(scene, brush, insets, toolkit = require('..').load()) {
  return brushMapping(scene,brush,insets,toolkit);
}

function tilesetBrushCellUV(scene, brush, cell, insets, toolkit = require('..').load()) {
  if (!cell || typeof cell !== 'object') throw new TypeError('Specify a brush column and row');
  return brushMapping(scene,brush,insets,toolkit,cell);
}

function sizeTilesetBrush(scene, brush, {brushScale,projectTexelsPerUnit} = {}, toolkit = require('..').load()) {
  const tilesets = prepare(scene,toolkit);
  brushSelection(tilesets,brush);
  const pinned = Object.hasOwn(brush,'texelsPerUnit') || Object.hasOwn(brush,'brushScale');
  const {positiveScale} = toolkit.KIT.authoring.tilesets;
  const density = pinned ? positiveScale(brush.texelsPerUnit,'Saved texels per unit') :
    projectDensity(tilesets,projectTexelsPerUnit,toolkit);
  const savedScale = pinned ? positiveScale(brush.brushScale,'Saved brush scale') : 1;
  return physicalSize(brush,density,brushScale === undefined ? savedScale : brushScale,toolkit);
}

function rasterizeTilesetBrush(scene, brush, toolkit = require('..').load()) {
  const tilesets = prepare(scene, toolkit);
  const selected = brushSelection(tilesets,brush);
  const {width,pixels} = tilesets.resolve({tileset:selected.tileset});
  return Selection.pack(selected,width,pixels,4);
}

function previewCommand([file,...rest], options, toolkit) {
  const {scene,out} = options;
  if (rest.length || ![file,scene,out].every(value => typeof value === 'string' && value.trim()) ||
      Object.keys(options).some(key => !['scene','out'].includes(key)) || !/\.png$/i.test(out))
    throw new TypeError('Use tileset brush-preview <brush.json> --scene <scene.json> --out <preview.png>');
  const output = path.resolve(out);
  if ([file,scene].some(input=>path.resolve(input) === output)) throw new RangeError('Write a separate preview file');
  const read = input=>JSON.parse(fs.readFileSync(path.resolve(input),'utf8'));
  const {width,height,pixels} = rasterizeTilesetBrush(read(scene),read(file),toolkit);
  files.write(output,PNG.encode(width,height,pixels,4));
}

function pickCommand(args, options, toolkit, projectTexelsPerUnit) {
  const {scene,id,out} = options, fields = rectangleFields;
  if (args.length || ![scene,id].every(value => typeof value === 'string' && value.trim()) ||
      Object.keys(options).some(key => !['scene','id','out','brush','brush-scale',...fields,...tileFields].includes(key)) ||
      out !== undefined && (typeof out !== 'string' || !/\.(html|json)$/i.test(out)))
    throw new TypeError('Use tileset pick --scene <scene.json> --id <tileset-id> with rectangle bounds and optional --brush');
  const tile = tileOptions(options), block = options.brush === true || tile !== undefined;
  const scale = numberOption(options,'brush-scale');
  if (!block && scale !== undefined) throw new TypeError('--brush-scale requires a tile brush pick');
  const visual = out !== undefined && /\.html$/i.test(out);
  if (visual && block) throw new TypeError('Save a tile brush as JSON and render it with tileset brush-preview');
  const count = fields.filter(key => options[key] !== undefined).length;
  if ((!visual || count) && !fields.every(key => integerText(options[key])))
    throw new TypeError('Specify all four rectangle values as integers');
  const filename = path.resolve(scene), output = out && path.resolve(out);
  if (output === filename) throw new RangeError('Write the pick separately from the source scene');
  const document = JSON.parse(fs.readFileSync(filename,'utf8'));
  const tilesets = prepare(document, toolkit), source = tilesets.source(id);
  const bounds = count ? Object.fromEntries(fields.map(key => [key,Number(options[key])])) :
    {x:0,y:0,width:1,height:1};
  const selection = block
    ? scaledPick(Selection.block(id,source,bounds,tile ?? configuredTileSize(tilesets,id)),
      projectDensity(tilesets,projectTexelsPerUnit,toolkit),scale,toolkit)
    : Selection.pick(id,source,bounds);
  if (visual) {
    const {width,height,pixels} = tilesets.resolve({tileset:id});
    const model = JSON.stringify({width,height,selection,rgba:Buffer.from(pixels).toString('base64')}).replaceAll('<','\\u003c');
    const read = name => fs.readFileSync(path.resolve(__dirname,name),'utf8');
    const page = read('tileset-pick.html')
      .replace('/* GRID_STYLE */',() => read('../src/pixel-grid-canvas.css'))
      .replace('/* GRID_MODULE */',() => read('../src/pixel-grid-canvas.mjs'))
      .replace('/* SELECTION_MODULE */',() => read('../src/tileset-selection.js'))
      .replace('/* PICK_DATA */',() => model);
    return files.write(output,page);
  }
  if (output) return files.publishJson(output,selection,'A different selection already exists at '+output);
  process.stdout.write(JSON.stringify(selection,null,2)+'\n');
}

function sceneOutput(input, out, sideInput) {
  const output = path.resolve(out);
  if (!/\.json$/i.test(output) || path.dirname(input) !== path.dirname(output) ||
      output === input || sideInput !== undefined && output === path.resolve(sideInput))
    throw new RangeError('Write a new scene JSON beside the original to preserve relative scene assets');
  return output;
}

function extractCommand(args, options, toolkit) {
  const {scene,id,out,selection,'new-id':targetId} = options, saved = selection !== undefined;
  const name = value=>typeof value === 'string' && value.trim();
  if (args.length || ![scene,out,targetId].every(name) ||
      Object.keys(options).some(key=>!['scene','id','out','selection','new-id',...rectangleFields].includes(key)) ||
      (saved ? !name(selection) || ['id',...rectangleFields].some(key=>options[key] !== undefined) :
        !name(id) || !rectangleFields.every(key=>integerText(options[key]))))
    throw new TypeError('Use tileset extract --scene <scene.json> --new-id <tileset-id> --out <new-scene.json> with --selection <selection.json> or --id and all four rectangle values');
  const input = path.resolve(scene), output = sceneOutput(input,out,saved ? selection : undefined);
  const read = file=>JSON.parse(fs.readFileSync(file,'utf8'));
  const bounds = saved ? read(selection) : Object.fromEntries(rectangleFields.map(key=>[key,Number(options[key])]));
  if (saved && (bounds?.format !== 'ink-studio/tileset-selection' || bounds.version !== 1))
    throw new TypeError('Expected a version 1 exact texel selection from tileset pick');
  const source = saved ? bounds.tileset : id;
  const revised = toolkit.KIT.authoring.tilesets.extract(read(input),source,targetId,bounds);
  const {width,height,encoding} = revised.tilesets[targetId];
  files.publishJson(output,revised,'A different scene already exists at '+output);
  process.stdout.write(JSON.stringify({scene:output,id:targetId,width,height,encoding,
    source:{tileset:source,x:bounds.x,y:bounds.y,width,height}},null,2)+'\n');
}

function gridCommand(args, options, toolkit) {
  const {scene,id,out,clear} = options;
  if (args.length || typeof scene !== 'string' || !scene.trim() ||
      id !== undefined && (typeof id !== 'string' || !id.trim()) ||
      Object.keys(options).some(key => !['scene','id','out','clear',...tileFields].includes(key)))
    throw new TypeError('Use tileset grid --scene <scene.json> with optional --id <tileset-id>');
  const tileSize = tileOptions(options), changing = clear === true || tileSize !== undefined;
  if (clear === true && tileSize || changing && (typeof out !== 'string' || !out.trim()) || !changing && out !== undefined)
    throw new TypeError('For grid edits, specify tile dimensions or --clear, and --out <new-scene.json>');
  const input = path.resolve(scene);
  const document = JSON.parse(fs.readFileSync(input,'utf8'));
  const report = id === undefined ? {} : {id};
  if (changing) {
    const output = sceneOutput(input,out);
    const {patch,grid} = toolkit.KIT.authoring.tilesets.gridPatch(document,id,tileSize ?? null);
    files.publishJson(output,{...document,...patch},'A different scene already exists at '+output);
    Object.assign(report,{scene:output},grid);
  } else {
    Object.assign(report,prepare(document,toolkit).grid(id));
  }
  process.stdout.write(JSON.stringify(report,null,2)+'\n');
}

function worldScaleCommand(args, options, toolkit, projectTexelsPerUnit) {
  const {scene,out,clear} = options, density = numberOption(options,'texels-per-unit');
  const changing = clear === true || density !== undefined;
  if (args.length || typeof scene !== 'string' || !scene.trim() ||
      Object.keys(options).some(key => !['scene','out','clear','texels-per-unit'].includes(key)) ||
      clear === true && density !== undefined ||
      changing && (typeof out !== 'string' || !out.trim()) || !changing && out !== undefined)
    throw new TypeError('Use tileset world-scale --scene <scene.json> [--texels-per-unit N or --clear, with --out <new-scene.json>]');
  const input = path.resolve(scene), document = JSON.parse(fs.readFileSync(input,'utf8'));
  const output = changing ? sceneOutput(input,out) : undefined;
  const updated = changing ? {...document,...toolkit.KIT.authoring.tilesets.scalePatch(document,density ?? null)} : document;
  const tilesets = prepare(updated,toolkit), texelsPerUnit = projectDensity(tilesets,projectTexelsPerUnit,toolkit);
  if (changing) files.publishJson(output,updated,'A different scene already exists at '+output);
  process.stdout.write(JSON.stringify({...(changing && {scene:output}),texelsPerUnit,
    source:tilesets.texelsPerUnit !== null ? 'scene' : texelsPerUnit !== null ? 'project' : 'unset'},null,2)+'\n');
}

function brushSizeCommand([file,...rest], options, toolkit, projectTexelsPerUnit) {
  const {scene,out} = options, brushScale = numberOption(options,'brush-scale');
  if (rest.length || ![file,scene].every(value => typeof value === 'string' && value.trim()) ||
      Object.keys(options).some(key => !['scene','out','brush-scale'].includes(key)) ||
      out !== undefined && (typeof out !== 'string' || !/\.json$/i.test(out)) ||
      brushScale !== undefined && out === undefined)
    throw new TypeError('Use tileset brush-size <brush.json> --scene <scene.json> [--brush-scale N --out <new-brush.json>]');
  const output = out && path.resolve(out);
  if ([file,scene].some(input=>path.resolve(input) === output)) throw new RangeError('Write a separate sized brush file');
  const read = input=>JSON.parse(fs.readFileSync(path.resolve(input),'utf8'));
  const result = sizeTilesetBrush(read(scene),read(file),{brushScale,projectTexelsPerUnit},toolkit);
  if (output) files.publishJson(output,result.brush,'A different brush already exists at '+output);
  process.stdout.write(JSON.stringify(result,null,2)+'\n');
}

function brushUVCommand([file,...rest], options, toolkit, openEditor) {
  const {scene,object,face,out,column,row} = options, target = object !== undefined || face !== undefined;
  const cell = column !== undefined || row !== undefined;
  const insetFlags = insetEdges.map(edge=>'inset-'+edge);
  const name = value=>typeof value === 'string' && value.trim();
  if (rest.length || ![file,scene].every(name) || target && ![object,face].every(name) ||
      Object.keys(options).some(key=>!['scene','object','face','out','column','row',...insetFlags].includes(key)) ||
      out !== undefined && (!name(out) || !/\.json$/i.test(out)))
    throw new TypeError('Use tileset brush-uv <brush.json> --scene <scene.json> with optional --inset-top, --inset-bottom, --inset-left, --inset-right, and --object <id> --face <id>');
  if (cell && ![column,row].every(integerText)) throw new TypeError('Specify both --column and --row as integers');
  const input = path.resolve(scene), brushFile = path.resolve(file), output = out && path.resolve(out);
  if ([input,brushFile].includes(output)) throw new RangeError('Write a separate brush or scene file');
  const insets = Object.fromEntries(insetEdges.flatMap(edge=>{
    const value = numberOption(options,'inset-'+edge);
    return value === undefined ? [] : [[edge,value]];
  }));
  const editor = target && openEditor(input);
  const read = filename=>JSON.parse(fs.readFileSync(filename,'utf8'));
  const result = brushMapping(editor ? editor.snapshot() : read(input),read(brushFile),insets,toolkit,
    cell ? {column:Number(column),row:Number(row)} : undefined);
  if (editor) {
    if (result.cell && !cell) throw new RangeError('Choose --column and --row to map one cell of a padded brush to a face');
    const mesh = editor.meshTopology(object), polygon = mesh.document.faces.find(row=>row.id === face);
    if (!polygon) throw new RangeError('Unknown mesh face '+face);
    const material = mesh.materials?.find(row=>row.id === (polygon.material ?? 'default'));
    if (material?.texture?.tileset !== result.brush.tileset)
      throw new RangeError('Face '+face+' must use tileset '+result.brush.tileset);
    const request = {uvSet:'pigment',operations:[{op:'remap-face',id:face,
      source:result.sourceUVBounds,destination:result.uvBounds}]};
    result.uv = editor.planMeshUV(object,request).report;
    if (output && result.uv.canCommit) {
      sceneOutput(input,output);
      const {topology} = editor.editMeshUV(object,request);
      if (topology) result.transaction = {bakes:topology.bakes,bindings:topology.bindings};
      files.publishJson(output,editor.snapshot(),'A different scene already exists at '+output);
    } else if (output) process.exitCode = 1;
  } else if (output) {
    files.publishJson(output,result.brush,'A different brush already exists at '+output);
  }
  process.stdout.write(JSON.stringify(result,null,2)+'\n');
}

function stampCommand(action, args, options, toolkit, projectTexelsPerUnit, openEditor) {
  const {scene,id,object,face,part,out,material,selection,plane,'snap-grid':snapGrid} = options;
  const names = ['scene','id','object','face','part','out','material','selection'];
  const vectors = ['origin','right','up'];
  const allowed = [...names,...vectors,...rectangleFields,'brush-scale','texels-per-unit','plane','snap-grid'];
  const saved = selection !== undefined;
  if (args.length || ![scene,object,face].every(Boolean) || Object.keys(options).some(key=>!allowed.includes(key)) ||
      names.some(key=>options[key] !== undefined && !(typeof options[key] === 'string' && options[key].trim())) ||
      (saved ? id !== undefined || rectangleFields.some(key=>options[key] !== undefined) :
        !id || !rectangleFields.every(key=>integerText(options[key]))))
    throw new TypeError('Use tileset '+action+' --scene <scene.json> --object <mesh-id> --face <face-id> with a saved selection or --id and exact texel bounds');
  const input = path.resolve(scene), output = out && sceneOutput(input,out,selection);
  const editor = openEditor(input);
  const crop = saved ? JSON.parse(fs.readFileSync(path.resolve(selection),'utf8')) : pickTilesetRectangle(editor.snapshot(),id,
    Object.fromEntries(rectangleFields.map(key=>[key,Number(options[key])])),toolkit);
  const request = {object,face,selection:crop,...(part && {part}),...(material && {material})};
  const {coordinates} = require('./construction-plane.js');
  for (const key of vectors) if (options[key] !== undefined) request[key] = coordinates(options[key],3,'--'+key);
  if (plane !== undefined) request.planeAt = coordinates(plane,2,'--plane');
  if (snapGrid !== undefined) request.snapGrid = snapGrid;
  for (const [key,field] of [['texels-per-unit','texelsPerUnit'],['brush-scale','brushScale']]) {
    if (options[key] !== undefined) request[field] = numberOption(options,key);
  }
  return publishFaceEdit(editor,request,{projectTexelsPerUnit},output,'planTilesetFace','placeTilesetFace');
}

function faceEditCommand(action, [file,...rest], options, projectTexelsPerUnit, openEditor) {
  const {scene,out} = options;
  const name = value=>typeof value === 'string' && value.trim();
  if (rest.length || ![file,scene].every(name) || out !== undefined && !name(out) ||
      Object.keys(options).some(key=>!['scene','out'].includes(key)))
    throw new TypeError('Use tileset '+action+' <request.json> --scene <scene.json> [--out <new-scene.json>]');
  const input = path.resolve(scene), output = out && sceneOutput(input,out,file);
  const editor = openEditor(input), request = JSON.parse(fs.readFileSync(path.resolve(file),'utf8'));
  const rectangle = action === 'rectangle';
  return publishFaceEdit(editor,request,{projectTexelsPerUnit},output,
    rectangle ? 'planTilesetRectangle' : 'planTilesetStroke',rectangle ? 'applyTilesetRectangle' : 'applyTilesetStroke');
}

function publishFaceEdit(editor, request, settings, output, plan, apply) {
  let report;
  if (output) {
    try {
      report = editor[apply](request,settings);
      files.publishJson(output,editor.snapshot(),'A different scene already exists at '+output);
    } catch (error) {
      if (!error.report) throw error;
      report = error.report;
      process.exitCode = 1;
    }
  } else report = editor[plan](request,settings);
  process.stdout.write(JSON.stringify(report,null,2)+'\n');
}

function command([action, ...args], options, toolkit, projectTexelsPerUnit, openEditor) {
  if (action === 'stroke' || action === 'rectangle') return faceEditCommand(action,args,options,projectTexelsPerUnit,openEditor);
  if (action === 'stamp' || action === 'place') return stampCommand(action,args,options,toolkit,projectTexelsPerUnit,openEditor);
  if (['resize','resample','swap'].includes(action))
    return require('./tileset-canvas.js').command(action,args,options,openEditor);
  if (action === 'link' || action === 'reload')
    return require('./tileset-source-links.js').command(action,args,options,toolkit,openEditor);
  if (action === 'extract') return extractCommand(args,options,toolkit);
  if (action === 'repack') return require('./tileset-repack.js').command(args,options,toolkit);
  if (action === 'grid') return gridCommand(args,options,toolkit);
  if (action === 'world-scale') return worldScaleCommand(args,options,toolkit,projectTexelsPerUnit);
  if (action === 'pick') return pickCommand(args,options,toolkit,projectTexelsPerUnit);
  if (action === 'brush-uv') return brushUVCommand(args,options,toolkit,openEditor);
  if (action === 'brush-size') return brushSizeCommand(args,options,toolkit,projectTexelsPerUnit);
  if (action === 'brush-preview') return previewCommand(args,options,toolkit);
  const revisions = require('./tileset-revisions.js');
  if (revisions.supports(action)) return revisions.command(action,args,options,toolkit,openEditor);
  const [source,...rest] = args;
  const {id,scene,out,width,height,background} = options;
  const create = action === 'create';
  const allowed = ['id','scene','out',...tileFields,...(create ? ['width','height','background'] : [])];
  if (!['import','create'].includes(action) || rest.length || Object.keys(options).some(key => !allowed.includes(key)) ||
      ![id,scene,out].every(value => typeof value === 'string' && value.trim()))
    throw new TypeError('Use an ink-studio tileset command from the CLI help');
  if (create) {
    if (source !== undefined || ![width,height].every(value => typeof value === 'string' && /^\d+$/.test(value)))
      throw new TypeError('Use tileset create --width <texels> --height <texels> [--background <color>]');
  } else if (!source) {
    throw new TypeError('Use tileset import <image.png>');
  }
  const input = path.resolve(scene), output = sceneOutput(input,out,source);
  const tilesets = toolkit.KIT.authoring.tilesets, tileSize = tileOptions(options);
  const asset = create ? tilesets.blank({width:Number(width),height:Number(height),background}) : readTilesetImage(source,toolkit);
  const registered = tilesets.register(JSON.parse(fs.readFileSync(input,'utf8')),id,tileSize ? {...asset,tileSize} : asset);
  files.publishJson(output,registered,'A different scene already exists at '+output);
  process.stdout.write(JSON.stringify({scene:output,id,width:asset.width,height:asset.height,encoding:asset.encoding},null,2)+'\n');
}

module.exports = {readTilesetImage,pickTilesetRectangle,pickTilesetBlock,sizeTilesetBrush,tilesetBrushUV,tilesetBrushCellUV,rasterizeTilesetBrush,command};
