'use strict';

const assert = require('node:assert/strict'), {test} = require('node:test');
const {execFileSync,spawnSync} = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const ink = require('..'), R = require('../cli/render.js');
const {fixture} = require('../examples/tileset-pick/prefab-isolation-fixture.cjs');
const K = ink.load().KIT, L = K.authoring.sceneLayers;
const set = (layer,settings={}) => ({action:'set',layer,...settings});
const move = (layer,settings) => ({action:'move',layer,...settings});
const selection = (layer,settings={}) => ({domain:'instances',query:{layer,...settings}});
const ids = report => report.instances.map(row=>row.instance);

function setup({external=false}={}) {
  const {scene,library,view} = fixture(), {prefabLibrary,...base} = scene;
  library.bay.effects = {marker:{do:'lamp',at:[0,1.1,.12],r:1.2,strength:.8}};
  const source = {...(external ? scene : {...base,prefabs:library}),topologyMeshes:{},instances:{...scene.instances,
    upper:{prefab:'bay',parent:'east',transform:{translation:[0,1.02,.17],scale:.63}}}};
  const editor = ink.createSceneEditor(source,external ? {env:{prefabs:library}} : undefined);
  return {editor,library,view:{...view,w:250,h:144,camera:{...view.camera,target:[0,.86,0],zoom:1.18}}};
}

function organize(editor) {
  editor.editSceneLayers(set('station',{label:'Station'}));
  editor.editSceneLayers(set('west-wing',{parent:'station'}));
  editor.editSceneLayers(set('east-wing',{parent:'station'}));
  editor.editSceneLayers(set('yard'));
  editor.editSceneLayers(move('west-wing',{instances:['west']}));
  editor.editSceneLayers(move('east-wing',{instances:['east']}));
}

function counts(world,view) {
  const {passes} = R.render(world,{...view,raw:true,px:1,passes:['objectId']});
  return new Map(passes.objects.map((value,id)=>[value,passes.objectId.filter(x=>x===id).length]));
}

test('nested layers support branch selection and undoable bulk moves without changing placements',()=>{
  const {editor} = setup();
  organize(editor);
  assert.deepEqual(ids(editor.selectTilesetComponents(selection('station'))),['east','upper','west']);
  assert.deepEqual(ids(editor.selectTilesetComponents(selection('east-wing'))),['east','upper']);
  assert.deepEqual(editor.selectSceneLayer('east-wing'),['prefab:east','prefab:upper']);
  const root = editor.tree().children.find(row=>row.key==='layer:station');
  const east = root.children.find(row=>row.key==='layer:east-wing');
  assert.equal(east.children[0].key,'prefab:east');
  assert.equal(east.children[0].children[0].key,'prefab:upper');

  const worldFrames = scene => Array.from(K.authoring.scenePrefabs.placements(scene.instances),([id,row])=>[id,row?.mesh]);
  const before = editor.snapshot(), frames = worldFrames(before);
  const saved = editor.selectTilesetComponents(selection('east-wing'));
  const receipt = editor.editSceneLayers(move('yard',{selection:saved}));
  assert.deepEqual(receipt.moved,['east','upper']);
  assert.deepEqual(editor.snapshot().instances,before.instances);
  assert.deepEqual(worldFrames(editor.snapshot()),frames);
  assert.deepEqual(ids(editor.selectTilesetComponents(selection('yard'))),['east','upper']);
  editor.undo();
  assert.deepEqual(editor.snapshot(),before);
  editor.redo();
  editor.editSceneLayers(move(null,{instances:['upper']}));
  assert.deepEqual(ids(editor.selectTilesetComponents(selection(null))),['upper']);
  assert.equal(editor.snapshot().instances.upper.parent,'east');
  assert.equal(editor.tree().children.find(row=>row.key==='prefab:upper').layer,null);

  editor.editSceneLayers(move('yard',{from:'west-wing'}));
  assert.deepEqual(ids(editor.selectTilesetComponents(selection('yard'))),['east','west']);
});

