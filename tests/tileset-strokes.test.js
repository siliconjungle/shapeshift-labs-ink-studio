'use strict';

const assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {test} = require('node:test');
const ink = require('..');

const scene = {id:'tile-strokes',style:'slate',solids:[],tilesetDefaults:{texelsPerUnit:4},
  tilesets:{paint:ink.createBlankTileset({width:4,height:4,background:'#00845c'})}};
const selection = ink.pickTilesetRectangle(scene,'paint',{x:0,y:0,width:4,height:4});
const run = {mode:'draw',id:'row',object:'wall',interval:1,path:[[0,0],[3,0]],selection};
const erase = (points, extra) =>
  ({mode:'erase',id:'open-gap',object:'wall',interval:1,path:points,...extra});

test('carries stroke spacing across bends on a rotated rectangular grid and journals the draw once',()=>{
  const draft = {...scene,constructionPlane:{origin:[2,3,5],right:[0,0,-1],up:[0,1,0],grid:[2,.5]}};
  const editor = ink.createSceneEditor(draft);
  const request = {...run,path:[[0,0],[.75,0],[.75,0],[.75,5.5]]};
  const preview = editor.planTilesetStroke(request);
  assert.equal(preview.length,4.25);
  assert.deepEqual(preview.samples.map(s=>s.distance),[0,1,2,3,4]);
  assert.deepEqual(preview.samples.map(s=>s.point),[[2,3,5],[2,3,4],[2,3.5,3.5],[2,4.5,3.5],[2,5.5,3.5]]);
  assert.deepEqual(preview.samples.map(s=>s.face),['row/0','row/1','row/2','row/3','row/4']);
  assert.deepEqual(editor.snapshot(),draft);
  assert.deepEqual(editor.applyTilesetStroke(request),preview);
  const drawn = editor.snapshot(), mesh = drawn.topologyMeshes.wall;
  assert.deepEqual(mesh.bindings.map(binding=>binding.data.selection),Array(5).fill(selection));
  assert.equal(mesh.materials.length,1);
  assert.equal(editor.build().topologyMeshes.wall.mesh.triangles,10);
  assert.deepEqual(editor.history().undo,['Draw row']);
  editor.undo();
  assert.deepEqual(editor.snapshot(),draft);
  editor.redo();
  assert.deepEqual(editor.snapshot(),drawn);
});

test('erases only hits on coplanar tile faces, removes orphan vertices, and restores the whole stroke in one undo',()=>{
  const editor = ink.createSceneEditor(scene);
  editor.applyTilesetStroke(run);
  editor.placeTilesetFace({object:'wall',face:'upper',selection,origin:[1,0,1]});
  editor.placeTilesetFace({object:'accent',face:'other',selection,origin:[1,0,0]});
  const drawn = editor.snapshot(), wall = drawn.topologyMeshes.wall;
  const request = erase([[1,0],[2.5,0]],{interval:.5});
  const preview = editor.planTilesetStroke(request);
  assert.deepEqual(preview.samples.map(s=>[s.status,s.face]),
    [['erase','row/1'],['repeated-face','row/1'],['erase','row/2'],['repeated-face','row/2']]);
  assert.deepEqual(preview.changes.faces.map(row=>[row.id,row.after]),[['row/1',null],['row/2',null]]);
  assert.equal(preview.changes.vertices.length,8);
  assert.deepEqual(editor.snapshot(),drawn);
  assert.deepEqual(editor.applyTilesetStroke(request),preview);
  const erased = editor.snapshot();
  assert.deepEqual(erased.topologyMeshes.wall.document.faces,wall.document.faces.filter(face=>['row/0','row/3','upper'].includes(face.id)));
  assert.deepEqual(erased.topologyMeshes.wall.bindings,wall.bindings.filter(row=>['row/0','row/3','upper'].includes(row.element)));
  assert.deepEqual(erased.topologyMeshes.accent,drawn.topologyMeshes.accent);
  assert.deepEqual(erased.tilesets,drawn.tilesets);
  editor.undo();
  assert.deepEqual(editor.snapshot(),drawn);
  editor.redo();
  assert.deepEqual(editor.snapshot(),erased);

  const empty = editor.applyTilesetStroke({...erase([[1,0]]),object:'accent'});
  assert.equal(empty.removedMesh,true);
  assert.equal(empty.afterRevision,null);
  const remaining = editor.snapshot();
  assert.deepEqual(Object.keys(remaining.topologyMeshes),['wall']);
  assert.deepEqual(remaining.topologyMeshes.wall,erased.topologyMeshes.wall);
  const miss = editor.applyTilesetStroke(erase([[100,0]]));
  assert.equal(miss.samples[0].status,'miss');
  assert.equal(miss.afterRevision,miss.beforeRevision);
  editor.undo();
  assert.deepEqual(editor.snapshot(),erased);
});

