const fs = require('node:fs');
const path = require('node:path');
const { fields, record, localName, range, vector, sha } = require('./character-rig-assembly.js');
const { openPose } = require('./character-rig-solve.js');
const { pose: poseWorld } = require('./diarama-pose.js');

const planFormat='ink-studio/character-bind-plan', format='ink-studio/character-binding';
const maxPoints=140000, maxFile=48*1024**2;
const label=value=>typeof value==='string' && value.trim() && value.length<=160;
const relative=value=>typeof value==='string'&&Boolean(value.trim())&&value.length<=4096&&
  !path.isAbsolute(value)&&!path.win32.isAbsolute(value)&&!value.includes('\0');
const color=value=>typeof value==='string'&&/^#[a-f0-9]{6}$/i.test(value) ||
  Number.isSafeInteger(value)&&range(value,0,0xffffff);
const packed=value=>typeof value==='number'?value:Number.parseInt(value.slice(1),16);
const rgb=value=>[value>>16&255,value>>8&255,value&255];
const carrierTypes=['mesh','splats','proxy'];

function read(file) {
  const handle=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NONBLOCK);
  try {
    const stat=fs.fstatSync(handle);
    if (!stat.isFile() || stat.size>maxFile) throw new RangeError('Character rig file exceeds its input budget');
    const bytes=fs.readFileSync(handle);
    if (bytes.length>maxFile) throw new RangeError('Character rig file exceeds its input budget');
    return {document:JSON.parse(bytes),sha256:sha(bytes)};
  } finally { fs.closeSync(handle); }
}

function scene(value={}) {
  if (!fields(value,['palette','proxyTolerance']) || value.palette!==undefined &&
      (!Array.isArray(value.palette)||value.palette.length<2||value.palette.length>256||!Array.from(value.palette).every(color)) ||
      !range(value.proxyTolerance ?? .08,0,10)) throw new TypeError('Character scene needs a bounded palette and proxy tolerance');
  return { ...(value.palette&&{palette:value.palette.map(packed)}),proxyTolerance:value.proxyTolerance ?? .08 };
}

function materials(value) {
  if (value===undefined) return;
  if (!Array.isArray(value)||value.length<1||value.length>64||Array.from(value).some(row=>
    !fields(row,['id','color'])||!label(row.id)||!color(row.color)) || new Set(value.map(row=>row.id)).size!==value.length)
    throw new TypeError('Carrier materials need distinct IDs and RGB colors');
  return value.map(row=>({id:row.id,color:packed(row.color)}));
}

function loadCarrier(document, row, K) {
  const {id,type}=row, native=K.sceneMeshes, T=K.meshTopology;
  if (type==='splats') {
    if (row.materials!==undefined || !fields(document,['format','version','splats']) ||
        document.format!=='ink-studio/character-splats' || document.version!==1 ||
        !Array.isArray(document.splats) || document.splats.length<1 || document.splats.length>maxPoints)
      throw new TypeError('Choose a version 1 character splat asset');
    const cloud=document.splats.map(sample=>{
      if (!fields(sample,['at','normal','radius','thickness','color','opacity','material']) || !vector(sample.at) ||
          !vector(sample.normal)||K.V.len(sample.normal)<1e-8||!range(sample.radius,1e-5,100)||
          !range(sample.thickness,1e-6,100)||!color(sample.color)||!range(sample.opacity ?? 1,0,3)||
          sample.material!==undefined&&!label(sample.material)) throw new TypeError('Invalid rig splat in '+id);
      return {...sample,color:packed(sample.color),opacity:sample.opacity ?? 1};
    });
    return { cloud,points:cloud.map(sample=>sample.at) };
  }
  let mesh, topology;
  if (document?.format==='ink-studio/mesh-topology') {
    topology=T.create(document);
    if(type==='proxy') {
      const geometry=T.triangulate(topology);
      mesh=native.depthProxy({id,positions:geometry.positions,indices:geometry.indices});
    } else mesh=T.toSceneMesh(topology,{meshId:id,objectId:id,materials:materials(row.materials)});
  } else {
    const source=type==='proxy'?{...document,tmat:undefined,mats:undefined,vcol:undefined}:document;
    const geometry=K.procedural.sceneGraph.mesh(source), {pos:positions,tri:indices,uvs,normals,tmat,mats}=geometry;
    if (type==='proxy') mesh=native.depthProxy({id,positions,indices});
    else mesh=native.create({id,positions,indices,uvs:uvs ?? new Float32Array(positions.length/3*2),normals,
      faceMaterials:tmat,materials:materials(row.materials) ?? mats.map(({name,rgb})=>({id:name,
        color:rgb.reduce((hex,n)=>hex*256+Math.round(255*n),0)}))});
  }
  const {positions}=native.geometry(mesh);
  if (mesh.vertices>maxPoints) throw new RangeError('Character carrier exceeds its vertex budget');
  const points=Array.from({length:mesh.vertices},(_,i)=>Array.from(positions.subarray(i*3,i*3+3)));
  let authored;
  if (topology?.skin && type==='mesh') {
    const normalize=T.skin.normalizer(topology), vertices=new Map(topology.vertices.map(vertex=>[vertex.id,vertex]));
    authored=points.map((_,i)=>{
      const vertex=vertices.get(T.sourceVertex(mesh,i)), result=normalize(vertex.weights ?? {});
      if (result.problem) throw new RangeError('Invalid native skin weights at '+vertex.id);
      return result.weights;
    });
  }
  return {mesh,points,authored};
}

