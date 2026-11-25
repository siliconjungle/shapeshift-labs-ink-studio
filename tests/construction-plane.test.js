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

function edgeScene() {
  const vertices = [], faces = [];
  for (const [face,x] of [['beam',0],['spare',4]]) {
    const ids = ['bl','br','tr','tl'].map(id=>face+'-'+id);
    const corners = [[x,0,0],[x+2,0,0],[x+2,1,0],[x,1,0]].map((position,i)=>{
      const vertex=ids[i];
      vertices.push({id:vertex,position});
      return {id:vertex+'-c',vertex};
    });
    faces.push({id:face,corners});
  }
  return {...scene,topologyMeshes:{wall:{document:{id:'wall',vertices,faces,edges:[
    {id:'eave',vertices:['beam-tl','beam-tr']},{id:'upright',vertices:['beam-bl','beam-tl']}]}}}};
}

test('edge tilt stores its directed hinge and measures each angle from the retained reference',()=>{
  const base = edgeScene(), kit = ink.load().KIT;
  const editor = ink.createSceneEditor(base), guides = kit.authoring.constructionPlane;
  const frame = guides.tilt(base,{object:'wall',edge:'eave',from:'beam-tl',degrees:45,at:.25});
  assert.deepEqual(frame.plane.edgeAnchor,{object:'wall',edge:'eave',vertices:['beam-tl','beam-tr'],
    at:.25,degrees:45,referenceUp:[0,1,0]});
  assert.deepEqual(frame.plane.origin,[.5,1,0]);
  assert.deepEqual(frame.axes[0],[1,0,0]);
  close(frame.axes[1],[0,Math.SQRT1_2,Math.SQRT1_2]);
  editor.setConstructionPlane(frame.plane);
  const first = editor.placeTilesetFace({...stamp,face:'roof',planeAt:[0,0]});
  close(first.vertices[0].position,[.5,1,0]);
  close(first.vertices[3].position,[.5,1+.75*Math.SQRT1_2,.75*Math.SQRT1_2]);

  const next = guides.tilt(editor.snapshot(),{degrees:30});
  close(next.axes[1],[0,Math.sqrt(3)/2,.5]);
  assert.deepEqual(next.plane.edgeAnchor.referenceUp,[0,1,0]);
  const reversed = guides.tilt(editor.snapshot(),{from:'beam-tr',degrees:45,at:0});
  close(reversed.axes[1],[0,Math.SQRT1_2,-Math.SQRT1_2]);
  assert.deepEqual(reversed.plane.origin,[2,1,0]);
  const vertical = guides.tilt(base,{object:'wall',edge:'upright',degrees:0});
  close(vertical.axes[1],[0,0,1]);
  assert.throws(()=>guides.tilt(base,{object:'wall',edge:'upright',degrees:0,referenceUp:[0,1,0]}),/parallel/);
  assert.throws(()=>guides.tilt(base,{object:'wall',edge:'eave',degrees:0,at:1.1}),/fraction/);
});

