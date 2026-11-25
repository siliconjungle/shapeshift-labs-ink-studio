'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {publishJson} = require('./asset-files.js');

function command([action,file,...rest], options, toolkit) {
  const {scene,out,seed,key,step} = options;
  const sampling = action === 'sample', playing = action === 'play';
  const allowed = ['scene',...(action === 'inspect' ? [] : ['out']),...(sampling ? ['seed','key'] : []),...(playing ? ['step','seed'] : [])];
  if (!['create','inspect','sample','play'].includes(action) || rest.length ||
      ![file,scene].every(value => typeof value === 'string' && value.trim()) ||
      Object.keys(options).some(option => !allowed.includes(option)) ||
      out !== undefined && (typeof out !== 'string' || !/\.json$/i.test(out)))
    throw new TypeError('Use tileset collection create, inspect, sample, or play with a JSON file and --scene <scene.json>');
  if (out && [file,scene].some(input => path.resolve(input) === path.resolve(out)))
    throw new RangeError('Write a separate tile collection output file');
  if (sampling && (typeof seed !== 'string' || !/^-?\d+$/.test(seed)))
    throw new TypeError('Use an integer --seed and a nonempty --key');
  if (playing && seed !== undefined && (typeof seed !== 'string' || !/^-?\d+$/.test(seed)))
    throw new TypeError('Use an integer --seed');
  if (playing && step !== undefined && (typeof step !== 'string' || !/^\d+$/.test(step)))
    throw new TypeError('Use a nonnegative integer --step');
  const read = input => JSON.parse(fs.readFileSync(input,'utf8'));
  const collections = toolkit.KIT.authoring.tilesetCollections;
  const numericSeed = seed === undefined ? undefined : Number(seed);
  const settings = sampling ? {seed:numericSeed,key} : playing ? {step:Number(step ?? 0),seed:numericSeed} : undefined;
  const result = collections[action](read(scene),read(file),settings);
  if (out) publishJson(out,sampling || playing ? result.selection : result,'A different tile collection output already exists at '+out);
  process.stdout.write(JSON.stringify(result,null,2)+'\n');
}

module.exports = {command};
