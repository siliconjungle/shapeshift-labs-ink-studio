const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const test=require('node:test');
const {document}=require('../cli/glb-file.js');
const {runBakeJob,latestBakeJob}=require('../cli/bake-jobs.js');
const {readTexture}=require('../cli/texture-files.js');
const Plan=require('../cli/bake-job-plan.js');

function fixture(t) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-output-controls-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const at=name=>path.join(dir,name),doc=document(),{gltf}=doc;
  function plate(left,right,material,z=-2) {
    const uv=[left,.19,right,.19,right,.79,left,.79];
    const rgb=material?Float32Array.of(0,0,1,0,0,1,0,0,1,0,0,1):
      Float32Array.of(.16,0,0,.16,0,0,.95,0,0,.95,0,0);
    return {material,attributes:{
      POSITION:doc.accessor(Float32Array.of(left,.19,z,right,.19,z,right,.79,z,left,.79,z),'VEC3',{bounds:true}),
      TEXCOORD_0:doc.accessor(Float32Array.from(uv),'VEC2'),COLOR_0:doc.accessor(rgb,'VEC3')},
      indices:doc.accessor(Uint16Array.of(0,1,2,0,2,3),'SCALAR')};
  }
  gltf.materials=[{name:'Red',extras:{inkStudio:{materialId:51}}},{name:'Blue',extras:{inkStudio:{materialId:87}}}];
  gltf.meshes=[{name:'Narrow seam',primitives:[plate(.11,.495,0),plate(.505,.9,1)]},
    {name:'Split tiles',primitives:[plate(.76,1,0),plate(1,1.24,1,-1)]}];
  gltf.nodes=[{mesh:0},{mesh:1}];gltf.scenes[0].nodes=[0,1];
  fs.writeFileSync(at('seam.glb'),doc.finish());
  function run(name,maps,directory=name,tiles=false) {
    const plan={format:'ink-studio/bake-job',version:1,label:name,source:'seam.glb',
      targets:[{id:'board',mesh:tiles?1:0,...(tiles&&{tiles:[1001,1002]})}],preset:{format:'ink-studio/bake-preset',version:1,label:'Output controls',
        defaults:{size:32,padding:4},maps:maps.map(([id,overrides])=>({id,overrides}))}};
    fs.writeFileSync(at(name+'.bake.json'),JSON.stringify(plan));
    return runBakeJob(at(name+'.bake.json'),{directory:at(directory)});
  }
  return {at,run};
}
function open(result,map,level=0,tile='1001') {
  const row=result.report.maps.find(row=>row.map===map&&row.tileLabel===tile);
  const entry=level?row.mips[level-1]:row, source=readTexture(path.join(path.dirname(result.file),entry.file));
  const at=(x,y)=>[...source.data.slice((x+y*source.width)*source.channels,(x+y*source.width+1)*source.channels)];
  return {...source,row,at};
}
const grid={width:35,height:19,antialiasing:4};

