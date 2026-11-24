'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const ink = require('..');

const document = {
  format:'ink-studio/pixel-art',version:2,width:7,height:5,pixelAspect:[1,1],
  palette:{red:'#b4383d',blue:'#323991'},layers:[{id:'ink'},{id:'overlay'}],
  frames:[{id:'front',durationMs:100,cels:{
    ink:{marks:[{swatch:'red',at:[2,2]}]},overlay:{marks:[{swatch:'blue',at:[2,2]}]}
  }}],
  protectedDetails:[{id:'letter-gap',kind:'gap',pixels:[[3,2]]}]
};
const scene = {id:'dry-gate',style:'slate',
  camera:{target:[0,0,0],dist:4,pitch:0,yaw:0,projection:'orthographic',sway:0},
  finish:{look:{sdfAssist:true}},
  solids:[{id:'gate',kind:'box',at:[0,0,0],half:[.8,.7,.23],res:.15,mat:'stone',
    surfaceState:{charts:{front:{origin:[-.8,-.7,.23],u:[1.6,0,0],v:[0,1.4,0],depth:.08}}}}]
};
function sceneDocument(scene) {
  return { ...document,width:40,height:32,protectedDetails:[{id:'rail',pixels:[[15,16]]}],
    sceneBindings:[{id:'gate',scene,object:'gate',frame:'front'}],
    destinations:[{id:'carve',kind:'sdf-shape',binding:'gate'},{id:'clay',kind:'sdf-material',binding:'gate'},
      {id:'paint',kind:'surface-channel',binding:'gate',chart:'front',channel:'paint'},
      {id:'shot',kind:'shot-correction',binding:'gate'},{id:'splats',kind:'splat-attributes',binding:'gate'}] };
}
const patch = (editor,id,operation,destination='raster')=>({
  id,frame:'front',revision:editor.describe().revision,destination,operation
});
const options = {exact:true,limit:0};
function sandbox(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'ink-exact-preview-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  return (name,value)=>{
    const file = path.join(dir,name);
    if (value !== undefined) fs.writeFileSync(file,JSON.stringify(value));
    return file;
  };
}
function cli(...args) {
  return spawnSync(process.execPath,['cli/ink-studio.js','pixel-art',...args],{
    cwd:path.resolve(__dirname,'..'),encoding:'utf8'
  });
}

test('exact preview exposes hidden layer edits and complete native cells without storing the edit',()=>{
  const editor = ink.createPixelEditor(document);
  const edit = patch(editor,'paint-hidden',{tool:'pencil',layer:'ink',swatch:'blue',points:[[2,2]]});
  const review = editor.previewEdit(edit,options);
  assert.equal(review.valid,true);
  assert.deepEqual(review.pixels,[]);
  assert.equal(review.pixelCount,0);
  assert.deepEqual(review.diff.cells.map(row=>[row.layer,row.at,row.before?.swatch,row.after?.swatch]),[
    ['ink',[2,2],'red','blue']
  ]);
  assert.equal(review.diff.protection.wouldChange,false);
  assert.deepEqual(editor.snapshot(),document);
  assert.deepEqual(editor.receipts(),[]);
  assert.deepEqual(editor.history(),{undo:[],redo:[]});
  editor.begin('Layer edit');
  editor.apply(edit);
  assert.deepEqual(editor.previewChanges(options).diff,review.diff);
  editor.cancel();

  const visible = editor.previewEdit(patch(editor,'visible',{tool:'pencil',layer:'ink',swatch:'red',
    points:[[0,1],[4,1]]}),options);
  assert.equal(visible.pixels.length,0);
  assert.equal(visible.diff.cells.filter(row=>row.layer === undefined).length,5);

  const crop = {id:'crop',revision:editor.describe().revision,destination:'canvas',
    operation:{type:'crop',rect:[0,0,5,4]}};
  const resized = editor.previewEdit(crop,options);
  assert.equal(resized.valid,true,JSON.stringify(resized.conflicts));
  assert.deepEqual(resized.diff.grids,[{frame:'front',before:[7,5],after:[5,4]}]);
  assert.equal(resized.diff.cells.filter(row=>row.after===null).length,15);
});

