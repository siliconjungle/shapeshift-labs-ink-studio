'use strict';

const assert = require('node:assert/strict');
const {test} = require('node:test');
const ink = require('..'), T = ink.load().KIT.meshTopology, UV = T.uv;
const nudge = fields=>({op:'nudge',ids:['left','right'],steps:[1,-1],...fields});
const close = (a,b)=>assert(a.every((n,i)=>Math.abs(n-b[i])<1e-10),JSON.stringify({a,b}));
const ready = plan=>assert(plan.report.canCommit,JSON.stringify(plan.report.operations));
const shifts = plan=>plan.report.operations[0].evidence.materials;

function fixture() {
  const positions = [[0,0,0],[1,0,0],[1,1,0],[0,1,0],[2,0,0],[3,0,0],[3,1,0],[2,1,0]];
  const vertices = positions.map((position,i)=>({id:'v'+i,position}));
  const faces = ['left','right'].map((id,i)=>({id,material:i?'bronze':'paint',
    corners:[[.25,.75],[.5,.75],[.5,.5],[.25,.5]].map((uv,j)=>({
      id:id+'/'+j,vertex:'v'+(i*4+j),uv:[j%2,Number(j<2)],attributes:{'uv/1':uv}
    }))}));
  const doc = T.create({id:'tiles',vertices,faces,uvBindings:{pigment:1},uvPivots:{1:[.5,.5]}});
  const scene = {id:'workbench',style:'slate',solids:[],tilesetDefaults:{tileSize:{width:4,height:2,paddingX:1}},
    tilesets:{
      blue:ink.createBlankTileset({width:33,height:17,background:'#739592'}),
      bronze:{...ink.createBlankTileset({width:17,height:9,background:'#aa8a65'}),tileSize:{width:3,height:2,paddingY:1}}
    },topologyMeshes:{tiles:{document:doc,materials:[
      {id:'paint',texture:{tileset:'blue'}},{id:'bronze',texture:{tileset:'bronze'}}
    ]}}};
  return {doc,scene};
}

test('whole and fractional steps use each face material’s atlas and preserve its UV pivot',()=>{
  const {doc,scene} = fixture(), editor = ink.createSceneEditor(scene), before = editor.snapshot();
  const selection = editor.selectMeshUV('tiles',{domain:'islands',uvSet:'pigment',ids:['left','right']});
  const request = {uvSet:'pigment',revision:T.revision(doc),operations:[{op:'nudge',selection,steps:[1,-1]}]};
  const pixels = editor.planMeshUV('tiles',request);
  ready(pixels);
  assert.deepEqual(shifts(pixels).map(row=>row.texels),[[1,-1],[1,-1]]);
  assert.deepEqual(shifts(pixels).map(row=>row.uv),[[1/32,-1/16],[1/16,-1/8]]);
  for (const row of pixels.report.corners) {
    const isLeft = row.face==='left', spans = isLeft ? [32,16] : [16,8];
    close(row.after.map((n,i)=>(n-row.before[i])*spans[i]),[1,-1]);
  }
  const half = editor.planMeshUV('tiles',{...request,operations:[nudge({steps:[2,-1],increment:[.25,.5]})]});
  ready(half);
  assert.deepEqual(shifts(half).map(row=>row.texels),[[.5,-.5],[.5,-.5]]);
  assert.deepEqual(half.document.uvPivots,doc.uvPivots);
  assert.deepEqual(half.document.faces.map(face=>face.corners.map(corner=>corner.uv)),
    doc.faces.map(face=>face.corners.map(corner=>corner.uv)));
  assert.deepEqual(editor.snapshot(),before);
});

