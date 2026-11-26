const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const Cage = require('./material-cage.js');
const Source = require('./material-cage-source.js');
const Palette = require('./registered-bake-palette.js');
const UV = require('../src/material-uv.js');
const { fromSRGBByte } = require('../src/semantic-texture-mipmaps.js');

const format = 'ink-studio/registered-part-batch', presetFormat = 'ink-studio/registered-export-preset';
const defaults = { sampling: { size: 'sheet', padding: 3, direction: 'geometric', minFacing: .25, maxWork: 24000000 },
  seams: { samples: 5, maxColorDelta: 40, maxNormalDegrees: 25 } };
const presets = {
  review: { ...defaults, sampling: { ...defaults.sampling, size: 'sheet', padding: 4 } },
  compact: { ...defaults, sampling: { ...defaults.sampling, size: 'sheet', padding: 2 }, seams: { ...defaults.seams, samples: 3 } },
  indexed: { ...defaults, sampling: { ...defaults.sampling, size: 'sheet', padding: 2 }, paletteRequired: true }
};
const id = text => typeof text === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(text);
const filename = text => typeof text === 'string' && Boolean(text.trim());
const record = (raw, keys) => raw && Object.getPrototypeOf(raw) === Object.prototype &&
  Object.keys(raw).every(key => keys.includes(key));
const finite = (n, min, max) => Number.isFinite(n) && n >= min && n <= max;
const integer = (n, min, max) => Number.isSafeInteger(n) && finite(n, min, max);
const pair = (row, valid) => Array.isArray(row) && row.length === 2 && row.every(valid);
const digest = data => createHash('sha256').update(data).digest('hex');
const names = ['pigment','normal','roughness','metallic','emission','masks'];
const allowedSizes = [32, 64, 128, 256, 512, 1024, 2048];

function need(ok, message) {
  if (!ok) throw new RangeError('Registered part bake: ' + message);
}
function preset(name) {
  need(Object.hasOwn(presets, name), 'choose review, compact or indexed');
  return { format:presetFormat, version:1, id:name, ...presets[name] };
}
function read(file, limit = 32 * 1024 * 1024) {
  const stats = fs.statSync(file);
  need(stats.isFile() && stats.size <= limit, 'input exceeds byte budget');
  const bytes = fs.readFileSync(file);
  return { value: JSON.parse(bytes), sha256: digest(bytes) };
}

function sampling(input = {}, base = defaults.sampling) {
  need(record(input, ['size','padding','direction','minFacing','maxWork','channels','cage']), 'unknown per-part sampling setting');
  const out = { ...base, ...input };
  need((out.size === 'sheet' || allowedSizes.includes(out.size)) && integer(out.padding,0,32) &&
    ['smooth','geometric'].includes(out.direction) && finite(out.minFacing,0,1) && integer(out.maxWork,1,200000000) &&
    (out.channels === undefined || Array.isArray(out.channels) && out.channels.length &&
      new Set(out.channels).size===out.channels.length && out.channels.every(ch=>names.includes(ch))), 'invalid per-part sampling');
  const cage = out.cage ?? {};
  need(record(cage, ['front','back','search','margin','maxProbes']), 'invalid cage settings');
  const fixed = cage.front !== undefined || cage.back !== undefined;
  need(fixed ? finite(cage.front ?? 0,0,1e5) && finite(cage.back ?? 0,0,1e5) &&
    (cage.front ?? 0)+(cage.back ?? 0)>=1e-7 && [cage.search,cage.margin,cage.maxProbes].every(v=>v===undefined)
    : (cage.search === undefined || finite(cage.search,1e-5,1e5)) &&
      (cage.margin === undefined || finite(cage.margin,0,1e5)) &&
      (cage.maxProbes === undefined || integer(cage.maxProbes,1,4096)), 'invalid cage envelope or probe settings');
  return { ...out, cage };
}

function readPreset(raw, directory) {
  const source = typeof raw==='string' ? (Object.hasOwn(presets,raw) ? preset(raw) : read(path.resolve(directory,raw),65536).value)
    : raw;
  need(record(source,['format','version','id','sampling','seams','paletteRequired']) && source.format===presetFormat &&
    source.version===1 && id(source.id) && (source.paletteRequired===undefined || typeof source.paletteRequired==='boolean'),
    'invalid export preset');
  need(record(source.seams ?? {},['samples','maxColorDelta','maxNormalDegrees']), 'invalid seam diagnostic settings');
  const seams={...defaults.seams,...source.seams};
  need(integer(seams.samples,1,16) && finite(seams.maxColorDelta,0,255) && finite(seams.maxNormalDegrees,0,180), 'invalid seam limits');
  return {...source,sampling:sampling(source.sampling),seams};
}

