'use strict';

const fs = require('node:fs');
const path = require('node:path');
const files = require('./asset-files.js');
const jsonFile = value => typeof value === 'string' && value.endsWith('.json');
const name = value => typeof value === 'string' && value.trim().length > 0;

module.exports = function sculptContribution([verb, scene, input, ...rest], flags, openEditor) {
  const { solid, id, out } = flags;
  const flagNames = { list: ['solid'], inspect: ['solid', 'id'], edit: ['out'] };
  if (!Object.hasOwn(flagNames, verb) || !jsonFile(scene) || rest.length ||
      Object.keys(flags).some(key => !flagNames[verb].includes(key)) ||
      (verb === 'edit' ? !jsonFile(input) || !jsonFile(out) : input !== undefined || !name(solid)) ||
      verb === 'inspect' && !name(id))
    throw new TypeError('Use sculpt-contribution list or inspect --solid id, or edit <scene.json> <edit.json> --out scene.json');

  const editor = openEditor(scene);
  let result;
  if (verb === 'list') result = { solid, contributions: editor.sculptContributions(solid) };
  if (verb === 'inspect') result = editor.inspectSculptContribution(solid, id);
  if (verb === 'edit') {
    const destination = path.resolve(out);
    if ([scene, input].some(file => path.resolve(file) === destination) ||
        path.dirname(destination) !== path.dirname(path.resolve(scene)))
      throw new RangeError('Write the edited scene beside its source to preserve relative assets');
    const request = JSON.parse(fs.readFileSync(input, 'utf8'));
    result = editor.editSculptContribution(request);
    editor.build();
    files.json(destination, editor.snapshot());
  }
  console.log(JSON.stringify(result, null, 2));
};
