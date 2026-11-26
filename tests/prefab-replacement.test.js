'use strict';

const assert = require('node:assert/strict');
const {execFileSync,spawnSync} = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {test} = require('node:test');
const ink = require('..');
const {fixture} = require('../examples/tileset-pick/prefab-isolation-fixture.cjs');
const T = ink.load().KIT.meshTopology;

const pick = (scene,column) => ink.pickTilesetRectangle(scene,'enamel',{x:column*24,y:0,width:24,height:24});
const crop = (row,face) => row.bindings.find(binding=>binding.element===face).data.selection.x;

function setup({external=false,renamed=false,anchorLost=false,bodyRemoved=false,attachment=false}={}) {
  const {scene,library,request,view} = fixture(), {prefabLibrary,...base} = scene;
  const original = library.bay, panel = original.topologyMeshes.panel;
  const edit = ink.createSceneEditor({...base,instances:{},topologyMeshes:{panel}});
  edit.applyTilesetReskin({object:'panel',face:anchorLost ? 'sign' : 'grille',selection:pick(scene,anchorLost ? 2 : 0)});
  let next = edit.meshTopology('panel');
  if (renamed) next = {...next,document:T.create({...next.document,faces:next.document.faces.map(face =>
    face.id==='sign' ? {...face,id:'badge'} : face)}),bindings:next.bindings.map(binding =>
    binding.element==='sign' ? {...binding,element:'badge'} : binding)};
  if (attachment) {
    const source = T.triangulate(panel.document).triangleSources.find(row=>row.face==='grille');
    original.topologyMeshes.panel = {...panel,attachments:T.attachments.create(panel.document,
      [{id:'grille-root',kind:'curve-root',anchor:{face:source.face,corners:source.corners,weights:[.35,.3,.35]}}])};
  }
  const target = {revision:7,solids:bodyRemoved ? {} :
    {[renamed ? 'shell' : 'body']:{...original.solids.body,half:[.85,.5,.12],mat:'stone'}},
    topologyMeshes:{[renamed ? 'fascia' : 'panel']:next},usesTilesets:['enamel']};
  const third = {prefab:'bay',transform:{translation:[0,2,0]}};
  const source = {...(external ? scene : {...base,prefabs:{...library,revised:target}}),
    instances:{...scene.instances,east:{...scene.instances.east,overrides:[{op:'set',path:'/solids/body/mat',value:'dark'}]},third}};
  const prefabs = {...library,revised:target};
  const editor = ink.createSceneEditor(source,external ? {env:{prefabs}} : undefined);
  editor.editIsolatedPrefab(request);
  for (const [instance,u] of [['east',.06],['west',.72]])
    editor.addSurfaceDecal({id:instance+'-marker',kind:'lettering',
      anchor:{object:instance+'.panel',face:'sign',uv:{min:[u,.33],max:[u+.08,.49]},bias:.004},
      image:{width:1,height:1,pixels:[247,202,117,255]}});
  return {editor,prefabs,view};
}

test('replaces a batch, carries exact transforms and local edits, and transfers static mesh anchors',()=>{
  const {editor} = setup({attachment:true}), before = editor.snapshot();
  const request = {instances:['west','east'],to:'revised',revision:7};
  const report = editor.planPrefabReplacement(request);
  assert(report.canCommit,JSON.stringify(report));
  assert.deepEqual(editor.snapshot(),before);
  assert.deepEqual(report.instances.map(row=>row.instance),['east','west']);
  assert.equal(report.instances[0].overrides[0].status,'touched');
  assert.equal(report.instances[1].meshOverrides[0].status,'rebased');
  assert.equal(report.anchors.filter(row=>row.kind==='mesh-attachment' && row.status==='transferred').length,2);
  assert(report.anchors.filter(row=>row.kind==='decal').every(row=>row.status==='retained' && row.coverage.after>0));

  assert.deepEqual(editor.replacePrefabs(request),report);
  const saved = editor.snapshot(), world = editor.build();
  assert.deepEqual(saved.instances.third,before.instances.third);
  assert.deepEqual(saved.prefabs,before.prefabs);
  assert.deepEqual(saved.surfaceDecals,before.surfaceDecals);
  for (const id of request.instances) {
    assert.equal(saved.instances[id].prefab,'revised');
    assert.deepEqual(saved.instances[id].transform,before.instances[id].transform);
    assert.equal(saved.instances[id].meshOverrides.panel.revision,7);
    assert.equal(world.topologyMeshes[id+'.panel'].attachmentStatus,'ready');
  }
  assert.deepEqual(saved.instances.east.overrides,before.instances.east.overrides);
  const west = saved.instances.west.meshOverrides.panel.mesh;
  assert.equal(crop(west,'sign'),48);
  assert.equal(crop(west,'grille'),0);
  editor.undo();
  assert.deepEqual(editor.snapshot(),before);
  editor.redo();
  assert.deepEqual(editor.snapshot(),saved);
  assert.equal(editor.planPrefabReplacement(request).changed,false);
});

