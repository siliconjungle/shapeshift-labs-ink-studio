'use strict';

const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {test} = require('node:test');
const ink = require('..');

const scene = {id:'tile-rectangle',style:'slate',solids:[],tilesetDefaults:{texelsPerUnit:4},
  tilesets:{paint:ink.createBlankTileset({width:4,height:4,background:'#0b8169'})}};
const selection = ink.pickTilesetRectangle(scene,'paint',{x:0,y:0,width:4,height:4});
const request = {mode:'fill',id:'panel',object:'wall',from:[0,0],to:[2,1],selection};
const erase = (from,to)=>({mode:'erase',id:'window',object:'wall',from,to});

test('previews a reversed rectangle on a tilted rectangular grid and fills only empty cells in one undo',()=>{
  const draft = {...scene,constructionPlane:{origin:[1,2,3],right:[0,0,-1],up:[0,1,0],grid:[2,.5]}};
  const editor = ink.createSceneEditor(draft);
  editor.placeTilesetFace({object:'wall',face:'prior',planeAt:[0,-1],selection:
    ink.pickTilesetRectangle(scene,'paint',{x:0,y:0,width:4,height:1}),texelsPerUnit:2});
  const before = editor.snapshot();
  const fill = {...request,from:[1,0],to:[-1,-1]};
  const preview = editor.planTilesetRectangle(fill);
  assert.deepEqual(preview.footprint,{min:[-1,-1],max:[2,1],size:[3,2],cellSize:[2,.5],
    outline:[[1,1.5,5],[1,1.5,-1],[1,2.5,-1],[1,2.5,5]]});
  assert.deepEqual(preview.cells.map(cell=>[cell.at,cell.status]),[
    [[-1,-1],'fill'],[[0,-1],'occupied'],[[1,-1],'fill'],[[-1,0],'fill'],[[0,0],'fill'],[[1,0],'fill']]);
  assert.deepEqual(preview.affected,[{face:'prior',tile:true,action:'keep',extendsOutside:false}]);
  assert.deepEqual(preview.cells[1].placements,['prior']);
  assert.deepEqual(editor.snapshot(),before);
  assert.deepEqual(editor.applyTilesetRectangle(fill),preview);
  const filled = editor.snapshot();
  assert.deepEqual(filled.topologyMeshes.wall.document.faces.map(face=>face.id),
    ['prior','panel/0','panel/2','panel/3','panel/4','panel/5']);
  assert.deepEqual(filled.topologyMeshes.wall.document.vertices.find(v=>v.id === 'panel/0/v2').position,[1,2,3]);
  assert.deepEqual(filled.topologyMeshes.wall.bindings[1].data.selection,selection);
  assert.deepEqual(editor.history().undo,['Place tile prior','Fill panel']);
  const repeated = editor.applyTilesetRectangle(fill);
  assert(repeated.cells.every(cell=>cell.status === 'occupied'));
  assert.equal(repeated.beforeRevision,repeated.afterRevision);
  editor.undo();
  assert.deepEqual(editor.snapshot(),before);
  editor.redo();
  assert.deepEqual(editor.snapshot(),filled);
});

test('erase lists area overlaps and straddling tiles, leaving shared edges and other geometry alone',()=>{
  const editor = ink.createSceneEditor(scene);
  for (const [face,u,v,z] of [['edge',-1,0,0],['cross',-.75,.6,0],['raised',0,0,1],['top',0,2,0]])
    editor.placeTilesetFace({object:'wall',face,selection,origin:[u,v,z]});
  editor.placeTilesetFace({object:'other-wall',face:'another',selection});
  const native = [[.35,.1,0],[.4,.1,0],[.4,1.9,0],[.35,1.9,0]];
  editor.editMeshTopology('wall',{
    vertices:native.map((position,i)=>({id:'n/v'+i,position})),
    faces:[{id:'native',corners:native.map((_,i)=>({id:'n/c'+i,vertex:'n/v'+i}))}]
  });
  const before = editor.snapshot(), brush = erase([0,0],[0,1]);
  const preview = editor.planTilesetRectangle(brush);
  assert.deepEqual(preview.cells.map(cell=>[cell.placements,cell.otherFaces,cell.status]),
    [[['cross'],['native'],'erase'],[['cross'],['native'],'erase']]);
  assert.deepEqual(preview.affected,[
    {face:'cross',tile:true,action:'erase',extendsOutside:true},
    {face:'native',tile:false,action:'keep',extendsOutside:false}
  ]);
  assert.deepEqual(preview.changes.faces.map(change=>change.id),['cross']);
  assert.deepEqual(preview.changes.bindings.map(change=>[change.id,change.after]),[['tileset/cross',null]]);
  assert.deepEqual(editor.applyTilesetRectangle(brush),preview);
  const after = editor.snapshot();
  assert.deepEqual(after.topologyMeshes.wall.document.faces.map(face=>face.id),['edge','raised','top','native']);
  assert.deepEqual(after.topologyMeshes['other-wall'],before.topologyMeshes['other-wall']);
  const fill = editor.planTilesetRectangle({...request,from:[0,0],to:[0,1]});
  assert(fill.cells.every(cell=>cell.status === 'occupied' && cell.otherFaces.includes('native')));
  editor.undo();
  assert.deepEqual(editor.snapshot(),before);
});

