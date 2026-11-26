'use strict';

const assert = require('node:assert/strict'), {test} = require('node:test');
const {execFileSync,spawnSync} = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const ink = require('..'), R = require('../cli/render.js');
const {fixture} = require('../examples/tileset-pick/prefab-isolation-fixture.cjs');
const K = ink.load().KIT;
const project = {version:1,definitions:{
  powered:{type:'boolean'},finish:{type:'enum',choices:['steel','enamel','copper']},
  gain:{type:'number',min:0,max:5},label:{type:'string'},optional:{type:'string'}
},values:{powered:true,finish:'steel',gain:1.5,label:'Station'}};
const west = {scope:'instance',instance:'west'};
const bay = {scope:'prefab',prefab:'bay'};
const render = (world,view) => R.render(world,{...view,raw:true,px:1}).rgb;

function setup({external=false}={}) {
  const {scene,library,view,request} = fixture(), {prefabLibrary,...base} = scene;
  library.bay.properties = {finish:'enamel',gain:2};
  const spec = {...(external ? scene : {...base,prefabs:library}),
    customProperties:external ? 'project-properties.json' : project,
    instances:{...scene.instances,west:{...scene.instances.west,properties:{powered:false,gain:0,label:''}},
      upper:{prefab:'bay',parent:'west',transform:{translation:[0,1.1,.1],scale:.6}}}};
  const env = external ? {prefabs:library,customProperties:project} : {};
  return {spec,env,view,request,editor:ink.createSceneEditor(spec,{env})};
}

test('resolves exact scalar values and records the project, prefab and instance contributors',()=>{
  const {editor,view} = setup(), input = editor.snapshot();
  const report = editor.planCustomProperties(west), rows = report.before;
  assert.equal(rows.finish.value,'enamel');
  assert.equal(rows.finish.source,'prefab');
  assert.deepEqual(rows.finish.authored,{project:'steel',prefab:'enamel'});
  assert.deepEqual(rows.finish.choices,['steel','enamel','copper']);
  assert.equal(rows.powered.value,false);
  assert.equal(rows.powered.source,'instance');
  assert.deepEqual(rows.gain.authored,{project:1.5,prefab:2,instance:0});
  assert.equal(rows.label.value,'');
  assert.equal(rows.optional.source,null);
  assert(!Object.hasOwn(rows.optional,'value'));
  assert.equal(editor.planCustomProperties({...west,instance:'upper'}).before.powered.value,true);
  assert.deepEqual(editor.build().customProperties.instances.west,{powered:false,finish:'enamel',gain:0,label:''});
  const change = {...west,values:{powered:null,gain:null,label:null}};
  const review = editor.previewCustomProperties(change);
  assert.deepEqual(render(review.before,view),render(review.after,view));
  editor.editCustomProperties(change);
  assert.equal(editor.snapshot().instances.west.properties,undefined);
  assert.deepEqual(editor.build().customProperties.instances.west,{powered:true,finish:'enamel',gain:2,label:'Station'});
  editor.undo();
  assert.deepEqual(editor.snapshot(),input);
  editor.redo();
  assert.equal(editor.snapshot().instances.west.properties,undefined);
});

test('validates definitions, numbers and overrides atomically at all scopes',()=>{
  const {editor,spec} = setup();
  const invalid = [{...west,values:{powered:'false'}},{...west,values:{gain:Infinity}},
    {...bay,values:{finish:'gold'}},{...bay,values:{label:0}},
    {values:{missing:1}},{definitions:{gain:{type:'number',min:3,max:1}}},
    {definitions:{gain:null},values:{gain:null}},
    {definitions:{finish:{type:'enum',choices:['steel']}}}];
  for (const change of invalid) {
    const report = editor.planCustomProperties(change);
    assert.equal(report.canCommit,false,JSON.stringify(change));
    assert.match(report.conflicts[0].reason,/invalid/);
    assert.throws(()=>editor.editCustomProperties(change),/need review/);
  }
  assert.deepEqual(editor.snapshot(),spec);
  const valid = editor.editCustomProperties({definitions:{tier:{type:'enum',choices:['quiet','busy']}},
    values:{tier:'quiet',label:'Westbound'}});
  assert.equal(valid.after.tier.source,'project');
  assert.equal(editor.build().customProperties.instances.east.label,'Westbound');
  assert.equal(editor.build().customProperties.instances.west.label,'');
  assert.throws(()=>ink.createSceneEditor({...spec,prefabs:{...spec.prefabs,
    unused:{revision:1,solids:{},properties:{gain:'1'}}}}),/needs a valid number/);
  const unused = ink.createSceneEditor({...spec,prefabs:{...spec.prefabs,unused:{revision:1,solids:{}}}});
  unused.editCustomProperties({scope:'prefab',prefab:'unused',values:{finish:'copper'}});
  assert.equal(unused.snapshot().prefabs.unused.properties.finish,'copper');
});

