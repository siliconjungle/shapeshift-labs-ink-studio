'use strict';

const assert = require('node:assert/strict');
const {execFileSync,spawnSync} = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {test} = require('node:test');
const ink = require('..');

const scene = {id:'tileset-blocks',style:'slate',solids:[],tilesetDefaults:{texelsPerUnit:4},tilesets:{
  brick:ink.createBlankTileset({width:8,height:4,background:'#995e43'}),
  trim:ink.createBlankTileset({width:6,height:4,background:'#41808b'})
}};
const crop = (id,width,height)=>ink.pickTilesetRectangle(scene,id,{x:0,y:0,width,height});
const brick = crop('brick',8,4), trim = crop('trim',6,4);
const add = {id:'base',object:'wall',mode:'add',at:[0,0,0],size:[3,2,1],selection:brick};
const opening = {id:'opening',object:'wall',mode:'subtract',at:[1,.5,-.1],size:[1,1,1.2],selection:trim};
const kit = ink.load().KIT;

function closed(row) {
  const inspected=kit.meshTopology.inspect(row.document);
  assert(inspected.edges.every(edge=>edge.uses.length===2));
  const health=kit.meshTopology.health(row.document);
  assert.equal(health.counts.nonManifold,0);
  assert.equal(health.counts.winding,0);
}

test('adds an editable six-face block in a snapped fixed grid frame',()=>{
  const tilted = {...scene,constructionPlane:{origin:[1,2,3],right:[0,0,-1],up:[0,1,0],grid:[.5,2],rounding:'floor'}};
  const editor = ink.createSceneEditor(tilted);
  const request = {...add,at:[1.8,1.2,.25],snapGrid:true,part:'panel',paint:{rotation:90}};
  const preview = editor.planTilesetBlock(request);
  assert.equal(preview.solver,'placement');
  assert.deepEqual(preview.at,[1,1,.25]);
  assert.deepEqual(preview.frame.origin,[1.25,4,2.5]);
  assert.deepEqual(preview.frame.right,[0,0,-1]);
  assert.deepEqual(preview.frame.normal,[1,0,0]);
  assert.deepEqual(preview.source.paint,{rotation:90,flipX:false,flipY:false});
  assert.deepEqual(editor.snapshot(),tilted);
  assert.deepEqual(editor.applyTilesetBlock(request),preview);
  const row = editor.meshTopology('wall','panel');
  assert.equal(row.document.faces.length,6);
  assert.equal(row.document.vertices.length,8);
  assert.deepEqual(row.bindings.map(binding=>binding.data.selection),Array(6).fill(brick));
  closed(row);
  const inserted = editor.snapshot();
  assert.deepEqual(editor.history().undo,['Add base']);
  editor.undo();
  assert.deepEqual(editor.snapshot(),tilted);
  editor.redo();
  assert.deepEqual(editor.snapshot(),inserted);
});

test('builds outward from the selected edge and closes a standalone tiled quad',()=>{
  const editor = ink.createSceneEditor(scene);
  editor.placeTilesetFace({object:'wall',face:'panel',selection:brick,origin:[2,0,0],right:[0,1,0],up:[-1,0,0]});
  const before = editor.snapshot(), doc = before.topologyMeshes.wall.document;
  const edge = doc.edges.find(row=>row.vertices.includes('panel/v0') && row.vertices.includes('panel/v1'));
  const request = {id:'stock',mode:'add',object:'wall',fromFace:'panel',selection:trim,depth:.75};
  const fixed = editor.planTilesetBlock(request);
  const relative = editor.planTilesetBlock({...request,orientation:'edge-relative',edge:edge.id});
  assert.equal(fixed.canCommit,true);
  assert.deepEqual(fixed.frame.right,[1,0,0]);
  assert.deepEqual(fixed.size,[1,2,.75]);
  assert.equal(relative.edge,edge.id);
  assert.deepEqual(relative.frame.right,[0,1,0]);
  assert.deepEqual(relative.size,[2,1,.75]);
  assert.equal(relative.solver,'face-region');
  editor.applyTilesetBlock({...request,orientation:'edge-relative',edge:edge.id});
  const row = editor.meshTopology('wall');
  assert.equal(row.document.faces.length,6);
  assert.equal(row.document.vertices.length,8);
  assert.deepEqual(row.document.vertices.slice(0,4),doc.vertices);
  assert.deepEqual(row.document.faces[0].corners.map(corner=>corner.id),doc.faces[0].corners.map(corner=>corner.id).reverse());
  assert.equal(row.bindings.filter(binding=>binding.data.selection.tileset === 'trim').length,5);
  closed(row);
  editor.undo();
  assert.deepEqual(editor.snapshot(),before);
});

