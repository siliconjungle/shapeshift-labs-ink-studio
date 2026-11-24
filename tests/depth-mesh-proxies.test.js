const assert = require('node:assert/strict');
const {test} = require('node:test');
const {execFileSync} = require('node:child_process');
const {readFileSync,mkdtempSync,rmSync} = require('node:fs');
const {tmpdir} = require('node:os');
const path = require('node:path');
const ink = require('..');

function fixture({KIT:K,makeBuilder}) {
  const Mesh=K.sceneMeshes, colors=[0x171c2b,0xdb6949,0x4fae95,0xecc77c];
  const B=makeBuilder(4,colors);
  const indices=[0,1,2,2,1,3];
  const board=(x0,x1,y,z)=>[x0,y,z,x1,y,z,x0,-y,z,x1,-y,z];
  const proxy=Mesh.depthProxy({id:'slab',positions:board(-1.35,1.45,1.0,.35),indices});
  B.disc(-.49,0,.16,[0,0,1],.56,.024,B.P[1],3,{rg:0});
  B.disc(-.49,0,.31,[0,0,1],.27,.024,B.P[2],3,{rg:0});
  B.disc(-1.53,0,.0,[0,0,1],.13,.024,B.P[3],3,{rg:0});
  const visible=Mesh.create({id:'enamel',positions:board(.32,1.25,.55,-.6),indices,
    uvs:[0,0,1,0,0,1,1,1],materials:[{id:'gold',color:0xecc77c}]});
  const world=B.finish({meshes:[visible],splatDepthProxies:{meshes:[proxy],tolerance:.05},
    cam:{target:[0,0,0],dist:4,yaw:0,pitch:0,ortho:true},look:{splatCoverage:'continuous'},fog:{c:0,start:1,max:0},dither:0});
  const view={w:96,h:64,px:1,raw:true,passes:['opaque-surface','depth-proxy']};
  return {world,view,proxy,board};
}

const bytes = (frame,p) => Array.from(frame.rgb.subarray(p*3,p*3+3));

function indexes(off,on,tight) {
  const near=on.passes.splatId.findIndex((id,p)=>id===2 && tight.passes.proxyRejected[p]>0 && bytes(on,p)[1]===174);
  const rear=off.passes.splatId.findIndex((id,p)=>id===1&&on.passes.proxyRejected[p]>0&&!on.passes.splatId[p]);
  const mesh=on.passes.objectId.indexOf(on.passes.objects.indexOf('enamel'));
  const outside=on.passes.splatId.findIndex((id,p)=>id===3&&!Number.isFinite(on.passes.proxyDepth[p]));
  assert([near,rear,mesh,outside].every(p=>p>=0),JSON.stringify({near,rear,mesh,outside}));
  return {near,rear,mesh,outside};
}

test('depth-only proxies cull rear splat fragments and leave actual depth, color, mesh and outside pixels intact',()=>{
  const {world,view,proxy,board}=fixture(ink.load());
  const options={...view,passes:['opaque-surface','splatId','depth-proxy']};
  const on=ink.render(world,options), off=ink.render(world,{...options,splatDepthProxies:false});
  const tight=ink.render(world,{...options,splatProxyTolerance:0});
  const {near,rear,mesh,outside}=indexes(off,on,tight);
  assert(on.passes.proxyDepth[rear]<off.passes.depth[rear]);
  assert.equal(on.passes.depth[rear],Infinity);
  assert.equal(on.passes.proxyRejected[rear],1);
  assert(on.passes.proxyRemovedCoverage[rear]>.5);
  const diagnostics=ink.reviewSplatEdit(world,{width:on.w,height:on.h,view,at:[rear%on.w,Math.floor(rear/on.w)]});
  assert.equal(diagnostics.inspected.after.proxyRejected,1);
  assert(diagnostics.inspected.kinds.includes('proxy-rejected'));
  assert.equal(diagnostics.cost.after.proxyRejected,on.passes.proxyRejected.reduce((sum,count)=>sum+count,0));
  assert.equal(on.passes.depth[near],off.passes.depth[near]);
  assert(on.passes.depth[near]>on.passes.proxyDepth[near]);
  assert.deepEqual(bytes(on,near),bytes(off,near));
  assert.deepEqual(bytes(on,mesh),[236,199,124]);
  assert.deepEqual(bytes(on,outside),bytes(off,outside));
  assert(!off.passes.proxyRejected.some(Boolean));
  assert(off.passes.proxyDepth.every(d=>d===Infinity));
  const colorOnly=ink.render(world,{...view,passes:undefined});
  assert.deepEqual(colorOnly.rgb,on.rgb);
  ink.load().SceneMeshes.pose(proxy,board(-1.35,1.45,1.0,-1));
  assert.deepEqual(ink.render(world,options).rgb,off.rgb);
  assert.throws(()=>ink.render(world,{...view,splatProxyTolerance:-.001}),/nonnegative/);
});