test('tile strides include padding and respect a sheet’s grid override with one undo',()=>{
  const {doc,scene} = fixture(), editor = ink.createSceneEditor(scene);
  const request = {uvSet:'pigment',revision:T.revision(doc),operations:[nudge({increment:'tile'})]};
  const preview = editor.planMeshUV('tiles',request);
  ready(preview);
  assert.deepEqual(shifts(preview).map(row=>[row.tileset,row.gridSource,row.texels]),[
    ['blue','default',[5,-2]],['bronze','override',[3,-3]]
  ]);
  assert.deepEqual(shifted(preview,'left/0'),[.25+5/32,.75-2/16]);
  assert.deepEqual(shifted(preview,'right/0'),[.25+3/16,.75-3/8]);
  assert.deepEqual(editor.editMeshUV('tiles',request).uv,preview.report);
  const after = editor.snapshot();
  assert(editor.undo());
  assert.deepEqual(editor.snapshot(),scene);
  assert(editor.redo());
  assert.deepEqual(editor.snapshot(),after);
});

const shifted = (plan,id)=>plan.report.corners.find(row=>row.id===id).after;

test('standalone requests declare source dimensions, and corner nudges keep explicit scope and protections',()=>{
  const {doc} = fixture(), fields = {uvSet:'pigment'};
  const plan = operation=>UV.plan(doc,{...fields,operations:[operation]});
  assert.throws(()=>plan(nudge()),/source atlas dimensions/);
  assert.throws(()=>plan(nudge({atlas:[33,17],increment:'tile'})),/declared tile grid/);
  assert.throws(()=>plan(nudge({atlas:[1,9]})),/one-texel axis/);
  const vertical = plan(nudge({atlas:[1,9],steps:[0,-1],increment:.125}));
  ready(vertical);
  assert.deepEqual(shifts(vertical).map(row=>row.uv),[[0,-.015625],[0,-.015625]]);
  const explicit = plan(nudge({atlas:[33,17],ids:['left'],increment:'tile',
    tileSize:{width:3,height:1,paddingX:2}}));
  ready(explicit);
  assert.deepEqual(shifts(explicit)[0].texels,[5,-1]);
  assert.equal(shifts(explicit)[0].gridSource,'explicit');

  const pick = UV.select(doc,{domain:'corners',uvSet:'pigment',ids:['left/0']});
  const corner = {op:'nudge',selection:pick,scope:'together',atlas:[33,17],steps:[1,0]};
  const scoped = plan(corner);
  ready(scoped);
  assert.deepEqual(scoped.report.operations[0].evidence.moving.map(row=>row.id),['left/0']);
  assert.deepEqual(shifted(scoped,'left/0'),[.25+1/32,.75]);
  assert.throws(()=>plan({...corner,scope:undefined}),/scoped corners/);
  const pinned = UV.plan(doc,{...fields,operations:[{op:'pin',ids:['left/0'],pinned:true}]}).document;
  const blocked = UV.plan(pinned,{...fields,operations:[nudge({atlas:[33,17]})]});
  assert(!blocked.report.canCommit);
  assert(blocked.report.operations[0].conflicts.some(row=>row.code==='pinned-corner'));
  assert.deepEqual(blocked.document,pinned);
  const outside = plan(nudge({atlas:[33,17],steps:[128,0]}));
  assert(!outside.report.canCommit);
  assert(outside.report.operations[0].conflicts.some(row=>row.code==='outside-atlas'));
  assert.deepEqual(outside.patch,{});
});

test('an independent edge nudge uses the saved side and together scope reaches the stacked corners',()=>{
  const kit = ink.load(), base = require('../examples/mesh-uv-workshop.cjs').fixture(kit), edge = base.seam('right-wing');
  const doc = UV.plan(base.doc,{operations:[{op:'cut',ids:[edge]}]}).document;
  const selection = UV.select(doc,{domain:'edges',atlas:{at:[.64,.42],face:'faceplate'}});
  const operation = {op:'nudge',selection,atlas:[100,80],steps:[1,0],increment:.25};
  const independent = UV.plan(doc,{operations:[{...operation,scope:'independent'}]});
  ready(independent);
  assert(independent.report.corners.every(row=>row.face==='faceplate'));
  assert.deepEqual(independent.report.corners.map(row=>row.id).sort(),selection.corners);
  const together = UV.plan(doc,{operations:[{...operation,scope:'together'}]});
  ready(together);
  assert.deepEqual([...new Set(together.report.corners.map(row=>row.face))],['faceplate','right-wing']);
  assert.deepEqual(together.report.seams,[]);
});
