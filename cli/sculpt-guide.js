'use strict';

const fs = require('node:fs');
const path = require('node:path');
const files = require('./asset-files.js');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const json = file => typeof file === 'string' && file.endsWith('.json');

module.exports = function sculptGuide([verb, scene, request, ...rest], flags, kit, loadScene) {
  const inspect = verb === 'inspect', save = ['apply', 'update'].includes(verb), { out } = flags;
  if (!['inspect', 'plan', 'apply', 'update'].includes(verb) || rest.length || !json(scene) ||
      (inspect ? request !== undefined : !json(request)) || (save ? !json(out) : out !== undefined) ||
      Object.keys(flags).some(key => key !== 'out'))
    throw new TypeError('Use sculpt-guide inspect <scene.json> or plan|apply|update <scene.json> <operation.json> [--out scene.json]');

  const source = read(scene), base = loadScene(scene, source);
  if (!base.openEditor) throw new TypeError('Guided sculpt operations need a plain editable JSON scene');
  if (inspect) {
    const reports = base.openEditor().inspectSculptGuides();
    console.log(JSON.stringify(reports, null, 2));
    return;
  }
  const destination = save && path.resolve(out);
  if (save && ([scene, request].some(file => path.resolve(file) === destination) ||
      path.dirname(destination) !== path.dirname(path.resolve(scene))))
    throw new RangeError('Write the guided scene beside its source to preserve relative assets');

  const input = read(request), guidedOperations = kit.authoring.sculptGuides.revise(source, input, verb === 'update');
  const result = { ...source, guidedOperations }, descriptor = loadScene(scene, result);
  descriptor.build();
  const report = descriptor.openEditor().inspectSculptGuides().find(row => row.id === input.id);
  if (save) files.json(destination, result);
  console.log(JSON.stringify(report, null, 2));
};
