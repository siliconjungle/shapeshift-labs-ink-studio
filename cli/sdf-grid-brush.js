'use strict';

const ArtPasses = require('../src/art-passes.js');
const ViewSource = require('../src/pixel-view-source.js');
const Bindings = require('../src/pixel-source-bindings.js');
const Canvas = require('../src/pixel-canvas-transforms.js');
const Targets = require('../src/target-selectors.js');
const Camera = require('../src/camera-lens.js');
const { conflict } = require('./pixel-edit-preview.js');
const ShapeOperations = require('./sdf-brush-operations.js');
const SdfPose = require('./sdf-pose.js');
const { pose } = require('./diarama-pose.js');

const fields = (raw, keys) => raw && Object.getPrototypeOf(raw) === Object.prototype &&
  Object.keys(raw).every(key=>keys.includes(key));
const finite = (value, a, b) => Number.isFinite(value) && value>=a && value<=b;
const vector = (value,length,check) => Array.isArray(value) && value.length===length && Array.from(value).every(check);
const depthSamples = 16;
const footprintKeys = ['pixels','selection','camera','minFacing','time'];

function prepare(raw,frame,binding,api) {
  const { maxCells,modes } = api;
  const legacy = ['add','cut'].includes(raw?.mode);
  const controls = ['direction','profile','falloff','radius','surface'];
  const keys = ['mode','depth',...footprintKeys,...(legacy ? [] : controls)];
  if (!fields(raw,keys) || !legacy && !modes.includes(raw.mode) ||
      !finite(raw.depth,.005,20))
    throw new TypeError('A native SDF brush needs a shape mode, depth from .005 to 20, and pixels or a named selection');
  const settings = !legacy && api.settings({ depth:raw.depth,
    ...Object.fromEntries(controls.map(key=>[key,raw[key]])) },raw.mode);
  return { mode:raw.mode,depth:raw.depth,settings,...prepareFootprint(raw,frame,binding,maxCells) };
}

function prepareFootprint(raw,frame,binding,maxCells) {
  if ((raw.pixels===undefined)===(raw.selection===undefined))
    throw new TypeError('Choose explicit pixels or a named selection for the SDF footprint');
  const { minFacing=.2,camera={},time=0 } = raw;
  if (!finite(time,0,120) || !finite(minFacing,.05,1) || !fields(camera,['yaw','pitch','dist','target','ortho','fov']) ||
      ['yaw','pitch','dist','fov'].some(key=>camera[key]!==undefined && !Number.isFinite(camera[key])) ||
      camera.dist!==undefined && !finite(camera.dist,.01,1000) ||
      camera.target!==undefined && !vector(camera.target,3,n=>finite(n,-1e5,1e5)) ||
      camera.ortho!==undefined && typeof camera.ortho!=='boolean')
    throw new TypeError('An SDF brush needs a valid camera, time from 0 to 120, and a facing cosine from .05 to 1');
  const { width,height } = frame, grid = binding.canvas?.size ?? [width,height];
  ViewSource.grid(...grid);
  const pixels = raw.pixels ?? frame.selections?.find(row=>row.id===raw.selection)?.pixels;
  if (!Array.isArray(pixels) || !pixels.length || pixels.length>maxCells ||
      !Array.from(pixels).every(at=>vector(at,2,Number.isSafeInteger) &&
        at[0]>=0 && at[0]<width && at[1]>=0 && at[1]<height) ||
      new Set(pixels.map(at=>at.join(','))).size!==pixels.length)
    throw new RangeError('The brush footprint needs 1–'+maxCells+' distinct document pixels or a named selection on this frame');
  return { minFacing,camera,grid,pixels,time };
}

