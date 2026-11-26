const fs = require('node:fs');
const path = require('node:path');
const { document,readGlb } = require('./glb-file.js');
const { readGltfAsset,writeGltfAsset } = require('./gltf-asset.js');
const PNG = require('./png.js');
const { createHash } = require('node:crypto');

const width = {SCALAR:1,VEC2:2,VEC3:3,VEC4:4};
const components = {5120:[1,'getInt8',127],5121:[1,'getUint8',255],5122:[2,'getInt16',32767],
  5123:[2,'getUint16',65535],5125:[4,'getUint32',4294967295],5126:[4,'getFloat32',1]};
const wraps = {33071:'clamp',33648:'mirror',10497:'repeat'};
const wrapIds = Object.fromEntries(Object.entries(wraps).map(([id,value])=>[value,+id]));
const defaultMatrix = [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];

function remember(file,bytes,extension) {
  const hash=createHash('sha256').update(bytes).digest('hex');
  const location=path.join(file,hash+extension);
  fs.mkdirSync(file,{recursive:true});
  if(!fs.existsSync(location))fs.writeFileSync(location,bytes);
  return location;
}

function access(doc,binary) {
  const buffer=new DataView(binary.buffer,binary.byteOffset,binary.byteLength);
  const cache=new Map(), table=doc.bufferViews??[];
  function layout(id,offset,row,count,stride=row) {
    const v=table[id], from=v?.byteOffset??0, size=v?.byteLength;
    if(!v||v.buffer!==0||![from,size,offset,stride].every(Number.isSafeInteger)||
       offset<0||stride<row||from<0||from+size>buffer.byteLength||offset+(count-1)*stride+row>size)
      throw new RangeError('A glTF accessor crosses its buffer-view bounds');
    return from+offset;
  }
  return (id,type,vertexId=false)=>{
    const a=doc.accessors?.[id], lanes=width[type], component=components[a?.componentType];
    if(!a||a.type!==type||!component||!Number.isSafeInteger(a.count)||a.count<1||a.count*lanes>5e6||
       type==='SCALAR'&&(!(vertexId?[5121,5123,5126]:[5121,5123,5125]).includes(a.componentType)||a.normalized)||
       type!=='SCALAR'&&a.componentType!==5126&&!a.normalized)
      throw new TypeError('Unsupported or invalid glTF scene accessor '+id);
    if(cache.has(id)) return cache.get(id);
    const [size,read,maximum]=component, row=lanes*size, result=new Array(a.count*lanes).fill(0);
    function unpack(start,stride,count,index) {
      for(let i=0;i<count;i++) for(let c=0;c<lanes;c++) {
        const raw=buffer[read](start+i*stride+c*size,true);
        if(!Number.isFinite(raw))throw new RangeError('Non-finite glTF vertex data');
        result[index(i)*lanes+c]=a.normalized?Math.max(-1,raw/maximum):raw;
      }
    }
    if(a.bufferView!==undefined) {
      const stride=table[a.bufferView]?.byteStride??row;
      unpack(layout(a.bufferView,a.byteOffset??0,row,a.count,stride),stride,a.count,i=>i);
    } else if(!a.sparse) throw new TypeError('Accessor needs a buffer view or sparse data');
    if(a.sparse) {
      const {count,indices,values}=a.sparse, component=components[indices?.componentType];
      if(!Number.isSafeInteger(count)||count<1||count>a.count||
         ![5121,5123,5125].includes(indices?.componentType)||!values)
        throw new TypeError('Invalid glTF sparse scene accessor');
      const [size,read]=component, at=layout(indices.bufferView,indices.byteOffset??0,size,count);
      const keys=Array.from({length:count},(_,i)=>buffer[read](at+i*size,true));
      if(keys.some((key,i)=>key>=a.count||i&&key<=keys[i-1])) throw new RangeError('Invalid glTF sparse vertex indices');
      unpack(layout(values.bufferView,values.byteOffset??0,row,count),row,count,i=>keys[i]);
    }
    cache.set(id,result);
    return result;
  };
}

