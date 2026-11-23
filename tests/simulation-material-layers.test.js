const {test}=require('node:test');
const assert=require('node:assert/strict');
const ink=require('..');
const Layers=require('../src/simulation-material-layers');
const Look=require('../src/look-inputs');
const kit=ink.load();

test('layers use stable masks, sample a driver once, and change only authored channels',()=>{
  const driver={source:'query',field:'rig/surface-state',args:{body:'gate'},path:['values','wetness']};
  const plan=Layers.create({format:Layers.format,version:1,layers:[
    {id:'wetness',driver,mask:{space:'uv',kind:'raster',width:2,height:1,values:[0,255]},roughness:.2},
    {id:'repair',driver,mask:{space:'rest',min:[0,0,-1],max:[1,1,1],feather:.2},relief:.1},
    {id:'soot',amount:1,mask:{space:'uv',min:[0,0],max:[.4,1]},pigment:'#402211'}
  ]});
  let reads=0;
  const session=Look.session(10,()=>({probe(){reads++;return {status:'ok',value:{values:{wetness:.8}}};}}));
  const state=Layers.resolve(plan,session), base={color:[.5,.5,.5],roughness:.9,sheen:.3};
  assert.equal(reads,1);
  assert.deepEqual(state.amounts,[.8,.8,1]);
  const sample=Layers.apply(plan,state,[.75,.5],[.1,.5,0],base);
  assert.equal(sample.color,base.color);
  assert.equal(sample.sheen,base.sheen);
  assert(Math.abs(sample.roughness-.48)<1e-8);
  assert(Math.abs(sample.height-.04)<1e-8);
  assert(Layers.slope(plan,state,[.75,.5],[.1,.5,0],[0,0],[.05,0,0])>.02);
  assert.notDeepEqual(Layers.apply(plan,state,[.15,.5],[2,.5,0],base).color,base.color);
  assert.deepEqual(Layers.resolve(plan,Look.session(10)).amounts,[0,0,1]);
  assert.throws(()=>Layers.create({format:Layers.format,version:1,layers:[
    {id:'x',mask:{space:'rest',kind:'raster',width:1,height:1,values:[255]},roughness:.3}
  ]}),/UV raster/);
});

function fixture({KIT:K,makeBuilder}) {
  const W=K.world, spec={dt:.25,systems:{
    rain:{kind:'control',config:{op:'pass'}}, care:{kind:'control',config:{op:'pass'}}
  }};
  const positions=[-1,-.75,0,1,-.75,0,-1,.75,0,1,.75,0];
  const doc={format:'ink-studio/simulation-material-layers',version:1,layers:[
    {id:'wetness',driver:{source:'signal',port:'rain/value'},
      mask:{space:'uv',kind:'raster',width:8,height:2,values:[0,190,255,0,0,0,0,0, 0,190,255,0,0,0,0,0]},
      pigment:'#175472',roughness:.20},
    {id:'repairs',driver:{source:'query',field:'world/signal',args:{port:'care/value'}},
      mask:{space:'rest',min:[.12,-.62,-.36],max:[.8,.63,.36],feather:.18},
      pigment:'#a3845b',relief:.12,sheen:.56}
  ]};
  const mesh=K.sceneMeshes.create({id:'door',objectId:'sluice',partId:'plate',positions,
    uvs:[0,1,1,1,0,0,1,0],indices:[0,1,2,1,3,2],materials:[{id:'enamel',color:0x6d836b,roughness:.68,
      mipmaps:{light:[.25,.28,.92],ambient:.52,specular:.05},simulationLayers:doc}]});
  const world=makeBuilder(12,[0x17222c]).finish({meshes:[mesh],dither:0,
    fog:{c:0,start:1,max:0},cam:{target:[0,0,0],dist:4,ortho:true,yaw:0,pitch:0,fov:.66}});
  const run=W.runtime.create(spec);
  run.schedule([
    {tick:2,action:'world/input',args:{port:'rain/value',value:1}},
    {tick:3,action:'world/input',args:{port:'care/value',value:.7}}
  ]);
  function set(snapshot=run){
    world.lookSnapshot={time:snapshot.view().time,tick:snapshot.view().tick,query:snapshot.query()};
  }
  set();
  return {world,run,set,mesh,positions};
}
const view={w:120,h:88,px:1,raw:true,dither:0,outline:false};
const points={wet:[46,44],repair:[73,42],edge:[66,43],clear:[60,42]};
const read=(im,points)=>Object.fromEntries(Object.entries(points).map(([id,[x,y]])=>
  [id,[...im.rgb.subarray((y*im.w+x)*3,(y*im.w+x)*3+3)]]));
test('committed signals drive a retained material, replay exactly, and stay attached when posed',()=>{
  const {world,run,set,mesh,positions}=fixture(kit), {KIT:K}=kit;
  const render=(extra={})=>ink.render(world,{...view,...extra});
  const base=render(), mean=read(base,points), atlas=K.sceneMeshes.layer(mesh), chain=atlas.semanticMipmaps[0].chain;
  run.advance(4);
  set();
  let receipt;
  const settled=render({simulationMaterialLayersFrame:rows=>{receipt=rows;}});
  const pixels=read(settled,points);
  assert.equal(receipt.length,1);
  assert.deepEqual(receipt[0].layers,[{id:'wetness',amount:1},{id:'repairs',amount:.7}]);
  assert.notDeepEqual(pixels.wet,mean.wet);
  assert.notDeepEqual(pixels.repair,mean.repair);
  assert.deepEqual(pixels.clear,mean.clear);
  assert.deepEqual(render({simulationMaterialLayers:false}).rgb,base.rgb);
  assert.equal(K.sceneMeshes.layer(mesh),atlas);
  assert.equal(atlas.semanticMipmaps[0].chain,chain);
  const checkpoint=JSON.parse(JSON.stringify(run.checkpoint()));
  const resumed=K.world.runtime.create(checkpoint.world,{checkpoint});
  set(resumed);
  assert.deepEqual(render().rgb,settled.rgb);
  const dx=.5;
  K.sceneMeshes.pose(mesh,positions.map((n,i)=>i%3===0?n+dx:n));
  assert.deepEqual(render({target:[dx,0,0]}).rgb,settled.rgb);
});

test('WebGL and headless match UV pigment and rest-space relief on the same state',{
  skip:!process.env.INK_TEST_CHROME
},()=>{
  const {world,run,set}=fixture(kit);
  run.advance(4);set();
  const cpu=read(ink.render(world,view),points);
  const gpu=require('../cli/look-webgl')({},fixture,(kit,build,backend,{view,points})=>{
    const {world,run,set}=build(kit), renderer=backend(view.w,view.h,view);
    try{
      renderer.draw(world);
      const before=renderer.sample(points);
      run.advance(4);set();
      renderer.draw(world);
      const after=renderer.sample(points);
      renderer.draw(world,{simulationMaterialLayers:false});
      return {before,after,disabled:renderer.sample(points)};
    }finally{renderer.close();}
  },{view,points});
  assert.notDeepEqual(gpu.before.wet,gpu.after.wet);
  assert.deepEqual(gpu.before,gpu.disabled);
  for(const id of Object.keys(points))
    assert(gpu.after[id].every((n,i)=>Math.abs(n-cpu[id][i])<=4),JSON.stringify({cpu,gpu,id}));
});
