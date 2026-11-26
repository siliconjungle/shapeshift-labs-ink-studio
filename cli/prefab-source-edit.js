'use strict';

const fs = require('node:fs'), path = require('node:path');
const {isDeepStrictEqual} = require('node:util');
const files = require('./asset-files.js'), PNG = require('./png.js'), R = require('./render.js');
const {viewSettings} = require('./mesh-native-view.js');
const {transformView,captureTransformCamera} = require('./mesh-transform-camera.js');
const {pose} = require('./diarama-pose.js');

const read = file => JSON.parse(fs.readFileSync(file,'utf8'));
const name = value => typeof value === 'string' && value.trim();
const images = ['before.png','after.png','changes.png'];

function capture({before,after,report},settings,directory,kit) {
  const {w,h,t} = settings;
  const evidence = {grid:[w,h],time:t,files:[],instances:[]};
  function frame(world,file) {
    pose(world,t,{kit,maxSteps:7200});
    const result = R.render(world,{...settings,px:1,passes:['objectId'],composite:false,renderGraph:false,renderGrid:false,
      inspection:false,shutter:false,cameraGuides:false});
    if (result.w !== w || result.h !== h || result.passes?.objectId?.length !== w*h)
      throw new RangeError('Prefab review needs a matching native color and object capture');
    files.write(path.join(directory,file),PNG.encode(w,h,result.rgb));
    evidence.files.push(file);
    return result;
  }
  const source = frame(before,images[0]);
  if (!after) return evidence;
  const draft = frame(after,images[1]), owners = new Map();
  for (const row of report.instances) {
    const counts = {instance:row.instance,beforePixels:0,afterPixels:0,changedPixels:0};
    evidence.instances.push(counts);
    for (const object of row.objects ?? []) owners.set(object,counts);
  }
  const from = source.passes.objects.map(object => owners.get(object));
  const to = draft.passes.objects.map(object => owners.get(object));
  const overlay = new Uint8Array(source.rgb.length);
  for (let i=0; i<w*h; i++) {
    const prior = from[source.passes.objectId[i]], next = to[draft.passes.objectId[i]];
    if (prior) prior.beforePixels++;
    if (next) next.afterPixels++;
    const u = i*3;
    const changed = [0,1,2].some(k => source.rgb[u+k] !== draft.rgb[u+k]);
    if (changed && prior) prior.changedPixels++;
    if (changed && next && next !== prior) next.changedPixels++;
    for (let k=0; k<3; k++) overlay[u+k] = changed && (prior || next) ? [255,191,91][k] : Math.round(draft.rgb[u+k]*.24);
  }
  files.write(path.join(directory,images[2]),PNG.encode(w,h,overlay));
  evidence.files.push(images[2]);
  return evidence;
}

function publish(output,libraryOut,librarySource,result,kit) {
  const entries = [];
  let scene = result.scene;
  if (result.report.source === 'library') {
    if (!libraryOut) throw new TypeError('Use --library-out to publish a revised shared prefab library beside its source');
    const {prefab} = result.report, library = read(librarySource);
    const definition = structuredClone(result.library[prefab]);
    for (const solid of kit.KIT.diorama.solids({solids:Object.values(definition.solids)}))
      if (solid.kind === 'mesh' && typeof solid.asset === 'string' && path.isAbsolute(solid.asset))
        solid.asset = path.relative(path.dirname(libraryOut),solid.asset);
    entries.push([libraryOut,{...library,[prefab]:definition}]);
    scene = {...scene,prefabLibrary:path.relative(path.dirname(output),libraryOut)};
  } else if (libraryOut) throw new TypeError('An inline prefab is saved with its scene');
  entries.push([output,scene]);
  const conflict = file => 'A different prefab review output already exists at '+file;
  for (const [file,entry] of entries)
    if (fs.existsSync(file) && !isDeepStrictEqual(read(file),entry)) throw new RangeError(conflict(file));
  for (const [file,entry] of entries) files.publishJson(file,entry,conflict(file));
}

function command(file,input,rest,opt,kit,openEditor) {
  const {out,preview,view,'library-out':libraryOut} = opt;
  if (rest.length || ![file,input,...Object.values(opt)].every(name) ||
      Object.keys(opt).some(key => !['out','preview','view','library-out'].includes(key)) ||
      [out,libraryOut].some(file => file && !/\.json$/i.test(file)) || libraryOut && !out)
    throw new TypeError('Use mesh-topology edit-prefab <scene.json> <request.json> [--preview directory] [--view settings.json] [--out scene.json [--library-out library.json]]');
  const source = path.resolve(file), editor = openEditor(source);
  const libraryRef = editor.snapshot().prefabLibrary;
  const librarySource = libraryRef && path.resolve(path.dirname(source),libraryRef);
  const output = out && path.resolve(out), libraryOutput = libraryOut && path.resolve(libraryOut);
  const inputs = [source,path.resolve(input),librarySource,view && path.resolve(view)].filter(Boolean);
  const outputs = [output,libraryOutput,...(preview ? images.map(file => path.resolve(preview,file)) : [])].filter(Boolean);
  if (new Set(outputs).size !== outputs.length || outputs.some(file => inputs.includes(file)) ||
      output && path.dirname(output) !== path.dirname(source) ||
      libraryOutput && (!librarySource || path.dirname(libraryOutput) !== path.dirname(librarySource)))
    throw new RangeError('Write separate outputs beside the source scene and library, with a separate preview');
  let request = read(input);
  const cameraEdit = edit => edit?.transform?.space === 'camera' && edit.transform.camera === undefined;
  const needsCamera = Array.isArray(request?.edits) && request.edits.some(cameraEdit);
  if (view && !preview && !needsCamera) throw new TypeError('Use --view for a native preview or camera-space edit');
  const options = view ? read(view) : {};
  const settings = preview && viewSettings(options,false);
  if (needsCamera && view) {
    const camera = captureTransformCamera(editor,transformView(options),kit);
    request = {...request,edits:request.edits.map(edit => cameraEdit(edit) ?
      {...edit,transform:{...edit.transform,camera}} : edit)};
  }
  const result = editor.previewPrefabSourceEdit(request,{render:Boolean(preview),time:settings?.t ?? 0});
  const evidence = preview && capture(result,settings,path.resolve(preview),kit);
  if (output && result.report.canCommit) publish(output,libraryOutput,librarySource,result,kit);
  else if (output) process.exitCode = 1;
  process.stdout.write(JSON.stringify({...result.report,...(evidence && {preview:evidence})},null,2)+'\n');
}

module.exports = {command};