test('rectangular supersampling, TIFF and odd mip chains keep chart colors separate at the seam',async t=>{
  const {run}=fixture(t);
  const baked=await run('rectangular',[
    ['pigment',{...grid,format:'tiff',precision:'unorm16',mipmaps:'full',dilation:3,diffusion:4,gutters:'transparent'}],
    ['coverage',{...grid,format:'png',precision:'unorm16',mipmaps:1}],
    ['normal',{width:27,height:13,antialiasing:2,format:'exr',precision:'float16',mipmaps:1}],
    ['material-id',{...grid,format:'exr',precision:'float32',mipmaps:2}],
    ['position-world',{width:23,height:17,format:'exr',precision:'float32'}]
  ]);
  const pigment=open(baked,'pigment'), coverage=open(baked,'coverage'), normal=open(baked,'normal');
  assert.deepEqual([pigment.width,pigment.height,pigment.bitDepth,pigment.encoding],[35,19,16,'tiff']);
  const seam=pigment.at(17,9);
  assert(seam[0]>0);assert.equal(seam[2],0);assert.equal(seam[3],16384);
  assert.deepEqual(coverage.at(17,9),[32768]);
  assert.deepEqual(coverage.at(2,9),[0]);
  assert(pigment.at(2,9)[0]>0);assert.equal(pigment.at(2,9)[3],0);
  assert.deepEqual(pigment.row.mips.map(({width,height})=>[width,height]),[[17,9],[8,4],[4,2],[2,1],[1,1]]);
  for(const level of [0,1,2,3,4,5]) {
    const texels=open(baked,'pigment',level).data;
    for(let i=0;i<texels.length;i+=4)assert(!(texels[i]&&texels[i+2]),'Red and blue mixed across charts at mip '+level);
  }
  assert.deepEqual([normal.width,normal.height,normal.bitDepth],[27,13,16]);
  assert.deepEqual(open(baked,'normal',1).at(3,3),[0,0,1]);
  assert.deepEqual(open(baked,'material-id').at(17,9),[51]);
  const ids=open(baked,'material-id',2).data;
  assert(ids.every(value=>[0,51,87].includes(value)));
  const xyz=open(baked,'position-world');
  assert.equal(xyz.at(8,8)[2],-2);
  assert.deepEqual([xyz.width,xyz.height],[23,17]);
  const debug=baked.report.uvDebug[pigment.row.uvDebug];
  assert.equal(debug.width,35);assert.equal(debug.height,19);
  assert.equal(debug.charts,2);
});

test('reserved padding, dilation and diffusion operate only in the assigned gutter',async t=>{
  const {at,run}=fixture(t), preset={...grid,format:'png',precision:'unorm16'};
  const blank=await run('blank',[['pigment',{...preset,gutters:'empty'}]]);
  const copied=await run('copied',[['pigment',{...preset,dilation:2}]]);
  const diffused=await run('diffused',[['pigment',{...preset,dilation:2,diffusion:5}]]);
  const [none,copy,diff]=[blank,copied,diffused].map(row=>open(row,'pigment'));
  assert.deepEqual(none.at(2,9),[0,0,0,0]);
  assert(copy.at(2,9)[0]>0);assert(diff.at(2,9)[0]>0);
  assert([3,4,5,6,12,13,14].some(y=>copy.at(2,y)[0]!==diff.at(2,y)[0]));
  assert.deepEqual(copy.at(7,9),diff.at(7,9));
  assert.deepEqual(copy.at(0,9),[0,0,0,0]);
  assert.deepEqual(diff.at(0,9),[0,0,0,0]);
  assert.equal(blank.report.uvDebug[0].gutters,copied.report.uvDebug[0].gutters);

  await assert.rejects(()=>run('incompatible',[['pigment',{...preset,dilation:6}]],'copied'),/Invalid bake/);
  assert.equal(latestBakeJob(at('copied')).revision,copied.revision);
  assert.throws(()=>Plan.preset({format:'ink-studio/bake-preset',version:1,label:'ID format',
    maps:[{id:'material-id',overrides:{format:'png'}}]}),/Stable IDs need float32/);
});


test('dilation and every mip stop at the UDIM boundary',async t=>{
  const {run}=fixture(t);
  const baked=await run('tiles',[['pigment',{width:21,height:13,antialiasing:2,padding:4,dilation:4,diffusion:4,
    format:'exr',precision:'float32',mipmaps:'full'}]],'tiles',true);
  for(const [tile,blocked] of [['1001',2],['1002',0]]) {
    const base=open(baked,'pigment',0,tile);
    for(let level=0;level<=base.row.mips.length;level++) {
      const data=open(baked,'pigment',level,tile).data;
      assert(data.some((value,i)=>i%4===(blocked?0:2)&&value>0));
      assert(data.every((value,i)=>i%4!==blocked||value===0));
    }
  }
});
