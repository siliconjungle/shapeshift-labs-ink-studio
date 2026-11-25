'use strict';

const Fit = require('./splat-fit-asset.js');
const Topology = require('./splat-topology.js');
const MathFit = require('./splat-redistribution-math.js');
const Review = require('./splat-redistribution-review.js');
const Provenance = require('../src/splat-provenance.js');
const Targets = require('../src/target-selectors.js');
const Footprints = require('../src/splat-footprints.js');
const Engraving = require('../src/engraving.js');
const { prepare:attribute } = require('./splat-row-attributes.js');
const Surface = require('../src/surface-look.js');

const fields = (value,keys)=>value && Object.getPrototypeOf(value)===Object.prototype &&
  Object.keys(value).every(key=>keys.includes(key));
const family = items=>Array.isArray(items) && items.length>=2 && items.length<=MathFit.maxFamily;
const equal = (a,b)=>JSON.stringify(a)===JSON.stringify(b);
const validId = Provenance.validId;

function planSplatRedistribution(world, {target, operations, review, base=world.look?.splatFit, edit='redistribution'} = {}) {
  const config=Review.settings(review), prior=base===false ? undefined : base;
  const scope=Targets.prepare(target??prior?.target);
  if (!Targets.name(scope.object) || Object.keys(scope).some(key=>!['object','part'].includes(key)) ||
      prior && (prior.format!==Fit.format || prior.version!==2 || !equal(scope.object,prior.target?.object) ||
        !equal(scope.part,prior.target?.part)))
    throw new RangeError('Redistribution needs a stable splat fit with the same object and part scope');
  if (!Array.isArray(operations) || !operations.length || operations.length>16 || !validId(edit))
    throw new RangeError('Redistribution needs 1–16 ordered split or merge operations');
  const fit=Fit.prepare(world,prior), rendered=Fit.renderWorld(world,fit), source=Fit.sourceWorld(world,fit);
  const idAt=Provenance.identities(source), labels=Targets.index(rendered).row;
  const footprint=Footprints.validate(rendered), engraving=Engraving.validate(rendered);
  const priorAttributes=new Map(prior?.attributes), attributes=new Map(prior?.attributes);
  const topology=prior?.topology?.slice()??[], records=[], planned=new Map(), consumed=new Set(), families=[];
  const harmonic=rendered.gaussianHarmonics, terms=harmonic && ((harmonic.degree+1)**2-1)*3;
  const splitKeys=['op','splat','children'], mergeKeys=['op','id','from'];

  function current(id) {
    if (!validId(id) || consumed.has(id)) throw new RangeError('Unavailable or previously consumed splat: '+id);
    if (planned.has(id)) return planned.get(id);
    const row=idAt.rowOf(id);
    if (row<0 || fit?.topology?.retired.has(row) || !Fit.topologyEditable(source,row) || !Targets.objectScope(scope,labels(row)))
      throw new RangeError('Unavailable or out-of-scope splat: '+id);
    if (Fit.footprintAt(footprint,row) || engraving?.indices?.[row] ||
        source.pix?.[row*8] || source.fine?.[row*12+11])
      throw new RangeError('Redistribution requires a Gaussian footprint without retained pixel or engraving marks: '+id);
    const q=row*16, scale=fit?.[row]??1;
    const density=rendered.data[q+3], coverage=fit?.coverage?.[row]??1;
    const opacity=coverage===1 ? density : Math.min(1,density)*coverage;
    if (!scale || !opacity) throw new RangeError('Redistribution needs a visible source splat: '+id);
    const {material,roughness,emission}=priorAttributes.get(id)??{};
    const inherited={...(material!==undefined && {material}),...(roughness!==undefined && {roughness}),
      ...(emission!==undefined && {emission})};
    const label=labels(row);
    const scan=harmonic && (!harmonic.available || harmonic.available[row]) ? {
      dc:Array.from(harmonic.dc.subarray(row*3,row*3+3)),sh:Array.from(harmonic.sh.subarray(row*terms,(row+1)*terms)),
      linear:!!harmonic.linear?.[row],...(harmonic.normals && {normal:Array.from(harmonic.normals.subarray(row*3,row*3+3))})
    } : undefined;
    return {position:Array.from(rendered.data.subarray(q,q+3)),opacity,
      covariance:MathFit.coordinates.map(k=>rendered.data[q+k]*scale*scale),pigment:Fit.pigmentAt(source,row,fit),
      label,finish:rendered.surfaceData?.[row*Surface.STRIDE]??0,inherited,scan};
  }

  function snapshot({position,opacity,covariance,pigment,scan}) {
    return {position,opacity,covariance,pigment,...(scan && {scan})};
  }

  function publish(id,result,anchor) {
    if (!validId(id) || id.startsWith('rest:') || planned.has(id) || idAt.rowOf(id)>=0)
      throw new RangeError('Splat ID is reserved or already exists: '+id);
    planned.set(id,{...anchor,...result});
    if (Object.keys(anchor.inherited).length)
      attributes.set(id,{...anchor.inherited,...(anchor.inherited.material!==undefined && {pigment:result.pigment})});
  }

  for (const request of operations) {
    const {op,splat,children,id,from}=request??{};
    const common={op,edit,target:scope};
    let sources, outputs;
    if (op==='split' && fields(request,splitKeys) && family(children)) {
      const parent=current(splat);
      const parts=children.map(child=>{
        if (!fields(child,['id','offset','weight'])) throw new TypeError('Invalid split child');
        return {...child,offset:attribute('position',child.offset)};
      });
      const split=MathFit.split(parent,parts);
      for (const part of split) publish(part.id,part,parent);
      records.push({...common,id:splat,children:split.map(part=>({id:part.id,weight:part.weight,...snapshot(part)}))});
      sources=[splat];
      outputs=split.map(part=>part.id);
    } else if (op==='merge' && fields(request,mergeKeys) && family(from) && new Set(from).size===from.length) {
      const parents=from.map(current), anchor=parents[0];
      if (parents.some(row=>(row.opacity>=1)!==(anchor.opacity>=1) || row.finish!==anchor.finish || !equal(row.inherited,anchor.inherited) ||
          ['object','entity','part','material','surface'].some(key=>row.label[key]!==anchor.label[key]) ||
          !!row.scan!==!!anchor.scan || row.scan?.linear!==anchor.scan?.linear))
        throw new RangeError('Merge needs compatible coverage mode, material, finish, scan format and part ownership');
      const result=MathFit.merge(parents);
      publish(id,result,anchor);
      records.push({...common,id,from:from.slice(),weights:result.weights,result:snapshot(result)});
      sources=from.slice();
      outputs=[id];
    } else throw new TypeError('Expected a splat split with children or a merge with source IDs');
    const connected=families.filter(entry=>sources.some(id=>entry.ids.has(id)));
    const ids=new Set([...connected.flatMap(entry=>[...entry.ids]),...sources,...outputs]);
    for (const name of sources) consumed.add(name);
    const original=[...new Set([...connected.flatMap(entry=>entry.sources),...sources.filter(id=>!planned.has(id))])];
    const final=[...connected.flatMap(entry=>entry.outputs),...outputs].filter(id=>!consumed.has(id));
    for (const entry of connected) families.splice(families.indexOf(entry),1);
    families.push({ids,sources:original,outputs:final});
  }
  const groups=prior?.groups?.map(({members,mask,...group})=>({...group,
    members:members.filter(id=>!consumed.has(id)),...(mask && {mask:mask.filter(([id])=>!consumed.has(id))})}))
    .filter(group=>group.members.length);
  const asset={format:Fit.format,version:2,scene:Fit.sceneId(world),target:scope,edits:prior?.edits??[],
    topology:[...topology,...records],...(groups && {groups}),...(attributes.size && {attributes:[...attributes]})};
  const candidate=Fit.prepare(world,asset);
  const report={...Review.review(world,prior,asset,families,config),
    candidateRevision:candidate.revision,previousRevision:fit?.revision??null,operations:records};
  return {asset:report.passed ? asset : null,report};
}

module.exports={planSplatRedistribution};
