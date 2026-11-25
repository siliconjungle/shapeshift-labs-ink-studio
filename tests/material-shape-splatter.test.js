const test=require('node:test');
const assert=require('node:assert/strict');
const Ink=require('..');
const P=Ink.load().KIT.procedural, g=P.graphImages, sdf=P.sceneGraph;
const disc={type:'disc',radius:.44};
const bake=(options={},map={},shapes=[disc],volumes=[],width=33,height=33,columns=1,rows=1,time=0)=>
  g.shapeSplatter(width,height,columns,rows,shapes,volumes,map,{seed:39,jitter:0,...options},0,time);
const data=(result,port='value')=>result[port].raster.data;
const typed=(samples,width,intent='data',units='unitless')=>g.declare({
  width,height:samples.length/width,channels:1,data:Float64Array.from(samples)
},{intent,units});
const center=16*33+16;
const normal=(result,p=center)=>Array.from(data(result,'normal').subarray(3*p,3*p+3));
const uv=(result,p=center)=>Array.from(data(result,'uv').subarray(2*p,2*p+2));
const near=(a,b,tol=.0004)=>assert.ok(Math.abs(a-b)<=tol,a+' differs from '+b);

test('planar extrusion bakes one aligned hit into height, normals, IDs, UVs and coverage',()=>{
  const out=bake({scale:[.54,.5,.43],extrusion:.3,rounding:.02});
  near(data(out)[center],.15);
  normal(out).forEach((n,i)=>near(n,[0,0,1][i]));
  assert.deepEqual(uv(out),[.5,.5]);
  assert.equal(data(out,'instanceId')[center],1);
  assert.equal(data(out,'shapeId')[center],1);
  assert.equal(data(out,'coverage')[center],1);
  assert.equal(data(out)[0],0);
  assert.equal(data(out,'coverage')[0],0);
  assert.equal(out.value.descriptor.units,'shape-units');
  assert.equal(out.uv.descriptor.layout,'rg');
  assert.equal(out.normal.descriptor.normalOrientation,'opengl');
});

test('native 3D fields retain curved normals, thin silhouette edges and internal holes',()=>{
  const sphere=sdf.shape('sphere',{radius:.5});
  const result=bake({scale:[.66,.45,.5]}, {}, [],[sphere]);
  near(data(result)[center],.45);
  const n=normal(result,center+8);
  assert(n[0]>.39&&n[2]>.45);
  near(Math.hypot(...n),1,1e-6);
  assert.equal(result.layout.placements[0].kind,'volume');
  const ring=bake({scale:.8}, {}, [],[sdf.shape('torus',{major:.34,minor:.13})]);
  assert.equal(data(ring,'coverage')[center],0);
  assert.equal(data(ring,'coverage')[center+9],1);
  assert(data(ring)[center+9]>.16);
});

test('XYZ rotation and independent scale change a projection while slope alignment follows the terrain',()=>{
  const flat={type:'rectangle',size:[.95,.36]}, option={scale:[.6,.32,.6],rounding:0,wrap:[false,false]};
  const a=bake(option,{},[flat]), b=bake({...option,rotation:[0,90,0]}, {},[flat]);
  assert.equal(data(a,'coverage')[center+8],1);
  assert.equal(data(b,'coverage')[center+8],0);
  assert.equal(data(b,'coverage')[center+8*33],1);
  const turn=bake({...option,rotation:[22,0,17]}, {},[flat]);
  assert.notDeepEqual(data(turn,'coverage'),data(a,'coverage'));
  assert.notEqual(normal(turn)[2],1);
  const background=typed(Array.from({length:81},(_,i)=>.4*(i%9+.5)/9+.2*(Math.floor(i/9)+.5)/9),9,'height','mm');
  const aligned=bake({...option,slopeAlignment:1},{background});
  const vertical=bake({...option,slopeAlignment:0},{background});
  const open=normal(aligned), direct=normal(bake({...option,slopeAlignment:1,orientation:'directx'},{background}));
  near(open[0],-.4/Math.sqrt(1.2));near(open[1],.2/Math.sqrt(1.2));near(open[2],1/Math.sqrt(1.2));
  near(direct[1],-open[1]);near(normal(vertical)[2],1);
  assert.equal(aligned.value.descriptor.units,'mm');
  assert.deepEqual(aligned.normal.descriptor.pixelPitchMm,[1/33,1/33]);
});

test('height offsets and overlapping stamps resolve the highest visible ray hit',()=>{
  const options={scale:[.89,.5,.89],heightJitter:.13,heightOffset:.15,rounding:0};
  const result=bake(options,{},[disc],[],33,33,2,1);
  const best=result.layout.placements.reduce((a,b)=>a.base[1]>b.base[1]?a:b);
  assert.equal(data(result,'instanceId')[center],best.id);
  near(data(result)[center],best.base[1]+.125);
  const background=typed([.33],1,'height','shape-units');
  const buried=bake({scale:.45,heightOffset:-.5},{background});
  near(data(buried)[center],.33);
  assert.equal(data(buried,'coverage')[center],0);
  const above=bake({scale:.45,heightOffset:.2},{background});
  near(data(above)[center],.33+.2+.45*.25);
});

