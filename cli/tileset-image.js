'use strict';

const fs = require('node:fs');
const path = require('node:path');
const PNG = require('./png.js');
const files = require('./asset-files.js');
const Selection = require('../src/tileset-selection.js');
const {canonicalDigest,isRevision} = require('./pixel-edit-revisions.js');

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
const paintFlags = ['paint-rotate','paint-flip-x','paint-flip-y'];
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

function paintOptions(options) {
  if (!paintFlags.some(key=>options[key] !== undefined)) return;
  return Selection.paintOrientation({rotation:numberOption(options,'paint-rotate'),
    flipX:options['paint-flip-x'],flipY:options['paint-flip-y']});
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
  return Selection.readBrush(tilesets.source(brush.tileset),brush);
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
  const raster = Selection.pack(selected,width,pixels,4);
  return brush.paint === undefined ? raster : Selection.paintRaster(raster,Selection.paintOrientation(brush.paint),4);
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
      Object.keys(options).some(key => !['scene','id','out','brush','brush-scale',...fields,...tileFields,...paintFlags].includes(key)) ||
      out !== undefined && (typeof out !== 'string' || !/\.(html|json)$/i.test(out)))
    throw new TypeError('Use tileset pick --scene <scene.json> --id <tileset-id> with rectangle bounds and optional --brush');
  const tile = tileOptions(options), block = options.brush === true || tile !== undefined;
  const scale = numberOption(options,'brush-scale'), paint = paintOptions(options);
  if (!block && paint) throw new TypeError('Paint orientation on a saved pick requires a tile brush');
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
  const result = paint ? {...selection,paint} : selection;
  if (output) return files.publishJson(output,result,'A different selection already exists at '+output);
  process.stdout.write(JSON.stringify(result,null,2)+'\n');
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
  const {scene,id,object,face,part,out,material,selection,plane,'snap-grid':snapGrid,edge,sizing} = options;
  const growing = action === 'grow';
  const names = ['scene','id','object','face','part','out','material','selection',...(growing ? ['edge','sizing'] : [])];
  const vectors = ['origin','right','up'];
  const placement = growing ? ['angle','depth'] : [...vectors,'plane','snap-grid'];
  const allowed = [...names,...placement,...rectangleFields,'brush-scale','texels-per-unit',...paintFlags];
  const saved = selection !== undefined;
  if (args.length || ![scene,object,face].every(Boolean) || growing && !edge || Object.keys(options).some(key=>!allowed.includes(key)) ||
      names.some(key=>options[key] !== undefined && !(typeof options[key] === 'string' && options[key].trim())) ||
      (saved ? id !== undefined || rectangleFields.some(key=>options[key] !== undefined) :
        !id || !rectangleFields.every(key=>integerText(options[key]))))
    throw new TypeError('Use tileset '+action+' --scene <scene.json> --object <mesh-id> --face <face-id>'+
      (growing ? ' --edge <edge-id>' : '')+' with a saved selection or --id and exact texel bounds');
  const input = path.resolve(scene), output = out && sceneOutput(input,out,selection);
  const editor = openEditor(input);
  const picked = saved ? JSON.parse(fs.readFileSync(path.resolve(selection),'utf8')) : pickTilesetRectangle(editor.snapshot(),id,
    Object.fromEntries(rectangleFields.map(key=>[key,Number(options[key])])),toolkit);
  const eyedrop = picked?.format === 'ink-studio/tileset-face-pick';
  if (eyedrop && (picked.version !== 1 || picked.canStamp !== true || !picked.stamp))
    throw new TypeError('The face pick needs a reusable version 1 stamp');
  const preset = eyedrop ? picked.stamp : {selection:picked};
  const paint = paintOptions(options) ?? preset.paint;
  const slot = material ?? preset.material;
  const worldSize = options['texels-per-unit'] === undefined && options['brush-scale'] === undefined ? preset.worldSize : undefined;
  const request = {object,face,selection:preset.selection,...(part && {part}),...(slot && {material:slot}),...(paint && {paint}),
    ...(preset.uvInset && {uvInset:preset.uvInset}),...(worldSize && {worldSize}),
    ...(preset.materialDefinition && slot === preset.material && {materialDefinition:preset.materialDefinition})};
  const {coordinates} = require('./construction-plane.js');
  for (const key of vectors) if (options[key] !== undefined) request[key] = coordinates(options[key],3,'--'+key);
  if (plane !== undefined) request.planeAt = coordinates(plane,2,'--plane');
  if (snapGrid !== undefined) request.snapGrid = snapGrid;
  for (const [key,field] of [['texels-per-unit','texelsPerUnit'],['brush-scale','brushScale']]) {
    if (options[key] !== undefined) request[field] = numberOption(options,key);
  }
  if (growing) {
    Object.assign(request,{edge,sizing,angle:numberOption(options,'angle'),depth:numberOption(options,'depth')});
    return publishFaceEdit(editor,request,{projectTexelsPerUnit},output,'planTilesetGrow','growTilesetFace');
  }
  return publishFaceEdit(editor,request,{projectTexelsPerUnit},output,'planTilesetFace','placeTilesetFace');
}