function sceneMaterials(K, raw, row) {
  const registry=K.authoring.tilesets.prepare(raw.tilesets,raw.tilesetDefaults), active=new Map();
  for (const material of row.materials ?? []) active.set(material.id,material);
  for (const bake of row.bakes ?? []) if (!bake.invalidated)
    active.set(bake.material,{...active.get(bake.material),id:bake.material,...bake.maps});
  return Array.from(active.values(),material=>{
    const value=material.color ?? 0xffffff, loaded=registry.resolve(material.texture);
    const color=[value >> 16,value >> 8 & 255,value & 255].map(fromSRGBByte);
    const texture=loaded ?? (material.texture?.pixels && {
      ...material.texture,pixels:Uint8Array.from(material.texture.pixels)
    });
    return {id:material.id,color,
      ...(texture && {texture}),
      ...(typeof material.roughness==='number' && {roughness:material.roughness}),
      ...(typeof material.metalness==='number' && {metallic:material.metalness})};
  });
}

function receiver(target, directory, K) {
  const file=path.resolve(directory,target.receiver), {value:raw,sha256}=read(file);
  let doc, materials;
  if (raw?.topologyMeshes) {
    need(filename(target.object) && Object.hasOwn(raw.topologyMeshes,target.object),'choose a retained scene object');
    const row=raw.topologyMeshes[target.object];
    doc=K.meshTopology.create(row.document);
    materials=sceneMaterials(K,raw,row);
  } else {
    need(target.object===undefined && raw?.format==='ink-studio/mesh-topology','use retained topology or a named scene object');
    doc=K.meshTopology.create(raw);
  }
  const revision=K.meshTopology.revision(doc);
  need(target.revision===undefined || target.revision===revision,'receiver revision changed for '+target.id);
  need(doc.faces.length>=1 && doc.faces.length<=12000,'receiver face budget exceeded');
  const channels=UV.resolve(doc.uvBindings,'pigment'), model=K.model.fromTopology(doc,{materials});
  const {uvs,uvSets}=model;
  let layout, layoutHash;
  if (target.layout) {
    const {value,sha256}=read(path.resolve(directory,target.layout),8*1024*1024);
    layoutHash=sha256;
    if (value?.format==='ink-studio/uv-layout-bundle') {
      const rows=value.meshes?.filter(row=>row.object===(target.object ?? null));
      need(value.version===1 && rows?.length===1,'layout bundle must contain the receiver exactly once');
      layout=rows[0].layout;
    } else layout=value;
    need(layout?.format==='ink-studio/uv-tile-layout' && layout.version===1 && layout.mesh===doc.id &&
      layout.revision===revision && UV.layout(layout.uvSet) &&
      Array.isArray(layout.tiles) && layout.tiles.length>=1 && layout.tiles.length<=32,'UV layout does not match the receiver revision');
  }
  const selector=target.uvSet ?? layout?.uvSet ?? channels;
  const set=UV.resolve(doc.uvBindings,selector), destination=set ? uvSets?.[set] : uvs;
  const pigment=channels ? uvSets?.[channels] : uvs;
  need((!layout || layout.uvSet===set) && destination && pigment,'receiver needs the requested authored UV layout');
  const chart=K.meshTopology.uv.inspect(doc,set), cornerById=new Map(chart.corners.map(row=>[row.id,row]));
  const triangles=K.meshTopology.triangulate(doc).triangleSources;
  need(triangles.length<=24000 && triangles.length===model.faces.length,'receiver triangle budget exceeded');
  if (!model.cornerNormals) {
    const {V}=K, vertex=model.points.map(()=>[0,0,0]);
    const geometry=model.faces.map(face=>{
      const [a,b,c]=face.map(i=>model.points[i]), cross=V.cross(V.sub(b,a),V.sub(c,a));
      for(const i of face)vertex[i]=V.add(vertex[i],cross);
      return V.norm(cross);
    });
    model.cornerNormals=model.faces.map((face,i)=>face.map(v=>V.norm(vertex[v],geometry[i])));
  }
  return {doc, model, layout, layoutHash, set, revision, sha256, destination, pigment, chart, cornerById, triangles};
}

