'use strict';

const assert = require('node:assert/strict');
const {execFileSync,spawnSync} = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {test} = require('node:test');
const ink = require('..');

const sheet = ink.createBlankTileset({width:21,height:21,background:'#428076'});
const scene = {id:'atlas-query',style:'slate',solids:[],tilesets:{paint:sheet,other:sheet,
  strip:ink.createBlankTileset({width:1,height:4,background:'#d09e65'})}};
const bounds = {x:5,y:6,width:7,height:9};
const selection = ink.pickTilesetRectangle(scene,'paint',bounds);
const expected = {
  match:['exact','rotated','split-boundary'],
  inside:['exact','inset','rotated','split-boundary','triangle'],
  touch:['boundary-contact','crossing','enclosing','exact','inset','rotated','split-boundary','triangle']
};

function authored(editor,id,points,x,material='tileset/paint') {
  const vertices = points.map((_,i)=>{
    const angle = 2*Math.PI*i/points.length;
    return {id:id+'/v'+i,position:[x+.4*Math.cos(angle),.4*Math.sin(angle),0]};
  });
  const corners = vertices.map(({id:vertex},i)=>({id:id+'/c'+i,vertex,uv:points[i]}));
  editor.editMeshTopology('wall',{vertices,faces:[{id,material,corners}]});
}

function fixture() {
  const editor = ink.createSceneEditor(scene);
  const stamp = (face,x,fields={})=>editor.placeTilesetFace({object:'wall',part:'panel',face,selection,origin:[x,1,0],...fields});
  stamp('exact',0);
  stamp('rotated',1,{paint:{rotation:270,flipY:true}});
  stamp('inset',2,{uvInset:{left:.5,top:1}});
  stamp('other-sheet',3,{selection:ink.pickTilesetRectangle(scene,'other',bounds)});
  stamp('strip',4,{selection:ink.pickTilesetRectangle(scene,'strip',{x:0,y:1,width:1,height:2})});
  const shapes = {
    'split-boundary':[[.25,.3],[.4,.3],[.55,.3],[.55,.7],[.25,.7]],
    triangle:[[.25,.3],[.55,.3],[.55,.7]],
    crossing:[[.1,.45],[.8,.45],[.8,.51],[.1,.51]],
    enclosing:[[.1,.1],[.8,.1],[.8,.9],[.1,.9]],
    'boundary-contact':[[.55,.7],[.8,.7],[.8,.8],[.55,.8]],
    'bbox-only':[[.51,.95],[.95,.66],[.95,.95]],
    disjoint:[[.7,.72],[.9,.72],[.9,.9],[.7,.9]]
  };
  Object.entries(shapes).forEach(([id,points],x)=>authored(editor,id,points,x));
  return editor;
}

test('classifies actual UV footprints with inclusive contact and sheet scope',()=>{
  const editor = fixture(), before = editor.snapshot();
  for (const [mode,ids] of Object.entries(expected)) {
    const result = editor.selectTilesetAtlas({object:'wall',part:'panel',selection,mode});
    assert.deepEqual(result.ids,ids);
    assert.deepEqual(result.atlas,selection);
    assert.equal(result.part,'panel');
    assert.equal(result.uvSet,0);
    assert.deepEqual(result.uvBounds,{min:[.25,.3],max:[.55,.7]});
    assert.deepEqual(result.selection,editor.selectMeshTopology('wall',{domain:'faces',ids}));
    assert.deepEqual(ink.selectTilesetAtlas(before,{object:'wall',selection,mode}),result);
  }
  assert.deepEqual(editor.snapshot(),before);
  assert.throws(()=>editor.selectTilesetAtlas({object:'wall',selection,part:'other'}),/No editable topology/);
  assert.throws(()=>editor.selectTilesetAtlas({object:'wall',selection:{...selection,width:50}}),/inside the tileset/);
});

test('reads the active pigment layout and texture while matching collapsed texel axes',()=>{
  const raw = JSON.parse(JSON.stringify(fixture().snapshot())), row = raw.topologyMeshes.wall;
  row.document.uvBindings = {pigment:2};
  for (const face of row.document.faces) for (const corner of face.corners) {
    corner.attributes = {'uv/2':corner.uv};
    corner.uv = [0,0];
  }
  row.materials.push({id:'rebaked',texture:{tileset:'paint'}});
  row.document.faces.find(face=>face.id==='rotated').material='rebaked';
  row.bakes = [{id:'replacement-color',material:'rebaked',maps:{texture:{tileset:'other'}}}];
  const editor = ink.createSceneEditor(raw);
  const match = editor.selectTilesetAtlas({object:'wall',selection});
  assert.equal(match.uvSet,2);
  assert.deepEqual(match.ids,['exact','split-boundary']);
  assert.deepEqual(editor.selectTilesetAtlas({object:'wall',selection:ink.pickTilesetRectangle(scene,'other',bounds)}).ids,
    ['other-sheet','rotated']);
  const column = ink.pickTilesetRectangle(scene,'strip',{x:0,y:1,width:1,height:2});
  const line = editor.selectTilesetAtlas({object:'wall',selection:column});
  assert.deepEqual(line.uvBounds,{min:[0,1/3],max:[0,2/3]});
  assert.deepEqual(line.ids,['strip']);
  const pixel = ink.pickTilesetRectangle(scene,'strip',{x:0,y:2,width:1,height:1});
  assert.deepEqual(editor.selectTilesetAtlas({object:'wall',selection:pixel,mode:'inside'}).ids,[]);
  assert.deepEqual(editor.selectTilesetAtlas({object:'wall',selection:pixel,mode:'touch'}).ids,['strip']);
});

test('CLI selects from an exact pick and exports revision-checked faces usable by mesh topology commands',t=>{
  const editor = fixture(), cwd = fs.mkdtempSync(path.join(os.tmpdir(),'ink-atlas-face-selection-'));
  t.after(()=>fs.rmSync(cwd,{force:true,recursive:true}));
  const cli = path.resolve(__dirname,'../cli/ink-studio.js');
  const file = name=>path.join(cwd,name);
  const run = (...args)=>JSON.parse(execFileSync(process.execPath,[cli,...args],{cwd,encoding:'utf8'}));
  fs.writeFileSync(file('wall.json'),JSON.stringify(editor.snapshot()));
  fs.writeFileSync(file('edges-query.json'),JSON.stringify({convert:'edges'}));
  execFileSync(process.execPath,[cli,'tileset','pick','--scene','wall.json','--id','paint','--x','5','--y','6',
    '--width','7','--height','9','--out','pick.json'],{cwd});
  const args = ['tileset','select-atlas','pick.json','--scene','wall.json','--object','wall','--part','panel','--mode','inside'];
  const report = run(...args,'--out','faces.json');
  assert.deepEqual(report.ids,expected.inside);
  assert.deepEqual(JSON.parse(fs.readFileSync(file('faces.json'),'utf8')),report.selection);
  assert.deepEqual(run(...args,'--out','faces.json'),report);
  const edges = run('mesh-topology','select','wall.json','edges-query.json','--object','wall','--from','faces.json');
  assert.deepEqual(edges,editor.selectMeshTopology('wall',{from:report.selection,convert:'edges'}));
  const collision = spawnSync(process.execPath,[cli,...args,'--out','pick.json'],{cwd,encoding:'utf8'});
  assert.notEqual(collision.status,0);
  assert.match(collision.stderr,/separately from its inputs/);
  assert.deepEqual(JSON.parse(fs.readFileSync(file('pick.json'),'utf8')),selection);
});
