const fs = require('node:fs');
const { deflateSync } = require('node:zlib');

async function encodeSceneryPack(id, meshes) {
  const [{ MeshoptEncoder }, { encodeKTX2BC1 }, format] = await Promise.all([
    import('../src/vendor/meshoptimizer/meshopt_encoder.mjs'), import('../src/ktx2-bc1.mjs'),
    import('../src/scenery-delivery.mjs')
  ]);
  const { magic,maxPackBytes,maxManifestBytes,maxMeshes,maxVertices,maxIndices,maxTexels }=format;
  const sceneMeshes=require('../index.js').load().KIT.sceneMeshes;
  if(typeof id!=='string'||!id.trim()||!Array.isArray(meshes)||!meshes.length||meshes.length>maxMeshes||
      new Set(meshes.map(mesh=>mesh?.id)).size!==meshes.length)
    throw new TypeError('Scenery needs a pack ID and distinctly named source meshes');
  let vertices=0, indices=0, texels=0;
  const sections=[];
  function put(bytes){sections.push(bytes);return bytes.length;}
  await MeshoptEncoder.ready;
  const rows=meshes.map(mesh=>{
    const {id,objectId=id,partId,positions,uvs,indices:triangles,faceMaterials,materials}=mesh;
    vertices+=(positions?.length??0)/3;
    indices+=triangles?.length??0;
    if(vertices>maxVertices||indices>maxIndices) throw new RangeError('Scenery exceeds the geometry budget');
    if(!Array.isArray(materials)||!materials.length||materials.length>64) throw new TypeError('Expected scenery materials');
    for(const material of materials) {
      const texture=material.texture;
      if(!texture) continue;
      if(!Number.isInteger(texture.width)||texture.width<1||texture.width>2048||
          !Number.isInteger(texture.height)||texture.height<1||texture.height>2048)
        throw new RangeError('Invalid scenery texture dimensions');
      texels+=texture.width*texture.height;
      if(texels>maxTexels) throw new RangeError('Scenery exceeds the texture budget');
    }
    const normalized=materials.map(material=>({...material,mipmaps:false}));
    const {vertices:vertexCount}=sceneMeshes.create({...mesh,materials:normalized});
    const indexCount=triangles.length, indexSize=vertexCount<=65536?2:4;
    const vertexData=new Uint8Array(vertexCount*20), indexData=new Uint8Array(indexCount*indexSize);
    const vd=new DataView(vertexData.buffer), ix=new DataView(indexData.buffer);
    for(let i=0;i<vertexCount;i++){
      for(let axis=0;axis<3;axis++) vd.setFloat32(i*20+axis*4,positions[i*3+axis],true);
      for(let axis=0;axis<2;axis++) vd.setFloat32(i*20+12+axis*4,uvs[i*2+axis],true);
    }
    for(let i=0;i<indexCount;i++) {
      if(indexSize===2) ix.setUint16(i*2,triangles[i],true);
      else ix.setUint32(i*4,triangles[i],true);
    }
    const vertexBytes=put(MeshoptEncoder.encodeVertexBuffer(vertexData,vertexCount,20));
    const indexBytes=put(MeshoptEncoder.encodeIndexSequence(indexData,indexCount,indexSize));
    const faceBytes=faceMaterials===undefined?undefined:put(deflateSync(Uint8Array.from(faceMaterials)));
    const rows=materials.map(({id,color=0xffffff,alphaCutoff=.5,texture,...extra})=>{
      if(Object.keys(extra).some(key=>key!=='mipmaps')||extra.mipmaps!==undefined&&extra.mipmaps!==false)
        throw new TypeError('Scenery delivery v1 packs base color, tint, and cutout coverage');
      if(!texture) return {id,color,alphaCutoff};
      const {width,height,indices,palette,coverage,pixels,delivery=indices?'indexed':'lossless'}=texture;
      let encoded;
      if(delivery==='ktx2'&&!indices) encoded={codec:'ktx2-bc1',length:put(encodeKTX2BC1(texture))};
      else if(delivery==='indexed'&&indices){
        const data=Buffer.alloc(indices.length*(coverage?2:1));
        data.set(indices);
        if(coverage) data.set(coverage,indices.length);
        encoded={codec:'indexed-deflate',palette,coverage:coverage!==undefined,length:put(deflateSync(data))};
      } else if(delivery==='lossless'&&!indices) encoded={codec:'rgba-deflate',length:put(deflateSync(pixels))};
      else throw new TypeError('Choose ktx2 or lossless for RGBA textures and indexed for indexed paint');
      return {id,color,alphaCutoff,texture:{width,height,...encoded}};
    });
    return {id,objectId,partId,vertexCount,indexCount,vertexBytes,indexBytes,faceBytes,materials:rows};
  });
  const manifest=Buffer.from(JSON.stringify({format:'ink-studio/scenery-pack',version:1,id,meshes:rows}));
  const header=Buffer.alloc(12);
  header.write(magic);
  header.writeUInt32LE(manifest.length,8);
  if(manifest.length>maxManifestBytes||header.length+manifest.length+sections.reduce((sum,section)=>sum+section.length,0)>maxPackBytes)
    throw new RangeError('Scenery pack exceeds its file budget');
  return Buffer.concat([header,manifest,...sections]);
}

async function readSceneryPack(file) {
  const {decodeSceneryPack,maxPackBytes}=await import('../src/scenery-delivery.mjs');
  const stat=fs.statSync(file);
  if(!stat.isFile()||stat.size>maxPackBytes) throw new RangeError('Scenery pack exceeds its file budget');
  return decodeSceneryPack(fs.readFileSync(file),{toolkit:require('../index.js').load()});
}

module.exports = { encodeSceneryPack, readSceneryPack };
