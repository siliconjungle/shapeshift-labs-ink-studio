'use strict';

const assert = require('node:assert/strict');
const {execFileSync,spawnSync} = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {test} = require('node:test');
const ink = require('..');

const source = {id:'tile-components',style:'slate',solids:[],tilesetDefaults:{texelsPerUnit:8},
  tilesets:{paint:ink.createBlankTileset({width:16,height:8,background:'#24776d'})},
  prefabs:{post:{revision:1,solids:{pole:{kind:'box',at:[0,.25,0],half:[.1,.25,.1],mat:'stone'}}}},
  instances:{fixture:{prefab:'post',transform:{translation:[4,1,0],pivot:[.25,0,0],scale:2}}}};
const api = ink.load().KIT.meshTopology;
const crop = x=>ink.pickTilesetRectangle(source,'paint',{x,y:0,width:8,height:8});

function draft() {
  const editor = ink.createSceneEditor(source);
  editor.placeTilesetFace({object:'wall',face:'left',selection:crop(0)});
  editor.placeTilesetFace({object:'wall',face:'right',selection:crop(8),origin:[1,0,0]});
  editor.editMeshTopology('wall',{
    vertices:[{id:'extension-bottom',position:[3,0,0]},{id:'extension-top',position:[3,1,0]}],
    faces:[{id:'extension',corners:['right/v1','extension-bottom','extension-top','right/v2']
      .map((vertex,index)=>({id:'extension/c'+index,vertex}))}]
  });
  return editor;
}

test('reports enabled domains and keeps the independently selected tile, edge, vertex, and instance IDs distinct',()=>{
  const editor = draft(), before = editor.snapshot();
  assert.deepEqual(editor.selectTilesetComponents().enabledDomains,['tiles','edges','vertices','instances']);
  assert.deepEqual(editor.selectTilesetComponents({edit:'grow'}).enabledDomains,['edges']);
  assert.deepEqual(editor.selectTilesetComponents({edit:'inspect',enabledDomains:['vertices','tiles']}).enabledDomains,['tiles','vertices']);
  assert.throws(()=>editor.selectTilesetComponents({edit:'reskin',domain:'edges',object:'wall'}),/disabled for reskin/);
  assert.throws(()=>editor.selectTilesetComponents({edit:'grow',enabledDomains:['tiles']}),/must come from edges/);
  assert.deepEqual(editor.selectTilesetComponents({edit:'stamp'}).enabledDomains,[]);
  assert.throws(()=>editor.selectTilesetComponents({edit:'unavailable'}),/Unknown tile selection edit/);
  const row = editor.meshTopology('wall');
  const edge = row.document.edges.find(edge=>edge.vertices.includes('left/v0') && edge.vertices.includes('left/v1')).id;
  const selection = (domain,query)=>editor.selectTilesetComponents({domain,object:'wall',query});
  const tiles = selection('tiles');
  assert.deepEqual(tiles.ids,['left','right']);
  assert.deepEqual(tiles.tiles,[{face:'left',binding:'tileset/left',selection:crop(0)},
    {face:'right',binding:'tileset/right',selection:crop(8)}]);
  assert.deepEqual(tiles.selection,api.select(row.document,{domain:'faces',ids:['left','right']}));
  const loop = selection('edges',{ids:[edge],traverse:'boundary'});
  assert.deepEqual(loop.selection,api.select(row.document,{domain:'edges',ids:[edge],traverse:'boundary'}));
  assert.equal(loop.ids.length,4);
  assert.deepEqual(selection('vertices',{ids:['left/v0']}).ids,['left/v0']);
  assert.deepEqual(editor.selectTilesetComponents({domain:'instances'}).ids,['prefab:fixture']);
  assert.deepEqual(editor.snapshot(),before);
  assert.deepEqual(editor.selectTilesetComponents({domain:'tiles',object:'wall'}),tiles);
});

