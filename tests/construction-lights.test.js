'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const ink = require('..');
const { KIT: K, AreaLights } = ink.load();
const { V } = K;
const near = (actual,expected) => assert.ok(V.dist(actual,expected)<1e-6,`Expected ${actual} near ${expected}`);
const world = at=>({kind:'world',at});
const socket = (object,id)=>({kind:'solid-socket',object,id});
const point = (instance,id)=>({kind:'object-point',instance,id});

function scene() {
  return {
    id:'construction-light',style:'slate',
    camera:{target:[0,.52,0],yaw:.34,pitch:.55,dist:5.8,projection:'orthographic',sway:0},
    constructionPlane:{origin:[0,1.6,.4],grid:[.25,.5],rounding:'floor'},
    solids:[{id:'floor',kind:'box',at:[0,-.14,0],half:[2.1,.14,1.7],mat:'stone'}],
    prefabs:{
      hoist:{revision:1,solids:{ boom:{kind:'box',at:[-1,1.75,0],half:[.15,.1,.28],part:'arm',
        sockets:{fixture:{p:[-1,1.62,.24],dir:[0,-1,0]}}} },
      parts:{arm:{joint:[-1,1.6,0]}},motion:{swing:{do:'spin',part:'arm',axis:[0,1,0],speed:Math.PI}}},
      marker:{revision:1,solids:{foot:{kind:'box',at:[0,.14,0],half:[.38,.14,.35],mat:'dark'}},
        points:{aim:{position:[0,.28,0]}}}
    },
    instances:{gantry:{prefab:'hoist'}, receiver:{prefab:'marker',transform:{translation:[.85,0,.1]}}}
  };
}

const emitter = {shape:'disk',size:[.28,.28],intensity:5,radius:4,sampleGrid:2,color:'#ffbf70',visible:false,shadows:true};
const place = {id:'key',fixture:{mount:{kind:'plane',at:[1.8,.4],height:.25,snapGrid:true},aim:world([.84,.2,.1]),emitter}};
const frames = w=>w.constructionLights.inspect();
const view = {w:132,h:100,raw:true,px:1};

test('construction grid placement can be parented without moving and aims at an independent point during rig motion',()=>{
  const source = scene(), editor = ink.createSceneEditor(source);
  const request = {...place,parent:{kind:'bone',part:'gantry.arm'}};
  assert.ok(editor.planConstructionLight(request).canCommit);
  assert.deepEqual(editor.snapshot(),source);
  editor.editConstructionLight(request);
  const saved = editor.snapshot(), row = saved.constructionLights.key;
  assert.deepEqual(row.mount,request.parent);
  near(row.local.position,[1.25,0,.65]);

  const w = editor.build();
  const [rest] = frames(w);
  near(rest.at,[.25,1.6,.65]);
  near(rest.target,place.fixture.aim.at);
  assert.equal(rest.status,'active');
  assert.ok(w.renderSdfs.length>0);

  w.anim.update(0,0);
  w.anim.update(.5,.5);
  const [posed] = frames(w);
  near(posed.at,w.anim.rig.at('gantry.arm',rest.at));
  near(posed.target,rest.target);
  near(posed.normal,V.norm(V.sub(rest.target,posed.at)));
  assert.ok(V.dist(posed.at,rest.at)>.3);
  assert.ok(V.dist(posed.normal,rest.normal)>.2);
  const [native] = AreaLights.prepare(w.areaLights,{time:.5});
  near(native.at,posed.at);
  near(native.normal,posed.normal);
  const lit = ink.render(w,{...view,t:.5});
  const without = ink.render(w,{...view,t:.5,areaLights:false});
  assert.notDeepEqual(lit.rgb,without.rgb);
  assert.deepEqual(editor.snapshot(),saved);
  editor.undo();
  assert.deepEqual(editor.snapshot(),source);
});

