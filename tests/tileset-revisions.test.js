'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {test} = require('node:test');
const ink = require('..');
const PNG = require('../cli/png.js');

const brick = ink.createBlankTileset({width:2,height:2,background:'#8e6152'});
const pale = ink.createBlankTileset({width:2,height:2,background:'#c48b65'});
const trim = ink.createBlankTileset({width:1,height:2,background:'#22557780'});
const vertices = [[0,0,0],[1,0,0],[1,1,0],[0,1,0]].map((position,i)=>({id:'v'+i,position}));
const corners = [[0,1],[1,1],[1,0],[0,0]].map((uv,i)=>({id:'c'+i,vertex:'v'+i,uv}));
const scene = {id:'wall',style:'slate',solids:[],tilesets:{brick,copy:brick,trim},
  topologyMeshes:{wall:{document:{id:'wall',vertices,faces:[{id:'plate',material:'paint',corners}]},
    materials:[{id:'paint',texture:{tileset:'copy'}},{id:'spare',texture:{tileset:'brick'}}],
    bakes:[{id:'color-bake',material:'paint',maps:{roughness:.30}}]}},
  timeline:{clips:[{id:'arrival',time:0,sequence:'move'}],sequences:{move:{duration:1},
    unused:{clips:[{id:'reserve',time:0,sequence:'move'}]}}},
  prefabs:{shelf:{revision:1,solids:{},usesTilesets:['copy','brick']}}};

test('inventory includes authored faces, clips and unused prefab definitions',()=>{
  const editor = ink.createSceneEditor(scene);
  const [sheet] = editor.tilesetDependencies('copy').sheets;
  assert.deepEqual(sheet.faces,[{object:'wall',face:'plate',material:'paint',active:true}]);
  assert.deepEqual(sheet.clips,[
    {id:'arrival',sequence:'move',owner:null,reachable:true},{id:'reserve',sequence:'move',owner:'unused',reachable:false}]);
  assert.deepEqual(sheet.prefabs,[{id:'shelf',revision:1,scope:'scene',instances:[],used:false}]);
  const [unmounted] = editor.tilesetDependencies('brick').sheets;
  assert.equal(unmounted.faces.length,0);
  assert.equal(unmounted.materials[0].material,'spare');
  assert.equal(unmounted.prefabs[0].used,false);
  const blocked = editor.planTilesetRevision({type:'remove',id:'copy'});
  assert.equal(blocked.canCommit,false);
  assert.deepEqual(blocked.blockers,[{reason:'tileset-in-use',id:'copy'}]);
  assert.throws(()=>editor.editTilesetRevision({type:'remove',id:'copy'}),/needs review/);
  assert.deepEqual(editor.snapshot(),scene);
});

test('clone and exact deduplication preserve source pixels and redirect mesh and inline prefab bindings',()=>{
  const editor = ink.createSceneEditor(scene);
  const cloned = editor.editTilesetRevision({type:'clone',id:'trim',newId:'spare-trim'});
  assert.equal(cloned.before[0].revision,cloned.after.find(row=>row.id==='spare-trim').revision);
  assert.deepEqual(editor.snapshot().tilesets['spare-trim'],trim);
  const before = editor.snapshot();
  const request = {type:'deduplicate',id:'copy',keepId:'brick'};
  assert.deepEqual(editor.planTilesetRevision(request),editor.editTilesetRevision(request));
  const after = editor.snapshot();
  assert.deepEqual(after.topologyMeshes.wall.document,before.topologyMeshes.wall.document);
  assert.equal(after.topologyMeshes.wall.materials[0].texture.tileset,'brick');
  assert.deepEqual(after.prefabs.shelf.usesTilesets,['brick']);
  assert.equal(after.tilesets.copy,undefined);
  assert.equal(editor.tilesetDependencies('brick').sheets[0].clips[0].id,'arrival');
  editor.undo();
  assert.deepEqual(editor.snapshot(),before);
  editor.redo();
  assert.deepEqual(editor.snapshot(),after);
  assert.equal(editor.planTilesetRevision({type:'deduplicate',id:'trim',keepId:'brick'}).blockers[0].reason,'different-tilesets');
  editor.setTilesetGrid('spare-trim',{width:1,height:1});
  assert.equal(editor.planTilesetRevision({type:'deduplicate',id:'trim',keepId:'spare-trim'}).canCommit,false);
});

