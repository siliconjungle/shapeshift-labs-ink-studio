const {test}=require('node:test');
const assert=require('node:assert/strict');
const ink=require('..');
const kit=ink.load();

function fixture({KIT:K,makeBuilder,makeSculpt}) {
  const object='survey-module',part='case',target={object,part};
  const B=makeBuilder(8,[0x0c1824,0x286367,0x498885,0xacc5a2]);
  const S=K.sculpt(makeSculpt(B));
  S.keepRenderSdf=true;
  S.box([0,0,0],[1,.75,.25],{r:[1,2],materialId:'case-metal'},
    {objectId:object,target:{part},res:.076,rd:.04});
  S.bake();
  const world=B.finish({cam:{target:[0,0,0],dist:4,ortho:true,pitch:0,yaw:0},
    fog:{c:0,start:1,max:0},dither:0});
  const pos=[-1,-.75,.25,1,-.75,.25,-1,.75,.25,1,.75,.25], uv=[0,1,1,1,0,0,1,0];
  const mesh=K.sceneMeshes.create({id:'panel',objectId:object,partId:part,positions:pos,uvs:uv,indices:[0,1,2,1,3,2],
    materials:[{id:'case-metal',color:0x438290}]});
  const mask=rgba=>({width:4,height:4,pixels:Array.from({length:16},()=>rgba).flat()});
  const anchor={...target,node:'moving-panel',at:[0,0,.25],normal:[0,0,1],size:[.8,.48],depth:.10,bias:.006};
  const document={format:'ink-studio/surface-decals',version:1,decals:[
    {id:'label',kind:'lettering',anchor,image:mask([251,193,50,255]),grid:[5,4],lifetime:{start:0,end:3,fadeOut:1}},
    {id:'badge',kind:'relief',anchor:{...anchor,at:[.67,0,.25],size:[.24,.35]},
      image:mask([245,80,120,255]),relief:{height:.038,heights:Array.from({length:16},(_,i)=>i%4<2?0:255)}}
  ]};
  world.sceneGraph=K.sceneGraph.create({nodes:{'moving-panel':{}}});
  world.meshes=[mesh];
  const api=K.surfaceDecals.bind(world,document,{receivers:[
    {...target,representation:'mesh',mesh},
    {...target,representation:'sdf',field:{distance:S.sdf}},
    {...target,representation:'splats'}
  ]});
  return {world,mesh,pos,api,document,object,part};
}

const close=(a,b)=>assert(Math.abs(a-b)<1e-5,`${a} != ${b}`);
const color=(image,x,y)=>Array.from(image.rgb.subarray((y*image.w+x)*3,(y*image.w+x)*3+3));
const options={w:128,h:96,px:1,raw:true,dither:0};

test('one serializable decal document binds to mesh, SDF and splats, and keeps a single lifetime',()=>{
  const {world,mesh,pos,api,document,object,part}=fixture(kit), {KIT:K}=kit;
  assert.deepEqual(K.surfaceDecals.create(JSON.parse(JSON.stringify(api.document))),api.document);
  assert.throws(()=>K.surfaceDecals.create({...document,version:2}),/version 1/);
  assert.throws(()=>K.surfaceDecals.create({...document,decals:[document.decals[0],document.decals[0]]}),/unique/);
  assert.throws(()=>api.use(object,'other-panel','splats'),/unknown decal receiver/);
  const initial=api.sample(1);
  assert.equal(initial.layers.length,2);
  const first=Array.from(initial.layers[0].vertices.subarray(0,3));
  assert(Math.max(...initial.layers[1].vertices.filter((_,i)=>i%5===2))>.28);
  K.sceneMeshes.pose(mesh,pos.map((v,i)=>i%3===0?v+.33:i%3===2?v+.05*v:v));
  const moved=api.sample(1).layers[0].vertices;
  close(moved[0]-first[0],.33);
  close(moved[1],first[1]);
  world.sceneGraph.setLocal('moving-panel',{position:[.33,0,0]});
  for (const kind of ['sdf','splats']) {
    api.use(object,part,kind);
    const frame=api.sample(2.5);
    assert.equal(frame.layers[0],initial.layers[0]);
    close(frame.layers[0].vertices[0]-first[0],.33);
    assert.equal(frame.report[0].opacity,.5);
    assert.equal(frame.report[0].representation,kind);
    assert(frame.report[0].triangles>0);
    assert.equal(api.sample(3).layers.length,1);
    assert.equal(api.sample(1).layers.length,2);
  }
  world.sceneGraph.setVisible('moving-panel',false);
  assert.equal(api.sample(1).layers.length,0);
  api.dispose();
  assert.equal(world.surfaceDecals,undefined);
});

test('SDF changes reproject the same decal and withdraw it when the surface moves out of reach',()=>{
  const {world,api,document,object,part}=fixture(kit), {KIT:K}=kit;
  api.dispose();
  let offset=.25, snapshot={distance:(_x,_y,z)=>z-offset};
  const binding=K.surfaceDecals.bind(world,{...document,decals:document.decals.slice(0,1)},{receivers:[
    {object,part,representation:'sdf',field:{current:()=>snapshot}}
  ]});
  const initial=binding.sample(1).layers[0], depth=initial.vertices[2];
  offset=.30;
  snapshot={distance:(_x,_y,z)=>z-offset};
  close(binding.sample(1).layers[0].vertices[2]-depth,.05);
  offset=.60;
  snapshot={distance:(_x,_y,z)=>z-offset};
  assert.equal(binding.sample(1).layers.length,0);
  offset=.25;
  snapshot={distance:(_x,_y,z)=>z-offset};
  assert.equal(binding.sample(1).layers[0],initial);
});

