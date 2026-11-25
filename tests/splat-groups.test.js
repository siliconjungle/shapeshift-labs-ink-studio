'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const ink = require('..');
const Fit = require('../cli/splat-fit-asset.js');
const Footprints = require('../src/splat-footprints.js');
const { M, V } = ink.load().KIT;
const target = {object:'ribbon'};
const points = [[0,0,0],[.2,.75,0],[-.2,1.5,0],[0,2,0]];
const close = (a,b) => assert.ok(Math.abs(a-b)<2e-6,`${a} differs from ${b}`);

async function fixture(up = 'y') {
  const degree=4, count=points.length;
  const world=await ink.gaussianSplatWorld({
    degree,count,positions:Float32Array.from(points.flat()),dc:new Float32Array(count*3),
    opacity:new Float32Array(count).fill(1),scales:Float32Array.from(points.flatMap(()=>[.22,.31,.025])),
    rotations:Float32Array.from(points.flatMap(()=>[0,0,0,1])),
    sh:Float32Array.from({length:count*24*3},(_,i)=>Math.sin(i*13.79)*.027)
  },{colorMode:'rgb',objectId:'ribbon',size:2,up});
  world.id='ribbon-fixture';
  world.splatIds=['base','lower','upper','tip'];
  world.splatFootprints=Footprints.layout(count,[{shape:'square',softness:.1}],
    new Uint16Array(count).fill(1),Float32Array.from(points.flatMap(()=>[.2,0,0,0,.3,0])));
  return world;
}

const bend={type:'bend',axis:[0,1,0],side:[1,0,0],length:1.4,angle:45};

test('splat groups retain pins, order, footprint transforms, replay, and protected row identities',async ()=>{
  const world=await fixture();
  const original=world.data.slice();
  const base={format:Fit.format,version:2,target,scene:world.id,edits:[],
    attributes:[['lower',{position:[.3,-.25,0],pigment:0xc2684c}]]};
  const groups=[
    {id:'curl',pivot:[0,-1,0],members:['base','lower','upper','tip'],mask:[['base',0],['lower',.8]],
      falloff:{center:[0,-.5,0],inner:.1,outer:1.1},modifiers:[bend]},
    {id:'trim',pivot:[0,-1,0],members:['lower','upper'],mask:[['upper',.5]],
      modifiers:[{type:'taper',axis:[0,1,0],length:1.4,amount:-.2}]}
  ];
  const {asset,report}=ink.planSplatGroups(world,{target,groups,base});
  assert.equal(report.groups[0].pinned,2);
  assert.equal(report.changedRows,2);
  assert.equal(report.directionalRows,2);
  assert.deepEqual(asset.attributes,base.attributes);
  const baked=ink.bakeSplatFit(world,asset);
  const after=ink.bakeSplatFit(world,JSON.parse(JSON.stringify(asset)));
  assert.deepEqual(baked.data,after.data);
  assert.deepEqual(baked.gaussianHarmonics.sh,after.gaussianHarmonics.sh);
  assert.deepEqual(baked.splatIds,world.splatIds);
  assert.deepEqual(Array.from(baked.splatLodProtected),[0,1,1,0]);
  for (const row of [0,3]) {
    assert.deepEqual(baked.data.slice(row*16,row*16+16),original.slice(row*16,row*16+16));
    assert.deepEqual(baked.gaussianHarmonics.sh.slice(row*72,row*72+72),world.gaussianHarmonics.sh.slice(row*72,row*72+72));
  }
  assert.notDeepEqual(baked.data.slice(16,19),original.slice(16,19));
  assert.notDeepEqual(baked.splatFootprints.frames.slice(6,12),world.splatFootprints.frames.slice(6,12));
  assert.deepEqual(world.data,original);
  const reverse=ink.planSplatGroups(world,{target,groups:groups.slice().reverse(),base}).asset;
  assert.notDeepEqual(ink.bakeSplatFit(world,reverse).data,baked.data);
  const settings={w:112,h:80,px:1,ortho:true,scanAppearance:1,passes:['coverage','depth']};
  const a=ink.render(world,settings), b=ink.render(world,{...settings,splatFit:asset});
  assert.notDeepEqual(a.passes.coverage,b.passes.coverage);
  assert.notDeepEqual(a.passes.depth,b.passes.depth);
  const fit=Fit.prepare(world,asset), materialized=Fit.renderWorld(world,fit);
  assert.equal(Fit.renderWorld(materialized,fit),materialized);
  const filtered={...settings,raw:true,coverageFilter:true};
  const onlyGroups={...asset,attributes:[]};
  assert.deepEqual(ink.render(world,{...filtered,splatFit:onlyGroups}).rgb,
    ink.render(ink.bakeSplatFit(world,onlyGroups),filtered).rgb);
  const reduced=ink.bakeSplatFit(world,{...asset,edits:[],attributes:[...asset.attributes,['base',{coverage:0}]]});
  assert.deepEqual(reduced.splatIds,['lower','upper','tip']);
  assert.deepEqual(reduced.gaussianHarmonics.sh.slice(0,72),baked.gaussianHarmonics.sh.slice(72,144));
});

