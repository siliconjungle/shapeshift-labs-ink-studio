'use strict';

const assert = require('node:assert/strict');
const {test} = require('node:test');
const ink = require('..'), T = ink.load().KIT.meshTopology;
const {sampleCoverage} = require('../src/mesh-uv.js');
const close = (n,expected)=>assert(Math.abs(n-expected)<1e-10,JSON.stringify({n,expected}));
const ready = report=>assert(report.canCommit,JSON.stringify(report.conflicts.length ? report.conflicts : report.problems));

function fixture() {
  const plate = (id,vertices,box)=>({id,material:'oak',corners:vertices.map((vertex,i)=>({
    id:id+'/'+vertex,vertex,uv:[[0,1],[1,1],[1,0],[0,0]][i],
    attributes:{'uv/1':[[box[0],.75],[box[1],.75],[box[1],.25],[box[0],.25]][i]}
  }))});
  const positions = {a:[0,0,0],b:[2,0,0],c:[2,1,0],d:[0,1,0],e:[3,0,0],f:[3,1,0],
    g:[4,0,0],h:[5,0,0],i:[5,1,0],j:[4,1,0]};
  const vertices = Object.entries(positions).map(([id,position])=>({id,position}));
  const doc = T.create({id:'siding',vertices,faces:[
    plate('left',['a','b','c','d'],[.125,.375]),plate('right',['b','e','f','c'],[.375,.625]),
    plate('spare',['g','h','i','j'],[.75,1])
  ],uvBindings:{pigment:1}});
  const original = ink.createBlankTileset({width:9,height:9,background:'#805b45'});
  const target = ink.createBlankTileset({width:17,height:9,background:'#75949a'});
  const pixels = Buffer.from(target.data,'base64');
  pixels[(2*17+3)*4+3] = 0;
  pixels[(2*17+4)*4+3] = 128;
  const scene = {id:'panel-assignment',style:'slate',solids:[],
    tilesets:{old:original,new:{...target,data:pixels.toString('base64'),
      tileSize:{width:4,height:3,paddingX:1,paddingY:1,offsetX:1,offsetY:1}}},
    topologyMeshes:{wall:{document:doc,materials:[{id:'oak',texture:{tileset:'old'}}],
      bakes:[{id:'wall-bake',material:'oak',maps:{roughness:.4}}]}}};
  const tile = ink.pickTilesetRectangle(scene,'new',{x:2,y:1,width:9,height:5});
  return {doc,scene,tile};
}

test('fit selected adjacent faces as a group and inspect their coverage before an atomic commit',()=>{
  const {doc,scene,tile} = fixture(), editor = ink.createSceneEditor(scene);
  const selection = editor.selectMeshUV('wall',{domain:'faces',uvSet:'pigment',ids:['right','left']});
  const request = {object:'wall',mode:'tile',tile,selection,revision:T.revision(doc)};
  const report = editor.planTilesetAssignment(request);
  ready(report);
  assert.deepEqual(editor.snapshot(),scene);
  assert.deepEqual(report.target.selection,tile);
  assert.deepEqual(report.target.uvBounds,[2/16,1/8,10/16,5/8]);
  assert.deepEqual(report.coverage,{texels:45,covered:45,shared:5,transparent:1,translucent:1,opaque:43,
    fraction:1,complete:true,scanlines:20});
  for (const row of report.faces) {
    assert.equal(row.after.coverage.texels,25);
    assert.equal(row.after.material,'oak/tileset/new');
    assert.equal(row.basis,'authored-uv');
  }
  close(report.faces[0].after.metrics.maxStretch,2);
  close(report.faces[1].after.metrics.maxStretch,1);
  assert.deepEqual(report.faces[0].after.bounds,[2,1,6,5]);
  assert.deepEqual(report.faces[1].after.bounds,[6,1,10,5]);
  const committed = editor.applyTilesetAssignment(request);
  assert.deepEqual(committed,report);
  const row = editor.snapshot().topologyMeshes.wall;
  assert.deepEqual(row.document.vertices,doc.vertices);
  assert.deepEqual(row.document.faces.find(face=>face.id==='spare'),doc.faces.find(face=>face.id==='spare'));
  assert.deepEqual(row.bakes,scene.topologyMeshes.wall.bakes);
  assert.equal(row.bindings.length,2);
  assert(row.bindings.every(binding=>binding.data.selection.tileset==='new'));
  assert.deepEqual(row.document.faces.map(face=>face.corners.map(corner=>corner.uv)),doc.faces.map(face=>face.corners.map(corner=>corner.uv)));
  assert(editor.undo());
  assert.deepEqual(editor.snapshot(),scene);
  assert(editor.redo());
  assert.deepEqual(editor.snapshot().topologyMeshes.wall,row);
  assert.throws(()=>editor.planTilesetAssignment(request),/different topology revision/);
});

