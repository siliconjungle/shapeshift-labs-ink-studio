'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createPixelEditor,load } = require('..');
const ranges = require('../src/pixel-playback-ranges.js');
const { documentFromDeck,validate } = require('../cli/pixel-art.js');

const frames = ['intro','start','middle','end','outro'].map((id,i)=>({ id,durationMs:[50,100,200,300,50][i],cels:{} }));
const tag = { id:'walk',label:'Walk cycle',start:'start',end:'end',direction:'ping-pong',loop:true };
const drawing = { format:'ink-studio/pixel-art',version:2,width:1,height:1,pixelAspect:[1,1],
  palette:{ ink:'#000000' },layers:[{ id:'ink' }],frames };
const request = (editor,operation)=>({ id:'playback-tag',revision:editor.timeline().revision,destination:'timeline',operation });

test('tag clocks honor frame holds in forward, reverse and ping-pong orders',()=>{
  const durations = frames.map(frame=>frame.durationMs), [range] = ranges.resolve(frames,[tag]);
  const ping = ranges.plan(durations,range);
  assert.deepEqual(ping.order,[1,2,3,2]);
  assert.equal(ping.duration,800);
  assert.deepEqual([0,99,100,300,599,600,799,800,900,-1].map(ping.at),[1,1,2,3,3,2,2,1,2,2]);
  const one = ranges.plan(durations,{ ...range,loop:false });
  assert.deepEqual(one.order,[1,2,3,2,1]);
  assert.equal(one.duration,900);
  assert.deepEqual([0,299,300,600,800,900,999].map(one.at),[1,2,3,2,1,1,1]);
  const reverse = ranges.plan(durations,{ ...range,direction:'reverse',loop:false });
  assert.deepEqual(reverse.order,[3,2,1]);
  assert.deepEqual([-1,0,299,300,499,500,6000].map(reverse.at),[3,3,3,2,2,1,1]);
  assert.deepEqual(ranges.plan(durations,{ ...range,direction:'forward' }).order,[1,2,3]);
  assert.deepEqual(ranges.plan(durations,{ first:2,last:2,direction:'ping-pong' }).order,[2]);
  assert.deepEqual(ranges.plan(durations,{ first:1,last:2,direction:'ping-pong' }).order,[1,2]);
  assert.equal(ranges.plan([.1,.2,.4],{ loop:false }).at(.3),2);
});

test('tags survive timeline edits, undo, replay and layer deck round trips',()=>{
  const editor = createPixelEditor(drawing);
  const add = request(editor,{ type:'set-tag',tag });
  const preview = editor.previewEdit(add);
  assert.equal(preview.valid,true);
  assert.equal(preview.pixelCount,0);
  assert.deepEqual(preview.targets[0].after.order,['start','middle','end','middle']);
  editor.apply(add);
  const receipt = editor.receipts().at(-1), deck = editor.layerDeck();
  assert.deepEqual(deck.tags,[tag]);
  assert.deepEqual(documentFromDeck(deck).tags,[tag]);
  assert.deepEqual(createPixelEditor(drawing).replay(receipt).tags,[tag]);
  editor.apply(request(editor,{ type:'add-frame',frame:'new',durationMs:75,before:'end' }));
  assert.deepEqual(editor.timeline().tags[0].order,['start','middle','new','end','new','middle']);
  assert.equal(editor.timeline().tags[0].durationMs,950);
  editor.apply(request(editor,{ type:'remove-tag',tag:'walk' }));
  assert.deepEqual(editor.timeline().tags,[]);
  editor.undo();
  assert.equal(editor.timeline().tags[0].id,'walk');
  assert.equal(editor.previewEdit(request(editor,{ type:'set-tag',tag:{ ...tag,end:'intro' } })).valid,false);
  assert.throws(()=>validate({ ...drawing,tags:[tag,tag] }),/unique IDs/);
  assert.throws(()=>validate({ ...drawing,tags:[{ ...tag,start:'absent' }] }),/known start and end/);
  assert.throws(()=>validate({ ...drawing,tags:[{ ...tag,direction:'sideways' }] }),/valid labels, directions/);
  const long = [{ id:'start',durationMs:1,cels:{} },{ id:'middle',durationMs:Number.MAX_SAFE_INTEGER-2,cels:{} },
    { id:'end',durationMs:1,cels:{} }];
  assert.throws(()=>validate({ ...drawing,frames:long,tags:[tag] }),/safe time range/);
});

test('pixel stamp images sample a tag on the same clock as their frame holds',()=>{
  const { pixelStamps } = load().KIT;
  const spec = { width:1,height:1,palette:['#000000','#ff0000','#00ff00','#0000ff','#ffffff'],
    frames:frames.map(({ id,durationMs },i)=>({ id,duration:durationMs/1000,slots:[i] })),
    tags:[tag,{ ...tag,id:'back',direction:'reverse',loop:false }] };
  const framesAt = pixelStamps.prepare(spec,{ tag:'walk' });
  assert.equal(framesAt.at(0),1);
  assert.equal(framesAt.at(.3),3);
  assert.equal(framesAt.at(.8),1);
  assert.equal(pixelStamps.prepare(spec).at(0),0);
  assert.deepEqual([...pixelStamps.image(spec,{ tag:'back',time:0 }).rgba],[0,0,255,255]);
  assert.deepEqual([...pixelStamps.image(spec,{ tag:'back',time:2 }).rgba],[255,0,0,255]);
  const placed = pixelStamps.place({ ...spec,phase:10 },{ at:[0,0,0],tag:'back',phase:0,cue:{ start:1 } });
  assert.equal(placed.visibleAt(.99),false);
  assert.equal(placed.frame(1),3);
  assert.equal(placed.frame(1.31),2);
  assert.equal(placed.visibleAt(1.6),false);
  assert.throws(()=>pixelStamps.prepare(spec,{ tag:'missing' }),/Unknown pixel playback tag/);
});
