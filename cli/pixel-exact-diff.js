'use strict';

const { isDeepStrictEqual:equal } = require('node:util');
const Canvas = require('../src/pixel-canvas-transforms.js');
const { viewOptions } = require('./splat-edit-diagnostics.js');

const keys = (before,after)=>new Set([...before.keys(),...after.keys()]);
const index = rows=>new Map((rows ?? []).map(row=>[row.id,row]));
const frames = design=>design.version === 2 ? index(design.frames) : new Map([[undefined,true]]);
const hex = rgb=>rgb === undefined ? null : '#'+rgb.toString(16).padStart(6,'0');
const coordinate = (frame,x,y)=>frame && x < frame.width && y < frame.height ? y*frame.width+x : -1;

function composite(frame,p) {
  if (p < 0) return null;
  const slot = frame.slots[p], layer = frame.layerIds[frame.owners[p]];
  return { layer,cel:frame.cels?.get(layer) ?? null,swatch:frame.swatches[slot] ?? null,
    color:slot < 0 ? null : hex(frame.mixedColors?.[p] ?? frame.colors[slot]),
    alpha:frame.opacity?.[p] ?? (slot < 0 ? 0 : 255),protected:!!frame.locks[p] };
}

function paint(frame,source,layer,p) {
  if (!source || p < 0 || source.slots[p] === -1) return null;
  const slot = source.slots[p];
  return { cel:frame.cels?.get(layer) ?? null,swatch:frame.swatches[slot] ?? null,
    color:hex(frame.colors[slot]),alpha:slot < 0 ? 0 : source.alpha?.[p] ?? 255,
    knockout:slot === -2,clip:source.clipping?.[p] ?? 255 };
}

function compareGrid(before,after,read,write) {
  const width = Math.max(before?.width ?? 0,after?.width ?? 0);
  const height = Math.max(before?.height ?? 0,after?.height ?? 0);
  for (let y=0; y<height; y++) for (let x=0; x<width; x++) {
    const a = read(before,coordinate(before,x,y)), b = read(after,coordinate(after,x,y),true);
    if (!equal(a,b)) write(x,y,a,b);
  }
}

function documentDiff(baseline,candidate,compile) {
  const cells = [], grids = [], protectedCells = [];
  if (equal(baseline,candidate)) return { cells,grids,protectedCells };
  const oldFrames = frames(baseline), newFrames = frames(candidate);
  for (const id of keys(oldFrames,newFrames)) {
    const frame = id ?? null;
    const before = oldFrames.has(id) ? compile(baseline,id,undefined,true) : null;
    const after = newFrames.has(id) ? compile(candidate,id,undefined,true) : null;
    const oldGrid = before && [before.width,before.height], newGrid = after && [after.width,after.height];
    if (!equal(oldGrid,newGrid)) grids.push({ frame,before:oldGrid,after:newGrid });
    compareGrid(before,after,composite,(x,y,a,b)=>{
      const row = { frame,at:[x,y],before:a,after:b };
      cells.push(row);
      if (a?.protected || b?.protected) protectedCells.push({ frame,at:row.at });
    });
    const oldLayers = before?.layerSources ?? new Map(), newLayers = after?.layerSources ?? new Map();
    for (const layer of keys(oldLayers,newLayers)) {
      const left = oldLayers.get(layer), right = newLayers.get(layer);
      compareGrid(left ? before : null,right ? after : null,(raster,p,next)=>paint(raster,next ? right : left,layer,p),
        (x,y,a,b)=>cells.push({ frame,layer,at:[x,y],before:a,after:b }));
    }
  }
  return { cells,grids,protectedCells };
}

function entry(before,after,key) {
  return { key,...(before.has(key) && {before:structuredClone(before.get(key))}),
    ...(after.has(key) && {after:structuredClone(after.get(key))}) };
}

const entries = value=>new Map(Object.entries(value ?? {}));
const different = (before,after,key)=>before.has(key) !== after.has(key) || !equal(before.get(key),after.get(key));
const materialFields = new Set(['mat','sdfPaint','surfaceState','shadeNormal','shadowBand','material','pigment',
  'roughness','emission','coverage','opacity','scanMaterial','materialOverrides']);
const geometryFields = new Set(['solids','parts','instances','meshes','brushRegion','terrain','collision','heightfield']);

function fieldDiff(before,after,write) {
  for (const key of keys(before,after)) if (different(before,after,key)) write(entry(before,after,key));
}

