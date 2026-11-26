'use strict';

const assert = require('node:assert/strict');
const {test} = require('node:test');
const ink = require('..'), T = ink.load().KIT.meshTopology, UV = T.uv;
const close = (actual,expected)=>assert(actual?.every((n,i)=>Math.abs(n-expected[i])<1e-9),JSON.stringify({actual,expected}));
const normalize = options=>({op:'normalize-orientation',...options});
const plan = (doc,...operations)=>UV.plan(doc,{uvSet:'pigment',operations});
const evidence = result=>result.report.operations[0].evidence;
const ready = result=>assert(result.report.canCommit,JSON.stringify(result.report.operations));

function fixture() {
  const vertices = [], faces = [];
  function quad(id,origin,x,y,rect,slots=[0,1,2,3],start=0) {
    const [l,t,r,b] = rect, texels = [[l,b],[r,b],[r,t],[l,t]];
    const corners = [[0,0],[1,0],[1,1],[0,1]].map(([s,t],i)=>{
      const vertex = id+'/v'+i;
      vertices.push({id:vertex,position:origin.map((n,j)=>n+s*x[j]+t*y[j])});
      return {vertex,id:id+'/c'+i,uv:[[0,1],[1,1],[1,0],[0,0]][i],attributes:{'uv/1':texels[slots[i]]}};
    });
    faces.push({id,material:id==='mirror' ? 'other' : 'paint',corners:corners.slice(start).concat(corners.slice(0,start))});
  }
  quad('lead',[0,0,0],[2,0,0],[0,1,0],[.125,.125,.375,.25]);
  quad('turned',[3,0,0],[2,0,0],[0,1,0],[.5,.125,.875,.25],[1,2,3,0],2);
  quad('mirror',[0,2,0],[2,0,0],[0,1,0],[.125,.5,.375,.625],[1,0,3,2]);
  quad('sloped',[3,2,0],[1,0,1],[0,1,0],[.5,.5,.75,.625],[1,2,3,0]);
  quad('vertical',[7,0,0],[0,2,0],[0,0,1],[.125,.5,.375,.625]);
  quad('oblique',[0,5,0],[Math.sqrt(3),1,0],[-1,Math.sqrt(3),0],[.5,.5,.75,.75]);
  quad('degenerate',[3,5,0],[1,0,0],[0,1,0],[.5,.625,.75,.625]);
  const doc = T.create({id:'directional-plates',vertices,faces,uvBindings:{pigment:1},uvPivots:{1:[.5,.5]}});
  const edge = UV.inspect(doc,'pigment').edges.find(row=>row.vertices.join()==='lead/v0,lead/v1').id;
  return {doc,edge};
}

function uvOf(doc,id) {
  return UV.inspect(doc,'pigment').corners.find(row=>row.id===id).uv;
}
function crop(doc,face) {
  return UV.inspect(doc,'pigment').islands.find(row=>row.id===face).bounds;
}

test('a reference face aligns signed grain and mirror parity while keeping both source crops',()=>{
  const {doc} = fixture();
  const reference = UV.select(doc,{domain:'faces',uvSet:'pigment',ids:['lead']});
  const selection = UV.select(doc,{domain:'faces',uvSet:'pigment',ids:['turned','mirror','lead']});
  const result = plan(doc,normalize({selection,reference:{selection:reference},maxError:0}));
  ready(result);
  const report = evidence(result);
  close(report.reference.direction,[1,0,0]);
  assert.deepEqual(report.faces.map(row=>[row.face,row.status,row.degrees,row.flipX]),[
    ['lead','reference',undefined,undefined],['mirror','aligned',0,true],['turned','aligned',90,false]
  ]);
  assert.deepEqual(uvOf(result.document,'turned/c0'),[.5,.25]);
  assert.deepEqual(uvOf(result.document,'turned/c1'),[.875,.25]);
  assert.deepEqual(uvOf(result.document,'mirror/c0'),[.125,.625]);
  for (const face of ['lead','turned','mirror']) assert.deepEqual(crop(result.document,face),crop(doc,face));
  assert.deepEqual(result.document.vertices,doc.vertices);
  assert.deepEqual(UV.inspect(result.document,0).corners,UV.inspect(doc,0).corners);
  assert.deepEqual(result.document.uvPivots,doc.uvPivots);
  assert.deepEqual(result.document.faces.find(row=>row.id==='lead'),doc.faces.find(row=>row.id==='lead'));
  const again = plan(result.document,normalize({ids:['turned','mirror'],reference:{face:'lead'}}));
  ready(again);
  assert.deepEqual(again.patch,{});
  const keepMirror = plan(doc,normalize({ids:['mirror'],reference:{face:'lead'},matchHandedness:false}));
  ready(keepMirror);
  assert.equal(evidence(keepMirror).faces[0].degrees,180);
  assert.equal(evidence(keepMirror).faces[0].flipX,false);

  const neighbor = doc.faces.find(row=>row.id==='turned');
  const connected = T.edit(doc,{faces:[{...neighbor,corners:neighbor.corners.map(corner=>({...corner,
    vertex:({'turned/v0':'lead/v1','turned/v3':'lead/v2'})[corner.vertex] ?? corner.vertex}))}]});
  const shared = UV.inspect(connected,'pigment').edges.find(row=>row.vertices.join()==='lead/v1,lead/v2').id;
  const cut = plan(connected,{op:'cut',ids:[shared]}).document;
  const joined = plan(cut,normalize({ids:['turned'],reference:{face:'lead'}}));
  ready(joined);
  assert.deepEqual(joined.report.seams,[]);
  assert(UV.inspect(joined.document,'pigment').edges.find(row=>row.id===shared).authored);
});

