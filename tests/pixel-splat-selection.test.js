const assert=require('node:assert/strict');
const {test}=require('node:test');
const {execFileSync}=require('node:child_process');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const ink=require('..');
const {splatBuffer}=require('../cli/pixel-source-passes.js');
const {KIT,makeBuilder}=ink.load();

const view={w:64,h:48,px:1,t:0,transparent:true,passes:['sourceSplat']};
const cli=(...args)=>JSON.parse(execFileSync(process.execPath,[path.join(__dirname,'../cli/ink-studio.js'),'pixel-art',...args],
  {encoding:'utf8'}));

function fixture({makeBuilder}, offset=0) {
  const B=makeBuilder(2,[0x19212d,0xe9c457,0x48b4a0,0x604e48]);
  function splat(i,id,x,z,part,material,opacity,shift=0) {
    B.iso(x+shift,0,z,.63,B.P[1+i%3],opacity,{splatId:id,nd:opacity<1});
    B.describeSplats(i,i+1,{object:'model',material,target:{entity:'plant',part}});
  }
  splat(0,'back',0,-.6,'stem','enamel',3);
  splat(1,'stem-chip',0,0,'stem','enamel',3,offset);
  splat(2,'veil',0,.6,'fringe','glass',.28);
  splat(3,'leaf-chip',1.85,0,'leaf','enamel',3);
  return B.finish({id:'splat-pick',cam:{target:[0,0,0],dist:4,ortho:true,yaw:0,pitch:0,sway:0},dither:0});
}

function design(scene, canvas) {
  return {format:'ink-studio/pixel-art',version:2,width:3,height:1,pixelAspect:[1,1],
    palette:{mint:'#38ac99'},layers:[{id:'ink'}],frames:[{id:'front',durationMs:100,cels:{}}],
    sceneBindings:[{id:'plant',scene,object:'plant',frame:'front',canvas}],
    destinations:[{id:'splats',kind:'splat-attributes',binding:'plant'}],
    selections:[{id:'detail',frame:'front',pixels:[[1,0]]}]};
}

test('splat targeting combines visible contributions with part, material and rest regions',()=>{
  const world=fixture({makeBuilder}), renderFrame=ink.render(world,view);
  const doc=design('splat-pick',{size:[64,48],offset:[31,24],scale:[1,1]});
  const editor=ink.createPixelEditor(doc), context={world:()=>world,renderFrame};
  const query=(query,extra={})=>editor.targets('splats',{...context,query,...extra});
  const ids=result=>result.splats.map(row=>row.id);
  assert.deepEqual(ids(query({material:'enamel'})),['back','leaf-chip','stem-chip']);
  assert.deepEqual(ids(query({part:'stem',material:'enamel',region:{min:[-.1,-.1,-.5],max:[.1,.1,.1]}})),['stem-chip']);
  const picked=query({footprint:{selection:'detail'},minContribution:.05});
  assert.deepEqual(ids(picked),['stem-chip','veil']);
  assert.deepEqual(picked.splats.map(row=>row.editable),[true,false]);
  assert.deepEqual(picked.splats[0].sourceAt,[32,24]);
  assert(picked.splats[0].peakContribution<1);
  assert(picked.splats[0].peakContribution>picked.splats[1].peakContribution);
  assert.deepEqual(ids(query({footprint:{at:[1,0]},minContribution:.45})),['stem-chip']);
  assert.deepEqual(ids(query({footprint:{rect:[0,0,3,1]},material:'glass',editableOnly:true})),[]);
  assert.deepEqual(ids(query({minContribution:.45,part:'stem'})),['stem-chip']);
  assert.equal(picked.selection.footprint.sampledPixels,1);
  assert.equal(picked.selection.footprint.omittedPixels,0);
  assert.equal(query({material:'enamel'},{limit:1}).count,3);
  assert.throws(()=>query({footprint:{at:[3,0]}}),/outside the native grid/);
});

test('the cursor retains weak foreground splats and reports the remaining omitted coverage',()=>{
  const B=makeBuilder(0,[0x75828b]), capture=splatBuffer(2);
  for (let i=0;i<6;i++) {
    B.iso(i,0,0,.5,B.P[0],2,{splatId:'source-'+i});
    B.describeSplats(i,i+1,{object:'model',target:{entity:'plant'}});
    for (let p=0;p<2;p++) capture.add(p,i,i===5?.008:.2,6-i);
  }
  capture.add(1,-1,1,.5);
  const world=B.finish(), passes={w:2,h:1,...capture.finish(world,array=>array)};
  const doc=design('splat-pick',{size:[2,1],offset:[0,0],scale:[1,1]});
  const editor=ink.createPixelEditor(doc), context={world:()=>world,renderFrame:{w:2,h:1,passes}};
  const picked=editor.targets('splats',{...context,query:{footprint:{at:[0,0]}}});
  assert(picked.splats.some(row=>row.id==='source-5'));
  assert.equal(picked.count,5);
  assert.equal(picked.selection.footprint.omittedPixels,1);
  assert(picked.selection.footprint.maxOmittedCoverage>0);
  const blocked=editor.targets('splats',{...context,query:{footprint:{at:[1,0]}}});
  assert.equal(blocked.count,0);
});

