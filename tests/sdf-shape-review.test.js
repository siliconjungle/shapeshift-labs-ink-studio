const assert=require('node:assert/strict');
const test=require('node:test');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const ink=require('..');
const {measure}=require('../cli/sdf-shape-review.js');
const PNG=require('../cli/png.js');

function frame(labels,depth,kind,table,missing=[]) {
  const scale=3,w=labels.length*scale,h=scale,n=w*h;
  const passes={ objects:[null,'plate'], materials:table, surfaceKind:new Uint8Array(n),
    materialId:new Uint32Array(n),objectId:new Uint32Array(n),
    surfaceCoverage:new Float32Array(n),depth:new Float64Array(n).fill(Infinity) };
  for (const [x,material] of labels.entries()) {
    if (!material) continue;
    for (let y=0;y<scale;y++) for (let u=0;u<scale;u++) {
      const p=y*w+x*scale+u;
      if (missing.includes(p)) continue;
      passes.surfaceKind[p]=kind;
      passes.objectId[p]=1;
      passes.materialId[p]=table.indexOf(material);
      passes.surfaceCoverage[p]=1;
      passes.depth[p]=depth[x];
    }
  }
  return {w,h,passes,rgb:new Uint8Array(n*3).fill(40)};
}

test('silhouette misses, fractional coverage, depth and material seam shifts are independently measured',()=>{
  const sdf=frame(['stone','stone','trim','trim','stone',null],[3,4,5,6,7,8],2,[null,'stone','trim']);
  const mesh=frame(['stone','trim','trim','trim',null,'stone'],[3,4.5,4.75,6,7,8],1,[null,'trim','stone'],[0]);
  const {metrics,maps}=measure(sdf,mesh,{w:6,h:1,coverageSamples:3,coverageTolerance:.05,depthTolerance:.1,objectId:'plate'});
  assert.deepEqual(metrics.silhouette,{sdfPixels:5,meshPixels:5,missingPixels:1,extraPixels:1,
    intersectionPixels:4,unionPixels:6,errorFraction:2/6});
  assert.equal(metrics.coverage.comparedPixels,6);
  assert.equal(metrics.coverage.sdfArea,5);
  assert.equal(metrics.coverage.meshArea,5-1/9);
  assert(Math.abs(metrics.coverage.meanAbsolute-(2+1/9)/6)<1e-12);
  assert.equal(metrics.coverage.pixelsAbove,3);
  assert.equal(metrics.depth.matchedPixels,4);
  assert.equal(metrics.depth.p95Absolute,.5);
  assert.equal(metrics.depth.meanSigned,.0625);
  assert.equal(metrics.depth.pixelsAbove,2);
  assert.deepEqual(metrics.material,{comparedPixels:4,mismatchPixels:1,errorFraction:.25});
  assert.deepEqual(metrics.seams,{comparedEdges:3,sdfEdges:1,meshEdges:1,missingEdges:1,extraEdges:1,matchedEdges:0,
    changedPairs:0,errorFraction:1});
  assert.deepEqual(Array.from(maps.silhouette.subarray(16,24)),[253,166,73,255,84,215,237,255]);
  assert.equal(maps.mesh[4*4+3],0);
});

test('SDK can review a pinned revision after the live field advances',t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ink-pinned-geometry-review-'));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const {KIT,makeBuilder}=ink.load(), P=KIT.procedural;
  const bricks=P.sparseBricks.create({cell:.125,brickSize:6,
    base:(x,y,z)=>Math.max(Math.abs(x)-.85,Math.abs(y)-.62,Math.abs(z)-.22)});
  const field=P.brickMeshes.create({bricks,objectId:'plate',
    bounds:{min:[-1.05,-.85,-.5],max:[1.05,.85,.5]},materials:[{id:'stone',color:0xc58171}]});
  const before=field.current();
  field.edit({operation:'subtract',bounds:{min:[-.5,-.5,-.5],max:[.5,.5,.5]},
    sdf:(x,y,z)=>Math.max(Math.abs(x)-.33,Math.abs(y)-.35,Math.abs(z)-.6)});
  const world=makeBuilder(1,undefined,{initialCapacity:1}).finish({id:'panel',brickMeshes:[before]});
  const views=[{id:'front',yaw:0,pitch:0},{id:'back-oblique',yaw:2.4,pitch:.25,ortho:false}];
  const report=ink.reviewSdfShape(world,directory,{w:48,h:36,views});
  assert.equal(report.revision,before.revision);
  assert.equal(field.current().revision,before.revision+1);
  assert(report.views.every(view=>view.metrics.depth.matchedPixels>0));
  const camera={w:49,h:35,px:1,target:[0,0,0],dist:4,yaw:0,pitch:0,ortho:true,raw:true,passes:['depth']};
  assert(Number.isFinite(ink.render(world,camera).passes.depth[17*49+24]));
  assert.equal(ink.render({...world,brickMeshes:[field]},camera).passes.depth[17*49+24],Infinity);
  assert.equal(report.views[1].camera.ortho,false);
  assert.deepEqual(PNG.read(path.join(directory,report.comparison)).w,48*6);
});

test('CLI writes paired views, diagnostic maps and limit flags for the time-selected edit',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-shape-cli-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const profile=path.join(dir,'plan.json');
  fs.writeFileSync(profile,JSON.stringify({views:[{id:'front',yaw:0,pitch:0},{id:'high',yaw:.28,pitch:1.1}],
    limits:{seamError:0}}));
  const cwd=path.resolve(__dirname,'..');
  const result=spawnSync(process.execPath,['cli/ink-studio.js','sdf-shape-review','examples/brick-mesh-gate.js',
    '--t','1.2','--w','96','--h','64','--profile',profile,'--out',dir,'--fail-on-flags'],{cwd,encoding:'utf8'});
  assert.equal(result.status,2,result.stderr);
  const report=JSON.parse(fs.readFileSync(path.join(dir,'report.json'),'utf8'));
  assert.equal(report.format,'ink-studio/sdf-shape-review');
  assert.equal(report.object,'sluice-gate');
  assert.equal(report.revision,2);
  assert.equal(report.time,1.2);
  assert.equal(report.coverageSamples,3);
  assert.deepEqual(report.views.map(v=>v.id),['front','high']);
  assert(report.flags.some(row=>row.view==='front'&&row.metric==='seamError'&&row.actual>0));
  for(const view of report.views) {
    assert(view.metrics.silhouette.sdfPixels>0&&view.metrics.silhouette.meshPixels>0);
    assert.deepEqual(Object.keys(view.files),report.columns);
    for(const file of Object.values(view.files)) {
      const picture=PNG.read(path.join(dir,file));
      assert.deepEqual([picture.w,picture.h],[96,64]);
    }
  }
  const board=PNG.read(path.join(dir,report.comparison));
  assert.deepEqual([board.w,board.h],[96*6,64*2]);
});