function makePages(entry, settings, pins, palette) {
  const {doc,model,layout,chart,destination,pigment,set}=entry, atFace=new Map(), tileKeys=new Set(), materialPage=new Set();
  const materialOf=new Map(doc.faces.map(row=>[row.id,row.material]));
  const tiles=layout?.tiles ?? [{at:[0,0],faces:doc.faces.map(row=>row.id)}];
  const allByFace=new Map(doc.faces.map(row=>[row.id,[]]));
  model.faceIds.forEach((id,i)=>allByFace.get(id).push(i));
  const pages=tiles.map(tile=>{
    need(tile && pair(tile.at,n=>integer(n,0,31)) && !tileKeys.has(tile.at.join('/')) && Array.isArray(tile.faces) &&
      tile.faces.length>=1 && (!layout || typeof tile.material==='string' && !materialPage.has(tile.material) &&
      pair(tile.size,n=>integer(n,2,2048))), 'invalid or duplicate UV page');
    tileKeys.add(tile.at.join('/'));
    if(layout)materialPage.add(tile.material);
    const members=[];
    for(const face of tile.faces) {
      need(materialOf.has(face) && !atFace.has(face) && (!layout || materialOf.get(face)===tile.material), 'UV page faces do not match the receiver');
      atFace.set(face,tile.at.join('/'));
      members.push(...allByFace.get(face));
    }
    members.sort((a,b)=>a-b);
    const minSize=layout ? Math.max(...tile.size) : 128;
    const size=settings.size==='sheet' ? 2**Math.max(5,Math.ceil(Math.log2(minSize))) : settings.size;
    need(allowedSizes.includes(size) && (!layout || size>=minSize) && settings.padding<size/2,
      'export canvas cannot hold authored tile texels and padding');
    const toUV=layout ? uv=>uv.map((n,k)=>(n*(tile.size[k]-1)+.5)/size) : uv=>uv.slice();
    const {uvSets,uvBindings,uvCutsBySet,uvCuts,cornerNormals,faces,uvs,faceIds,faceMaterials,...shared}=model;
    const edgeKey=(a,b)=>a<b ? a+'/'+b : b+'/'+a;
    const edges=new Set();
    for(const i of members) for(const [j,v] of faces[i].entries())edges.add(edgeKey(v,faces[i][(j+1)%3]));
    const pageModel={...shared,name:doc.id+' / '+tile.at.join(','),faces:members.map(i=>faces[i]),
      uvs:members.map(i=>destination[i].map(toUV)),faceIds:members.map(i=>faceIds[i]),
      faceMaterials:members.map(i=>faceMaterials[i]),...(cornerNormals && {cornerNormals:members.map(i=>cornerNormals[i])}),
      uvCuts:(set ? uvCutsBySet?.[set] : uvCuts)?.filter(pair=>edges.has(edgeKey(...pair))) ?? []};
    const localPins=pins.filter(pin=>pin.tile===undefined ? tiles.length===1 : pin.tile.join('/')===tile.at.join('/'))
      .map(({id,swatch,at,uv})=>({id,swatch,at: at ?? toUV(uv).map(n=>Math.min(size-1,Math.floor(n*size)))}));
    if(palette)Palette.page(palette,localPins,size);
    const rigid=chart.corners.filter(row=>row.pinned && atFace.get(row.face)===tile.at.join('/')).map(row=>({
      id:row.id,face:row.face,authored:row.uv,export:toUV(row.uv),
      ...(layout && {texel:UV.texel(row.uv,...tile.size)})}));
    return {at:tile.at,material:tile.material ?? null,nativeSize:layout ? tile.size : [size,size],size,padding:settings.padding,
      toUV,faces:tile.faces,model:pageModel,options:{size,padding:settings.padding,
        pigmentUVs:members.map(i=>pigment[i]),...(palette && {palette,pins:localPins})},pins:rigid,palettePins:localPins};
  });
  need(atFace.size===doc.faces.length,'UV pages must cover every receiver face');
  need(pins.length===pages.reduce((n,row)=>n+row.palettePins.length,0),'each palette pin must name exactly one receiver tile');
  return pages;
}

function palettePins(raw, palette) {
  need(Array.isArray(raw) && raw.length<=4096 && (!raw.length || palette),'palette pins need a palette and bounded list');
  const names=new Set();
  for(const pin of raw) {
    need(record(pin,['id','swatch','at','uv','tile']) && id(pin.id) && !names.has(pin.id) &&
      palette.identifiers.has(pin.swatch) && (pin.at===undefined)!==(pin.uv===undefined) &&
      (pin.at===undefined ? pair(pin.uv,x=>finite(x,0,1)) : pair(pin.at,x=>integer(x,0,2047))) &&
      (pin.tile===undefined || pair(pin.tile,x=>integer(x,0,31))), 'invalid or duplicate palette pin');
    names.add(pin.id);
  }
  return raw;
}

