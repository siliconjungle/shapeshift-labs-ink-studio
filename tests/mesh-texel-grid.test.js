'use strict';

const assert = require('node:assert/strict');
const {execFileSync,spawnSync} = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {test} = require('node:test');
const ink = require('..');
const {KIT:K} = ink.load(), T = K.meshTopology;
const request = (doc,fields)=>({id:'texel-grid',revision:T.revision(doc),
  operation:{kind:'subdivide-texels',face:'panel',...fields}});
const near = (actual,expected)=>assert(Math.abs(actual-expected)<1e-9,String(actual)+' vs '+String(expected));
const positiveAxes = report=>Object.fromEntries(report.detail.texels.axes.map(row=>[row.atlasAxis,row]));

function plain() {
  const points = [[0,0],[2,0],[2,1],[0,1],[2,2],[0,2]];
  const vertices = points.map(([x,y],i)=>({id:'v'+i,position:[x,y,0]}));
  const make = (id,indices,uvs)=>({id,corners:indices.map((v,i)=>({id:id+'/c'+i,vertex:'v'+v,uv:uvs[i]}))});
  return T.create({id:'metal',vertices,faces:[
    make('panel',[0,1,2,3],[[.25,.8],[.75,.8],[.75,.2],[.25,.2]]),
    make('trim',[3,2,4,5],[[0,1],[1,1],[1,0],[0,0]])
  ],edges:[{id:'rim',vertices:['v2','v3'],crease:.5}]});
}

test('the standalone grid lands on exact half-center boundaries and transfers the right fractions onto a neighboring face',()=>{
  const doc = plain(), atlasSize = [17,11];
  const spec = request(doc,{atlasSize,x:[5,9],y:3}), plan = T.planEdgeEdit(doc,spec);
  assert(plan.report.canCommit,JSON.stringify(plan.report.issues));
  assert.equal(plan.report.detail.children.length,9);
  const {x,y} = positiveAxes(plan.report);
  assert.deepEqual(plan.report.detail.texels.origin,[4,2]);
  assert.deepEqual(x.cuts,[{boundary:5,center:4.5,uv:4.5/16,fraction:1/16},
    {boundary:9,center:8.5,uv:8.5/16,fraction:9/16}]);
  assert.deepEqual(y.cuts.map(row=>row.boundary),[8,5]);
  const grid = plan.report.detail.grid;
  assert(grid.every(row=>row[1].uv[0]===4.5/16 && row[2].uv[0]===8.5/16));
  assert(grid[1].every(row=>row.uv[1]===7.5/10));
  assert(grid[2].every(row=>row.uv[1]===4.5/10));
  assert(!Object.isFrozen(atlasSize));
  assert(!Object.isFrozen(spec.operation.x));
  const trim = plan.document.faces.find(row=>row.id==='trim');
  assert.equal(trim.corners.length,6);
  near(trim.corners.find(row=>row.vertex===grid.at(-1)[1].vertex).uv[0],1/16);
  near(trim.corners.find(row=>row.vertex===grid.at(-1)[2].vertex).uv[0],9/16);
  const rim = plan.report.lineage.edges.filter(row=>row.from==='rim');
  assert.equal(rim.length,3);
  assert(rim.every(({to})=>plan.document.edges.find(edge=>edge.id===to).crease===.5));
  assert.deepEqual(T.edit(doc,plan.patch),plan.document);
});

function painted() {
  const scene = {id:'coating',style:'slate',solids:[],tilesets:{
    sheet:ink.createBlankTileset({width:30,height:20,background:'#657f72'})}};
  const crop = ink.pickTilesetRectangle(scene,'sheet',{x:5,y:3,width:12,height:9});
  const editor = ink.createSceneEditor(scene);
  editor.placeTilesetFace({object:'panel',face:'panel',selection:crop,worldSize:[2,1],origin:[-1,0,0],
    paint:{rotation:90,flipX:true},uvInset:{left:1.25,top:.25}});
  const row = editor.meshTopology('panel');
  const document = T.create({...row.document,uvBindings:{pigment:1},faces:row.document.faces.map(face=>({
    ...face,corners:face.corners.map(corner=>({...corner,uv:[0,0],attributes:{'uv/1':corner.uv}}))
  }))});
  const source = JSON.parse(JSON.stringify(editor.snapshot()));
  source.topologyMeshes.panel.document = document;
  return {source,crop,document};
}

