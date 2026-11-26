'use strict';

const fs = require('node:fs'), path = require('node:path');
const files = require('./asset-files.js'), PNG = require('./png.js'), R = require('./render.js');
const Selection = require('../src/tileset-selection.js');
const {capture} = require('./mesh-uv-editor.js');
const integer = (n,lo,hi)=>Number.isSafeInteger(n) && n>=lo && n<=hi;
const fields = (row,keys)=>row && Object.getPrototypeOf(row)===Object.prototype && Object.keys(row).every(key=>keys.includes(key));
const name = value=>typeof value==='string' && !!value.trim();
const variants = ['baseline','inset','gutter'];

function tileset(scene,id,K) {
  return K.authoring.tilesets.prepare(scene.tilesets,scene.tilesetDefaults).resolve({tileset:id});
}

function reference(editor, object, face, material, image, crop, K) {
  const scene = editor.snapshot(), row = scene.topologyMeshes[object], {width,height,pixels} = image;
  const result = new Uint8Array(pixels.length);
  for (let y=0;y<height;y++) for (let x=0;x<width;x++) {
    const u = Math.max(crop.x,Math.min(x,crop.x+crop.width-1)), v = Math.max(crop.y,Math.min(y,crop.y+crop.height-1));
    const sample = (v*width+u)*4;
    result.set(pixels.subarray(sample,sample+4),(y*width+x)*4);
  }
  let id = 'bleed-reference', slot = material.id+'/bleed-reference';
  while (Object.hasOwn(scene.tilesets,id)) id += '-ref';
  while (row.materials.some(item=>item.id===slot) || row.document.faces.some(item=>item.material===slot)) slot += '/ref';
  const atlas = {version:1,width,height,encoding:'rgba8',data:K.authoring.tilesets.encodeRaster(result)};
  return editor.fork({...scene,tilesets:{...scene.tilesets,[id]:atlas},topologyMeshes:{...scene.topologyMeshes,[object]:{
    ...row,document:K.meshTopology.edit(row.document,{faces:[{...face,material:slot}]}),
    materials:[...row.materials,{...material,id:slot,texture:{tileset:id}}]
  }}});
}

function render(editor, object, face, view, kit) {
  const {document} = editor.meshTopology(object);
  const {frame,mesh} = capture(document,view,kit,editor,object,{basePaint:true});
  const map = kit.KIT.meshTopology.uv.modelFaces(mesh,frame);
  if (!frame.basePaint) throw new RangeError('Bleed review needs native base-paint samples');
  return {frame,mask:Uint8Array.from(map.faceAt,i=>map.faces[i]===face)};
}

function compare(actual, expected, tolerance) {
  const {frame,mask} = actual, rgb = frame.rgb.slice(), paint = frame.basePaint, truth = expected.frame.basePaint;
  let referencePixels = 0, visiblePixels = 0, colorBleedPixels = 0, lostPixels = 0, extraPixels = 0, peakDelta = 0;
  for (let i=0;i<mask.length;i++) {
    const want = expected.mask[i] && truth.alpha[i], got = mask[i] && paint.alpha[i], at = i*3;
    if (want) referencePixels++;
    if (got) visiblePixels++;
    if (want && got) {
      const delta = Math.max(...[0,1,2].map(k=>Math.abs(paint.rgb[at+k]-truth.rgb[at+k])));
      peakDelta = Math.max(peakDelta,delta);
      if (delta<=tolerance) continue;
      colorBleedPixels++;
      rgb.set([244,105,166],at);
    } else if (want) {
      lostPixels++;
      rgb.set([250,191,110],at);
    } else if (got) {
      extraPixels++;
      rgb.set([151,174,247],at);
    }
  }
  return {image:{w:frame.w,h:frame.h,rgb},report:{referencePixels,visiblePixels,colorBleedPixels,lostPixels,extraPixels,peakDelta,
    affectedPixels:colorBleedPixels+lostPixels+extraPixels}};
}