function resolveNamed(raw, rig, count=4) {
  if (!record(raw)||Object.keys(raw).length<1||Object.keys(raw).length>count ||
      Object.entries(raw).some(([id,w])=>!rig.indices.has(id)||!range(w,0,1e6)))
    throw new RangeError('Bind weights need known joints and bounded nonnegative influences');
  const rows=Object.entries(raw).filter(([,w])=>w>0).map(([id,w])=>[rig.indices.get(id),w]);
  const total=rows.reduce((n,row)=>n+row[1],0);
  if (!total) throw new RangeError('Every character carrier point needs a positive weight');
  return rows.map(([idx,w])=>[idx,w/total]);
}

function weightRows(row, model, rig, V) {
  const max=row.type==='splats'?2:4;
  if (row.joint!==undefined) {
    if (!rig.indices.has(row.joint)||['joints','influences','falloff','weights'].some(key=>row[key]!==undefined))
      throw new TypeError('A rigid carrier needs one known joint');
    return {mode:'rigid',weights:model.points.map(()=>[[rig.indices.get(row.joint),1]])};
  }
  if (row.weights!==undefined && !['auto','native'].includes(row.weights)) {
    if (!Array.isArray(row.weights)||row.weights.length!==model.points.length ||
        ['joints','influences','falloff'].some(key=>row[key]!==undefined))
      throw new RangeError('Authored weight rows need one named record per carrier point');
    return {mode:'authored',weights:row.weights.map(weights=>resolveNamed(weights,rig,max))};
  }
  const native=row.weights==='native'||row.weights===undefined&&model.authored&&
    ['joints','influences','falloff'].every(key=>row[key]===undefined);
  if(native) {
    if (!model.authored||['joints','influences','falloff'].some(key=>row[key]!==undefined))
      throw new TypeError('Native weights need a retained mesh with a skin binding');
    return {mode:'native',weights:model.authored.map(weights=>resolveNamed(weights,rig,max))};
  }
  const {joints=rig.joints.map(joint=>joint.id),influences=Math.min(2,joints.length),falloff=.08}=row;
  if (!Array.isArray(joints)||!joints.length||new Set(joints).size!==joints.length||
      !Array.from(joints).every(id=>rig.indices.has(id))||!Number.isSafeInteger(influences)||
      !range(influences,1,Math.min(max,joints.length))||!range(falloff,1e-5,100))
    throw new RangeError('Automatic binding needs named joints and a valid influence budget');
  const pool=joints.map(id=>rig.indices.get(id)), selected=new Set(pool), segments=rig.joints.map(()=>[]);
  for (const [i,joint] of rig.joints.entries()) if (joint.parent>=0&&selected.has(i)) {
    const axis=joint.offset, length=V.dot(axis,axis);
    if(length>1e-10)segments[joint.parent].push([axis,length]);
  }
  const core=falloff*falloff;
  function distance(point,index) {
    const delta=V.sub(point,rig.joints[index].at);
    let best=V.dot(delta,delta);
    for(const [axis,length] of segments[index]){
      const along=Math.max(0,Math.min(1,V.dot(delta,axis)/length)), d=V.mad(delta,axis,-along);
      best=Math.min(best,V.dot(d,d));
    }
    return best;
  }
  const weights=model.points.map(point=>{
    const picked=pool.map(index=>[index,distance(point,index)]).sort((a,b)=>a[1]-b[1]||a[0]-b[0]).slice(0,influences);
    const inverse=picked.map(([,d])=>1/(core+d)), total=inverse.reduce((sum,w)=>sum+w,0);
    return picked.map(([index],i)=>[index,inverse[i]/total]);
  });
  return {mode:'automatic',weights};
}

