'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const ink = require('..');
const { seal } = require('../cli/pixel-edit-batch.js');

const document = {
  format:'ink-studio/pixel-art',version:2,width:8,height:6,pixelAspect:[1,1],
  palette:{red:'#b4383d',blue:'#323991'},layers:[{id:'ink'}],
  frames:[{id:'front',durationMs:100,cels:{ink:{marks:[{swatch:'red',at:[1,1]}]}}}]
};
const sceneSource = {id:'batch-gate',style:'slate',
  camera:{target:[0,0,0],dist:4,pitch:0,yaw:0,projection:'orthographic',sway:0},
  solids:[{id:'gate',kind:'box',at:[0,0,0],half:[.8,.7,.23],res:.15,mat:'stone'},
    {id:'post',kind:'box',at:[1.1,0,0],half:[.1,.7,.23],res:.15,mat:'stone'}]
};
const sceneDocument = {
  ...document,sceneBindings:[{id:'source',scene:sceneSource.id,object:'gate'}],
  destinations:[{id:'carve',kind:'sdf-shape',binding:'source'}]
};

const command = (action,fields = {})=>({format:'ink-studio/pixel-command',version:1,action,...fields});
const pencil = (id,at,swatch = 'blue')=>command('draw',{patch:{
  id,frame:'front',operation:{tool:'pencil',layer:'ink',swatch,points:[at]}
}});
const run = (editor,commands)=>editor.execute(command('batch',{
  label:'Paint the shutter',revision:editor.describe().revision,commands
}));
const reseal = batch=>seal(batch.label,batch.inputs,batch.outputs,batch.steps,batch.revalidatedFrom);

test('ordered batches reproduce every step and commit as one undoable gesture',()=>{
  const writer = ink.createPixelEditor(document);
  const edits = [pencil('blue-mark',[2,1]),command('mask',{patch:{
    id:'pick-blue',frame:'front',operation:{id:'blue-pixels',query:{type:'swatch',id:'blue'}}
  }}),command('recolor',{patch:{
    id:'red-mark',frame:'front',operation:{layer:'ink',selection:'blue-pixels',from:'blue',to:'red'}
  }})];
  const batch = run(writer,edits);
  assert.equal(batch.steps.length,3);
  assert.equal(batch.steps[0].inputs.documentRevision,batch.inputs.documentRevision);
  assert.equal(batch.steps[1].command.patch.revision,batch.steps[0].outputs.documentRevision);
  assert.equal(writer.inspect([2,1]).swatch,'red');
  assert.deepEqual(writer.history(),{undo:['Paint the shutter'],redo:[]});
  const reader = ink.createPixelEditor(document);
  assert.deepEqual(run(ink.createPixelEditor(document),edits),batch);
  const reformat = (_key,value)=>value && Object.getPrototypeOf(value) === Object.prototype ?
    Object.fromEntries(Object.entries(value).reverse()) : value;
  assert.deepEqual(reader.replayBatch(JSON.parse(JSON.stringify(batch,reformat))),batch);
  assert.deepEqual(reader.snapshot(),writer.snapshot());
  assert.deepEqual(reader.receipts(),batch.steps);
  assert.equal(reader.undo(),true);
  assert.deepEqual(reader.snapshot(),document);
  assert.equal(reader.redo(),true);
  assert.deepEqual(reader.snapshot(),writer.snapshot());
});

