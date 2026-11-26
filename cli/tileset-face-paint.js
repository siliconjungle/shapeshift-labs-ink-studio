'use strict';

const fs = require('node:fs'), path = require('node:path');
const files = require('./asset-files.js'), PNG = require('./png.js'), R = require('./render.js');
const {viewSettings} = require('./mesh-native-view.js');
const {digest,isRevision} = require('./pixel-edit-revisions.js');
const {planPixels} = require('./tileset-paint.js');

const format = 'ink-studio/tileset-face-paint';
const read = file=>JSON.parse(fs.readFileSync(file,'utf8'));
const name = value=>typeof value==='string' && !!value.trim();
const fields = (value,keys)=>value && Object.getPrototypeOf(value)===Object.prototype &&
  Object.keys(value).every(key=>keys.includes(key));
const viewKeys = ['w','h','t','raw','camera','cameraShot','cameraTime','lockCamera'];
const key = (object,face)=>JSON.stringify([object,face]);

function settings(request) {
  const {at,rgba,object,face,view={}} = request ?? {};
  if (!fields(request,['at','rgba','object','face','view']) || !fields(view,viewKeys) ||
      object!==undefined && !name(object) || face!==undefined && !name(face) ||
      !Array.isArray(rgba) || rgba.length!==4 || !Array.from(rgba).every(n=>Number.isInteger(n) && n>=0 && n<=255) ||
      view.cameraShot!==undefined && !name(view.cameraShot) ||
      view.cameraTime!==undefined && (!Number.isFinite(view.cameraTime) || view.cameraTime<0) ||
      view.lockCamera!==undefined && typeof view.lockCamera!=='boolean')
    throw new TypeError('Face paint needs a native pixel coordinate, four RGBA bytes, and optional target and view');
  const {materials,...base} = viewSettings(view,false);
  const {w,h} = base;
  if (!Array.isArray(at) || at.length!==2 || !Array.from(at).every((n,i)=>Number.isSafeInteger(n) && n>=0 && n<[w,h][i]))
    throw new RangeError('Face paint coordinates must be inside the native art grid');
  return {...base,cameraShot:view.cameraShot,cameraTime:view.cameraTime,lockCamera:view.lockCamera};
}

function capture(editor, view, at, kit) {
  const world = editor.build();
  if (view.cameraShot!==undefined && !world.cameraRig) throw new RangeError('Choose a shot from an authored camera rig');
  require('./diarama-pose.js').pose(world,view.t,{kit,maxSteps:7200});
  const frame = R.render(world,{...view,px:1,passes:['sourceSurface'],inspectFragmentPixel:at,
    composite:false,renderGraph:false,renderGrid:false,inspection:false,shutter:false,cameraGuides:false});
  if (frame.w!==view.w || frame.h!==view.h || !frame.passes?.sourceSurface || at && !frame.pixelFragments)
    throw new RangeError('Face paint needs a matching native raster and scene source passes');
  return {world,frame};
}

function usesOf(world, tileset, at, K) {
  const result = new Map(), {touches} = K.authoring.tilesetAtlasSelection;
  for (const [object,row] of Object.entries(world.topologyMeshes ?? {})) {
    if (!row.tilesetMaterials) continue;
    const layer = K.sceneMeshes.layer(row.mesh);
    for (const chart of layer.surfaceCharts) {
      const {first,end,materialId:material,partId:part,region} = chart;
      if (row.tilesetMaterials.get(material)!==tileset) continue;
      const origin = [region.x+at[0],region.y+at[1]];
      const hi = origin.map(n=>n+1);
      const filtered = layer.semanticMipmaps?.some(range=>range.first===first && range.chain.levels.length>1) ||
        layer.paletteSampling?.some(range=>range.first===first) ||
        layer[Symbol.for('ink-studio.spriteSurface.uvSlip')]?.ranges.some(range=>range.first<end && range.end>first);
      for (let corner=first;corner<end;corner+=3) {
        const face = layer.featureFaces[corner/3], id = key(object,face), offset = corner*5;
        if (result.get(id)?.sampling==='texel-footprint') continue;
        const uv = [3,8,13].map(i=>[layer.vertices[offset+i],layer.vertices[offset+i+1]]);
        const direct = hi.every((limit,axis)=>uv.some(point=>point[axis]<limit)) && touches(uv,origin,hi);
        if (direct || filtered) result.set(id,{object,...(part!==undefined && {part}),face,material,
          sampling:direct ? 'texel-footprint' : 'filter-or-uv-motion',visiblePixels:0,changedPixels:0});
      }
    }
  }
  return result;
}

function compare(before, after, uses) {
  const {w,h} = before, diff = new Uint8Array(before.rgb.length);
  const lookup = frame=>{
    const {sourceSurface,sourceTriangle,surfaceSources} = frame.passes;
    const faces = surfaceSources.map(source=>source?.faces && Object.fromEntries(
      Object.entries(source.faces).map(([triangle,face])=>[triangle,uses.get(key(source.object,face))])));
    return i=>faces[sourceSurface[i]]?.[sourceTriangle[i]];
  };
  const oldOwner = lookup(before), newOwner = before===after ? oldOwner : lookup(after);
  let changedPixels = 0;
  for (let i=0;i<w*h;i++) {
    const oldUse = oldOwner(i), nextUse = newOwner(i), p = i*3;
    if (oldUse) oldUse.visiblePixels++;
    if (before.rgb[p]===after.rgb[p] && before.rgb[p+1]===after.rgb[p+1] && before.rgb[p+2]===after.rgb[p+2]) continue;
    changedPixels++;
    if (oldUse) oldUse.changedPixels++;
    if (nextUse && nextUse!==oldUse) nextUse.changedPixels++;
    diff.set([250,195,89],p);
  }
  return {changedPixels,diff:{w,h,rgb:diff}};
}

