const path = require('node:path');
const { createHash } = require('node:crypto');
const Camera = require('../src/camera-lens.js');
const TextureAddress = require('../src/texture-address.js');
const { readGraphProject } = require('./graph-project.js');
const { readRoomEnvironment } = require('./material-lighting-room.js');
const OpenPbr = require('./physical-openpbr.js');
const { construct, traceGeometry } = require('./physical-reference-geometry.js');
const { clamp,scale,luma,distribution,radians,tau } = require('./physical-reference-math.js');

const format = 'ink-studio/physical-reference';
const choices = Object.freeze({ draft:[8,2],studio:[32,4],final:[128,6] });
const mapNames=['baseColor','normal','roughness','metalness','opacity','emission'];
const record = value=>value && Object.getPrototypeOf(value)===Object.prototype;
const fields = (value,keys)=>record(value)&&Object.keys(value).every(k=>keys.includes(k));
const range = (n,lo,hi)=>Number.isFinite(n)&&n>=lo&&n<=hi;
const integer = (n,lo,hi)=>Number.isSafeInteger(n)&&range(n,lo,hi);
const vec = (v,n,lo,hi)=>Array.isArray(v)&&v.length===n&&Array.from(v).every(x=>range(x,lo,hi));
const id = v=>typeof v==='string'&&/^[a-z][\w.-]{0,63}$/i.test(v);
const text = v=>typeof v==='string'&&v.trim()&&v.length<=140&&!/[\x00-\x1f]/.test(v);
const filename = v=>typeof v==='string'&&v.trim()&&v.length<=4096&&!v.includes('\0');
const maxPaths = 16e6;

function settings(plan,override) {
  const authored=plan.settings??{}, view=plan.view??{};
  if(!fields(authored,['quality','samples','bounces','batch','denoise','seed','exposure'])||
     !fields(view,['width','height'])) throw new TypeError('Unknown physical reference settings or view fields');
  const values={...authored,...override};
  const {quality='studio',denoise='gentle',seed=1,exposure=0}=values;
  if(!Object.hasOwn(choices,quality)) throw new TypeError('Physical reference quality is draft, studio, or final');
  const {width=view.width??256,height=view.height??176,samples=choices[quality][0],
    bounces=choices[quality][1],batch=Math.min(samples||1,16)}=values;
  if(!integer(width,8,1024)||!integer(height,8,1024)||width*height>800000||
     !integer(samples,0,1024)||width*height*samples>maxPaths||!integer(bounces,0,12)||
     !integer(batch,1,1024)|| (samples>0 && Math.ceil(samples/batch)>64) ||
     !['off','gentle','strong'].includes(denoise)||!integer(seed,0,0xffffffff)||!range(exposure,-12,12))
    throw new RangeError('Physical reference exceeds its dimensions, sample, batch, exposure, or bounce budget');
  return {width,height,quality,samples,bounces,batch,denoise,seed,exposure};
}

function camera(value={}, {width,height}) {
  if(!fields(value,['target','yaw','pitch','distance','focalLength','sensorHeight','projection','framing']))
    throw new TypeError('Unknown physical reference camera fields');
  const {target=[0,0,0],yaw=16,pitch=13,distance=6,focalLength=37,sensorHeight=24,
    projection='perspective',framing=[.5,.5]}=value;
  if(!vec(target,3,-1e4,1e4)||!range(yaw,-360,360)||!range(pitch,-88,88)||
     !range(distance,.05,1e4)||!range(focalLength,8,500)||!range(sensorHeight,8,80)||
     !['perspective','orthographic'].includes(projection)||!vec(framing,2,.05,.95))
    throw new RangeError('Physical reference camera is outside its supported lens or framing range');
  const a=radians(yaw), b=radians(pitch), fov=Camera.fieldOfView(focalLength,sensorHeight);
  const composed=Camera.target({target,dist:distance,yaw:a,pitch:b,fov,composition:framing},width/height);
  const pose=Camera.orbitPose(a,b,distance,composed), ortho=projection==='orthographic';
  const focal=height*.5/Math.tan(fov*.5)/(ortho?distance:1);
  return {config:{target,yaw,pitch,distance,focalLength,sensorHeight,projection,framing},
    ray:Camera.rays(Camera.matrix(pose),pose.eye,width,height,focal,ortho)};
}

