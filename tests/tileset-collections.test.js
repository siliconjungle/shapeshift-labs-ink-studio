'use strict';

const assert = require('node:assert/strict');
const {execFileSync,spawnSync} = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {test} = require('node:test');
const ink = require('..');

const atlas = ink.createBlankTileset({width:24,height:8,background:'#806454'});
const scene = {id:'weighted-bricks',style:'slate',solids:[],tilesetDefaults:{texelsPerUnit:8},tilesets:{wall:atlas,trim:atlas}};
const entry = (id,x,weight,tileset='wall') => ({id,weight,
  selection:ink.pickTilesetRectangle(scene,tileset,{x,y:0,width:8,height:8})});
const request = {id:'brickwork',entries:[entry('worn',8,2),entry('spare',16,0),entry('common',0,6),entry('moss',0,.5,'trim')]};

test('round-trips exact picks across sheets and retains authored fractional and zero weights',()=>{
  const collection = ink.createTilesetCollection(scene,request);
  assert.equal(collection.format,'ink-studio/tileset-collection');
  assert.equal(collection.version,1);
  assert.deepEqual(collection.entries.map(row=>row.id),['common','moss','spare','worn']);
  const reopened = JSON.parse(JSON.stringify(collection));
  const report = ink.inspectTilesetCollection(scene,reopened);
  assert.deepEqual(report.collection,collection);
  assert.deepEqual(report.entries.map(row=>row.weight),[6,.5,0,2]);
  [12/17,1/17,0,4/17].forEach((expected,i)=>assert(Math.abs(report.entries[i].probability-expected)<1e-15));
  assert.equal(report.entries[1].selection.tileset,'trim');
  assert(Object.isFrozen(collection.entries[0].selection));
  assert.deepEqual(request.entries.map(row=>row.id),['worn','spare','common','moss']);
});

test('selects by relative weight with stable replay and order-independent keys',()=>{
  const collection = ink.createTilesetCollection(scene,request);
  const reordered = {...collection,entries:[...collection.entries].reverse()};
  const large = ink.createTilesetCollection(scene,{id:request.id,entries:request.entries.map(row=>({...row,weight:row.weight*2e307}))});
  const counts = {common:0,moss:0,spare:0,worn:0};
  for (let n=0;n<1000;n++) {
    const options = {seed:823015,key:'wall-'+n};
    const receipt = ink.sampleTilesetCollection(scene,collection,options);
    counts[receipt.id]++;
    assert.equal(ink.sampleTilesetCollection(scene,large,options).id,receipt.id);
    assert.deepEqual(ink.sampleTilesetCollection(scene,reordered,options),receipt);
  }
  assert.equal(counts.spare,0);
  for (const row of ink.inspectTilesetCollection(scene,collection).entries)
    assert(Math.abs(counts[row.id]/1000-row.probability)<.06,JSON.stringify(counts));
  const keys = Array.from({length:20},(_,n)=>'cell-'+n);
  function sequence(seed) {
    return keys.map(key=>ink.sampleTilesetCollection(scene,collection,{seed,key}).id);
  }
  assert.notDeepEqual(sequence(1),sequence(1+2**32));
});

test('rejects invalid weights, versions, duplicate IDs, and stale source rectangles',()=>{
  const create = entries=>ink.createTilesetCollection(scene,{id:'bad',entries});
  for (const weight of [-1,Infinity,NaN,'2',undefined]) assert.throws(()=>create([entry('one',0,weight)]),/finite and nonnegative/);
  assert.throws(()=>create([entry('one',0,0)]),/positive weight/);
  assert.throws(()=>create([entry('one',0,1),entry('one',8,1)]),/Duplicate tile collection entry/);
  assert.throws(()=>create([{id:'brush',weight:1,selection:{format:'ink-studio/tileset-brush',version:1}}]),/exact texel pick/);
  const collection = ink.createTilesetCollection(scene,request);
  assert.throws(()=>ink.inspectTilesetCollection(scene,{...collection,version:2}),/version 1 tile collection/);
  assert.throws(()=>ink.inspectTilesetCollection({...scene,tilesets:{wall:atlas}},collection),/Unknown tileset trim/);
  const shrunk = ink.createBlankTileset({width:16,height:8});
  assert.throws(()=>ink.inspectTilesetCollection({...scene,tilesets:{wall:shrunk,trim:atlas}},collection),/whole texels/);
  assert.throws(()=>ink.sampleTilesetCollection(scene,collection,{seed:1.5,key:'a'}),/safe integer seed/);
  assert.throws(()=>ink.sampleTilesetCollection(scene,collection,{seed:1,key:' '}),/nonempty key/);
});

