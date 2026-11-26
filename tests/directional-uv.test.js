const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const ink = require('..');
const R = require('../cli/render.js');
const Lens = require('../src/camera-lens.js');
const Atlas = require('../src/atlas-sprites.js');
const PNG = require('../cli/png.js');
const K = ink.load().KIT, API = K.authoring.directionalUV;
const Q = Math.PI/2, width = 32, height = 16;
const settings = {tileset:'signs',faces:['art'],directions:['n','e','s','w'],clip:'signal',default:'n'};

function atlas() {
  const frames = [], pixels = new Uint8Array(width*height*4);
  for (const pose of [0,1]) for (let d=0; d<4; d++) {
    const rect = {x:d*8,y:pose*8,width:8,height:8};
    frames.push({frame:pose,rect,yaw:d*Q,duration:pose ? .2 : .1});
    for (let y=0; y<8; y++) for (let x=0; x<8; x++)
      pixels.set([60+d*60,70+pose*140,45,255],4*((rect.y+y)*width+rect.x+x));
  }
  return {metadata:{width,height,frames,clips:[{id:'signal',frames:[0,1],playback:'loop'}]},images:{color:pixels}};
}

function scene() {
  const source = {id:'directional-uv',style:'slate',solids:[],
    tilesets:{signs:ink.readTilesetImage(PNG.encode(width,height,atlas().images.color,4))}};
  const editor = ink.createSceneEditor(source);
  const selection = ink.pickTilesetRectangle(source,'signs',{x:0,y:0,width:8,height:8});
  editor.placeTilesetFace({object:'sign',face:'art',origin:[-.7,0,0],worldSize:[1.4,1],selection});
  return {...editor.snapshot(),topologyMeshes:{},prefabs:{panel:{revision:1,solids:{},
    topologyMeshes:{sign:editor.meshTopology('sign')}}},
    instances:{first:{prefab:'panel',billboard:{mode:'full'}}}};
}

const view = {w:136,h:96,px:1,dist:4.5,target:[0,.48,0],pitch:.15,raw:true,ortho:true,passes:['objectId']};

test('authored prefab art follows enabled angles and keeps timing through camera switches',()=>{
  const source = scene(), editor = ink.createSceneEditor(source);
  const rule = API.fromAtlas(Atlas.compile(atlas()),settings);
  const edit = {instance:'first',revision:1,edits:[{member:'sign',directionalUV:rule}]};
  const plan = editor.planPrefabSourceEdit(edit);
  assert.ok(plan.canCommit,JSON.stringify(plan));
  editor.editPrefabSource(edit);
  const committed = editor.snapshot(), world = editor.build();
  const restMesh = world.topologyMeshes['first.sign'].mesh;
  const old = K.sceneMeshes.channelUV(restMesh,0,[1,0,0],'pigment').uv;
  const shown = world.directionalUV.sample(world,Lens.orbitPose(Q,0,4.5,[0,0,0]),.15);
  const nextMesh = shown.world.topologyMeshes['first.sign'].mesh;
  assert.equal(shown.rows[0].clip,'signal-e');
  assert.deepEqual(shown.rows[0].rect,{x:8,y:8,width:8,height:8});
  assert.equal(nextMesh.id,restMesh.id);
  assert.deepEqual(K.sceneMeshes.geometry(nextMesh).positions,K.sceneMeshes.geometry(restMesh).positions);
  const next = K.sceneMeshes.channelUV(nextMesh,0,[1,0,0],'pigment').uv;
  for (const [axis,span] of [width-1,height-1].entries()) assert.ok(Math.abs((next[axis]-old[axis])*span-8)<1e-5,JSON.stringify({old,next,axis}));
  assert.equal(K.meshTopology.triangleSource(nextMesh,0).face,'art');
  assert.equal(K.sceneMeshes.channelUV(restMesh,0,[1,0,0],'pigment').uv[0],old[0]);

  for (const [yaw,t,direction,pose] of [[0,.04,'n',0],[Q,.15,'e',1],[2*Q,.15,'s',1],[-Q,.31,'w',0]]) {
    const frame = R.render(world,{...view,yaw,t});
    assert.equal(frame.directionalUV[0].direction,direction);
    assert.equal(frame.directionalUV[0].frame,pose);
    assert.ok(frame.passes.objects.includes('first.sign'));
  }
  const square = R.render(world,{...view,yaw:0,t:.15}), east = R.render(world,{...view,yaw:Q,t:.15});
  assert.notDeepEqual(square.rgb,east.rgb);
  assert.deepEqual(editor.snapshot(),committed);
  assert.ok(editor.tilesetDependencies('signs').sheets[0].clips.some(row=>row.id==='signal-e' && row.frames[1].x===8));
  assert.equal(editor.planTilesetCanvas('signs',{type:'swap',
    a:{x:0,y:8,width:8,height:8},b:{x:8,y:8,width:8,height:8}}).canCommit,false);
  editor.undo();
  assert.deepEqual(editor.snapshot(),source);
});

