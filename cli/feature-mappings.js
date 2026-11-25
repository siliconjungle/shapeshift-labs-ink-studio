'use strict';

const format='ink-studio/feature-mapping';
const id=value=>typeof value==='string'&&/^[a-z][a-z0-9-]{0,63}$/.test(value);
const label=value=>typeof value==='string'&&value.trim().length>0&&value.length<=4096;
const fields=(value,keys)=>value&&Object.getPrototypeOf(value)===Object.prototype&&
  Object.keys(value).every(key=>keys.includes(key));
const vector=(v,n)=>Array.isArray(v)&&v.length===n&&Array.from(v).every(x=>Number.isFinite(x)&&Math.abs(x)<=1e6);
const interval=(v,lo,hi)=>vector(v,2)&&v[0]>=lo&&v[1]<=hi&&v[0]<v[1];
const namedList=(values,test,limit)=>Array.isArray(values)&&values.length>0&&values.length<=limit&&
  Array.from(values).every(test)&&new Set(values).size===values.length;
const allowed={
  mesh:['asset','chart','triangles','faces'],sdf:['field'],splat:['group','ids'],
  curve:['strand','range'],sprite:['asset','frames']
};

function transform(value) {
  if (value===true) return value;
  if (!vector(value,12)) throw new TypeError('A feature transform needs a row-major 3 × 4 affine matrix');
  const [a,b,c,,d,e,f,,g,h,i]=value;
  const unit=Math.max(...[a,b,c,d,e,f,g,h,i].map(Math.abs));
  if (!unit||Math.abs((a*(e*i-f*h)-b*(d*i-f*g)+c*(d*h-e*g))/unit**3)<1e-10)
    throw new RangeError('Feature transforms need an invertible frame');
  return value;
}

function selector(kind,value) {
  if (!Object.hasOwn(allowed,kind)||!fields(value,allowed[kind])) return false;
  if (kind==='mesh') return label(value.asset)&&(value.chart===undefined||label(value.chart)||Number.isSafeInteger(value.chart))&&
    (value.triangles===undefined||namedList(value.triangles,n=>Number.isSafeInteger(n)&&n>=0,8192))&&
    (value.faces===undefined||namedList(value.faces,label,8192));
  if (kind==='sdf') return label(value.field)||Array.isArray(value.field)&&value.field.length>0&&value.field.length<=4&&
    value.field.every(n=>label(n)||Number.isSafeInteger(n)&&n>=0);
  if (kind==='splat') return (value.group!==undefined)!==(value.ids!==undefined)&&
    (value.group!==undefined ? id(value.group) : namedList(value.ids,label,32768));
  if (kind==='curve') return label(value.strand)&&interval(value.range,0,1);
  return label(value.asset)&&(value.frames===undefined||namedList(value.frames,n=>Number.isSafeInteger(n)&&n>=0,256));
}