test('failed steps and incorrect outputs roll back raster and scene state together',()=>{
  const create = ()=>ink.createPixelEditor(sceneDocument,{sceneEditor:ink.createSceneEditor(sceneSource)});
  const carve = command('apply',{patch:{
    id:'cut',frame:'front',destination:'carve',operation:{parameters:{half:[.4,.7,.23]}}
  }});
  const writer = create(), reader = create();
  const steps = [pencil('paint',[2,1]),carve];
  const batch = run(writer,steps);
  assert.deepEqual(writer.sceneEditor.snapshot().solids[0].half,[.4,.7,.23]);
  const stale = {...carve,patch:{...carve.patch,revision:'0'.repeat(64)}};
  assert.throws(()=>run(reader,[steps[0],stale]),error=>
    error.receipt.failedStep===1 && error.receipt.conflicts[0].code==='stale-document');
  const forgedStep = structuredClone(batch);
  forgedStep.steps[1].outputs.artifactRevision = '0'.repeat(64);
  assert.throws(()=>reader.replayBatch(forgedStep),error=>error.receipt.conflicts[0].code==='batch-integrity');
  assert.throws(()=>reader.replayBatch(reseal(forgedStep)),error=>
    error.receipt.failedStep===1 && error.receipt.conflicts[0].code==='receipt-mismatch');
  const forgedOutput = structuredClone(batch);
  forgedOutput.outputs.scene.revision = '0'.repeat(64);
  assert.throws(()=>reader.replayBatch(reseal(forgedOutput)),error=>
    error.receipt.conflicts[0].code==='batch-output-mismatch');
  assert.deepEqual(reader.snapshot(),sceneDocument);
  assert.deepEqual(reader.sceneEditor.snapshot(),sceneSource);
  assert.deepEqual(reader.receipts(),[]);
  assert.deepEqual(reader.history(),{undo:[],redo:[]});
  reader.replayBatch(batch);
  assert.deepEqual(reader.sceneEditor.snapshot(),writer.sceneEditor.snapshot());
  reader.undo();
  assert.deepEqual(reader.sceneEditor.snapshot(),sceneSource);
});

test('recording an open draft verifies its steps without committing or publishing direct scene edits',()=>{
  const source = ink.createSceneEditor(sceneSource), editor = ink.createPixelEditor(sceneDocument,{sceneEditor:source});
  editor.begin('Hand-written draft');
  const paint = pencil('paint',[2,1]);
  editor.execute({...paint,patch:{...paint.patch,revision:editor.describe().revision}});
  const recorded = editor.recordBatch();
  assert.equal(recorded.label,'Hand-written draft');
  assert.equal(recorded.steps.length,1);
  assert.deepEqual(editor.history(),{undo:[],redo:[]});
  assert.throws(()=>editor.replayBatch(recorded),error=>error.receipt.conflicts[0].code==='active-transaction');
  source.setMaterial('accent','solid:post');
  assert.throws(()=>editor.recordBatch(),error=>
    error.receipt.conflicts[0].code==='unrecorded-changes' &&
    error.receipt.conflicts[0].cause.conflicts[0].code==='batch-output-mismatch');
  assert.equal(source.snapshot().solids[1].mat,'accent');
  assert.equal(editor.inspect([2,1]).swatch,'blue');
  assert.equal(editor.cancel(),true);
  assert.deepEqual(source.snapshot(),sceneSource);
});

test('explicit revalidation refreshes intent evidence and leaves the changed document untouched until replay',()=>{
  const writer = ink.createPixelEditor(document);
  const query = {type:'shadow-cluster',swatches:['red']}, result = writer.select(query);
  const batch = run(writer,[command('mask',{patch:{id:'keep-shadow',frame:'front',
    operation:{id:'shadow',query,targetRevision:result.targetRevision}}})]);
  const changed = ink.createPixelEditor(document);
  run(changed,[pencil('more-shadow',[6,4],'red')]);
  const prior = changed.snapshot(), history = changed.history();
  assert.throws(()=>changed.replayBatch(batch),error=>error.receipt.conflicts[0].code==='stale-document');
  const review = changed.revalidateBatch(batch,{exact:true,limit:0});
  assert.equal(review.valid,true,JSON.stringify(review.conflicts));
  assert.equal(review.batch.revalidatedFrom,batch.revision);
  assert.notEqual(review.batch.revision,batch.revision);
  assert.deepEqual(review.changes.map(row=>[row.step,row.before.targets[0].pixelCount,row.after.targets[0].pixelCount]),[[0,1,2]]);
  assert.equal(review.batch.inputs.documentRevision,changed.describe().revision);
  assert.deepEqual(changed.snapshot(),prior);
  assert.deepEqual(changed.history(),history);
  changed.replayBatch(review.batch);
  assert.deepEqual(changed.select({type:'recall',id:'shadow'}).pixels,[[1,1],[6,4]]);
});

