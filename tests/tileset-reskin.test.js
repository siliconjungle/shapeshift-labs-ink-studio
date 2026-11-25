'use strict';

const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {test} = require('node:test');
const ink = require('..');

const scene = {id:'face-reskin',style:'slate',solids:[],tilesetDefaults:{texelsPerUnit:4},tilesets:{
  warm:ink.createBlankTileset({width:12,height:8,background:'#ad6041'}),
  cool:ink.createBlankTileset({width:17,height:11,background:'#49659c'})
}};
const source = ink.pickTilesetRectangle(scene,'warm',{x:1,y:1,width:4,height:3});
const destination = ink.pickTilesetRectangle(scene,'cool',{x:8,y:4,width:6,height:4});
const paint = {rotation:90,flipX:true,flipY:false};
const definition = {id:'enamel',texture:{tileset:'warm'},roughness:.42,metalness:.17};
const request = {object:'wall',face:'sign'};
function starter() {
  const editor = ink.createSceneEditor(scene);
  const stamp = {selection:source,paint,material:'enamel',materialDefinition:definition};
  editor.placeTilesetFace({...request,...stamp});
  editor.placeTilesetFace({...stamp,object:'wall',face:'neighbor',origin:[1.25,0,0]});
  return editor;
}
const getFace = (row,id='sign')=>row.document.faces.find(face=>face.id === id);
const uv = (row,id)=>getFace(row,id).corners.map(corner=>corner.uv);

test('crop adopts the picked paint and insets on the same polygon and isolates the shared material',()=>{
  const editor = starter();
  editor.placeTilesetFace({object:'donor',face:'paint',selection:destination,paint:{flipY:true},uvInset:{left:1},
    material:'donor-paint',worldSize:[2,2]});
  const pick = editor.eyedropTilesetFace({object:'donor',face:'paint',brushSize:true});
  const before = editor.snapshot(), wall = editor.meshTopology('wall');
  const command = {...request,mode:'crop',selection:pick};
  const preview = editor.planTilesetReskin(command);
  assert.equal(preview.canCommit,true);
  assert.equal(preview.before.material,'enamel');
  assert.equal(preview.after.material,'enamel/tileset/cool');
  assert.deepEqual(preview.after.source.selection,destination);
  assert.deepEqual(editor.snapshot(),before);
  assert.deepEqual(editor.applyTilesetReskin(command),preview);
  const updated = editor.meshTopology('wall');
  assert.deepEqual(updated.document.vertices,wall.document.vertices);
  assert.deepEqual(updated.document.edges,wall.document.edges);
  assert.deepEqual(getFace(updated,'neighbor'),getFace(wall,'neighbor'));
  assert.deepEqual(getFace(updated).corners.map(c=>[c.id,c.vertex]),getFace(wall).corners.map(c=>[c.id,c.vertex]));
  assert.deepEqual(uv(updated),pick.uv.map(c=>c.uv));
  assert.deepEqual(updated.materials,[definition,{...definition,id:'enamel/tileset/cool',texture:{tileset:'cool'}}]);
  assert.equal(editor.eyedropTilesetFace({...request,brushSize:true}).brushSize[0],1);
  assert.equal(editor.history().undo.at(-1),'Reskin sign');
  const changed = editor.snapshot();
  editor.undo();
  assert.deepEqual(editor.snapshot(),before);
  editor.redo();
  assert.deepEqual(editor.snapshot(),changed);
});

test('tileset mode preserves precise UVs across atlas sizes and recovers a matching source rectangle',()=>{
  const editor = starter(), before = editor.meshTopology('wall');
  const report = editor.applyTilesetReskin({...request,mode:'tileset',tileset:'cool'});
  const row = editor.meshTopology('wall');
  assert.deepEqual(uv(row),uv(before));
  assert.equal(report.after.sourceStatus,'uv-inferred');
  assert.equal(report.after.source.selection.tileset,'cool');
  const sampled = editor.eyedropTilesetFace(request);
  const pose = editor.planTilesetFace({object:'copy',face:'copy',...sampled.stamp});
  assert.deepEqual(pose.corners.map(c=>c.uv),uv(before));
  assert.deepEqual(getFace(row,'neighbor'),getFace(before,'neighbor'));
});

