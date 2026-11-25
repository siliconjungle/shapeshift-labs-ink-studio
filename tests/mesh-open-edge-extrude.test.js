'use strict';

const assert = require('node:assert/strict');
const {execFileSync,spawnSync} = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {test} = require('node:test');
const ink = require('..');
const {KIT:K} = ink.load(), T = K.meshTopology;
const spec = (doc,op,pins)=>({id:'open-trim',revision:T.revision(doc),
  operation:{kind:'extrude-edge',distance:.3,...op},...(pins && {pins})});
const close = (a,b)=>a.forEach((n,i)=>assert(Math.abs(n-b[i])<=1e-9,String(a)+' vs '+String(b)));
const pass = plan=>assert(plan.report.canCommit,JSON.stringify(plan.report.issues));
const uvs = [[0,1],[1,1],[1,0],[0,0]];

function panel(chain = false) {
  const positions = [[-1,0,0],[0,0,0],[0,1,0],[-1,1,0],[1.4,0,.2],[1.4,1.35,.2]];
  const vertices = positions.slice(0,chain ? 6 : 4).map((position,i)=>({id:'v'+i,position,weights:{joint:i/8}}));
  const make = (id,ring,material)=>({id,material,corners:ring.map((vertex,i)=>({id:id+'/c'+i,vertex:'v'+vertex,
    uv:uvs[i],attributes:{'uv/1':uvs[i],tint:i},normal:[0,0,1]}))});
  const edges = [{id:'top',vertices:['v2','v3'],crease:.35},
    ...(chain ? [{id:'top-2',vertices:['v2','v5']},{id:'hinge',vertices:['v1','v2']}] : [])];
  return T.create({id:'panel',vertices,edges,uvBindings:{pigment:1},
    faces:[make('left',[0,1,2,3],'enamel'),...(chain ? [make('right',[1,4,5,2],'copper')] : [])]});
}

test('a single exposed edge extends in its plane or along its face normal',()=>{
  const doc = panel();
  for (const [direction,axis,distance] of [['edge',[0,1,0],.3],['face',[0,0,1],-.2]]) {
    const req = spec(doc,{edge:'top',direction,distance,material:'trim',uv:'per-edge'},{boundary:true});
    const plan = T.planEdgeEdit(doc,req), detail = plan.report.detail;
    pass(plan);
    assert.deepEqual(detail.edgeDirections,[{edge:'top',face:'left',axis}]);
    const [{face,sourceEdge,outerEdge}] = detail.faces;
    assert.equal(sourceEdge,'top');
    assert.deepEqual(plan.document.faces[0],doc.faces[0]);
    assert.deepEqual(plan.document.vertices.slice(0,4),doc.vertices);
    const outer = plan.document.faces.find(row=>row.id===face);
    assert.equal(outer.material,'trim');
    assert.deepEqual(outer.corners.map(row=>row.uv),[[0,0],[1,0],[1,1],[0,1]]);
    assert(outer.corners.every(row=>JSON.stringify(row.uv)===JSON.stringify(row.attributes['uv/1'])));
    assert.deepEqual(outer.corners.map(row=>row.attributes.tint),[3,2,2,3]);
    for (const move of detail.motion) {
      close(move.displacement,axis.map(n=>n*distance));
      const before = doc.vertices.find(row=>row.id===move.from);
      assert.deepEqual(plan.document.vertices.find(row=>row.id===move.to).weights,before.weights);
    }
    const edges = new Map(T.inspect(plan.document).edges.map(row=>[row.id,row]));
    assert.equal(edges.get('top').uses.length,2);
    assert.equal(edges.get('top').crease,.35);
    assert.equal(edges.get(outerEdge).uses.length,1);
    assert.deepEqual(T.edit(doc,plan.patch),plan.document);
    assert.deepEqual(T.planEdgeEdit(doc,req),plan);
  }
});

test('strict direction translates a whole uneven chain without rotating or splitting the join',()=>{
  const doc = panel(true), selection = T.select(doc,{domain:'edges',ids:['top-2','top']});
  const loose = T.planEdgeEdit(doc,spec(doc,{selection,direction:'edge'}));
  const exact = T.planEdgeEdit(doc,spec(doc,{selection,direction:[0,3,0],strict:true}));
  pass(loose);
  pass(exact);
  assert.deepEqual(exact.report.detail.axis,[0,1,0]);
  assert.equal(exact.report.detail.motion.length,3);
  assert(exact.report.detail.motion.every(row=>row.displacement[1]===.3 && row.displacement[0]===0 && row.displacement[2]===0));
  assert(loose.report.detail.motion[1].axis[0]<0);
  const [left,right] = exact.document.faces.slice(2);
  assert.equal(left.corners[2].vertex,right.corners[3].vertex);
  assert.equal(left.corners[1].vertex,right.corners[0].vertex);
  assert.equal(left.corners[1].uv[0],right.corners[0].uv[0]);
  assert.deepEqual([left.material,right.material],['enamel','copper']);
  const incompatible = T.planEdgeEdit(doc,spec(doc,{selection,direction:'face',strict:true}));
  assert(!incompatible.report.canCommit);
  assert.deepEqual(incompatible.report.issues,[{kind:'strict-directions-disagree',edges:['top','top-2']}]);
  assert.deepEqual(incompatible.patch,{});
});

