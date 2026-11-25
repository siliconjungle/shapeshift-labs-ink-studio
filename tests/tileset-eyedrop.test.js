'use strict';

const assert = require('node:assert/strict');
const {execFileSync,spawnSync} = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {test} = require('node:test');
const ink = require('..');

const scene = {id:'tile-eyedrop',style:'slate',solids:[],tilesetDefaults:{texelsPerUnit:4},
  tilesets:{atlas:ink.createBlankTileset({width:12,height:8,background:'#168767'})}};
const selection = ink.pickTilesetRectangle(scene,'atlas',{x:1,y:1,width:4,height:3});
const paint = {rotation:90,flipX:true,flipY:false};
const materialDefinition = {id:'enamel',texture:{tileset:'atlas'},roughness:.37,metalness:.2};
const request = {object:'wall',part:'east',face:'sign',selection,paint,material:'enamel',materialDefinition,
  origin:[1,2,3],right:[0,0,-1],up:[0,1,0],worldSize:[2,.5],uvInset:{left:.5,bottom:1}};

const normalized = (values)=>values.map(uv=>uv.map(n=>Math.round(n*1e10)/1e10));

test('eyedrop recovers a live source, material, separate orientations, and the optional exact world size',()=>{
  const editor = ink.createSceneEditor(scene);
  const original = editor.placeTilesetFace(request);
  const placed = editor.snapshot(), history = editor.history();
  const unsized = editor.eyedropTilesetFace({object:'wall',face:'sign'});
  assert.equal(unsized.canStamp,true);
  assert.equal(Object.hasOwn(unsized,'brushSize'),false);
  assert.equal(Object.hasOwn(unsized.stamp,'worldSize'),false);
  const pick = editor.eyedropTilesetFace({object:'wall',part:'east',face:'sign',brushSize:true});
  assert.deepEqual(pick.selection,selection);
  assert.deepEqual(pick.paint,paint);
  assert.equal(pick.sourceStatus,'retained');
  assert.equal(pick.orientationStatus,'retained');
  assert.deepEqual(pick.brushSize,[2,.5]);
  assert.deepEqual(pick.worldFrame,{origin:[1,2,3],right:[0,0,-1],up:[0,1,0],normal:[1,0,0]});
  assert.deepEqual(pick.stamp.materialDefinition,materialDefinition);
  assert.deepEqual(pick.uvInset,{left:.5,top:0,right:0,bottom:1});
  assert.deepEqual(editor.snapshot(),placed);
  assert.deepEqual(editor.history(),history);

  const copy = editor.placeTilesetFace({object:'copy',face:'sign-copy',origin:[3,0,0],...pick.stamp});
  assert.deepEqual(copy.size,[2,.5]);
  assert.deepEqual(normalized(copy.corners.map(c=>c.uv)),normalized(original.corners.map(c=>c.uv)));
  assert.deepEqual(editor.meshTopology('copy').materials,[materialDefinition]);
  editor.undo();
  assert.deepEqual(editor.snapshot(),placed);
  assert.throws(()=>editor.eyedropTilesetFace({object:'wall',part:'north',face:'sign'}),/No editable topology/);
  assert.throws(()=>editor.eyedropTilesetFace({object:'wall',face:'absent'}),/Unknown mesh face/);
});

test('recovers a changed UV orientation from a named pigment layout and preserves the relocated atlas crop',()=>{
  const editor = ink.createSceneEditor(scene);
  editor.placeTilesetFace({...request,uvInset:undefined,materialDefinition:undefined});
  const swapped = editor.transformTilesetCanvas('atlas',{type:'swap',
    a:{x:1,y:1,width:4,height:3},b:{x:7,y:1,width:4,height:3}});
  assert.equal(swapped.canCommit,true);
  const source = JSON.parse(JSON.stringify(editor.snapshot())), document = source.topologyMeshes.wall.document;
  document.uvBindings = {pigment:2};
  const corners = document.faces[0].corners;
  const values = corners.map(corner=>corner.uv);
  for (const [i,corner] of corners.entries()) corner.attributes={'uv/2':values[(i+1)%4]};
  const restored = ink.createSceneEditor(source);
  const pick = restored.eyedropTilesetFace({object:'wall',face:'sign'});
  assert.equal(pick.sourceStatus,'retained');
  assert.equal(pick.orientationStatus,'uv-inferred');
  assert.equal(pick.selection.x,7);
  assert.equal(pick.uvSet,2);
  const copied = restored.planTilesetFace({object:'copy',face:'copy',...pick.stamp});
  assert.deepEqual(normalized(copied.corners.map(corner=>corner.uv)),normalized(pick.uv.map(corner=>corner.uv)));
});