function eyedropCommand(args, options, openEditor) {
  const {scene,object,part,face,out,'brush-size':brushSize} = options;
  const name = value=>typeof value === 'string' && value.trim();
  if (args.length || ![scene,object,face].every(name) ||
      [part,out].some(value=>value !== undefined && !name(value)) ||
      brushSize !== undefined && brushSize !== true ||
      Object.keys(options).some(key=>!['scene','object','part','face','out','brush-size'].includes(key)))
    throw new TypeError('Use tileset eyedrop --scene <scene.json> --object <mesh-id> --face <face-id> [--brush-size] [--out <pick.json>]');
  const input = path.resolve(scene), output = out && path.resolve(out);
  if (output && (output === input || !/\.json$/i.test(output))) throw new RangeError('Write the face pick to a separate JSON file');
  const result = openEditor(input).eyedropTilesetFace({object,part,face,brushSize});
  if (output && result.canStamp) files.publishJson(output,result,'A different face pick already exists at '+output);
  if (output && !result.canStamp) process.exitCode = 1;
  process.stdout.write(JSON.stringify(result,null,2)+'\n');
}

function reskinCommand(args, options, openEditor) {
  const {scene,object,part,face,mode,selection,id,column,row,out} = options;
  const name = value=>typeof value === 'string' && value.trim();
  const hasCell = column !== undefined || row !== undefined;
  if (args.length || ![scene,object,face,mode].every(name) ||
      [part,out,selection,id].some(value=>value !== undefined && !name(value)) ||
      Object.keys(options).some(key=>!['scene','object','part','face','mode','selection','id','column','row','out'].includes(key)) ||
      (id ? mode !== 'tileset' || selection !== undefined : !selection) ||
      hasCell && (!selection || ![column,row].every(integerText)))
    throw new TypeError('Use tileset reskin --scene <scene.json> --object <mesh-id> --face <face-id> --mode crop|tileset|relative with --selection <pick.json> or --id <tileset-id> for tileset mode');
  const input = path.resolve(scene), output = out && sceneOutput(input,out,selection);
  const request = {object,part,face,mode,...(id && {tileset:id}),
    ...(selection && {selection:JSON.parse(fs.readFileSync(path.resolve(selection),'utf8'))}),
    ...(hasCell && {cell:{column:Number(column),row:Number(row)}})};
  return publishFaceEdit(openEditor(input),request,undefined,output,'planTilesetReskin','applyTilesetReskin');
}

function guttersCommand([file,...rest], options, openEditor) {
  const {scene,out} = options;
  if (rest.length || !file || !scene ||
      Object.entries(options).some(([key,value])=>!['scene','out'].includes(key) || typeof value!=='string' || !value.trim()))
    throw new TypeError('Use tileset gutters <request.json> --scene <scene.json> [--out <new-scene.json>]');
  const input = path.resolve(scene), output = out && sceneOutput(input,out,file);
  const request = JSON.parse(fs.readFileSync(path.resolve(file),'utf8'));
  return publishFaceEdit(openEditor(input),request,undefined,output,'planTilesetGutters','editTilesetGutters');
}

