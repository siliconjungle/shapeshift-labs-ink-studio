'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createPixelEditor } = require('..');
const { compile } = require('../cli/pixel-art.js');

const mark = (swatch,x,y)=>({ swatch,at:[x,y] });
const ink = () => ({ marks:[mark('red',1,1),{ alpha:96,runs:[[1,1,1]] },mark('green',3,1),mark(null,0,0)] });
const fixture = () => ({
  format:'ink-studio/pixel-art',version:2,width:5,height:3,pixelAspect:[1,1],
  palette:{ red:'#b03020',green:'#20b050' },layers:[{ id:'shadow',visible:false },{ id:'ink' }],
  frames:[
    { id:'first',durationMs:90,cels:{ shadow:ink(),ink:ink() } },
    { id:'second',durationMs:120,cels:{ ink:{ hold:'first/ink' } } },
    { id:'third',durationMs:65,cels:{ ink:{ hold:'second/ink' } } },
    { id:'fourth',durationMs:80,cels:{ ink:{ hold:'third/ink' } } }
  ],
  tags:[{ id:'twobeat',start:'first',end:'second',direction:'reverse',loop:false }],
  selections:[
    { id:'middle',pixels:[[1,1],[2,1]] },
    { id:'first-tip',frame:'first',pixels:[[0,0],[1,1]] },
    { id:'second-tip',frame:'second',pixels:[[1,1]] }
  ]
});
const patch = (editor,scope,edit)=>({
  id:'edit-selected-cels',revision:editor.timeline().revision,destination:'timeline',operation:{ type:'edit-cels',scope,edit }
});
const sample = (editor,frame,layer,at)=>editor.sample(at,{ frame,layer,mode:'layer' });
const swap = { type:'palette-swap',map:{ red:'green',green:'red' } };

test('batch swaps indexed swatches simultaneously and reports exact frame and layer differences',()=>{
  const art = fixture(), editor = createPixelEditor(art);
  const op = patch(editor,{ tag:'twobeat',layers:['ink','shadow'] },swap);
  const review = editor.previewEdit(op,{ limit:0 });
  assert.equal(review.valid,true);
  assert.deepEqual(review.pixels,[]);
  const [target] = review.targets;
  assert.equal(target.tool,'edit-cels');
  assert.equal(target.pixelCount,6);
  assert.deepEqual(target.frames.map(row=>[row.frame,row.pixelCount,row.missingLayers]),
    [['first',4,[]],['second',2,['shadow']]]);
  assert.deepEqual(target.frames[0].cels[0].changes[0],{
    before:{ state:'paint',swatch:'red',alpha:96 },after:{ state:'paint',swatch:'green',alpha:96 },runs:[[1,1,1]]
  });
  assert.equal(target.frames[0].cels[0].layer,'shadow');

  editor.begin('Batch swatches');
  editor.apply(op);
  assert.deepEqual(editor.previewChanges({ limit:0 }).targets,[target]);
  editor.commit();
  const result = editor.snapshot(), receipt = editor.receipts().at(-1);
  assert.deepEqual(receipt.affectedTargets,[target]);
  assert.deepEqual(createPixelEditor(art).replay(receipt),result);
  assert.equal(result.frames[1].cels.ink.hold,'first/ink');
  assert.equal(result.frames[2].cels.ink.hold,undefined);
  assert.equal(result.frames[3].cels.ink.hold,'third/ink');
  assert.deepEqual(target.links,[{ cel:'third/ink',frame:'third',layer:'ink',before:'second/ink',after:null }]);
  assert.equal(sample(editor,'second','ink',[1,1]).swatch,'green');
  assert.equal(sample(editor,'second','ink',[3,1]).swatch,'red');
  for (const frame of ['third','fourth']) {
    assert.equal(sample(editor,frame,'ink',[1,1]).swatch,'red');
    assert.equal(sample(editor,frame,'ink',[1,1]).alpha,96);
  }
  editor.undo();
  assert.deepEqual(editor.snapshot(),art);
  editor.redo();
  assert.deepEqual(editor.snapshot(),result);
});