test('CLI publishes a normal selection that the existing mesh stamper accepts',t=>{
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(),'ink-tile-collection-'));
  t.after(()=>fs.rmSync(cwd,{force:true,recursive:true}));
  const cli = path.resolve(__dirname,'../cli/ink-studio.js');
  const write = (name,data)=>fs.writeFileSync(path.join(cwd,name),JSON.stringify(data));
  const read = name=>JSON.parse(fs.readFileSync(path.join(cwd,name),'utf8'));
  const run = (...args)=>JSON.parse(execFileSync(process.execPath,[cli,'tileset',...args],{cwd,encoding:'utf8'}));
  write('scene.json',scene);
  write('draft.json',request);
  const collection = run('collection','create','draft.json','--scene','scene.json','--out','collection.json');
  assert.deepEqual(read('collection.json'),collection);
  assert.deepEqual(run('collection','inspect','collection.json','--scene','scene.json'),ink.inspectTilesetCollection(scene,collection));
  const args = ['collection','sample','collection.json','--scene','scene.json','--seed','-12','--key','wall-1','--out','pick.json'];
  const receipt = run(...args);
  assert.deepEqual(run(...args),receipt);
  assert.deepEqual(receipt,ink.sampleTilesetCollection(scene,collection,{seed:-12,key:'wall-1'}));
  assert.deepEqual(read('pick.json'),receipt.selection);
  run('stamp','--scene','scene.json','--selection','pick.json','--object','wall','--face','brick','--out','stamped.json');
  assert.deepEqual(read('stamped.json').topologyMeshes.wall.bindings[0].data.selection,receipt.selection);
  write('pick.json',{occupied:true});
  const conflict = spawnSync(process.execPath,[cli,'tileset',...args],{cwd,encoding:'utf8'});
  assert.notEqual(conflict.status,0);
  assert.match(conflict.stderr,/different tile collection output/);
  assert.deepEqual(read('pick.json'),{occupied:true});
});

const authored = ['worn','moss','spare','common','worn'];

test('plays authored order through repeats, wraparound, and zero-weight entries',()=>{
  const collection = ink.createTilesetCollection(scene,{...request,sequence:authored});
  assert.notEqual(collection.sequence,authored);
  assert(Object.isFrozen(collection.sequence));
  const reopened = JSON.parse(JSON.stringify(collection));
  assert.deepEqual(ink.inspectTilesetCollection(scene,reopened).collection.sequence,authored);
  const picks = Array.from({length:11},(_,step)=>ink.playTilesetCollection(scene,reopened,{step}));
  assert.deepEqual(picks.map(pick=>pick.id),[...authored,...authored,authored[0]]);
  assert.deepEqual(picks[2],{collection:request.id,version:1,step:2,sequenceIndex:2,...collection.entries[2]});
  assert.deepEqual(ink.playTilesetCollection(scene,reopened),picks[0]);
  const reversed = {...reopened,entries:reopened.entries.reverse()};
  assert.deepEqual(ink.playTilesetCollection(scene,reversed,{step:6}),picks[6]);
  const options = {seed:823015,key:'cell-5'};
  assert.deepEqual(ink.sampleTilesetCollection(scene,collection,options),
    ink.sampleTilesetCollection(scene,ink.createTilesetCollection(scene,request),options));
});

test('validates authored step references, playback offsets, and competing placement inputs',()=>{
  for (const sequence of [[],null,'worn',['missing'],new Array(1)])
    assert.throws(()=>ink.createTilesetCollection(scene,{...request,sequence}),/array of existing entry IDs/);
  assert.throws(()=>ink.playTilesetCollection(scene,ink.createTilesetCollection(scene,request)),/no authored sequence/);
  const collection = ink.createTilesetCollection(scene,{...request,sequence:authored});
  for (const step of [-1,.1,'2',Number.MAX_SAFE_INTEGER+1])
    assert.throws(()=>ink.playTilesetCollection(scene,collection,{step}),/nonnegative safe integer/);
  assert.equal(ink.playTilesetCollection(scene,collection,{step:Number.MAX_SAFE_INTEGER}).id,'moss');
  const editor = ink.createSceneEditor(scene);
  const stroke = {mode:'draw',id:'row',object:'wall',path:[[0,0],[1,0]],interval:1,collection};
  assert.throws(()=>editor.planTilesetStroke({...stroke,selection:collection.entries[0].selection}),/selection or a tile collection/);
  assert.throws(()=>editor.planTilesetStroke({...stroke,sequenceStart:Number.MAX_SAFE_INTEGER}),/across the placement/);
});