function meshRows(meshes,baseDir) {
  if(!Array.isArray(meshes)||!integer(meshes.length,1,128)) throw new TypeError('Physical reference needs 1–128 meshes');
  const rows=Array.from(meshes, row=>{
    if(!fields(row,['id','kind','file','material','slots','position','rotation','scale','uvSet'])||
       !id(row.id)||!['mesh','ink','sphere','plane','cube'].includes(row.kind))
      throw new TypeError('Expected a named physical reference mesh or procedural carrier');
    const {position=[0,0,0],rotation=[0,0,0],scale=[1,1,1]}=row;
    const imported=['mesh','ink'].includes(row.kind);
    if(imported!==Boolean(row.file)||imported&&!filename(row.file)||
       row.uvSet!==undefined&&(!imported||!integer(row.uvSet,0,31))||
       row.slots!==undefined&&(!imported||!record(row.slots)||!Object.values(row.slots).every(id))||
       row.material!==undefined&&!id(row.material)||row.material===undefined&&row.slots===undefined||
       !vec(position,3,-1e4,1e4)||!vec(rotation,3,-360,360)||!vec(scale,3,.001,1e4))
      throw new TypeError('Mesh needs a valid transform, source, and material or slot bindings');
    return {...row,position,rotation,scale,...(imported&&{file:path.resolve(baseDir,row.file)})};
  });
  if(new Set(rows.map(row=>row.id)).size!==rows.length) throw new RangeError('Duplicate physical reference mesh ID');
  return rows;
}

function mapSampler(P,image,name,identity,budget) {
  if(!P.graphImages.valid(image)||!P.materialChannels.validMap(name,image))
    throw new TypeError('Physical reference '+name+' requires a compatible typed image');
  const color=name==='baseColor'||name==='emission', {width,height}=image.raster;
  budget.texels+=width*height;
  if(budget.texels>10e6) throw new RangeError('Physical reference maps exceed the 10-million-texel budget');
  if(name==='normal' && image.descriptor.normalSpace==='world') throw new TypeError('Use tangent-space normals for physical reference materials');
  const prepared=color?P.graphImages.convert(image,{intent:'color',colorSpace:'srgb-linear',precision:'float32',
    alpha:image.descriptor.alpha==='none'?'none':'straight'}):image;
  const {raster:{data,channels},descriptor:d}=prepared;
  const divisor=({unorm8:255,unorm16:65535})[d.precision]??1;
  const pixels=new Float32Array(width*height*4);
  let brightness=0;
  for(let i=0,p=0;i<data.length;i+=channels,p+=4) {
    const opacity=d.alpha==='none'?1:data[i+channels-1]/divisor;
    for(let c=0;c<Math.min(3,channels);c++) {
      let f=data[i+c]/divisor;
      if(name==='normal') {
        if(d.alpha==='premultiplied') f=opacity?f/opacity:(c===2?1:0);
        if(d.domain==='unit') f=f*2-1;
        if(c===1&&d.normalOrientation==='directx') f=-f;
      } else if(color) f=clamp(f,0,name==='emission'?1e4:1)*opacity;
      else f=clamp(f);
      pixels[p+c]=f;
    }
    pixels[p+3]=opacity;
    if(name==='emission') brightness+=luma(pixels.subarray(p,p+3));
  }
  identity.update(JSON.stringify([name,width,height,d])).update(Buffer.from(pixels.buffer));
  const sample=TextureAddress.sampler(pixels,width,height,TextureAddress.settings({
    filter:d.sampling,edgeU:d.tiling.u,edgeV:d.tiling.v
  }));
  const work=[0,0,0,0];
  return { brightness:brightness/(width*height), read:([u,v])=>{ sample(u,v,work); return work; } };
}

async function graphMaps(spec,baseDir,toolkit,onFile) {
  if(!fields(spec,['file','output','maps','instance','inputs','time','seed'])||!filename(spec.file)||
    (spec.output===undefined)===(spec.maps===undefined)||spec.output!==undefined&&!id(spec.output)||
    spec.maps!==undefined&&(!fields(spec.maps,mapNames)||!Object.keys(spec.maps).length||Object.values(spec.maps).some(row=>
      !fields(row,['output','map'])||Object.keys(row).length!==1||!id(row.output??row.map)))||
    spec.instance!==undefined&&!id(spec.instance)||spec.inputs!==undefined&&!record(spec.inputs)||
    spec.time!==undefined&&!Number.isFinite(spec.time)||spec.seed!==undefined&&!Number.isSafeInteger(spec.seed))
    throw new TypeError('Bind a material graph file and either one output or explicit map watches');
  const f=path.resolve(baseDir,spec.file);
  onFile(f);
  const project=readGraphProject(f,{kit:toolkit,instance:spec.instance});
  const run=Object.fromEntries(['inputs','time','seed'].filter(key=>Object.hasOwn(spec,key)).map(key=>[key,spec[key]]));
  const result=await project.previewFrame(spec.maps??{material:{output:spec.output}},run,{encodeArtifacts:false});
  for(const file of project.sourceFiles()) onFile(file);
  if(!result.report.passed) throw new RangeError('Graph assertions failed in physical reference material');
  if(spec.maps) return {maps:result.values};
  const P=toolkit.KIT.procedural, output=result.values.material;
  if(output?.format===P.openPbr.format) return {openPbr:P.openPbr.read(output)};
  const maps=P.materialChannels.valid(output)?
    Object.fromEntries(mapNames.filter(name=>output.channels[name]).map(name=>[name,output.channels[name].raster])) :
    {baseColor:output};
  return {maps};
}