test('batch nudges use each frame selection and preserve opacity, cutouts, and unselected holds',()=>{
  const art = fixture(), editor = createPixelEditor(art);
  const scope = { cels:['second/ink','first/shadow'],selections:{ first:'first-tip',second:'second-tip' } };
  const review = editor.previewEdit(patch(editor,scope,{ type:'nudge',offset:[1,0] }));
  assert.equal(review.valid,true);
  assert.deepEqual(review.targets[0].frames.map(row=>[row.frame,row.pixelCount]),[['first',4],['second',2]]);
  editor.apply(patch(editor,scope,{ type:'nudge',offset:[1,0] }));
  for (const [frame,layer] of [['first','shadow'],['second','ink']]) {
    assert.equal(sample(editor,frame,layer,[1,1]).swatch,null);
    assert.equal(sample(editor,frame,layer,[2,1]).alpha,96);
  }
  assert.deepEqual(Array.from(compile(editor.snapshot(),'first',undefined,'shadow').layerSources.get('shadow').slots.slice(0,2)),[-1,-2]);
  assert.equal(sample(editor,'third','ink',[1,1]).swatch,'red');
  assert.equal(editor.snapshot().frames[2].cels.ink.hold,'first/ink');
});

test('mask and cleanup apply to multiple frames and layers with bounded diffs',()=>{
  const art = fixture();
  art.frames[1].cels.shadow = ink();
  const editor = createPixelEditor(art);
  const scope = { frames:['first','second'],layers:['shadow','ink'],selection:'middle' };
  const grow = patch(editor,scope,{ type:'cleanup',kind:'cluster',mode:'grow',maxChanges:1 });
  assert.deepEqual(editor.previewEdit(grow).targets[0].frames.map(row=>row.pixelCount),[2,2]);
  editor.apply(grow);
  assert.equal(sample(editor,'second','shadow',[2,1]).alpha,96);
  const keep = patch(editor,scope,{ type:'mask',mode:'keep' });
  assert.deepEqual(editor.previewEdit(keep).targets[0].frames.map(row=>row.pixelCount),[4,4]);
  editor.apply(keep);
  assert.equal(sample(editor,'first','ink',[3,1]).swatch,null);
  assert.equal(sample(editor,'second','shadow',[2,1]).alpha,96);
  assert.equal(sample(editor,'third','ink',[3,1]).swatch,'green');
  editor.apply(patch(editor,{ cels:['second/shadow'],selection:'middle' },{ type:'mask',mode:'erase' }));
  assert.equal(sample(editor,'second','shadow',[2,1]).swatch,null);
  assert.equal(sample(editor,'first','shadow',[2,1]).alpha,96);
});

test('rejected batch edits identify the cel and leave earlier cels and receipts untouched',()=>{
  const art = fixture();
  art.protectedDetails = [{ id:'stay',kind:'pixel',frame:'second',pixels:[[1,1]] }];
  const editor = createPixelEditor(art);
  const scoped = { frames:['first','second'],layers:['ink'] };
  const blocked = patch(editor,scoped,swap);
  const protection = editor.previewEdit(blocked);
  assert.equal(protection.valid,false);
  assert.deepEqual(protection.targets,[]);
  assert.deepEqual(protection.conflicts[0],{
    code:'protected-pixel',message:'Cel edit cannot change this pixel',at:[1,1],frame:'second',layer:'ink',cel:'second/ink'
  });
  assert.throws(()=>editor.apply(blocked),/cannot change this pixel/);
  assert.deepEqual(editor.snapshot(),art);
  assert.deepEqual(editor.receipts(),[]);
  const outside = editor.previewEdit(patch(editor,scoped,{ type:'nudge',offset:[3,0] }));
  assert.equal(outside.conflicts[0].code,'outside-canvas');
  assert.equal(outside.conflicts[0].frame,'first');
  const missing = editor.previewEdit(patch(editor,{ ...scoped,selection:'first-tip' },{ type:'mask' }));
  assert.equal(missing.conflicts[0].code,'missing-selection');
  assert.equal(missing.conflicts[0].frame,'second');
  const locked = fixture();
  locked.layers[0].locked = true;
  const lockedEditor = createPixelEditor(locked);
  const lockedPreview = lockedEditor.previewEdit(patch(lockedEditor,{ cels:['first/shadow'] },swap));
  assert.equal(lockedPreview.conflicts[0].code,'locked-layer');
  assert.equal(lockedPreview.conflicts[0].cel,'first/shadow');
  const clipped = fixture();
  clipped.layers[1].clip = 'shadow';
  const clippedEditor = createPixelEditor(clipped);
  const clipPreview = clippedEditor.previewEdit(patch(clippedEditor,{ cels:['first/ink'] },swap));
  assert.equal(clipPreview.conflicts[0].code,'clipped-pixel');
  assert.equal(clipPreview.conflicts[0].cel,'first/ink');
});
