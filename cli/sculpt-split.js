'use strict';

const fs = require('node:fs');
const path = require('node:path');
const files = require('./asset-files.js');
const jsonFile = value => typeof value === 'string' && value.endsWith('.json');

module.exports = function sculptSplit([verb, scene, request, ...rest], flags, openEditor) {
  const { out } = flags;
  if (!['plan', 'apply'].includes(verb) || !jsonFile(scene) || !jsonFile(request) || rest.length ||
      Object.keys(flags).some(key => key !== 'out') || (verb === 'apply' ? !jsonFile(out) : out !== undefined))
    throw new TypeError('Use sculpt-split plan <scene.json> <split.json> or apply <scene.json> <split.json> --out scene.json');
  const editor = openEditor(scene);
  const input = JSON.parse(fs.readFileSync(request, 'utf8'));
  if (verb === 'plan') {
    console.log(JSON.stringify(editor.planSculptSplit(input), null, 2));
    return;
  }

  const destination = path.resolve(out);
  if ([scene, request].some(file => path.resolve(file) === destination) ||
      path.dirname(destination) !== path.dirname(path.resolve(scene)))
    throw new RangeError('Write the split scene beside its source to preserve relative assets');
  const report = editor.splitSculpt(input);
  editor.build();
  files.json(destination, editor.snapshot());
  console.log(JSON.stringify(report, null, 2));
};
