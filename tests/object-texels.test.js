const { test } = require('node:test');
const assert = require('node:assert/strict');
const ink = require('../index.js');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const { SpriteSurface } = ink.load();

const cube = {
  points:[-1,-1,-1, -1,-1,1, 1,-1,1, 1,-1,-1, -1,1,-1, -1,1,1, 1,1,1, 1,1,-1],
  triangles:[0,1,5,0,5,4, 1,2,6,1,6,5, 2,3,7,2,7,6, 3,0,4,3,4,7,
    0,2,1,0,3,2, 4,5,6,4,6,7]
};

test('object texels tile a rigid prop and take their color from fixed cubemap rays', async () => {
  const { bakeObjectTexels } = await import('../webgl.mjs');
  const seen = new Map();
  const resolution = 5;
  const bake = bakeObjectTexels(cube, { resolution, paint({ face, x, y, point }) {
    const key = face * resolution ** 2 + y * resolution + x;
    seen.set(key, point);
    return 0x104000 + key;
  } });
  assert.equal(seen.size, 150);
  assert.equal(bake.missing, 0);
  assert.deepEqual(seen.get(12), [1,0,0]);
  assert.deepEqual(seen.get(112), [0,0,1]);
  assert(bake.points.every(Number.isFinite));
  const atlas = SpriteSurface.make(bake.width);
  const rect = atlas.reserve(bake.width,bake.height);
  atlas.meshRegion(bake,rect);
  const done = atlas.finish();
  SpriteSurface.update(done,rect,{w:bake.width,h:bake.height,rgba:bake.rgba});
  const texels = new Set();
  let area = 0;
  for (let i=0;i<done.vertices.length;i+=15) {
    const a=done.vertices.subarray(i,i+3), b=done.vertices.subarray(i+5,i+8), c=done.vertices.subarray(i+10,i+13);
    const [x,y,z]=b.map((v,k)=>v-a[k]), [u,v,w]=c.map((n,k)=>n-a[k]);
    area+=Math.hypot(y*w-z*v,z*u-x*w,x*v-y*u)/2;
    const tx=Math.floor(done.vertices[i+3]), ty=Math.floor(done.vertices[i+4]);
    texels.add(ty*done.width+tx);
    assert.equal(done.vertices[i+3],done.vertices[i+8]);
    assert.equal(done.vertices[i+3],done.vertices[i+13]);
    assert.equal(done.pixels[(ty*done.width+tx)*4+3],255);
  }
  assert(Math.abs(area-24)<1e-5);
  assert.equal(texels.size,150);
});

test('surfaces hidden from the probe keep their mesh and receive the fallback color', async () => {
  const { bakeObjectTexels } = await import('../webgl.mjs');
  const surface = {
    points:[-.7,-.7,1,.7,-.7,1,0,.7,1,-.7,-.7,2,.7,-.7,2,0,.7,2],
    triangles:[0,1,2,3,4,5]
  };
  const baked=bakeObjectTexels(surface,{resolution:8,paint:()=>0xaa1122,fallback:0x1133aa});
  assert(baked.missing>0);
  const offsets = baked.points.flatMap((z,i)=>i%3===2&&z===2?[i/3|0]:[]);
  assert(offsets.length>0);
  for (const index of offsets) {
    const x=Math.round(baked.uvs[index*2]*(baked.width-1));
    const y=Math.round(baked.uvs[index*2+1]*(baked.height-1));
    const p=(y*baked.width+x)*4;
    assert.deepEqual([...baked.rgba.slice(p,p+4)],[17,51,170,255]);
  }
});

function materialFixture({KIT,makeBuilder}, {bakeObjectTexels,editObjectTexels}) {
  const S=KIT.sceneMeshes, z=.4, inner=.32;
  const points=[-1,-1,z,1,-1,z,1,1,z,-1,1,z, -inner,-inner,z,inner,-inner,z,inner,inner,z,-inner,inner,z];
  const triangles=[0,1,5,0,5,4, 1,2,6,1,6,5, 2,3,7,2,7,6, 3,0,4,3,4,7];
  const bake=bakeObjectTexels({points,triangles},{origin:[0,0,-.4],resolution:8,
    material:()=>({pigment:0x856e59,normal:[.65,0,.76],roughness:.3,emission:0x060903}),
    fallback:()=>({pigment:0x856e59,normal:[.65,0,.76],roughness:.3,emission:0x060903})});
  const shield=S.fromObjectTexels(bake,{id:'shield',objectId:'watch',partId:'shield',materialId:'brass'});
  const skin=S.skin(shield,Array(shield.vertices).fill(0));
  const backing=S.create({id:'behind',positions:[-1,-1,-.6,1,-1,-.6,1,1,-.6,-1,1,-.6],
    uvs:[0,1,1,1,1,0,0,0],indices:[0,1,2,0,2,3],materials:[{id:'blue',color:0x284282}]});
  const view={w:88,h:72,px:1,raw:true,dither:0};
  const world=makeBuilder(42,[0x101724,0x856e59,0x284282,0xffffff]).finish({
    meshes:[shield,backing],liveSun:{direction:t=>t===0 ? [.8,0,.6] : [-.8,0,.6],
      ambient:.16,intensity:.76,shadows:false},
    cam:{target:[0,0,0],dist:5,yaw:0,pitch:0,ortho:true},fog:{start:1,max:0}});
  const mat=[0,1,0,-1,0,0,0,0,1,0,0,0];
  const pose=()=>skin.pose(mat);
  const edit=()=>S.updateObjectTexels(shield,editObjectTexels(bake,bake.cells.filter(Boolean).map(({id})=>
    ({id,pigment:0x344139,normal:[0,0,1],roughness:.9,emission:0x02cb54}))));
  return {bake,shield,edit,pose,view,world};
}