test('derived splat IDs follow the rest data when a pose moves the selected part',()=>{
  const B=makeBuilder(0,[0x728080]);
  B.iso(0,0,0,.55,B.P[0],3);
  B.describeSplats(0,1,{object:'plant',material:'enamel'});
  const world=B.finish({cam:{target:[0,0,0],dist:4,ortho:true,yaw:0,pitch:0,sway:0}});
  const stage=KIT.stage(world), rig=KIT.rig.fromGroups(stage,{stem:[0]});
  const raw=design('splat-pick',{size:[64,48],offset:[31,24],scale:[1,1]});
  const editor=ink.createPixelEditor(raw), context={world:()=>world};
  const before=editor.targets('splats',{...context,query:{part:'stem'}});
  rig.set('stem',KIT.M.id(),[0,0,0],[.11,0,0]);
  rig.apply();
  const renderFrame=ink.render(world,view);
  const after=editor.targets('splats',{...context,renderFrame,query:{footprint:{at:[1,0]},part:'stem'}});
  assert.equal(before.count,1);
  assert.equal(after.count,1);
  assert.equal(after.splats[0].id,before.splats[0].id);
  assert.deepEqual(after.splats[0].at,[0,0,0]);
  assert.equal(after.splats[0].editable,false);
});

test('CLI picks from a live or saved footprint and the guarded IDs drive a splat fit',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-splat-selection-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file=name=>path.join(dir,name);
  const scene=file('scene.js'), viewFile=file('view.json'), queryFile=file('query.json'), doc=file('document.json');
  const build=offset=>fs.writeFileSync(scene,`module.exports = api => ({id:'splat-pick',build:()=> (${fixture.toString()})(api,${offset})});`);
  build(0);
  fs.writeFileSync(doc,JSON.stringify(design(scene,{size:[64,48],offset:[31,24],scale:[1,1]})));
  fs.writeFileSync(queryFile,JSON.stringify({footprint:{selection:'detail'},minContribution:.1,editableOnly:true}));
  execFileSync(process.execPath,[path.join(__dirname,'../cli/ink-studio.js'),'pixel-art','capture',
    scene,'--w','64','--h','48','--out',viewFile],{stdio:'pipe'});
  const args=['targets',doc,'--destination','splats','--scene',scene,'--query',queryFile];
  const live=cli(...args), saved=cli(...args,'--source-view',viewFile);
  assert.equal(live.count,1);
  assert.equal(live.splats[0].id,'stem-chip');
  assert.deepEqual(saved.splats,live.splats);
  assert.equal(saved.sourceRevision,live.sourceRevision);
  const patch=file('edit.json'), out=file('fit.json');
  fs.writeFileSync(patch,JSON.stringify({id:'mint-enamel',frame:'front',destination:'splats',
    revision:live.documentRevision,sourceRevision:live.sourceRevision,
    operation:{splats:live.splats.map(row=>({splat:row.id,pigment:'mint'}))}}));
  const receipt=cli('edit',doc,patch,'--scene',scene,'--out',out);
  assert.equal(receipt.status,'applied');
  assert.deepEqual(JSON.parse(fs.readFileSync(out,'utf8')).attributes,[['stem-chip',{pigment:0x38ac99}]]);
  build(.12);
  const stale=cli(...args,'--source-view',viewFile);
  assert.equal(stale.count,0);
  assert.equal(stale.selection.footprint.staleIds,1);
});

test('session footprint queries use the retained splat fit from the current edit revision',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-splat-selection-session-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file=name=>path.join(dir,name);
  const scene=file('scene.json'), doc=file('document.json'), queryFile=file('query.json'), session=file('session');
  fs.writeFileSync(scene,JSON.stringify({id:'painted-plant',style:'slate',
    camera:{target:[0,0,0],dist:4,projection:'orthographic',yaw:0,pitch:0,sway:0},
    solids:[{id:'plant',kind:'box',at:[0,0,0],half:[.8,.65,.22],res:.12,mat:'stone'}]}));
  fs.writeFileSync(doc,JSON.stringify(design(scene,{size:[64,48],offset:[31,24],scale:[1,1]})));
  fs.writeFileSync(queryFile,JSON.stringify({footprint:{selection:'detail'},editableOnly:true}));
  cli('session','init',session,doc,'--scene',scene);
  const targets=()=>cli('session','targets',session,'--destination','splats','--query',queryFile);
  const before=targets();
  assert(before.count>0);
  const patch=file('hide.json');
  fs.writeFileSync(patch,JSON.stringify({id:'hide-dabs',frame:'front',destination:'splats',
    revision:before.documentRevision,sourceRevision:before.sourceRevision,
    operation:{splats:before.splats.map(row=>({splat:row.id,visible:false}))}}));
  assert.equal(cli('session','apply',session,patch).status,'applied');
  const after=targets();
  assert.notEqual(after.sourceRevision,before.sourceRevision);
  assert(after.splats.every(row=>!before.splats.some(old=>old.id===row.id)));
});