test('keeps tile traversal on retained face bindings and rejects cross-domain and stale selections',()=>{
  const editor = draft();
  const query = {domain:'tiles',object:'wall',query:{ids:['right'],traverse:'island'}};
  const row = editor.meshTopology('wall');
  assert.deepEqual(api.select(row.document,{domain:'faces',...query.query}).ids,['extension','right']);
  const report = editor.selectTilesetComponents(query);
  assert.deepEqual(report.ids,['right']);
  assert.throws(()=>editor.selectTilesetComponents({...query,query:{ids:['extension']}}),/no retained tile source/);
  assert.throws(()=>editor.selectTilesetComponents({...query,query:{traverse:'boundary'}}),/convert selection domains/);
  assert.throws(()=>editor.selectTilesetComponents({...query,part:'wrong'}),/No editable topology/);
  const revised = {...editor.snapshot(),topologyMeshes:{wall:{...row,bindings:row.bindings.map(binding=>
    binding.element==='right' ? {...binding,review:{reason:'ambiguous'}} : binding)}}};
  const refined = ink.selectTilesetComponents(revised,{...query,query:{from:report.selection}});
  assert.deepEqual(refined.ids,[]);
  const vertex = editor.selectTilesetComponents({edit:'move-vertex',domain:'vertices',object:'wall',query:{ids:['left/v0']}});
  const request = {selection:vertex.selection,operation:{kind:'move',offset:[.1,0,0]}};
  editor.transformMeshTopology('wall',request);
  assert.deepEqual(editor.meshTopology('wall').document.vertices.find(v=>v.id==='left/v0').position,[.1,0,0]);
  assert.throws(()=>editor.selectTilesetComponents({...query,query:{from:report.selection}}),/same topology revision and domain/);
});

test('resolves instance kinds independently and shares origin resolution with the construction plane',()=>{
  const editor = draft(), scene = editor.snapshot();
  const shared = {...scene,assetParts:{fixture:{transform:{position:[2,3,4]}}}};
  const query = {edit:'snap-origin',domain:'instances',enabledDomains:['instances']};
  assert.throws(()=>ink.selectTilesetComponents(shared,{...query,query:{ids:['fixture']}}),/ambiguous/);
  const all = ink.selectTilesetComponents(shared,query);
  assert.deepEqual(all.ids,['prefab:fixture','asset-part:fixture']);
  const {instances:[prefab]} = editor.selectTilesetComponents({...query,query:{kind:'prefab',ids:['fixture']}});
  assert.deepEqual(prefab,{instance:'fixture',instanceKind:'prefab',target:[3.75,1,0]});
  const {instances:[part]} = ink.selectTilesetComponents(shared,{...query,query:{kind:'asset-part',ids:['fixture']}});
  assert.deepEqual(part,{instance:'fixture',instanceKind:'asset-part',target:[2,3,4]});
  const snap = editor.planConstructionOrigin({kind:'instance',instance:prefab.instance,instanceKind:prefab.instanceKind});
  assert.deepEqual(snap.plane.origin,prefab.target);
  assert.throws(()=>editor.selectTilesetComponents({...query,object:'wall'}),/without a mesh/);
});

test('CLI captures visible tile faces and passes a saved vertex selection to the normal transform command',t=>{
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(),'ink-tile-domains-'));
  t.after(()=>fs.rmSync(cwd,{force:true,recursive:true}));
  const cli = path.resolve(__dirname,'../cli/ink-studio.js');
  const write = (name,data)=>fs.writeFileSync(path.join(cwd,name),JSON.stringify(data));
  const read = name=>JSON.parse(fs.readFileSync(path.join(cwd,name),'utf8'));
  const run = (...args)=>JSON.parse(execFileSync(process.execPath,[cli,...args],{cwd,encoding:'utf8'}));
  const editor = draft();
  write('scene.json',editor.snapshot());
  write('visible.json',{domain:'tiles',object:'wall',query:{filter:{visibility:'visible'}}});
  write('view.json',{w:120,h:70,ortho:true,yaw:0,pitch:0,target:[1.5,.5,0],zoom:2});
  const tiles = run('tileset','select','visible.json','--scene','scene.json','--view','view.json','--out','tiles.json');
  assert.deepEqual(tiles.ids,['left','right']);
  assert.deepEqual(read('tiles.json'),tiles);
  write('vertex.json',{edit:'move-vertex',domain:'vertices',object:'wall',query:{ids:['left/v0']}});
  const args = ['tileset','select','vertex.json','--scene','scene.json','--topology-out','vertices.json'];
  const vertex = run(...args);
  assert.deepEqual(run(...args),vertex);
  assert.deepEqual(read('vertices.json'),vertex.selection);
  write('move.json',{operation:{kind:'move',offset:[.1,0,0]}});
  execFileSync(process.execPath,[cli,'mesh-topology','transform','scene.json','move.json','--object','wall',
    '--selection','vertices.json','--out','moved.json'],{cwd});
  assert.deepEqual(read('moved.json').topologyMeshes.wall.document.vertices.find(v=>v.id==='left/v0').position,[.1,0,0]);
  const conflict = spawnSync(process.execPath,[cli,'tileset','select','vertex.json','--scene','scene.json','--out','scene.json'],{cwd,encoding:'utf8'});
  assert.notEqual(conflict.status,0);
  assert.match(conflict.stderr,/separately from its inputs/);
  assert.deepEqual(read('scene.json'),editor.snapshot());
});