test('protected failures identify the skipped cell, and explicit protection changes are diffed',()=>{
  const editor = ink.createPixelEditor(document);
  const locked = editor.previewEdit(patch(editor,'blocked',{
    tool:'pencil',layer:'ink',swatch:'red',points:[[3,2],[4,2]]
  }),options);
  assert.equal(locked.valid,false);
  assert.deepEqual(locked.diff.cells,[]);
  assert.deepEqual(locked.diff.skippedHits.map(row=>[row.code,row.at]),[['protected-pixel',[3,2]]]);
  assert.deepEqual(locked.diff.protection.blocked,locked.diff.skippedHits);
  assert.equal(locked.diff.protection.wouldChange,false);
  const cleared = editor.previewEdit({id:'forget-gap',destination:'protection',revision:editor.describe().revision,
    operation:{type:'remove',id:'letter-gap'}},options);
  assert.equal(cleared.valid,true);
  assert.equal(cleared.diff.protection.wouldChange,true);
  assert.deepEqual(cleared.diff.protection.details,[{key:'letter-gap',before:document.protectedDetails[0]}]);
  assert.deepEqual(cleared.diff.protection.cells,[{frame:'front',at:[3,2]}]);
  cleared.diff.protection.details[0].before.pixels[0][0] = 0;
  assert.deepEqual(editor.snapshot(),document);
});

test('a bound dry run reports material and SDF parameter values plus the matched native render',t=>{
  const file = sandbox(t), sceneFile = file('gate.json',scene), authored = sceneDocument(sceneFile);
  const art = file('art.json',authored), source = ink.createSceneEditor(scene);
  const editor = ink.createPixelEditor(authored,{sceneEditor:source,sceneRef:sceneFile});
  const edit = patch(editor,'carve-gate',{parameters:{half:[.27,.7,.23]}},'carve');
  const before = source.revision();
  const review = editor.previewEdit(edit,options);
  assert.equal(review.valid,true,JSON.stringify(review.conflicts));
  assert.deepEqual(review.diff.renderErrors,[]);
  assert.deepEqual(review.diff.geometry,[{
    scene:sceneFile,kind:'solid',object:'gate',key:'half',before:[.8,.7,.23],after:[.27,.7,.23]
  }]);
  assert.equal(review.diff.rendered.length,1);
  assert.ok(review.diff.rendered[0].cells.length > 20);
  assert.ok(review.diff.rendered[0].cells.some(({before,after})=>before.object==='gate' && after.object===null));
  assert.deepEqual(review.diff.protection.renderedCells,[{
    scene:sceneFile,binding:'gate',frame:'front',at:[15,16],sourceAt:[15,16]
  }]);
  const result = cli('preview',art,file('patch.json',edit),'--scene',sceneFile,'--exact','--limit','0','--out',file('report.json'));
  assert.equal(result.status,0,result.stderr);
  const cliReview = JSON.parse(fs.readFileSync(file('report.json')));
  assert.deepEqual(cliReview.diff.geometry,review.diff.geometry);
  assert.deepEqual(cliReview.diff.renderErrors,[]);
  assert.deepEqual(JSON.parse(fs.readFileSync(sceneFile)),scene);
  assert.deepEqual(JSON.parse(fs.readFileSync(art)),authored);
  assert.equal(source.revision(),before);

  const material = editor.previewEdit(patch(editor,'change-mat',{material:'accent'},'clay'),options);
  assert.equal(material.valid,true);
  assert.deepEqual(material.diff.materials,[{
    scene:sceneFile,kind:'solid',object:'gate',key:'mat',before:'stone',after:'accent'
  }]);
  assert.deepEqual(material.diff.geometry,[]);
  assert.deepEqual(material.diff.renderErrors,[]);
  assert.ok(material.diff.rendered[0].cells.some(row=>row.before.material!==row.after.material));
  assert.equal(source.snapshot().solids[0].mat,'stone');
});

test('bound brush previews retain skipped hits from the source projector',()=>{
  const authored = sceneDocument(scene.id);
  const source = ink.createSceneEditor(scene);
  const editor = ink.createPixelEditor(authored,{sceneEditor:source});
  const edit = patch(editor,'tap-brush',{
    brush:{mode:'cut',depth:.25,pixels:[[20,16],[0,0],[15,16]]}
  },'carve');
  const review = editor.previewEdit(edit,options);
  assert.equal(review.valid,true,JSON.stringify(review.conflicts));
  assert.deepEqual(review.diff.skippedHits.map(hit=>[hit.code,hit.at]),[
    ['no-surface',[0,0]],['protected-pixel',[15,16]]
  ]);
  assert.deepEqual(review.diff.protection.blocked.map(row=>row.at),[[15,16]]);
  assert.equal(review.diff.geometry[0].key,'modifiers');
  assert.equal(review.diff.geometry[0].after[0].id,'tap-brush');
  assert.deepEqual(source.snapshot(),scene);
});