test('replace previews rebakes and combination packs sources with exact transparent padding',()=>{
  const editor = ink.createSceneEditor(scene);
  const edit = editor.editTilesetRevision({type:'replace',id:'copy',asset:pale});
  assert.notEqual(edit.before[0].revision,edit.after[0].revision);
  assert.deepEqual(edit.invalidatedBakes,[{object:'wall',bake:'color-bake',faces:['plate']}]);
  assert.equal(editor.snapshot().topologyMeshes.wall.materials[0].texture.tileset,'copy');
  assert.deepEqual(editor.snapshot().tilesets.copy,pale);
  editor.setTilesetGrid('copy',{width:2,height:2});
  const invalid = editor.planTilesetRevision({type:'replace',id:'copy',asset:trim});
  assert.equal(invalid.canCommit,false);
  assert.equal(invalid.blockers[0].reason,'grid-does-not-fit');

  const report = editor.editTilesetRevision({type:'combine',ids:['trim','copy'],newId:'paired',axis:'y'});
  assert.deepEqual(report.placements,[{id:'trim',x:0,y:0,width:1,height:2},{id:'copy',x:0,y:2,width:2,height:2}]);
  const paired = editor.snapshot().tilesets.paired;
  assert.deepEqual([paired.width,paired.height],[2,4]);
  const firstRow = Buffer.from(paired.data,'base64').subarray(0,8);
  assert.deepEqual([...firstRow],[0x22,0x55,0x77,128,0,0,0,0]);
  assert.deepEqual(editor.snapshot().tilesets.trim,trim);
  editor.editTilesetRevision({type:'remove',id:'paired'});
  assert.equal(editor.snapshot().tilesets.paired,undefined);
});

test('external unused prefab requirements protect sheets and active instances check their requirements',()=>{
  const env = {prefabs:{crate:{revision:2,solids:{},usesTilesets:['copy']}}};
  const editor = ink.createSceneEditor({...scene,prefabLibrary:'library.json'},{env});
  const [sheet] = editor.tilesetDependencies('copy').sheets;
  assert.deepEqual(sheet.prefabs.find(row=>row.scope==='library'),
    {id:'crate',revision:2,scope:'library',library:'library.json',instances:[],used:false});
  assert.equal(editor.planTilesetRevision({type:'deduplicate',id:'copy',keepId:'brick'}).blockers[0].reason,'shared-prefab-library');
  assert.throws(()=>ink.createSceneEditor({...scene,prefabLibrary:'library.json',instances:{supply:{prefab:'crate'}}},
    {env:{prefabs:{crate:{revision:1,solids:{},usesTilesets:['missing']}}}}),/requires tileset missing/);
});

test('CLI revisions preview dependencies and write only a successful separate scene',t=>{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'ink-tileset-revision-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file = name=>path.join(dir,name);
  const input = file('scene.json'), source = {...scene,prefabLibrary:'library.json'};
  fs.writeFileSync(input,JSON.stringify(source));
  fs.writeFileSync(file('library.json'),JSON.stringify({spare:{revision:1,solids:{},usesTilesets:['brick']}}));
  fs.writeFileSync(file('replacement.png'),PNG.encode(2,2,Buffer.from(pale.data,'base64'),4));
  const cli = path.resolve(__dirname,'../cli/ink-studio.js');
  const run = (type,...args)=>spawnSync(process.execPath,[cli,'tileset',type,'--scene',input,...args],{cwd:dir,encoding:'utf8'});
  const dependencies = run('dependencies','--id','brick');
  assert.equal(dependencies.status,0,dependencies.stderr);
  assert.equal(JSON.parse(dependencies.stdout).sheets[0].prefabs.find(row=>row.id==='spare').used,false);
  const blocked = run('remove','--id','copy','--out',file('blocked.json'));
  assert.equal(blocked.status,1,blocked.stderr);
  assert.equal(JSON.parse(blocked.stdout).canCommit,false);
  assert.equal(fs.existsSync(file('blocked.json')),false);
  const options = ['replacement.png','--id','copy'];
  const preview = run('replace',...options);
  const committed = run('replace',...options,'--out',file('revised.json'));
  assert.equal(committed.status,0,committed.stderr);
  assert.deepEqual(JSON.parse(committed.stdout),JSON.parse(preview.stdout));
  assert.deepEqual(JSON.parse(fs.readFileSync(file('revised.json'),'utf8')).tilesets.copy,pale);
  assert.deepEqual(JSON.parse(fs.readFileSync(input,'utf8')),source);
});

test('joining compatible indexed sheets keeps duplicate swatches and exact palette slots',()=>{
  const indexed = data=>({version:1,width:2,height:1,encoding:'indexed8',data,
    palette:[0x442b25,0x442b25,0x984833],alpha:[255,160,0]});
  const editor = ink.createSceneEditor({id:'indexed',style:'slate',solids:[],
    tilesets:{left:indexed('AAE='),right:indexed('AgA=')}});
  editor.editTilesetRevision({type:'combine',ids:['left','right'],newId:'pair'});
  const pair = editor.snapshot().tilesets.pair;
  assert.equal(pair.encoding,'indexed8');
  assert.deepEqual(pair.palette,[0x442b25,0x442b25,0x984833]);
  assert.deepEqual(pair.alpha,[255,160,0]);
  assert.deepEqual([...Buffer.from(pair.data,'base64')],[0,1,2,0]);
});