test('sparse directions use nearest authored yaw, camera position and a vertical fallback',()=>{
  const asset = Atlas.compile(atlas());
  assert.throws(()=>API.fromAtlas(asset,{...settings,directions:['ne'],default:'ne'}),/No authored atlas view/);
  const rule = API.fromAtlas(asset,{...settings,directions:['n','w'],facing:'position'});
  const source = structuredClone(scene());
  source.prefabs.panel.topologyMeshes.sign.directionalUV = rule;
  source.instances.first.transform = {rotation:[Q,0,0]};
  const world = ink.createSceneEditor(source).build();
  assert.ok(world.directionalUV,JSON.stringify(K.diorama.check(source)));
  const sample = eye => world.directionalUV.sample(world,{eye,back:[0,0,1]},.2).rows[0];
  assert.equal(sample([0,0,4]).direction,'w');
  assert.equal(sample([4,0,0]).direction,'n');
  assert.equal(sample([0,4,0]).heading,null);
  assert.equal(sample([0,4,0]).direction,'n');

  const invalid = structuredClone(source);
  invalid.prefabs.panel.topologyMeshes.sign.directionalUV.clips['signal-w'].frames[0].rect.x = width;
  assert.ok(K.diorama.check(invalid).some(row=>/inside the tileset/.test(row.problem)));
});

test('atlas import, prefab revision and CLI render produce an inspectable clip receipt',t=>{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'ink-uv-angle-'));
  const file = name=>path.join(dir,name);
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const write = (name,data)=>fs.writeFileSync(file(name),JSON.stringify(data));
  const read = name=>JSON.parse(fs.readFileSync(file(name)));
  const cli = path.resolve(__dirname,'../cli/ink-studio.js');
  const run = (...parts)=>execFileSync(process.execPath,[cli,...parts],{cwd:dir,encoding:'utf8'});
  ink.writeSpriteAtlas(atlas(),{out:file('atlas.json')});
  write('settings.json',settings);
  run('pixel-art','directions','uv-clips','atlas.json','--settings','settings.json','--out','rule.json');
  write('source.json',scene());
  write('edit.json',{instance:'first',revision:1,edits:[{member:'sign',directionalUV:read('rule.json')}]});
  const receipt = JSON.parse(run('mesh-topology','edit-prefab','source.json','edit.json','--out','placed.json'));
  assert.equal(receipt.afterRevision,2);
  run('render','placed.json','--w','100','--h','80','--raw','--yaw',String(Q),'--t','.15',
    '--directional-uv-report','clip-report.json','--out','view.png');
  assert.deepEqual(read('clip-report.json').choices.map(({object,clip,frame})=>[object,clip,frame]),
    [['first.sign','signal-e',1]]);
  assert.ok(fs.statSync(file('view.png')).size>0);
});