test('the CLI exports depth, rejected counts, opacity, and a heat map on the same art grid',t=>{
  const folder=mkdtempSync(path.join(tmpdir(),'ink-depth-proxy-test-'));
  t.after(()=>rmSync(folder,{recursive:true,force:true}));
  execFileSync(process.execPath,[path.resolve(__dirname,'../cli/ink-studio.js'),'passes',
    path.resolve(__dirname,'../examples/depth-mesh-proxies.js'),'--channels','depth-proxy',
    '--w','128','--h','80','--px','1','--px1','--out',folder],{stdio:'pipe'});
  const read=name=>readFileSync(path.join(folder,name));
  const {proxyData,encodings}=JSON.parse(read('passes.json'));
  assert.deepEqual([proxyData.width,proxyData.height,proxyData.rows],[128,80,'top-down']);
  assert.equal(proxyData.files.proxyRejected.format,'u32le');
  const counts=read(proxyData.files.proxyRejected.file);
  assert.equal(counts.length,128*80*4);
  assert(counts.some(Boolean));
  assert.match(encodings.proxyRejected,/heat map/);
  assert(read('proxyRejected.png').length>100);
});

test('WebGL uses the same tolerance and keeps the proxy out of color, including after a pose',
  {skip:!process.env.INK_TEST_CHROME},()=>{
  const {world,view}=fixture(ink.load());
  const options={...view,passes:['opaque-surface','splatId','depth-proxy']};
  const off=ink.render(world,{...options,splatDepthProxies:false}), on=ink.render(world,options);
  const tight=ink.render(world,{...options,splatProxyTolerance:0});
  const samples=Object.fromEntries(Object.entries(indexes(off,on,tight))
    .map(([label,p])=>[label,[p%view.w,Math.floor(p/view.w)]]));
  const result=require('../cli/look-webgl.js')({},fixture,(kit,make,backend,samples)=>{
    const {world,view,proxy,board}=make(kit);
    const painter=backend(view.w,view.h,{raw:true,dither:0});
    try {
      const sample=options=>{painter.draw(world,options);return painter.sample(samples);};
      const off=sample({splatDepthProxies:false}), on=sample(), tight=sample({splatProxyTolerance:0});
      const noSurfaces=sample({meshes:false});
      kit.KIT.sceneMeshes.pose(proxy,board(-1.35,1.45,1.0,-1));
      return {off,on,tight,noSurfaces,moved:sample()};
    } finally { painter.close(); }
  },samples);
  assert.deepEqual(result.on.rear,[23,28,43]);
  assert(result.off.rear[0]>130,JSON.stringify(result));
  assert.deepEqual(result.on.near,result.off.near);
  assert.deepEqual(result.tight.near,[23,28,43]);
  assert.deepEqual(result.on.mesh,[236,199,124]);
  assert.deepEqual(result.on.outside,result.off.outside);
  assert.deepEqual(result.noSurfaces.rear,result.on.rear);
  assert.deepEqual(result.moved,result.off);
});
