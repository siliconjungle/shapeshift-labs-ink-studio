'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createPixelEditor,openPixelEditorSession } = require('..');
const PixelArt = require('../cli/pixel-art.js');

const document = {
  format:'ink-studio/pixel-art',version:2,width:4,height:3,pixelAspect:[1,1],
  palette:{ red:'#bd2020',gold:'#f1dc74' },
  layers:[{ id:'ink' },{ id:'shadow' }],
  frames:[
    { id:'one',durationMs:100,cels:{ ink:{ marks:[
      { swatch:'red',at:[1,1] },{ alpha:128,runs:[[1,1,1]] },{ swatch:'red',at:[3,2] }
    ] } } },
    { id:'two',durationMs:130,cels:{} },
    { id:'three',durationMs:70,cels:{} }
  ]
};
const address = (frame,layer = 'ink')=>({ frame,layer });
const request = (editor,operation)=>({
  id:'timeline-edit',destination:'timeline',revision:editor.timeline().revision,operation
});
const apply = (editor,operation)=>editor.apply(request(editor,operation));
const cell = (editor,frame,layer = 'ink')=>editor.timeline().layers.find(row=>row.id === layer).cells.find(row=>row.frame === frame);
const at = (editor,frame,xy,layer = 'ink')=>editor.sample(xy,{ frame,mode:'layer',layer });
const pencil = (editor,frame,xy)=>({
  id:'paint-gold',frame,revision:editor.timeline().revision,operation:{ tool:'pencil',layer:'ink',points:[xy],swatch:'gold' }
});

test('timeline adds and retimes frames and supports undo, redo and replay',()=>{
  const editor = createPixelEditor(document);
  editor.begin('Time a pose');
  apply(editor,{ type:'add-frame',frame:'pause',before:'three',durationMs:61,label:'Pause' });
  apply(editor,{ type:'duration',frame:'two',durationMs:150 });
  apply(editor,{ type:'blank',...address('pause') });
  assert.equal(editor.previewChanges().valid,true);
  assert.equal(editor.previewChanges().targets.length,3);
  editor.commit();
  assert.deepEqual(editor.timeline().frames.map(({ id,startMs,durationMs,endMs })=>[id,startMs,durationMs,endMs]),
    [['one',0,100,100],['two',100,150,250],['pause',250,61,311],['three',311,70,381]]);
  assert.equal(cell(editor,'pause').state,'blank');
  assert.equal(cell(editor,'two').state,'empty');
  const receipts = editor.receipts(), result = editor.snapshot();
  assert.equal(receipts[0].affectedTargets[0].after.startMs,230);
  editor.undo();
  assert.deepEqual(editor.snapshot(),document);
  editor.redo();
  assert.deepEqual(editor.snapshot(),result);
  const replay = createPixelEditor(document);
  for (const receipt of receipts) replay.replay(receipt);
  assert.deepEqual(replay.snapshot(),result);
  const tooLong = request(editor,{ type:'duration',frame:'one',durationMs:Number.MAX_SAFE_INTEGER });
  assert.match(editor.previewEdit(tooLong).conflicts[0].message,/safe millisecond range/);
});

test('holds follow the source across moves and detach on direct paint while copies are independent',()=>{
  const editor = createPixelEditor(document);
  apply(editor,{ type:'duplicate',from:address('one') });
  apply(editor,{ type:'hold',from:address('one'),to:address('three') });
  apply(editor,{ type:'copy',from:address('three'),to:address('two','shadow') });
  assert.equal(cell(editor,'three').source,'one/ink');
  assert.equal(cell(editor,'two').cel,'two/ink');
  assert.equal(cell(editor,'two','shadow').state,'cel');
  assert.equal(at(editor,'three',[1,1]).alpha,128);
  const paint = pencil(editor,'one',[2,0]);
  assert.deepEqual(editor.previewEdit(paint).pixels.map(row=>row.frame),['one','three']);
  editor.apply(paint);
  assert.equal(at(editor,'three',[2,0]).swatch,'gold');
  assert.equal(at(editor,'two',[2,0]).swatch,null);
  assert.equal(at(editor,'two',[2,0],'shadow').swatch,null);
  apply(editor,{ type:'move',from:address('one'),to:address('one','shadow') });
  assert.equal(cell(editor,'one').state,'empty');
  assert.equal(cell(editor,'one','shadow').cel,'one/ink');
  assert.equal(at(editor,'three',[2,0]).swatch,'gold');
  const overwrite = request(editor,{ type:'copy',from:address('two'),to:address('one','shadow'),replace:true });
  assert.equal(editor.previewEdit(overwrite).conflicts[0].code,'missing-cel-source');
  editor.apply(pencil(editor,'three',[0,0]));
  assert.equal(cell(editor,'three').state,'cel');
  assert.equal(at(editor,'three',[0,0]).swatch,'gold');
  assert.equal(at(editor,'one',[0,0],'shadow').swatch,null);
  editor.apply(pencil(editor,'one',[1,0]));
  assert.equal(cell(editor,'one').cel,'one/ink-2');
  assert.equal(editor.receipts().at(-1).affectedTargets[0].cel,'one/ink-2');
  apply(editor,{ type:'blank',...address('three') });
  assert.equal(cell(editor,'three').cel,'three/ink');
  assert.equal(at(editor,'three',[2,0]).swatch,null);
});

