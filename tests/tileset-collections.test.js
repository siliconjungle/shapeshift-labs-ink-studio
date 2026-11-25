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