async function loadMaterials(value,baseDir,toolkit,onFile,identity) {
  if(!record(value)||!integer(Object.keys(value).length,1,128)) throw new TypeError('Physical reference needs named materials');
  const output=new Map(), budget={texels:0}, P=toolkit.KIT.procedural;
  for(const [name,row] of Object.entries(value)) {
    if(!id(name)||!fields(row,['baseColor','roughness','metalness','emission','twoSidedEmission','opacity','cutoff','glass','graph','openPbr']))
      throw new TypeError('Unknown physical reference material fields for '+name);
    const graph=row.graph?await graphMaps(row.graph,baseDir,toolkit,onFile):{};
    if (Object.hasOwn(row,'openPbr') || graph.openPbr) {
      const source=graph.openPbr?'graph':'openPbr';
      if (Object.keys(row).length!==1 || !record(row[source]))
        throw new TypeError('OpenPBR material '+name+' needs exactly one source: openPbr values or an OpenPBR graph output');
      const packet=graph.openPbr??P.openPbr.define(row.openPbr);
      output.set(name,OpenPbr.material(P,packet,name,output.size+1,identity,budget));
      continue;
    }
    const {baseColor=row.graph?[1,1,1]:[.64,.64,.64],roughness=.45,metalness=0,emission=[0,0,0],
      opacity=1,cutoff=.5,twoSidedEmission=false}=row;
    if(!vec(baseColor,3,0,1)||!range(roughness,0,1)||!range(metalness,0,1)||!vec(emission,3,0,1e4)||
       !range(opacity,0,1)||!range(cutoff,0,1)||typeof twoSidedEmission!=='boolean')
      throw new RangeError('Material values are outside their linear PBR range for '+name);
    let glass;
    if(row.glass!==undefined) {
      if(!fields(row.glass,['ior','absorption'])||!range(row.glass.ior??1.5,1.001,3)||!vec(row.glass.absorption??[0,0,0],3,0,100))
        throw new RangeError('Glass needs an IOR of 1.001–3 and RGB absorption coefficients');
      glass={ior:row.glass.ior??1.5,absorption:row.glass.absorption??[0,0,0]};
    }
    identity.update(JSON.stringify([name,baseColor,roughness,metalness,emission,opacity,cutoff,twoSidedEmission,glass]));
    const mapRows=graph.maps??{};
    const maps=Object.fromEntries(Object.entries(mapRows).map(([key,image])=>[key,mapSampler(toolkit.KIT.procedural,image,key,identity,budget)]));
    function visible(uv) {
      const coverage=opacity*(maps.opacity?.read(uv)[0]??1)*(maps.baseColor?.read(uv)[3]??1);
      return coverage>0&&coverage>=cutoff;
    }
    function emitted(uv) {
      const radiance=maps.emission?.read(uv);
      return radiance ? emission.map((n,i)=>n+radiance[i]) : emission;
    }
    function at(uv) {
      const rgb=maps.baseColor?.read(uv), normal=maps.normal?.read(uv).slice(0,3);
      return { color:rgb?baseColor.map((n,i)=>rgb[3]?n*rgb[i]/rgb[3]:0):baseColor,
        roughness:maps.roughness?.read(uv)[0]??roughness, metalness:maps.metalness?.read(uv)[0]??metalness,
        emission:emitted(uv), normal, glass };
    }
    output.set(name,{id:output.size+1,name,visible,at,emitted,twoSidedEmission,weight:luma(emission)+(maps.emission?.brightness??0)});
  }
  return output;
}

