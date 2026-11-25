'use strict';

const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const ink = require('..');
const { KIT: K } = ink.load(), T=K.meshTopology;
const cli=path.resolve(__dirname,'../cli/ink-studio.js');

const quad=['b-right','ext-low','ext-high','a-top'], triangle=['z-top','a-top','peak'];

function fixture(alternate = false) {
  const positions={
    'b-left':[-1,0,0],'b-right':[1,0,0],'a-top':[1,1,0],'z-top':[-1,1,0],
    peak:[0,2,0],'ext-low':[2,0,0],'ext-high':[2,1,.2],
    duplicate:[-1,1,0], isolated:[3,0,0]
  };
  const ids=['b-left','b-right','a-top','z-top'];
  const document=T.create({id:'gate',vertices:Object.entries(positions).map(([id,position])=>({id,position,
    ...(id==='a-top' && {weights:{pivot:1}})})),faces:[
    {id:'wall',corners:ids.map((vertex,i)=>({id:'wall/c'+i,vertex,uv:[0,0],
      ...(alternate && {attributes:{'uv/2':[0,0],'uv/3':[0,0]}})}))}
  ],edges:[{id:'eave',vertices:['a-top','z-top'],uvSeam:true}],
  ...(alternate && {uvBindings:{pigment:2,emission:3}})});
  const scene={id:'gate',style:'slate',solids:[],tilesets:{
    shingle:ink.createBlankTileset({width:8,height:8,background:'#8f6572'}),
    copper:ink.createBlankTileset({width:8,height:8,background:'#b67440'})},
    topologyMeshes:{gate:{document,part:'facade'}}};
  const selection=ink.pickTilesetRectangle(scene,'shingle',{x:1,y:2,width:3,height:4});
  return {scene,document,selection};
}

test('a saved triangle selection infers compatible winding and preserves the original vertices and edges',()=>{
  const {scene,document,selection}=fixture(), editor=ink.createSceneEditor(scene);
  const request={object:'gate',part:'facade',face:'roof',selection,
    vertices:T.select(document,{domain:'vertices',ids:triangle})};
  const preview=editor.planTilesetFaceFromVertices(request);
  assert.equal(preview.canCommit,true);
  assert.deepEqual(preview.cornerOrder,triangle);
  assert.equal(preview.orderSource,'inferred');
  assert.deepEqual(preview.uvCorners,[0,1,3]);
  assert.deepEqual(preview.normal,[0,0,1]);
  assert.deepEqual(preview.sharedEdges,[{edge:'eave',from:'z-top',to:'a-top',faces:['wall'],opposite:true}]);
  assert.deepEqual(preview.corners.map(({uv})=>uv),[[1/7,5/7],[3/7,5/7],[1/7,2/7]]);
  assert.deepEqual(editor.snapshot(),scene);
  assert.deepEqual(editor.createTilesetFaceFromVertices(request),preview);
  const next=editor.snapshot();
  const row=next.topologyMeshes.gate;
  assert.deepEqual(row.document.vertices,document.vertices);
  assert.deepEqual(row.document.faces[0],document.faces[0]);
  assert.deepEqual(row.document.edges.find(({id})=>id==='eave'),document.edges.find(({id})=>id==='eave'));
  assert.deepEqual(row.bindings[0].data,preview.source);
  assert.deepEqual(row.materials,[{id:'tileset/shingle',texture:{tileset:'shingle'}}]);
  assert(editor.undo());
  assert.deepEqual(editor.snapshot(),scene);
  assert(editor.redo());
  assert.deepEqual(editor.snapshot(),next);
});

test('an explicit quad order is preserved with paint orientation and a named pigment layout',()=>{
  const {scene,document,selection}=fixture(true), editor=ink.createSceneEditor(scene);
  const order=[quad[1],quad[2],quad[3],quad[0]];
  const request={object:'gate',face:'annex',selection,paint:{rotation:90,flipX:true},uvInset:{top:1},
    order,vertices:T.select(document,{domain:'vertices',ids:quad})};
  const preview=editor.planTilesetFaceFromVertices(request);
  assert(preview.canCommit);
  assert.deepEqual(preview.cornerOrder,order);
  assert.deepEqual(preview.uvCorners,[0,1,2,3]);
  assert.equal(preview.uvSet,2);
  const base=[[0,1],[1,1],[1,0],[0,0]], atlas=[[1/7,5/7],[3/7,5/7],[3/7,3/7],[1/7,3/7]];
  assert.deepEqual(preview.corners.map(row=>row.uv),base);
  assert.deepEqual(preview.corners.map(row=>row.attributes['uv/3']),base);
  assert.deepEqual(preview.corners.map(row=>row.attributes['uv/2']),K.authoring.tilesetFaces.cropSource(
    {width:8,height:8},selection,[1,3,4,6],preview.source.paint).pigmentUV);
  assert(preview.corners.every(row=>atlas.some(uv=>row.attributes['uv/2'].every((v,i)=>v===uv[i]))));
  editor.createTilesetFaceFromVertices(request);
  assert.equal(editor.build().topologyMeshes.gate.mesh.triangles,4);
  assert.deepEqual(editor.eyedropTilesetFace({object:'gate',face:'annex'}).selection,selection);
});