test('stamps and pivots follow a moved hinge and a deleted hinge stays repairable',()=>{
  const editor = ink.createSceneEditor(edgeScene()), guides = ink.load().KIT.authoring.constructionPlane;
  editor.setConstructionPlane(guides.tilt(editor.snapshot(),{object:'wall',edge:'eave',from:'beam-tl',degrees:30,at:.25}).plane);
  editor.placeTilesetFace({...stamp,face:'roof',planeAt:[0,0]});
  const before=editor.snapshot(), oldOrigin=editor.constructionPlane().origin;
  editor.editMeshTopology('wall',{vertices:[{id:'beam-tr',position:[2,1,.5]}]});
  const live = editor.constructionPlane();
  assert.deepEqual(live.origin,[.5,1,.125]);
  assert.deepEqual(editor.snapshot().constructionPlane,before.constructionPlane);
  assert.deepEqual(editor.snapshot().topologyMeshes.jig,before.topologyMeshes.jig);
  assert.deepEqual(editor.planTilesetFace({...stamp,face:'next',planeAt:[0,0]}).vertices[0].position,live.origin);
  const pick = editor.selectMeshTopology('jig',{domain:'vertices',ids:['roof/v2']});
  const move = editor.planMeshTransform('jig',{selection:pick,space:'plane',operation:{kind:'move',offset:[.1,0,0]}});
  assert.deepEqual(move.report.worldPivot,live.origin);
  editor.undo();
  assert.deepEqual(editor.constructionPlane().origin,oldOrigin);
  editor.editMeshTopology('wall',{removeFaces:['beam']});
  assert.throws(()=>editor.planTilesetFace({...stamp,face:'unresolved'}),/edge eave is unavailable/);
  assert.doesNotThrow(()=>editor.build());
  editor.setConstructionPlane({edgeAnchor:null});
  assert.equal(editor.constructionPlane().edgeAnchor,undefined);
  assert.deepEqual(editor.constructionPlane().origin,oldOrigin);
  editor.undo();
  assert.throws(()=>editor.constructionPlane(),/edge eave is unavailable/);

  const stale = JSON.parse(JSON.stringify(before));
  stale.topologyMeshes.wall.document.edges = [{id:'eave',vertices:['beam-bl','beam-br']}];
  assert.throws(()=>ink.createSceneEditor(stale).constructionPlane(),/different endpoints/);
});

test('CLI previews an edge tilt and repeats it from the saved hinge and angle',t=>{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'ink-edge-plane-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file = name=>path.join(dir,name), read = name=>JSON.parse(fs.readFileSync(file(name),'utf8'));
  fs.writeFileSync(file('draft.json'),JSON.stringify(edgeScene()));
  const cli = path.resolve(__dirname,'../cli/ink-studio.js');
  const run = (...args)=>spawnSync(process.execPath,[cli,...args],{cwd:dir,encoding:'utf8'});
  const json = (...args)=>{
    const result=run(...args);
    assert.equal(result.status,0,result.stderr);
    return JSON.parse(result.stdout);
  };
  const hinge = ['mesh-topology','plane','draft.json','--edge-object','wall','--edge','eave',
    '--edge-from','beam-tl','--edge-at','.5','--tilt','30'];
  const preview=json(...hinge);
  assert(!fs.existsSync(file('roof.json')));
  assert.deepEqual(json(...hinge,'--out','roof.json'),preview);
  assert.deepEqual(read('roof.json').constructionPlane,preview.after);
  assert.deepEqual(preview.after.origin,[1,1,0]);
  const updated=json('mesh-topology','plane','roof.json','--tilt','45','--out','steep-roof.json');
  assert.deepEqual(updated.after.edgeAnchor,{...preview.after.edgeAnchor,degrees:45});
  close(updated.axes[1],[0,Math.SQRT1_2,Math.SQRT1_2]);
  const placed=json('tileset','stamp','--scene','steep-roof.json','--object','roof','--face','board','--id','paint',
    '--x','0','--y','0','--width','4','--height','3','--plane','0,0');
  assert.deepEqual(placed.vertices[0].position,updated.after.origin);
  const waiting=run('mesh-topology','plane','steep-roof.json','--from-camera','--out','blocked.json');
  assert.equal(waiting.status,1);
  assert.match(waiting.stderr,/Detach the edge anchor/);
  assert(!fs.existsSync(file('blocked.json')));
  assert.equal(json('mesh-topology','plane','steep-roof.json','--detach-edge','--from-camera','--yaw','0','--pitch','0',
    '--out','detached.json').after.edgeAnchor,undefined);
});

function originScene() {
  return {...edgeScene(),constructionPlane:{origin:[10,10,10],grid:.25,lock:'z'},
    prefabs:{post:{revision:1,solids:{pole:{kind:'box',at:[0,.3,0],half:[.1,.3,.1],mat:'stone'}}}},
    instances:{fixture:{prefab:'post',transform:{translation:[1,2,3],pivot:[2,0,1],scale:2}}}};
}