function sceneDiff(result,{ scene,before,after },targets) {
  if (!before || !after || equal(before,after)) return;
  function compare(kind,left,right) {
    for (const key of keys(left,right)) {
      if (!different(left,right,key)) continue;
      const old = left.get(key), next = right.get(key);
      const target = { scene,kind,object:key,...((next?.part ?? old?.part) && {part:next?.part ?? old?.part}) };
      if (kind === 'decal') {
        const anchor = (next ?? old).anchor;
        result.materials.push({ ...target,object:anchor.object,...(anchor.part && {part:anchor.part}),
          ...entry(left,right,key) });
        continue;
      }
      fieldDiff(entries(old),entries(next),row=>{
        const category = row.key === 'sdfProtection' ? result.guards : materialFields.has(row.key) ?
          result.materials : result.geometry;
        category.push({ ...target,...row });
      });
    }
  }
  const solids = source=>new Map((source.solids ?? []).map((row,i)=>[row.id ?? 'slot:'+i,row]));
  compare('solid',solids(before),solids(after));
  compare('part',entries(before.parts),entries(after.parts));
  compare('prefab',entries(before.instances),entries(after.instances));
  compare('decal',index(before.surfaceDecals?.decals),index(after.surfaceDecals?.decals));
  fieldDiff(entries(before.topologyMeshes),entries(after.topologyMeshes),({ key:object,before:old,after:next })=>{
    const K = require('../index.js').load().KIT;
    const changes = K.authoring.meshTopologyScene.diff(old,next);
    const edits = targets.filter(row=>row.kind === 'mesh-topology' && row.scene === scene && row.object === object)
      .map(({ id,topology })=>({ id,correspondence:topology.correspondence }));
    if (!edits.length && old && next) edits.push({ correspondence:K.meshTopology.correspond(old.document,next.document) });
    (result.topology ??= []).push({ scene,object,...((next?.part ?? old?.part) && {part:next?.part ?? old?.part}),
      changes,...(edits.length && { edits }) });
  });
  const scoped = new Set(['solids','parts','instances','surfaceDecals','topologyMeshes']);
  fieldDiff(entries(before),entries(after),row=>{
    if (scoped.has(row.key)) return;
    const category = ['materials','roles','surfacePaint'].includes(row.key) ? result.materials :
      geometryFields.has(row.key) ? result.geometry : result.other;
    category.push({ scene,kind:'scene',...row });
  });
}

function assetDiff(result,{ scene,before = {},after = {} }) {
  const scope = (kind,object)=>({ scene,kind,...(object !== undefined && { object }) });
  const left = before.splatFit, right = after.splatFit;
  fieldDiff(new Map(left?.edits ?? []),new Map(right?.edits ?? []),row=>{
    const {key,...values} = row;
    result.geometry.push({ ...scope('splat',key),key:'footprintScale',...values });
  });
  const oldRows = new Map(left?.attributes ?? []), newRows = new Map(right?.attributes ?? []);
  for (const id of keys(oldRows,newRows)) {
    fieldDiff(entries(oldRows.get(id)),entries(newRows.get(id)),row=>{
      const category = materialFields.has(row.key) ? result.materials : result.geometry;
      category.push({ ...scope('splat',id),...row });
    });
  }
  if (!equal(left?.topology,right?.topology))
    result.geometry.push({ ...scope('splat'),key:'topology',before:structuredClone(left?.topology ?? null),after:structuredClone(right?.topology ?? null) });
  const scan = asset=>new Map((asset?.edits ?? []).map(edit=>[JSON.stringify([edit.mesh,edit.material]),edit]));
  fieldDiff(scan(before.scanPaint),scan(after.scanPaint),({key,before,after})=>{
    const {mesh,material} = after ?? before;
    const texels = edit=>new Map((edit?.texels ?? []).map(texel=>[JSON.stringify(texel.at),texel]));
    fieldDiff(texels(before),texels(after),row=>{
      const { key,...values } = row;
      result.materials.push({ ...scope('scan-material',mesh),material,key:'texel',at:JSON.parse(key),...values });
    });
    if (!equal(before?.registration,after?.registration))
      result.materials.push({ ...scope('scan-material',mesh),material,key:'registration',
        before:before?.registration ?? null,after:after?.registration ?? null });
  });
  fieldDiff(index(before.shotCorrections?.corrections),index(after.shotCorrections?.corrections),row=>{
    result.other.push({ ...scope('shot-correction',row.key),...row });
  });
}