function compile(raw,binding) {
  if (!fields(raw,['format','version','id','object','part','features'])||raw.format!==format||raw.version!==1||
      !id(raw.id)||!label(raw.object)||!label(raw.part)||binding&&(binding.object!==raw.object||binding.part!==raw.part)||
      !Array.isArray(raw.features)||!raw.features.length||raw.features.length>128)
    throw new TypeError('Expected a version 1 feature mapping for the bound object and part');
  const featureIds=new Set(), sites=new Map(), kinds=new Map();
  for (const feature of raw.features) {
    if (!fields(feature,['id','tolerance','sites'])||!id(feature.id)||featureIds.has(feature.id)||
        !Number.isFinite(feature.tolerance)||feature.tolerance<=0||feature.tolerance>1000||
        !Array.isArray(feature.sites)||feature.sites.length<2||feature.sites.length>24)
      throw new RangeError('A named feature needs a unique ID, tolerance and two or more sites');
    featureIds.add(feature.id);
    for (const site of feature.sites) {
      const {kind,id:siteId,match,toFeature,region,station,worldFrame}=site??{};
      if (!fields(site,['id','kind','match','toFeature','region','station','worldFrame'])||!id(siteId)||
          sites.has(siteId)||!selector(kind,match)||kind!=='curve'&&(!fields(region,['min','max'])||
            !vector(region.min,3)||!vector(region.max,3)||region.min.some((n,i)=>n>region.max[i]))||
          kind==='curve'&&(!Array.isArray(station)||station.length!==2||!station.every(p=>vector(p,3))||
            station[0].every((n,i)=>n===station[1][i])||region!==undefined||toFeature!==undefined)||
          kind!=='curve'&&station!==undefined)
        throw new RangeError('Invalid or duplicate feature site '+siteId);
      if (kind!=='curve') transform(toFeature);
      if (worldFrame!==undefined) transform(worldFrame);
      const entry={...site,feature:feature.id,tolerance:feature.tolerance,
        ...(match.ids&&{ids:new Set(match.ids)}),...(match.triangles&&{triangles:new Set(match.triangles)}),
        ...(match.faces&&{faces:new Set(match.faces)})};
      sites.set(siteId,entry);
      if (!kinds.has(kind)) kinds.set(kind,[]);
      kinds.get(kind).push(entry);
    }
  }
  return {raw,sites,kinds};
}

function apply(matrix,point) {
  if (matrix===true) return point.slice();
  return [0,4,8].map(row=>matrix[row+3]+point.reduce((sum,n,i)=>sum+n*matrix[row+i],0));
}

function identify(map,hit,rest,tracking,{feature,site}={}) {
  const rows=[];
  for (const entry of map.kinds.get(hit.kind)??[]) {
    if (feature!==undefined&&feature!==entry.feature||site!==undefined&&site!==entry.id) continue;
    const {match,region,station}=entry;
    let p=rest;
    if (hit.kind==='mesh') {
      if (match.asset!==hit.asset||match.chart!==undefined&&match.chart!==hit.chart||
          entry.triangles&&!entry.triangles.has(hit.triangle)||entry.faces&&!entry.faces.has(hit.face)) continue;
    } else if (hit.kind==='sdf') {
      if (Array.isArray(match.field) ? JSON.stringify(match.field)!==JSON.stringify(hit.field) :
          match.field!==hit.field?.[0]&&match.field!==hit.object&&match.field!==hit.entity) continue;
    } else if (hit.kind==='splat') {
      if (entry.ids ? !entry.ids.has(hit.id) : !tracking?.inSplatGroup(match.group,hit.id)) continue;
    } else if (hit.kind==='curve') {
      if (hit.strand!==match.strand||hit.u<match.range[0]||hit.u>match.range[1]) continue;
      const t=(hit.u-match.range[0])/(match.range[1]-match.range[0]);
      p=station[0].map((n,i)=>n+(station[1][i]-n)*t);
    } else if (match.asset!==hit.asset||match.frames&&!match.frames.includes(hit.frame)) continue;
    if (!vector(p,3)||region&&p.some((n,i)=>n<region.min[i]||n>region.max[i])) continue;
    const point=hit.kind==='curve' ? p : apply(entry.toFeature,p);
    if (vector(point,3)) rows.push({site:entry.id,feature:entry.feature,tolerance:entry.tolerance,point});
  }
  return rows.length===1 ? {address:rows[0]} :
    {reason:rows.length ? 'ambiguous-named-feature' : 'named-feature-address-unavailable'};
}

function pair(map,{feature,from,to}={}) {
  const a=map.sites.get(from),b=map.sites.get(to);
  if (!a||!b||a.feature!==feature||b.feature!==feature||a.id===b.id)
    throw new RangeError('Choose distinct source and replacement sites of the same named feature');
  return {from:a,to:b};
}

function sceneFrame(kit,value) {
  if (value===undefined) throw new RangeError('Socket transfer needs an explicit world frame on both sites');
  if (value===true) return kit.sceneGraph.transform();
  return kit.sceneGraph.transform({position:[value[3],value[7],value[11]],
    matrix:[...value.slice(0,3),...value.slice(4,7),...value.slice(8,11)]});
}

