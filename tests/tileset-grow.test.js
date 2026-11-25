'use strict';

const assert = require('node:assert/strict');
const {execFileSync,spawnSync} = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {test} = require('node:test');
const ink = require('..');

const scene = {id:'grow-tiles',style:'slate',solids:[],tilesetDefaults:{texelsPerUnit:2},tilesets:{
  wall:ink.createBlankTileset({width:4,height:2,background:'#896749'}),
  trim:ink.createBlankTileset({width:4,height:4,background:'#2d7580'})
}};
const pick = (tileset,width,height)=>ink.pickTilesetRectangle(scene,tileset,{x:0,y:0,width,height});
const base = {object:'wall',part:'north',face:'panel',selection:pick('wall',4,2)};
const grow = {object:'wall',face:'roof',edge:'eave',angle:90,selection:pick('trim',3,3)};
const positions = rows=>rows.map(row=>row.position.map(n=>Math.round(n*1e10)/1e10));

function starter() {
  const seed = ink.createSceneEditor(scene);
  seed.placeTilesetFace(base);
  const before = JSON.parse(JSON.stringify(seed.snapshot())), doc = before.topologyMeshes.wall.document;
  const edge = doc.edges.find(row=>row.vertices.includes('panel/v2') && row.vertices.includes('panel/v3'));
  Object.assign(edge,{id:'eave',smooth:false,crease:.75,uvSeam:true});
  return before;
}

test('grows a connected quad in the opposite edge winding and journals the mesh and crop together',()=>{
  const before = starter(), editor = ink.createSceneEditor(before), request = {...grow,paint:{rotation:90}};
  const preview = editor.planTilesetGrow(request);
  assert.equal(preview.canCommit,true);
  assert.deepEqual(preview.incidentFaces,['panel']);
  assert.equal(preview.sizing,'proportional');
  assert.deepEqual(preview.size,[2,2]);
  assert.deepEqual(positions(preview.sharedVertices),[[0,1,0],[2,1,0]]);
  assert.deepEqual(positions(preview.vertices),[[2,1,2],[0,1,2]]);
  assert.deepEqual(preview.corners.map(corner=>corner.vertex),['panel/v3','panel/v2','roof/v2','roof/v3']);
  assert.deepEqual(preview.source.paint,{rotation:90,flipX:false,flipY:false});
  assert.deepEqual(editor.snapshot(),before);

  assert.deepEqual(editor.growTilesetFace(request),preview);
  const after = editor.snapshot(), row = after.topologyMeshes.wall, doc = row.document;
  assert.deepEqual(doc.faces[0],before.topologyMeshes.wall.document.faces[0]);
  assert.deepEqual(doc.vertices.slice(0,4),before.topologyMeshes.wall.document.vertices);
  assert.equal(doc.vertices.length,6);
  assert.deepEqual(doc.edges.find(row=>row.id === 'eave'),before.topologyMeshes.wall.document.edges.find(row=>row.id === 'eave'));
  const edge = ink.load().KIT.meshTopology.inspect(doc).edges.find(row=>row.id === 'eave');
  assert.deepEqual(edge.uses,[{face:'panel',from:'panel/c2',to:'panel/c3'},{face:'roof',from:'roof/c0',to:'roof/c1'}]);
  assert.deepEqual(row.bindings[1].data.selection,grow.selection);
  assert.equal(editor.history().undo.at(-1),'Grow roof');

  const blocked = editor.planTilesetGrow({...grow,face:'third'});
  assert.deepEqual(blocked.conflicts,[{reason:'edge-is-not-a-boundary'}]);
  assert.deepEqual(blocked.incidentFaces,['panel','roof']);
  assert.throws(()=>editor.growTilesetFace({...grow,face:'third'}),/needs review/);
  editor.undo();
  assert.deepEqual(editor.snapshot(),before);
  editor.redo();
  assert.deepEqual(editor.snapshot(),after);
});

