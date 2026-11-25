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

const request = (doc,...operations)=>({revision:T.revision(doc),operations});
const merge = (doc,options)=>T.planRepair(doc,request(doc,{kind:'merge-tiles',...options}));
const commonEdge = doc=>T.inspect(doc).edges.find(edge=>edge.uses.length === 2);
const tile = (scene,x)=>ink.pickTilesetRectangle(scene,'atlas',{x,y:0,width:9,height:9});

function tiles({gap=0,angle=0,material,third=false} = {}) {
  const source = {id:'painted-wall',style:'slate',solids:[],
    tilesets:{atlas:ink.createBlankTileset({width:32,height:9,background:'#557e74'})}};
  const editor = ink.createSceneEditor(source);
  editor.placeTilesetFace({object:'sign',face:'left',selection:tile(source,0),worldSize:[1,1],origin:[-1,0,0]});
  const rightEdge = (doc,face,vertices)=>T.inspect(doc).edges.find(edge=>edge.vertices.every(id=>vertices.includes(id)) &&
    edge.uses[0].face === face);
  const edge = rightEdge(editor.meshTopology('sign').document,'left',['left/v1','left/v2']).id;
  editor.growTilesetFace({object:'sign',face:'right',selection:tile(source,8+gap),edge,depth:1,paint:{rotation:270},angle,
    ...(material && {material})});
  if (third) {
    const next = rightEdge(editor.meshTopology('sign').document,'right',['right/v2','right/v3']).id;
    editor.growTilesetFace({object:'sign',face:'extra',selection:tile(source,16),edge:next,depth:1,paint:{rotation:270}});
  }
  const scene = JSON.parse(JSON.stringify(editor.snapshot())), row = scene.topologyMeshes.sign;
  return {scene,row,doc:row.document,edge};
}

test('safe merge removes one shared edge, retains junctions and exact paint, and supports chained repair',()=>{
  const {doc,edge} = tiles({third:true}), selection = T.select(doc,{domain:'faces',ids:['right','left']});
  const plan = merge(doc,{selection});
  assert(plan.report.canCommit);
  const [step] = plan.report.steps;
  assert.equal(step.edge,edge);
  assert.equal(step.keep,'left');
  assert.deepEqual(step.discarded,[]);
  assert.equal(step.after.corners.length,6);
  assert.deepEqual(plan.document.vertices,doc.vertices);
  assert.deepEqual(plan.document.edges.find(row=>row.vertices.every(id=>['right/v2','right/v3'].includes(id))),
    doc.edges.find(row=>row.vertices.every(id=>['right/v2','right/v3'].includes(id))));
  assert.equal(plan.document.edges.length,doc.edges.length-1);
  assert.deepEqual(plan.document.faces.find(row=>row.id==='extra'),doc.faces.find(row=>row.id==='extra'));
  assert.deepEqual(plan.patch.lineage.faces,[{from:'right',to:'left'}]);
  assert.equal(plan.patch.lineage.corners.length,2);
  assert.deepEqual(T.edit(doc,plan.patch),plan.document);
  assert.deepEqual(merge(doc,{edge}).patch,plan.patch);
  assert.throws(()=>merge(plan.document,{selection}),/same topology revision/);

  const chain = T.planRepair(doc,request(doc,{kind:'merge-tiles',edge},
    {kind:'merge-tiles',faces:['left','extra'],keep:'left'}));
  assert(chain.report.canCommit);
  assert.equal(chain.document.faces[0].corners.length,8);
  assert.deepEqual(chain.patch.lineage.faces,[{from:'right',to:'left'},{from:'extra',to:'left'}]);
  assert.deepEqual(T.edit(doc,chain.patch),chain.document);
});

test('safe mode catches paint stretching beyond an exact seam in another UV layout',()=>{
  const {doc,edge} = tiles(), base = T.create({...doc,uvBindings:{emission:1},faces:doc.faces.map(face=>({
    ...face,corners:face.corners.map(corner=>({...corner,attributes:{'uv/1':corner.uv}}))
  }))});
  const second = base.faces[1], changed = T.edit(base,{faces:[{...second,corners:second.corners.map(corner=>
    corner.vertex.startsWith('left/') ? corner : {...corner,attributes:{'uv/1':[corner.uv[0]+.1,corner.uv[1]]}}
  )}]});
  const refused = merge(changed,{edge});
  assert(!refused.report.canCommit);
  assert.equal(refused.report.blockers[0].code,'tile-merge-loss');
  assert.deepEqual(refused.document,changed);
  assert.deepEqual(refused.patch,{});
  const [step] = refused.report.steps;
  assert(step.uvSets.every(row=>!row.discontinuous));
  assert(step.discarded.every(row=>row.kind==='uv-interpolation' && row.set===1 && row.face==='right'));
  assert.equal(step.discarded.length,2);
  assert.equal(step.after.triangles.length,4);
});

