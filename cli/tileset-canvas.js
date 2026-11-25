'use strict';

const path = require('node:path');
const files = require('./asset-files.js');

function command(type, args, options, openEditor) {
  const {scene,id,out,width,height,anchor} = options, name = value=>typeof value === 'string' && value.trim();
  const allowed = ['scene','id','out','width','height','tile-width','tile-height',...(type === 'resize' ? ['anchor'] : [])];
  const tile = ['tile-width','tile-height'].map(key=>options[key]);
  const integer = value=>typeof value === 'string' && /^\d+$/.test(value);
  if (args.length || ![scene,id].every(name) || ![width,height].every(integer) ||
      out !== undefined && (!name(out) || !/\.json$/i.test(out)) ||
      anchor !== undefined && !name(anchor) ||
      Object.keys(options).some(key=>!allowed.includes(key)) ||
      tile.some(value=>value!==undefined) && !tile.every(integer))
    throw new TypeError('Use tileset '+type+' --scene <scene.json> --id <tileset-id> --width N --height N'+
      (type === 'resize' ? ' [--anchor <anchor>]' : '')+' [--tile-width N --tile-height N] [--out <revised.json>]');
  const input = path.resolve(scene), output = out && path.resolve(out);
  if (output && (input === output || path.dirname(input) !== path.dirname(output)))
    throw new RangeError('Write a new scene JSON beside the original to preserve relative scene assets');
  const operation = {type,size:[Number(width),Number(height)],...(anchor && {anchor}),
    ...(tile[0] !== undefined && {tileSize:{width:Number(tile[0]),height:Number(tile[1])}})};
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