test('a directed edge projects onto a folded face and can align the V direction or reverse the grain',()=>{
  const {doc,edge} = fixture();
  const saved = UV.select(doc,{domain:'edges',uvSet:'pigment',ids:[edge]});
  const projected = plan(doc,normalize({ids:['sloped'],reference:{selection:saved}}));
  ready(projected);
  const directions = evidence(projected).faces[0];
  close(directions.afterDirection,[Math.SQRT1_2,0,Math.SQRT1_2]);
  assert.equal(directions.degrees,90);
  const reverse = plan(doc,normalize({ids:['sloped'],reference:{edge,from:'lead/v1'},axis:'v'}));
  ready(reverse);
  close(evidence(reverse).faces[0].afterDirection,[-Math.SQRT1_2,0,-Math.SQRT1_2]);
  assert.equal(evidence(reverse).reference.to,'lead/v0');
  const perpendicular = plan(doc,normalize({ids:['vertical'],reference:{edge}}));
  assert.equal(perpendicular.report.operations[0].conflicts[0].code,'reference-perpendicular-to-face');
  assert.deepEqual(perpendicular.patch,{});
});

test('report residual quarter-turn error and align an oblique face continuously when requested',()=>{
  const {doc,edge} = fixture();
  const request = normalize({ids:['oblique'],reference:{edge},maxError:1});
  const blocked = plan(doc,request);
  assert.equal(blocked.report.operations[0].conflicts[0].code,'orientation-outside-tolerance');
  close([evidence(blocked).faces[0].afterError],[30]);
  const result = plan(doc,{...request,method:'continuous'});
  ready(result);
  close([evidence(result).faces[0].degrees],[-30]);
  const check = plan(result.document,{...request,method:'continuous'});
  ready(check);
  close(evidence(check).faces[0].beforeDirection,[1,0,0]);
  assert.deepEqual(check.patch,{});
});

test('block degenerate references and pinned edits atomically and journal a scene edit once',()=>{
  const {doc} = fixture();
  const missing = plan(doc,normalize({ids:['turned'],reference:{face:'degenerate'}}));
  assert.equal(missing.report.operations[0].conflicts[0].code,'degenerate-orientation-reference');
  const broken = plan(doc,normalize({ids:['turned','degenerate'],reference:{face:'lead'}}));
  assert.equal(broken.report.operations[0].conflicts[0].code,'degenerate-face-orientation');
  assert.deepEqual(broken.patch,{});
  const pin = plan(doc,{op:'pin',ids:['mirror/c0'],pinned:true}).document;
  const pinned = plan(pin,normalize({ids:['turned','mirror'],reference:{face:'lead'}}));
  assert(pinned.report.operations[0].conflicts.some(row=>row.code==='pinned-corner'));
  assert.deepEqual(pinned.document,pin);

  const scene = {id:'directional-plates',style:'slate',solids:[],topologyMeshes:{plates:{document:doc,
    materials:[{id:'paint'},{id:'other'}],bakes:[{id:'old-bake',material:'paint',maps:{roughness:.6}}]}}};
  const editor = ink.createSceneEditor(scene);
  const request = {uvSet:'pigment',revision:T.revision(doc),operations:[
    normalize({ids:['turned'],reference:{face:'lead'}})
  ]};
  const preview = editor.planMeshUV('plates',request);
  ready(preview);
  assert.deepEqual(editor.editMeshUV('plates',request).uv,preview.report);
  assert.deepEqual(editor.snapshot().topologyMeshes.plates.bakes[0].invalidated.faces,['turned']);
  assert(editor.undo());
  assert.deepEqual(editor.snapshot(),scene);
  assert(editor.redo());
  assert.deepEqual(editor.meshTopology('plates').document,preview.document);
  assert.throws(()=>editor.planMeshUV('plates',request),/different topology revision/);
});