test('fills a rectangle in cell order with one transaction and preserves phase at occupied cells',()=>{
  const collection = ink.createTilesetCollection(scene,{...request,sequence:authored});
  const editor = ink.createSceneEditor(scene);
  const common = collection.entries[0].selection;
  editor.placeTilesetFace({object:'wall',face:'existing',selection:common,planeAt:[2,0]});
  const before = editor.snapshot();
  const fill = {mode:'fill',id:'facade',object:'wall',from:[2,1],to:[0,0],collection,sequenceStart:1};
  const preview = editor.planTilesetRectangle(fill);
  assert.deepEqual(preview.sequence,{collection:collection.id,start:1,length:5});
  assert.deepEqual(preview.cells.map(cell=>[cell.status,cell.variant?.id,cell.variant?.step,cell.variant?.sequenceIndex]),[
    ['fill','moss',1,1],['fill','spare',2,2],['occupied',undefined,undefined,undefined],
    ['fill','worn',4,4],['fill','worn',5,0],['fill','moss',6,1]
  ]);
  assert.deepEqual(editor.snapshot(),before);
  assert.deepEqual(editor.applyTilesetRectangle(fill),preview);
  const after = editor.snapshot(), row = after.topologyMeshes.wall;
  assert.deepEqual(row.bindings.map(binding=>[binding.element,binding.data.selection.tileset,binding.data.selection.x]),[
    ['existing','wall',0],['facade/0','trim',0],['facade/1','wall',16],['facade/3','wall',8],
    ['facade/4','wall',8],['facade/5','trim',0]
  ]);
  assert.deepEqual(row.materials.map(material=>material.id),['tileset/wall','tileset/trim']);
  assert.equal(editor.history().undo.at(-1),'Fill facade');
  editor.undo();
  assert.deepEqual(editor.snapshot(),before);
  editor.redo();
  assert.deepEqual(editor.snapshot(),after);
});

test('consumes stroke steps by sample index and rejects a shared material across different sheets atomically',()=>{
  const collection = ink.createTilesetCollection(scene,{...request,sequence:authored});
  const editor = ink.createSceneEditor(scene);
  const before = editor.snapshot();
  const stroke = {mode:'draw',id:'row',object:'wall',path:[[0,0],[1,0],[0,0],[0,1]],interval:1,collection};
  const preview = editor.planTilesetStroke(stroke);
  assert.deepEqual(preview.samples.map(sample=>[sample.status,sample.variant?.id,sample.variant?.step]),[
    ['draw','worn',0],['draw','moss',1],['repeated-position',undefined,undefined],['draw','common',3]
  ]);
  const conflict = {...stroke,material:'shared'};
  const blocked = editor.planTilesetStroke(conflict);
  assert.deepEqual(blocked.conflicts,[{reason:'material-in-use',material:'shared'}]);
  assert.throws(()=>editor.applyTilesetStroke(conflict),error=>{
    assert.deepEqual(error.report,blocked);
    return true;
  });
  assert.deepEqual(editor.snapshot(),before);
  assert.deepEqual(editor.applyTilesetStroke(stroke),preview);
  const row = editor.meshTopology('wall');
  assert.deepEqual(row.document.faces.map(face=>[face.id,face.material]),[
    ['row/0','tileset/wall'],['row/1','tileset/trim'],['row/3','tileset/wall']
  ]);
});

