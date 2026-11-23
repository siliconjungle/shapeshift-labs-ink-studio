const assert = require('node:assert/strict');
const { test } = require('node:test');
const ink = require('..');
const runWebGL = require('../cli/look-webgl.js');

const toolkit=ink.load();
const source=require('../examples/compressed-scenery.js')(toolkit);

test('scenery delivery keeps indexed geometry, paint, and decal coverage exact',async()=>{
  const sourceMeshes=source.scenery();
  const bytes=await ink.encodeSceneryPack(source.id,sourceMeshes);
  assert.deepEqual(bytes,await ink.encodeSceneryPack(source.id,sourceMeshes));
  const {decodeSceneryPack}=await import('../webgl.mjs');
  const {assets,meshes,receipt}=await decodeSceneryPack(bytes,{toolkit});
  assert.equal(receipt.bytes,bytes.length);
  const house=receipt.meshes[0];
  assert(house.geometry.packedBytes<house.geometry.decodedBytes*.45);
  assert(house.textures.every(row=>row.codec==='ktx2-bc1'&&row.packedBytes<row.decodedBytes*.14));
  for(const [i,asset] of sourceMeshes.entries()){
    const decoded=assets[i];
    assert.equal(decoded.objectId,asset.objectId);
    assert.equal(decoded.partId,asset.partId);
    assert.deepEqual(decoded.positions,Float32Array.from(asset.positions));
    assert.deepEqual(decoded.uvs,Float32Array.from(asset.uvs));
    assert.deepEqual(decoded.indices,Uint32Array.from(asset.indices));
    if(asset.faceMaterials)assert.deepEqual(decoded.faceMaterials,Uint8Array.from(asset.faceMaterials));
  }
  const sign=assets.at(-2).materials[0].texture, originalSign=sourceMeshes.at(-2).materials[0].texture;
  for(const key of ['palette','indices','coverage'])assert.deepEqual(sign[key],originalSign[key]);
  assert.deepEqual(assets.at(-1).materials[0].texture.pixels,sourceMeshes.at(-1).materials[0].texture.pixels);

  const view={w:240,h:156,px:1,raw:true,dither:0,passes:['opaque-surface']};
  const original=ink.render(source.build(),view), packed=ink.render(source.world(meshes),view);
  assert.deepEqual(packed.passes.materialId,original.passes.materialId);
  let protectedPixels=0, alteredScenery=0;
  for(let i=0;i<packed.passes.materialId.length;i++){
    const material=packed.passes.materials[packed.passes.materialId[i]];
    const a=original.rgb.subarray(i*3,i*3+3), b=packed.rgb.subarray(i*3,i*3+3);
    if(material==='indexed-tern-sign'||material==='lossless-door-decal'){
      assert.deepEqual(a,b);
      protectedPixels++;
    }
    if(material==='glazed-masonry'&&a.some((value,j)=>value!==b[j])) alteredScenery++;
  }
  assert(protectedPixels>100&&alteredScenery>100);
});

test('KTX2 header, BC1 readback, opacity and scenery payload bounds',async()=>{
  const {encodeKTX2BC1,readKTX2BC1,decodeBC1}=await import('../src/ktx2-bc1.mjs');
  const pixels=new Uint8Array(8*4*4);
  for(let i=0;i<32;i++)pixels.set(i%8<4?[255,0,0,255]:[0,255,0,255],i*4);
  const bytes=encodeKTX2BC1({width:8,height:4,pixels}), dv=new DataView(bytes.buffer);
  assert.equal(dv.getUint32(12,true),132);
  assert.equal(dv.getBigUint64(88,true),16n);
  assert.deepEqual(decodeBC1(readKTX2BC1(bytes)),pixels);
  assert.throws(()=>readKTX2BC1(bytes.subarray(0,-1)),/level index/);
  pixels[3]=0;
  assert.throws(()=>encodeKTX2BC1({width:8,height:4,pixels}),/opaque/);

  const {decodeSceneryPack}=await import('../webgl.mjs');
  const pack=await ink.encodeSceneryPack(source.id,source.scenery());
  await assert.rejects(decodeSceneryPack(pack.subarray(0,-1),{toolkit}),/section length/);
  await assert.rejects(decodeSceneryPack(Buffer.concat([pack,Buffer.from([0])]),{toolkit}),/Unexpected bytes/);
});

test('Chrome uploads BC1 blocks and decoded mesh buffers, caches them, and renders a matching RGBA fallback',
  {skip:!process.env.INK_TEST_CHROME},async()=>{
  const bytes=await ink.encodeSceneryPack(source.id,source.scenery());
  const result=runWebGL({asyncFixture:true},function build(kit,meshes){
    return kit.makeBuilder(26,[0x172933,0x1e414b,0x3d606b,0x769389,0xa6bca7,0xf4c480])
      .finish({meshes,dither:0,cam:{target:[0,1,0],dist:10.4,yaw:.40,pitch:.27,ortho:true}});
  },async(kit,build,backend,encoded)=>{
    const bytes=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));
    const pack=await kit.decodeSceneryPack(bytes,{toolkit:kit});
    const world=build(kit,pack.meshes);
    const view=backend(180,118,{raw:true,dither:0});
    try{
      const native=[], warm=[], fallback=[], edited=[];
      view.draw(world,{sceneryDeliveryFrame:row=>native.push(row)});
      const first=atob(view.image());
      view.draw(world,{sceneryDeliveryFrame:row=>warm.push(row)});
      const repeat=atob(view.image());
      view.draw(world,{sceneryBlockTextures:false,sceneryDeliveryFrame:row=>fallback.push(row)});
      const soft=atob(view.image());
      const atlas=kit.KIT.sceneMeshes.layer(pack.meshes[0]);
      atlas.pixels.fill(255);
      kit.SpriteSurface.markDirty(atlas);
      view.draw(world,{sceneryDeliveryFrame:row=>edited.push(row)});
      const repaint=atob(view.image());
      let maxError=0;
      for(let i=0;i<first.length;i++)maxError=Math.max(maxError,Math.abs(first.charCodeAt(i)-soft.charCodeAt(i)));
      return {native,warm,fallback,edited,repeatExact:first===repeat,repainted:repaint!==soft,maxError};
    }finally{view.close();}
  },bytes.toString('base64'));
  const [first]=result.native, [warm]=result.warm, [fallback]=result.fallback, [edited]=result.edited;
  assert.equal(first.blockMode,'native-bc1');
  assert.equal(first.blockBytes,(256**2+2*128**2)/2);
  assert.equal(first.textureBytes,first.blockBytes+4);
  assert(first.geometryBytes>800000);
  assert.equal(warm.textureBytes+warm.geometryBytes,0);
  assert(result.repeatExact);
  assert.equal(fallback.blockMode,'decoded-rgba');
  assert(fallback.textureBytes>=8*first.blockBytes);
  assert(result.maxError<=3);
  assert.equal(edited.blockMode,'decoded-rgba');
  assert(result.repainted);
});
