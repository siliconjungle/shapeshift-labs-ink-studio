'use strict';

const assert = require('node:assert/strict');
const {execFileSync,spawnSync} = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {test} = require('node:test');
const ink = require('..');
const {KIT:K} = ink.load(), T = K.meshTopology;
const cli = path.resolve(__dirname,'../cli/ink-studio.js');
const spec = (doc,options,pins)=>({id:'panel-grid',revision:T.revision(doc),operation:{kind:'subdivide-face',...options},
  ...(pins && {pins})});
const close = (a,b)=>a.forEach((n,i)=>assert(Math.abs(n-b[i])<1e-9,String(a)+' vs '+String(b)));
const palette = [[0,1],[1,1],[1,0],[0,0]];

function panel() {
  const positions = [[0,0,0],[3,0,0],[3,2,0],[0,2,0],[3,3,0],[0,3,0]];
  const face = (id,indices)=>({id,material:'enamel',corners:indices.map((vertex,i)=>({
    id:id+'/c'+i,vertex:'v'+vertex,uv:palette[i],uvPinned:true,
    attributes:{'uv/1':palette[i].map(n=>n*.5),tint:positions[vertex][0]},uvPins:{1:true}
  }))});
  return T.create({id:'sign',uvBindings:{pigment:1},vertices:positions.map((position,i)=>({
    id:'v'+i,position,weights:{tip:position[0]/3,root:1-position[0]/3}
  })),faces:[{...face('panel',[0,1,2,3]),diagonal:['panel/c0','panel/c2']},face('trim',[3,2,4,5])],
  edges:[{id:'rim',vertices:['v2','v3'],crease:.35,uvSeams:{1:true}}]});
}

test('subdivision creates a regular retained grid with interpolated channels and complete face and edge correspondence',()=>{
  const doc = panel(), selection = T.select(doc,{domain:'faces',ids:['panel']});
  const request = spec(doc,{selection,rows:2,columns:3}), plan = T.planEdgeEdit(doc,request);
  assert(plan.report.canCommit,JSON.stringify(plan.report.issues));
  const {cells,children,grid,transitionFaces,uvSet} = plan.report.detail;
  assert.equal(uvSet,1);
  assert.deepEqual(transitionFaces,['trim']);
  assert.equal(children.length,6);
  assert.equal(children[0],'panel');
  assert.deepEqual(cells.map(({row,column})=>[row,column]),[[0,0],[0,1],[0,2],[1,0],[1,1],[1,2]]);
  assert.equal(grid.length,3);
  assert(grid.every(row=>row.length===4));
  for (const [i,row] of grid.entries()) for (const [j,node] of row.entries()) {
    close(node.position,[j,i,0]);
    close(node.uv,[j/6,(1-i/2)*.5]);
  }
  const interior = grid[1][1];
  assert.equal(interior.sources.length,4);
  const vertices = new Map(plan.document.vertices.map(row=>[row.id,row]));
  close([vertices.get(interior.vertex).weights.tip],[1/3]);
  const faces = new Map(plan.document.faces.map(row=>[row.id,row]));
  assert(children.every(id=>faces.get(id).material==='enamel' && faces.get(id).corners.length===4));
  assert.equal(faces.get('trim').corners.length,6);
  assert.equal(faces.get(children[0]).corners[0].id,'panel/c0');
  assert.equal(faces.get(children.at(-1)).corners[2].id,'panel/c2');
  const sampled = faces.get(children[0]).corners[2];
  close([sampled.attributes.tint],[1]);
  assert.deepEqual(sampled.uvPins,{1:true});
  assert(sampled.uvPinned);
  const edges = new Map(T.inspect(plan.document).edges.map(edge=>[edge.id,edge]));
  const links = plan.report.lineage.edges.filter(row=>row.from==='rim');
  assert.equal(links.length,3);
  assert(links.every(({to})=>edges.get(to).uses.length===2 && edges.get(to).crease===.35 && edges.get(to).uvSeams[1]));
  const {document,correspondence} = T.editWithCorrespondence(doc,plan.patch);
  assert.deepEqual(document,plan.document);
  const parent = correspondence.domains.faces.groups.find(group=>group.from.includes('panel'));
  assert.equal(parent.status,'split');
  assert.deepEqual(parent.to,children.slice().sort());
  assert.deepEqual(T.planEdgeEdit(doc,request),plan);
  assert.throws(()=>T.planEdgeEdit(document,request),/Stale/);
});