test('clips a concave placement footprint instead of counting its empty notch as occupied',()=>{
  const editor = ink.createSceneEditor(scene);
  editor.placeTilesetFace({object:'wall',face:'notch',selection});
  const source = JSON.parse(JSON.stringify(editor.snapshot())), document = source.topologyMeshes.wall.document;
  const polygon = [[0,0],[3,0],[3,3],[2,3],[2,1],[1,1],[1,3],[0,3]];
  document.vertices = polygon.map((p,i)=>({id:'v'+i,position:[...p,0]}));
  document.faces[0].corners = polygon.map((p,i)=>({id:'c'+i,vertex:'v'+i,uv:p.map(n=>n/3)}));
  delete document.edges;
  const reopened = ink.createSceneEditor(source);
  const plan = reopened.planTilesetRectangle({...request,from:[0,1],to:[2,2]});
  assert.deepEqual(plan.cells.map(cell=>cell.status),['occupied','fill','occupied','occupied','fill','occupied']);
  assert.deepEqual(plan.affected,[{face:'notch',tile:true,action:'keep',extendsOutside:true}]);
});

test('honors saved rounding, validates cell bounds, and reports an anchored edge before erasing',()=>{
  const editor = ink.createSceneEditor({...scene,constructionPlane:{rounding:'ceiling',grid:[1,.5]}});
  const fractional = {...request,from:[-1.1,-.2],to:[.01,.99]};
  assert.throws(()=>editor.planTilesetRectangle(fractional),/integer cells/);
  const plan = editor.planTilesetRectangle({...fractional,snapGrid:true});
  assert.deepEqual([plan.footprint.min,plan.footprint.max],[[-1,0],[2,2]]);
  assert.throws(()=>editor.planTilesetRectangle({...request,to:[64,64]}),/4096 cells/);
  assert.throws(()=>editor.planTilesetRectangle({...request,to:[Number.MAX_SAFE_INTEGER,1]}),/safe integer bounds/);

  editor.applyTilesetRectangle({...request,to:[0,0]});
  const edge = editor.meshTopology('wall').document.edges[0];
  const {plane} = ink.load().KIT.authoring.constructionPlane.tilt(editor.snapshot(),{object:'wall',edge:edge.id,degrees:0});
  editor.setConstructionPlane(plane);
  const blocked = editor.planTilesetRectangle(erase([0,0],[0,0]));
  assert.equal(blocked.canCommit,false);
  assert.deepEqual(blocked.conflicts,[{reason:'construction-plane-edge',edge:edge.id}]);
  const before = editor.snapshot();
  assert.throws(()=>editor.applyTilesetRectangle(erase([0,0],[0,0])),/rectangle needs review/);
  assert.deepEqual(editor.snapshot(),before);
});

test('CLI keeps dry-run and commit receipts equal and publishes one scene per rectangle',t=>{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'ink-tile-rectangle-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  for (const [name,value] of [['scene',scene],['fill',request],['erase',erase([1,0],[1,1])]])
    fs.writeFileSync(path.join(dir,name+'.json'),JSON.stringify(value));
  const cli = path.resolve(__dirname,'../cli/ink-studio.js');
  const run = (...args)=>JSON.parse(execFileSync(process.execPath,[cli,'tileset','rectangle',...args],{cwd:dir,encoding:'utf8'}));
  const fill = ['fill.json','--scene','scene.json'];
  const preview = run(...fill);
  assert.equal(preview.cells.length,6);
  assert.equal(fs.existsSync(path.join(dir,'filled.json')),false);
  assert.deepEqual(run(...fill,'--out','filled.json'),preview);
  const cut = ['erase.json','--scene','filled.json'];
  assert.deepEqual(run(...cut,'--out','erased.json'),run(...cut));
  const read = name=>JSON.parse(fs.readFileSync(path.join(dir,name+'.json')));
  assert.deepEqual(read('erased').topologyMeshes.wall.document.faces.map(face=>face.id),['panel/0','panel/2','panel/3','panel/5']);
  assert.deepEqual(read('scene'),scene);
});