function buildBinding(rig, plan, directory, outputDirectory, K) {
  if (!fields(plan,['format','version','carriers','scene'])||plan.format!==planFormat||plan.version!==1||
      !Array.isArray(plan.carriers)||plan.carriers.length<1||plan.carriers.length>32)
    throw new TypeError('Use a version 1 character binding plan with 1–32 carriers');
  const names=new Set(), sources=[], rows=[];
  let total=0;
  const presentation=scene(plan.scene);
  for (const row of plan.carriers) {
    if (!fields(row,['id','type','file','joint','joints','influences','falloff','weights','materials'])||
        !localName(row.id)||names.has(row.id)||!carrierTypes.includes(row.type)||!relative(row.file)||
        row.type!=='mesh'&&row.materials!==undefined) throw new TypeError('Invalid character carrier type, name, or asset');
    names.add(row.id);
    const file=path.resolve(directory,row.file), asset=read(file), model=loadCarrier(asset.document,row,K);
    total+=model.points.length;
    if (total>maxPoints) throw new RangeError('Character bind exceeds its shared point budget');
    sources.push(file);
    const {mode,weights}=weightRows(row,model,rig,K.V), manifest=path.relative(outputDirectory,file).split(path.sep).join('/');
    rows.push({id:row.id,type:row.type,file:manifest,assetHash:asset.sha256,mode,
      ...(row.materials!==undefined&&{materials:materials(row.materials)}),weights});
  }
  return { document:{format,version:1,rig:rig.id,rigHash:rig.hash,scene:presentation,carriers:rows},sources };
}