test('closed edges, parallel locks, and overlaps produce actionable blockers',()=>{
  const doc = panel(true);
  const sealed = T.planEdgeEdit(doc,spec(doc,{edge:'hinge'}));
  assert.deepEqual(sealed.report.issues,[{kind:'edge-is-not-open',edges:['hinge']}]);
  const parallel = T.planEdgeEdit(doc,spec(doc,{edge:'top',direction:[1,0,0],strict:true}));
  assert.deepEqual(parallel.report.issues,[{kind:'direction-parallel-to-edge',edges:['top']}]);
  const overlap = T.planEdgeEdit(doc,spec(doc,{edge:'top',direction:'edge',distance:-.2}));
  assert(overlap.report.issues.some(row=>row.kind==='surface-contact'));
  const one = panel(), loop = T.select(one,{domain:'edges'});
  assert.throws(()=>T.planEdgeEdit(one,spec(one,{selection:loop})),/open, consistently wound/);
});

test('headless scene edit preserves the painted base, supports undo, and writes the planned strip',t=>{
  const source = {id:'trimmed-panel',style:'slate',solids:[],tilesets:{
    paint:ink.createBlankTileset({width:8,height:8,background:'#6d8a78'}),
    trim:ink.createBlankTileset({width:8,height:8,background:'#be8f63'})}};
  const editor = ink.createSceneEditor(source);
  const crop = ink.pickTilesetRectangle(source,'paint',{x:1,y:1,width:6,height:5});
  editor.placeTilesetFace({object:'panel',face:'tile',selection:crop,worldSize:[2,1],origin:[-1,0,0]});
  const scene = JSON.parse(JSON.stringify(editor.snapshot())), row = scene.topologyMeshes.panel;
  row.materials.push({id:'trim',texture:{tileset:'trim'}});
  const doc = row.document, edge = T.inspect(doc).edges.find(row=>row.vertices.every(id=>['tile/v2','tile/v3'].includes(id))).id;
  const request = spec(doc,{edge,direction:[0,1,1],strict:true,material:'trim'});
  const transaction = ink.createSceneEditor(scene);
  const plan = transaction.planMeshEdgeEdit('panel',request), result = transaction.editMeshEdges('panel',request);
  pass(plan);
  assert.deepEqual(result.edgeEdit,plan.report);
  assert.deepEqual(transaction.eyedropTilesetFace({object:'panel',face:'tile'}).selection,crop);
  const edited = transaction.snapshot();
  assert(transaction.undo());
  assert.deepEqual(transaction.snapshot(),scene);
  assert(transaction.redo());
  assert.deepEqual(transaction.snapshot(),edited);

  const cwd = fs.mkdtempSync(path.join(os.tmpdir(),'ink-extrude-open-edge-'));
  t.after(()=>fs.rmSync(cwd,{force:true,recursive:true}));
  const file = name=>path.join(cwd,name), cli = path.resolve(__dirname,'../cli/ink-studio.js');
  const write = (name,data)=>fs.writeFileSync(file(name),JSON.stringify(data));
  const read = name=>JSON.parse(fs.readFileSync(file(name),'utf8'));
  const args = ['mesh-topology','edge-edit','scene.json','request.json','--object','panel'];
  write('scene.json',scene);
  write('request.json',{...request,operation:{...request.operation,direction:[1,0,0]}});
  const refused = spawnSync(process.execPath,[cli,...args,'--out','rejected.json','--report','rejected-report.json'],{cwd,encoding:'utf8'});
  assert.equal(refused.status,1);
  assert(!fs.existsSync(file('rejected.json')));
  assert.equal(read('rejected-report.json').issues[0].kind,'direction-parallel-to-edge');
  write('request.json',request);
  const preview = JSON.parse(execFileSync(process.execPath,[cli,...args],{cwd,encoding:'utf8'}));
  execFileSync(process.execPath,[cli,...args,'--out','grown.json','--report','receipt.json'],{cwd});
  assert.deepEqual(read('receipt.json').edgeEdit,preview.report);
  assert.deepEqual(read('grown.json'),edited);
  assert.deepEqual(read('scene.json'),scene);
});