test('relative applies the brush turn through the face orientation and preserves separate UV channels',()=>{
  const raw = JSON.parse(JSON.stringify(starter().snapshot()));
  const doc = raw.topologyMeshes.wall.document;
  doc.uvBindings = {pigment:2,normal:3};
  for (const face of doc.faces) for (const corner of face.corners)
    corner.attributes = {'uv/2':corner.uv,'uv/3':[.25,.75]};
  const editor = ink.createSceneEditor(raw), before = editor.meshTopology('wall');
  const selection = {...destination,paint:{rotation:270,flipY:true}};
  const preview = editor.planTilesetReskin({...request,mode:'relative',selection});
  assert.deepEqual(preview.after.source.paint,{rotation:180,flipX:true,flipY:true});
  const expected = editor.planTilesetFace({object:'copy',face:'copy',selection:destination,paint:preview.after.source.paint});
  assert.deepEqual(preview.corners.map(c=>c.after),expected.corners.map(c=>c.uv));
  editor.applyTilesetReskin({...request,mode:'relative',selection});
  const after = editor.meshTopology('wall');
  assert.deepEqual(uv(after),uv(before));
  assert.deepEqual(getFace(after).corners.map(c=>c.attributes['uv/3']),getFace(before).corners.map(c=>c.attributes['uv/3']));
  assert.deepEqual(getFace(after).corners.map(c=>c.attributes['uv/2']),expected.corners.map(c=>c.uv));
});

test('padded picks accept a specific source cell, and pinned pigment coordinates require review',()=>{
  const brush = ink.pickTilesetBlock(scene,'cool',{x:0,y:0,width:5,height:2},{width:2,height:2,paddingX:1});
  const raw = JSON.parse(JSON.stringify(starter().snapshot()));
  raw.topologyMeshes.wall.document.faces[0].corners[0].uvPinned = true;
  const editor = ink.createSceneEditor(raw);
  assert.throws(()=>editor.planTilesetReskin({...request,mode:'crop',selection:brush}),/column and row/);
  const command = {...request,mode:'crop',selection:brush,cell:{column:1,row:0}};
  const planned = editor.planTilesetReskin(command);
  assert.equal(planned.after.source.selection.x,3);
  assert.deepEqual(planned.conflicts,[{reason:'pinned-uv',corner:'sign/c0'}]);
  assert.throws(()=>editor.applyTilesetReskin(command),/needs review/);
  assert.deepEqual(editor.snapshot(),raw);
  assert.equal(editor.planTilesetReskin({...request,mode:'tileset',selection:brush}).canCommit,true);
});

test('a shared bake stays active for the other face when a reskin gives the selected face a new slot',()=>{
  const raw = JSON.parse(JSON.stringify(starter().snapshot()));
  raw.topologyMeshes.wall.bakes = [{id:'enamel-bake',material:'enamel',maps:{roughness:.9}}];
  const editor = ink.createSceneEditor(raw);
  const report = editor.applyTilesetReskin({...request,mode:'tileset',tileset:'cool'});
  assert.equal(report.previousBake,'enamel-bake');
  assert.deepEqual(report.changes.bakes,[]);
  assert.deepEqual(editor.meshTopology('wall').bakes,raw.topologyMeshes.wall.bakes);
  assert.equal(getFace(editor.meshTopology('wall'),'neighbor').material,'enamel');
});

test('tileset mode also keeps custom polygon UVs and retires an unusable rectangular source binding',()=>{
  const raw = JSON.parse(JSON.stringify(starter().snapshot()));
  const original = raw.topologyMeshes.wall.document;
  delete original.edges;
  original.faces[0].corners.pop();
  const editor = ink.createSceneEditor(raw);
  assert.equal(editor.planTilesetReskin({...request,mode:'relative',selection:destination}).canCommit,false);
  const report = editor.applyTilesetReskin({...request,mode:'tileset',tileset:'cool'});
  assert.equal(report.after.sourceStatus,'no-rectangular-source');
  const row = editor.meshTopology('wall');
  assert.deepEqual(getFace(row).corners,original.faces[0].corners);
  assert(!row.bindings.some(binding=>binding.element === 'sign'));
  assert(row.bindings.some(binding=>binding.element === 'neighbor'));
});

test('CLI previews and commits each reskin mode while retaining the original scene file',t=>{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'ink-face-reskin-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file = name=>path.join(dir,name);
  const input = JSON.stringify(starter().snapshot());
  fs.writeFileSync(file('wall.json'),input);
  fs.writeFileSync(file('pick.json'),JSON.stringify(destination));
  const cli = path.resolve(__dirname,'../cli/ink-studio.js');
  const run = (...args)=>JSON.parse(execFileSync(process.execPath,[cli,'tileset','reskin','--scene','wall.json',
    '--object','wall','--face','sign',...args],{cwd:dir,encoding:'utf8'}));
  for (const mode of ['crop','tileset','relative']) {
    const args = ['--mode',mode,...(mode === 'tileset' ? ['--id','cool'] : ['--selection','pick.json'])];
    const preview = run(...args), output = mode+'.json';
    assert.equal(preview.canCommit,true);
    assert.equal(fs.existsSync(file(output)),false);
    assert.deepEqual(run(...args,'--out',output),preview);
    const saved = JSON.parse(fs.readFileSync(file(output)));
    assert.equal(getFace(saved.topologyMeshes.wall).id,'sign');
    assert.equal(getFace(saved.topologyMeshes.wall,'neighbor').material,'enamel');
  }
  assert.equal(fs.readFileSync(file('wall.json'),'utf8'),input);
});