function materials(doc,binary,directory,bakeAttributes) {
  const images=new Map();
  function map(info,channel) {
    if(!info) return undefined;
    const row=doc.textures?.[info.index], image=doc.images?.[row?.source], sample=doc.samplers?.[row?.sampler]??{};
    const ext=({'image/png':'.png','image/jpeg':'.jpg'})[image?.mimeType], view=doc.bufferViews?.[image?.bufferView];
    if(!ext||!view||info.extensions||row.extensions||info.scale!==undefined&&info.scale!==1||
       info.strength!==undefined&&info.strength!==1||row.sampler!==undefined&&!doc.samplers?.[row.sampler])
      throw new TypeError('Scene resources support PNG or JPEG textures with core glTF UV bindings and unit normal/AO gain');
    if(!images.has(row.source)) {
      const start=view.byteOffset??0;
      const bytes=binary.subarray(start,start+view.byteLength);
      if(ext==='.png')PNG.layout(bytes);
      if(ext==='.jpg'&&(bytes[0]!==255||bytes[1]!==216))throw new TypeError('Invalid JPEG texture signature');
      images.set(row.source,remember(directory,bytes,ext));
    }
    const u=sample.wrapS??10497,v=sample.wrapT??10497;
    if(!wraps[u]||!wraps[v])throw new TypeError('Invalid glTF texture addressing');
    return {file:images.get(row.source),uv:info.texCoord??0,channel,wrapS:wraps[u],wrapT:wraps[v]};
  }
  return (doc.materials??[]).map((m,i)=>{
    const p=m.pbrMetallicRoughness??{};
    if(m.extensions)throw new TypeError('Unsupported glTF material extensions on '+(m.name??i));
    const base=map(p.baseColorTexture,'rgb'), normal=map(m.normalTexture,'rgb'), emissive=map(m.emissiveTexture,'rgb');
    const roughness=map(p.metallicRoughnessTexture,'g'), metallic=map(p.metallicRoughnessTexture,'b'), ao=map(m.occlusionTexture,'r');
    const opacity=m.alphaMode&&m.alphaMode!=='OPAQUE'&&base?{...base,channel:'a'}:undefined;
    return {name:m.name??'Material '+(i+1),color:p.baseColorFactor??[1,1,1,1],roughness:p.roughnessFactor??1,
      metallic:p.metallicFactor??1,emission:m.emissiveFactor??[0,0,0],alphaMode:m.alphaMode??'OPAQUE',cutoff:m.alphaCutoff??.5,
      doubleSided:m.doubleSided??false,...(bakeAttributes&&{inkId:m.extras?.inkStudio?.materialId}),maps:Object.fromEntries(Object.entries({base,normal,emissive,roughness,metallic,ao,opacity}).filter(([,value])=>value))};
  });
}

