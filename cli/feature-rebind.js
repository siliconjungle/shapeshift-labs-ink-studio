'use strict';

const {createHash}=require('node:crypto');
const Features=require('./feature-mappings.js');
const Track=require('./pixel-selection-track.js');
const Correction=require('./pixel-tracked-correction.js');
const Protection=require('../src/pixel-protection.js');

const format='ink-studio/feature-rebind';
const {fields,id}=Features;
const key=at=>at.join(',');
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

function rebindPixelFeature(design,request,{render,graph,decals,replacementScene}={}) {
  const Pixel=require('./pixel-art.js');
  Pixel.validate(design);
  if (design.version!==2||!fields(request,['format','version','id','binding','bindReplacement','feature','from','to',
    'sourceFrame','replacementFrame','views','paint','details','sockets','decals'])||request.format!==format||request.version!==1||
      ![request.id,request.binding,request.bindReplacement,request.sourceFrame,request.replacementFrame].every(id)||
      request.sourceFrame===request.replacementFrame||typeof render!=='function'||request.views?.samples?.length!==2)
    throw new TypeError('A feature rebind needs one source and one replacement view on distinct document frames');
  const {binding:bindingId,bindReplacement,sourceFrame,replacementFrame,views,paint,details=[],sockets=[]}=request;
  const binding=design.sceneBindings?.find(row=>row.id===bindingId), frameIds=design.frames.map(row=>row.id);
  if (!binding?.featureMapping||binding.frame!==undefined&&binding.frame!==sourceFrame||
      ![sourceFrame,replacementFrame].every(n=>frameIds.includes(n))||
      design.sceneBindings.some(row=>row.id===bindReplacement))
    throw new RangeError('Feature rebind needs an available named mapping and unused replacement binding ID');
  const map=Features.compile(binding.featureMapping,binding);
  Features.pair(map,request);
  if (!Array.isArray(details)||details.length>128||!Array.isArray(sockets)||sockets.length>128||
      !paint&&!details.length&&!sockets.length&&!request.decals?.length)
    throw new RangeError('Feature rebind needs paint, protected details or socket attachments');

  const {width,height}=design, grid=[width,height], inside=at=>Array.isArray(at)&&at.length===2&&
    Array.from(at).every((n,i)=>Number.isSafeInteger(n)&&n>=0&&n<grid[i]);
  const from=Pixel.compile(design,sourceFrame,undefined,true), destination=Pixel.compile(design,replacementFrame,undefined,true);
  const marks=new Map(), plans=[], detailIds=new Set((design.protectedDetails??[]).map(row=>row.id));
  function watch(at) {
    if (!inside(at)) throw new RangeError('Feature attachment needs a pixel in the native document grid');
    marks.set(key(at),at);
    if (marks.size>4096) throw new RangeError('Feature rebind needs at most 4096 native anchors');
  }
  if (paint!==undefined) {
    if (!fields(paint,['layer','pixels'])||!id(paint.layer)||!Array.isArray(paint.pixels)||!paint.pixels.length||
        paint.pixels.length>4096||new Set(paint.pixels.map(at=>JSON.stringify(at))).size!==paint.pixels.length||
        (from.layerStack.rows.get(paint.layer)?.kind??'paint')!=='paint'||
        !from.layerSources.has(paint.layer)||!destination.layerSources.has(paint.layer))
      throw new TypeError('Feature paint needs a paint layer and distinct native source pixels');
    for (const at of paint.pixels) watch(at);
  }
  for (const row of details) {
    if (!fields(row,['from','id','gaps'])||!id(row.from)||!id(row.id)||detailIds.has(row.id))
      throw new TypeError('Feature protection needs a source detail and a new stable destination ID');
    detailIds.add(row.id);
    const detail=Protection.active(design.protectedDetails,frameIds,frameIds.indexOf(sourceFrame)).find(entry=>entry.id===row.from);
    if (!detail?.pixels.length) throw new RangeError('No protected source detail '+row.from);
    const gaps=new Map();
    if (detail.kind==='gap') {
      if (!Array.isArray(row.gaps)||row.gaps.length!==detail.pixels.length)
        throw new TypeError('Supply two visible rim anchors for every protected gap pixel');
      for (const gap of row.gaps) {
        if (!fields(gap,['at','anchors'])||!inside(gap.at)||!Array.isArray(gap.anchors)||gap.anchors.length!==2||
            !gap.anchors.every(inside)||!same(Correction.bridge(...gap.anchors),gap.at)||gaps.has(key(gap.at)))
          throw new RangeError('Gap anchors must straddle their blank pixel by one cell');
        gaps.set(key(gap.at),gap.anchors);
      }
    } else if (row.gaps!==undefined) throw new TypeError('Only protected gaps accept rim anchors');
    const pixels=detail.pixels.map(at=>{
      const anchors=gaps.get(key(at));
      if (detail.kind==='gap'&&!anchors) throw new RangeError('Missing protected gap anchors');
      for (const mark of anchors??[at]) watch(mark);
      return {at,anchors};
    });
    plans.push({id:row.id,from:detail.id,kind:detail.kind??'pixel',pixels});
  }

  let matched, before, after, tracking;
  if (marks.size) {
    const selection={id:request.id,frame:sourceFrame,pixels:[...marks.values()]};
    const captured=Track.track({binding,selection,documentGrid:grid,revision:from.revision,views,render,feature:request,
      visit({index,full,matches}) {
        if (index) { after=full; matched=new Map(matches.map(row=>[key(row.documentAt),row])); }
        else before=full;
      }});
    tracking=captured.report;
  }
  const problems=[], rows=[], writes=[];
  const toDocument=Correction.inverseRegistration(grid,binding.canvas);
  const captureGrid=binding.canvas?.size??grid;
  function gapClear(frame,at) {
    if (!at) return false;
    const pixel=at[0]+at[1]*captureGrid[0];
    return Number.isFinite(frame.passes.coverage?.[pixel])&&frame.passes.coverage[pixel]<.1;
  }
  function reproject(at,anchors) {
    if (anchors) {
      const hits=anchors.map(p=>matched.get(key(p)));
      const sourceGap=Correction.bridge(...hits.map(row=>row.referenceAt??[NaN,NaN]));
      if (!gapClear(before,sourceGap)) return {reason:'source-gap-covered'};
      if (hits.some(row=>row.status!=='visible')) return {reason:'gap-anchor-unresolved'};
      const target=Correction.bridge(...hits.map(row=>row.at));
      if (!gapClear(after,target)) return {reason:target?'replacement-gap-covered':'gap-span-changed'};
      const registration=toDocument(target);
      return registration.target ? {at:registration.target,mapping:hits.map(row=>row.mapping)} : registration;
    }
    const hit=matched.get(key(at));
    if (hit.status!=='visible') return {reason:hit.reason??hit.status};
    const registration=toDocument(hit.at);
    return registration.target ? {at:registration.target,mapping:hit.mapping} : registration;
  }
  if (paint) {
    const a=from.layerSources.get(paint.layer), b=destination.layerSources.get(paint.layer);
    const occupied=new Set();
    for (const at of paint.pixels) {
      const result=reproject(at), p=at[0]+at[1]*width, slot=a.slots[p], alpha=a.alpha?.[p]??255;
      const dest=result.at&&result.at[0]+result.at[1]*width;
      const samePaint=result.at&&b.slots[dest]===slot&&(b.alpha?.[dest]??255)===alpha;
      const reason=result.reason??(slot<0||alpha===0 ? 'paint-source-empty' : occupied.has(dest) ? 'replacement-pixel-collision' :
        !samePaint&&b.slots[dest]!==-1 ? 'replacement-pixel-already-painted' :
        !samePaint&&(destination.locks[dest]||destination.layerStack.rows.get(paint.layer)?.effectiveLock) ? 'replacement-pixel-locked' : null);
      const row={kind:'paint',layer:paint.layer,source:at,...result,...(reason&&{reason})};
      rows.push(row);
      if (reason) {problems.push(row); continue;}
      occupied.add(dest);
      const {id:swatch,color}=from.paletteEntries[slot];
      const rgba=[1,3,5].map(i=>parseInt(color.slice(i,i+2),16)).concat(alpha);
      if (!samePaint) writes.push({at:result.at,rgba,swatch});
    }
  }
  const pixelPainted=(frame,p)=>frame.slots[p]>=0&&(frame.opacity?.[p]??255)>0;
  const retained=[], painted=new Set(writes.map(row=>key(row.at)));
  const active=Protection.active(design.protectedDetails,frameIds,frameIds.indexOf(replacementFrame));
  const locks=new Map(active.flatMap(detail=>detail.pixels.map(at=>[key(at),detail.kind??'pixel'])));
  for (const plan of plans) {
    const pixels=[], occupied=new Set();
    for (const {at,anchors} of plan.pixels) {
      const result=reproject(at,anchors), dest=result.at&&key(result.at);
      const reason=result.reason??(occupied.has(dest) ? 'replacement-pixel-collision' :
        locks.has(dest)&&locks.get(dest)!==plan.kind ? 'replacement-protection-conflict' :
        plan.kind==='gap'&&(pixelPainted(from,at[0]+at[1]*width)||pixelPainted(destination,result.at[0]+result.at[1]*width)||
          painted.has(dest)) ? 'protected-gap-contains-paint' : null);
      const row={kind:'protection',detail:plan.id,sourceDetail:plan.from,source:at,...result,...(reason&&{reason})};
      rows.push(row);
      if (reason) {problems.push(row);continue;}
      occupied.add(dest);
      locks.set(dest,plan.kind);
      pixels.push(result.at);
    }
    retained.push({id:plan.id,kind:plan.kind,frame:replacementFrame,pixels});
  }
  const socketsResult=Features.sockets(map,request,graph,sockets);
  const decalsResult=Features.decals(map,request,decals,request.decals??[]);
  const report={format:format+'-report',version:1,id:request.id,feature:request.feature,from:request.from,to:request.to,
    sourceFrame,replacementFrame,sourceRevision:from.revision,featureRevision:digest(binding.featureMapping),
    passed:!problems.length,rows,sockets:socketsResult.rows,decals:decalsResult.rows,problems,...(tracking&&{tracking})};
  if (problems.length) return {report};
  let result=design;
  if (writes.length) result=Pixel.edit(result,destination,{id:request.id,frame:replacementFrame,revision:destination.revision,
    destination:'raster',operation:{tool:'rgba',layer:paint.layer,pixels:writes}});
  const {revision,stale,...next}=binding;
  const scene=replacementScene??binding.scene;
  if (typeof scene!=='string'||!scene.trim()) throw new TypeError('The replacement scene needs a reference');
  const candidate={...result,sceneBindings:[...result.sceneBindings,{...next,id:bindReplacement,scene,frame:replacementFrame}],
    ...(retained.length&&{protectedDetails:[...(result.protectedDetails??[]),...retained]})};
  Pixel.validate(candidate);
  return {report,document:candidate,...(socketsResult.graph&&{graph:socketsResult.graph}),...(decalsResult.decals&&{decals:decalsResult.decals})};
}

module.exports={rebindPixelFeature};