test('one-by-one is an identity and strips and blocked boundaries are explicit',()=>{
  const doc = panel(), noop = T.planEdgeEdit(doc,spec(doc,{face:'panel',rows:1,columns:1}));
  assert(noop.report.canCommit);
  assert.deepEqual(noop.patch,{});
  assert.deepEqual(noop.document,doc);
  const strip = T.planEdgeEdit(doc,spec(doc,{face:'panel',rows:3,columns:1}));
  assert(strip.report.canCommit);
  assert.equal(strip.report.detail.children.length,3);
  assert.deepEqual(strip.report.detail.transitionFaces,[]);
  const blocked = T.planEdgeEdit(doc,spec(doc,{face:'panel',rows:2,columns:3},{edges:['rim']}));
  assert.equal(blocked.report.canCommit,false);
  assert.deepEqual(blocked.report.issues,[{kind:'pinned-edges',edges:['rim']}]);
  assert.deepEqual(blocked.patch,{});
  const warped = T.edit(doc,{vertices:[{id:'v2',position:[3,2,.2]}]});
  const warp = T.planEdgeEdit(warped,spec(warped,{face:'panel',rows:2,columns:3}));
  assert.equal(warp.report.issues[0].kind,'registration-would-change');
  assert.deepEqual(warp.patch,{});
  for (const count of [0,1.5,33]) assert.throws(()=>T.planEdgeEdit(doc,spec(doc,{face:'panel',rows:2,columns:count})),/rows and columns/);
});

function painted() {
  const scene = {id:'classified-tiles',style:'slate',solids:[],tilesets:{
    enamel:ink.createBlankTileset({width:30,height:20,background:'#78908a'})}};
  const crop = ink.pickTilesetRectangle(scene,'enamel',{x:3,y:2,width:18,height:12});
  const editor = ink.createSceneEditor(scene);
  editor.placeTilesetFace({object:'sign',face:'panel',selection:crop,paint:{rotation:90,flipY:true},
    uvInset:{top:.5},worldSize:[2,1],origin:[-1,0,0]});
  const source = JSON.parse(JSON.stringify(editor.snapshot())), row = source.topologyMeshes.sign;
  row.bindings.push({id:'review-anchor',domain:'faces',element:'panel',data:{name:'survey'}});
  row.bakes = [{id:'enamel',material:'tileset/enamel',maps:{roughness:.25}}];
  return {source,crop,doc:row.document};
}

test('scene creates reusable atlas crops per cell, routes other bindings to review, and undoes the grid atomically',()=>{
  const {source,crop,doc} = painted(), editor = ink.createSceneEditor(source);
  const request = spec(doc,{face:'panel',rows:2,columns:3});
  const plan = editor.planMeshEdgeEdit('sign',request), {atlas,cells,grid} = plan.report.detail;
  assert(plan.report.canCommit);
  assert.deepEqual(atlas.source,crop);
  assert.equal(atlas.children.length,6);
  atlas.grid.forEach((row,i)=>row.forEach((point,j)=>close(point,[grid[i][j].uv[0]*29,grid[i][j].uv[1]*19])));
  const result = editor.editMeshEdges('sign',request);
  assert.deepEqual(result.edgeEdit,plan.report);
  const after = editor.snapshot(), row = after.topologyMeshes.sign;
  assert.deepEqual(row.bindings.slice(0,6).map(binding=>binding.element),cells.map(row=>row.face));
  assert.deepEqual(row.bindings[6].review,{reason:'split',candidates:cells.map(row=>row.face).sort()});
  assert.deepEqual(row.bakes[0].invalidated.faces,cells.map(row=>row.face).sort());
  for (const {face,selection,uvInset,paint} of atlas.children) {
    const picked = editor.eyedropTilesetFace({object:'sign',face});
    assert(picked.canStamp);
    assert.equal(picked.sourceStatus,'retained');
    assert.deepEqual(picked.selection,selection);
    assert.deepEqual(picked.uvInset,uvInset);
    assert.deepEqual(picked.paint,paint);
  }
  assert(editor.undo());
  assert.deepEqual(editor.snapshot(),source);
  assert(editor.redo());
  assert.deepEqual(editor.snapshot(),after);
});

test('CLI commits the previewed grid and blocks subdivision of pinned edges',t=>{
  const {source,doc} = painted(), cwd = fs.mkdtempSync(path.join(os.tmpdir(),'ink-subdivide-face-'));
  t.after(()=>fs.rmSync(cwd,{force:true,recursive:true}));
  const file = name=>path.join(cwd,name);
  const write = (name,data)=>fs.writeFileSync(file(name),JSON.stringify(data));
  const read = name=>JSON.parse(fs.readFileSync(file(name),'utf8'));
  const args = ['mesh-topology','edge-edit','sign.json','grid.json','--object','sign'];
  write('sign.json',source);
  write('grid.json',spec(doc,{face:'panel',rows:2,columns:3},{boundary:true}));
  const refused = spawnSync(process.execPath,[cli,...args,'--out','rejected.json','--report','rejected-report.json'],{cwd,encoding:'utf8'});
  assert.equal(refused.status,1);
  assert(!fs.existsSync(file('rejected.json')));
  assert.equal(read('rejected-report.json').issues[0].kind,'pinned-edges');
  write('grid.json',spec(doc,{face:'panel',rows:2,columns:3}));
  const preview = JSON.parse(execFileSync(process.execPath,[cli,...args],{cwd,encoding:'utf8'}));
  execFileSync(process.execPath,[cli,...args,'--out','tiled.json','--report','receipt.json'],{cwd});
  assert.deepEqual(read('receipt.json').edgeEdit,preview.report);
  assert.deepEqual(read('tiled.json').topologyMeshes.sign.document,T.edit(doc,preview.patch));
  assert.deepEqual(read('sign.json'),source);
});
