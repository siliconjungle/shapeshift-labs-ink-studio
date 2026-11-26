'use strict';

const fs = require('node:fs'), path = require('node:path');
const {publishJson} = require('./asset-files.js');
const {viewSettings} = require('./mesh-native-view.js');
const {capture,images,relativeSolidAssets} = require('./prefab-source-edit.js');
const read = file => JSON.parse(fs.readFileSync(file,'utf8'));
const name = value => typeof value === 'string' && value.trim();

function command(file,input,rest,opt,kit,openEditor) {
  const {out,preview,view} = opt;
  if (rest.length || ![file,input,...Object.values(opt)].every(name) ||
      Object.keys(opt).some(key => !['out','preview','view'].includes(key)) ||
      out && !/\.json$/i.test(out) || view && !preview)
    throw new TypeError('Use mesh-topology variant-prefab <scene.json> <request.json> [--preview directory] [--view settings.json] [--out scene.json]');
  const source = path.resolve(file), output = out && path.resolve(out), editor = openEditor(source);
  const library = editor.snapshot().prefabLibrary;
  const inputs = [source,path.resolve(input),view && path.resolve(view),
    library && path.resolve(path.dirname(source),library)].filter(Boolean);
  const outputs = [output,...(preview ? images.map(file => path.resolve(preview,file)) : [])].filter(Boolean);
  if (new Set(outputs).size !== outputs.length || outputs.some(file => inputs.includes(file)) ||
      output && path.dirname(output) !== path.dirname(source))
    throw new RangeError('Write the result beside the source scene and use separate preview paths');
  const request = read(input);
  const settings = preview && viewSettings(view ? read(view) : {},false);
  const result = settings && editor.previewPrefabVariant(request,{time:settings.t});
  const report = result ? result.report : editor.planPrefabVariant(request);
  const evidence = result && capture(result,settings,path.resolve(preview),kit);
  if (output && report.canCommit) {
    editor.applyPrefabVariant(request);
    const scene = structuredClone(editor.snapshot());
    const solids = report.mode === 'fork' ? Object.values(scene.prefabs[report.variant].solids) :
      scene.solids.filter(solid => report.solids.includes(solid.id));
    relativeSolidAssets(solids,path.dirname(output),kit);
    publishJson(output,scene,'A different prefab variant already exists at '+output);
  } else if (output) process.exitCode = 1;
  process.stdout.write(JSON.stringify({...report,...(evidence && {preview:evidence})},null,2)+'\n');
}

module.exports = {command};