test('offsets affect composition, inspection and exports while canvas-space edits retain clipped art',()=>{
  const editor = createPixelEditor(document);
  apply(editor,{ type:'hold',from:address('one'),to:address('two') });
  apply(editor,{ type:'layer-offset',layer:'ink',offset:[1,0] });
  apply(editor,{ type:'cel-offset',...address('two'),offset:[0,-1] });
  assert.deepEqual(cell(editor,'two').effectiveOffset,[1,-1]);
  assert.equal(at(editor,'one',[2,1]).alpha,128);
  assert.equal(at(editor,'one',[3,2]).swatch,null);
  assert.equal(editor.inspect([2,0],{ frame:'two' }).cel,'two/ink');
  assert.equal(editor.inspect([2,0],{ frame:'two' }).swatch,'red');
  assert.equal(editor.previewEdit(pencil(editor,'one',[0,0])).conflicts[0].code,'outside-cel');
  editor.apply(pencil(editor,'one',[3,0]));
  assert.equal(at(editor,'one',[3,0]).swatch,'gold');
  assert.equal(editor.snapshot().frames[0].cels.ink.marks.at(-1).runs[0][1],2);
  const stack = editor.layerDeck(), imported = createPixelEditor(PixelArt.documentFromDeck(stack));
  for (const frame of document.frames) assert.deepEqual(imported.png({ frame:frame.id }),editor.png({ frame:frame.id }));
  apply(editor,{ type:'layer-offset',layer:'ink',offset:[0,0] });
  assert.equal(at(editor,'one',[3,2]).swatch,'red');
  const before = at(editor,'two',[1,0]).swatch;
  editor.apply({ id:'pad-art',revision:editor.timeline().revision,destination:'canvas',
    operation:{ type:'pad',margins:[1,1,0,0] } });
  assert.equal(at(editor,'two',[2,1]).swatch,before);
});

test('timeline rejects stale edits, locked slots, cycles and changes to protected holds',()=>{
  const art = structuredClone(document);
  art.layers[1].locked = true;
  art.frames[1].cels.ink = { hold:'one/ink' };
  art.protectedDetails = [{ id:'mark',kind:'pixel',frame:'two',pixels:[[1,1]] }];
  const editor = createPixelEditor(art);
  const to = address('two');
  const stale = request(editor,{ type:'duration',frame:'three',durationMs:9 });
  apply(editor,{ type:'duration',frame:'one',durationMs:141 });
  assert.equal(editor.previewEdit(stale).conflicts[0].code,'stale-document');
  for (const [operation,code] of [
    [{ type:'copy',from:address('one'),to },'occupied-cel'],
    [{ type:'blank',...address('three','shadow') },'locked-layer'],
    [{ type:'blank',...address('one') },'protected-pixel'],
    [{ type:'layer-offset',layer:'ink',offset:[1,0] },'protected-pixel']
  ]) assert.equal(editor.previewEdit(request(editor,operation)).conflicts[0].code,code);
  assert.equal(editor.previewEdit(pencil(editor,'one',[1,1])).conflicts[0].code,'protected-pixel');
  const sameFrame = structuredClone(document);
  sameFrame.frames[0].cels.shadow = { hold:'one/ink',offset:[1,0] };
  sameFrame.protectedDetails = [{ id:'shifted',kind:'pixel',frame:'one',pixels:[[2,1]] }];
  const shifted = createPixelEditor(sameFrame);
  assert.equal(shifted.previewEdit(pencil(shifted,'one',[1,1])).conflicts[0].code,'protected-pixel');
  art.frames[0].cels.ink = { hold:'two/ink' };
  assert.throws(()=>createPixelEditor(art),/contain a cycle/);
});

test('CLI timeline and persistent SDK sessions expose the same draft and committed cells',t=>{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'ink-cel-timeline-'));
  t.after(()=>fs.rmSync(dir,{ force:true,recursive:true }));
  const source = path.join(dir,'source.json'), session = path.join(dir,'session');
  const command = (...args)=>JSON.parse(execFileSync(process.execPath,[path.resolve(__dirname,'../cli/ink-studio.js'),
    'pixel-art',...args],{ encoding:'utf8' }));
  fs.writeFileSync(source,JSON.stringify(document));
  let editor = createPixelEditor(document,{ sessionDirectory:session });
  assert.deepEqual(command('timeline',source),editor.timeline());
  const patch = path.join(dir,'patch.json'), revised = path.join(dir,'revised.json');
  const receiptFile = path.join(dir,'receipt.json'), replayed = path.join(dir,'replayed.json');
  fs.writeFileSync(patch,JSON.stringify(request(editor,{ type:'hold',from:address('one'),to:address('two') })));
  assert.equal(command('preview',source,patch).targets[0].tool,'hold');
  fs.writeFileSync(receiptFile,JSON.stringify(command('edit',source,patch,'--out',revised)));
  command('replay',source,receiptFile,'--out',replayed);
  assert.deepEqual(fs.readFileSync(revised),fs.readFileSync(replayed));
  editor.begin('Hold the pose');
  apply(editor,{ type:'hold',from:address('one'),to:address('two') });
  editor.closeSession();
  editor = openPixelEditorSession(session);
  assert.equal(cell(editor,'two').state,'hold');
  editor.commit();
  editor.closeSession();
  assert.deepEqual(command('session','timeline',session),editor.timeline());
});
