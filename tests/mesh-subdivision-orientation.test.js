'use strict';

const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {test} = require('node:test');
const ink = require('..');
const {KIT:K} = ink.load(), T = K.meshTopology;
const front = {right:[1,0,0],up:[0,1,0],back:[0,0,1]};
const roll = {right:[0,1,0],up:[-1,0,0],back:[0,0,1]};
const axes = (u,v)=>[{axis:'u',faceAxis:u[0],direction:u[1]},{axis:'v',faceAxis:v[0],direction:v[1]}];
const flipped = axes(['v',-1],['u',1]);
const spec = (doc,op)=>({id:'oriented-cut',revision:T.revision(doc),operation:{face:'panel',...op}});
const near = (actual,expected)=>assert(Math.abs(actual-expected)<1e-9,String(actual)+' vs '+String(expected));
const close = (actual,expected)=>actual.forEach((n,i)=>near(n,expected[i]));

function quad() {
  const points = [[1,0,0],[1,2,0],[0,2,0],[0,0,0]];
  const base = [[.25,.8],[.75,.8],[.75,.2],[.25,.2]];
  const alternate = [[.9,.2],[.9,.8],[.1,.8],[.1,.2]];
  return T.create({id:'rotated-panel',vertices:points.map((position,i)=>({id:'v'+i,position})),
    uvBindings:{normal:1},faces:[{id:'panel',diagonal:['c0','c2'],corners:base.map((uv,i)=>({
      id:'c'+i,vertex:'v'+i,uv,attributes:{'uv/1':alternate[i]}
    }))}]});
}

test('picked coordinates map through UV and camera axes on an in-plane rotated quad',()=>{
  const doc = quad(), op = {kind:'split-face',axis:'u',at:[.25,.6]};
  const uv = T.planEdgeEdit(doc,spec(doc,{...op,basis:'uv'}));
  const alternate = T.planEdgeEdit(doc,spec(doc,{...op,basis:'uv',uvSet:'normal'}));
  const view = T.planEdgeEdit(doc,spec(doc,{...op,basis:'camera',camera:front}));
  const rolled = T.planEdgeEdit(doc,spec(doc,{...op,basis:'camera',camera:roll}));
  assert([uv,alternate,view,rolled].every(plan=>plan.report.canCommit));
  const [a,b,c,d] = [uv,alternate,view,rolled].map(plan=>plan.report.detail);
  assert.deepEqual(a.orientation.axes,axes(['u',1],['v',-1]));
  assert.deepEqual(b.orientation.axes,flipped);
  assert.equal(b.orientation.uvSet,1);
  assert.deepEqual(c.orientation.axes,flipped);
  assert.equal(c.orientation.origin,'c3');
  assert.equal(c.orientation.faceAxis,'v');
  assert.equal(c.orientation.view.source,'explicit');
  close(c.orientation.faceAt,[.6,.75]);
  close(a.cut.pick.position,[.6,.5,0]);
  close(c.cut.pick.position,[.25,1.2,0]);
  assert(c.cut.line.every(row=>row.position[0]===.25));
  assert(a.cut.line.every(row=>row.position[1]===.5));
  assert.deepEqual(d.orientation.axes,axes(['u',1],['v',1]));
  assert.deepEqual(T.planEdgeEdit(doc,spec(doc,op)).patch,rolled.patch);
});

test('camera rejects edge-on faces, resolves view ties consistently, and sees explicit pose arguments',()=>{
  const doc = quad(), op = {kind:'subdivide-face',rows:2,columns:3,basis:'camera'};
  const lean = Math.SQRT1_2;
  const tie = {right:[lean,lean,0],up:[-lean,lean,0],back:[0,0,1]};
  const edge = {right:[0,0,1],up:[0,1,0],back:[-1,0,0]};
  assert.throws(()=>T.planEdgeEdit(doc,spec(doc,{...op,camera:edge})),/visible width and height/);
  assert.throws(()=>T.planEdgeEdit(doc,spec(doc,op)),/needs a view/);
  assert.throws(()=>T.planEdgeEdit(doc,spec(doc,{...op,basis:'uv',camera:front})),/settings for that basis/);
  assert.throws(()=>T.planEdgeEdit(doc,spec(doc,{...op,basis:'uv',uvSet:4})),/does not have UV set/);
  const plan = T.planEdgeEdit(doc,spec(doc,{...op,camera:tie}));
  assert(plan.report.canCommit);
  assert.equal(plan.report.detail.orientation.axes[0].faceAxis,'u');
});

