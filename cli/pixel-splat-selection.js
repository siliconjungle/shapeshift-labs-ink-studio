'use strict';

const Targets = require('../src/target-selectors.js');
const Provenance = require('../src/splat-provenance.js');
const PixelSelections = require('../src/pixel-selections.js');
const Canvas = require('../src/pixel-canvas-transforms.js');
const View = require('../src/pixel-view-source.js');
const Source = require('../src/pixel-source-bindings.js');
const { rowRevision,splatTargets } = require('./pixel-source-passes.js');
const { digest } = require('./pixel-edit-revisions.js');
const SplatFit = require('./splat-fit-asset.js');

const record = value => value && Object.getPrototypeOf(value)===Object.prototype;
const fields = (value,keys) => record(value) && Object.keys(value).every(key=>keys.includes(key));
const vector = value => Array.isArray(value) && value.length===3 && Array.from(value).every(Number.isFinite);

function prepare(query, grid, recall) {
  if (!fields(query,['part','material','region','footprint','minContribution','editableOnly','paintableOnly']))
    throw new TypeError('A splat query needs part, material, region, footprint, minContribution, editableOnly or paintableOnly');
  const {part,material,region,footprint,minContribution,editableOnly=false,paintableOnly=false}=query;
  if (part!==undefined && !Targets.name(part) ||
      material!==undefined && !Targets.name(material) && !Number.isSafeInteger(material) ||
      minContribution!==undefined && !SplatFit.unit(minContribution) || (typeof editableOnly!=='boolean' || typeof paintableOnly!=='boolean'))
    throw new TypeError('Choose valid part and material IDs, a contribution from 0 to 1, and boolean editableOnly and paintableOnly filters');
  if (region!==undefined && (!fields(region,['min','max']) || !vector(region.min) || !vector(region.max) ||
      region.min.some((low,k)=>low>region.max[k])))
    throw new TypeError('A splat region needs inclusive XYZ min and max in rest space');
  let mask;
  if (footprint!==undefined) {
    if (!fields(footprint,['at','rect','selection']) || Object.keys(footprint).length!==1)
      throw new TypeError('A footprint needs one pixel, rectangle, or saved selection');
    if (Object.hasOwn(footprint,'rect'))
      mask=PixelSelections.mask(...grid,{type:'rectangle',rect:footprint.rect});
    else {
      const pixels=Object.hasOwn(footprint,'at') ? [footprint.at] : recall(footprint.selection);
      mask=PixelSelections.fromPixels(...grid,pixels);
    }
  } else if (minContribution!==undefined) {
    mask=new Uint8Array(grid[0]*grid[1]).fill(1);
  }
  return {query,grid,mask,minimum:minContribution??0,editableOnly,paintableOnly};
}