function renderedCell(frame,p) {
  const { passes } = frame, { depth,coverage,objectId,partId,materialId,surfaceKind } = passes;
  const offset = p*3, part = passes.parts?.[partId[p]];
  return { rgba:[frame.rgb[offset],frame.rgb[offset+1],frame.rgb[offset+2],frame.alpha?.[p] ?? 255],
    coverage:coverage[p],depth:Number.isFinite(depth[p]) ? depth[p] : null,
    object:passes.objects?.[objectId[p]] ?? null,part:part?.part ?? null,entity:part?.entity ?? null,
    material:passes.materials?.[materialId[p]] ?? null,surface:passes.surfaceKinds?.[surfaceKind[p]] ?? null };
}

function renderDiff({ scene,binding,frame,grid,before,after,time,view,shot },skippedHits) {
  const { render } = require('./render.js');
  const options = { ...viewOptions(...grid,time,view),
    passes:['coverage','depth','objectId','partId','materialId','surfaceKind'],
    ...(shot && {shotCorrectionFrame:shot.frame,shotCorrectionHits:shot.id}) };
  const left = render(before,options), right = render(after,options), [w,h] = grid;
  if ([left,right].some(frame=>frame.w !== w || frame.h !== h || frame.passes?.w !== w || frame.passes.h !== h))
    throw new RangeError('Exact scene diff needs a matched native art grid');
  const cells = [];
  for (let p=0; p<w*h; p++) {
    const a = renderedCell(left,p), b = renderedCell(right,p);
    if (!equal(a,b)) cells.push({ at:[p%w,Math.floor(p/w)],before:a,after:b });
  }
  const hits = shot && right.shotCorrections?.corrections.find(row=>row.id === shot.id);
  if (shot) {
    for (const hit of hits?.skippedHits ?? []) skippedHits.push({ ...hit,edit:shot.id,binding,shotFrame:shot.frame });
  }
  return { scene,binding:binding ?? null,frame:frame ?? null,grid,time,
    ...(shot && { shotFrame:shot.frame,shotStatus:hits ? 'sampled' : 'outside-frame-range' }),cells };
}

function protectedRender(rendered,design,binding,compile) {
  const grid = [design.width,design.height], [w] = rendered.grid;
  const changed = new Set(rendered.cells.map(({at:[x,y]})=>y*w+x)), result = [];
  const active = rendered.frame != null ? [rendered.frame] : [...frames(design).keys()];
  for (const id of active) {
    if (!frames(design).has(id)) continue;
    const { locks } = compile(design,id);
    for (let p=0; p<locks.length; p++) if (locks[p]) {
      const at = [p%grid[0],Math.floor(p/grid[0])];
      const sourceAt = Canvas.sourcePoint(grid,at,binding?.canvas)?.map(Math.floor);
      if (sourceAt && changed.has(sourceAt[1]*w+sourceAt[0]))
        result.push({ scene:rendered.scene,binding:rendered.binding,frame:id ?? null,at,sourceAt });
    }
  }
  return result;
}

function exactDiff({ baseline,candidate,compile,issues,scenes,assets,views,skippedHits,renderErrors,targets = [] }) {
  const { cells,grids,protectedCells } = documentDiff(baseline,candidate,compile);
  const result = { cells,grids,materials:[],geometry:[],other:[],guards:[] };
  for (const source of scenes) sceneDiff(result,source,targets);
  for (const source of assets) assetDiff(result,source);
  const rendered = [], renderedProtection = [];
  const hits = [...skippedHits,...issues.filter(issue=>issue.at !== undefined || issue.splat !== undefined ||
    issue.code === 'protected-sdf-feature')];
  for (const {scene,binding,build} of views) {
    try {
      const view = build();
      const row = renderDiff(view,hits);
      rendered.push(row);
      renderedProtection.push(...protectedRender(row,candidate,view.registration,compile));
    } catch (error) {
      renderErrors.push({ scene,binding:binding ?? null,message:error.message });
    }
  }
  const { guards,...diff } = result;
  const details = [];
  fieldDiff(index(baseline.protectedDetails),index(candidate.protectedDetails),row=>details.push(row));
  const blocked = hits.filter(row=>(row.code ?? row.reason)?.startsWith('protected-'));
  return { ...diff,rendered,renderErrors,skippedHits:hits,protection:{
    wouldChange:!!(protectedCells.length || renderedProtection.length || details.length || guards.length),
    details,geometry:guards,cells:protectedCells,renderedCells:renderedProtection,blocked
  } };
}

module.exports = { exactDiff };
