'use strict';

const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {test} = require('node:test');
const ink = require('..');
const {fixture} = require('../examples/tileset-pick/geometric-selection-fixture.cjs');

const {KIT} = ink.load(), api = KIT.meshTopology;
const scene = fixture(), document = api.create(scene.topologyMeshes.canopy.document);
const select = query=>api.select(document,query);

test('open-edge traversal reaches branches and stays on authored one-face edges',()=>{
  const connected = {domain:'edges',ids:['lead'],traverse:'open-edges'};
  const open = select(connected), edges = new Map(api.inspect(document).edges.map(edge=>[edge.id,edge]));
  assert.equal(open.ids.length,15);
  assert(open.ids.every(id=>edges.get(id).uses.length===1));
  assert.equal(open.ids.filter(id=>edges.get(id).uses[0].face==='tab').length,3);
  assert(open.ids.every(id=>edges.get(id).uses[0].face!=='spare'));
  assert.equal(select({...connected,traverse:'boundary'}).ids.length,12);
  assert.deepEqual(select({...connected,ids:['fold-start']}).ids,[]);
  assert.equal(select({domain:'edges',traverse:'open-edges'}).ids.length,19);
  assert.throws(()=>select({domain:'faces',traverse:'open-edges'}),/need the edge domain/);
});

test('cardinal facing uses signed geometric winding and inclusive angular tolerance',()=>{
  const facing = (direction,tolerance)=>({facing:{direction,...(tolerance!==undefined && {tolerance})}});
  assert.deepEqual(select({domain:'faces',filter:facing('+z')}).ids,['flat','spare','tab']);
  const front = select({domain:'faces',filter:facing('+z',15)});
  assert.deepEqual(front.ids,['flat','rise-15','spare','tab']);
  assert.deepEqual(select({domain:'faces',filter:facing('-x')}).ids,['return-90']);
  assert.deepEqual(select({domain:'faces',filter:facing('+x',20)}).ids,[]);
  assert.deepEqual(select({domain:'faces',filter:facing('+z',15),convert:'edges'}),select({from:front,convert:'edges'}));
  const original = document.faces.find(face=>face.id==='spare');
  const reversed = api.edit(document,{faces:[{...original,corners:[...original.corners].reverse()}]});
  assert.deepEqual(api.select(reversed,{domain:'faces',filter:facing('-z')}).ids,['spare']);
  assert.throws(()=>select({domain:'edges',filter:facing('+z')}),/needs faces/);
  for (const [axis,tolerance] of [['north',5],['+z',null],['+z',181],['+z',-1]])
    assert.throws(()=>select({domain:'faces',filter:facing(axis,tolerance)}),/signed axis/);
});

test('normal patches follow shared edges and are anchored to each seed direction',()=>{
  const query = {domain:'faces',traverse:'normal-patch',normalAngle:20};
  const flat = select({...query,ids:['flat']});
  assert.deepEqual(flat.ids,['flat','rise-15']);
  assert.deepEqual(select({...query,normalAngle:15,ids:['flat']}).ids,flat.ids);
  assert.deepEqual(select({...query,ids:['rise-15']}).ids,['flat','rise-15','rise-30']);
  assert.deepEqual(select({...query,ids:['flat','fold-55']}).ids,['flat','fold-55','rise-15']);
  assert.deepEqual(select({...query,ids:['flat'],normalAngle:180}).ids,['flat','fold-55','return-90','rise-15','rise-30']);
  assert.deepEqual(select({...query,ids:[]}).ids,[]);
  assert.throws(()=>select(query),/needs face seeds/);
  assert.throws(()=>select({...query,ids:['flat'],normalAngle:NaN}),/normalAngle from 0 to 180/);
  assert.throws(()=>select({domain:'faces',normalAngle:0}),/needs normal-patch/);
  const editor = ink.createSceneEditor(scene);
  const tiles = {object:'canopy',domain:'tiles',query:{traverse:'normal-patch',normalAngle:20}};
  assert.throws(()=>editor.selectTilesetComponents(tiles),/needs face seeds/);
  const seed = editor.selectMeshTopology('canopy',{domain:'faces',ids:['flat']});
  assert.deepEqual(editor.selectTilesetComponents({...tiles,query:{...tiles.query,from:seed}}).ids,flat.ids);
  editor.transformMeshTopology('canopy',{selection:seed,operation:{kind:'move',offset:[0,0,.01]}});
  assert.throws(()=>editor.selectTilesetComponents({...tiles,query:{...tiles.query,from:seed}}),/same topology revision/);
});

test('headless atlas seeds and geometric selections remain portable across CLI commands',t=>{
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(),'ink-geometric-selection-'));
  t.after(()=>fs.rmSync(cwd,{force:true,recursive:true}));
  const cli = path.resolve(__dirname,'../cli/ink-studio.js');
  const write = (name,value)=>fs.writeFileSync(path.join(cwd,name+'.json'),JSON.stringify(value));
  const run = (...args)=>execFileSync(process.execPath,[cli,...args],{cwd,encoding:'utf8'});
  write('canopy',scene);
  write('pick',scene.topologyMeshes.canopy.bindings[0].data.selection);
  const seeded = JSON.parse(run('tileset','select-atlas','pick.json','--scene','canopy.json','--object','canopy','--out','seed.json'));
  assert.deepEqual(seeded.ids,['flat']);
  const patch = {traverse:'normal-patch',normalAngle:20};
  write('patch',patch);
  write('tiles',{object:'canopy',domain:'tiles',query:patch});
  write('open',{domain:'edges',ids:['lead'],traverse:'open-edges'});
  const tileResult = JSON.parse(run('tileset','select','tiles.json','--scene','canopy.json','--from','seed.json','--topology-out','patch-pick.json'));
  const meshResult = JSON.parse(run('mesh-topology','select','canopy.json','patch.json','--object','canopy','--from','seed.json'));
  assert.deepEqual(tileResult.selection,meshResult);
  assert.deepEqual(meshResult.ids,['flat','rise-15']);
  const open = JSON.parse(run('mesh-topology','select','canopy.json','open.json','--object','canopy'));
  assert.equal(open.ids.length,15);
});