function environment(value={},baseDir,onFile,identity) {
  if(!fields(value,['color','file','strength','rotation','background'])) throw new TypeError('Unknown reference environment fields');
  const {color=[.11,.13,.17],strength=1,rotation=0,background=true}=value;
  if(!vec(color,3,0,1e4)||!range(strength,0,100)||!range(rotation,-360,360)||typeof background!=='boolean'||
    value.file!==undefined&&!filename(value.file)) throw new RangeError('Invalid linear environment or HDRI settings');
  identity.update(JSON.stringify([color,strength,rotation,background,Boolean(value.file)]));
  const black=[0,0,0];
  if(!value.file) {
    const rgb=scale(color,strength);
    return {background,eval:()=>rgb,pdf:()=>1/(4*Math.PI),sample:rng=>{
      if(!luma(rgb)) return null;
      const y=2*rng()-1,phi=tau*rng(),r=Math.sqrt(1-y*y);
      return {dir:[r*Math.sin(phi),y,r*Math.cos(phi)],radiance:rgb,pdf:1/(4*Math.PI)};
    }};
  }
  const file=path.resolve(baseDir,value.file);
  onFile(file);
  const {width,height,pixels}=readRoomEnvironment(file);
  identity.update(JSON.stringify([width,height])).update(pixels);
  const transform=radians(rotation), cos=Math.cos(transform),sin=Math.sin(transform);
  const unitY=Float64Array.from({length:height+1},(_,i)=>Math.cos(i*Math.PI/height));
  const area=i=>tau/width*(unitY[i]-unitY[i+1]);
  const linear=new Float32Array(pixels.length), weights=new Float64Array(width*height);
  let brightness=0;
  for(let i=0;i<pixels.length;i+=4) {
    const magnitude=pixels[i+3]?2**(pixels[i+3]-136)*strength:0;
    for(let c=0;c<3;c++) linear[i+c]=pixels[i+c]*magnitude;
    const row=Math.floor(i/(4*width)), weight=luma(linear.subarray(i,i+3))*area(row);
    weights[i/4]=weight; brightness+=weight;
  }
  if(brightness) for(let p=0;p<weights.length;p++) weights[p]+=.01*brightness/(4*Math.PI)*area(Math.floor(p/width));
  const sampler=TextureAddress.sampler(linear,width,height,TextureAddress.settings({filter:'linear',edgeU:'wrap'}));
  const cdf=distribution(weights), work=[0,0,0,0];
  function uv(d) {
    return [.5+Math.atan2(cos*d[0]-sin*d[2],sin*d[0]+cos*d[2])/tau,Math.acos(clamp(d[1],-1,1))/Math.PI];
  }
  function radiance(u,v) {
    sampler(u,v,work);
    return work.slice(0,3);
  }
  return {background,eval:dir=>brightness?radiance(...uv(dir)):black,pdf:dir=>{
    const [u,v]=uv(dir), y=Math.min(height-1,Math.floor(v*height));
    return cdf.pdf(y*width+(Math.floor(u*width)%width))/area(y);
  },sample:rng=>{
    if(!brightness) return null;
    const p=cdf.pick(rng()), y=Math.floor(p/width), x=p%width, u=(x+rng())/width;
    const heightY=unitY[y]+(unitY[y+1]-unitY[y])*rng();
    const phi=(u-.5)*tau+transform, r=Math.sqrt(Math.max(0,1-heightY*heightY));
    return {dir:[r*Math.sin(phi),heightY,r*Math.cos(phi)],
      radiance:radiance(u,Math.acos(heightY)/Math.PI),pdf:cdf.pdf(p)/area(y)};
  }};
}

function points(rows=[]) {
  if(!Array.isArray(rows)||rows.length>32) throw new TypeError('Physical reference supports up to 32 point lights');
  return Array.from(rows,row=>{
    if(!fields(row,['position','intensity'])||!vec(row.position,3,-1e4,1e4)||!vec(row.intensity,3,0,1e5))
      throw new TypeError('Point lights need XYZ position and nonnegative linear RGB intensity');
    return row;
  });
}

async function prepare(plan,override,baseDir,toolkit,onFile) {
  if(!fields(plan,['format','version','label','view','settings','camera','meshes','materials','environment','lights','metersPerUnit'])||
    plan.format!==format||plan.version!==1||!text(plan.label))
    throw new TypeError('Expected a labeled version 1 physical reference plan');
  const metersPerUnit=plan.metersPerUnit??.01;
  if (!range(metersPerUnit,1e-9,1e9)) throw new RangeError('Physical reference metersPerUnit must be between 1e-9 and 1e9');
  const options=settings(plan,override), lens=camera(plan.camera,options);
  const {width,height,bounces,seed}=options, lights=points(plan.lights);
  const identity=createHash('sha256').update(JSON.stringify([format,1,width,height,bounces,seed,lens.config,lights]));
  if (metersPerUnit!==.01) identity.update(JSON.stringify({metersPerUnit}));
  const rows=meshRows(plan.meshes,baseDir);
  const materials=await loadMaterials(plan.materials,baseDir,toolkit,onFile,identity);
  const sky=environment(plan.environment,baseDir,onFile,identity);
  const triangles=construct(rows,materials,toolkit,onFile,identity), geometry=traceGeometry(triangles);
  return {label:plan.label,options,lens,geometry,triangles,sky,lights,materials,metersPerUnit,signature:identity.digest('hex')};
}
module.exports = { format,prepare };