test('editable cells retain IDs, geometry, fallback material and independent channel values', async () => {
  const api=await import('../webgl.mjs'), {bake}=materialFixture(ink.load(),api);
  const cell=bake.cells.find(row=>row && !row.fallback);
  const fallback=bake.cells.find(row=>row?.fallback), id=cell.id;
  assert(fallback && bake.rgba[fallback.id*4+3]===255);
  const updated=api.editObjectTexels(bake,[{id,pigment:0x102030,normal:[0,1,0],roughness:.8,emission:0xff0102}]);
  assert.equal(updated.cells,bake.cells);
  assert.equal(updated.points,bake.points);
  assert.equal(updated.triangles,bake.triangles);
  assert.deepEqual([...updated.rgba.subarray(id*4,id*4+4)],[16,32,48,255]);
  assert.deepEqual([...updated.normal.subarray(id*4,id*4+4)],[128,255,128,255]);
  assert.equal(updated.roughness[id],204);
  assert.deepEqual([...updated.emission.subarray(id*3,id*3+3)],[255,1,2]);
  assert.deepEqual([...bake.rgba.subarray(id*4,id*4+4)],[133,110,89,255]);
  assert.throws(()=>api.editObjectTexels(bake,[{id,roughness:-1}]),/roughness/);
  assert.throws(()=>api.editObjectTexels(bake,[{id},{id}]),/distinct occupied cell/);
  assert.throws(()=>api.editObjectTexels(bake,[{id:bake.cells.indexOf(null)}]),/occupied cell/);
});

function sampleFrame(frame,points) {
  return Object.fromEntries(Object.entries(points).map(([key,[x,y]])=>{
    const offset=(y*frame.w+x)*3;
    return [key,[...frame.rgb.subarray(offset,offset+3)]];
  }));
}
const points={metal:[58,36],hole:[44,36]};

test('the directional light moves over retained texels, and rigid poses rotate their mapped normals', async () => {
  const api=await import('../webgl.mjs'), {world,view,shield,edit,pose}=materialFixture(ink.load(),api);
  const frame=options=>ink.render(world,{...view,passes:['opaque-surface','partId','emission'],...options});
  const bright=frame({t:0}), dark=frame({t:1});
  const pixel=(result,where)=>ink.pickSurface(result.passes,...points[where]);
  const a=sampleFrame(bright,points), b=sampleFrame(dark,points);
  assert(a.metal[0]>b.metal[0]+30,JSON.stringify({a,b}));
  assert.deepEqual(a.hole,[40,66,130]);
  assert.equal(pixel(bright,'metal').part,'shield');
  assert.equal(pixel(bright,'hole').object,'behind');
  assert(pixel(bright,'metal').depth<pixel(bright,'hole').depth);
  assert(pixel(bright,'metal').shadingNormal[0]>.62);
  pose();
  const moved=frame({t:0}), normal=pixel(moved,'metal').shadingNormal;
  assert(Math.abs(normal[0])<.02 && normal[1]<-.62,JSON.stringify(normal));
  assert.equal(pixel(moved,'hole').object,'behind');
  const layer=ink.load().KIT.sceneMeshes.layer(shield), rev=layer.geometryRevision;
  edit();
  const edited=frame({t:1});
  assert.equal(layer.geometryRevision,rev);
  assert.equal(pixel(edited,'metal').depth,pixel(moved,'metal').depth);
  assert.deepEqual(pixel(edited,'metal').uv,pixel(moved,'metal').uv);
  assert(sampleFrame(edited,points).metal[1]>165);
  assert(edited.passes.emission[(36*view.w+58)*3+1]>.6);
});

test('WebGL matches the software relight, rigid pose, and in-place material replacement', {
  skip:!process.env.INK_TEST_CHROME
},async()=>{
  const module=pathToFileURL(path.resolve(__dirname,'../webgl.mjs')).href;
  const api=await import(module), {world,view,pose,edit}=materialFixture(ink.load(),api);
  const read=t=>sampleFrame(ink.render(world,{...view,t}),points);
  const expected=[read(0),read(1)];
  pose(); expected.push(read(0));
  edit(); expected.push(read(1));
  const actual=require('../cli/look-webgl.js')({asyncFixture:true},materialFixture,async(kit,build,backend,input)=>{
    const {world,view,pose,edit}=build(kit,await import(input.module));
    const camera=backend(view.w,view.h,view);
    try {
      const sample=t=>{ camera.draw(world,{t,time:t}); return camera.sample(input.points); };
      const frames=[sample(0),sample(1)];
      pose(); frames.push(sample(0));
      edit(); frames.push(sample(1));
      return {frames};
    } finally { camera.close(); }
  },{module,points});
  for (const [i,row] of actual.frames.entries()) for (const key of Object.keys(points))
    assert(row[key].every((n,c)=>Math.abs(n-expected[i][key][c])<=2),JSON.stringify({i,row,expected:expected[i]}));
});