function assignCommand([file,...rest], options, toolkit, openEditor) {
  const {scene,out,preview,view} = options;
  if (rest.length || !file || !scene || view && !preview ||
      Object.entries(options).some(([key,value])=>!['scene','out','preview','view'].includes(key) || typeof value!=='string' || !value.trim()))
    throw new TypeError('Use tileset assign <request.json> --scene <scene.json> [--preview dir] [--view view.json] [--out <new-scene.json>]');
  const source = path.resolve(scene), output = out && sceneOutput(source,out,file);
  const read = filename=>JSON.parse(fs.readFileSync(path.resolve(filename),'utf8'));
  if (output && view && output===path.resolve(view)) throw new RangeError('Write the scene separately from the preview settings');
  const request = read(file), editor = openEditor(source);
  const report = editor.planTilesetAssignment(request);
  const revised = report.canCommit && (preview || output) ? editor.fork() : editor;
  if (revised!==editor) revised.applyTilesetAssignment(request);
  const review = preview && require('./mesh-uv-editor.js').assignmentReview(editor,revised,report,view ? read(view) : {},
    toolkit,preview,[source,path.resolve(file),output,view && path.resolve(view)]);
  if (output && report.canCommit) files.publishJson(output,revised.snapshot(),'A different scene already exists at '+output);
  if (output && !report.canCommit) process.exitCode = 1;
  process.stdout.write(JSON.stringify({...report,...(review && {preview:review})},null,2)+'\n');
}

const faceEdits = {
  stroke:['planTilesetStroke','applyTilesetStroke'],
  rectangle:['planTilesetRectangle','applyTilesetRectangle'],
  'brush-run':['planTilesetBrushRun','applyTilesetBrushRun'],
  face:['planTilesetFaceFromVertices','createTilesetFaceFromVertices'],
  block:['planTilesetBlock','applyTilesetBlock'],
  primitive:['planTilesetPrimitive','applyTilesetPrimitive']
};