function targetPlan(target, directory, chosen, palette, studio, K, loadSource, budget) {
  const entry=receiver(target,directory,K), settings=sampling(target.sampling,chosen.sampling);
  const pins=palettePins(target.pins ?? [],palette), pages=makePages(entry,settings,pins,palette);
  const protect=target.protectPigment ?? [], ids=new Set(entry.model.faceIds);
  need(Array.isArray(protect) && new Set(protect).size===protect.length && protect.every(id=>ids.has(id)),
    'protected pigment needs distinct receiver face IDs');
  const file=path.resolve(directory,target.source.file);
  const detailed=loadSource(file);
  const source={kind:'mesh', model:detailed.model,
    part:target.source.part ?? target.part, ...(target.source.faceParts && {faceParts:target.source.faceParts})};
  const { cage,direction,minFacing,maxWork,channels }=settings;
  const detail={mesh:0,source,part:target.part,front:cage.front ?? 1, back:cage.back ?? 0,direction,minFacing,maxWork,
    ...(channels && {channels})};
  const fixed=cage.front!==undefined || cage.back!==undefined, {V}=K, bounds=K.procedural.spatial.boxOf(entry.model.points);
  for (const page of pages) {
    budget.pages++;
    budget.texels+=page.size**2;
    budget.rayChecks+=maxWork;
  }
  budget.sourceFaces+=source.model.faces.length*pages.length;
  if (!fixed) budget.rayChecks+=maxWork;
  need(budget.pages<=32 && budget.texels<=8*1024*1024 && budget.rayChecks<=320000000 &&
    budget.sourceFaces<=1000000,'batch exceeds its page, texel, ray or source geometry budget');
  const diag=V.dist(bounds.min,bounds.max), search=cage.search ?? Math.max(.02, Math.min(3,diag*.22));
  const parsed=Cage.read({format:'ink-studio/material-cage-bake',version:1,receivers:[detail]}).get(0);
  const inferred=fixed ? {mode:'explicit',front:cage.front ?? 0,back:cage.back ?? 0}
    : Cage.estimate(parsed,entry.model,studio,K,{search,margin:cage.margin,maxProbes:cage.maxProbes});
  const receivers=pages.map((page,i)=>({...detail,mesh:i,front:inferred.front,back:inferred.back,
    protectPigment:protect.filter(id=>page.faces.includes(id))}));
  const info={id:target.id,part:target.part,lod:target.lod,receiver:target.receiver,receiverHash:entry.sha256,
    revision:entry.revision,uvSet:entry.set,source:target.source.file,sourceHash:detailed.sha256,
    ...(entry.layoutHash && {layoutHash:entry.layoutHash}),protectedPigment:protect,cage:inferred,
    sampling:{direction,minFacing,maxWork,channels:channels ?? names},pages:pages.map(({toUV,model,options,...row})=>row)};
  return {info,entry,pages,receivers};
}

function plan(file, studio, K) {
  const { value:input,sha256 }=read(file,4*1024*1024), directory=path.dirname(file);
  need(record(input,['format','version','preset','palette','targets']) && input.format===format &&
    input.version===1 && Array.isArray(input.targets) && integer(input.targets.length,1,16),'expected a version 1 part bake plan');
  const chosen=readPreset(input.preset ?? 'review',directory);
  const palette=input.palette===undefined ? null : Palette.compile(typeof input.palette==='string'
    ? read(path.resolve(directory,input.palette),512*1024).value : input.palette);
  need(!chosen.paletteRequired || palette,'this preset requires an ordered pixel palette');
  const ids=new Set(), pairs=new Set();
  for(const target of input.targets) {
    need(record(target,['id','part','lod','receiver','object','revision','layout','uvSet','source','sampling','pins','protectPigment']) &&
      id(target.id) && !ids.has(target.id) && id(target.part) && integer(target.lod,0,12) && filename(target.receiver) &&
      (target.layout===undefined || filename(target.layout)) && record(target.source,['file','part','faceParts']) &&
      filename(target.source.file) && path.extname(target.source.file).toLowerCase()==='.json',
    'invalid or duplicate part/LOD target');
    const key=target.part+'/'+target.lod;
    need(!pairs.has(key),'duplicate part and level of detail');
    ids.add(target.id);
    pairs.add(key);
  }
  const sources=new Map(), budget={pages:0,texels:0,rayChecks:0,sourceFaces:0};
  function loadSource(file) {
    if (!sources.has(file)) {
      const detailed=read(file);
      const model=Source.meshSource({kind:'mesh',model:detailed.value},path.dirname(file),studio,K);
      sources.set(file,{sha256:detailed.sha256,model});
    }
    return sources.get(file);
  }
  const targets=input.targets.map(target=>targetPlan(target,directory,chosen,palette,studio,K,loadSource,budget));
  return {sha256,preset:chosen,palette:palette?.asset,budget,targets};
}

module.exports={format,preset,plan,digest};