test('origin snaps distinguish component averages from bounds and retain the locked frame',()=>{
  const source = originScene(), editor = ink.createSceneEditor(source);
  const pick = (domain,ids)=>editor.selectMeshTopology('wall',{domain,ids});
  const snap = (kind,selection)=>editor.planConstructionOrigin({kind,object:'wall',selection});
  const vertices = pick('vertices',['beam-tl','beam-tr','beam-br']);
  const bounds = snap('bounds',vertices);
  assert.deepEqual(bounds.plane.origin,[1,.5,0]);
  assert.deepEqual(bounds.snap.bounds,{min:[0,0,0],max:[2,1,0]});
  const average = snap('average',vertices);
  close(average.plane.origin,[4/3,2/3,0]);
  assert.equal(average.snap.count,3);
  assert.deepEqual(snap('average',pick('edges',['eave','upright'])).plane.origin,[.5,.75,0]);
  assert.deepEqual(snap('average',pick('faces',['beam','spare'])).plane.origin,[3,.5,0]);
  assert.deepEqual(editor.snapshot(),source);

  const vertex = {kind:'vertex',object:'wall',vertex:'beam-tr'};
  const placed = editor.snapConstructionOrigin(vertex);
  assert.deepEqual(placed.snap.target,[2,1,0]);
  assert.deepEqual(placed.plane,{origin:[2,1,0],right:[1,0,0],up:[0,1,0],grid:.25,lock:'z'});
  assert.deepEqual(editor.planTilesetFace({...stamp,planeAt:[0,0]}).vertices[0].position,placed.plane.origin);
  editor.undo();
  assert.deepEqual(editor.snapshot(),source);

  const instance = editor.planConstructionOrigin({kind:'instance',instance:'fixture'});
  assert.deepEqual(instance.snap,{kind:'instance',instance:'fixture',instanceKind:'prefab',target:[-1,2,2]});
  const guides = ink.load().KIT.authoring.constructionPlane;
  const placements = {...source,assetParts:{fixture:{transform:{position:[5,6,7]}}}};
  assert.throws(()=>guides.snapOrigin(placements,{kind:'instance',instance:'fixture'}),/ambiguous/);
  assert.deepEqual(guides.snapOrigin(placements,{kind:'instance',instance:'fixture',instanceKind:'asset-part'}).plane.origin,[5,6,7]);

  assert.throws(()=>snap('bounds',pick('vertices',[])),/Select at least one/);
  assert.throws(()=>editor.planConstructionOrigin({...vertex,vertex:'missing'}),/Unknown scene vertex/);
  editor.editMeshTopology('wall',{vertices:[{id:'beam-tr',position:[2,1,.25]}]});
  assert.throws(()=>snap('average',vertices),/same topology revision/);
});

test('origin snapping can slide along a hinge or explicitly detach it',()=>{
  const editor = ink.createSceneEditor(edgeScene()), guides = ink.load().KIT.authoring.constructionPlane;
  const edge = guides.tilt(editor.snapshot(),{object:'wall',edge:'eave',from:'beam-tl',degrees:35});
  editor.setConstructionPlane(edge.plane);
  const end = editor.snapConstructionOrigin({kind:'vertex',object:'wall',vertex:'beam-tr'});
  assert.equal(end.plane.edgeAnchor.at,1);
  assert.equal(end.plane.edgeAnchor.degrees,35);
  assert.deepEqual(end.plane.origin,[2,1,0]);
  const away = {kind:'vertex',object:'wall',vertex:'beam-br'};
  assert.throws(()=>editor.snapConstructionOrigin(away),/Detach the edge anchor/);
  const detached = editor.snapConstructionOrigin(away,{detachEdge:true});
  assert.equal(detached.plane.edgeAnchor,undefined);
  assert.deepEqual(detached.plane.origin,[2,0,0]);
  assert.deepEqual(detached.axes,end.axes);
  editor.undo();
  assert.deepEqual(editor.constructionPlane(),end.plane);
});