function review(editor, input, kit) {
  const {object,face,rect,inset,padding,writable,w=160,h=100,views,tolerance=1} = input ?? {};
  if (!fields(input,['object','face','rect','inset','padding','writable','w','h','views','tolerance']) ||
      !name(object) || !name(face) || !Array.isArray(rect) || rect.length!==4 || !rect.every(Number.isSafeInteger) ||
      !fields(inset,['left','right','top','bottom']) || !Object.values(inset).some(n=>n>0) ||
      !integer(padding,1,32) || !integer(w,24,512) || !integer(h,24,512) || !integer(tolerance,0,255) ||
      !Array.isArray(views) || !integer(views.length,2,24) || w*h*views.length>1000000 ||
      Array.from(views).some(row=>!fields(row,['t','camera','cameraShot','cameraTime','lockCamera']) ||
        row.t!==undefined && (!Number.isFinite(row.t) || row.t<0) || row.camera!==undefined && !fields(row.camera,
          ['target','dist','yaw','pitch','projection','ortho','fov','focalLength','sensorHeight','focusDistance','composition']) ||
        row.cameraShot!==undefined && !name(row.cameraShot) ||
        row.cameraTime!==undefined && (!Number.isFinite(row.cameraTime) || row.cameraTime<0) ||
        row.lockCamera!==undefined && typeof row.lockCamera!=='boolean'))
    throw new TypeError('Review one tile face with a crop, inset settings, gutter padding and 2–24 bounded camera samples');
  const {KIT:K} = kit, scene = editor.snapshot(), row = editor.meshTopology(object);
  const sourceFace = row.document.faces.find(item=>item.id===face), material = row.materials?.find(item=>item.id===sourceFace?.material);
  if (!material?.texture?.tileset || row.bakes?.some(bake=>bake.material===material.id && !bake.invalidated))
    throw new RangeError('Bleed review needs a retained face sampling an authored tileset. Review registered bake gutters on the baked atlas.');
  const id = material.texture.tileset, original = tileset(scene,id,K);
  if (original.width*original.height>1048576) throw new RangeError('Bleed reference needs an atlas of up to one million texels');
  const [x,y,width,height] = rect, crop = Selection.pick(id,original,{x,y,width,height});
  const mapping = Selection.uvMapping(original,crop,inset), insetScene = editor.fork();
  const insetEdit = insetScene.editMeshUV(object,{uvSet:'pigment',operations:[{op:'remap-face',id:face,
    source:mapping.sourceUVBounds,destination:mapping.uvBounds}]}).uv;
  const gutterScene = editor.fork(), gutterEdit = gutterScene.editTilesetGutters({tileset:id,padding,writable,
    regions:[{id:face,rect}]});
  const padded = tileset(gutterScene.snapshot(),id,K);
  const subjects = [editor,insetScene,gutterScene];
  const references = subjects.map(subject=>{
    const polygon = subject.meshTopology(object).document.faces.find(item=>item.id===face);
    return reference(subject,object,polygon,material,original,crop,K);
  });
  const pictures = [], overlays = [], frames = [], summary = Object.fromEntries(variants.map(id=>[id,
    {referencePixels:0,visiblePixels:0,colorBleedPixels:0,lostPixels:0,extraPixels:0,affectedPixels:0,peakDelta:0}]));
  for (const [index,sample] of views.entries()) {
    const view = {w,h,t:0,raw:true,...sample};
    const expected = references.map(scene=>render(scene,object,face,view,kit));
    const measured = {};
    for (const [lane,subject] of subjects.entries()) {
      const actual = render(subject,object,face,view,kit);
      const {image,report} = compare(actual,expected[lane],tolerance), id = variants[lane];
      pictures.push(actual.frame);
      overlays.push(image);
      measured[id] = {...report,status:report.referencePixels || report.visiblePixels ? 'measured' : 'unseen'};
      for (const key of Object.keys(report))
        summary[id][key] = key==='peakDelta' ? Math.max(summary[id][key],report[key]) : summary[id][key]+report[key];
    }
    frames.push({index,t:view.t,...sample,variants:measured});
  }
  for (const row of Object.values(summary)) row.status = row.referencePixels || row.visiblePixels ? 'measured' : 'unseen';
  const labels = frames.flatMap(({index})=>variants.map(id=>id.toUpperCase()+' / '+(index+1)));
  const comparison = R.grid(pictures,variants.length,labels), diagnostic = R.grid(overlays,variants.length,labels);
  return {original,padded,comparison,diagnostic,report:{format:'ink-studio/tileset-bleed-review',version:1,object,face,tileset:id,
    crop:rect,grid:[w,h],tolerance,inset:{bounds:mapping.texelBounds,uvEdits:insetEdit.corners.length,paintWrites:0},
    gutter:gutterEdit,reference:'crop-edge extension on the tested face with its matched UVs',
    diagnostic:{pink:'base-paint mismatch',amber:'lost target coverage',blue:'extra target coverage'},
    frames,summary}};
}

function command([file,...rest], opt, kit, openEditor) {
  if (rest.length || !file || !fields(opt,['scene','out']) || ![opt.scene,opt.out].every(name))
    throw new TypeError('Use tileset bleed-review <request.json> --scene <scene.json> --out directory');
  const names = ['atlas-original.png','atlas-gutter.png','comparison.png','bleed.png','report.json'];
  if (names.some(name=>[file,opt.scene].some(input=>path.resolve(input)===path.resolve(opt.out,name))))
    throw new RangeError('Write bleed review outputs separately from the scene and request');
  const input = JSON.parse(fs.readFileSync(path.resolve(file),'utf8'));
  const {original,padded,comparison,diagnostic,report} = review(openEditor(opt.scene),input,kit);
  const raster = [original,padded].map(({width,height,pixels})=>PNG.encode(width,height,pixels,4))
    .concat([comparison,diagnostic].map(({w,h,rgb})=>PNG.encode(w,h,rgb)));
  raster.forEach((bytes,i)=>files.write(path.resolve(opt.out,names[i]),bytes));
  const output = {...report,files:names};
  files.json(path.resolve(opt.out,names.at(-1)),output);
  process.stdout.write(JSON.stringify(output,null,2)+'\n');
}

module.exports = {command,review};