test('force previews the paint, material and edge it discards while still enforcing geometry',()=>{
  const {doc,edge} = tiles({gap:1,material:'alternate'}), authored = T.edit(doc,{edges:[{id:edge,smooth:false,uvSeam:true,crease:.25}]});
  const safe = merge(authored,{edge,keep:'right'});
  const forced = merge(authored,{edge,keep:'right',mode:'force'});
  assert(!safe.report.canCommit);
  assert(forced.report.canCommit);
  const [step] = forced.report.steps;
  assert.deepEqual(step.after,safe.report.steps[0].after);
  assert.equal(step.after.material,'alternate');
  assert.equal(step.discarded.filter(row=>row.kind==='shared-uv').length,2);
  assert.equal(step.discarded.find(row=>row.kind==='material').before,'tileset/atlas');
  assert.equal(step.discarded.find(row=>row.kind==='authored-edge').edge.crease,.25);
  assert(!forced.document.edges.some(row=>row.id===edge));
  const hinge = tiles({angle:15});
  assert(!merge(hinge.doc,{edge:hinge.edge}).report.canCommit);
  const bent = merge(hinge.doc,{edge:hinge.edge,mode:'force'});
  assert(bent.report.canCommit);
  assert(bent.report.steps[0].discarded.some(row=>row.kind==='geometry-interpolation'));
  const reversed = T.edit(doc,{faces:[{...doc.faces[1],corners:doc.faces[1].corners.slice().reverse()}]});
  assert.throws(()=>merge(reversed,{edge,mode:'force'}),/winding/);
});

test('scene keeps both exact crop references and restores topology and bake state in one undo',()=>{
  const {scene,row,doc,edge} = tiles();
  row.bakes = [{id:'pigment',material:'tileset/atlas',maps:{roughness:.25}}];
  const editor = ink.createSceneEditor(scene), spec = request(doc,{kind:'merge-tiles',edge});
  const preview = editor.planMeshRepair('sign',spec);
  const committed = editor.repairMeshTopology('sign',spec);
  assert.deepEqual(committed.repair,preview.report);
  const [coverage] = preview.report.sourceCoverage;
  assert.equal(coverage.paintChanges,false);
  assert.deepEqual(coverage.bindings.map(row=>row.status),['retained','retained']);
  const combined = editor.snapshot().topologyMeshes.sign;
  assert.deepEqual(combined.bindings,row.bindings.map(binding=>({...binding,element:'left'})));
  assert.deepEqual(combined.bakes[0].invalidated.faces,['left','right']);
  const picked = editor.selectTilesetComponents({domain:'tiles',object:'sign'});
  assert.deepEqual(picked.tiles[0].sources.map(row=>row.selection),[tile(scene,0),tile(scene,8)]);
  const atlas = ink.pickTilesetRectangle(scene,'atlas',{x:0,y:0,width:17,height:9});
  assert.deepEqual(editor.selectTilesetAtlas({selection:atlas,object:'sign'}).ids,['left']);
  assert(editor.undo());
  assert.deepEqual(editor.snapshot(),scene);
  assert(editor.redo());
  assert.deepEqual(editor.snapshot().topologyMeshes.sign,combined);
});

test('CLI refuses a gap, previews lost crop registration and writes an explicit forced merge',t=>{
  const {scene,doc,edge} = tiles({gap:1});
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(),'ink-merge-tiles-'));
  t.after(()=>fs.rmSync(cwd,{force:true,recursive:true}));
  const file = name=>path.join(cwd,name);
  const write = (name,data)=>fs.writeFileSync(file(name),JSON.stringify(data));
  const read = name=>JSON.parse(fs.readFileSync(file(name),'utf8'));
  const args = ['mesh-topology','repair','original.json','request.json','--object','sign'];
  write('original.json',scene);
  write('request.json',request(doc,{kind:'merge-tiles',edge}));
  const refused = spawnSync(process.execPath,[cli,...args,'--out','merged.json','--report','blocked.json'],{cwd,encoding:'utf8'});
  assert.equal(refused.status,1);
  assert.match(refused.stderr,/changes registered data/);
  assert(!fs.existsSync(file('merged.json')));
  assert.equal(read('blocked.json').sourceCoverage[0].before[1].bindings[0].data.selection.x,9);
  write('request.json',request(doc,{kind:'merge-tiles',edge,mode:'force'}));
  const preview = JSON.parse(execFileSync(process.execPath,[cli,...args],{cwd,encoding:'utf8'}));
  assert(preview.report.sourceCoverage[0].paintChanges);
  execFileSync(process.execPath,[cli,...args,'--out','merged.json','--report','receipt.json'],{cwd});
  assert.deepEqual(read('receipt.json').repair,preview.report);
  assert.deepEqual(read('original.json'),scene);
  assert.deepEqual(read('merged.json').topologyMeshes.sign.document,T.edit(doc,preview.patch));
  assert(read('merged.json').topologyMeshes.sign.bindings.every(binding=>
    binding.review?.reason==='merged-tile-paint-changed'));
});