function captureFootprint(editor,solid,frame,binding,{ minFacing,camera,grid,pixels,time },layer,{ singleOwner=false,accept } = {}) {
  const kit = require('../index.js').load(), { V } = kit.KIT;
  if (solid.kind==='ground' || solid.ghost || solid.carve || solid.hold)
    throw conflict('unsupported-sdf-brush-target','Grid brushes need a finite solid with an editable exterior',
      { binding:binding.id,object:solid.id });
  const world = editor.build(undefined,{ retainRenderSdf:true,retainPartRenderSdf:Boolean(solid.part) });
  pose(world,time,{ kit,maxSteps:7200 });
  const rig = world.anim?.rig, index = solid.part && rig?.names.indexOf(solid.part);
  const carried = index>0 && SdfPose.transform('rig:'+index,null,rig);
  if (solid.part && !carried)
    throw conflict('unsupported-sdf-brush-pose','The source part needs an invertible affine pose',
      { binding:binding.id,object:solid.id,part:solid.part });
  const [w,h] = grid, selected = { object:solid.id,...(solid.part && {part:solid.part}) };
  const { render,cameraCapture } = require('./render.js');
  let projection;
  const image = render(world,{ ...camera,w,h,px:1,t:time,raw:true,transparent:true,
    passes:['opaque-surface','partId','sourceSurface'],
    sdfAssist:{ epsilon:.0005,steps:256,posed:Boolean(world.anim?.rig || world.anim?.bones) },splatOrder:'surface',pixelSelection:selected,
    renderGraph:false,renderGrid:false,cameraGuides:false,inspection:false,shutter:false,composite:false,
    ...cameraCapture(null,(raster,sample)=>{
      if (raster.width!==w || raster.height!==h) return;
      const { eye,right,up,back } = Camera.fromView(raster.view);
      projection = { origin:eye,right:V.mul(right,1/sample.focal),down:V.mul(up,-1/sample.focal),
        forward:V.mul(back,-1),perspective:sample.camera.orthographic===false };
    })
  });
  if (!projection || image.w!==w || image.h!==h || !image.pixelSelection || !image.passes?.surfaceSources)
    throw new Error('Grid sculpt brush could not capture the native surface and camera');
  const { passes } = image, sourceTables = new Map(), skipped = [], used = new Set(), candidates = [];
  const sourceHits = new Map();
  const clipping = frame.layerSources?.get(layer?.id)?.clipping;
  function skip(at,code,details) { skipped.push({ at,code,...details }); }

  for (const at of pixels) {
    const index = at[1]*frame.width+at[0];
    if (frame.locks[index] || clipping && !clipping[index]) {
      skip(at,frame.locks[index] ? 'protected-pixel' : 'clipped-pixel');
      continue;
    }
    if (Bindings.staleAt(binding,at)) { skip(at,'stale-binding-pixel'); continue; }
    const mapped = Canvas.sourcePoint([frame.width,frame.height],at,binding.canvas);
    if (!mapped) { skip(at,'outside-bound-canvas'); continue; }
    const sourceAt = mapped.map(Math.floor), [x,y] = sourceAt, pixel = y*w+x;
    if (used.has(pixel)) { skip(at,'duplicate-bound-pixel',{ sourceAt }); continue; }
    const hit = lookup(x,y);
    if (hit.code) {
      const { code,...details } = hit;
      skip(at,code,{ sourceAt,...details });
      continue;
    }
    const { surface,owner } = hit;
    const toLocal = p=>ownerLocal(owner,carried ? carried.rest(...p) : p);
    if (singleOwner && candidates.length && candidates[0].owner!==owner) {
      skip(at,'incompatible-stroke-frame',{ sourceAt });
      continue;
    }
    const candidate = { at,sourceAt,surface,owner,toLocal };
    const issue = accept?.(candidate,projection);
    if (issue) { skip(at,issue,{ sourceAt }); continue; }
    used.add(pixel);
    candidates.push(candidate);
  }
  return { projection,candidates,skipped,carried,lookup };

  function lookup(x,y) {
    if (x<0 || x>=w || y<0 || y>=h) return { code:'no-surface' };
    const p = y*w+x;
    if (!sourceHits.has(p)) sourceHits.set(p,captureHit(x,y,p));
    return sourceHits.get(p);
  }

  function captureHit(x,y,p) {
    const surface = ArtPasses.pick(passes,x,y);
    if (!surface) return { code:'no-surface' };
    const geometry = Bindings.sample(image,[x,y],ArtPasses,surface)?.geometry;
    if (!Targets.objectScope(selected,geometry ?? surface) || image.pixelSelection.coverage[p]<.9)
      return { code:'occluded-or-outside-target',object:surface.object };
    if (surface.kind!=='sdf' || !vector(geometry?.field,2,Number.isSafeInteger)) return { code:'sdf-address-unavailable' };
    const [sourceIndex,ownerIndex] = geometry.field;
    if (!sourceTables.has(sourceIndex)) sourceTables.set(sourceIndex,Array.from(world.renderSdfs?.[sourceIndex]?.rows.keys() ?? []));
    const owner = sourceTables.get(sourceIndex)[ownerIndex];
    if (!owner?.sd || owner.renderTarget?.entity!==solid.id || solid.part && owner.tag!==solid.part)
      return { code:'sdf-address-unavailable' };
    const viewAxis = V.norm(projection.perspective ? V.sub(projection.origin,surface.position) : V.mul(projection.forward,-1));
    const facing = V.dot(surface.geometricNormal,viewAxis);
    if (!Number.isFinite(facing) || facing<minFacing) return { code:'grazing-or-back-facing',facing };
    return { surface,owner };
  }
}

function localProjection(projection,toLocal,V) {
  const origin = toLocal(projection.origin);
  return { origin,perspective:projection.perspective,
    ...Object.fromEntries(['right','down','forward'].map(key=>
      [key,V.sub(toLocal(V.add(projection.origin,projection[key])),origin)])) };
}

