'use strict';

const fs = require('node:fs');
const path = require('node:path');
const files = require('./asset-files.js');
const jsonFile = value => typeof value === 'string' && value.endsWith('.json');
const name = value => typeof value === 'string' && value.trim().length > 0;

module.exports = function sculptSnap([verb, scene, input, ...rest], flags, openEditor) {
  const { target, id, out } = flags;
  const names = { plan: [], apply: ['out'], inspect: ['target', 'id'] };
  if (!Object.hasOwn(names, verb) || !jsonFile(scene) || rest.length ||
      Object.keys(flags).some(key => !names[verb].includes(key)) ||
      (verb === 'inspect' ? input !== undefined || !name(target) || !name(id) : !jsonFile(input)) ||
      verb === 'apply' && !jsonFile(out))
    throw new TypeError('Use sculpt-snap plan|apply <scene.json> <stroke.json> [--out scene.json] or inspect --target solid --id stroke');

  const editor = openEditor(scene);
  if (verb === 'inspect') return console.log(JSON.stringify(editor.inspectSculptSnap(target, id), null, 2));
  const request = JSON.parse(fs.readFileSync(input, 'utf8'));
  if (verb === 'plan') return console.log(JSON.stringify(editor.planSculptSnap(request), null, 2));

  const destination = path.resolve(out);
  if ([scene, input].some(file => path.resolve(file) === destination) ||
      path.dirname(destination) !== path.dirname(path.resolve(scene)))
    throw new RangeError('Write the snapped scene beside its source to preserve relative assets');
  const report = editor.applySculptSnap(request);
  editor.build();
  files.json(destination, editor.snapshot());
  console.log(JSON.stringify(report, null, 2));
};