test('revises prefab properties with mesh overrides and carries metadata through hierarchy operations',()=>{
  const {editor,request} = setup();
  editor.editIsolatedPrefab(request);
  assert.equal(editor.planCustomProperties({...bay,revision:1,values:{gain:3}}).canCommit,false);
  const changed = editor.editCustomProperties({...bay,revision:3,values:{gain:3}});
  assert.equal(changed.afterPrefabRevision,4);
  assert.equal(editor.snapshot().instances.west.meshOverrides.panel.revision,4);
  assert.deepEqual(changed.affectedInstances,['east','upper']);
  editor.applyPrefabMirror({source:'west',instance:'echo',plane:{origin:[0,0,0],normal:[1,0,0]}});
  const echo = {...west,instance:'echo'};
  assert.equal(editor.planCustomProperties(echo).before.powered.value,false);
  assert.equal(editor.planCustomProperties({...echo,values:{powered:true}}).conflicts[0].reason,'edit-live-mirror-source');
  editor.applyPrefabMirror({action:'commit',instance:'echo'});
  editor.editCustomProperties({...echo,values:{powered:true}});
  editor.reparentPrefab({instance:'echo',parent:'west'});
  assert.equal(editor.planCustomProperties(echo).before.powered.value,true);
  editor.applyPrefabVariant({instance:'echo',mode:'fork',prefab:'clone'});
  assert.equal(editor.snapshot().prefabs.clone.properties.gain,3);
  assert.equal(editor.snapshot().instances.echo.properties.powered,true);
  editor.applyPrefabArray({id:'relay',instance:'west',count:[2,1,1],spacing:[2,0,0]});
  assert.equal(editor.planCustomProperties({...west,instance:'relay.1.0.0'}).before.powered.value,false);
});

test('combined replacement reports conflicting values and retains matching overrides',()=>{
  const {editor} = setup();
  const request = {prefab:'paired',mode:'replace',instance:'pair',instances:['west','east','upper']};
  const conflict = editor.planPrefabCombination(request);
  assert(!conflict.canCommit);
  assert.deepEqual(conflict.propertyDifferences.map(row=>row.property),['gain','label','powered']);
  editor.combinePrefabs({prefab:'reference-pair',mode:'keep',instances:request.instances});
  assert.equal(editor.snapshot().prefabs['reference-pair'].properties.finish,'enamel');
  assert(!Object.hasOwn(editor.snapshot().prefabs['reference-pair'].properties,'gain'));
  editor.editCustomProperties({...west,values:{powered:null,gain:null,label:null}});
  assert(editor.combinePrefabs(request).canCommit);
  assert.deepEqual(editor.build().customProperties.instances.pair,{powered:true,finish:'enamel',gain:2,label:'Station'});
});

test('CLI publishes overrides and prefab revisions while a bundle carries the shared project file',t=>{
  const {spec,env,editor} = setup({external:true}), dir = fs.mkdtempSync(path.join(os.tmpdir(),'ink-custom-properties-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const cli = path.resolve(__dirname,'../cli/ink-studio.js'), file = name=>path.join(dir,name);
  const write = (name,value)=>fs.writeFileSync(file(name),JSON.stringify(value));
  const read = name=>JSON.parse(fs.readFileSync(file(name),'utf8'));
  const run = (...args)=>JSON.parse(execFileSync(process.execPath,[cli,...args],{cwd:dir}));
  write('scene.json',spec);
  write('project-properties.json',env.customProperties);
  write('library.json',env.prefabs);
  write('clear.json',{...west,values:{gain:null,powered:null}});
  write('library-edit.json',{instance:'east',properties:{finish:'copper'}});
  assert.equal(editor.planCustomProperties({values:{gain:2}}).conflicts[0].reason,'edit-project-properties-file');
  const clear = run('mesh-topology','custom-properties','scene.json','clear.json','--out','clear-scene.json');
  assert.equal(clear.after.gain.source,'prefab');
  assert.equal(clear.after.powered.value,true);
  run('mesh-topology','edit-prefab','clear-scene.json','library-edit.json','--library-out','revised-library.json',
    '--out','revised-scene.json');
  assert.equal(read('revised-library.json').bay.properties.finish,'copper');
  assert.deepEqual(read('library.json'),env.prefabs);

  const {project:bundle} = require('../cli/project-bundle.js').packProject(file('revised-scene.json'),{out:file('bundle.json')});
  assert(bundle.files().includes('project-properties.json'));
  const bindings = bundle.resolve(bundle.scene()), reopened = ink.createSceneEditor(bindings.spec,{env:bindings.env});
  assert.equal(reopened.planCustomProperties(west).before.finish.value,'copper');
  assert.equal(reopened.planCustomProperties(west).before.label.value,'');
  assert.deepEqual(read('scene.json'),spec);
  write('bad.json',{...west,values:{finish:'invalid'}});
  const bad = spawnSync(process.execPath,[cli,'mesh-topology','custom-properties','scene.json','bad.json','--out','blocked.json'],
    {cwd:dir,encoding:'utf8'});
  assert.equal(bad.status,1);
  assert(!fs.existsSync(file('blocked.json')));
});
