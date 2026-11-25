'use strict';

const path = require('node:path');
const files = require('./asset-files.js');

const name = value=>typeof value === 'string' && value.trim();
const integer = value=>typeof value === 'string' && /^\d+$/.test(value);
const rect = value=>typeof value === 'string' && /^\d+,\d+,\d+,\d+$/.test(value);
function bounds(value) {
  const [x,y,width,height] = value.split(',').map(Number);
  return {x,y,width,height};
}

function operationOptions(type, options) {
  const {width,height,anchor,a,b} = options;
  if (type === 'swap') {
    if (![a,b].every(rect)) throw new TypeError('Use tileset swap with --a X,Y,W,H --b X,Y,W,H');
    return {type,a:bounds(a),b:bounds(b)};
  }
  const tile = ['tile-width','tile-height'].map(key=>options[key]);
  if (![width,height].every(integer) || anchor !== undefined && !name(anchor) ||
      tile.some(value=>value!==undefined) && !tile.every(integer))
    throw new TypeError('Use tileset '+type+' with integer --width and --height and optional --tile-width and --tile-height');
  return {type,size:[Number(width),Number(height)],...(anchor && {anchor}),
    ...(tile[0] !== undefined && {tileSize:{width:Number(tile[0]),height:Number(tile[1])}})};
}

function command(type, args, options, openEditor) {
  const {scene,id,out} = options;
  const fields = type === 'swap' ? ['a','b'] : ['width','height','tile-width','tile-height',...(type === 'resize' ? ['anchor'] : [])];
  const allowed = ['scene','id','out',...fields];
  if (args.length || ![scene,id].every(name) || out !== undefined && (!name(out) || !/\.json$/i.test(out)) ||
      Object.keys(options).some(key=>!allowed.includes(key)))
    throw new TypeError('Use tileset '+type+' --scene <scene.json> --id <tileset-id> [--out <revised.json>]');
  const operation = operationOptions(type,options);
  const input = path.resolve(scene), output = out && path.resolve(out);
  if (output && (input === output || path.dirname(input) !== path.dirname(output)))
    throw new RangeError('Write a new scene JSON beside the original to preserve relative scene assets');
  const editor = openEditor(input);
  let report;
  if (output) {
    try {
      report = editor.transformTilesetCanvas(id,operation);
      files.publishJson(output,editor.snapshot(),'A different scene already exists at '+output);
    } catch (error) {
      if (!error.report) throw error;
      report = error.report;
      process.exitCode = 1;
    }
  } else report = editor.planTilesetCanvas(id,operation);
  process.stdout.write(JSON.stringify(report,null,2)+'\n');
}

module.exports = {command};
