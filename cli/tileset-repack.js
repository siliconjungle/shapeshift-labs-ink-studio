'use strict';

const path = require('node:path');
const {deflateSync} = require('node:zlib');
const Selection = require('../src/tileset-selection.js');
const PNGBytes = require('../src/png-bytes.js');
const PNG = require('./png.js');
const files = require('./asset-files.js');
const {readTilesetImage} = require('./tileset-image.js');

const marginEdges = ['left','top','right','bottom'];
const gutterAxes = ['x','y'];

function distances(values, fields, label) {
  if (!values || Object.getPrototypeOf(values) !== Object.prototype ||
      Object.keys(values).length !== fields.length ||
      !fields.every(key=>Object.hasOwn(values,key) && Number.isSafeInteger(values[key]) && values[key]>=0))
    throw new RangeError(label+' need explicit nonnegative integer texel distances');
  return Object.fromEntries(fields.map(key=>[key,values[key]]));
}

function repackTilesetImage(source, options, toolkit = require('..').load()) {
  const {margins,gutters,tileSize} = options ?? {};
  const borders = distances(margins,marginEdges,'Atlas margins');
  const spacing = distances(gutters,gutterAxes,'Atlas gutters');
  const {width:tileWidth,height:tileHeight} = tileSize ?? {};
  const tile = Selection.tileSize({width:tileWidth,height:tileHeight,
    offsetX:borders.left,offsetY:borders.top,paddingX:spacing.x,paddingY:spacing.y});
  const asset = typeof source === 'string' || source instanceof Uint8Array ? readTilesetImage(source,toolkit) :
    toolkit.KIT.authoring.tilesets.prepare({atlas:source}).source('atlas');
  const {width,height,encoding,data,palette,alpha} = asset;
  const spanX = width-borders.left-borders.right, spanY = height-borders.top-borders.bottom;
  // Require exactly the declared borders so partial content cannot be trimmed silently.
  if (spanX<tileWidth || spanY<tileHeight ||
      (spanX+spacing.x)%(tileWidth+spacing.x) || (spanY+spacing.y)%(tileHeight+spacing.y))
    throw new RangeError('Atlas dimensions must be covered exactly by the declared margins, complete cells, and gutters');
  const brush = Selection.block('atlas',asset,{x:borders.left,y:borders.top,width:spanX,height:spanY},tile);
  const indexed = encoding === 'indexed8', {columns,rows} = brush;
  const packed = Selection.pack(brush,width,Buffer.from(data,'base64'),indexed ? 1 : 4);
  const dimensions = {width:packed.width,height:packed.height,encoding};
  const compactSize = {width:tileWidth,height:tileHeight};
  const tileset = {version:1,...dimensions,data:Buffer.from(packed.pixels).toString('base64'),tileSize:compactSize,
    ...(indexed && {palette:[...palette],...(alpha !== undefined && {alpha:[...alpha]})})};
  const x = Array.from({length:columns},(_,column)=>{
    const cell = Selection.cell(brush,{column,row:0});
    return {source:cell.x,destination:cell.offset[0]};
  });
  const y = Array.from({length:rows},(_,row)=>{
    const cell = Selection.cell(brush,{column:0,row});
    return {source:cell.y,destination:cell.offset[1]};
  });
  const report = {format:'ink-studio/tileset-repack',version:1,source:{width,height,encoding},destination:dimensions,
    tileSize:compactSize,margins:borders,gutters:spacing,columns,rows,
    removedTexels:width*height-packed.width*packed.height,rectangleMap:{x,y}};
  return {tileset,report};
}

function encodeTileset({width,height,encoding,data,palette,alpha}) {
  const pixels = Buffer.from(data,'base64');
  if (encoding === 'rgba8') return PNG.encode(width,height,pixels,4);
  const colors = Uint8Array.from(palette.flatMap(color=>[color>>>16,(color>>>8)&255,color&255]));
  const transparency = alpha?.length ? Uint8Array.from(alpha) : null;
  return Buffer.concat(PNGBytes.indexed(width,height,colors,transparency,
    deflateSync(PNGBytes.scanlines(width,height,pixels))));
}

function command([source,...rest], options, toolkit) {
  const {out,report} = options, name = value=>typeof value === 'string' && value.trim();
  const fields = ['tile-width','tile-height',...marginEdges.map(edge=>'margin-'+edge),...gutterAxes.map(axis=>'gutter-'+axis)];
  if (rest.length || !name(source) || !name(out) || !/\.png$/i.test(out) ||
      report !== undefined && (!name(report) || !/\.json$/i.test(report)) ||
      Object.keys(options).some(key=>!['out','report',...fields].includes(key)) ||
      !fields.every(key=>typeof options[key] === 'string' && /^\d+$/.test(options[key])))
    throw new TypeError('Use tileset repack <atlas.png> with explicit integer tile dimensions, four margins, two gutters, --out <compact.png>, and optional --report <layout.json>');
  const input = path.resolve(source), output = path.resolve(out), receipt = report && path.resolve(report);
  if (new Set([input,output,...(receipt ? [receipt] : [])]).size !== (receipt ? 3 : 2))
    throw new RangeError('Write the repacked image and report to separate paths from the source');
  const {tileset,report:movement} = repackTilesetImage(input,{
    tileSize:{width:Number(options['tile-width']),height:Number(options['tile-height'])},
    margins:Object.fromEntries(marginEdges.map(edge=>[edge,Number(options['margin-'+edge])])),
    gutters:Object.fromEntries(gutterAxes.map(axis=>[axis,Number(options['gutter-'+axis])]))
  },toolkit);
  const png = encodeTileset(tileset);
  files.write(output,png);
  if (receipt) files.json(receipt,movement);
  process.stdout.write(JSON.stringify(movement,null,2)+'\n');
}

module.exports = {repackTilesetImage,command};