function fromGltf(file,textureDir,onFile,{bakeAttributes=false}={}) {
  const asset=readGltfAsset(file,{onFile}), {document:doc,binary}=asset.snapshot();
  if(doc.animations?.length||doc.skins?.length||doc.cameras?.length||doc.extensionsRequired?.length||
     doc.nodes?.some(n=>n.extensions||n.camera!==undefined||n.weights))
    throw new TypeError('Scene resource conversion requires a static mesh scene without required glTF extensions');
  const read=access(doc,binary);
  let total=0;
  const meshes=(doc.meshes??[]).map((mesh,i)=>({name:mesh.name??'Mesh '+(i+1),parts:mesh.primitives.map(p=>{
    const {attributes={}}=p;
    if(p.mode!==undefined&&p.mode!==4||p.targets?.length||p.extensions||
       Object.keys(attributes).some(key=>!['POSITION','NORMAL','TANGENT'].includes(key)&&!/^TEXCOORD_\d+$/.test(key)&&
         !(bakeAttributes&&['COLOR_0','_INK_VERTEX_ID'].includes(key))))
      throw new TypeError('Scene resources support triangle positions, normals and UVs. Unsupported glTF vertex attributes or primitive mode.');
    // Tangents can be reconstructed by the consumer from normals and the selected UV chart.
    const position=read(attributes.POSITION,'VEC3'), count=position.length/3;
    const vertexIds=attributes._INK_VERTEX_ID===undefined?undefined:read(attributes._INK_VERTEX_ID,'SCALAR',true);
    const indices=p.indices===undefined?position.filter((_,i)=>i%3===0).map((_,i)=>i):read(p.indices,'SCALAR');
    const normal=attributes.NORMAL===undefined?undefined:read(attributes.NORMAL,'VEC3');
    const colorType=doc.accessors?.[attributes.COLOR_0]?.type;
    const color=attributes.COLOR_0===undefined?undefined:read(attributes.COLOR_0,colorType==='VEC3'?'VEC3':'VEC4');
    const uv=Object.fromEntries(Object.entries(attributes).filter(([key])=>key.startsWith('TEXCOORD_'))
      .map(([key,id])=>[key.slice(9),read(id,'VEC2')]));
    total+=indices.length;
    if(!indices.length||indices.length%3||total>1_500_000||indices.some(i=>i>=count)||
       normal&&normal.length!==position.length||vertexIds&&vertexIds.length!==count||color&&(color.length!==count*width[colorType]||color.some(n=>n<0||n>1))||
       Object.values(uv).some(row=>row.length!==count*2))
      throw new RangeError('Invalid glTF triangle indices, normal count or UV count');
    return {position,indices,...(normal&&{normal}),...(color&&{color,colorLanes:width[colorType]}),uv,material:p.material??null,
      ...(bakeAttributes&&{positionAccessor:attributes.POSITION,vertexIds,inkId:p.extras?.inkStudio?.partId,
        inkLabel:p.extras?.inkStudio?.partLabel})};
  })}));
  const active=asset.sample(), indices=new Map(active.map((row,i)=>[row.id,i]));
  const nodes=active.map(n=>({name:n.name??'Node '+n.id,parent:n.parent===null?null:indices.get(n.parent),matrix:n.local,mesh:n.mesh??null,
    ...(bakeAttributes&&{world:n.world,index:n.id})}));
  return {name:doc.scenes?.[doc.scene??0]?.name??path.basename(file,path.extname(file)),nodes,meshes,materials:materials(doc,binary,textureDir,bakeAttributes)};
}

function packing(directory,maps,keys,channels) {
  const present=keys.map(key=>maps[key]).filter(Boolean);
  if(!present.length) return null;
  const first=present[0];
  if(present.some(m=>m.uv!==first.uv||m.wrapS!==first.wrapS||m.wrapT!==first.wrapT))
    throw new TypeError('glTF cannot pack texture channels with different UV sets or wrapping');
  if(present.length===keys.length&&present.every(m=>m.file===first.file)&&keys.every((key,i)=>maps[key].channel===channels[i]))return first;
  const rasters=keys.map(key=>maps[key]&&PNG.raster(fs.readFileSync(maps[key].file)));
  const {w,h}=rasters.find(Boolean);
  if(rasters.some(r=>r&&(r.w!==w||r.h!==h))) throw new TypeError('Packed glTF map channels need matching image dimensions');
  const rgba=new Uint8Array(w*h*4).fill(255), lanes={r:0,g:1,b:2,a:3};
  for(let p=0;p<w*h;p++) for(const [i,channel] of channels.entries()) {
    if(!rasters[i])continue;
    const raster=rasters[i], source=maps[keys[i]].channel;
    if(source==='rgb')for(let c=0;c<3;c++)rgba[p*4+c]=Math.round(255*raster.data[p*4+c]/raster.max);
    else rgba[p*4+lanes[channel]]=Math.round(255*raster.data[p*4+lanes[source]]/raster.max);
  }
  return {...first,file:remember(directory,PNG.encode(w,h,rgba,4),'.png')};
}

