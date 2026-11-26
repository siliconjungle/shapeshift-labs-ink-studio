'use strict';

const fs = require('node:fs'), path = require('node:path');
const {publishJson} = require('./asset-files.js');

function command([file,...rest],options,openEditor,sceneOutput) {
  const {scene,out,selection} = options;
  if (rest.length || ![file,scene,...Object.values(options)].every(value => typeof value === 'string' && value.trim()) ||
      Object.keys(options).some(key => !['scene','out','selection'].includes(key)))
    throw new TypeError('Use tileset promote-prefab <request.json> --scene <scene.json> [--selection faces.json] [--out new-scene.json]');
  const source = path.resolve(scene), output = out && sceneOutput(source,out,file);
  if (output && selection && output === path.resolve(selection))
    throw new RangeError('Write the scene separately from its inputs');
  const read = file => JSON.parse(fs.readFileSync(file,'utf8'));
  const request = read(file);
  if (selection) {
    if (!request?.faces || Object.keys(request.faces).length !== 1 || Object.values(request.faces)[0] !== null)
      throw new TypeError('To use --selection, name one object with a null entry in faces');
    request.faces[Object.keys(request.faces)[0]] = read(selection);
  }
  const editor = openEditor(source);
  const report = editor.planTilesetPrefab(request);
  if (out && report.canCommit) {
    editor.promoteTilesetPrefab(request);
    publishJson(output,editor.snapshot(),'A different scene already exists at '+output);
  } else if (out) process.exitCode = 1;
  process.stdout.write(JSON.stringify(report,null,2)+'\n');
}

module.exports = {command};