test('matches edge width with proportional, brush, eyedropped, and explicit depth options',()=>{
  const editor = ink.createSceneEditor(starter());
  const selection = pick('trim',4,2);
  const request = {...grow,selection,angle:-90};
  const proportional = editor.planTilesetGrow(request);
  assert.deepEqual(proportional.size,[2,1]);
  assert.deepEqual(positions(proportional.vertices),[[2,1,-1],[0,1,-1]]);
  const brush = editor.planTilesetGrow({...request,sizing:'brush',brushScale:3});
  assert.deepEqual(brush.size,[2,3]);
  const explicit = editor.planTilesetGrow({...request,angle:0,depth:.375});
  assert.equal(explicit.sizing,'explicit');
  assert.deepEqual(explicit.size,[2,.375]);
  assert.deepEqual(positions(explicit.vertices),[[2,1.375,0],[0,1.375,0]]);
  editor.placeTilesetFace({object:'donor',face:'sample',selection,worldSize:[2.5,.2]});
  const eye = editor.eyedropTilesetFace({object:'donor',face:'sample',brushSize:true});
  assert.deepEqual(editor.planTilesetGrow({...request,...eye.stamp,sizing:'brush'}).size,[2,.2]);
  assert.throws(()=>editor.planTilesetGrow({...request,sizing:'brush',depth:2}),/sizing mode or positive depth/);
  assert.throws(()=>editor.planTilesetGrow({...request,depth:0}),/sizing mode or positive depth/);
  assert.throws(()=>editor.planTilesetGrow({...request,edge:'absent'}),/Unknown mesh edge/);
});

test('a tilted parent determines outward direction and the outer vertices inherit endpoint weights',()=>{
  const seed = ink.createSceneEditor(scene);
  seed.placeTilesetFace({...base,right:[0,0,-1],up:[0,1,0]});
  const input = JSON.parse(JSON.stringify(seed.snapshot())), doc = input.topologyMeshes.wall.document;
  doc.edges.find(row=>row.vertices.includes('panel/v2') && row.vertices.includes('panel/v3')).id = 'eave';
  doc.vertices[2].weights = {right:1};
  doc.vertices[3].weights = {left:1};
  const editor = ink.createSceneEditor(input);
  const report = editor.growTilesetFace({...grow,angle:90,depth:.5});
  assert.deepEqual(positions(report.sharedVertices),[[0,1,0],[0,1,-2]]);
  assert.deepEqual(positions(report.vertices),[[.5,1,-2],[.5,1,0]]);
  assert.deepEqual(report.vertices.map(vertex=>vertex.weights),[{right:1},{left:1}]);
  const saved = editor.meshTopology('wall').document;
  assert.deepEqual(saved.vertices.slice(-2).map(vertex=>vertex.weights),[{right:1},{left:1}]);
  assert.equal(editor.build().topologyMeshes.wall.mesh.triangles,4);
});

test('CLI previews an edge grow and publishes the connected face in a separate scene revision',t=>{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'ink-tile-grow-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file = name=>path.join(dir,name);
  const original = JSON.stringify(starter());
  fs.writeFileSync(file('wall.json'),original);
  fs.writeFileSync(file('pick.json'),JSON.stringify(grow.selection));
  const cli = path.resolve(__dirname,'../cli/ink-studio.js');
  const args = ['tileset','grow','--scene','wall.json','--object','wall','--edge','eave','--face','roof',
    '--selection','pick.json','--angle','35','--depth','.75'];
  const run = (...rest)=>JSON.parse(execFileSync(process.execPath,[cli,...args,...rest],{cwd:dir,encoding:'utf8'}));
  const preview = run();
  assert.equal(preview.angle,35);
  assert.deepEqual(preview.size,[2,.75]);
  assert(!fs.existsSync(file('grown.json')));
  assert.deepEqual(run('--out','grown.json'),preview);
  assert.equal(fs.readFileSync(file('wall.json'),'utf8'),original);
  const retry = spawnSync(process.execPath,[cli,...args.map(arg=>arg==='wall.json' ? 'grown.json' : arg),
    '--out','blocked.json'],{cwd:dir,encoding:'utf8'});
  assert.equal(retry.status,1);
  assert(!fs.existsSync(file('blocked.json')));
});
