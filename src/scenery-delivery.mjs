import { MeshoptDecoder } from './vendor/meshoptimizer/meshopt_decoder.mjs';
import { readKTX2BC1, decodeBC1 } from './ktx2-bc1.mjs';

export const magic = 'INKSCN01';
export const maxPackBytes = 64 * 1024 ** 2;
export const maxMeshes = 32;
export const maxVertices = 250000;
export const maxIndices = 750000;
export const maxTexels = 4194304;
export const maxManifestBytes = 1024 ** 2;
const count = (n, max) => Number.isInteger(n) && n > 0 && n <= max;
const id = value => typeof value === 'string' && Boolean(value.trim());

async function inflate(bytes, expected) {
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate')).getReader();
  const output = new Uint8Array(expected);
  let offset = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (offset + value.length > expected) throw new RangeError('Scenery payload exceeded its decoded size');
      output.set(value, offset);
      offset += value.length;
    }
    if (offset !== expected) throw new RangeError('Scenery payload has the wrong decoded size');
    return output;
  } finally {
    await reader.cancel();
  }
}

export async function decodeSceneryPack(bytes, { toolkit } = {}) {
  const sceneMeshes = toolkit?.KIT?.sceneMeshes ?? toolkit?.sceneMeshes;
  if (!sceneMeshes) throw new TypeError('Supply the Ink toolkit to build scenery meshes');
  if (!(bytes instanceof Uint8Array) || bytes.length < 12 || bytes.length > maxPackBytes ||
      !Array.from(magic).every((c,i)=>c.charCodeAt(0)===bytes[i]))
    throw new TypeError('Expected a v1 Ink scenery pack');
  const input = new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const manifestLength = input.getUint32(8,true), base = 12 + manifestLength;
  if (!count(manifestLength,maxManifestBytes) || base >= bytes.length) throw new RangeError('Invalid scenery manifest length');
  const { format, version, id:sceneId, meshes: rows } = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(12,base)));
  if (format !== 'ink-studio/scenery-pack' || version !== 1 || !id(sceneId) || !Array.isArray(rows) ||
      !count(rows.length,maxMeshes) || new Set(rows.map(row=>row?.id)).size !== rows.length)
    throw new TypeError('Invalid scenery pack manifest');

  let cursor = base, vertices = 0, indices = 0, texels = 0;
  const section = size => {
    if (!count(size,bytes.length-cursor)) throw new RangeError('Invalid scenery section length');
    const data=bytes.subarray(cursor,cursor+size);
    cursor+=size;
    return data;
  };
  const records = rows.map(row => {
    const { id:meshId, objectId, partId, vertexCount, indexCount, vertexBytes, indexBytes, faceBytes, materials } = row;
    if (!id(meshId) || !id(objectId) || partId!==undefined&&!id(partId) ||
        !count(vertexCount,maxVertices) || !count(indexCount,maxIndices) || indexCount%3 ||
        !Array.isArray(materials) || !count(materials.length,64) || !faceBytes&&materials.length!==1 ||
        new Set(materials.map(material=>material?.id)).size!==materials.length)
      throw new RangeError('Invalid scenery mesh record');
    vertices+=vertexCount;
    indices+=indexCount;
    if(vertices>maxVertices||indices>maxIndices) throw new RangeError('Scenery exceeds the geometry budget');
    const vertex=section(vertexBytes), index=section(indexBytes), faces=faceBytes===undefined ? undefined : section(faceBytes);
    const textures = materials.map(material => {
      if (!id(material?.id) || !Number.isInteger(material.color) || material.color<0 || material.color>0xffffff ||
          !Number.isFinite(material.alphaCutoff) || material.alphaCutoff<0 || material.alphaCutoff>1)
        throw new RangeError('Invalid scenery material');
      const spec=material.texture;
      if(spec===undefined) return {material};
      const {width,height,codec,palette,coverage,length}=spec;
      if(!count(width,2048)||!count(height,2048)|| !['ktx2-bc1','rgba-deflate','indexed-deflate'].includes(codec) ||
          codec==='indexed-deflate' && (!Array.isArray(palette)||!count(palette.length,256)||
            palette.some(n=>!Number.isInteger(n)||n<0||n>0xffffff)||typeof coverage!=='boolean'))
        throw new RangeError('Invalid scenery texture record');
      texels+=width*height;
      if(texels>maxTexels) throw new RangeError('Scenery exceeds the texture budget');
      return {material, payload:section(length)};
    });
    return {row,vertex,index,faces,textures};
  });
  if(cursor!==bytes.length) throw new RangeError('Unexpected bytes after the scenery pack');
  if (!MeshoptDecoder.supported) throw new Error('Scenery mesh decoding needs WebAssembly');
  await MeshoptDecoder.ready;

  const assets=[], report=[];
  for (const {row,vertex,index,faces,textures} of records) {
    const {id,objectId,partId,vertexCount,indexCount}=row;
    const indexSize=vertexCount<=65536 ? 2 : 4;
    const vertexData=new Uint8Array(vertexCount*20), indexData=new Uint8Array(indexCount*indexSize);
    MeshoptDecoder.decodeVertexBuffer(vertexData,vertexCount,20,vertex);
    MeshoptDecoder.decodeIndexSequence(indexData,indexCount,indexSize,index);
    const vd=new DataView(vertexData.buffer), ix=new DataView(indexData.buffer);
    const positions=new Float32Array(vertexCount*3), uvs=new Float32Array(vertexCount*2), indices=new Uint32Array(indexCount);
    for(let i=0;i<vertexCount;i++) {
      for(let axis=0;axis<3;axis++) positions[i*3+axis]=vd.getFloat32(i*20+axis*4,true);
      for(let axis=0;axis<2;axis++) uvs[i*2+axis]=vd.getFloat32(i*20+12+axis*4,true);
    }
    for(let i=0;i<indexCount;i++) indices[i]=indexSize===2 ? ix.getUint16(i*2,true) : ix.getUint32(i*4,true);
    const faceMaterials=faces&&await inflate(faces,indexCount/3);
    const materials=[], textureReport=[];
    for(const {material,payload} of textures) {
      const base={id:material.id,color:material.color,alphaCutoff:material.alphaCutoff};
      if(!payload){materials.push(base);continue;}
      const {width,height,codec,palette,coverage}=material.texture, area=width*height;
      let texture, decodedBytes;
      if(codec==='ktx2-bc1') {
        const parsed=readKTX2BC1(payload);
        if(parsed.width!==width||parsed.height!==height) throw new RangeError('KTX2 dimensions disagree with the scenery record');
        const blockTexture={...parsed,blocks:Uint8Array.from(parsed.blocks)};
        texture={width,height,pixels:decodeBC1(blockTexture),blockTexture};
        decodedBytes=area*4;
      } else if(codec==='indexed-deflate') {
        decodedBytes=area*(coverage?2:1);
        const data=await inflate(payload,decodedBytes);
        texture={width,height,palette,indices:data.subarray(0,area),...(coverage&&{coverage:data.subarray(area)})};
      } else {
        decodedBytes=area*4;
        texture={width,height,pixels:await inflate(payload,decodedBytes)};
      }
      materials.push({...base,mipmaps:false,texture});
      textureReport.push({id:material.id,codec,width,height,packedBytes:payload.length,decodedBytes});
    }
    assets.push({id,objectId,partId,positions,uvs,indices,faceMaterials,materials});
    report.push({id,vertices:vertexCount,triangles:indexCount/3,
      geometry:{codec:'meshopt',packedBytes:vertex.length+index.length+(faces?.length??0),
        decodedBytes:vertexData.length+indexData.length+(faceMaterials?.length??0)},textures:textureReport});
  }
  return { id:sceneId, assets, meshes:assets.map(asset=>sceneMeshes.create(asset)),
    receipt:{format,version,id:sceneId,bytes:bytes.length,manifestBytes:base,meshes:report} };
}
