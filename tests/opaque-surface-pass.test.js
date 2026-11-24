const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const {test}=require('node:test');
const ink=require('..'), {makeBuilder,makeSculpt,SpriteSurface}=ink.load();
const view={w:96,h:68,px:1,raw:true,ortho:true,sdfAssist:true,passes:['opaque-surface','coverage']};

function scene(width=8) {
  const B=makeBuilder(13,[0x17202b,0xd5a36e,0x8ce5bc]), S=makeSculpt(B);
  S.keepRenderSdf=true;
  S.box([0,0,0],[1.2,.82,.17],{r:[1],a:1.3,materialId:'stone'},{res:.31,objectId:'wall'});
  S.bake();
  B.disc(0,0,.65,[0,0,1],.24,.02,B.P[2],1,{nd:true});
  const atlas=SpriteSurface.make(24), size=.55, rest=[-size,size,.36,size,size,.36,-size,-size,.36,size,-size,.36];
  const region=atlas.reserve(width,8,(_u,v)=>v===3 ? undefined : 0xa93327,{normal:()=>[.6,0,1]});
  atlas.meshRegion({points:rest,restPoints:rest,uvs:[0,0,1,0,0,1,1,1],triangles:[0,1,2,2,1,3]},
    region,{id:'screen',objectId:'moving-screen',materialId:'painted-metal'});
  const mesh=atlas.finish(), original=mesh.vertices.slice();
  const world=B.finish({spriteSurfaces:mesh,cam:{target:[0,0,0],dist:5,yaw:0,pitch:0,sway:0},radius:4});
  return {world,slide(dx){
    for(let i=0;i<original.length;i+=5)mesh.vertices[i]=original[i]+dx;
    SpriteSurface.markGeometryDirty(mesh);
  }};
}

function triple(pass,p) {
  return Array.from(pass.subarray(p*3,p*3+3));
}
const close=(actual,expected,tolerance=.002)=>assert(Math.abs(actual-expected)<tolerance,actual+' differs from '+expected);

test('the same contract describes a cutout mesh, its mapped normal, and the SDF seen through its hole',()=>{
  const {world}=scene();
  const pass=ink.render(world,view).passes;
  const mesh=pass.surfaceKind.indexOf(1), sdf=pass.surfaceKind.indexOf(2);
  assert(mesh>=0&&sdf>=0);
  assert.equal(pass.surfaceKinds[1],'mesh');
  assert.equal(pass.surfaceKinds[2],'sdf');
  assert.equal(pass.objects[pass.objectId[mesh]],'moving-screen');
  assert.equal(pass.materials[pass.materialId[mesh]],'painted-metal');
  assert.equal(pass.objects[pass.objectId[sdf]],'wall');
  assert.equal(pass.materials[pass.materialId[sdf]],'stone');
  assert.equal(pass.surfaceCoverage[mesh],1);
  assert.equal(pass.surfaceCoverage[sdf],1);
  close(pass.geometricNormal[mesh*3+2],1);
  assert(Math.abs(pass.shadingNormal[mesh*3])>.45);
  assert.deepEqual(triple(pass.geometricNormal,sdf),triple(pass.shadingNormal,sdf));
  close(pass.position[mesh*3+2],.36);
  close(pass.position[sdf*3+2],.17);
  assert(pass.depth[mesh]<pass.depth[sdf]);
  assert.equal(pass.surfaceUVValid[mesh],255);
  close(pass.surfaceUV[mesh*2],(pass.position[mesh*3]+.55)/1.1);
  assert.equal(pass.surfaceUVValid[sdf],0);
  assert.deepEqual(triple(pass.objectPosition,sdf),triple(pass.position,sdf));
  assert(pass.surfaceKind.some((kind,p)=>kind===2&&p%view.w>=view.w/2-2&&p%view.w<=view.w/2+2));
  assert.equal(pass.surfaceMotionValid.some(Boolean),false);
  const one=ink.render(world,{...view,passes:['surfaceUVValid']}).passes;
  assert.deepEqual(one.surfaceUVValid,pass.surfaceUVValid);
  assert.equal(pass.surfaceCoverage[0],0);
  assert.equal(pass.depth[0],Infinity);
  const narrow=ink.render(scene(1).world,view).passes, pixel=narrow.surfaceKind.indexOf(1);
  close(narrow.surfaceUV[pixel*2],(narrow.position[pixel*3]+.55)/1.1);
});

