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
  const {id,scene,out} = options;
  if (action !== 'import' || !source || rest.length || Object.keys(options).some(key => !['id','scene','out'].includes(key)) ||
      ![id,scene,out].every(value => typeof value === 'string' && value.trim()))
    throw new TypeError('Use tileset import <image.png> --scene <scene.json> --id <tileset-id> --out <new-scene.json>');
  const output = path.resolve(out), input = path.resolve(scene);
  if (!/\.json$/i.test(output) || path.dirname(input) !== path.dirname(output) ||
      output === input || output === path.resolve(source))
    throw new RangeError('Write a new scene JSON beside the original to preserve relative scene assets');
  const asset = readTilesetImage(source,toolkit);
  const registered = toolkit.KIT.authoring.tilesets.register(JSON.parse(fs.readFileSync(input,'utf8')),id,asset);
  files.publishJson(output,registered,'A different scene already exists at '+output);
  const {width,height,encoding} = asset;
  process.stdout.write(JSON.stringify({scene:output,id,width,height,encoding},null,2)+'\n');
}

module.exports = {readTilesetImage,command};