test('scene revalidation retains the target identity and keeps explicit pixel guards',()=>{
  const writer = ink.createPixelEditor(sceneDocument,{sceneEditor:ink.createSceneEditor(sceneSource)});
  const sourceRevision = writer.targets('carve').sourceRevision;
  const batch = run(writer,[command('apply',{patch:{
    id:'cut',frame:'front',destination:'carve',sourceRevision,operation:{parameters:{half:[.4,.7,.23]}}
  }})]);
  const changed = ink.createSceneEditor(sceneSource);
  changed.updateShape({half:[.6,.7,.23]},'solid:gate');
  const editor = ink.createPixelEditor(sceneDocument,{sceneEditor:changed});
  assert.throws(()=>editor.replayBatch(batch),error=>error.receipt.conflicts[0].code==='stale-source');
  const report = editor.revalidateBatch(batch,{exact:true});
  assert.equal(report.valid,true,JSON.stringify(report.conflicts));
  assert.notEqual(report.batch.steps[0].command.patch.sourceRevision,sourceRevision);
  assert.deepEqual(report.preview.diff.geometry[0].before,[.6,.7,.23]);
  assert.deepEqual(changed.snapshot().solids[0].half,[.6,.7,.23]);
  editor.replayBatch(report.batch);
  assert.deepEqual(changed.snapshot().solids[0].half,[.4,.7,.23]);

  const rerouted = {...sceneDocument,sceneBindings:[{...sceneDocument.sceneBindings[0],object:'post'}]};
  const wrong = ink.createPixelEditor(rerouted,{sceneEditor:ink.createSceneEditor(sceneSource)});
  const failed = wrong.revalidateBatch(batch);
  assert.equal(failed.valid,false);
  assert.equal(failed.failedStep,0);
  assert.equal(failed.conflicts[0].code,'changed-target');

  const raster = ink.createPixelEditor(document);
  const guarded = run(raster,[command('apply',{patch:{id:'overlay',frame:'front',
    edits:[{at:[3,3],layer:null,from:null,to:'blue'}]}})]);
  const protectedDoc = {...document,protectedDetails:[{id:'reserved',kind:'gap',pixels:[[3,3]]}]};
  const blocked = ink.createPixelEditor(protectedDoc).revalidateBatch(guarded);
  assert.equal(blocked.valid,false);
  assert.equal(blocked.failedStep,0);
  assert.equal(blocked.conflicts[0].code,'protected-pixel');
});

test('the CLI persists a batch, previews revalidation, and replays an approved receipt across sessions',t=>{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'ink-batch-replay-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file = (name,value)=>{
    const target = path.join(dir,name);
    if (value !== undefined) fs.writeFileSync(target,JSON.stringify(value));
    return target;
  };
  function cli(args,expected = 0) {
    const result = spawnSync(process.execPath,['cli/ink-studio.js','pixel-art','session',...args],{
      cwd:path.resolve(__dirname,'..'),encoding:'utf8'
    });
    assert.equal(result.status,expected,result.stderr);
    return result.stdout ? JSON.parse(result.stdout) : undefined;
  }
  const a = file('session-a'), b = file('session-b'), doc = file('document.json',document);
  cli(['init',a,doc]);
  cli(['init',b,doc]);
  const revision = ink.createPixelEditor(document).describe().revision;
  const runFile = (dir,name,data,expected)=>cli(['run',dir,file(name,data)],expected);
  const batch = runFile(a,'batch.json',command('batch',{revision,commands:[pencil('paint',[3,2])]}));
  runFile(b,'change.json',command('batch',{revision,commands:[pencil('context',[4,2])]}));
  const replay = command('replay-batch',{batch});
  assert.equal(runFile(b,'stale.json',replay,2).conflicts[0].code,'stale-document');
  const report = runFile(b,'review.json',command('revalidate-batch',{batch}));
  assert.equal(report.valid,true);
  assert.equal(cli(['run',b,file('export.json',command('export'))]).data.frames[0].cels.ink.marks.length,2);
  const approved = runFile(b,'approved.json',command('replay-batch',{batch:report.batch}));
  assert.equal(approved.revision,report.batch.revision);
  assert.equal(cli(['run',b,file('export.json')]).data.frames[0].cels.ink.marks.length,3);
  assert.equal(cli(['undo',b]).changed,true);
  assert.equal(cli(['run',b,file('export.json')]).data.frames[0].cels.ink.marks.length,2);
});

