'use strict';

const fs = require('node:fs'), path = require('node:path');
const {publishJson} = require('./asset-files.js');
const {viewSettings} = require('./mesh-native-view.js');
const {capture,images,relativeSolidAssets} = require('./prefab-source-edit.js');
const read = file => JSON.parse(fs.readFileSync(file,'utf8'));
const name = value => typeof value === 'string' && value.trim();

const commands = {
  'custom-properties': ['planCustomProperties','previewCustomProperties','editCustomProperties'],
  'scene-layer': ['planSceneLayers','previewSceneLayers','editSceneLayers'],
  'mirror-prefab': ['planPrefabMirror','previewPrefabMirror','applyPrefabMirror'],
  'reparent-prefab': ['planPrefabReparent','previewPrefabReparent','reparentPrefab'],
  'combine-prefab': ['planPrefabCombination','previewPrefabCombination','combinePrefabs'],
  'array-prefab': ['planPrefabArray','previewPrefabArray','applyPrefabArray'],
  'variant-prefab': ['planPrefabVariant','previewPrefabVariant','applyPrefabVariant'],
  'replace-prefab': ['planPrefabReplacement','previewPrefabReplacement','replacePrefabs']
};

function command(action,file,input,rest,opt,kit,openEditor) {
  const {out,preview,view,selection} = opt, acceptsSelection = ['combine-prefab','replace-prefab','scene-layer'].includes(action);
  const [plan,review,apply] = commands[action];
  if (rest.length || ![file,input,...Object.values(opt)].every(name) ||
      Object.keys(opt).some(key => !['out','preview','view',...(acceptsSelection ? ['selection'] : [])].includes(key)) ||
      out && !/\.json$/i.test(out) || view && !preview)
    throw new TypeError('Use mesh-topology '+action+' <scene.json> <request.json> [--preview directory] [--view settings.json] [--out scene.json]');
  const source = path.resolve(file), output = out && path.resolve(out), editor = openEditor(source);
  const {prefabLibrary:library,customProperties} = editor.snapshot();
  const inputs = [source,path.resolve(input),view && path.resolve(view),selection && path.resolve(selection),
    library && path.resolve(path.dirname(source),library),
    typeof customProperties==='string' && path.resolve(path.dirname(source),customProperties)].filter(Boolean);
  const outputs = [output,...(preview ? images.map(file => path.resolve(preview,file)) : [])].filter(Boolean);
  if (new Set(outputs).size !== outputs.length || outputs.some(file => inputs.includes(file)) ||
      output && path.dirname(output) !== path.dirname(source))
    throw new RangeError('Write the result beside the source scene and use separate preview paths');
  const request = read(input);
  if (selection) {
    if (!request || Object.getPrototypeOf(request) !== Object.prototype || request.instances !== undefined || request.selection !== undefined)
      throw new TypeError('Provide a selection in the request or with --selection');
    request.selection = read(selection);
  }
  const settings = preview && viewSettings(view ? read(view) : {},false);
  const result = settings && editor[review](request,{time:settings.t});
  const report = result ? result.report : editor[plan](request);
  const evidence = result && capture(result,settings,path.resolve(preview),kit);
  if (output && report.canCommit) {
    editor[apply](request);
    const variant = action === 'variant-prefab', combine = action === 'combine-prefab';
    const scene = variant || combine ? structuredClone(editor.snapshot()) : editor.snapshot();
    if (variant) {
      const solids = report.mode === 'fork' ? Object.values(scene.prefabs[report.variant].solids) :
        scene.solids.filter(solid => report.solids.includes(solid.id));
      relativeSolidAssets(solids,path.dirname(output),kit);
    }
    if (combine) relativeSolidAssets(Object.values(scene.prefabs[report.prefab].solids),path.dirname(output),kit);
    publishJson(output,scene,'A different prefab edit already exists at '+output);
  } else if (output) process.exitCode = 1;
  process.stdout.write(JSON.stringify({...report,...(evidence && {preview:evidence})},null,2)+'\n');
}

module.exports = {command};