test('rest projectors enforce the authored facing cosine and depth on mesh and SDF receivers',()=>{
  const {KIT:K,makeBuilder}=kit, object='receiver';
  const positions=[-1,-1,-.3,1,-1,.7,-1,1,-.3,1,1,.7];
  const mesh=K.sceneMeshes.create({id:object,positions,uvs:[0,1,1,1,0,0,1,0],
    indices:[0,1,2,1,3,2],materials:[{id:'enamel'}]});
  const count=(kind,limits)=>{
    const world=makeBuilder(0,[0]).finish();
    const anchor={object,at:[0,0,.2],normal:[0,0,1],size:[.35,.35],depth:.2,...limits};
    const binding=K.surfaceDecals.bind(world,{format:K.surfaceDecals.format,version:1,decals:[
      {id:'paint',anchor,image:{width:1,height:1,pixels:[255,255,255,255]},grid:[5,5]}
    ]},{receivers:[{object,representation:kind,
      ...(kind==='mesh' ? {mesh} : {field:{distance:(x,_y,z)=>z-.2-x*.5}})}]});
    return binding.sample(0).report[0].triangles;
  };
  for (const kind of ['mesh','sdf']) {
    assert.ok(count(kind,{minFacing:.7})>0,kind);
    assert.equal(count(kind,{minFacing:.95}),0,kind);
    assert.equal(count(kind,{normal:[0,0,-1]}),0,kind);
    assert.equal(count(kind,{at:[0,0,.36],depth:.03}),0,kind);
  }
});

test('a UV decal clips to its padded chart and keeps its original texture registration',()=>{
  const {world,mesh,api,object,part}=fixture(kit), {KIT:K}=kit;
  api.dispose();
  const brush={min:[0,0],max:[1,1]}, chart={min:[0,0],max:[.5,1],padding:[.12,.08]};
  const hit=K.sceneMeshes.clipUV(mesh,{...brush,clip:{min:[.12,.08],max:[.38,.92]}});
  assert.ok(hit.triangles.length>0);
  for (let i=0;i<hit.points.length/3;i++) {
    close(hit.uvs[i*2],(hit.points[i*3]+1)/2);
    close(hit.uvs[i*2+1],(.75-hit.points[i*3+1])/1.5);
  }
  const bound=K.surfaceDecals.bind(world,{format:K.surfaceDecals.format,version:1,decals:[
    {id:'patch',anchor:{object,part,uv:brush,chart},image:{width:1,height:1,pixels:[251,193,50,255]}}
  ]},{receivers:[{object,part,representation:'mesh',mesh}]});
  const [layer]=bound.sample(0).layers, xs=layer.vertices.filter((_,i)=>i%5===0);
  close(Math.min(...xs),-.76);
  close(Math.max(...xs),-.24);
  assert.deepEqual(bound.document.decals[0].anchor.chart,chart);
});

test('headless renders the decal only on the front of its selected receiver and respects scene depth',()=>{
  const {world,api,object,part}=fixture(kit), {KIT:K}=kit;
  const x=64,y=48;
  for (const kind of ['mesh','sdf','splats']) {
    if(kind!=='mesh')world.meshes=[];
    api.use(object,part,kind);
    const settings={...options,t:1,sdfAssist:kind==='sdf'};
    const on=ink.render(world,settings);
    assert.deepEqual(color(on,x,y),[251,193,50],kind);
    assert.notDeepEqual(color(ink.render(world,{...settings,surfaceDecals:false}),x,y),[251,193,50]);
    assert.notDeepEqual(color(ink.render(world,{...settings,yaw:Math.PI}),x,y),[251,193,50]);
  }
  const blocker=K.sceneMeshes.create({id:'foreground',positions:[-.2,-.2,.9,.2,-.2,.9,-.2,.2,.9,.2,.2,.9],
    uvs:[0,0,1,0,0,1,1,1],indices:[0,1,2,1,3,2],materials:[{id:'blocker',color:0xd46b19}]});
  world.meshes=[blocker];
  assert.deepEqual(color(ink.render(world,{...options,t:1}),x,y),[212,107,25]);
});

test('WebGL keeps projected decals visible through receiver switches and expires them at the same clock', {
  skip:!process.env.INK_TEST_CHROME
},()=>{
  const results=require('../cli/look-webgl.js')({},fixture,(kit,build,backend,{w,h})=>{
    const {world,api,object,part}=build(kit);
    const view=backend(w,h,{raw:true,outline:false,dither:0});
    const points={center:[w/2,h/2]};
    try {
      const pixels={};
      for (const kind of ['mesh','sdf','splats']) {
        if(kind!=='mesh')world.meshes=[];
        api.use(object,part,kind);
        view.draw(world,{time:1});
        pixels[kind]=view.sample(points).center;
      }
      view.draw(world,{time:3.1});
      return {pixels,expired:view.sample(points).center};
    } finally {view.close();}
  },options);
  for (const rgb of Object.values(results.pixels)) assert.deepEqual(rgb,[251,193,50]);
  assert.notDeepEqual(results.expired,[251,193,50]);
});