function sockets(map,selection,spec,refs,kit=require('../index.js').load().KIT) {
  if (!Array.isArray(refs)||refs.length>128||refs.length>0&&!spec)
    throw new TypeError('Feature sockets need a scene hierarchy and at most 128 socket references');
  if (!refs.length) return {graph:spec,rows:[]};
  const sites=pair(map,selection), S=kit.sceneGraph;
  const from=sceneFrame(kit,sites.from.worldFrame), to=sceneFrame(kit,sites.to.worldFrame);
  const g=S.create(spec), used=new Set();
  const captured=refs.map(ref=>{
    if (!fields(ref,['node','socket'])||typeof ref.socket!=='string') throw new TypeError('A feature socket needs a node and socket ID');
    const address=S.reference(ref), key=JSON.stringify(address);
    if (used.has(key)) throw new RangeError('Feature socket is listed twice');
    used.add(key);
    const before=g.frame(address);
    const after=S.compose(to,S.compose(S.inverse(from),before));
    return { ...address,before:S.transform({position:before.position,matrix:before.matrix}),after };
  });
  // Parents are updated before any selected descendant sockets are resolved.
  const depths=new Map();
  function depth(node) {
    if (!depths.has(node)) {
      const parent=g.node(node).parent;
      depths.set(node,parent ? depth(parent.node)+1 : 0);
    }
    return depths.get(node);
  }
  for (const row of captured.slice().sort((a,b)=>depth(a.node)-depth(b.node)))
    g.setSocket(row.node,row.socket,S.compose(S.inverse(g.frame(row.node)),row.after));
  return {graph:g.snapshot(),rows:captured};
}

function decals(map,selection,input,ids,kit=require('../index.js').load().KIT) {
  if (!Array.isArray(ids)||ids.length>128||ids.length&&(!input||!namedList(ids,id,128)))
    throw new TypeError('Feature paint needs distinct decal IDs and a retained decal document');
  if (!ids.length) return {decals:input,rows:[]};
  const sites=pair(map,selection), S=kit.sceneGraph, {M,V}=kit, names=new Set(ids);
  const transfer=S.compose(sceneFrame(kit,sites.to.worldFrame),S.inverse(sceneFrame(kit,sites.from.worldFrame)));
  const native=kit.surfaceDecals.create(input), rows=[];
  const next=native.decals.map(decal=>{
    if (!names.has(decal.id)) return decal;
    const {anchor:a}=decal;
    if (a.object!==map.raw.object||a.part!==map.raw.part||a.uv||a.node||a.socket)
      throw new RangeError('Feature decal needs an unparented rest-space projector on its registered part');
    const right=M.app(transfer.matrix,V.cross(a.up,a.normal)), up=M.app(transfer.matrix,a.up);
    const r=V.len(right), u=V.len(up), normal=V.norm(V.cross(right,up));
    const depth=V.dot(normal,M.app(transfer.matrix,a.normal));
    if (!(r>0&&u>0&&depth>0)||Math.abs(V.dot(right,up))>r*u*1e-6)
      throw new RangeError('The replacement frame would skew or mirror a feature paint projector');
    const anchor={...a,at:S.point(transfer,a.at),normal,up:V.mul(up,1/u),size:[a.size[0]*r,a.size[1]*u],
      depth:a.depth*depth,bias:a.bias*depth,maxStep:a.maxStep*Math.max(r,u,depth)};
    const relief=decal.relief&&{...decal.relief,height:decal.relief.height*depth};
    rows.push({id:decal.id,before:a,after:anchor});
    return {...decal,anchor,...(relief&&{relief})};
  });
  if (rows.length!==ids.length) throw new RangeError('An attached feature decal is unavailable');
  const artifact=kit.surfaceDecals.create({...native,decals:next});
  return {decals:artifact,rows};
}

module.exports={compile,identify,pair,sockets,decals,format,fields,id};