test('hidden branches suppress mesh, SDF, attached decals and lamps while plans keep their authored names',()=>{
  const {editor,view} = setup();
  organize(editor);
  editor.addSurfaceDecal({id:'east-mark',kind:'lettering',anchor:{object:'east.panel',face:'sign',bias:.005,
    uv:{min:[.12,.12],max:[.21,.19]}},image:{width:1,height:1,pixels:[245,193,101,255]}});
  const original = editor.snapshot();
  const preview = editor.previewSceneLayers(set('east-wing',{visible:false}));
  assert(preview.report.canCommit,JSON.stringify(preview.report));
  const front = counts(preview.before,view), hidden = counts(preview.after,view);
  assert(front.get('west.panel')>0 && front.get('east.panel')>0 && front.get('upper.panel')>0);
  assert(hidden.get('west.panel')>0 && !hidden.get('east.panel') && !hidden.get('upper.panel'));
  assert(!preview.after.topologyMeshes['east.panel']);
  assert(!Object.hasOwn(preview.after.made,'east.body'));
  assert.equal(preview.before.lab.lit.lights.length,3);
  assert.equal(preview.after.lab.lit.lights.length,1);
  assert(preview.after.lab.lit.lights[0].p[0]<0);
  assert.deepEqual(editor.snapshot(),original);
  editor.editSceneLayers(set('east-wing',{visible:false}));
  assert.deepEqual(ids(editor.selectTilesetComponents(selection('east-wing'))),['east','upper']);
  assert.deepEqual(ids(editor.selectTilesetComponents(selection('east-wing',{includeHidden:false}))),[]);
  assert.equal(editor.snapshot().surfaceDecals.decals[0].id,'east-mark');

  editor.editSceneLayers(set('station',{visible:false}));
  editor.editSceneLayers(set('east-wing',{visible:true}));
  assert(!L.prepare(editor.snapshot()).isVisible('east'));
  assert.equal(Object.keys(editor.build().topologyMeshes ?? {}).length,0);
  editor.editSceneLayers(set('station',{visible:true}));
  assert(editor.build().topologyMeshes['east.panel']);

  editor.editSceneLayers(move('yard',{instances:['upper']}));
  editor.editSceneLayers(set('east-wing',{visible:false}));
  assert.equal(editor.build().spec.instances.upper.parent,'east');
  assert(editor.build().topologyMeshes['upper.panel']);
});

test('rendering a hidden branch prunes its breakable groups from the build and keeps authored references',()=>{
  const {editor} = setup();
  organize(editor);
  const original = editor.snapshot();
  const scene = {...original,breakables:{groups:[
    {id:'left',anchor:true,parts:['solid:west.body']},{id:'right',parts:['solid:east.body']}
  ],links:[['left','right']]}};
  const layered = ink.createSceneEditor(scene);
  assert.equal(layered.build().breakables.groups.length,2);
  layered.editSceneLayers(set('east-wing',{visible:false}));
  assert.deepEqual(layered.build().breakables.groups.map(row=>row.id),['left']);
  assert.deepEqual(layered.build().breakables.links,[]);
  assert.deepEqual(layered.snapshot().breakables,scene.breakables);
  layered.undo();
  assert.equal(layered.build().breakables.groups.length,2);
});