test('infers a UV-only face and reports nonrectangular geometry or pigment independently',()=>{
  const editor = ink.createSceneEditor(scene);
  editor.placeTilesetFace({...request,uvInset:undefined});
  const raw = JSON.parse(JSON.stringify(editor.snapshot())), row = raw.topologyMeshes.wall;
  delete row.bindings;
  row.document.vertices[2].position[1] += .125;
  const uvOnly = ink.createSceneEditor(raw);
  const pick = uvOnly.eyedropTilesetFace({object:'wall',face:'sign',brushSize:true});
  assert.equal(pick.canStamp,true);
  assert.equal(pick.sourceStatus,'uv-inferred');
  assert.deepEqual(pick.selection,selection);
  assert.equal(pick.brushSize,null);
  assert.equal(pick.sizeNotice,'face-is-not-rectangular');
  assert.equal(Object.hasOwn(pick.stamp,'worldSize'),false);
  row.document.faces[0].corners[2].uv = [.2,.2];
  const invalid = ink.createSceneEditor(raw).eyedropTilesetFace({object:'wall',face:'sign'});
  assert.equal(invalid.canStamp,false);
  assert.equal(invalid.reason,'pigment-uv-is-not-a-rectangular-stamp');
  assert.equal(invalid.material,'enamel');
});

test('reads the source cell, insets, and actual fitted size from a rotated brush-run face',()=>{
  const brush = ink.pickTilesetBlock(scene,'atlas',{x:0,y:0,width:6,height:4},{width:2,height:2});
  const editor = ink.createSceneEditor(scene);
  editor.applyTilesetBrushRun({id:'course',object:'wall',brush:{...brush,uvInset:{right:.5}},
    at:[0,0],paint:{rotation:90}});
  const pick = editor.eyedropTilesetFace({object:'wall',face:'course/0/0/1',brushSize:true});
  assert.equal(pick.canStamp,true);
  assert.deepEqual(pick.selection,ink.pickTilesetRectangle(scene,'atlas',{x:2,y:0,width:2,height:2}));
  assert.deepEqual(pick.brushSize,[.75,1/3]);
  assert.equal(pick.paint.rotation,90);
  assert.equal(pick.uvInset.right,.5);
  const copy = editor.planTilesetFace({object:'copy',face:'copy',...pick.stamp});
  assert.deepEqual(normalized(copy.corners.map(c=>c.uv)),normalized(pick.uv.map(row=>row.uv)));
});

test('CLI saves a reusable face pick and restamps it using the target plane and optional size overrides',t=>{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'ink-tile-eyedrop-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file = name=>path.join(dir,name);
  const editor = ink.createSceneEditor(scene);
  editor.placeTilesetFace(request);
  const source = JSON.stringify(editor.snapshot());
  fs.writeFileSync(file('wall.json'),source);
  const cli = path.resolve(__dirname,'../cli/ink-studio.js');
  const json = (...args)=>JSON.parse(execFileSync(process.execPath,[cli,'tileset',...args],{cwd:dir,encoding:'utf8'}));
  const eyedrop = ['eyedrop','--scene','wall.json','--object','wall','--face','sign','--brush-size'];
  const pick = json(...eyedrop);
  assert.equal(fs.existsSync(file('pick.json')),false);
  assert.deepEqual(json(...eyedrop,'--out','pick.json'),pick);
  const copy = ['stamp','--scene','wall.json','--selection','pick.json','--object','copy','--face','copy','--plane','3,2'];
  const preview = json(...copy);
  assert.deepEqual(preview.size,[2,.5]);
  assert.deepEqual(preview.vertices[0].position,[3,2,0]);
  assert.deepEqual(preview.materialDefinition,materialDefinition);
  assert.deepEqual(json(...copy,'--out','copied.json'),preview);
  assert.deepEqual(json(...copy,'--brush-scale','2').size,[2,1.5]);
  assert.equal(fs.readFileSync(file('wall.json'),'utf8'),source);
  const invalid = spawnSync(process.execPath,[cli,'tileset',...eyedrop,'--out','wall.json'],{cwd:dir,encoding:'utf8'});
  assert.equal(invalid.status,1);
  assert.match(invalid.stderr,/separate JSON file/);
});