test('rotated reflected paint uses the retained crop origin and bound pigment layout',()=>{
  const {source,crop,document} = painted(), editor = ink.createSceneEditor(source);
  const spec = request(document,{x:4,y:[5,9]});
  const plan = editor.planMeshEdgeEdit('panel',spec);
  assert(plan.report.canCommit);
  const {x,y} = positiveAxes(plan.report), {grid,atlas} = plan.report.detail;
  assert.equal(x.faceAxis,'v');
  assert.equal(y.faceAxis,'u');
  assert.deepEqual(plan.report.detail.texels.origin,[5,3]);
  assert.deepEqual(atlas.source,crop);
  assert.equal(atlas.uvSet,1);
  assert.deepEqual(x.cuts.map(row=>row.boundary).sort((a,b)=>a-b),[9,13]);
  assert.deepEqual(y.cuts.map(row=>row.boundary).sort((a,b)=>a-b),[5,9]);
  grid[1].forEach(point=>assert.equal(point.uv[0],x.cuts[0].uv));
  grid.forEach(row=>assert.equal(row[1].uv[1],y.cuts[0].uv));
  assert.throws(()=>editor.planMeshEdgeEdit('panel',request(document,{x:4,atlasSize:[29,20]})),/does not match/);
  const result = editor.editMeshEdges('panel',spec);
  assert.deepEqual(result.edgeEdit,plan.report);
  for (const {face,selection} of atlas.children) {
    const eyedrop = editor.eyedropTilesetFace({object:'panel',face});
    assert.equal(eyedrop.sourceStatus,'retained');
    assert.deepEqual(eyedrop.selection,selection);
  }
  assert(editor.undo());
  assert.deepEqual(editor.snapshot(),source);
});

test('invalid boundaries and nonrectangular UVs fail, while a stripe using only one atlas axis works',()=>{
  const doc = plain(), plan = fields=>T.planEdgeEdit(doc,request(doc,{atlasSize:[17,11],...fields}));
  assert.throws(()=>plan({x:[4]}),/inside the mapped/);
  assert.throws(()=>plan({x:[5,5]}),/distinct boundary/);
  assert.throws(()=>plan({x:.5}),/integer increments/);
  assert.throws(()=>T.planEdgeEdit(doc,request(doc,{x:2})),/explicit atlasSize/);
  const unchanged = plan({x:20});
  assert(unchanged.report.canCommit);
  assert.deepEqual(unchanged.patch,{});
  const stripe = plan({y:[4,6]});
  assert(stripe.report.canCommit);
  assert.equal(stripe.report.detail.children.length,3);
  assert.equal(stripe.report.detail.columns,1);
  const quad = doc.faces[0];
  const skewed = T.edit(doc,{faces:[{...quad,corners:quad.corners.map((corner,i)=>i===2 ? {...corner,uv:[.7,.2]} : corner)}]});
  assert.throws(()=>T.planEdgeEdit(skewed,request(skewed,{atlasSize:[17,11],x:3})),/rectangular pigment UVs/);
  const narrow = T.edit(doc,{faces:[{...quad,corners:quad.corners.map(corner=>({...corner,uv:[0,corner.uv[1]]}))}]});
  assert(T.planEdgeEdit(narrow,request(narrow,{atlasSize:[1,11],x:1,y:[4,6]})).report.canCommit);
});

test('CLI previews atlas lines and commits the same planned geometry',t=>{
  const {source,document} = painted(), cwd = fs.mkdtempSync(path.join(os.tmpdir(),'ink-texel-subdivision-'));
  t.after(()=>fs.rmSync(cwd,{force:true,recursive:true}));
  const cli = path.resolve(__dirname,'../cli/ink-studio.js'), file = name=>path.join(cwd,name);
  const write = (name,data)=>fs.writeFileSync(file(name),JSON.stringify(data));
  const read = name=>JSON.parse(fs.readFileSync(file(name),'utf8'));
  const args = ['mesh-topology','edge-edit','panel.json','grid.json','--object','panel'];
  write('panel.json',source);
  write('grid.json',request(document,{x:[5]}));
  const bad = spawnSync(process.execPath,[cli,...args,'--out','bad.json'],{cwd,encoding:'utf8'});
  assert.equal(bad.status,1);
  assert.match(bad.stderr,/mapped texel footprint/);
  assert(!fs.existsSync(file('bad.json')));
  write('grid.json',request(document,{x:[8,11]}));
  const preview = JSON.parse(execFileSync(process.execPath,[cli,...args],{cwd,encoding:'utf8'}));
  execFileSync(process.execPath,[cli,...args,'--out','split.json','--report','receipt.json'],{cwd});
  assert.deepEqual(read('receipt.json').edgeEdit,preview.report);
  assert.deepEqual(read('split.json').topologyMeshes.panel.document,T.edit(document,preview.patch));
  assert.deepEqual(read('panel.json'),source);
});
