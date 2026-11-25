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

test('camera picking chooses the strongest face-on axis with predictable ties and signed winding',()=>{
  const {KIT,CameraLens} = ink.load();
  const picker = KIT.authoring.constructionPlane;
  const pose = (yaw,pitch=0)=>CameraLens.orbitPose(yaw,pitch,3,[0,0,0]);
  const view = [[0,0,'z',[0,0,1]],[Math.PI/2,0,'x',[1,0,0]],[0,Math.PI/2,'y',[0,1,0]],
    [0,-Math.PI/2,'y',[0,-1,0]],[Math.PI,0,'z',[0,0,-1]],[Math.PI/4,0,'z',[0,0,1]]];
  for (const [yaw,pitch,axis,normal] of view) {
    const pick = picker.pick({origin:[2,3,4],grid:.5},pose(yaw,pitch));
    assert.equal(pick.axis,axis);
    assert.deepEqual(pick.axes[2],normal);
    assert.deepEqual(pick.plane.origin,[2,3,4]);
    assert.equal(pick.plane.grid,.5);
    assert.equal(pick.plane.lock,undefined);
  }
  for (const lock of ['x','y','z']) {
    const initial = picker.pick({},pose(-1.2,.7),{lock});
    assert.equal(initial.axis,lock);
    assert.equal(initial.plane.lock,lock);
    const orbit = picker.pick(initial.plane,pose(2,-1));
    assert.equal(orbit.axis,lock);
    assert.equal(orbit.kept,true);
    assert.deepEqual(orbit.plane,initial.plane);
    const unlocked = picker.pick(initial.plane,pose(Math.PI/2),{lock:null});
    assert.equal(unlocked.axis,'x');
    assert.equal(unlocked.plane.lock,undefined);
  }
});

test('locks survive saved camera picks and stamp one frame through an orbit on the CLI',t=>{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'ink-camera-plane-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file = name=>path.join(dir,name), write = (name,value)=>fs.writeFileSync(file(name),JSON.stringify(value));
  const read = name=>JSON.parse(fs.readFileSync(file(name),'utf8'));
  const source = {...scene,camera:{yaw:Math.PI/2,pitch:.12}};
  write('draft.json',source);
  const cli = path.resolve(__dirname,'../cli/ink-studio.js');
  const run = (...args)=>spawnSync(process.execPath,[cli,...args],{cwd:dir,encoding:'utf8'});
  const json = (...args)=>{
    const result=run(...args);
    assert.equal(result.status,0,result.stderr);
    return JSON.parse(result.stdout);
  };
  const pick = (input,...args)=>json('mesh-topology','plane',input,...args);
  const auto = pick('draft.json','--from-camera');
  assert.equal(auto.camera.axis,'x');
  assert.deepEqual(auto.axes[2],[1,0,0]);
  const top = pick('draft.json','--yaw','0','--pitch','1.5');
  assert.equal(top.camera.axis,'y');
  assert.deepEqual(read('draft.json'),source);
  const lock = pick('draft.json','--yaw','1.57','--lock','X','--origin','1,2,3','--grid','.25','--out','locked.json');
  assert.equal(lock.after.lock,'x');
  const orbit = pick('locked.json','--from-camera','--yaw','-1.57','--pitch','-1.4','--out','orbit.json');
  assert.equal(orbit.camera.kept,true);
  assert.notDeepEqual(orbit.camera.pose.back,lock.camera.pose.back);
  assert.deepEqual(orbit.after,lock.after);
  assert.deepEqual(orbit.axes,lock.axes);
  const preview = input=>json('tileset','stamp','--scene',input,'--object','jig','--face','panel',
    '--id','paint','--x','0','--y','0','--width','4','--height','3','--plane','2,1');
  assert.deepEqual(preview('locked.json'),preview('orbit.json'));
  assert.deepEqual(preview('locked.json').vertices[0].position,[1,2.25,2.5]);
  const unlocked = pick('orbit.json','--yaw','0','--pitch','0','--lock','off','--out','released.json');
  assert.equal(unlocked.camera.axis,'z');
  assert.equal(unlocked.after.lock,undefined);
  assert.equal(read('released.json').constructionPlane.lock,undefined);
  assert.notDeepEqual(preview('orbit.json').vertices,preview('released.json').vertices);
  const plain = pick('locked.json','--lock','off','--out','manual.json');
  assert.deepEqual(plain.axes,lock.axes);
  assert.equal(read('manual.json').constructionPlane.lock,undefined);
  write('rigged.json',{...source,cameraRig:{duration:2,
    shots:{front:{yaw:0,pitch:0},floor:{yaw:0,pitch:1.5},side:{yaw:1.5,pitch:0}},
    sequence:[{time:0,shot:'front'},{time:1,shot:'floor'}]}});
  assert.equal(pick('rigged.json','--at','1.5').camera.axis,'y');
  assert.equal(pick('rigged.json','--camera-shot','side').camera.axis,'x');
  const editor = ink.createSceneEditor(read('locked.json'));
  editor.setConstructionPlane({lock:null});
  assert.equal(editor.constructionPlane().lock,undefined);
  editor.undo();
  assert.equal(editor.constructionPlane().lock,'x');
});
