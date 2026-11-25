const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const ink = require('..');
const kit=ink.load(), {KIT:K}=kit, P=K.procedural, api=P.sectionMeshes, topology=K.meshTopology;
const ids=rows=>rows.map(row=>row.id);
const square=[[-.65,-.65],[.65,-.65],[.65,.65],[-.65,.65]];
const octagon=Array.from({length:8},(_,i)=>[Math.cos(i*Math.PI/4)*.85,Math.sin(i*Math.PI/4)*.85]);
const strip=()=>K.sweep.mesh([[-2,0,0],[-1,0,0],[0,.45,.15],[1,.55,0],[2,.65,0]],
  {shape:'rect',w:t=>.24+.08*t,h:.14,fold:.14,cup:.10,twist:.13},{
    id:'guide',sides:16,profileCreases:[4],
    sections:['lead','weld','return','tip-base','tip'].map(id=>({id,material:'brass'})),
    attachments:[{id:'west',section:'lead',u:.24},{id:'center',section:'return',u:.34},{id:'east',section:'tip',u:.81}]
  });

function manifold(mesh) {
  const report=topology.inspect(mesh);
  assert(report.edges.every(edge=>edge.uses.length===2 &&
    edge.uses[0].from!==edge.uses[0].to));
  const corner=new Map(mesh.faces.flatMap(face=>face.corners.map(row=>[row.id,row.vertex])));
  for (const {uses:[a,b]} of report.edges) {
    assert.equal(corner.get(a.from),corner.get(b.to));
    assert.equal(corner.get(a.to),corner.get(b.from));
  }
}

test('sweep section edits keep untouched rings, face-corner UVs and anchors stable',()=>{
  const base=strip(), request={revision:base.report.revision,meshRevision:base.report.meshRevision,
    sections:[{id:'return',position:[0,.83,.15],w:.41,roll:.15,material:'ceramic',crease:.75}]};
  const edit=api.plan(base.source,request);
  assert.deepEqual(ids(edit.mesh.vertices),ids(base.mesh.vertices));
  assert.deepEqual(ids(edit.mesh.faces),ids(base.mesh.faces));
  assert.deepEqual(ids(edit.mesh.edges),ids(base.mesh.edges));
  assert.deepEqual(edit.mesh.faces.map(face=>face.corners),base.mesh.faces.map(face=>face.corners));
  assert.equal(edit.report.dirtyFaces.length,32);
  assert.equal(edit.report.changedVertices.length,16);
  assert.equal(edit.report.changedCreases.length,16);
  assert(edit.mesh.edges.filter(row=>row.crease===.75).every(row=>row.smooth===false));
  assert.equal(edit.mesh.faces.filter(face=>face.material==='ceramic').length,16);
  const [west,center,east]=edit.report.attachments;
  assert.equal(west.displacement,0);
  assert(center.displacement>.2);
  assert.equal(east.displacement,0);
  assert.deepEqual(api.compile(JSON.parse(JSON.stringify(edit.source))).mesh,edit.mesh);
  manifold(edit.mesh);
  assert.throws(()=>api.plan(edit.source,request),/source revision changed/);

  const loop=K.sweep.mesh(K.curve.circle([0,0,0],2,16),{w:.2,h:.11,shape:'round'},{sides:8});
  manifold(loop.mesh);
  assert(!loop.mesh.faces.some(row=>row.id.startsWith('cap/')));
  assert(loop.mesh.edges.some(row=>row.uvSeam));
});

test('loft compilation retains profile corners, painted UVs and native scene bindings on a local edit',()=>{
  const base=P.forms.loft.mesh([
    {id:'before',y:0,profile:square},{id:'change',y:.9,profile:octagon,crease:.6},
    {id:'after',y:2,profile:square}
  ],{id:'holder',pose:{position:[1,2,3],scale:[1,1,-1]}, attachments:[
    {id:'pin',section:'before',u:0},{id:'dial',section:'change',u:.125}]});
  assert.equal(base.report.columns,8);
  assert.deepEqual(base.report.attachments[0].p,[.35,2,3.65]);
  manifold(base.mesh);
  const oldFace=base.mesh.faces.find(row=>row.id==='band/change/0/a');
  const altered={...oldFace,corners:oldFace.corners.map((row,i)=>i===0 ? {...row,uv:[.08,.7],uvPinned:true}:row)};
  const vertex=base.mesh.vertices.find(row=>row.id==='ring/change/0');
  const authored=topology.edit(base.mesh,{faces:[altered],vertices:[{id:vertex.id,position:K.V.add(vertex.position,[0,.07,0])}]});
  const edit=api.plan(base.source,{meshRevision:topology.revision(authored),sections:[{id:'change',scale:1.18,material:'trim',crease:0}]},{mesh:authored});
  assert.equal(edit.mesh.faces.find(row=>row.id===oldFace.id).material,'trim');
  assert.deepEqual(edit.mesh.faces.find(row=>row.id===oldFace.id).corners,authored.faces.find(row=>row.id===oldFace.id).corners);
  assert.equal(edit.mesh.vertices.find(row=>row.id===vertex.id).position[1],vertex.position[1]+.07);
  const editor=ink.createSceneEditor({id:'test-section-mesh',solids:[],topologyMeshes:{holder:{document:authored,
    bindings:[{id:'socket',domain:'corners',element:base.mesh.faces.find(row=>row.id==='cap/before').corners[0].id}]}}});
  const before=editor.build().topologyMeshes.holder.resolvedBindings.socket;
  editor.editMeshTopology('holder',edit.patch);
  assert.deepEqual(editor.snapshot().topologyMeshes.holder.document,edit.mesh);
  assert.deepEqual(editor.build().topologyMeshes.holder.resolvedBindings.socket,before);
  assert(editor.undo());
  assert.deepEqual(editor.snapshot().topologyMeshes.holder.document,authored);
});