test('CLI resolves a reusable pick and supplies a saved collection to a stroke and rectangle',t=>{
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(),'ink-tile-sequence-'));
  t.after(()=>fs.rmSync(cwd,{force:true,recursive:true}));
  const cli = path.resolve(__dirname,'../cli/ink-studio.js');
  const write = (name,data)=>fs.writeFileSync(path.join(cwd,name),JSON.stringify(data));
  const read = name=>JSON.parse(fs.readFileSync(path.join(cwd,name),'utf8'));
  const run = (...args)=>JSON.parse(execFileSync(process.execPath,[cli,'tileset',...args],{cwd,encoding:'utf8'}));
  write('scene.json',scene);
  write('draft.json',{...request,sequence:authored});
  const collection = run('collection','create','draft.json','--scene','scene.json','--out','collection.json');
  const receipt = run('collection','play','collection.json','--scene','scene.json','--step','7','--out','pick.json');
  assert.deepEqual(receipt,ink.playTilesetCollection(scene,collection,{step:7}));
  assert.equal(receipt.id,'spare');
  assert.deepEqual(read('pick.json'),receipt.selection);
  write('stroke.json',{mode:'draw',id:'course',object:'wall',path:[[0,0],[2,0]],interval:1,sequenceStart:7});
  const stroke = run('stroke','stroke.json','--scene','scene.json','--collection','collection.json','--out','course.json');
  assert.deepEqual(stroke.samples.map(sample=>sample.variant.id),['spare','common','worn']);
  write('rect.json',{mode:'fill',id:'facade',object:'wall',from:[0,1],to:[2,1]});
  const args = ['rectangle','rect.json','--scene','course.json','--collection','collection.json'];
  const preview = run(...args);
  assert.deepEqual(run(...args,'--out','facade.json'),preview);
  assert.deepEqual(preview.cells.map(cell=>cell.variant.id),['worn','moss','spare']);
  assert.equal(read('facade.json').topologyMeshes.wall.bindings.length,6);
  assert.equal(read('course.json').topologyMeshes.wall.bindings.length,3);
});

const orientations = [{},{rotation:90},{rotation:90,flipX:true},{flipY:true}];

test('samples only permitted paint transforms and leaves weighted tile choice on its own seed stream',()=>{
  const base = ink.createTilesetCollection(scene,request);
  const collection = ink.createTilesetCollection(scene,{...request,orientations});
  const allowed = new Set(collection.orientations.map(paint=>JSON.stringify(paint)));
  const seen = new Set();
  for (let index=0;index<64;index++) {
    const options = {seed:-37,key:'leaf '+index};
    const ordinary = ink.sampleTilesetCollection(scene,base,options);
    const choice = ink.sampleTilesetCollection(scene,collection,options);
    assert.equal(choice.id,ordinary.id);
    assert.equal(choice.probability,ordinary.probability);
    assert.deepEqual(choice.selection,{...ordinary.selection,paint:choice.paint,
      collectionChoice:{collection:collection.id,entry:choice.id,...options}});
    assert.deepEqual(ink.sampleTilesetCollection(scene,JSON.parse(JSON.stringify(collection)),options),choice);
    const paint = JSON.stringify(choice.paint);
    assert(allowed.has(paint));
    seen.add(paint);
  }
  assert.equal(seen.size,allowed.size);
  for (const bad of [null,[],new Array(1),[{rotation:45}],[{flipX:1}],[{},{rotation:180,flipX:true,flipY:true}]])
    assert.throws(()=>ink.createTilesetCollection(scene,{...request,orientations:bad}),/paint transform|orientation|Paint rotation/);
});

test('retains weighted choices and their UV permutations in an undoable rectangle edit',()=>{
  const collection = ink.createTilesetCollection(scene,{...request,orientations});
  const editor = ink.createSceneEditor(scene);
  const before = editor.snapshot();
  const paint = {mode:'fill',id:'ground',object:'ground',from:[0,0],to:[3,2],collection,seed:-37};
  const plan = editor.planTilesetRectangle(paint);
  assert.deepEqual(plan.weighted,{collection:collection.id,seed:paint.seed});
  assert(plan.canCommit);
  assert.deepEqual(editor.applyTilesetRectangle(paint),plan);
  const planted = editor.snapshot(), row = editor.meshTopology('ground');
  for (const cell of plan.cells) {
    const choice = ink.sampleTilesetCollection(scene,collection,{seed:paint.seed,key:String(cell.index)});
    assert.deepEqual(cell.variant,{id:choice.id,key:choice.key,paint:choice.paint});
    const reference = ink.createSceneEditor(scene).planTilesetFace({object:'ref',face:'ref',selection:
      collection.entries.find(entry=>entry.id===choice.id).selection,paint:choice.paint});
    const saved = row.bindings.find(binding=>binding.element===cell.face);
    assert.deepEqual(saved.data.collectionChoice,choice.selection.collectionChoice);
    assert.deepEqual(saved.data.paint,choice.paint);
    assert.deepEqual(row.document.faces.find(face=>face.id===cell.face).corners.map(corner=>corner.uv),
      reference.corners.map(corner=>corner.uv));
  }
  assert.equal(editor.history().undo.at(-1),'Fill ground');
  editor.undo();
  assert.deepEqual(editor.snapshot(),before);
  editor.redo();
  assert.deepEqual(editor.snapshot(),planted);
  assert.throws(()=>editor.planTilesetRectangle({...paint,seed:undefined}),/safe integer seed/);
  assert.throws(()=>editor.planTilesetRectangle({...paint,paint:{}}),/or an explicit paint orientation/);
});

