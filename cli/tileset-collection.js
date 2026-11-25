'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {publishJson} = require('./asset-files.js');

function command([action,file,...rest], options, toolkit) {
  const {scene,out,seed,key} = options;
  const sampling = action === 'sample';
  const allowed = ['scene',...(action === 'inspect' ? [] : ['out']),...(sampling ? ['seed','key'] : [])];
  if (!['create','inspect','sample'].includes(action) || rest.length ||
      ![file,scene].every(value => typeof value === 'string' && value.trim()) ||
      Object.keys(options).some(option => !allowed.includes(option)) ||
      out !== undefined && (typeof out !== 'string' || !/\.json$/i.test(out)))
    throw new TypeError('Use tileset collection create, inspect, or sample with a JSON file and --scene <scene.json>');
  if (out && [file,scene].some(input => path.resolve(input) === path.resolve(out)))
    throw new RangeError('Write a separate tile collection output file');
  if (sampling && (typeof seed !== 'string' || !/^-?\d+$/.test(seed)))
    throw new TypeError('Use an integer --seed and a nonempty --key');
  const read = input => JSON.parse(fs.readFileSync(input,'utf8'));
  const collections = toolkit.KIT.authoring.tilesetCollections;
  const result = sampling ? collections.sample(read(scene),read(file),{seed:Number(seed),key}) :
    collections[action](read(scene),read(file));
  if (out) publishJson(out,sampling ? result.selection : result,'A different tile collection output already exists at '+out);
  process.stdout.write(JSON.stringify(result,null,2)+'\n');
}

module.exports = {command};