test('oriented exact-texel grids preserve the same atlas cuts and patch',()=>{
  const doc = quad(), op = {kind:'subdivide-texels',atlasSize:[17,11],x:[5,9],y:[5]};
  const native = T.planEdgeEdit(doc,spec(doc,op));
  const view = T.planEdgeEdit(doc,spec(doc,{...op,basis:'camera',camera:front}));
  assert(native.report.canCommit && view.report.canCommit);
  assert.deepEqual(view.patch,native.patch);
  const {texels,orientation,rows,columns,grid,cells} = view.report.detail;
  assert.deepEqual(texels,native.report.detail.texels);
  assert.deepEqual(orientation.axes,flipped);
  assert.deepEqual([rows,columns],[3,2]);
  assert.equal(grid[0][0].vertex,'v3');
  assert.equal(cells.find(row=>row.face==='panel').column,1);
});

function sceneFixture() {
  const scene = {id:'rotated-sign',style:'slate',solids:[],camera:{
    target:[.5,1,0],dist:3,yaw:0,pitch:0,projection:'orthographic',sway:0},
  tilesets:{paint:ink.createBlankTileset({width:16,height:16,background:'#617d72'})}};
  const pick = ink.pickTilesetRectangle(scene,'paint',{x:1,y:3,width:14,height:11});
  const editor = ink.createSceneEditor(scene);
  editor.placeTilesetFace({object:'sign',face:'panel',selection:pick,origin:[1,0,0],
    right:[0,1,0],up:[-1,0,0],worldSize:[2,1]});
  const doc = editor.meshTopology('sign').document;
  return {doc,scene:editor.snapshot()};
}

test('scene camera preview, CLI commit, and reordered crop bindings retain the original binding ID',t=>{
  const {doc,scene} = sceneFixture(), editor = ink.createSceneEditor(scene);
  const op = {kind:'subdivide-face',rows:2,columns:3,basis:'camera'}, request = spec(doc,op);
  const plan = editor.planMeshEdgeEdit('sign',request), {orientation,grid,cells,atlas} = plan.report.detail;
  assert(plan.report.canCommit);
  assert.equal(orientation.view.source,'scene');
  assert.deepEqual(orientation.axes,flipped);
  assert.deepEqual([orientation.faceRows,orientation.faceColumns],[3,2]);
  assert.equal(grid.length,3);
  assert(grid.every(row=>row.length===4));
  close(grid[0][0].position,[0,0,0]);
  close(grid[0].at(-1).position,[1,0,0]);
  close(grid.at(-1)[0].position,[0,2,0]);
  assert.deepEqual(atlas.children.map(row=>row.face),cells.map(row=>row.face));
  assert.deepEqual(editor.planMeshEdgeEdit('sign',spec(doc,{...op,camera:front})).patch,plan.patch);

  const cwd = fs.mkdtempSync(path.join(os.tmpdir(),'ink-oriented-subdivision-'));
  t.after(()=>fs.rmSync(cwd,{force:true,recursive:true}));
  const file = name=>path.join(cwd,name), cli = path.resolve(__dirname,'../cli/ink-studio.js');
  const write = (name,data)=>fs.writeFileSync(file(name),JSON.stringify(data));
  const read = name=>JSON.parse(fs.readFileSync(file(name),'utf8'));
  const args = ['mesh-topology','edge-edit','sign.json','grid.json','--object','sign'];
  write('sign.json',scene);
  write('grid.json',request);
  const preview = JSON.parse(execFileSync(process.execPath,[cli,...args],{cwd,encoding:'utf8'}));
  execFileSync(process.execPath,[cli,...args,'--out','tiled.json','--report','receipt.json'],{cwd});
  assert.deepEqual(read('receipt.json').edgeEdit,preview.report);
  const row = read('tiled.json').topologyMeshes.sign;
  assert.deepEqual(row.document,T.edit(doc,preview.patch));
  assert.equal(row.bindings.find(binding=>binding.id==='tileset/panel').element,'panel');
  assert.deepEqual(row.bindings.map(binding=>binding.element),cells.map(cell=>cell.face));
  assert.deepEqual(read('sign.json'),scene);
});
