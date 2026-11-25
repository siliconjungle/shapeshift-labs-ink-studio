'use strict';

const assert = require('node:assert/strict');
const {test}=require('node:test');
const ink=require('..');
const Fit=require('../cli/splat-fit-asset.js');
const Provenance=require('../src/splat-provenance.js');

const target={object:'clasp'};
const split={op:'split',splat:'broad',children:[
  {id:'broad-a',offset:[-.14,.02,0]}, {id:'broad-b',offset:[.14,-.02,0]}
]};
const merge={op:'merge',id:'near-merged',from:['near-a','near-b']};
const review={width:110,height:84,views:[{id:'front',yaw:0,pitch:0,ortho:true},
  {id:'raking',yaw:.5,pitch:.2,ortho:true}]};
const close=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-6,`${actual} differs from ${expected}`);

async function fixture() {
  const count=3, degree=1;
  const world=await ink.gaussianSplatWorld({
    count,degree,positions:Float32Array.from([-.7,0,0,.7,.04,0,.79,-.04,.01]),
    opacity:Float32Array.from([.7,.42,.45]),dc:Float32Array.from([.4,.55,.68,.4,.55,.68,.53,.55,.6]),
    rotations:Float32Array.from({length:count*4},(_,i)=>+(i%4===3)),
    scales:Float32Array.from([.38,.5,.29,.32,.44,.23,.32,.44,.23]),
    sh:Float32Array.from({length:count*9},(_,i)=>.04+i*.001)
  },{objectId:'clasp',colorMode:'rgb',size:3});
  world.id='clasp-fixture';
  world.splatIds=['broad','near-a','near-b'];
  return world;
}

test('reviews each family from both angles and retains split/merge lineage and Gaussian scan data',async()=>{
  const world=await fixture(), original=world.data.slice(), originalSH=world.gaussianHarmonics.sh.slice();
  const {asset,report}=ink.planSplatRedistribution(world,{target,operations:[split,merge],review});
  assert.ok(asset,JSON.stringify(report.views));
  assert.equal(report.views.length,2);
  for (const view of report.views) for (const family of view.families) {
    assert(family.pixels.shared>0);
    assert.deepEqual(Object.keys(family.errors),['opacity','pigment','depth','silhouette']);
    assert.equal(family.passed,true);
  }
  const fit=Fit.prepare(world,asset);
  const output=Fit.renderWorld(world,fit);
  const ids=Provenance.identities(Fit.sourceWorld(world,fit));
  assert.deepEqual(Fit.lifecycle(output,ids.rowOf('broad')).retired.replacedBy,['broad-a','broad-b']);
  assert.deepEqual(Fit.lifecycle(output,ids.rowOf('near-merged')).created.from,merge.from);
  const baked=ink.bakeSplatFit(world,asset);
  assert.deepEqual(baked.splatIds,['broad-a','broad-b','near-merged']);
  assert.deepEqual(baked.splatLineage.get('near-a').retired.replacedBy,['near-merged']);
  assert.deepEqual(baked.splatLineage.get('broad-b').created.from,['broad']);
  close((baked.data[0]+baked.data[16])/2,world.data[0]);
  close(baked.data[4]+((baked.data[0]-baked.data[16])/2)**2,world.data[4]);
  assert.deepEqual(baked.gaussianHarmonics.sh.slice(0,9),world.gaussianHarmonics.sh.slice(0,9));
  assert.deepEqual(baked.gaussianHarmonics.sh.slice(9,18),world.gaussianHarmonics.sh.slice(0,9));
  const weights=asset.topology[1].weights;
  for (let k=0;k<9;k++) close(baked.gaussianHarmonics.sh[18+k],
    world.gaussianHarmonics.sh[9+k]*weights[0]+world.gaussianHarmonics.sh[18+k]*weights[1]);
  assert.deepEqual(ink.bakeSplatFit(world,JSON.parse(JSON.stringify(asset))).data,baked.data);
  assert.deepEqual(world.data,original);
  assert.deepEqual(world.gaussianHarmonics.sh,originalSH);
});

test('strict or invisible review blocks publication and keeps per-family evidence',async()=>{
  const world=await fixture();
  const rejected=ink.planSplatRedistribution(world,{target,operations:[split,merge],
    review:{...review,tolerances:{opacity:0,pigment:0,depth:0,silhouette:0}}});
  assert.equal(rejected.asset,null);
  assert.equal(rejected.report.passed,false);
  assert(rejected.report.views.every(view=>view.families.some(family=>family.failed.includes('opacity'))));
  const offscreen=ink.planSplatRedistribution(world,{target,operations:[split],
    review:{...review,views:review.views.map(view=>({...view,target:[100,90,0]}))}});
  assert.equal(offscreen.asset,null);
  assert(offscreen.report.views.every(view=>view.families[0].failed.includes('insufficient-visible-overlap')));
  assert.throws(()=>ink.planSplatRedistribution(world,{target,operations:[split],review:{...review,
    views:[review.views[0],{...review.views[0],id:'same'}]}}),/distinct review angles/);
  assert.throws(()=>ink.planSplatRedistribution(world,{target,operations:[{...split,children:[
    {...split.children[0],offset:[-20,0,0]}, {...split.children[1],offset:[20,0,0]}
  ]}],review}),/positive definite/);
});

