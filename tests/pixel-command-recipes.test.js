'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const ink = require('..');
const PNG = require('../cli/png.js');

const sample = require('../examples/pixel-art-tooling/relay-silhouette-recipe.json');
const relay = require('../examples/pixel-art-tooling/relay.json');
const command = (action,data)=>({format:'ink-studio/pixel-command',version:1,action,...data});
const read = image=>PNG.raster(Buffer.from(image.data,'base64'));
const pixel = ({w,data},x,y)=>Array.from(data.subarray((y*w+x)*4,(y*w+x)*4+4));

test('the relay recipe selects, moves, shades and renders exact native comparisons before approval',()=>{
  const editor = ink.createPixelEditor(relay);
  const baseline = editor.snapshot(), result = editor.execute(sample);
  assert.equal(result.valid,true,JSON.stringify(result.conflicts));
  assert.deepEqual(result.steps,['select-bracket','nudge-bracket','shade-bracket']);
  assert.deepEqual(result.plan.batch.steps.map(row=>row.affectedTargets[0].pixelCount),[2,4,2]);
  assert.deepEqual(result.plan.batch.steps.map(row=>row.command.patch.revision),
    result.plan.batch.steps.map(row=>row.inputs.documentRevision));
  const [comparison] = result.comparisons;
  assert.deepEqual(comparison.before.grid,[64,46]);
  assert.equal(comparison.changedPixels,4);
  assert.deepEqual(pixel(read(comparison.before),26,39).slice(0,3),[168,94,86]);
  assert.deepEqual(pixel(read(comparison.after),26,38).slice(0,3),[218,139,97]);
  assert.equal(pixel(read(comparison.difference),26,39)[0],255);
  assert.equal(pixel(read(comparison.difference),0,0)[0],0);
  assert.equal(result.preview.diff.cells.filter(row=>row.layer==='hardware').length,4);
  assert.deepEqual(editor.snapshot(),baseline);
  assert.deepEqual(editor.history(),{undo:[],redo:[]});
  assert.deepEqual(ink.createPixelEditor(relay).execute(sample),result);

  const changed = structuredClone(result.plan);
  changed.inputs.nudge = [2,2];
  assert.throws(()=>editor.applyRecipe(changed,result.approval),error=>error.receipt.conflicts[0].code==='recipe-approval');
  const applied = editor.execute(command('apply-recipe',{plan:result.plan,approval:result.approval}));
  assert.equal(applied.batchRevision,result.plan.batch.revision);
  assert.equal(editor.sample([26,38],{mode:'layer',layer:'hardware'}).swatch,'copper');
  assert.deepEqual(editor.history().undo,['Nudge and shade the relay bracket']);
  assert.throws(()=>editor.applyRecipe(result.plan,result.approval),error=>error.receipt.conflicts[0].code==='stale-document');
  assert.equal(editor.undo(),true);
  assert.deepEqual(editor.snapshot(),baseline);
});

test('typed inputs can be reused with another parameter set and failures leave the asset untouched',()=>{
  const editor = ink.createPixelEditor(relay);
  const initial = editor.snapshot(), original = editor.execute(sample);
  const review = editor.previewRecipe(sample.recipe,{inputs:{nudge:[0,1],'brush-at':[26,40],'shade-step':-1}});
  assert.equal(review.valid,true,JSON.stringify(review.conflicts));
  assert.equal(review.plan.recipe.revision,original.plan.recipe.revision);
  assert.notEqual(review.approval,original.approval);
  assert.deepEqual(pixel(read(review.comparisons[0].after),26,40).slice(0,3),[99,66,90]);

  for (const inputs of [{nudge:'left'},{seed:[1000,0]},{unexpected:'field'}])
    assert.equal(editor.previewRecipe(sample.recipe,{inputs}).valid,false);
  const failed = editor.previewRecipe(sample.recipe,{inputs:{seed:[26,40]}});
  assert.equal(failed.valid,false);
  assert.equal(failed.step,'nudge-bracket');
  assert.equal(failed.failedStep,1);
  assert.deepEqual(editor.snapshot(),initial);

  const nested = {...sample.recipe,steps:[{id:'nested',action:'commit',patch:{}}]};
  assert.equal(editor.previewRecipe(nested).valid,false);
});

const scene = {id:'recipe-gate',style:'slate',camera:{target:[0,0,0],dist:4,yaw:0,pitch:0,
  projection:'orthographic',sway:0},finish:{look:{sdfAssist:true}},
  solids:[{id:'gate',kind:'box',at:[0,0,0],half:[.8,.7,.23],res:.15,mat:'stone'}]};
const document = {format:'ink-studio/pixel-art',version:2,width:40,height:32,pixelAspect:[1,1],
  palette:{blue:'#323991'},layers:[{id:'ink'}],frames:[{id:'front',durationMs:100,cels:{}}],
  sceneBindings:[{id:'source',scene:scene.id,object:'gate',frame:'front'}],
  destinations:[{id:'shape',kind:'sdf-shape',binding:'source'}]};
const boundRecipe = {format:'ink-studio/pixel-command-recipe',version:1,id:'scene-retouch',
  steps:[{id:'cut-gate',action:'apply',patch:{destination:'shape',frame:'front',operation:{parameters:{half:[.4,.7,.23]}}}}],
  comparisons:[{id:'shot',binding:'source',frame:'front',time:0}]};

