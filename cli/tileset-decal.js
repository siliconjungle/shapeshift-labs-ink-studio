'use strict';

const fs = require('node:fs'), path = require('node:path');
const files = require('./asset-files.js'), PNG = require('./png.js'), R = require('./render.js');
const {viewSettings} = require('./mesh-native-view.js');
const {canonicalDigest,isRevision} = require('./pixel-edit-revisions.js');

const artifacts=['before.png','after.png','depth-conflicts.png'];
const legend={visible:'#4eb193',occluded:'#ed8357',nearCoplanar:'#efcd72',mismatch:'#ed70a6',unsupported:'#7f9bf1'};
const rgb=Object.fromEntries(Object.entries(legend).map(([id,color])=>[id,[1,3,5].map(i=>parseInt(color.slice(i,i+2),16))]));
const name=value=>typeof value==='string' && !!value.trim();
const fields=(row,keys)=>row && Object.getPrototypeOf(row)===Object.prototype && Object.keys(row).every(key=>keys.includes(key));
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));

function pngImage(file) {
  const bytes=fs.readFileSync(file), {w,h}=PNG.layout(bytes);
  if (w>256 || h>256) throw new RangeError('A retained decal image must fit within 256 × 256 texels');
  const {data,max}=PNG.raster(bytes);
  return {width:w,height:h,pixels:Array.from(data,value=>Math.round(value*255/max))};
}

function preview(beforeEditor,afterEditor,decal,settings,directory,kit) {
  if (!fields(settings,['w','h','t','camera','raw','depthTolerance']))
    throw new TypeError('Choose a native-grid decal view with optional camera, time, and depth tolerance');
  const {depthTolerance=.001,...input}=settings, view=viewSettings(input,false);
  if (!Number.isFinite(depthTolerance) || depthTolerance<0 || depthTolerance>1)
    throw new RangeError('Decal depth tolerance must be between zero and one scene unit');
  const {w,h,t,camera,raw}=view;
  let probe;
  function capture(editor,id) {
    const world=editor.build();
    require('./diarama-pose.js').pose(world,t,{kit,maxSteps:7200});
    const frame=R.render(world,{w,h,t,camera,raw,px:1,passes:['depth','objectId','materialId','sourceSurface'],
      composite:false,renderGraph:false,renderGrid:false,inspection:false,shutter:false,cameraGuides:false,
      ...(id && {decalDepthProbe:{id,capture:value=>{probe=value;}}})});
    if (frame.w!==w || frame.h!==h || frame.passes?.depth?.length!==w*h)
      throw new RangeError('Decal review needs a matching native color and depth capture');
    return frame;
  }

  const before=capture(beforeEditor), after=capture(afterEditor,decal.id);
  if (probe?.w!==w || probe.h!==h) throw new RangeError('Decal review could not measure the projected footprint');
  const target=decal.anchor, asset='surface-decal:'+JSON.stringify([target.object,target.part,decal.id]);
  const overlay=Uint8Array.from(after.rgb,value=>Math.round(value*.35));
  const counts={projected:0,visible:0,occluded:0,nearCoplanar:0,mismatch:0,unsupported:0};
  const blockers=new Map(), depthRange={min:Infinity,max:-Infinity};
  function owner(passes,i) {
    const hit=passes.surfaceSources[passes.sourceSurface[i]];
    const face=hit?.faces?.[passes.sourceTriangle[i]];
    return {asset:hit?.asset,object:hit?.object ?? passes.objects[passes.objectId[i]],part:hit?.part,
      face,material:passes.materials[passes.materialId[i]]};
  }
  for (let p=0;p<w*h;p++) {
    const d=probe.depth[p];
    if (!Number.isFinite(d)) continue;
    counts.projected++;
    const base=owner(before.passes,p), next=owner(after.passes,p);
    const visible=next.asset===asset, delta=d-before.passes.depth[p], contact=Math.abs(delta)<=depthTolerance;
    if (Number.isFinite(delta)) {
      depthRange.min=Math.min(depthRange.min,delta);
      depthRange.max=Math.max(depthRange.max,delta);
    }
    if (visible) counts.visible++;
    if (contact) counts.nearCoplanar++;
    const occluded=!visible && delta>depthTolerance;
    const mismatch=!visible && !occluded && !contact;
    const unsupported=visible && !Number.isFinite(before.passes.depth[p]);
    if (occluded) counts.occluded++;
    if (mismatch) counts.mismatch++;
    if (unsupported) counts.unsupported++;
    const status=contact?'nearCoplanar':occluded?'occluded':mismatch?'mismatch':unsupported?'unsupported':'visible';
    overlay.set(rgb[status],p*3);
    if (!visible || contact) {
      const label=JSON.stringify([base.object,base.part,base.face,base.material]);
      const row=blockers.get(label) ?? {object:base.object ?? null,part:base.part ?? null,face:base.face ?? null,
        material:base.material ?? null,occluded:0,nearCoplanar:0,mismatch:0};
      if (occluded) row.occluded++;
      if (contact) row.nearCoplanar++;
      if (mismatch) row.mismatch++;
      blockers.set(label,row);
    }
  }
  for (const [i,pixels] of [before.rgb,after.rgb,overlay].entries())
    files.write(path.resolve(directory,artifacts[i]),PNG.encode(w,h,pixels,3));
  return {grid:[w,h],time:t,tolerance:depthTolerance,
    depthDelta:Number.isFinite(depthRange.min) ? depthRange : null,projection:probe.projection ?? null,
    counts,blockers:[...blockers.values()],legend,files:artifacts};
}