test('maps renamed components by local ID and remaps a named face decal',()=>{
  const {editor} = setup({renamed:true}), before = editor.snapshot();
  const request = {instances:['east'],to:'revised',migrations:{bay:{revision:3,
    members:{solids:{body:'shell'},topologyMeshes:{panel:'fascia'}},faces:{panel:{sign:'badge'}}}}};
  const report = editor.replacePrefabs(request), saved = editor.snapshot();
  assert.equal(report.anchors.find(row=>row.kind==='decal').status,'remapped');
  const override = report.instances[0].overrides[0];
  assert.deepEqual(override.fromPath,['solids','body','mat']);
  assert.deepEqual(override.path,['solids','shell','mat']);
  assert.deepEqual(saved.instances.east.overrides,[{op:'set',path:['solids','shell','mat'],value:'dark'}]);
  assert.deepEqual(saved.surfaceDecals.decals.find(row=>row.id==='east-marker').anchor,
    {...before.surfaceDecals.decals.find(row=>row.id==='east-marker').anchor,object:'east.fascia',face:'badge'});
  assert(saved.instances.west.prefab==='bay');
  assert(editor.build().topologyMeshes['east.fascia']);
});

test('blocks a lost decal footprint, removed override target, and stale revision without changing the scene',()=>{
  const request = {instances:['east','third'],to:'revised'};
  const {editor} = setup({anchorLost:true}), before = editor.snapshot();
  const report = editor.planPrefabReplacement(request);
  assert(!report.canCommit);
  assert(report.conflicts.some(row=>row.id==='east-marker' && row.reason==='decal-anchor-needs-review'));
  assert.throws(()=>editor.replacePrefabs(request),/needs review/);
  assert.deepEqual(editor.snapshot(),before);
  assert.throws(()=>editor.planPrefabReplacement({...request,revision:4}),/Stale replacement prefab revision/);

  const blocked = setup({bodyRemoved:true}).editor.planPrefabReplacement(request);
  assert(!blocked.canCommit);
  assert(blocked.conflicts.some(row=>row.instance==='east' && row.reason==='path-override-conflict'));
});

test('blocks an indexed control when its bound scene member would shift',()=>{
  const {editor} = setup({bodyRemoved:true});
  const scene = editor.snapshot(), {overrides,...east} = scene.instances.east;
  const placed = ink.createSceneEditor({...scene,instances:{...scene.instances,east},parameterBindings:{
    controls:{width:.88},bindings:[{path:'/solids/1/half/0',parameter:'width'}]
  }});
  const report = placed.planPrefabReplacement({instances:['east'],to:'revised'});
  assert(!report.canCommit);
  assert(report.conflicts.some(row=>row.reason==='indexed-parameter-target-moved'));
});

test('CLI consumes saved placements, previews paint and publishes a library-backed replacement',t=>{
  const {editor,prefabs,view} = setup({external:true});
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'ink-prefab-replacement-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const cli = path.resolve(__dirname,'../cli/ink-studio.js');
  const write = (name,value)=>fs.writeFileSync(path.join(dir,name),JSON.stringify(value));
  const read = name=>JSON.parse(fs.readFileSync(path.join(dir,name),'utf8'));
  const source = editor.snapshot();
  write('scene.json',source);
  write('library.json',prefabs);
  write('view.json',view);
  write('selection.json',editor.selectTilesetComponents({domain:'instances',query:{kind:'prefab',ids:['east','west']}}));
  write('replacement.json',{to:'revised',revision:7});
  const cmd = [cli,'mesh-topology','replace-prefab','scene.json','replacement.json','--selection','selection.json'];
  const report = JSON.parse(execFileSync(process.execPath,[...cmd,'--preview','preview','--view','view.json','--out','replaced.json'],{cwd:dir}));
  assert(report.canCommit);
  assert(report.preview.instances.every(row=>row.changedPixels>0));
  assert.equal(read('replaced.json').instances.east.prefab,'revised');
  assert.equal(read('replaced.json').instances.third.prefab,'bay');
  assert.deepEqual(read('scene.json'),source);
  assert.deepEqual(read('library.json'),prefabs);
  write('replacement.json',{to:'revised',revision:1});
  const rejected = spawnSync(process.execPath,[...cmd,'--out','rejected.json'],{cwd:dir,encoding:'utf8'});
  assert.equal(rejected.status,1);
  assert.match(rejected.stderr,/Stale replacement prefab revision/);
  assert(!fs.existsSync(path.join(dir,'rejected.json')));
});