test('bound geometry recipes pin source evidence and render the attached scene before and after',()=>{
  const editor = ink.createPixelEditor(document,{sceneEditor:ink.createSceneEditor(scene)});
  const review = editor.previewRecipe(boundRecipe,{exact:true});
  assert.equal(review.valid,true,JSON.stringify(review.conflicts));
  assert.deepEqual(review.plan.batch.steps[0].command.patch.sourceRevision,
    review.plan.batch.steps[0].inputs.sourceRevision);
  assert.deepEqual(review.preview.diff.geometry[0].before,[.8,.7,.23]);
  assert.ok(review.comparisons[0].changedPixels>20);
  assert.deepEqual(editor.sceneEditor.snapshot(),scene);
  editor.applyRecipe(review.plan,review.approval);
  assert.deepEqual(editor.sceneEditor.snapshot().solids[0].half,[.4,.7,.23]);
  editor.undo();
  assert.deepEqual(editor.sceneEditor.snapshot(),scene);
});

test('an external scene change blocks an otherwise replayable recipe comparison',()=>{
  const editor = ink.createPixelEditor(document);
  const recipe = {...boundRecipe,steps:[{id:'add-blue',action:'draw',patch:{frame:'front',
    operation:{tool:'pencil',layer:'ink',swatch:'blue',points:[[2,1]]}}}]};
  const before = ink.createSceneEditor(scene).build();
  const changed = ink.createSceneEditor(scene);
  changed.updateShape({half:[.3,.7,.23]},'solid:gate');
  const after = changed.build();
  const review = editor.previewRecipe(recipe,{world:()=>before});
  assert.equal(review.valid,true,JSON.stringify(review.conflicts));
  assert.equal(review.comparisons[0].changedPixels,0);
  assert.throws(()=>editor.applyRecipe(review.plan,review.approval,{world:()=>after}),error=>
    error.receipt.conflicts[0].code==='recipe-comparison-changed');
  assert.deepEqual(editor.snapshot(),document);
  assert.equal(editor.applyRecipe(review.plan,review.approval,{world:()=>before}).valid,true);
});

test('intent-based masks record fresh query evidence on each asset',()=>{
  const editor = ink.createPixelEditor(relay), template = structuredClone(sample.recipe);
  template.steps[0].patch.operation.query = {type:'shadow-cluster',swatches:['bronze'],at:{$input:'seed'}};
  const review = editor.previewRecipe(template);
  assert.equal(review.valid,true,JSON.stringify(review.conflicts));
  const [first] = review.plan.batch.steps;
  assert.match(first.command.patch.operation.targetRevision,/^[a-f0-9]{64}$/);
  assert.deepEqual(first.affectedTargets[0].pixelCount,2);
  assert.equal(editor.applyRecipe(review.plan,review.approval).valid,true);
});

test('CLI sessions save and apply reviewed recipe plans with the same PNG evidence',t=>{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'ink-pixel-recipe-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const cwd = path.resolve(__dirname,'..'), session = path.join(dir,'work');
  const reviewFile = path.join(dir,'review.json'), approved = path.join(dir,'approve.json');
  function cli(args,expected = 0) {
    const result = spawnSync(process.execPath,['cli/ink-studio.js','pixel-art','session',...args],{cwd,encoding:'utf8'});
    assert.equal(result.status,expected,result.stderr);
    return result.stdout ? JSON.parse(result.stdout) : undefined;
  }
  cli(['init',session,'examples/pixel-art-tooling/relay.json']);
  cli(['run',session,'examples/pixel-art-tooling/relay-silhouette-recipe.json','--out',reviewFile]);
  const review = JSON.parse(fs.readFileSync(reviewFile));
  assert.deepEqual(review,ink.createPixelEditor(relay).execute(sample));
  fs.writeFileSync(approved,JSON.stringify(command('apply-recipe',{plan:review.plan,approval:review.approval})));
  assert.equal(cli(['run',session,approved]).batchRevision,review.plan.batch.revision);
  assert.equal(cli(['run',session,approved],2).conflicts[0].code,'stale-document');
  assert.equal(cli(['undo',session]).changed,true);
  assert.equal(cli(['run',session,approved]).valid,true);

  const scenePath = path.join(dir,'gate.json'), artPath = path.join(dir,'gate-art.json');
  const comparisonPath = path.join(dir,'compare-scene.json'), external = path.join(dir,'external');
  fs.writeFileSync(scenePath,JSON.stringify(scene));
  fs.writeFileSync(artPath,JSON.stringify({...document,
    sceneBindings:[{...document.sceneBindings[0],scene:scenePath}]}));
  const recipe = {...boundRecipe,steps:[{id:'dot',action:'draw',patch:{frame:'front',
    operation:{tool:'pencil',layer:'ink',swatch:'blue',points:[[2,1]]}}}]};
  fs.writeFileSync(comparisonPath,JSON.stringify(command('preview-recipe',{recipe})));
  cli(['init',external,artPath]);
  const externalReview = cli(['run',external,comparisonPath,'--scene',scenePath]);
  assert.equal(externalReview.valid,true);
  assert.equal(externalReview.comparisons[0].changedPixels,0);
  fs.writeFileSync(approved,JSON.stringify(command('apply-recipe',{plan:externalReview.plan,approval:externalReview.approval})));
  assert.equal(cli(['run',external,approved,'--scene',scenePath]).valid,true);
});
