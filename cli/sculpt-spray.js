'use strict';

const fs = require('node:fs');
const path = require('node:path');
const files = require('./asset-files.js');
const json = value => typeof value === 'string' && value.endsWith('.json');

module.exports = function sculptSpray([verb, scene, request, ...rest], flags, openEditor) {
  const { out } = flags;
  if (!['plan', 'apply', 'inspect'].includes(verb) || !json(scene) || rest.length ||
      (verb === 'inspect' ? request !== undefined : !json(request)) ||
      (verb === 'apply' ? !json(out) : out !== undefined) || Object.keys(flags).some(key => key !== 'out'))
    throw new TypeError('Use sculpt-spray plan|apply <scene.json> <brush.json> [--out scene.json] or inspect <scene.json>');

  const editor = openEditor(scene);
  if (verb === 'inspect') return console.log(JSON.stringify(editor.inspectSculptSprays(), null, 2));
  const input = JSON.parse(fs.readFileSync(request, 'utf8'));
  if (verb === 'plan') return console.log(JSON.stringify(editor.planSculptSpray(input), null, 2));

  const destination = path.resolve(out);
  if ([scene, request].some(file => path.resolve(file) === destination) ||
      path.dirname(destination) !== path.dirname(path.resolve(scene)))
    throw new RangeError('Write the sprayed scene beside its source to preserve relative assets');
  const report = editor.applySculptSpray(input);
  files.json(destination, editor.snapshot());
  console.log(JSON.stringify(report, null, 2));
};
