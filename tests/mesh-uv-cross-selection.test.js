'use strict';

const assert = require('node:assert/strict');
const {test} = require('node:test');
const ink = require('..'), kit = ink.load(), T = kit.KIT.meshTopology, UV = T.uv;
const {fixture} = require('../examples/mesh-uv-workshop.cjs');
const {capture} = require('../cli/mesh-uv-editor.js');

function caseMesh() {
  const base = fixture(kit), edge = base.seam('right-wing');
  const doc = UV.plan(base.doc,{operations:[{op:'cut',ids:[edge]}]}).document;
  return {...base,doc,edge};
}
const midpoint = (a,b)=>a.map((n,i)=>(n+b[i])*.5);

test('a coincident cut needs a face side and saved UV picks keep that side',()=>{
  const {doc,edge} = caseMesh(), shared = UV.inspect(doc).edges.find(row=>row.id===edge);
  const at = midpoint(...shared.sides[0].uv);
  const hit = face=>UV.select(doc,{domain:'edges',atlas:{at,...(face && {face})}});
  const ambiguous = hit();
  assert.equal(ambiguous.hit.status,'ambiguous');
  assert.deepEqual(ambiguous.hit.candidateSides,[{edge,face:'faceplate'},{edge,face:'right-wing'}]);
  assert.deepEqual(ambiguous.ids,[]);
  const pick = hit('right-wing'), opposite = hit('faceplate');
  assert.deepEqual(pick.ids,opposite.ids);
  assert.deepEqual(pick.vertices,opposite.vertices);
  assert.deepEqual(pick.faces,['right-wing']);
  assert(pick.corners.every(id=>id.startsWith('right-wing/')));
  assert.deepEqual(pick.edgeSides,[{edge,face:'right-wing',corners:shared.sides[1].corners}]);
  assert.deepEqual(UV.select(doc,{domain:'edges',from:JSON.parse(JSON.stringify(pick))}),pick);
  assert.throws(()=>UV.select(doc,{domain:'edges',from:{...pick,edgeSides:[{edge,face:'rear'}]}}),/face sides/);
  assert.deepEqual(UV.select(doc,{domain:'edges',ids:[edge]}).faces,['faceplate','right-wing']);
  const native = UV.toTopologySelection(doc,pick);
  assert.deepEqual(native,T.select(doc,{domain:'edges',ids:[edge]}));
  assert.deepEqual(UV.select(doc,{domain:'edges',topology:{selection:native,face:'right-wing'}}).edgeSides,pick.edgeSides);
});

test('corner, edge, face and connected chart agree when picked from model pixels and the atlas',()=>{
  const {doc,view,edge} = caseMesh(), layout = UV.inspect(doc);
  const native = capture(doc,{...view,t:0,raw:true},kit);
  const {faces,faceAt} = UV.modelFaces(native.mesh,native.frame), owner = faces.indexOf('faceplate');
  let seam;
  for (const [i,value] of faceAt.entries()) if (value===owner) {
    const pick = UV.pickModel(native.mesh,native.frame,[i%view.w,Math.floor(i/view.w)],'edges');
    if (pick.ids[0]===edge) { seam=pick; break; }
  }
  assert(seam);
  const pixel = seam.hit.pixel, side = layout.edges.find(row=>row.id===edge).sides[0];
  for (const domain of ['corners','edges','faces','islands']) {
    const model = UV.pickModel(native.mesh,native.frame,pixel,domain), [id] = model.ids;
    const at = domain === 'edges' ? midpoint(...side.uv) :
      domain === 'corners' ? layout.corners.find(row=>row.id===id).uv : model.hit.uv;
    const atlas = UV.select(doc,{domain,atlas:{at,face:'faceplate'}});
    assert.deepEqual(atlas.ids,model.ids);
    assert.deepEqual(atlas.corners,model.corners);
    assert.deepEqual(atlas.vertices,model.vertices);
    assert.deepEqual(atlas.edgeSides,model.edgeSides);
    const topology = UV.toTopologySelection(doc,atlas);
    const scope = domain==='corners' || domain==='edges' ? {face:'faceplate'} : {};
    assert.deepEqual(UV.select(doc,{domain,topology:{selection:topology,...scope}}).ids,atlas.ids);
  }
  assert.equal(UV.pickModel(native.mesh,native.frame,[0,0],'corners').hit.status,'miss');
});

test('source-texel picks use the bound scene atlas and keep single-texel axes selectable',()=>{
  const {doc,view} = caseMesh();
  const scene = {id:'field',solids:[],topologyMeshes:{box:{document:doc,materials:view.materials}}};
  const editor = ink.createSceneEditor(scene);
  const corner = editor.inspectMeshUV('box',{uvSet:'pigment'}).corners.find(row=>row.id==='faceplate/frt');
  const request = {domain:'corners',uvSet:'pigment',atlas:{texel:corner.texel,face:corner.face,radius:0}};
  const selected = editor.selectMeshUV('box',request);
  assert.deepEqual(selected.ids,[corner.id]);
  assert.deepEqual(selected.vertices,[corner.vertex]);
  assert.deepEqual(selected.hit.size,[100,80]);
  assert.throws(()=>UV.select(doc,request),/atlas dimensions/);
  assert.deepEqual(UV.select(doc,{...request,atlas:{...request.atlas,size:[100,80]}}),selected);
  const native = UV.toTopologySelection(doc,selected);
  const all = UV.select(doc,{domain:'corners',topology:{selection:native}});
  assert(all.ids.includes('right-wing/frt'));
  assert.deepEqual(UV.select(doc,{domain:'corners',topology:{selection:native,face:'faceplate'}}).ids,selected.ids);
  const collapsed = UV.select(doc,{domain:'faces',atlas:{texel:[0,0],size:[1,1],face:'faceplate'}});
  assert.deepEqual(collapsed.ids,['faceplate']);
  const revised = T.edit(doc,{vertices:[{id:'flb',position:[-1.4,-.81,.51]}]});
  assert.throws(()=>UV.select(revised,{domain:'corners',topology:{selection:native}}),/same topology revision/);
});