test('keeps authored sequence steps while independently seeding paint for each stroke position',()=>{
  const collection = ink.createTilesetCollection(scene,{...request,sequence:authored,orientations});
  const editor = ink.createSceneEditor(scene);
  const draw = {mode:'draw',id:'course',object:'course',interval:1,path:[[0,0],[1,0],[0,0],[0,2]],
    collection,seed:52,sequenceStart:8};
  assert.throws(()=>editor.planTilesetStroke({...draw,seed:undefined}),/safe integer seed/);
  const report = editor.planTilesetStroke(draw);
  assert.deepEqual(report.sequence,{collection:collection.id,start:8,length:authored.length,seed:52});
  assert.equal(report.samples[2].status,'repeated-position');
  for (const sample of report.samples.filter(sample=>sample.status==='draw')) {
    const step = draw.sequenceStart+sample.index;
    const {id,sequenceIndex,paint} = ink.playTilesetCollection(scene,collection,{step,seed:52});
    assert.deepEqual(sample.variant,{id,step,sequenceIndex,paint});
  }
  assert.deepEqual(editor.applyTilesetStroke(draw),report);
  assert.deepEqual(editor.meshTopology('course').bindings.map(binding=>binding.data.collectionChoice.step),[8,9,11,12]);
  const forced = editor.planTilesetStroke({...draw,id:'weighted',collectionMode:'weighted',sequenceStart:undefined});
  assert.deepEqual(forced.weighted,{collection:collection.id,seed:52});
  assert(forced.samples.every(row=>row.variant?.id !== 'spare'));
});

test('CLI plays a seeded step into a saved selection and stamp receipt with its paint and provenance',t=>{
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(),'ink-tile-orientation-'));
  t.after(()=>fs.rmSync(cwd,{force:true,recursive:true}));
  const cli = path.resolve(__dirname,'../cli/ink-studio.js');
  const collection = ink.createTilesetCollection(scene,{...request,sequence:authored,orientations:[{rotation:90,flipX:true}]});
  for (const [name,doc] of [['scene.json',scene],['collection.json',collection]])
    fs.writeFileSync(path.join(cwd,name),JSON.stringify(doc));
  const run = (...args)=>JSON.parse(execFileSync(process.execPath,[cli,'tileset',...args],{cwd,encoding:'utf8'}));
  const pick = run('collection','play','collection.json','--scene','scene.json','--step','7','--seed','-89','--out','pick.json');
  assert.equal(pick.id,'spare');
  const receipt = run('stamp','--scene','scene.json','--object','wall','--face','leaf','--selection','pick.json','--out','wall.json');
  assert.deepEqual(receipt.source.paint,{rotation:90,flipX:true,flipY:false});
  assert.deepEqual(receipt.source.collectionChoice,{collection:collection.id,entry:'spare',seed:-89,step:7,sequenceIndex:2});
  assert.deepEqual(receipt.source.collectionChoice,pick.selection.collectionChoice);
  const face = JSON.parse(fs.readFileSync(path.join(cwd,'wall.json'),'utf8')).topologyMeshes.wall;
  assert.deepEqual(face.bindings[0].data,receipt.source);
  const zero = ['collection','sample','collection.json','--scene','scene.json','--key','tile','--out','zero-pick.json','--seed'];
  assert.deepEqual(run(...zero,'-0'),run(...zero,'0'));
});