function project(editor,solid,frame,binding,raw,layer) {
  const { V,diorama,procedural:{gridSculptBrush:api,sdfBrushSurfaces} } = require('../index.js').load().KIT;
  const footprint = prepare(raw,frame,binding,api), { mode,depth,grid,settings,time } = footprint;
  if (settings?.surface) sdfBrushSurfaces.check(settings.surface,diorama.sceneMaterials(editor.snapshot()).roles);
  const legacyBounds = new Map();
  const {projection,candidates,skipped,carried,lookup} = captureFootprint(editor,solid,frame,binding,footprint,layer,
    settings ? { singleOwner:true } : { accept(hit,projection) {
      const { surface } = hit, pixelSize = V.len(projection.right)*(projection.perspective ? surface.depth : 1);
      const overlap = Math.min(depth*.5,Math.max(.002,pixelSize*.15));
      const near = surface.depth-(mode==='cut' ? overlap : depth), far = surface.depth+(mode==='cut' ? depth : overlap);
      if (near<1e-4 || far>2000) return 'outside-brush-depth';
      legacyBounds.set(hit,[near,far]);
    } });
  const [first] = candidates;
  if (!first) return reject(binding,skipped,'No brush pixels hit a visible, editable SDF surface');
  if (settings) {
    const attachment = { source:{ object:solid.id,part:solid.part??null },time,projection,frame:affineMatrix(first.toLocal,V),
      marks:candidates.map(hit=>({ at:hit.at,sourceAt:hit.sourceAt,depth:hit.surface.depth,position:hit.surface.position,
        normal:V.norm(hit.surface.geometricNormal),
        ...(mode==='smooth' && {smoothOffsets:ShapeOperations.smoothOffsets(hit,lookup,V)}) })) };
    return fromAttachment({ mode,settings,grid,attachment,owner:posedOwner(first.owner,carried),binding,skipped,api,V });
  }
  const hits = [], cells = [];
  let retainedProjection, volume = 0;
  for (const hit of candidates) {
    const { at,sourceAt,surface,owner,toLocal } = hit, [x,y] = sourceAt, [near,far] = legacyBounds.get(hit);
    retainedProjection ??= localProjection(projection,toLocal,V);
    const { intervals,estimate } = affectedDepth(posedOwner(owner,carried).sd,api,projection,grid,x,y,near,far,mode);
    const geometricPoint = toLocal(surface.position);
    cells.push([x,y,near,far]);
    hits.push({ at,sourceAt,rest:geometricPoint,surfaceDepth:surface.depth,depth:[near,far],changedDepths:intervals });
    volume += estimate;
  }
  if (!hits.length) return reject(binding,skipped,'No brush pixels hit a visible, editable SDF surface');
  const brush = { version:1,grid,projection:retainedProjection,cells };
  const { bounds } = api.prepare(brush);
  return { modifier:{ kind:'grid-brush',mode,brush },report:{ mode,grid,projectedPixels:hits.length,hits,
    skippedHits:skipped,volume:{ space:'solid-rest',bounds,estimatedWorldVolume:volume,depthSamplesPerPixel:depthSamples },
    ...(solid.part && {attachment:{object:solid.id,part:solid.part,time}}) } };
}

function reject(binding,skipped,message) {
  const conflicts = skipped.map(hit=>({ ...hit,binding:binding.id,message }));
  throw Object.assign(new RangeError(message),{ conflicts });
}

function ownerLocal(owner,point) {
  return owner.modifierSpace?.inverse(point) ?? point.slice();
}

function posedOwner(owner,motion) {
  if (!motion) return owner;
  return { bc:motion.point(...owner.bc),br:owner.br*motion.stretch,
    sd:(x,y,z)=>owner.sd(...motion.rest(x,y,z))*motion.distanceScale };
}

function affineMatrix(toLocal,V) {
  const origin = toLocal([0,0,0]);
  const axes = [[1,0,0],[0,1,0],[0,0,1]].map(axis=>V.sub(toLocal(axis),origin));
  return [0,1,2].flatMap(i=>axes.map(axis=>axis[i])).concat(origin);
}

function fromAttachment({ mode,settings,grid,attachment,owner,binding,skipped,api,V }) {
  const { projection,marks } = attachment, frame = SdfPose.affine(attachment.frame), { direction } = settings;
  if (!frame) throw new RangeError('SDF brush attachment needs an invertible frame');
  const candidates = [];
  for (const { at,sourceAt,depth,position,normal,smoothOffsets } of marks) {
    const view = V.norm(projection.perspective ? V.sub(projection.origin,position) : V.mul(projection.forward,-1));
    const outward = direction==='normal' ? normal : direction==='view' ? view : direction;
    if (V.dot(normal,outward)<.05) { skipped.push({ at,sourceAt,code:'invalid-outward-axis' }); continue; }
    candidates.push({ at,sourceAt,surface:{ depth,position,geometricNormal:normal },owner,outward,direction,
      smoothOffsets,toLocal:p=>frame.point(...p) });
  }
  const result = candidates.length && ShapeOperations.plan({ mode,settings,grid,projection,candidates,attachment,skipped,api,V });
  return result || reject(binding,skipped,'No brush pixels can apply the requested shape operation');
}

