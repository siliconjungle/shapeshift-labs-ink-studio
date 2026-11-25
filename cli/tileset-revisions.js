'use strict';

const path = require('node:path');
const files = require('./asset-files.js');
const {readTilesetImage} = require('./tileset-image.js');

const fields = {
  dependencies:[], clone:['id','new-id'], replace:['id'], combine:['ids','new-id'],
  deduplicate:['id','keep-id'], remove:['id']
};

function command(type, args, options, toolkit, openEditor) {
  const {scene,id,out,'new-id':newId,'keep-id':keepId,ids,axis} = options;
  const name = value=>typeof value === 'string' && value.trim();
  const required = fields[type];
  const allowed = ['scene',...required,...(type === 'dependencies' ? ['id'] : ['out']),
    ...(type === 'combine' ? ['axis'] : [])];
  if (!name(scene) || !required.every(key=>name(options[key])) ||
      Object.entries(options).some(([key,value])=>!allowed.includes(key) || !name(value)) ||
      args.length !== (type === 'replace' ? 1 : 0) || out && !/\.json$/i.test(out))
    throw new TypeError('Use tileset '+type+' --scene <scene.json> with the IDs in tileset help');
  const input = path.resolve(scene), output = out && path.resolve(out);
  if (output && (output === input || path.dirname(input) !== path.dirname(output) ||
      type === 'replace' && output === path.resolve(args[0])))
    throw new RangeError('Write a new scene JSON beside the original to preserve relative scene assets');
  const editor = openEditor(input);
  if (type === 'dependencies') {
    process.stdout.write(JSON.stringify(editor.tilesetDependencies(id),null,2)+'\n');
    return;
  }
  const request = {type,...(id !== undefined && {id}),...(newId !== undefined && {newId}),
    ...(keepId !== undefined && {keepId}),...(ids !== undefined && {ids:ids.split(',').map(key=>key.trim())}),
    ...(axis !== undefined && {axis}),...(type === 'replace' && {asset:readTilesetImage(args[0],toolkit)})};
  let report;
  if (output) {
    try {
      report = editor.editTilesetRevision(request);
      files.publishJson(output,editor.snapshot(),'A different scene already exists at '+output);
    } catch (error) {
      if (!error.report) throw error;
      report = error.report;
      process.exitCode = 1;
    }
  } else report = editor.planTilesetRevision(request);
  process.stdout.write(JSON.stringify(report,null,2)+'\n');
}

module.exports = {command, supports: type=>Object.hasOwn(fields,type)};
