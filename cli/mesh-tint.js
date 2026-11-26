'use strict';

const fs = require('node:fs'), path = require('node:path');
const files = require('./asset-files.js'), PNG = require('./png.js');
const {digest,isRevision} = require('./pixel-edit-revisions.js');
const {viewSettings,worldFor,render} = require('./mesh-native-view.js');

const read = file=>JSON.parse(fs.readFileSync(path.resolve(file),'utf8'));
const name = value=>typeof value==='string' && !!value.trim();
const object = value=>value && Object.getPrototypeOf(value)===Object.prototype;
const fields = (value,keys)=>object(value) && Object.keys(value).every(key=>keys.includes(key));
const artifacts = ['before.png','after.png','diff.png'];
const print = report=>process.stdout.write(JSON.stringify(report,null,2)+'\n');

function preview(before,after,view,toolkit,editor,object,part,request,directory) {
  const cage = source=>worldFor(source,view,toolkit,before);
  let left, right;
  if (editor) {
    left = editor.build();
    if (before===after) right=left;
    else {
      const draft = editor.fork();
      draft.editMeshTint(object,request,{part});
      right=draft.build();
    }
  } else {
    left=cage(before);
    right=before===after ? left : cage(after);
  }
  const a=render(left,view,toolkit,[]), b=right===left ? a : render(right,view,toolkit,[]);
  const {w,h} = a, diff = new Uint8Array(a.rgb.length);
  let changedPixels = 0;
  for (let i=0;i<diff.length;i+=3) {
    if (a.rgb[i]===b.rgb[i] && a.rgb[i+1]===b.rgb[i+1] && a.rgb[i+2]===b.rgb[i+2]) continue;
    diff.set([250,195,89],i);
    changedPixels++;
  }
  for (const [i,rgb] of [a.rgb,b.rgb,diff].entries()) files.write(path.resolve(directory,artifacts[i]),PNG.encode(w,h,rgb));
  return {grid:[w,h],changedPixels,files:artifacts};
}

function command(file,input,rest,opt,toolkit,openEditor) {
  const {object:mesh,part,out,preview:directory,view,selection,expect} = opt;
  if (rest.length || ![file,input].every(name) || !fields(opt,['object','part','out','preview','view','selection','expect']) ||
      !Object.values(opt).every(name) || part!==undefined && mesh===undefined || view!==undefined && directory===undefined)
    throw new TypeError('Use mesh-topology tint <mesh-or-scene.json> <request.json> with optional object, part, selection, view, preview, receipt and output');
  const output = out && path.resolve(out), sourcePath = path.resolve(file);
  if (mesh && output && (!/\.json$/i.test(output) || path.dirname(output)!==path.dirname(sourcePath)))
    throw new RangeError('Write a new scene JSON beside its source to preserve relative assets');
  const inputs = [file,input,view,selection,expect].filter(Boolean).map(value=>path.resolve(value));
  const outputs = [...(output ? [output] : []),...(directory ? artifacts.map(name=>path.resolve(directory,name)) : [])];
  if (new Set(outputs).size!==outputs.length || outputs.some(file=>inputs.includes(file)))
    throw new RangeError('Write tint captures and revised documents separately from inputs');
  const source = read(file), editor = mesh && openEditor(file);
  if (source?.topologyMeshes && !editor) throw new TypeError('Choose an editable scene mesh with --object');
  const {meshTopology:T} = toolkit.KIT;
  const base = editor ? editor.meshTopology(mesh,part).document : source;
  let request = read(input);
  if (selection) {
    if (!object(request) || Object.hasOwn(request,'selection')) throw new TypeError('Use an inline selection or --selection');
    request = {...request,selection:read(selection)};
  }
  if (request?.tool==='eyedropper' && (out || expect || directory))
    throw new TypeError('Read eyedropper samples from stdout');
  const dependencies = editor && editor.sourceDependencies?.();
  if (editor?.sourceDependencies && dependencies===undefined) throw new RangeError('Cannot verify tint scene dependencies');
  const previewRevision = digest([editor ? editor.snapshot() : source,dependencies,mesh,part,request]);
  const prior = expect && read(expect);
  if (expect && (prior?.format!=='ink-studio/mesh-tint-edit' || prior.version!==1 || prior.canCommit!==true || !isRevision(prior.previewRevision)))
    throw new TypeError('Expect a successful mesh tint preview receipt');
  if (prior && prior.previewRevision!==previewRevision) {
    if (out) process.exitCode=1;
    return print({format:prior.format,version:1,previewRevision,canCommit:false,conflicts:[{code:'stale-preview'}]});
  }
  const plan = editor ? editor.planMeshTint(mesh,request,{part}) : T.planTint(base,request);
  const sampling = plan.report.tool==='eyedropper';
  const report = {...plan.report,previewRevision,canCommit:!sampling};
  if (directory) {
    const settings = view ? read(view) : {};
    if (!fields(settings,['w','h','t','camera','raw','materials']))
      throw new TypeError('Use a native-grid mesh tint view with optional size, time, camera, and materials');
    const before=T.create(base), nativeView=viewSettings({raw:!editor,...settings},!editor);
    report.native=preview(before,plan.document,nativeView,toolkit,editor,mesh,part,request,directory);
  }
  if (output) {
    if (editor) editor.editMeshTint(mesh,request,{part});
    files.publishJson(output,editor ? editor.snapshot() : plan.document,'A different mesh or scene exists at '+output);
  }
  return print(report);
}

module.exports = {command};