test('map the entire sheet on each face or choose one cell from a padded brush',()=>{
  const {scene} = fixture(), editor = ink.createSceneEditor(scene);
  const request = {object:'wall',mode:'sheet',tileset:'new',mapping:'per-face',ids:['left','right']};
  const report = editor.planTilesetAssignment(request);
  ready(report);
  assert.equal(report.coverage.covered,153);
  assert.equal(report.coverage.shared,153);
  assert.deepEqual(report.target.uvBounds,[0,0,1,1]);
  close(report.faces[0].after.metrics.maxStretch,1);
  close(report.faces[1].after.metrics.maxStretch,2);
  const tile = ink.pickTilesetBlock(scene,'new',{x:1,y:1,width:9,height:3});
  assert.throws(()=>editor.planTilesetAssignment({object:'wall',tile,ids:['left']}),/column and row/);
  const cell = editor.planTilesetAssignment({object:'wall',tile,ids:['left'],cell:{column:1,row:0}});
  ready(cell);
  assert.deepEqual(cell.faces[0].after.bounds,[6,1,9,3]);
  assert.equal(cell.coverage.covered,12);
  const painted = editor.planTilesetAssignment({object:'wall',ids:['left'],tile:{
    ...fixture().tile,paint:{rotation:90},uvInset:{left:1,right:1,top:1,bottom:1}
  }});
  ready(painted);
  assert.deepEqual(painted.faces[0].after.bounds,[3,2,9,4]);
  assert.deepEqual(painted.faces[0].corners[0].after,[9/16,4/8]);
  assert.equal(painted.coverage.covered,21);
});

test('project an untextured triangle, count its actual footprint, and allow single-texel paint',()=>{
  const doc = T.create({id:'inlay',vertices:[
    {id:'a',position:[0,0,0]},{id:'b',position:[1,0,0]},{id:'c',position:[0,1,0]}
  ],faces:[{id:'triangle',corners:['a','b','c'].map(vertex=>({id:'c'+vertex,vertex}))}]});
  const scene = {id:'triangle',style:'slate',solids:[],tilesets:{paint:ink.createBlankTileset({width:5,height:5})},
    topologyMeshes:{mesh:{document:doc}}};
  const editor = ink.createSceneEditor(scene), report = editor.planTilesetAssignment({
    object:'mesh',mode:'sheet',tileset:'paint',ids:['triangle']
  });
  ready(report);
  assert.equal(report.faces[0].basis,'surface-projection');
  assert.equal(report.faces[0].before.metrics,null);
  assert.equal(report.coverage.covered,15);
  assert.equal(report.coverage.transparent,15);
  close(report.coverage.fraction,.6);
  const tile = ink.pickTilesetRectangle(scene,'paint',{x:3,y:2,width:1,height:1});
  const single = editor.applyTilesetAssignment({object:'mesh',tile,ids:['triangle']});
  ready(single);
  assert.equal(single.coverage.covered,1);
  assert.deepEqual(single.faces[0].after.bounds,[3,2,3,2]);
  assert.equal(single.faces[0].after.metrics.maxStretch,null);
});

test('return coverage for a pinned dry run and reject the entire commit',()=>{
  const {doc,scene,tile} = fixture();
  const pin = T.uv.plan(doc,{uvSet:'pigment',operations:[{op:'pin',ids:['right/e'],pinned:true}]}).document;
  const state = {...scene,topologyMeshes:{wall:{...scene.topologyMeshes.wall,document:pin}}};
  const editor = ink.createSceneEditor(state);
  const request = {object:'wall',tile,ids:['left','right']};
  const preview = editor.planTilesetAssignment(request);
  assert.equal(preview.canCommit,false);
  assert.equal(preview.coverage.covered,45);
  assert.deepEqual(preview.conflicts,[{reason:'pinned-uv',face:'right',corner:'right/e'}]);
  assert.throws(()=>editor.applyTilesetAssignment(request),error=>error.report?.conflicts[0].reason==='pinned-uv');
  assert.deepEqual(editor.snapshot(),state);
  const {wall} = scene.topologyMeshes;
  const incompatible = {...scene,topologyMeshes:{wall:{...wall,
    materials:[{...wall.materials[0],normal:new Array(9*9*4).fill(128)}]}}};
  const other = ink.createSceneEditor(incompatible);
  const blocked = other.planTilesetAssignment(request);
  assert.equal(blocked.canCommit,false);
  assert(blocked.problems.some(row=>JSON.stringify(row).includes('normal maps')));
  assert.deepEqual(other.snapshot(),incompatible);
});

test('label partial coverage when its scanline budget is exhausted',()=>{
  const crop = {x:0,y:0,width:5,height:5}, image = {...crop,pixels:new Uint8Array(100).fill(255)};
  const triangle = [[0,0],[4,0],[0,4]];
  const result = sampleCoverage([[triangle],[triangle]],crop,image,2);
  assert.equal(result.complete,false);
  assert.equal(result.scanlines,2);
  assert.equal(result.covered,9);
  assert.equal(result.shared,0);
  assert.deepEqual(result.perFace,[{texels:9,complete:false},{texels:0,complete:false}]);
});