test('surface motion follows moving mesh vertices and invalidates newly exposed SDF pixels and cuts',()=>{
  const {world,slide}=scene(), first=ink.render(world,{...view,t:0,captureSurfaceMotion:true});
  slide(.35);
  const second=ink.render(world,{...view,t:.1,motionFrom:first.motionReference,captureSurfaceMotion:true});
  const {passes:p}=second, scale=first.motionReference.surfaceMotion.camera.focal;
  let moving=0,staticHits=0,revealed=0;
  for(let i=0;i<p.surfaceKind.length;i++) {
    if(p.surfaceKind[i]===1&&p.surfaceMotionValid[i]) {
      moving++;
      close(p.surfaceMotion[i*2],.35*scale,.01);
      close(p.surfaceMotion[i*2+1],0);
      close(p.position[i*3]-p.objectPosition[i*3],.35);
    } else if(p.surfaceKind[i]===2&&p.surfaceMotionValid[i]) {
      staticHits++;
      close(p.surfaceMotion[i*2],0);
      close(p.surfaceMotion[i*2+1],0);
    }
    if(first.passes.surfaceKind[i]===1&&p.surfaceKind[i]===2&&!p.surfaceMotionValid[i])revealed++;
  }
  assert(moving>25&&staticHits>100&&revealed>15,JSON.stringify({moving,staticHits,revealed}));
  const cameraMoved=ink.render(world,{...view,t:.2,yaw:.12,motionFrom:second.motionReference}).passes;
  assert(cameraMoved.surfaceMotionValid.some((valid,i)=>valid&&cameraMoved.surfaceKind[i]===2&&Math.abs(cameraMoved.surfaceMotion[i*2])>.1));
  const cut=ink.render(world,{...view,t:.2,motionFrom:second.motionReference,resetRenderHistory:true}).passes;
  assert(!cut.surfaceMotionValid.some(Boolean));
  const resized=ink.render(world,{...view,w:90,t:.2,motionFrom:second.motionReference}).passes;
  assert(!resized.surfaceMotionValid.some(Boolean));
});

test('CLI writes aligned previews and lossless top-down surface channels',t=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'ink-opaque-pass-'));
  t.after(()=>fs.rmSync(folder,{recursive:true,force:true}));
  execFileSync(process.execPath,[path.resolve(__dirname,'../cli/ink-studio.js'),'passes',
    path.resolve(__dirname,'../examples/opaque-surface-gate.js'),'--channels','opaque-surface,sourceSurface,sourceSplat',
    '--w','120','--h','80','--px','1','--px1','--previous','.3','--t','.45','--out',folder],{stdio:'pipe'});
  const report=JSON.parse(fs.readFileSync(path.join(folder,'passes.json'),'utf8')), raw=report.opaqueSurface;
  assert.deepEqual([raw.width,raw.height,raw.rows],[120,80,'top-down']);
  assert.deepEqual(raw.files.surfaceUV,{file:'surfaceUV.f32le',format:'f32le',components:2});
  assert.deepEqual(raw.files.materialId,{file:'materialId.u32le',format:'u32le',components:1});
  assert.equal(fs.statSync(path.join(folder,raw.files.objectPosition.file)).size,120*80*12);
  const kind=fs.readFileSync(path.join(folder,raw.files.surfaceKind.file));
  const motion=fs.readFileSync(path.join(folder,raw.files.surfaceMotionValid.file));
  assert(kind.includes(1)&&kind.includes(2));
  assert(kind.some((id,p)=>id===1&&motion[p]===255));
  const sources = report.sourceBindings;
  assert.equal(sources.surfaceSources.find(source=>source?.chart === 'sluice-screen').kind,'mesh');
  assert.deepEqual(sources.files.sourceCoordinates,{file:'sourceCoordinates.f32le',format:'f32le',components:3});
  assert.deepEqual(sources.files.sourceSplatWeight,{file:'sourceSplatWeight.f32le',format:'f32le',components:4});

  assert(kind.some((id,p)=>id===2&&motion[p]===255));
});

test('perspective clipping keeps authored UV and rest coordinates aligned with the visible triangle',()=>{
  const atlas=SpriteSurface.make(8), vertices=[0,.02,-.04,-.7,-.4,-1,.7,-.4,-1];
  atlas.mesh({points:vertices,restPoints:vertices.map(n=>n*2),uvs:[0,0,1,0,0,1],triangles:[0,1,2]},
    4,4,()=>0x8899aa,{id:'near-triangle'});
  const raster=require('../cli/sprite-surfaces.js');
  const hits=raster.rasterize(atlas.finish(),{V:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],
    W:40,H:30,near:.1,focal:22,capture:true,motion:true,sourceBinding:true});
  assert(hits.length>10);
  for(const hit of hits) {
    const [u,v]=hit.uv;
    close(hit.position[0],-.7*u+.7*v);
    close(hit.position[2],-.04*(1-u-v)-u-v);
    hit.position.forEach((n,i)=>close(hit.objectPosition[i],n*2));
    close(hit.weights[0]+hit.weights[1]+hit.weights[2],1);
    assert.equal(hit.source.triangle,0);
    assert.deepEqual(hit.source.coordinate,hit.weights);
  }
});