test('exact staged preview checks invalid source drafts without ending the open transaction',()=>{
  const source = ink.createSceneEditor(scene);
  const editor = ink.createPixelEditor(sceneDocument(scene.id),{sceneEditor:source});
  editor.begin('Carve and paint');
  editor.apply(patch(editor,'shallow',{parameters:{half:[.27,.7,.23]}},'carve'));
  const good = editor.previewChanges(options);
  assert.equal(good.valid,true);
  assert.deepEqual(good.diff.renderErrors,[]);
  assert.ok(good.diff.rendered[0].cells.length>0);
  source.updateShape({half:[.3,.2]},'solid:gate');
  const bad = editor.previewChanges(options);
  assert.equal(bad.valid,false);
  assert.deepEqual(bad.diff.geometry.map(row=>row.after),[[.3,.2]]);
  assert.deepEqual(source.snapshot().solids[0].half,[.3,.2]);
  assert.equal(editor.cancel(),true);
  assert.deepEqual(source.snapshot(),scene);
});

test('shot diffs sample the edited frame and report skipped projection hits',()=>{
  const source = ink.createSceneEditor(scene), world = source.build();
  const editor = ink.createPixelEditor(sceneDocument(scene.id),{sceneEditor:source});
  const view = {w:40,h:32,px:1,raw:true,transparent:true,captureShotCorrectionSurface:true};
  const at = [20,16], {target,...anchor} = ink.render(world,view).shotCorrectionSurface.pin(...at);
  assert.equal(target.object,'gate');
  const edit = { ...patch(editor,'spark',{at,anchor,fps:12,frames:[2,3]},'shot'),
    edits:[{at,layer:null,from:null,to:'red'},{at:[0,0],layer:null,from:null,to:'red'}] };
  const review = editor.previewEdit(edit,options);
  assert.equal(review.valid,true,JSON.stringify(review.conflicts));
  assert.deepEqual(review.diff.renderErrors,[]);
  const [sample] = review.diff.rendered;
  assert.equal(sample.shotFrame,2);
  assert.equal(sample.shotStatus,'sampled');
  assert.ok(sample.cells.some(row=>row.at.join()===at.join() && row.after.rgba.slice(0,3).join() === '180,56,61'));
  assert.deepEqual(review.diff.skippedHits.map(row=>[row.at,row.reason]),[[[0,0],'no-surface']]);
  assert.equal(editor.previewEdit(edit,{...options,shotHitFrame:5}).diff.rendered[0].shotStatus,'outside-frame-range');
  assert.deepEqual(editor.renderOptions(),{});
});

test('source splat diffs identify paint values and zero-weight hits without keeping a fit',()=>{
  const source = ink.createSceneEditor(scene);
  const editor = ink.createPixelEditor(sceneDocument(scene.id),{sceneEditor:source});
  const [sample,skipped] = editor.targets('splats').splats.filter(row=>row.id);
  const edit = patch(editor,'paint-specks',{
    paint:{pigment:'red'},splats:[{splat:sample.id},{splat:skipped.id,weight:0}]
  },'splats');
  const review = editor.previewEdit(edit,options);
  assert.equal(review.valid,true,JSON.stringify(review.conflicts));
  assert.deepEqual(review.diff.renderErrors,[]);
  assert.deepEqual(review.diff.materials,[{
    scene:scene.id,kind:'splat',object:sample.id,key:'pigment',after:0xb4383d
  }]);
  assert.deepEqual(review.diff.skippedHits,[{edit:'paint-specks',binding:'gate',splat:skipped.id,reason:'zero-weight'}]);
  assert.deepEqual(editor.renderOptions(),{});
});

test('CLI sessions run exact review without writing the pending document or stamps',t=>{
  const file = sandbox(t), art = file('art.json',document), dir = file('session');
  const editor = ink.createPixelEditor(document);
  const edit = patch(editor,'ink-top',{tool:'pencil',layer:'overlay',swatch:'blue',points:[[5,2]]});
  assert.equal(cli('session','init',dir,art).status,0);
  assert.equal(cli('session','begin',dir).status,0);
  const command = file('command.json',{format:'ink-studio/pixel-command',version:1,action:'preview',
    edit:{format:'ink-studio/pixel-command',version:1,action:'draw',patch:edit},options:{exact:true,limit:0}});
  const result = cli('session','run',dir,command);
  assert.equal(result.status,0,result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).diff,editor.previewEdit(edit,options).diff);
  const empty = cli('session','preview',dir,'--exact');
  assert.equal(empty.status,0,empty.stderr);
  assert.deepEqual(JSON.parse(empty.stdout).diff.cells,[]);
});