function command([file,...rest],options,kit,openEditor,sceneOutput) {
  const {scene,out,expect,view,preview:directory,image}=options;
  if (rest.length || ![file,scene,...Object.values(options)].every(name) ||
      !fields(options,['scene','out','expect','view','preview','image']) || view && !directory)
    throw new TypeError('Use tileset decal <decal.json> --scene <scene.json> with optional image, preview and output');
  const input=path.resolve(scene), output=out && sceneOutput(input,out,file);
  const inputs=[input,file,image,view,expect].filter(Boolean).map(name=>path.resolve(name));
  const artifactsPaths=directory ? artifacts.map(name=>path.resolve(directory,name)) : [];
  if (output && inputs.includes(output) || artifactsPaths.some(path=>inputs.includes(path) || path===output))
    throw new RangeError('Write the scene, receipts and preview images to separate paths');
  const decal=read(file);
  if (!name(decal?.anchor?.face)) throw new TypeError('A tileset decal needs an anchor naming an editable mesh face');
  if (image) {
    if (decal.image!==undefined) throw new TypeError('Supply the decal image inline or with --image');
    decal.image=pngImage(image);
  }
  const editor=openEditor(input), plan=editor.planSurfaceDecal(decal);
  const previewRevision=canonicalDigest([editor.snapshot(),editor.sourceDependencies?.(),decal]);
  if (expect) {
    const reviewed=read(expect);
    if (reviewed?.format!==plan.format || reviewed.version!==1 || !reviewed.canCommit || !isRevision(reviewed.previewRevision))
      throw new TypeError('Expected a successful decal placement receipt');
    if (reviewed.previewRevision!==previewRevision) throw new RangeError('Decal placement preview is stale');
  }
  let native;
  if (plan.canCommit && (directory || output)) {
    const draft=editor.fork();
    draft.addSurfaceDecal(decal);
    if (directory) native=preview(editor,draft,decal,view ? read(view) : {},directory,kit);
    if (output) files.publishJson(output,draft.snapshot(),'A different scene already exists at '+output);
  } else if (output) process.exitCode=1;
  process.stdout.write(JSON.stringify({...plan,previewRevision,...(native && {native})},null,2)+'\n');
}

module.exports = {command,preview};