test('density preserves a deterministic subset, placement masks and per-sample clips are distinct',()=>{
  const options={scale:.14,jitter:.91,rotationJitter:[11,180,12],scaleJitter:[.12,.2,.08],heightJitter:.02};
  const base=bake(options,{},[disc],[],40,30,7,6);
  const sparse=bake({...options,density:.39},{density:typed([.8],1)},[disc],[],40,30,7,6);
  const whole=new Map(base.layout.placements.map(row=>[row.id,row]));
  assert(sparse.layout.placements.length>0&&sparse.layout.placements.length<whole.size);
  for(const row of sparse.layout.placements) assert.deepEqual(row,whole.get(row.id));
  const mask=typed([0,1],2);
  const selected=bake({scale:.46},{mask},[disc],[],33,33,2,1);
  assert.deepEqual(selected.layout.placements.map(x=>x.id),[2]);
  assert.equal(selected.layout.rejected.mask,1);
  const clipped=bake({scale:.74},{clip:mask});
  assert.equal(clipped.layout.placements.length,1);
  assert.equal(data(clipped,'coverage')[center-5],0);
  assert.equal(data(clipped,'coverage')[center+5],1);
  const tiny=bake({scale:.03,samples:2},{},[disc],[],1,1);
  assert.equal(data(tiny,'coverage')[0],0);
  assert.equal(data(tiny,'instanceId')[0],0);
  assert.equal(data(tiny)[0],0);
});

test('UV controls affect only UVs and repeat bakes retain exact alignment on every port',()=>{
  const options={scale:[.28,.25,.31],rotationJitter:[30,110,12],jitter:.72,samples:2};
  const a=bake(options,{},[disc],[],30,22,5,4);
  const b=bake({...options,crop:[-1,0,1,2]}, {},[disc],[],60,44,5,4);
  assert.deepEqual(a.layout.placements,b.layout.placements);
  const ports=['value','normal','instanceId','shapeId','uv','coverage'];
  for(const port of ports){
    const channels=a[port].raster.channels;
    for(let y=0;y<44;y++)for(let x=0;x<60;x++){
      const i=(y*60+x)*channels,j=((y%22)*30+x%30)*channels;
      assert.deepEqual(data(b,port).subarray(i,i+channels),data(a,port).subarray(j,j+channels),port+' '+i);
    }
  }
  for(let i=0;i<660;i++) assert.equal(data(a,'coverage')[i]>0,data(a,'instanceId')[i]>0);
  const rotated=bake({...options,uv:{mode:'cylindrical',angle:30,scale:[2,3],offset:[.3,.2],address:'wrap'}},
    {},[disc],[],30,22,5,4);
  assert.notDeepEqual(data(rotated,'uv'),data(a,'uv'));
  assert(data(rotated,'uv').every(x=>x>=0&&x<=1));
  for(const port of ports.filter(x=>x!=='uv')) assert.deepEqual(data(rotated,port),data(a,port));
  const scaled=bake({scale:.5,uv:{scale:[2,3],offset:[.32,-.4],address:'raw'}});
  near(uv(scaled)[0],1.32);near(uv(scaled)[1],1.1);
});

test('typed graph replay keeps a shared 2D and 3D shape library editable',()=>{
  const link=(node,port='value')=>({node,port});
  const spec={format:'ink-studio/graph-project',version:1,nodes:{
    dome:{op:'sdf.shape',inputs:{kind:'sphere'}},
    record:{op:'data.record',inputs:{dome:link('dome')}},
    volumes:{op:'data.collect',inputs:{source:link('record'),keys:['dome']}},
    terrain:{op:'image.uniform',inputs:{value:.14,width:4,height:4,descriptor:{intent:'height',units:'mm'}}},
    bake:{op:'image.shapeSplatter',inputs:{width:31,height:23,columns:5,rows:4,shapes:[disc],volumes:link('volumes'),
      background:link('terrain'),options:{scale:.19,seed:39,jitter:.7}}}
  },outputs:{height:link('bake'),normal:link('bake','normal'),layout:link('bake','layout'),uv:link('bake','uv')}};
  const saved=JSON.parse(JSON.stringify(Ink.openMaterialGraph(spec,{id:'splatter-test'})));
  const a=Ink.createGraphProject(saved).run().outputs,b=Ink.createGraphProject(saved).run().outputs;
  assert.deepEqual(a.height.raster.data,b.height.raster.data);
  assert.deepEqual(a.uv.raster.data,b.uv.raster.data);
  assert.equal(new Set(a.layout.placements.map(x=>x.kind)).size,2);
  assert.equal(a.height.descriptor.units,'mm');
  const timed=sdf.boundSDF((x,y,z,time)=>Math.hypot(x,y,z)-(.24+.12*time),{min:[-.5,-.5,-.5],max:[.5,.5,.5]});
  const first=bake({scale:.6}, {}, [],[timed],33,33,1,1,0);
  const next=bake({scale:.6}, {}, [],[timed],33,33,1,1,1);
  assert(data(next)[center]>data(first)[center]);
});

test('invalid field bounds, maps, rotations and trace budgets fail explicitly',()=>{
  assert.throws(()=>bake({}, {},[],[(x,y,z)=>x+y+z]),/bounds/);
  assert.throws(()=>bake({rotation:[0,0]}),/transform/);
  assert.throws(()=>bake({}, {density:typed([.5],1,'height','mm')}),/unitless/);
  assert.throws(()=>bake({units:'shape-units'}, {background:typed([.5],1,'height','mm')}),/matching height units/);
  assert.throws(()=>bake({scale:2,samples:4,steps:128}, {},[disc],[],800,800,8,6),/trace budget/);
});
