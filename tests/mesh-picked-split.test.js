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
const close = (a,b)=>a.forEach((n,i)=>assert(Math.abs(n-b[i])<1e-9, String(a)+' vs '+String(b)));
const request = (doc,operation,pins)=>({id:'score',revision:T.revision(doc),operation:{kind:'split-face',...operation},...(pins && {pins})});

function fixture() {
  const positions = [[0,0,0],[2,0,0],[2,1,0],[0,1,0],[2,2,0],[0,2,0]];
  const vertices = positions.map((position,i)=>({id:'v'+i,position,weights:{root:1-position[0]/2,tip:position[0]/2}}));
  const makeFace = (id,ring,range)=>({id,material:'paint',corners:ring.map((v,i)=>{
    const [u,y] = [[0,1],[1,1],[1,0],[0,0]][i], uv = [range[0]+u/4,y];
    return {id:id+'/c'+i,vertex:'v'+v,uv,normal:[0,0,1],uvPinned:true,
      attributes:{'uv/1':uv.map(n=>n*.5),heat:positions[v][0]},uvPins:{1:true}};
  })});
  return T.create({id:'door',vertices,faces:[
    {...makeFace('panel',[0,1,2,3],[.1]),diagonal:['panel/c0','panel/c2']},
    makeFace('trim',[3,2,4,5],[.6])
  ],uvBindings:{pigment:1},edges:[{id:'rim',vertices:['v2','v3'],uvSeams:{1:true},crease:.4,smooth:false}]});
}

test('a picked cut returns the interpolated surface and palette layout and keeps a conforming neighbor',()=>{
  const doc = fixture(), selection = T.select(doc,{domain:'faces',ids:['panel']});
  const spec = request(doc,{selection,axis:'u',at:[.25,.6]});
  const plan = T.planEdgeEdit(doc,spec);
  assert(plan.report.canCommit,JSON.stringify(plan.report.issues));
  const {cut,children,sectionEdge,transitionFaces} = plan.report.detail;
  assert.equal(cut.uvSet,1);
  close(cut.pick.position,[.5,.6,0]);
  close(cut.pick.uv,[.08125,.2]);
  cut.line.forEach((row,i)=>close(row.position,[[.5,0,0],[.5,.25,0],[.5,1,0]][i]));
  assert.deepEqual(transitionFaces,['trim']);
  const faces = new Map(plan.document.faces.map(face=>[face.id,face]));
  assert.deepEqual(children.map(id=>faces.get(id).corners.length),[4,4]);
  assert.equal(faces.get('trim').corners.length,5);
  const knots = plan.patch.vertices;
  assert.deepEqual(knots.map(row=>row.weights),[{root:.75,tip:.25},{root:.75,tip:.25}]);
  for (const face of plan.document.faces) for (const corner of face.corners.filter(row=>row.vertex===knots[1].id)) {
    assert.deepEqual(corner.uvPins,{1:true});
    assert.equal(corner.uvPinned,true);
    assert.equal(corner.attributes.heat,.5);
    close(corner.attributes['uv/1'],face.id==='trim' ? [.33125,.5] : [.08125,0]);
  }
  const edges = new Map(T.inspect(plan.document).edges.map(row=>[row.id,row]));
  assert.equal(edges.get(sectionEdge).uses.length,2);
  const links = plan.report.lineage.edges.filter(row=>row.from==='rim');
  assert.equal(links.length,2);
  assert(links.every(({to})=>edges.get(to).uses.length===2 && edges.get(to).crease===.4 &&
    edges.get(to).smooth===false && edges.get(to).uvSeams[1]));
  assert.deepEqual(T.edit(doc,plan.patch),plan.document);
  assert.deepEqual(T.planEdgeEdit(doc,spec),plan);
  assert.throws(()=>T.planEdgeEdit(plan.document,spec),/Stale/);
});

test('the other axis follows the other edges and blocked previews still show the traced line',()=>{
  const doc = fixture(), op = {face:'panel',axis:'v',at:[.1,.4]};
  const plan = T.planEdgeEdit(doc,request(doc,op));
  assert(plan.report.canCommit);
  assert.deepEqual(plan.report.detail.transitionFaces,[]);
  const {cut} = plan.report.detail;
  close(cut.pick.position,[.2,.4,0]);
  close(cut.line[0].position,[0,.4,0]);
  close(cut.line.at(-1).position,[2,.4,0]);
  const pinned = T.planEdgeEdit(doc,request(doc,op,{edges:[plan.report.detail.edges[0]]}));
  assert.equal(pinned.report.issues[0].kind,'pinned-edges');
  assert.deepEqual(pinned.patch,{});
  assert.deepEqual(pinned.report.detail.cut,cut);
  const warped = T.edit(doc,{vertices:[{id:'v2',position:[2,1,.7]}]});
  const blocked = T.planEdgeEdit(warped,request(warped,op));
  assert.equal(blocked.report.issues[0].kind,'registration-would-change');
  assert.deepEqual(blocked.patch,{});
  assert.equal(blocked.report.canCommit,false);
  close(blocked.report.detail.cut.line[1].position,[.8,.4,.28]);
  assert.throws(()=>T.planEdgeEdit(doc,request(doc,{...op,at:[.3,0]})),/inside the quad/);

  const positions = [[0,0,0],[2,0,0],[1,1,0],[0,1,0]];
  const trapezoid = T.create({id:'trap',vertices:positions.map((position,i)=>({id:'v'+i,position})),
    faces:[{id:'panel',diagonal:['c0','c2'],corners:positions.map(([x,y],i)=>({id:'c'+i,vertex:'v'+i,uv:[x/2,y]}))}]});
  const bentTrace = T.planEdgeEdit(trapezoid,request(trapezoid,{face:'panel',axis:'u',at:[.4,.4]}));
  assert.equal(bentTrace.report.canCommit,false);
  assert.deepEqual(bentTrace.report.issues[0].findings,[{kind:'cut-bends-on-face',face:'panel'}]);
  close(bentTrace.report.detail.cut.line[1].position,[.4,.4,0]);
});