function select(world,binding,plan,context) {
  const {query,editableOnly,paintableOnly,mask}=plan, {region,part,material}=query;
  const rest=Provenance.restData(world), identities=Provenance.identities(world,{fresh:true});
  const authored=Targets.index(world).row, chosen=new Map();
  const fit=SplatFit.prepare(world,world.look?.splatFit);
  const effective=SplatFit.renderWorld(world,fit,
    {footprints:world.look?.splatFootprints!==false,applyAttributes:false});
  const row=splatTargets(effective);
  const inScope=target=>!!Targets.objectScope(binding,target) &&
    (part===undefined || target.part===part) && (material===undefined || target.material===material);
  const editable=i=>!!Targets.objectScope(binding,authored(i)) && SplatFit.eligible(world,i);
  const eligible=i=>(!editableOnly || editable(i)) &&
    (!paintableOnly || !!Targets.objectScope(binding,authored(i)) && SplatFit.paintable(world,i));
  const choice=(id,index)=>({id,index,editable:editable(index)});
  function inRegion(index) {
    if (!region) return true;
    const position=fit?.rowAttributes?.get(index)?.position ?? rest.subarray(index*16,index*16+3);
    return region.min.every((low,k)=>position[k]>=low && position[k]<=region.max[k]);
  }
  const selection={query,frame:plan.frame,unstableIds:0};
  if (!mask) {
    for (let i=0;i<world.count;i++) {
      if (!inScope(row(i)) || !inRegion(i) || !eligible(i)) continue;
      const id=identities.idAt(i);
      if (id) chosen.set(id,choice(id,i));
      else selection.unstableIds++;
    }
    return {rows:ordered(chosen),selection,row};
  }
  const grid=binding.canvas?.size??plan.grid, [width,height]=grid;
  View.grid(width,height);
  if (!context.captureSelection) throw new TypeError('Footprint selection needs a scene capture or SDK renderFrame with sourceSplat passes');
  const frame=context.captureSelection({w:width,h:height,passes:['sourceSplat'],sceneInspection:true,
    captureId:'splat-selection',sourceWorld:world,scene:binding.scene});
  const {passes,sourceView}=frame??{};
  if (sourceView && !context.sameScene(binding.scene,sourceView.source))
    throw new RangeError('The splat source view belongs to a different scene than binding '+binding.id);
  const size=width*height;
  if (frame?.w!==width || frame.h!==height || passes?.w!==width || passes.h!==height ||
      !Array.isArray(passes.splatSources) || !['sourceSplat','sourceSplatAlpha','sourceSplatWeight','sourceSplatDepth']
        .every(name=>ArrayBuffer.isView(passes[name]) && passes[name].length===size*4) ||
      !ArrayBuffer.isView(passes.sourceSplatOmitted) || passes.sourceSplatOmitted.length!==size)
    throw new RangeError('Footprint selection needs aligned sourceSplat passes on the bound native grid');
  const visited=new Uint8Array(size), checked=new Map(), unstable=new Set(), stale=new Set();
  const evidence={grid,sampledPixels:0,clippedPixels:0,stalePixels:0,omittedPixels:0,maxOmittedCoverage:0,staleIds:0};
  if (sourceView) evidence.view=sourceView;
  for (let p=0;p<mask.length;p++) {
    if (!mask[p]) continue;
    const at=[p%plan.grid[0],Math.floor(p/plan.grid[0])];
    if (Source.staleAt(binding,at)) {
      evidence.stalePixels++;
      continue;
    }
    const mapped=Canvas.sourcePoint(plan.grid,at,binding.canvas);
    if (!mapped) {
      evidence.clippedPixels++;
      continue;
    }
    const [x,y]=mapped.map(Math.floor), pixel=y*width+x;
    if (visited[pixel]) continue;
    visited[pixel]=1;
    evidence.sampledPixels++;
    const {splats,omittedCoverage}=Source.sample(frame,[x,y],null,null);
    if (omittedCoverage>0) {
      evidence.omittedPixels++;
      evidence.maxOmittedCoverage=Math.max(evidence.maxOmittedCoverage,omittedCoverage);
    }
    const weights=new Map();
    for (const hit of splats) {
      if (!inScope(hit) || editableOnly && !hit.editable || !(hit.visibleCoverage>0)) continue;
      const key=hit.id??hit.slot;
      const entry=weights.get(key);
      if (entry) entry.weight+=hit.visibleCoverage;
      else weights.set(key,{hit,weight:hit.visibleCoverage});
    }
    for (const {hit,weight} of weights.values()) {
      if (weight<plan.minimum) continue;
      if (!hit.id) {
        unstable.add(hit.slot);
        continue;
      }
      if (!checked.has(hit.slot)) {
        const index=identities.rowOf(hit.id);
        const target=index>=0 && row(index);
        const current=target && ['object','entity','part','material'].every(key=>target[key]===hit[key]) &&
          rowRevision(effective,index)===hit.revision;
        checked.set(hit.slot,current ? index : -1);
      }
      const index=checked.get(hit.slot);
      if (index<0) {
        stale.add(hit.id);
        continue;
      }
      if (!inRegion(index) || !eligible(index)) continue;
      let selected=chosen.get(hit.id);
      if (!selected) {
        selected={...choice(hit.id,index),pixels:0,peakContribution:0};
        chosen.set(hit.id,selected);
      }
      selected.pixels++;
      if (weight>selected.peakContribution) {
        selected.peakContribution=Math.min(1,weight);
        selected.sourceAt=[x,y];
      }
    }
  }
  evidence.staleIds=stale.size;
  evidence.revision=digest([sourceView,plan.query,visited,[...chosen.values()].map(({index,...row})=>row),evidence.omittedPixels]);
  return {rows:ordered(chosen),row,selection:{...selection,unstableIds:unstable.size,footprint:evidence}};
}

function ordered(chosen) {
  return [...chosen.values()].sort((a,b)=>(b.peakContribution??0)-(a.peakContribution??0) || (a.id<b.id?-1:a.id>b.id?1:0));
}

module.exports={prepare,select};
