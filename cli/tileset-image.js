'use strict';

const fs = require('node:fs');
const path = require('node:path');
const PNG = require('./png.js');
const files = require('./asset-files.js');

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

function command([action, source, ...rest], options, toolkit) {
  const {id,scene,out,width,height,background} = options;
  const create = action === 'create';
  const allowed = ['id','scene','out',...(create ? ['width','height','background'] : [])];
  if (!['import','create'].includes(action) || rest.length || Object.keys(options).some(key => !allowed.includes(key)) ||
      ![id,scene,out].every(value => typeof value === 'string' && value.trim()))
    throw new TypeError('Use tileset import or tileset create with --scene, --id and --out');
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

module.exports = {readTilesetImage,command};