function painted() {
  const scene = {id:'workshop',style:'slate',solids:[],tilesets:{
    clay:ink.createBlankTileset({width:24,height:16,background:'#927161'})}};
  const selection = ink.pickTilesetRectangle(scene,'clay',{x:3,y:4,width:12,height:9});
  const editor = ink.createSceneEditor(scene);
  editor.placeTilesetFace({object:'door',face:'panel',selection,paint:{rotation:90,flipX:true},uvInset:{top:.5},
    worldSize:[2,1],origin:[-1,0,0]});
  const doc = editor.meshTopology('door').document;
  return {editor,scene:editor.snapshot(),doc,selection,spec:request(doc,{face:'panel',axis:'u',at:[.35,.6]})};
}

test('scene maps the cut to rotated atlas texels and installs both reusable cropped bindings atomically',()=>{
  const {editor,scene,doc,selection,spec} = painted();
  const preview = editor.planMeshEdgeEdit('door',spec), {atlas,cut,children} = preview.report.detail;
  assert(preview.report.canCommit);
  assert.deepEqual(atlas.size,[24,16]);
  assert.equal(atlas.tileset,'clay');
  assert.equal(atlas.units,'texel-centers');
  assert.deepEqual(atlas.source,selection);
  atlas.line.forEach((row,i)=>close(row,[cut.line[i].uv[0]*23,cut.line[i].uv[1]*15]));
  close(atlas.pick,[cut.pick.uv[0]*23,cut.pick.uv[1]*15]);
  assert(Math.abs(atlas.line[0][0]-atlas.line.at(-1)[0])>5);
  assert.equal(atlas.line[0][1],atlas.line.at(-1)[1]);
  const result = editor.editMeshEdges('door',spec);
  assert.deepEqual(result.edgeEdit,preview.report);
  const after = editor.snapshot(), row = after.topologyMeshes.door;
  assert.deepEqual(row.document,T.edit(doc,preview.patch));
  assert.deepEqual(row.bindings.map(binding=>binding.element),children);
  for (const crop of atlas.children) {
    const eyedrop = editor.eyedropTilesetFace({object:'door',face:crop.face});
    assert.equal(eyedrop.sourceStatus,'retained');
    assert.deepEqual(eyedrop.selection,crop.selection);
    assert.deepEqual(eyedrop.uvInset,crop.uvInset);
    assert.deepEqual(eyedrop.paint,crop.paint);
  }
  assert(editor.undo());
  assert.deepEqual(editor.snapshot(),scene);
  assert(editor.redo());
  assert.deepEqual(editor.snapshot(),after);
});

test('headless CLI previews, writes the matching receipt, and leaves a pinned cut untouched',t=>{
  const {scene,doc,spec} = painted();
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(),'ink-picked-split-'));
  t.after(()=>fs.rmSync(cwd,{force:true,recursive:true}));
  const file = name=>path.join(cwd,name);
  const write = (name,data)=>fs.writeFileSync(file(name),JSON.stringify(data));
  const read = name=>JSON.parse(fs.readFileSync(file(name),'utf8'));
  const args = ['mesh-topology','edge-edit','door.json','request.json','--object','door'];
  write('door.json',scene);
  write('request.json',{...spec,pins:{boundary:true}});
  const rejected = spawnSync(process.execPath,[cli,...args,'--out','blocked.json','--report','blocked-report.json'],{cwd,encoding:'utf8'});
  assert.equal(rejected.status,1);
  assert(!fs.existsSync(file('blocked.json')));
  assert.equal(read('blocked-report.json').detail.atlas.line.length,3);
  write('request.json',spec);
  const preview = JSON.parse(execFileSync(process.execPath,[cli,...args],{cwd,encoding:'utf8'}));
  execFileSync(process.execPath,[cli,...args,'--out','cut.json','--report','receipt.json'],{cwd});
  assert.deepEqual(read('receipt.json').edgeEdit,preview.report);
  assert.deepEqual(read('cut.json').topologyMeshes.door.document,T.edit(doc,preview.patch));
  assert.deepEqual(read('door.json'),scene);
});