test('snaps placements using the saved rounding, skips repeated cells, and blocks conflicting IDs atomically',()=>{
  const editor = ink.createSceneEditor({...scene,constructionPlane:{grid:[1,.5],rounding:'floor'}});
  const snapped = {...run,path:[[-.25,.1],[1,.1]],interval:.25,snapGrid:true};
  const report = editor.applyTilesetStroke(snapped);
  assert.deepEqual(report.samples.map(row=>row.gridAt),[[-1,0],[0,0],[0,0],[0,0],[0,0],[1,0]]);
  assert.deepEqual(report.samples.filter(row=>row.face).map(row=>row.face),['row/0','row/1','row/5']);
  assert.equal(report.samples[2].status,'repeated-position');
  const drawn = editor.snapshot(), history = editor.history();
  const collision = editor.planTilesetStroke({...snapped,path:[[10.9,1],[13,1]]});
  assert.equal(collision.canCommit,false);
  assert(collision.conflicts.some(row=>row.reason === 'face-id-in-use'));
  assert.throws(()=>editor.applyTilesetStroke(snapped),/needs review/);
  assert.deepEqual(editor.snapshot(),drawn);
  assert.deepEqual(editor.history(),history);
  assert.throws(()=>editor.planTilesetStroke({...run,interval:0}),/positive scene-unit interval/);
  assert.throws(()=>editor.planTilesetStroke({...run,interval:1e-6}),/up to 4096 samples/);
});

test('reports overlaps, and preserves a construction plane hinged on a face that erase would remove',()=>{
  const editor = ink.createSceneEditor(scene);
  editor.placeTilesetFace({object:'wall',face:'primary',selection});
  editor.placeTilesetFace({object:'wall',face:'overlap',selection,origin:[.5,0,0]});
  const overlap = editor.planTilesetStroke(erase([[.75,.5]]));
  assert.deepEqual(overlap.samples.map(s=>[s.status,s.candidates]),[['ambiguous',['primary','overlap']]]);
  assert.equal(overlap.beforeRevision,overlap.afterRevision);
  const edge = editor.meshTopology('wall').document.edges.find(row=>
    row.vertices.includes('primary/v0') && row.vertices.includes('primary/v1'));
  const tilt = ink.load().KIT.authoring.constructionPlane.tilt(editor.snapshot(),
    {object:'wall',edge:edge.id,from:'primary/v0',degrees:0});
  editor.setConstructionPlane(tilt.plane);
  const request = erase([[.25,.5]]);
  const blocked = editor.planTilesetStroke(request);
  assert.deepEqual(blocked.conflicts,[{reason:'construction-plane-edge',edge:edge.id}]);
  assert.throws(()=>editor.applyTilesetStroke(request),/needs review/);
  assert.deepEqual(editor.constructionPlane(),tilt.plane);
});

test('CLI publishes dry-run evidence and an atomic scene revision for each stroke',t=>{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'ink-face-stroke-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file = name=>path.join(dir,name);
  for (const [name,value] of [['draft',scene],['draw',run],['erase',erase([[1,0],[2,0]])]])
    fs.writeFileSync(file(name+'.json'),JSON.stringify(value));
  const cli = path.resolve(__dirname,'../cli/ink-studio.js');
  const stroke = (input, source, ...flags)=>spawnSync(process.execPath,
    [cli,'tileset','stroke',input+'.json','--scene',source+'.json',...flags],{cwd:dir,encoding:'utf8'});
  const json = (...args)=>{
    const result = stroke(...args);
    assert.equal(result.status,0,result.stderr);
    return JSON.parse(result.stdout);
  };
  const preview = json('draw','draft');
  assert(!fs.existsSync(file('drawn.json')));
  assert.deepEqual(json('draw','draft','--out','drawn.json'),preview);
  const duplicate = stroke('draw','drawn','--out','blocked.json');
  assert.equal(duplicate.status,1,duplicate.stderr);
  assert.equal(JSON.parse(duplicate.stdout).canCommit,false);
  assert(!fs.existsSync(file('blocked.json')));
  assert.deepEqual(json('erase','drawn','--out','erased.json'),json('erase','drawn'));
  const after = JSON.parse(fs.readFileSync(file('erased.json')));
  assert.deepEqual(after.topologyMeshes.wall.document.faces.map(face=>face.id),['row/0','row/3']);
  assert.deepEqual(JSON.parse(fs.readFileSync(file('draft.json'))),scene);
});