function toGltf(scene,out,textureDir) {
  const doc=document(), {gltf}=doc, images=new Map(), textures=new Map(), samplers=new Map();
  function texture(map) {
    if(!map)return undefined;
    if(!images.has(map.file)) {
      const bytes=fs.readFileSync(map.file), ext=path.extname(map.file).toLowerCase();
      if(!['.jpg','.jpeg','.png'].includes(ext))throw new TypeError('glTF export needs PNG or JPEG texture images');
      doc.texture(bytes,path.basename(map.file),ext==='.png'?'image/png':'image/jpeg');
      const row=gltf.textures.pop();
      images.set(map.file,row.source);
    }
    const key=[map.file,map.wrapS,map.wrapT].join('\0'), flags=[map.wrapS,map.wrapT].join('\0');
    if(!samplers.has(flags)) samplers.set(flags,samplers.size);
    if(!textures.has(key)) textures.set(key,doc.add('textures',{source:images.get(map.file),sampler:samplers.get(flags)}));
    return {index:textures.get(key),...(map.uv&&{texCoord:map.uv})};
  }
  gltf.materials=scene.materials.map(m=>{
    const maps=m.maps, packed=packing(textureDir,maps,['roughness','metallic'],['g','b']);
    const base=maps.opacity ? packing(textureDir,maps,['base','opacity'],['rgb','a']) : maps.base;
    return {name:m.name,pbrMetallicRoughness:{baseColorFactor:m.color,roughnessFactor:m.roughness,metallicFactor:m.metallic,
      baseColorTexture:texture(base),metallicRoughnessTexture:texture(packed)},
      normalTexture:texture(maps.normal),emissiveTexture:texture(maps.emissive),occlusionTexture:texture(maps.ao),
      emissiveFactor:m.emission,alphaMode:m.alphaMode,alphaCutoff:m.cutoff,doubleSided:m.doubleSided};
  });
  const binding=(values,type,options)=>doc.accessor(Float32Array.from(values),type,{target:34962,...options});
  gltf.meshes=scene.meshes.map(m=>({name:m.name,primitives:m.parts.map(p=>({
    attributes:{POSITION:binding(p.position,'VEC3',{bounds:true}),...(p.normal&&{NORMAL:binding(p.normal,'VEC3')}),
      ...Object.fromEntries(Object.entries(p.uv).map(([id,values])=>['TEXCOORD_'+id,binding(values,'VEC2')]))},
    indices:doc.accessor(Uint32Array.from(p.indices),'SCALAR',{target:34963}),
    ...(p.material!==null&&{material:p.material})
  }))}));
  gltf.nodes=scene.nodes.map(n=>{
    const matrix=n.matrix??defaultMatrix, axes=[0,4,8].map(i=>matrix.slice(i,i+3));
    for(const [i,j] of [[0,1],[0,2],[1,2]]) {
      const a=axes[i], b=axes[j], dot=a.reduce((sum,v,k)=>sum+v*b[k],0);
      if(Math.abs(dot)>1e-6*Math.hypot(...a)*Math.hypot(...b))throw new TypeError('glTF needs decomposable transforms. Bake shear on '+n.name);
    }
    return {name:n.name,matrix,...(n.mesh!==null&&{mesh:n.mesh})};
  });
  for(const [i,n] of scene.nodes.entries()) {
    if(n.parent===null)gltf.scenes[0].nodes.push(i);
    else (gltf.nodes[n.parent].children??=[]).push(i);
  }
  gltf.scenes[0].name=scene.name;
  const built=readGlb(doc.finish());
  if(samplers.size)built.gltf.samplers=Array.from(samplers.keys(),key=>{
    const [u,v]=key.split('\0');
    return {wrapS:wrapIds[u],wrapT:wrapIds[v]};
  });
  return writeGltfAsset({document:built.gltf,binary:built.bin},{out});
}

module.exports={fromGltf,toGltf,remember,defaultMatrix};