test('headless origin snap previews and publishes vertex, instance, bounds, and average targets',t=>{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'ink-origin-snap-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file = name=>path.join(dir,name), write = (name,value)=>fs.writeFileSync(file(name),JSON.stringify(value));
  const read = name=>JSON.parse(fs.readFileSync(file(name),'utf8'));
  const source = originScene();
  write('draft.json',source);
  write('query.json',{domain:'vertices',ids:['beam-tl','beam-tr','beam-br']});
  const cli = path.resolve(__dirname,'../cli/ink-studio.js');
  const run = (...args)=>spawnSync(process.execPath,[cli,...args],{cwd:dir,encoding:'utf8'});
  const json = (...args)=>{
    const result=run(...args);
    assert.equal(result.status,0,result.stderr);
    return JSON.parse(result.stdout);
  };
  const selected = run('mesh-topology','select','draft.json','query.json','--object','wall','--out','selection.json');
  assert.equal(selected.status,0,selected.stderr);
  const prefix = ['mesh-topology','plane','draft.json','--snap-origin'];
  const targets = [['vertex',['--object','wall','--vertex','beam-tr'],[2,1,0]],
    ['instance',['--instance','fixture'],[-1,2,2]],
    ['bounds',['--object','wall','--selection','selection.json'],[1,.5,0]],
    ['average',['--object','wall','--selection','selection.json'],[4/3,2/3,0]]];
  for (const [mode,args,point] of targets) {
    const preview=json(...prefix,mode,...args);
    close(preview.snap.target,point);
    assert(!fs.existsSync(file(mode+'.json')));
    assert.deepEqual(json(...prefix,mode,...args,'--out',mode+'.json'),preview);
    assert.deepEqual(read(mode+'.json').constructionPlane,preview.after);
  }
  const stamped=json('tileset','stamp','--scene','average.json','--object','marker','--face','swatch','--id','paint',
    '--x','0','--y','0','--width','4','--height','3','--plane','0,0');
  close(stamped.vertices[0].position,[4/3,2/3,0]);
  assert.equal(run(...prefix,'bounds','--object','wall','--selection','selection.json','--out','selection.json').status,1);
  assert.deepEqual(read('draft.json'),source);
});

test('retained rectangular grids round signed placement addresses and alignment consistently',()=>{
  const guides = ink.load().KIT.authoring.constructionPlane;
  const editor = ink.createSceneEditor(scene);
  const at = [1.65,-1.75];
  const targets = [['nearest',[2,-2]],['floor',[1,-2]],['ceiling',[2,-1]]];
  for (const [rounding,gridAt] of targets) {
    const stored = editor.setConstructionPlane({origin:[10,20,30],right:[1,0,-1],up:[0,1,0],grid:[.25,.5],rounding});
    const frame = guides.resolve(stored);
    const placed = editor.planTilesetFace({...stamp,planeAt:at,snapGrid:true});
    assert.deepEqual(placed.planeAt,at);
    assert.deepEqual(placed.gridAt,gridAt);
    close(placed.vertices[0].position,guides.point(frame,gridAt));
    close(editor.planTilesetFace({...stamp,planeAt:at}).vertices[0].position,guides.point(frame,at));
    const point = guides.point(frame,at);
    assert.deepEqual(guides.project(frame,point,'grid').gridAt,gridAt);
    assert.deepEqual(guides.project(frame,guides.point(frame,[-3,4]),'grid').gridAt,[-3,4]);
    close(guides.project(frame,point,'plane').gridAt,at);
  }
  assert.deepEqual(guides.quantize(guides.resolve(),[-1.5,1.5]),[-1,2]);
  assert.throws(()=>editor.planTilesetFace({...stamp,planeAt:undefined,snapGrid:true}),/plane placement/);
  assert.throws(()=>editor.setConstructionPlane({grid:[1,0]}),/positive/);
  assert.throws(()=>editor.setConstructionPlane({rounding:['floor']}),/rounding/);
  assert.equal(ink.createSceneEditor(JSON.parse(JSON.stringify(editor.snapshot()))).constructionPlane().rounding,'ceiling');
  editor.undo();
  assert.equal(editor.constructionPlane().rounding,'floor');
});

