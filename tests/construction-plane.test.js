'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {test} = require('node:test');
const ink = require('..');

const scene = {id:'construction-jig',style:'slate',solids:[],tilesetDefaults:{texelsPerUnit:4},
  tilesets:{paint:ink.createBlankTileset({width:4,height:3,background:'#74b3aa'})}};
const plane = {origin:[1,2,3],right:[0,0,-2],up:[0,3,0],grid:.25};
const selection = ink.pickTilesetRectangle(scene,'paint',{x:0,y:0,width:4,height:3});
const stamp = {object:'jig',face:'panel',selection,planeAt:[2,1]};
const target = 'panel/v2';
const close = (actual,expected)=>assert(actual.length === expected.length &&
  actual.every((value,i)=>Math.abs(value-expected[i])<1e-9),JSON.stringify({actual,expected}));
const selected = editor=>editor.selectMeshTopology('jig',{domain:'vertices',ids:[target]});

test('moving the persisted plane changes subsequent stamps and is undoable independently',()=>{
  const editor = ink.createSceneEditor(scene);
  assert.deepEqual(editor.constructionPlane(),{origin:[0,0,0],right:[1,0,0],up:[0,1,0],grid:1});
  editor.setConstructionPlane(plane);
  assert.deepEqual(editor.snapshot().constructionPlane,plane);
  const plan = editor.planTilesetFace(stamp);
  assert.deepEqual(plan.constructionPlane,plane);
  assert.deepEqual(plan.vertices.map(v=>v.position),[[1,2.25,2.5],[1,2.25,1.5],[1,3,1.5],[1,3,2.5]]);
  assert.deepEqual(editor.placeTilesetFace(stamp),plan);
  const stamped = editor.snapshot();
  editor.setConstructionPlane({origin:[2,3,4],grid:.5});
  const next = editor.planTilesetFace({...stamp,face:'next'});
  assert.deepEqual(next.vertices[0].position,[2,3.5,3]);
  assert.deepEqual(editor.snapshot().topologyMeshes,stamped.topologyMeshes);
  assert.deepEqual(ink.createSceneEditor(JSON.parse(JSON.stringify(editor.snapshot()))).constructionPlane(),
    {...plane,origin:[2,3,4],grid:.5});
  editor.undo();
  assert.deepEqual(editor.snapshot(),stamped);
  assert.throws(()=>editor.setConstructionPlane({right:[0,1,0]}),/perpendicular/);
  assert.throws(()=>editor.setConstructionPlane({grid:0}),/positive/);
  assert.throws(()=>editor.planTilesetFace({...stamp,face:'other',origin:[0,0,0]}),/explicit tile frame/);
  assert.throws(()=>editor.planTilesetFace({...stamp,face:'other',planeAt:[1]}),/finite.*pair/);
  assert.deepEqual(editor.snapshot(),stamped);
});

test('plane-space pivots, motion axes, and both alignment modes use the stamped frame',()=>{
  const editor = ink.createSceneEditor({...scene,constructionPlane:plane});
  editor.placeTilesetFace(stamp);
  const pick = selected(editor);
  const scaled = editor.planMeshTransform('jig',{selection:pick,space:'plane',planePivot:stamp.planeAt,
    operation:{kind:'scale',factors:[2,2,1]}}).report;
  assert.deepEqual(scaled.axes,[[0,0,-1],[0,1,0],[1,0,0]]);
  assert.deepEqual(scaled.worldPivot,[1,2.25,2.5]);
  assert.deepEqual(scaled.vertices[0].after,[1,3.75,.5]);
  const base = {selection:pick,space:'plane',operation:{kind:'move',offset:[.18,.13,.08]}};
  const align = mode=>editor.planMeshTransform('jig',{...base,snap:{kind:'construction-plane',mode,anchor:target}}).report;
  const exact = align('plane'), grid = align('grid');
  assert.deepEqual(exact.worldPivot,plane.origin);
  close(exact.vertices[0].after,[1,3.13,1.32]);
  assert.deepEqual(grid.snap.gridAt,[7,5]);
  close(grid.snap.point,[1,3.25,1.25]);
  close(grid.vertices[0].after,grid.snap.point);
  assert.deepEqual(grid.constructionPlane,plane);
  assert.throws(()=>editor.planMeshTransform('jig',{...base,planePivot:null}),/finite.*pair/);
  assert.throws(()=>editor.planMeshTransform('jig',{...base,snap:{kind:'construction-plane',mode:'grid',anchor:target,maxDistance:.05}}),
    /maximum distance/);
});

test('headless plane, stamp, pivot transform and vertex alignment share a saved frame',t=>{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'ink-construction-plane-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file = name=>path.join(dir,name), write = (name,value)=>fs.writeFileSync(file(name),JSON.stringify(value));
  const read = name=>JSON.parse(fs.readFileSync(file(name),'utf8'));
  write('draft.json',scene);
  const cli = path.resolve(__dirname,'../cli/ink-studio.js');
  const run = (...args)=>spawnSync(process.execPath,[cli,...args],{cwd:dir,encoding:'utf8'});
  const json = (...args)=>{
    const result=run(...args);
    assert.equal(result.status,0,result.stderr);
    return JSON.parse(result.stdout);
  };
  const change=['mesh-topology','plane','draft.json','--origin','1,2,3','--right','0,0,-2','--up','0,3,0','--grid','.25'];
  const preview=json(...change);
  assert(!fs.existsSync(file('plane.json')));
  assert.deepEqual(json(...change,'--out','plane.json'),preview);
  assert.deepEqual(read('draft.json'),scene);
  assert.deepEqual(json('mesh-topology','plane','plane.json').after,plane);
  const placed = json('tileset','stamp','--scene','plane.json','--object','jig','--face','panel','--id','paint',
    '--x','0','--y','0','--width','4','--height','3','--plane','2,1','--out','stamped.json');
  assert.deepEqual(placed.constructionPlane,plane);
  const editor = ink.createSceneEditor(read('stamped.json'));
  write('request.json',{selection:selected(editor),space:'plane',planePivot:[2,1],
    operation:{kind:'scale',factors:[2,2,1]}});
  const pivot = json('mesh-topology','transform','stamped.json','request.json','--object','jig');
  assert.deepEqual(pivot.report.worldPivot,placed.vertices[0].position);
  const align = ['mesh-topology','move','stamped.json','--object','jig','--vertex',target,'--by','.18,.13,.08',
    '--space','plane','--align','grid'];
  const move=json(...align);
  assert.deepEqual(json(...align,'--out','aligned.json'),move);
  assert.deepEqual(read('aligned.json').constructionPlane,plane);
  assert.deepEqual(move.snap.gridAt,[7,5]);
  close(read('aligned.json').topologyMeshes.jig.document.vertices.find(v=>v.id === target).position,[1,3.25,1.25]);
  assert.deepEqual(read('aligned.json').topologyMeshes.jig.bindings,read('stamped.json').topologyMeshes.jig.bindings);
});