function faceEditCommand(action, [file,...rest], options, projectTexelsPerUnit, openEditor) {
  const {scene,out,selection,collection,'brush-file':brush,'vertices-file':vertices} = options;
  const extras = {'brush-run':['brush-file'],face:['selection','vertices-file'],block:['selection'],primitive:['selection'],
    stroke:['collection'],rectangle:['collection']};
  const name = value=>typeof value === 'string' && value.trim();
  if (rest.length || ![file,scene].every(name) || out !== undefined && !name(out) ||
      Object.keys(options).some(key=>!['scene','out',...extras[action]].includes(key)) ||
      [brush,selection,collection,vertices].some(value=>value !== undefined && !name(value)))
    throw new TypeError('Use tileset '+action+' <request.json> --scene <scene.json> [--out <new-scene.json>]');
  const input = path.resolve(scene), output = out && sceneOutput(input,out,file);
  const read = filename=>JSON.parse(fs.readFileSync(path.resolve(filename),'utf8'));
  const request = read(file);
  if (vertices !== undefined) {
    if (output === path.resolve(vertices)) throw new RangeError('Write the scene separately from the vertex selection');
    if (!request || Object.getPrototypeOf(request) !== Object.prototype || Object.hasOwn(request,'vertices'))
      throw new TypeError('Provide vertices in the request or with --vertices-file');
    request.vertices = read(vertices);
  }
  if (collection !== undefined) {
    if (output === path.resolve(collection)) throw new RangeError('Write the scene separately from the collection');
    if (!request || Object.getPrototypeOf(request) !== Object.prototype || Object.hasOwn(request,'collection'))
      throw new TypeError('Provide the collection in the request or with --collection');
    request.collection = read(collection);
  }
  if (brush !== undefined) {
    if (output === path.resolve(brush)) throw new RangeError('Write the scene separately from the brush');
    if (!request || Object.getPrototypeOf(request) !== Object.prototype || Object.hasOwn(request,'brush'))
      throw new TypeError('Provide the brush in the request or with --brush-file');
    request.brush = read(brush);
  }
  if (selection !== undefined) {
    if (output === path.resolve(selection)) throw new RangeError('Write the scene separately from the selection');
    if (!request || Object.getPrototypeOf(request) !== Object.prototype || Object.hasOwn(request,'selection'))
      throw new TypeError('Provide the selection in the request or with --selection');
    const picked = read(selection);
    if (picked?.format === 'ink-studio/tileset-face-pick') {
      if (picked.version !== 1 || picked.canStamp !== true || !picked.stamp)
        throw new TypeError('The face pick needs a reusable version 1 stamp');
      const {selection,paint,uvInset,material,materialDefinition} = picked.stamp;
      const slot = request.material ?? material;
      Object.assign(request,{selection,paint:request.paint ?? paint,uvInset:request.uvInset ?? uvInset,material:slot,
        materialDefinition:request.materialDefinition ?? (slot === material ? materialDefinition : undefined)});
    } else request.selection = picked;
  }
  return publishFaceEdit(openEditor(input),request,{projectTexelsPerUnit},output,...faceEdits[action]);
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

function wrapCommand([file,...rest], options, openEditor) {
  const {scene,out,expect}=options;
  if (rest.length || ![scene,file,...Object.values(options)].every(value=>typeof value==='string' && value.trim()) ||
      Object.keys(options).some(key=>!['scene','out','expect'].includes(key)))
    throw new TypeError('Use tileset wrap <request.json> --scene <scene.json> [--expect receipt.json] [--out <new-scene.json>]');
  const read=filename=>JSON.parse(fs.readFileSync(filename,'utf8'));
  const input=path.resolve(scene), output=out && sceneOutput(input,out,file);
  if (output && expect && output===path.resolve(expect)) throw new RangeError('Write the scene separately from the receipt');
  const editor=openEditor(input), request=read(file);
  const plan=editor.planTilesetWrap(request);
  const previewRevision=canonicalDigest([editor.snapshot(),editor.sourceDependencies?.(),request,plan]);
  if (expect) {
    const reviewed=read(expect);
    if (reviewed?.format!==plan.format || reviewed.version!==1 || reviewed.canCommit!==true || !isRevision(reviewed.previewRevision))
      throw new TypeError('Expected a successful tileset wrap preview receipt');
    if (reviewed.previewRevision!==previewRevision) throw new RangeError('Tileset wrap preview is stale');
  }
  if (output && plan.canCommit) {
    editor.applyTilesetWrap(request);
    files.publishJson(output,editor.snapshot(),'A different scene already exists at '+output);
  }
  if (output && !plan.canCommit) process.exitCode=1;
  process.stdout.write(JSON.stringify({...plan,previewRevision},null,2)+'\n');
}

function command([action, ...args], options, toolkit, projectTexelsPerUnit, openEditor) {
  if (action === 'collection') return require('./tileset-collection.js').command(args,options,toolkit);
  if (action === 'select') return require('./tileset-component-selection.js').command(args,options,openEditor);
  if (action === 'select-atlas') return require('./tileset-component-selection.js').atlasCommand(args,options,openEditor);
  if (action === 'reskin') return reskinCommand(args,options,openEditor);
  if (action === 'decal') return require('./tileset-decal.js').command(args,options,toolkit,openEditor,sceneOutput);
  if (action === 'wrap') return wrapCommand(args,options,openEditor);
  if (action === 'material') return require('./tileset-material.js').command(args,options,openEditor,sceneOutput);
  if (action === 'palette') return require('./tileset-palette.js').command(args,options,toolkit,openEditor,sceneOutput);
  if (action === 'paint') return require('./tileset-paint.js').command(args,options,toolkit,openEditor,sceneOutput);
  if (action === 'gutters') return guttersCommand(args,options,openEditor);
  if (action === 'bleed-review') return require('./tileset-bleed-review.js').command(args,options,toolkit,openEditor);
  if (action === 'assign') return assignCommand(args,options,toolkit,openEditor);
  if (action === 'eyedrop') return eyedropCommand(args,options,openEditor);
  if (Object.hasOwn(faceEdits,action)) return faceEditCommand(action,args,options,projectTexelsPerUnit,openEditor);
  if (action === 'stamp' || action === 'place' || action === 'grow') return stampCommand(action,args,options,toolkit,projectTexelsPerUnit,openEditor);
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