test('an anchored exact extension welds to a closed solid and preserves the other faces and cap ID',()=>{
  const editor = ink.createSceneEditor(scene);
  editor.applyTilesetBlock(add);
  const before = editor.snapshot(), original = editor.meshTopology('wall').document;
  const request = {id:'raise',mode:'add',object:'wall',fromFace:'block/base/cap',depth:.5,selection:trim,orientation:'edge-relative'};
  const report = editor.applyTilesetBlock(request);
  assert.equal(report.solver,'face-region');
  assert.equal(report.painted.find(row=>row.side === 'cap').face,'block/base/cap');
  const row = editor.meshTopology('wall');
  assert.equal(row.document.faces.length,10);
  const previousCap = original.faces.find(face=>face.id === 'block/base/cap');
  const cap = row.document.faces.find(face=>face.id === 'block/base/cap');
  assert.deepEqual(new Set(cap.corners.map(c=>c.id)),new Set(previousCap.corners.map(c=>c.id)));
  assert.equal(row.bindings.find(binding=>binding.element === cap.id).data.selection.tileset,'trim');
  assert.deepEqual(row.document.faces.find(face=>face.id === 'block/base/seat'),original.faces[0]);
  closed(row);
  editor.undo();
  assert.deepEqual(editor.snapshot(),before);
});

test('subtracts a through opening and an inward face pocket with tiled cut walls',()=>{
  const editor = ink.createSceneEditor(scene);
  editor.applyTilesetBlock(add);
  const before = editor.snapshot(), ray = {origin:[1.5,1,3],direction:[0,0,-1],maxDistance:5};
  const trace = ()=>kit.sceneMeshes.rayQuery(editor.build().topologyMeshes.wall.mesh,kit)(ray);
  assert(trace());
  const anchored = editor.planTilesetBlock({id:'pocket',mode:'subtract',object:'wall',fromFace:'block/base/cap',
    orientation:'edge-relative',size:[.5,.5,.3],selection:trim});
  assert.equal(anchored.canCommit,true);
  assert.equal(anchored.frame.origin[2],.7);
  assert(anchored.painted.length>0);
  const dryRun = editor.planTilesetBlock(opening);
  assert.equal(dryRun.canCommit,true);
  assert.equal(dryRun.boolean.operation,'difference');
  assert.deepEqual(editor.applyTilesetBlock(opening),dryRun);
  const row = editor.meshTopology('wall');
  assert.equal(trace(),null);
  assert(dryRun.painted.length>=4);
  for (const {face} of dryRun.painted)
    assert.deepEqual(row.bindings.find(binding=>binding.element === face).data.selection,trim);
  closed(row);
  editor.undo();
  assert.deepEqual(editor.snapshot(),before);
});

test('unions overlapping grid blocks and can remove one complete mesh in a single edit',()=>{
  const editor = ink.createSceneEditor(scene);
  editor.applyTilesetBlock(add);
  editor.applyTilesetBlock({...add,id:'annex',object:'other',at:[9,0],size:[1,1,1]});
  const extension = editor.applyTilesetBlock({...add,id:'extension',at:[2,.4,.2],size:[2,1,.9],selection:trim});
  assert.equal(extension.boolean.operation,'union');
  closed(editor.meshTopology('wall'));
  const before = editor.snapshot();
  const removed = editor.applyTilesetBlock({...opening,id:'remove',at:[-1,-1,-1],size:[8,8,8]});
  assert.equal(removed.removedMesh,true);
  assert.deepEqual(Object.keys(editor.snapshot().topologyMeshes),['other']);
  assert.deepEqual(editor.snapshot().topologyMeshes.other,before.topologyMeshes.other);
  editor.undo();
  assert.deepEqual(editor.snapshot(),before);
});

test('CLI publishes a planned block and reports an open subtraction target without writing it',t=>{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'ink-tileset-block-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file = name=>path.join(dir,name);
  const {selection,...request} = add;
  const write = (name,value)=>fs.writeFileSync(file(name),JSON.stringify(value));
  write('draft.json',scene);
  write('request.json',request);
  write('pick.json',selection);
  const cli = path.resolve(__dirname,'../cli/ink-studio.js');
  const args = ['tileset','block','request.json','--scene','draft.json','--selection','pick.json'];
  const run = (...rest)=>JSON.parse(execFileSync(process.execPath,[cli,...args,...rest],{cwd:dir,encoding:'utf8'}));
  const preview = run();
  assert.equal(preview.canCommit,true);
  assert(!fs.existsSync(file('placed.json')));
  assert.deepEqual(run('--out','placed.json'),preview);
  const editor = ink.createSceneEditor(scene);
  editor.placeTilesetFace({object:'wall',face:'sheet',selection:brick});
  write('sheet.json',editor.snapshot());
  write('cut.json',opening);
  const blocked = spawnSync(process.execPath,[cli,'tileset','block','cut.json','--scene','sheet.json','--out','blocked.json'],
    {cwd:dir,encoding:'utf8'});
  assert.equal(blocked.status,1,blocked.stderr);
  assert.equal(JSON.parse(blocked.stdout).issues[0].code,'operand-open-or-winding');
  assert(!fs.existsSync(file('blocked.json')));
});