test('insertion targets new stamps, arrays, mirrors and promotions, while retirements clear membership',()=>{
  const {editor} = setup();
  organize(editor);
  editor.editSceneLayers({action:'insertion',layer:'yard'});
  editor.stampPrefab({prefab:'bay',id:'placed',at:[2,1]});
  editor.applyPrefabMirror({source:'west',instance:'mirror',plane:{origin:[2,0,0],normal:[1,0,0]}});
  editor.applyPrefabArray({id:'row',instance:'west',count:[2,1,1],spacing:[3,0,0]});
  assert.deepEqual(ids(editor.selectTilesetComponents(selection('yard'))),['mirror','placed','row.1.0.0']);
  editor.applyPrefabArray({id:'row',count:[1,1,1]});
  assert(!Object.hasOwn(editor.snapshot().sceneLayers.members,'row.1.0.0'));
  editor.setPrefabInstance('mirror',null);
  assert(!Object.hasOwn(editor.snapshot().sceneLayers.members,'mirror'));
  const {panel} = fixture();
  const source = ink.createSceneEditor({...editor.snapshot(),topologyMeshes:{panel}});
  source.promoteTilesetPrefab({prefab:'loose-bay',instance:'promoted',faces:{panel:['sign','grille']}});
  assert.equal(source.snapshot().sceneLayers.members.promoted,'yard');
  editor.applyPrefabVariant({instance:'placed',mode:'detach'});
  assert(!Object.hasOwn(editor.snapshot().sceneLayers.members,'placed'));
  editor.editSceneLayers({action:'insertion',layer:null});
  editor.combinePrefabs({prefab:'wing-pair',instance:'pair',mode:'replace',instances:['east','upper']});
  assert.deepEqual(ids(editor.selectTilesetComponents(selection('east-wing'))),['pair']);
  assert.deepEqual(editor.snapshot().sceneLayers.members,{west:'west-wing',pair:'east-wing'});
});

test('invalid layer hierarchies and destinations leave the scene untouched',()=>{
  const {editor} = setup();
  organize(editor);
  const before = editor.snapshot();
  const cycle = editor.planSceneLayers(set('station',{parent:'east-wing'}));
  assert.match(cycle.conflicts[0].problem,/parent cycle/);
  assert.equal(editor.planSceneLayers(move('unknown',{instances:['east']})).canCommit,false);
  assert.throws(()=>editor.editSceneLayers(set('station',{parent:'east-wing'})),/need review/);
  assert.deepEqual(editor.snapshot(),before);
  assert.throws(()=>ink.createSceneEditor({...before,sceneLayers:null}),/Scene layers need/);
  assert.throws(()=>ink.createSceneEditor({...before,sceneLayers:{...before.sceneLayers,members:{retired:'yard'}}}),
    /Invalid layer membership/);
});

test('CLI exports a reusable branch selection, previews hiding and moves that saved population',t=>{
  const {editor,library,view} = setup({external:true}), dir = fs.mkdtempSync(path.join(os.tmpdir(),'ink-scene-layers-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  organize(editor);
  const cli = path.resolve(__dirname,'../cli/ink-studio.js'), original = editor.snapshot();
  const write = (name,value)=>fs.writeFileSync(path.join(dir,name),JSON.stringify(value));
  const read = name=>JSON.parse(fs.readFileSync(path.join(dir,name),'utf8'));
  const run = (...args)=>JSON.parse(execFileSync(process.execPath,[cli,...args],{cwd:dir}));
  write('source.json',original);
  write('library.json',library);
  write('view.json',view);
  write('hide.json',set('east-wing',{visible:false}));
  write('pick.json',selection('east-wing'));
  write('move.json',move('yard',{}));
  const hide = run('mesh-topology','scene-layer','source.json','hide.json','--preview','review','--view','view.json',
    '--out','hidden.json');
  assert(hide.canCommit);
  assert.equal(hide.preview.instances.find(row=>row.instance==='east').afterPixels,0);
  const selected = run('tileset','select','pick.json','--scene','hidden.json','--out','selection.json');
  assert.deepEqual(ids(selected),['east','upper']);
  const relocated = run('mesh-topology','scene-layer','hidden.json','move.json','--selection','selection.json','--out','moved.json');
  assert.deepEqual(relocated.moved,['east','upper']);
  assert.equal(read('moved.json').sceneLayers.members.upper,'yard');
  assert.deepEqual(read('source.json'),original);
  write('bad.json',set('station',{parent:'east-wing'}));
  const bad = spawnSync(process.execPath,[cli,'mesh-topology','scene-layer','source.json','bad.json','--out','rejected.json'],
    {cwd:dir,encoding:'utf8'});
  assert.equal(bad.status,1);
  assert(!fs.existsSync(path.join(dir,'rejected.json')));
});
