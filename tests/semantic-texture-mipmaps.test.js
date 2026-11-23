const {test}=require('node:test');
const assert=require('node:assert/strict');
const Mips=require('../src/semantic-texture-mipmaps');
const ink=require('..');

test('semantic mipmaps retain odd edges, authored swatches, and covered emission',()=>{
  const width=5,height=3, count=width*height;
  const indices=new Uint8Array(count), palette=[0x173146,0xfad045,0x00e237];
  const pigment=new Uint8Array(count*4), emission=new Uint8Array(count*3);
  for(let i=0;i<count;i++)pigment.set([23,49,70,255],i*4);
  indices[13]=1;
  pigment.set([250,208,69,255],13*4);
  indices[14]=2;
  pigment.set([0,226,55,0],14*4);
  emission.fill(255,13*3);
  const chain=Mips.build({width,height,pigment,indices,palette,emission,emissionStrength:2},
    {protect:[0xfad045],protectCoverage:.05,specular:0});
  assert.deepEqual(chain.levels.map(({width,height})=>[width,height]),[[5,3],[2,1],[1,1]]);
  const result=Mips.sample(chain,.5,.5,90);
  assert.deepEqual(result.color.map(c=>Math.round(c*255)),[250,208,69]);
  assert(Math.abs(result.coverage-14/15)<1/255);
  assert(result.emission.every(e=>Math.abs(e-2/14)<.005));
  assert.deepEqual(Mips.sample(chain,1,1).visible,false);
  const unprotected=Mips.build({width,height,pigment,indices,palette});
  assert.deepEqual(Mips.sample(unprotected,.5,.5,90).color.map(c=>Math.round(c*255)),[23,49,70]);
});

test('RGB and emission filter in linear light, and normal variance raises distant roughness',()=>{
  const width=2,height=2, pigment=Uint8Array.from([0,0,0,255,255,255,255,255,0,0,0,255,255,255,255,255]);
  const normal=Uint8Array.from([18,128,191,255,238,128,191,255,18,128,191,255,238,128,191,255]);
  const emission=Uint8Array.from([0,0,0,255,255,255,0,0,0,255,255,255]);
  const source={width,height,pigment,normal,emission,roughness:.15};
  const fine=Mips.sample(Mips.build(source),0,0,1);
  const distant=Mips.sample(Mips.build(source),0,0,3);
  const control=Mips.sample(Mips.build(source,{variance:0}),0,0,3);
  assert(fine.normal[0]<-.8);
  assert.deepEqual(distant.normal,[0,0,1]);
  assert(distant.roughness>.68 && control.roughness<.16);
  assert(distant.color.every(channel=>Math.abs(channel-.735)<.004));
  assert(distant.emission.every(channel=>Math.abs(channel-.5)<.005));
});

function fixture({KIT:K,makeBuilder}) {
  const width=64,height=64, indices=new Uint8Array(width*height), coverage=new Uint8Array(indices.length).fill(255);
  const normal=new Uint8Array(indices.length*4), emission=new Uint8Array(indices.length*3);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const i=y*width+x;
    indices[i]=x%4===0&&y%4===0?2:(x+y)%2;
    if(x>37 && x<54)coverage[i]=0;
    normal.set([(x+y)%2?238:18,128,191,255],i*4);
    if(x%2===0)emission[i*3+2]=74;
  }
  const mesh=K.sceneMeshes.create({id:'check-plate',positions:[-1,-1,0,1,-1,0,-1,1,0,1,1,0, -2,-.28,0,-1.16,-.28,0,-2,.28,0,-1.16,.28,0],
    uvs:[0,1,1,1,0,0,1,0,0,1,1,1,0,0,1,0],indices:[0,1,2,1,3,2,4,5,6,5,7,6],
    faceMaterials:[0,0,1,1],materials:[{id:'enamel',
      texture:{width,height,indices,coverage,palette:[0x29456a,0x80a798,0xffc52c]},
      roughness:.14,normal,emission,mipmaps:{protect:[0xffc52c],protectCoverage:.05,specular:0}},{id:'plain',color:0x491b53}]});
  const world=makeBuilder(17,[0x122035]).finish({meshes:[mesh],fog:{start:1,max:0},
    cam:{target:[0,0,0],dist:7,ortho:true,yaw:0,pitch:0},dither:0});
  return {world};
}
const view={w:80,h:60,px:1,raw:true,outline:false,dither:0};
const points={center:[40,30],hole:[48,29],edge:[33,31],plain:[22,30]};
const get=(image,points)=>Object.fromEntries(Object.entries(points).map(([name,[x,y]])=>
  [name,Array.from(image.rgb.subarray((y*image.w+x)*3,(y*image.w+x)*3+3))]));

test('headless selects semantic mip levels from the native pixel footprint and depth-tests cutouts',()=>{
  const {world}=fixture(ink.load());
  const mips=get(ink.render(world,view),points), base=get(ink.render(world,{...view,semanticMipmaps:false}),points);
  assert.deepEqual(mips.hole,[18,32,53]);
  assert.deepEqual(mips.plain,[73,27,83]);
  assert(mips.center[0]>245 && mips.center[1]>189,JSON.stringify(mips));
  assert.notDeepEqual(mips.center,base.center);
  assert(mips.center[2]>44); // additive linear emission from the surrounding covered texels
});

test('WebGL uploads isolated material mip chains and agrees with headless on pigment, coverage and emission',{
  skip:!process.env.INK_TEST_CHROME
},()=>{
  const headless=get(ink.render(fixture(ink.load()).world,view),points);
  const gpu=require('../cli/look-webgl.js')({},fixture,(kit,build,backend,{view,points})=>{
    const {world}=build(kit), camera=backend(view.w,view.h,view);
    try {
      camera.draw(world);
      const mips=camera.sample(points);
      camera.draw(world,{semanticMipmaps:false});
      return {mips,base:camera.sample(points)};
    } finally {camera.close();}
  },{view,points});
  for(const name of Object.keys(points))
    assert(gpu.mips[name].every((c,k)=>Math.abs(c-headless[name][k])<=2),JSON.stringify({gpu,headless}));
  assert.notDeepEqual(gpu.mips.center,gpu.base.center);
});
