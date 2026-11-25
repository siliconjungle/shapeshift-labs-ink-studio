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

function pickTilesetRectangle(scene, id, rectangle, toolkit = require('..').load()) {
  const tilesets = toolkit.KIT.authoring.tilesets.prepare(scene.tilesets);
  return Selection.pick(id,tilesets.source(id),rectangle);
}

function pickTilesetBlock(scene, id, rectangle, tileSize, toolkit = require('..').load()) {
  const tilesets = toolkit.KIT.authoring.tilesets.prepare(scene.tilesets);
  return Selection.block(id,tilesets.source(id),rectangle,tileSize);
}

function rasterizeTilesetBrush(scene, brush, toolkit = require('..').load()) {
  if (brush?.format !== 'ink-studio/tileset-brush' || brush.version !== 1)
    throw new TypeError('Expected a version 1 tileset brush');
  const tilesets = toolkit.KIT.authoring.tilesets.prepare(scene.tilesets), id = brush.tileset;
  const source = tilesets.source(id);
  const {x,y,width,height,columns,rows} = Selection.block(id,source,brush,{width:brush.tileWidth,height:brush.tileHeight});
  if (brush.columns !== columns || brush.rows !== rows)
    throw new RangeError('Tile brush row and column counts do not match its bounds');
  const {pixels} = tilesets.resolve({tileset:id}), crop = new Uint8Array(width*height*4), stride = width*4;
  for (let row=0;row<height;row++) {
    const start = ((y+row)*source.width+x)*4;
    crop.set(pixels.subarray(start,start+stride),row*stride);
  }
  return {width,height,pixels:crop};
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

function pickCommand(args, options, toolkit) {
  const {scene,id,out} = options, fields = ['x','y','width','height'];
  const tileFields = ['tile-width','tile-height'];
  const integerText = value => typeof value === 'string' && /^-?\d+$/.test(value);
  if (args.length || ![scene,id].every(value => typeof value === 'string' && value.trim()) ||
      Object.keys(options).some(key => !['scene','id','out',...fields,...tileFields].includes(key)) ||
      out !== undefined && (typeof out !== 'string' || !/\.(html|json)$/i.test(out)))
    throw new TypeError('Use tileset pick --scene <scene.json> --id <tileset-id> with rectangle or tile options');
  const block = tileFields.some(key => options[key] !== undefined);
  if (block && !tileFields.every(key => integerText(options[key])))
    throw new TypeError('Specify both --tile-width and --tile-height as integers');
  const tile = block ? {width:Number(options['tile-width']),height:Number(options['tile-height'])} : undefined;
  const visual = out !== undefined && /\.html$/i.test(out);
  if (visual && block) throw new TypeError('Save a tile brush as JSON and render it with tileset brush-preview');
  const count = fields.filter(key => options[key] !== undefined).length;
  if ((!visual || count) && !fields.every(key => integerText(options[key])))
    throw new TypeError('Specify all four rectangle values as integers');
  const filename = path.resolve(scene), output = out && path.resolve(out);
  if (output === filename) throw new RangeError('Write the pick separately from the source scene');
  const document = JSON.parse(fs.readFileSync(filename,'utf8'));
  const tilesets = toolkit.KIT.authoring.tilesets.prepare(document.tilesets), source = tilesets.source(id);
  const bounds = count ? Object.fromEntries(fields.map(key => [key,Number(options[key])])) :
    {x:0,y:0,width:1,height:1};
  const selection = block ? Selection.block(id,source,bounds,tile) : Selection.pick(id,source,bounds);
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

function command([action, ...args], options, toolkit) {
  if (action === 'pick') return pickCommand(args,options,toolkit);
  if (action === 'brush-preview') return previewCommand(args,options,toolkit);
  const [source,...rest] = args;
  const {id,scene,out,width,height,background} = options;
  const create = action === 'create';
  const allowed = ['id','scene','out',...(create ? ['width','height','background'] : [])];
  if (!['import','create'].includes(action) || rest.length || Object.keys(options).some(key => !allowed.includes(key)) ||
      ![id,scene,out].every(value => typeof value === 'string' && value.trim()))
    throw new TypeError('Use tileset import, create, pick, or brush-preview');
  if (create) {
    if (source !== undefined || ![width,height].every(value => typeof value === 'string' && /^\d+$/.test(value)))
      throw new TypeError('Use tileset create --width <texels> --height <texels> [--background <color>]');
  } else if (!source) {
    throw new TypeError('Use tileset import <image.png>');
  }
  const output = path.resolve(out), input = path.resolve(scene);
  if (!/\.json$/i.test(output) || path.dirname(input) !== path.dirname(output) ||
      output === input || !create && output === path.resolve(source))
    throw new RangeError('Write a new scene JSON beside the original to preserve relative scene assets');
  const tilesets = toolkit.KIT.authoring.tilesets;
  const asset = create ? tilesets.blank({width:Number(width),height:Number(height),background}) : readTilesetImage(source,toolkit);
  const registered = tilesets.register(JSON.parse(fs.readFileSync(input,'utf8')),id,asset);
  files.publishJson(output,registered,'A different scene already exists at '+output);
  process.stdout.write(JSON.stringify({scene:output,id,width:asset.width,height:asset.height,encoding:asset.encoding},null,2)+'\n');
}

module.exports = {readTilesetImage,pickTilesetRectangle,pickTilesetBlock,rasterizeTilesetBrush,command};