function paint(editor, request, {apply=false,expect} = {}, kit = require('..').load()) {
  if (typeof apply!=='boolean' || expect!==undefined && !isRevision(expect))
    throw new TypeError('Face paint options need an apply flag and optional preview revision');
  const view = settings(request), {at,rgba,object,face} = request, scene = editor.snapshot();
  const dependencies = editor.sourceDependencies?.();
  if (editor.sourceDependencies && dependencies===undefined) throw new RangeError('Cannot verify face paint scene dependencies');
  const previewRevision = digest([scene,dependencies,at,rgba,object,face,view]);
  const head = {format,version:1,scene:scene.id,at,view,previewRevision};
  const blocked = (code,detail={})=>({report:{...head,...detail,canCommit:false,conflicts:[{code}]}});
  if (expect!==undefined && expect!==previewRevision) return blocked('stale-preview');
  const before = capture(editor,view,at,kit), {hits,truncated} = before.frame.pixelFragments, front = hits[0];
  if (truncated) return blocked('truncated-hit');
  if (!front) return blocked('no-visible-hit');
  const {paint:sample} = front;
  if (object!==undefined && object!==front.object || face!==undefined && face!==sample?.face)
    return blocked('target-not-visible',{front});
  const tileset = before.world.topologyMeshes?.[front.object]?.tilesetMaterials?.get(front.material);
  if (!sample || !tileset) return blocked('no-registered-tileset-hit',{front});
  if (sample.mode!=='texel') return blocked('filtered-hit',{front,tileset});
  const source = {tileset,at:sample.at,uv:sample.uv,object:front.object,part:front.part,face:sample.face,material:front.material};
  const K = kit.KIT, asset = K.authoring.tilesets.prepare(scene.tilesets,scene.tilesetDefaults).source(tileset);
  const value = rgba.reduce((packed,byte)=>packed*256+byte,0), rect = [...source.at,1,1];
  const planned = planPixels(editor,tileset,asset,rect,[{value,slot:value===0 ? null : undefined}]);
  if (!planned.detail) return blocked('indexed-palette-full',{source});
  const detail = {...head,source,rgba,...planned.detail};
  if (!detail.canCommit) return {report:detail};
  let after = before;
  if (planned.edit) {
    const candidate = editor.fork();
    candidate.editTilesetRevision(planned.request);
    after = capture(candidate,view,undefined,kit);
  }
  const uses = usesOf(before.world,tileset,source.at,K);
  // The observed hit is authoritative even if an authored projection moved its UV footprint.
  uses.set(key(source.object,source.face),{object:source.object,...(source.part!==null && {part:source.part}),
    face:source.face,material:source.material,sampling:'picked-texel',visiblePixels:0,changedPixels:0});
  const {changedPixels,diff} = compare(before.frame,after.frame,uses);
  const refs = planned.edit?.before[0] ?? editor.tilesetDependencies(tileset).sheets[0];
  if (apply && planned.edit) editor.editTilesetRevision(planned.request);
  return {report:{...detail,uses:[...uses.values()],prefabDependencies:refs.prefabs,changedPixels},
    images:{before:before.frame,after:after.frame,diff}};
}

function command([file,...rest], options, kit, openEditor, sceneOutput) {
  const {scene,out,preview,expect} = options;
  if (rest.length || ![file,scene].every(name) || !fields(options,['scene','out','preview','expect']) ||
      !Object.values(options).every(name))
    throw new TypeError('Use tileset paint face <request.json> --scene <scene.json> [--preview directory] [--expect receipt.json] [--out revised.json]');
  const output = out && sceneOutput(path.resolve(scene),out,file);
  const inputs = [scene,file,expect,output].filter(Boolean).map(name=>path.resolve(name));
  const artifacts = ['before','after','diff'].map(name=>[name,preview && path.resolve(preview,name+'.png')]);
  if (output && expect && output===path.resolve(expect) || preview && artifacts.some(([,file])=>inputs.includes(file)))
    throw new RangeError('Write face paint output separately from its inputs');
  const prior = expect && read(expect);
  if (expect && (prior?.format!==format || prior.version!==1 || prior.canCommit!==true || !isRevision(prior.previewRevision)))
    throw new TypeError('Expect a successful face paint preview receipt');
  const editor = openEditor(scene);
  const {report,images} = paint(editor,read(file),{apply:!!output,expect:prior?.previewRevision},kit);
  if (preview && images) for (const [name,file] of artifacts) {
    const {w,h,rgb} = images[name];
    files.write(file,PNG.encode(w,h,rgb));
  }
  if (output && report.canCommit) files.publishJson(output,editor.snapshot(),'A different scene already exists at '+output);
  if (output && !report.canCommit) process.exitCode = 1;
  process.stdout.write(JSON.stringify({...report,...(preview && images && {files:artifacts.map(([name])=>name+'.png')})},null,2)+'\n');
}

module.exports = {paint,command};