test('grid presets resolve density, authored tile extents, and custom module dimensions',()=>{
  const guides = ink.load().KIT.authoring.constructionPlane;
  const base = {id:'preset-grid',style:'slate',solids:[]};
  assert.deepEqual(guides.gridPreset(base,{kind:'texel'}).grid,1/16);
  assert.deepEqual(guides.gridPreset(base,{kind:'texel'},{projectTexelsPerUnit:32}).grid,1/32);
  assert.deepEqual(guides.gridPreset(base,{kind:'brick'}).grid,[1,.5]);
  const source = {...base,tilesetDefaults:{texelsPerUnit:8,tileSize:{width:4,height:3}},tilesets:{
    masonry:{...ink.createBlankTileset({width:16,height:8}),tileSize:{width:8,height:2,paddingX:4,paddingY:1}}
  }};
  assert.deepEqual(guides.gridPreset(source,{kind:'brick'}).grid,[.5,.375]);
  assert.deepEqual(guides.gridPreset(source,{kind:'brick',tileset:'masonry'},{projectTexelsPerUnit:32}).grid,[1,.25]);
  assert.deepEqual(guides.gridPreset(source,{kind:'module',moduleSize:[2,1.5]}).grid,[2,1.5]);
  assert.equal(guides.gridPreset(source,{kind:'module'}).grid,1);
  assert.throws(()=>guides.gridPreset(source,{kind:'module',moduleSize:null}),/positive/);
  assert.throws(()=>guides.gridPreset(source,{kind:'texel',tileset:'masonry'}),/grid preset/);
});

test('headless brick preset and rounding round stamps and mesh alignment on one saved plane',t=>{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'ink-grid-preset-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file = name=>path.join(dir,name);
  const source = edgeScene();
  source.tilesets = {...source.tilesets,paint:{...source.tilesets.paint,tileSize:{width:4,height:3}}};
  fs.writeFileSync(file('draft.json'),JSON.stringify(source));
  const cli = path.resolve(__dirname,'../cli/ink-studio.js');
  const run = (...args)=>spawnSync(process.execPath,[cli,...args],{cwd:dir,encoding:'utf8'});
  const json = (...args)=>{
    const result=run(...args);
    assert.equal(result.status,0,result.stderr);
    return JSON.parse(result.stdout);
  };
  const command=['mesh-topology','plane','draft.json','--grid-preset','brick','--grid-tileset','paint','--rounding','ceiling'];
  const preview=json(...command);
  assert.deepEqual(preview.gridPreset.grid,[1,.75]);
  assert(!fs.existsSync(file('grid.json')));
  assert.deepEqual(json(...command,'--out','grid.json'),preview);
  const placed=json('tileset','stamp','--scene','grid.json','--object','guide','--face','sample','--id','paint',
    '--x','0','--y','0','--width','4','--height','3','--plane','-.67,1.2','--snap-grid');
  assert.deepEqual(placed.gridAt,[0,2]);
  assert.deepEqual(placed.vertices[0].position,[0,1.5,0]);
  const aligned=json('mesh-topology','move','grid.json','--object','wall','--vertex','beam-tr',
    '--by','.2,.1,0','--align','grid');
  assert.deepEqual(aligned.snap.gridAt,[3,2]);
  assert.deepEqual(aligned.vertices[0].after,[3,1.5,0]);
  assert.equal(aligned.constructionPlane.rounding,'ceiling');
  const custom=json('mesh-topology','plane','grid.json','--grid','.125,.5','--rounding','floor');
  assert.deepEqual(custom.after.grid,[.125,.5]);
  const module=json('mesh-topology','plane','grid.json','--grid-preset','module','--module-size','2,1.5');
  assert.deepEqual(module.after.grid,[2,1.5]);
  assert.equal(run(...command,'--grid','1','--out','blocked.json').status,1);
  assert(!fs.existsSync(file('blocked.json')));
});