test('lattice rotation carries native footprints and all four directional bands for both scan up axes',async ()=>{
  const rotation=M.rot([0,0,1],Math.PI/3), handles = [];
  for (const x of [0,1]) for (const y of [0,1]) for (const z of [0,1]) {
    const corner=[x,y,z].map(n=>2*n-1);
    handles.push({at:[x,y,z],offset:V.sub(M.app(rotation,corner),corner)});
  }
  const groups=[{id:'turn',pivot:[0,0,0],members:['lower','upper'],
    modifiers:[{type:'lattice',bounds:{min:[-1,-1,-1],max:[1,1,1]},size:[2,2,2],handles}]}];
  const { gaussianSplatColors }=await import('../src/gaussian-splats.mjs');
  for (const up of ['y','z']) {
    const world=await fixture(up);
    const {asset}=ink.planSplatGroups(world,{target,groups});
    const turned=ink.bakeSplatFit(world,asset), i=1, q=i*16;
    M.app(rotation,world.data.slice(q,q+3)).forEach((v,k)=>close(turned.data[q+k],v));
    M.app(rotation,[.2,0,0]).forEach((v,k)=>close(turned.splatFootprints.frames[i*6+k],v));
    [4,5,6,8,9,10].forEach((k,j)=>close(turned.data[q+k],
      ink.load().KIT.splatFrames.covariance(world.data,q,rotation,M)[[0,1,2,4,5,8][j]]));
    for (const back of [[.2,.4,1],[-.1,.7,.4],[.7,-.9,-.2]]) {
      const a=gaussianSplatColors(world,i,{ortho:true,back});
      const b=gaussianSplatColors(turned,i,{ortho:true,back:M.app(rotation,back)});
      assert.deepEqual(a.base,b.base);
      a.rgb.forEach((v,k)=>assert.ok(Math.abs(v-b.rgb[k])<=1));
    }
    assert.notDeepEqual(turned.gaussianHarmonics.sh,world.gaussianHarmonics.sh);
  }
});

test('group edits reject unavailable members, bad scopes and a folded lattice before rendering',async ()=>{
  const world=await fixture();
  const group={id:'bend',members:['lower'],pivot:[0,-1,0],modifiers:[bend]};
  const plan=(groups,scope=target)=>ink.planSplatGroups(world,{target:scope,groups});
  assert.throws(()=>plan([{...group,members:['lost']}]),/unavailable splat group member/);
  assert.throws(()=>plan([group],{object:'other'}),/unavailable splat group member/);
  assert.throws(()=>plan([{...group,mask:[['base',0]]}]),/mask needs/);
  const handles=[[0,0,0],[0,0,1],[0,1,0],[0,1,1],[1,0,0],[1,0,1],[1,1,0],[1,1,1]]
    .map(at=>({at,offset:[at[0] ? -2 : 2,0,0]}));
  const lattice={type:'lattice',bounds:{min:[-1,-1,-1],max:[1,1,1]},size:[2,2,2],handles};
  assert.throws(()=>plan([{...group,pivot:[0,0,0],modifiers:[lattice]}]),/folds or collapses/);
});

test('pixel transactions preview group diffs, invalidate prior footprint hits, and keep groups through later row edits',async ()=>{
  const world=await fixture();
  const document={format:'ink-studio/pixel-art',version:2,width:80,height:80,pixelAspect:[1,1],
    palette:{copper:'#c2684c'},layers:[{id:'ink'}],frames:[{id:'front',durationMs:100,cels:{}}],
    sceneBindings:[{id:'ribbon',scene:world.id,object:'ribbon'}],
    destinations:[{id:'splats',kind:'splat-attributes',binding:'ribbon'}]};
  const editor=ink.createPixelEditor(document), context={world:()=>world};
  const patch=(id,operation)=>({id,destination:'splats',frame:'front',revision:editor.describe().revision,
    sourceRevision:editor.targets('splats',context).sourceRevision,operation});
  const groups=[{id:'curl',pivot:[0,-1,0],members:['lower','upper'],modifiers:[bend]}];
  const apply=patch('curl-ribbon',{groups});
  const preview=editor.previewEdit(apply,context);
  assert.equal(preview.valid,true,JSON.stringify(preview.conflicts));
  assert.equal(preview.targets[0].attributeHits.length,2);
  assert(preview.targets[0].render.coverageChanged>0);
  const asset=editor.apply(apply,context);
  assert.deepEqual(editor.renderOptions(world.id).splatFit,asset);
  const live={...world,look:{...world.look,splatFit:asset}};
  const { rowRevision }=require('../cli/pixel-source-passes.js');
  assert.notEqual(rowRevision(world,1),rowRevision(Fit.renderWorld(live,Fit.prepare(live,asset)),1));
  const hit=editor.targets('splats',context).splats.find(row=>row.id==='upper');
  assert.notDeepEqual(hit.at,hit.attributes.position);
  assert.equal(hit.deformation.length,9);
  const changed=editor.apply(patch('paint-tip',{splats:[{splat:'tip',pigment:'copper'}]}),context);
  assert.deepEqual(changed.groups,groups);
  assert.deepEqual(changed.attributes,[['tip',{pigment:0xc2684c}]]);
  assert.equal(editor.undo(),true);
  assert.deepEqual(editor.renderOptions(world.id).splatFit,asset);
  assert.equal(editor.undo(),true);
  assert.deepEqual(editor.renderOptions(world.id),{});
  assert.equal(editor.redo(),true);
  assert.deepEqual(editor.renderOptions(world.id).splatFit,asset);
  assert.deepEqual(editor.apply(patch('clear',{groups:[]}),context).groups,[]);
});