function update(editor,key,solid,binding,raw) {
  const { V,diorama,procedural:{gridSculptBrush:api,sdfBrushSurfaces} } = require('../index.js').load().KIT;
  const keys = ['id','depth','direction','profile','falloff','radius','surface'];
  if (!fields(raw,keys) || typeof raw.id!=='string' || Object.keys(raw).length<2 ||
      raw.falloff!==undefined && (!fields(raw.falloff,['pixels','curve']) || !Object.keys(raw.falloff).length))
    throw new TypeError('A brush update needs a modifier ID and editable brush settings');
  const modifiers = solid.modifiers ?? [], index = modifiers.findIndex(row=>row.id===raw.id);
  const prior = modifiers[index];
  if (prior?.kind!=='grid-brush') throw new RangeError('Unknown grid brush modifier: '+raw.id);
  const { mode,brush } = prior, { grid,attachment } = brush;
  if (brush.version!==2) throw conflict('missing-brush-attachment','This stroke has no retained parameter anchors',
    { binding:binding.id,modifier:raw.id });
  const { id,surface,...settingsPatch } = raw, old = brush.settings;
  const settings = api.settings({ ...old,...settingsPatch,
    surface:surface===null ? undefined : surface ?? old.surface,falloff:{ ...old.falloff,...raw.falloff } },mode);
  if (settings.surface) sdfBrushSurfaces.check(settings.surface,diorama.sceneMaterials(editor.snapshot()).roles);
  if (Object.keys(settingsPatch).length===0) {
    editor.updateModifier(id,{ brush:{ ...brush,settings } },key);
    return { mode,grid,settings,appearanceOnly:true,projectedPixels:brush.columns.length,
      ...(attachment && {attachment:{ ...attachment.source,time:attachment.time }}) };
  }
  if (!attachment) throw conflict('missing-brush-attachment','This stroke has no retained parameter anchors',
    { binding:binding.id,modifier:raw.id });
  if (attachment.source.object!==solid.id || attachment.source.part!==(solid.part??null))
    throw conflict('brush-source-changed','The stroke is attached to a different source solid or part',
      { binding:binding.id,modifier:raw.id,...attachment.source });

  const fork = editor.fork();
  fork.setModifiers(modifiers.slice(0,index),key);
  const input = fork.build(undefined,{ retainRenderSdf:true,retainPartRenderSdf:Boolean(solid.part) });
  const owners = (input.renderSdfs ?? []).flatMap(source=>[...source.rows.keys()])
    .filter(owner=>owner.renderTarget?.entity===solid.id && (owner.tag??null)===(solid.part??null));
  if (owners.length!==1) throw conflict('brush-source-unavailable','The source before this stroke no longer has one retained SDF',
    { binding:binding.id,modifier:id });
  const [owner] = owners, frame = SdfPose.affine(attachment.frame), space = owner.modifierSpace;
  const scale = space?.scale ?? 1;
  const field = {
    bc:frame.rest(...ownerLocal(owner,owner.bc)),br:owner.br/(scale*frame.distanceScale),
    sd(x,y,z) {
      const local = frame.point(x,y,z);
      return owner.sd(...(space?.point(local) ?? local))/(scale*frame.stretch);
    }
  };
  const { modifier,report } = fromAttachment({ mode,settings,grid,attachment,owner:field,binding,skipped:[],api,V });
  editor.updateModifier(id,{ brush:modifier.brush },key);
  return report;
}

function affectedDepth(sd,api,projection,grid,x,y,near,far,mode) {
  const dz = (far-near)/depthSamples;
  const area = Math.hypot(...projection.right)*Math.hypot(...projection.down);
  const intervals = [];
  let estimate = 0, start = null;
  for (let i=0;i<depthSamples;i++) {
    const z = near+(i+.5)*dz;
    const inside = sd(...api.point(projection,grid,x+.5,y+.5,z))<0;
    if (inside===(mode==='cut')) {
      start ??= near+i*dz;
      estimate += area*dz*(projection.perspective ? z*z : 1);
    } else if (start!==null) {
      intervals.push([start,near+i*dz]);
      start = null;
    }
  }
  if (start!==null) intervals.push([start,far]);
  return { intervals,estimate };
}

module.exports = { project,update,prepareFootprint,captureFootprint,localProjection,affineMatrix,footprintKeys,fields,reject };