test('socket fixtures and object targets follow their own frames and suspend on hidden anchors',()=>{
  const editor = ink.createSceneEditor(scene());
  editor.editConstructionLight({id:'task',fixture:{mount:socket('gantry.boom','fixture'),
    aim:point('receiver','aim'),emitter}});
  let w = editor.build(), [first] = frames(w);
  near(first.at,[-1,1.62,.24]);
  near(first.target,[.85,.28,.1]);
  w.anim.update(0,0);
  w.anim.update(.4,.4);
  near(frames(w)[0].at,w.anim.where('gantry.boom/fixture'));

  editor.setPrefabInstance('receiver',{prefab:'marker',transform:{translation:[-.55,0,.7]}});
  w = editor.build();
  const [moved] = frames(w);
  near(moved.at,first.at);
  near(moved.target,[-.55,.28,.7]);
  assert.ok(V.dist(moved.normal,first.normal)>.1);
  editor.editSceneLayers({action:'set',layer:'markers'});
  editor.editSceneLayers({action:'move',layer:'markers',instances:['receiver']});
  editor.editSceneLayers({action:'set',layer:'markers',visible:false});
  const hidden = editor.build();
  assert.equal(frames(hidden)[0].status,'target-unavailable');
  assert.equal(AreaLights.prepare(hidden.areaLights)[0].intensity,0);
  assert.equal(AreaLights.prepare(hidden.areaLights)[0].volumeIntensity,0);

  const spec = editor.snapshot();
  assert.ok(K.diorama.scene(spec).model(1,{resolution:.15}).meshes.length>0);
  const bad = {...place,fixture:{...place.fixture,mount:socket('gantry.boom','missing')}};
  const denied = editor.planConstructionLight(bad);
  assert.equal(denied.canCommit,false);
  assert.match(denied.problems[0].problem,/Unknown light socket/);
});

test('a target on another rig moves independently and a coincident target suspends output',()=>{
  const source = scene(), marker = source.prefabs.marker;
  marker.solids.foot.part = 'pad';
  marker.solids.foot.sockets = {aim:{p:[0,.28,0],dir:[0,1,0]}};
  marker.parts = {pad:{joint:[0,0,0]}};
  marker.motion = {rise:{do:'bob',part:'pad',axis:[0,1,0],amount:.4,period:2}};
  source.constructionLights = {
    task:{mount:socket('gantry.boom','fixture'),aim:socket('receiver.foot','aim'),emitter},
    idle:{mount:world([0,1,0]),aim:world([0,1,0]),emitter}
  };
  const w = ink.createSceneEditor(source).build();
  const [rest,idle] = frames(w);
  assert.equal(idle.status,'coincident-target');
  assert.equal(AreaLights.prepare(w.areaLights).find(row=>row.id==='idle').intensity,0);
  w.anim.update(0,0);
  w.anim.update(.5,.5);
  const [active] = frames(w);
  near(active.at,w.anim.where('gantry.boom/fixture'));
  near(active.target,w.anim.where('receiver.foot/aim'));
  assert.ok(V.dist(active.at,rest.at)>.1);
  near(V.sub(active.target,rest.target),[0,.4,0]);
  near(active.normal,V.norm(V.sub(active.target,active.at)));
});

test('CLI previews actual pixels and resolved aim, then round-trips the authored fixture',t=>{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'ink-light-anchors-')), file = name=>path.join(dir,name);
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const write = (name,value)=>fs.writeFileSync(file(name),JSON.stringify(value));
  const read = name=>JSON.parse(fs.readFileSync(file(name)));
  const cli = path.resolve(__dirname,'../cli/ink-studio.js');
  const run = (...args)=>JSON.parse(execFileSync(process.execPath,[cli,...args],{cwd:dir,encoding:'utf8'}));
  const source = scene();
  write('scene.json',source);
  write('fixture.json',place);
  write('view.json',{w:128,h:96,camera:{ortho:true,target:[0,.46,0],yaw:.32,pitch:.58,dist:5.4}});
  const report = run('mesh-topology','construction-light','scene.json','fixture.json','--preview','review',
    '--view','view.json','--out','lit.json');
  assert.ok(report.canCommit);
  assert.ok(report.preview.changedPixels>20);
  assert.deepEqual(report.preview.lights.before,[]);
  assert.deepEqual(report.preview.lights.after[0].gridAt,[1,0]);
  near(report.preview.lights.after[0].at,[.25,1.6,.65]);
  for (const name of report.preview.files) assert.ok(fs.statSync(file('review/'+name)).size>0);
  assert.deepEqual(read('scene.json'),source);
  assert.deepEqual(read('lit.json').constructionLights.key,place.fixture);
  write('remove.json',{id:'key',fixture:null});
  assert.ok(run('mesh-topology','construction-light','lit.json','remove.json','--out','removed.json').canCommit);
  assert.deepEqual(read('removed.json').constructionLights,{});
});