test('revolve supports welded axis poles and nested meridians with persistent bands',()=>{
  const sculpt=K.sculpt(kit.makeSculpt(kit.makeBuilder(1,[0xffffff])));
  const outline=[[[0,-1],[1,-1],[1,.15],[.75,1],[0,1]],[[.26,-.35],[.58,-.35],[.58,.3],[.26,.3]]];
  const base=sculpt.revolve.mesh(outline,[.2,.4,.1],{id:'valve',sides:16,sections:[
    ['bottom','skirt','shoulder','top','pole'].map(id=>({id,crease:.45})),
    ['hole-a','hole-b','hole-c','hole-d'].map(id=>({id,material:'lining'}))
  ],attachments:[{id:'station',section:'skirt',u:1},{id:'tip',section:'pole',u:.7}]});
  assert.equal(base.mesh.vertices.length,7*16+2);
  assert.equal(base.mesh.faces.filter(row=>row.material==='lining').length,4*16);
  const pole=base.report.attachments[1];
  assert.deepEqual(pole.vertices,['ring/pole/0']);
  assert.deepEqual(pole.p,[.2,1.4,.1]);
  manifold(base.mesh);
  const revised=api.plan(base.source,{sections:[{id:'shoulder',radius:1.25,y:.25}]});
  assert(revised.report.attachments.every(row=>row.displacement===0));
  assert.deepEqual(api.compile(JSON.parse(JSON.stringify(revised.source))).mesh,revised.mesh);
  assert.throws(()=>api.plan(base.source,{sections:[{id:'pole',radius:.2}]}),/retain axis poles/);
  assert.throws(()=>api.plan(base.source,{sections:[{id:'hole-a',radius:1.2}]}),/cross or touch/);
});

test('mesh topology CLI compiles, previews and commits a reproducible local patch',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ink-section-mesh-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const asset=name=>path.join(root,name+'.json'), read=name=>JSON.parse(fs.readFileSync(asset(name),'utf8'));
  const save=(name,value)=>fs.writeFileSync(asset(name),JSON.stringify(value));
  const run=(...args)=>execFileSync(process.execPath,[path.resolve(__dirname,'../cli/ink-studio.js'),'mesh-topology','sections',...args],{encoding:'utf8'});
  const base=strip(), request={revision:base.report.revision,sections:[{id:'return',w:.5}]};
  save('source',base.source); save('edit',request);
  run('compile',asset('source'),'--out',asset('compiled'));
  assert.deepEqual(read('compiled'),base.mesh);
  const preview=JSON.parse(run('edit',asset('source'),asset('edit')));
  const result=JSON.parse(run('edit',asset('source'),asset('edit'),'--mesh',asset('compiled'),
    '--out',asset('committed'),'--out-mesh',asset('mesh'),'--out-patch',asset('patch')));
  assert.deepEqual(result,preview);
  assert.deepEqual(topology.edit(base.mesh,read('patch')),read('mesh'));
  assert.deepEqual(api.compile(read('committed')).mesh,read('mesh'));
});

test('WebGL can replay a section edit carrying the Node mesh revision', {skip:!process.env.INK_TEST_CHROME},()=>{
  const fixtures=require('../examples/section-meshes.cjs').fixtures(K);
  const cases=fixtures.map(({fixture:{source,report},edit})=>({source,request:{
    revision:report.revision,meshRevision:report.meshRevision,sections:[edit]
  }}));
  const runWebGL=require('../cli/look-webgl.js');
  const result=runWebGL({asyncFixture:true},function build({KIT,makeBuilder},mesh) {
    const colors={lip:0x294c5a,enamel:0x438985,brass:0xc09058,ceramic:0xb87e60};
    const materials=[...new Set(mesh.faces.map(row=>row.material))].map(id=>({id,color:colors[id]}));
    const part=KIT.meshTopology.toSceneMesh(mesh,{materials});
    return makeBuilder(31,[0x112130]).finish({meshes:[part],
      cam:{target:[0,0,0],dist:5,yaw:.12,pitch:.22,ortho:true},radius:4,dither:0});
  },(kit,build,backend,input)=>{
    const api=kit.KIT.procedural.sectionMeshes;
    const view=backend(117,85,{raw:true,outline:false,dither:0});
    try {
      return {parts:input.map(({source,request})=>{
        const before=api.compile(source), after=api.plan(source,request);
        const images=[before,after].map(({mesh})=>{
          view.draw(build(kit,mesh),{t:0});
          return view.image();
        });
        return {revision:after.report.meshRevision, images, drift:after.report.attachments.map(row=>row.displacement)};
      })};
    } finally { view.close(); }
  },cases);
  for (const [i,{revision,images:[a,b],drift}] of result.parts.entries()) {
    assert.equal(revision,api.plan(cases[i].source,cases[i].request).report.meshRevision);
    assert.deepEqual(drift,[0,0]);
    assert.notEqual(a,b);
  }
});