function loadBinding(rig, source, directory, kit) {
  const {KIT:K,makeBuilder}=kit;
  if (!fields(source,['format','version','rig','rigHash','scene','carriers'])||source.format!==format||source.version!==1||
      source.rigHash!==rig.hash||!Array.isArray(source.carriers)||source.carriers.length<1||source.carriers.length>32)
    throw new RangeError('Character binding does not match the assembled rig revision');
  const presentation=scene(source.scene), names=new Set(), assets=[], rows=[];
  const inks=new Set(presentation.palette??[0x131f2b,0xbacace]);
  let total=0;
  for (const row of source.carriers) {
    if (!fields(row,['id','type','file','assetHash','mode','weights','materials'])||!localName(row.id)||names.has(row.id)||
        !carrierTypes.includes(row.type)||!relative(row.file)||!['rigid','automatic','authored','native'].includes(row.mode)||
        row.type!=='mesh'&&row.materials!==undefined) throw new TypeError('Invalid saved character carrier');
    names.add(row.id);
    const file=path.resolve(directory,row.file), asset=read(file);
    if (asset.sha256!==row.assetHash) throw new RangeError('Character rest asset changed for '+row.id);
    const model=loadCarrier(asset.document,row,K);
    total+=model.points.length;
    if(total>maxPoints) throw new RangeError('Character bind exceeds its shared point budget');
    const max=row.type==='splats'?2:4;
    if(!Array.isArray(row.weights)||row.weights.length!==model.points.length||Array.from(row.weights).some(weights=>
      !Array.isArray(weights)||weights.length<1||weights.length>max||
      Array.from(weights).some(pair=>!vector(pair,2,0,1e4)||!Number.isSafeInteger(pair[0])||
        pair[0]>=rig.joints.length||pair[1]<=0||pair[1]>1)||
      new Set(weights.map(([idx])=>idx)).size!==weights.length||
      Math.abs(weights.reduce((n,[,w])=>n+w,0)-1)>1e-7)) throw new RangeError('Invalid saved carrier weights for '+row.id);
    if(model.cloud) for(const splat of model.cloud) inks.add(splat.color);
    if(model.mesh && row.type==='mesh'){
      const {pixels}=K.sceneMeshes.layer(model.mesh);
      for(let i=0,step=4*Math.max(1,Math.ceil(pixels.length/(4*2048)));i<pixels.length&&inks.size<256;i+=step)
        if(pixels[i+3])inks.add((pixels[i]<<16)|(pixels[i+1]<<8)|pixels[i+2]);
    }
    assets.push(file);
    rows.push({...row,...model});
  }

  const palette=[...inks].slice(0,256), swatches=new Map(palette.map((pigment,i)=>[pigment,i]));
  const B=makeBuilder(1,palette), skins=[], ids=[], first=[], second=[], weights=[], meshes=[], proxies=[];
  for(const row of rows){
    const {mesh,cloud,id,type}=row;
    if (mesh) {
      skins.push(K.sceneMeshes.skin(mesh,row.weights));
      (type==='proxy'?proxies:meshes).push(mesh);
      continue;
    }
    row.start=B.count();
    for(const [i,splat] of cloud.entries()){
      const [[a],[b,w]=[a,0]]=row.weights[i], ink=splat.color, p=B.count();
      B.disc(...splat.at,splat.normal,splat.radius,splat.thickness,B.P[swatches.get(ink)] ?? rgb(ink),splat.opacity);
      B.describeSplats(p,p+1,{object:id,material:splat.material??id});
      ids.push(p);
      first.push(a);
      second.push(b);
      weights.push(w);
    }
  }
  function* points() {
    for (const row of rows) yield* row.points;
  }
  const box=K.procedural.spatial.boxOf(points()), target=K.V.lerp(box.min,box.max,.5);
  const radius=Math.max(.1,K.V.dist(box.min,box.max)/2);
  const world=B.finish({id:rig.id,meshes,
    ...(proxies.length&&{splatDepthProxies:{meshes:proxies,tolerance:presentation.proxyTolerance}}),
    cam:{target,dist:radius*3.7,yaw:-.27,pitch:.145,ortho:true},radius,dither:0,look:{splatCoverage:'continuous'}});
  const matrices=new Float32Array(rig.joints.length*12), identity=K.M.id().concat([0,0,0]);
  for(let i=0;i<rig.joints.length;i++)matrices.set(identity,i*12);
  if (ids.length) K.bones.bind(world,{ids,bid:Uint16Array.from(first),bid2:Uint16Array.from(second),
    w2:Float32Array.from(weights),M:matrices,pose(){},meshBindings:skins});

  function applyMatrices(values) {
    if (values.length!==matrices.length || !values.every(Number.isFinite))
      throw new RangeError('Character binding needs one finite matrix per joint');
    matrices.set(values);
    if (ids.length) poseWorld(world,0,{kit});
    else for(const skin of skins)skin.pose(matrices);
  }
  function apply(pose) {
    const frame=openPose(rig,pose,K);
    applyMatrices(rig.joints.flatMap(joint=>frame.joints[joint.id].matrix));
    return frame;
  }
  function snapshot() {
    const posed=world.data;
    return rows.map(({id,type,mesh,cloud,start,weights,points,mode})=>{
      const data=mesh?K.sceneMeshes.geometry(mesh):null;
      const positions=data ? Array.from(data.positions) : cloud.flatMap((_,i)=>{
        const at=(start+i)*16;
        return Array.from(posed.subarray(at,at+3));
      });
      const after=Array.from({length:positions.length/3},(_,i)=>positions.slice(i*3,i*3+3));
      const bounds=K.procedural.spatial.boxOf(after), restBounds=K.procedural.spatial.boxOf(points);
      const moved=after.reduce((n,p,i)=>n+Number(K.V.dist(p,points[i])>1e-6),0);
      const evidence=[...new Set([0,Math.floor(after.length/2),after.length-1])].map(i=>({index:i,rest:points[i],posed:after[i],
        weights:weights[i].map(([j,w])=>[rig.joints[j].id,w])}));
      return {id,type,positions,...(data?{indices:Array.from(data.indices)}:{covariance:cloud.flatMap((_,i)=>{
        const at=(start+i)*16;
        return [4,5,6,8,9,10].map(offset=>posed[at+offset]);
      })}),report:{mode,points:after.length,moved,restBounds,bounds,evidence}};
    });
  }
  return {world,apply,applyMatrices,snapshot,assets};
}

module.exports={ read, buildBinding, loadBinding };