test('retained artifacts pin subsequent batches and numeric splat references cannot drift',()=>{
  const makeWorld = reverse=>{
    const B = ink.load().makeBuilder(8,[0x222234,0xb4383d]);
    for (const id of reverse ? ['right','left'] : ['left','right'])
      B.iso(id === 'left' ? -.3 : .3,0,0,.65,B.P[1],1,{splatId:id});
    B.describeSplats(0,2,{object:'panel'});
    return B.finish({id:'splats',cam:{target:[0,0,0],dist:4,yaw:0,pitch:0,ortho:true}});
  };
  const doc = {...document,sceneBindings:[{id:'panel',scene:'splats',object:'panel'}],
    destinations:[{id:'fit',kind:'splat-attributes',binding:'panel'}]};
  const writer = ink.createPixelEditor(doc), base = makeWorld(false), context = {world:()=>base};
  const first = writer.applyBatch({revision:writer.describe().revision,commands:[command('apply',{patch:{
    id:'fit-edge',destination:'fit',frame:'front',operation:{splats:[{splat:0,footprintScale:.8}]}
  }})]},context);
  const second = run(writer,[pencil('overpaint',[5,2])]);
  const reader = ink.createPixelEditor(doc);
  assert.throws(()=>reader.replayBatch(second),error=>
    error.receipt.conflicts.some(issue=>issue.input==='renderRevision'));
  const reversed = makeWorld(true), stale = reader.revalidateBatch(first,{world:()=>reversed});
  assert.equal(stale.valid,false);
  assert.equal(stale.conflicts[0].code,'changed-target');
  reader.replayBatch(first,context);
  assert.deepEqual(reader.renderOptions('splats'),writer.renderOptions('splats'));
  reader.replayBatch(second);
  assert.deepEqual(reader.snapshot(),writer.snapshot());
});

test('recorded captures follow each intermediate scene in a detached replay',()=>{
  const editor = ink.createPixelEditor(sceneDocument,{sceneEditor:ink.createSceneEditor(sceneSource)});
  const captureWithWorld = ({w,h},world)=>{
    const x = Math.round(world.spec.solids[0].half[0]*5), size = w*h;
    const coverage = new Float32Array(size), ids = new Uint32Array(size);
    coverage[x] = ids[x] = 1;
    return {w,h,scene:sceneSource.id,passes:{w,h,coverage,objectId:ids,partId:ids,
      objects:[null,'gate'],parts:[null,{object:'gate',part:'frame',entity:'gate'}]}};
  };
  const context = {captureWithWorld};
  editor.begin('Cut and pick the gate');
  editor.apply({id:'cut',revision:editor.describe().revision,frame:'front',destination:'carve',
    operation:{parameters:{half:[.4,.7,.23]}}});
  const query = {type:'visible-part',id:'frame'};
  const observed = editor.select(query,context);
  assert.deepEqual(observed.pixels,[[2,0]]);
  editor.apply({id:'pick',revision:editor.describe().revision,frame:'front',destination:'selections',
    operation:{id:'gate-part',query,targetRevision:observed.targetRevision}},context);
  const recorded = editor.recordBatch(context);
  editor.cancel();
  assert.deepEqual(editor.select(query,context).pixels,[[4,0]]);
  editor.replayBatch(recorded,context);
  assert.deepEqual(editor.select({type:'recall',id:'gate-part'}).pixels,[[2,0]]);
});