test('ordered families can recombine, and pixel transactions preview, guard, and undo the redistribution',async()=>{
  const world=await fixture();
  const plan=ink.planSplatRedistribution(world,{target,operations:[split,{op:'merge',id:'rejoined',from:['broad-a','broad-b']}],review});
  assert.ok(plan.asset);
  assert.deepEqual(plan.report.views[0].families.map(({sources,outputs})=>({sources,outputs})),
    [{sources:['broad'],outputs:['rejoined']}]);
  const document={format:'ink-studio/pixel-art',version:2,width:110,height:84,pixelAspect:[1,1],
    palette:{rose:'#ac5362'},layers:[{id:'ink'}],frames:[{id:'front',durationMs:100,cels:{}}],
    sceneBindings:[{id:'clasp',scene:world.id,object:'clasp'}],
    destinations:[{id:'topology',kind:'splat-attributes',binding:'clasp'}]};
  const context={world:()=>world};
  const editor=ink.createPixelEditor(document);
  const patch=(id,review)=>({id,destination:'topology',frame:'front',revision:editor.describe().revision,
    sourceRevision:editor.targets('topology',context,{limit:1}).sourceRevision,operation:{topology:[split],review}});
  const denied=patch('zero-tolerance',{...review,tolerances:{opacity:0}});
  const fail=editor.previewEdit(denied,context);
  assert.equal(fail.valid,false);
  assert.equal(fail.conflicts[0].code,'splat-redistribution-review');
  assert.throws(()=>editor.apply(denied,context),/exceeded the review/);
  assert.deepEqual(editor.renderOptions(world.id),{});
  const request=patch('split-clasp',review);
  const pass=editor.previewEdit(request,context);
  assert.equal(pass.valid,true,JSON.stringify(pass.conflicts));
  assert.equal(pass.targets[0].redistribution.passed,true);
  assert.equal(pass.targets[0].topologyHits.length,3);
  const fit=editor.apply(request,context);
  assert.deepEqual(fit,editor.renderOptions(world.id).splatFit);
  assert.equal(editor.undo(),true);
  assert.deepEqual(editor.renderOptions(world.id),{});
  assert.equal(editor.redo(),true);
  assert.deepEqual(fit,editor.renderOptions(world.id).splatFit);
});

test('native opaque splats keep the hard density and pass a modest split',()=>{
  const B=ink.load().makeBuilder(4,[0x131d2a,0xe6ab75]);
  B.iso(0,0,0,.45,B.P[1],3,{splatId:'broad'});
  B.describeSplats(0,1,{object:'clasp',part:'main',material:'copper'});
  const world=B.finish({id:'native',cam:{target:[0,0,0],yaw:0,pitch:0,dist:4,ortho:true}});
  const {asset}=ink.planSplatRedistribution(world,{target,operations:[{...split,children:[
    {...split.children[0],offset:[-.05,0,0]}, {...split.children[1],offset:[.05,0,0]}
  ]}],review});
  assert.ok(asset);
  assert.deepEqual(asset.topology[0].children.map(child=>child.opacity),[3,3]);
});

test('split carries the current group-deformed scan and pigment while leaving retained group peers unchanged',async()=>{
  const world=await fixture();
  const group={id:'bow',pivot:[0,-1,0],members:['broad','near-a'],
    modifiers:[{type:'bend',axis:[0,1,0],side:[0,0,1],length:2,angle:19}]};
  const {asset:groupFit}=ink.planSplatGroups(world,{target,groups:[group]});
  const base={...groupFit,attributes:[['broad',{pigment:0xa5b35f,opacity:.68}]]};
  const before=Fit.renderWorld(world,Fit.prepare(world,base));
  const {asset,report}=ink.planSplatRedistribution(world,{target,operations:[split],review,base});
  assert.ok(asset,JSON.stringify(report.views));
  assert.deepEqual(asset.groups[0].members,['near-a']);
  const baked=ink.bakeSplatFit(world,asset);
  for (const [i,id] of baked.splatIds.entries()) {
    if (id==='near-a') assert.deepEqual(baked.data.slice(i*16,i*16+16),before.data.slice(16,32));
    if (id.startsWith('broad-')) {
      assert.equal(Fit.pigmentAt(baked,i),0xa5b35f);
      assert.deepEqual(baked.gaussianHarmonics.sh.slice(i*9,i*9+9),before.gaussianHarmonics.sh.slice(0,9));
    }
  }
});
