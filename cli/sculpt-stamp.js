'use strict';

const fs = require('node:fs');
const path = require('node:path');
const files = require('./asset-files.js');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));

module.exports = function sculptStamp([verb, scene, stamp, placement, ...rest], flags, api, loadScene) {
  const { out } = flags;
  if (verb !== 'place' || rest.length || ![scene, stamp, placement, out].every(
    file => typeof file === 'string' && file.endsWith('.json')
  ) || Object.keys(flags).some(key => key !== 'out'))
    throw new TypeError('Use sculpt-stamp place <scene.json> <stamp.json> <placement.json> --out scene.json');

  const destination = path.resolve(out);
  if ([scene, stamp, placement].some(file => path.resolve(file) === destination) ||
      path.dirname(destination) !== path.dirname(path.resolve(scene)))
    throw new RangeError('Write a new stamped scene beside its source to preserve relative assets');

  const source = read(scene);
  const base = loadScene(scene, source);
  if (!base.openEditor) throw new TypeError('Sculpt stamps need a plain editable JSON scene');
  const solids = api.place(source, read(stamp), read(placement));
  const result = { ...source, solids };
  loadScene(scene, result).build();
  files.json(destination, result);
  console.log(destination);
};