test('inferred winding follows a reversed rim and refuses invalid or duplicated closures',()=>{
  const {scene,document,selection}=fixture();
  scene.topologyMeshes.gate.document=T.edit(document,{faces:document.faces.map(face=>({...face,corners:[...face.corners].reverse()}))});
  const editor=ink.createSceneEditor(scene), reversed=editor.meshTopology('gate').document;
  const request={object:'gate',face:'roof',selection,vertices:T.select(reversed,{domain:'vertices',ids:triangle})};
  const preview=editor.planTilesetFaceFromVertices(request);
  assert(preview.canCommit);
  assert.deepEqual(preview.cornerOrder,['z-top','peak','a-top']);
  assert.deepEqual(preview.normal,[0,0,-1]);
  const wrong=editor.planTilesetFaceFromVertices({...request,vertices:triangle});
  assert.equal(wrong.canCommit,false);
  assert(wrong.conflicts.some(row=>row.reason==='inconsistent-edge-winding'));
  const invalid=editor.planTilesetFaceFromVertices({...request,vertices:['b-right','ext-high','ext-low','a-top']});
  assert(invalid.conflicts.some(row=>row.reason==='invalid-polygon'));
  const flat=editor.planTilesetFaceFromVertices({...request,vertices:['z-top','duplicate','peak']});
  assert(flat.conflicts.some(row=>row.reason==='invalid-polygon'));
  assert.throws(()=>editor.planTilesetFaceFromVertices({...request,vertices:undefined}),/selected vertices/);
  assert.throws(()=>editor.planTilesetFaceFromVertices({...request,order:['b-left','z-top','peak']}),/matches the saved selection/);
  editor.createTilesetFaceFromVertices(request);
  const blocked=editor.planTilesetFaceFromVertices({...request,face:'other',vertices:triangle});
  assert(blocked.conflicts.some(row=>row.reason==='duplicate-face'));
  assert(blocked.conflicts.some(row=>row.reason==='edge-would-be-non-manifold'));
  assert.throws(()=>editor.createTilesetFaceFromVertices({...request,face:'stale'}),/same topology revision/);
});

test('a triangle retains its crop through eyedrop, relative reskin, and an atlas swap',()=>{
  const {scene,selection}=fixture(), editor=ink.createSceneEditor(scene);
  const request={object:'gate',face:'roof',selection,vertices:triangle,paint:{rotation:270,flipX:true},uvInset:{bottom:.5}};
  editor.createTilesetFaceFromVertices(request);
  const eye=editor.eyedropTilesetFace({object:'gate',face:'roof'});
  assert(eye.canStamp);
  assert.equal(eye.orientationStatus,'retained');
  assert.deepEqual(eye.uvCorners,[0,1,3]);
  assert.deepEqual(eye.selection,selection);
  assert.equal(eye.uvInset.bottom,.5);
  const replacement=ink.pickTilesetRectangle(scene,'copper',{x:0,y:0,width:3,height:4});
  const reskin=editor.applyTilesetReskin({object:'gate',face:'roof',mode:'relative',selection:{...replacement,paint:{rotation:90}}});
  assert.deepEqual(reskin.after.source.uvCorners,[0,1,3]);
  assert.deepEqual(editor.eyedropTilesetFace({object:'gate',face:'roof'}).selection,replacement);
  const swap={type:'swap',a:{x:0,y:0,width:3,height:4},b:{x:4,y:4,width:3,height:4}};
  const moved=editor.planTilesetCanvas('copper',swap);
  assert(moved.canCommit);
  assert.deepEqual(moved.sourceBindings[0].after.uvCorners,[0,1,3]);
  editor.transformTilesetCanvas('copper',swap);
  const relocated=editor.eyedropTilesetFace({object:'gate',face:'roof'});
  assert(relocated.canStamp);
  assert.deepEqual(relocated.selection,{...replacement,x:4,y:4});
});

test('CLI consumes a current crop and saved vertex selection with identical preview and commit',t=>{
  const {scene,document,selection}=fixture();
  const cwd=fs.mkdtempSync(path.join(os.tmpdir(),'ink-face-from-vertices-'));
  t.after(()=>fs.rmSync(cwd,{force:true,recursive:true}));
  const write=(name,value)=>fs.writeFileSync(path.join(cwd,name),JSON.stringify(value));
  const read=name=>JSON.parse(fs.readFileSync(path.join(cwd,name),'utf8'));
  write('original.json',scene);
  write('crop.json',selection);
  write('vertices.json',T.select(document,{domain:'vertices',ids:quad}));
  write('request.json',{object:'gate',face:'annex',order:quad});
  const args=['tileset','face','request.json','--scene','original.json','--vertices-file','vertices.json','--selection','crop.json'];
  const run=(...rest)=>JSON.parse(execFileSync(process.execPath,[cli,...args,...rest],{cwd,encoding:'utf8'}));
  const preview=run();
  assert(preview.canCommit);
  assert.deepEqual(preview.cornerOrder,quad);
  assert.deepEqual(run('--out','built.json'),preview);
  assert.deepEqual(read('original.json'),scene);
  assert.deepEqual(read('built.json').topologyMeshes.gate.document.faces[1].corners,preview.corners);
  const stale=spawnSync(process.execPath,[cli,...args.map(arg=>arg==='original.json'?'built.json':arg),
    '--out','stale.json'],{cwd,encoding:'utf8'});
  assert.equal(stale.status,1);
  assert(!fs.existsSync(path.join(cwd,'stale.json')));
});
