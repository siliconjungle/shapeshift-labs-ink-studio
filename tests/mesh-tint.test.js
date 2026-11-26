'use strict';

const assert = require('node:assert/strict');
const {execFileSync,spawnSync} = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {test} = require('node:test');
const ink = require('..'), K = ink.load().KIT, T = K.meshTopology;
const PNG = require('../cli/png.js'), cli = path.resolve(__dirname,'../cli/ink-studio.js');

function fixture() {
  const vertices = [[-1.6,0,0],[0,0,0],[1.6,0,0],[-1.6,1.4,0],[0,1.4,0],[1.6,1.4,0]]
    .map((position,i)=>({id:'v'+i,position}));
  const faces = [['west',[0,1,4,3]],['east',[1,2,5,4]]].map(([id,verts])=>({id,material:'tile',
    corners:verts.map((n,i)=>({id:id+'/'+i,vertex:'v'+n,uv:[[0,1],[1,1],[1,0],[0,0]][i],
      attributes:{'uv/1':[[0,1],[1,1],[1,0],[0,0]][i],stamp:2}}))}));
  return {id:'painted-wing',vertices,faces};
}

const plain = T.create(fixture());
const warm = [.9,.42,.33], cool = [.32,.65,.92];
const plan = (doc,request)=>T.planTint(doc,request);
const tint = (doc,corner)=>doc.faces.flatMap(face=>face.corners).find(row=>row.id===corner)?.attributes?.tint;
const view = {w:100,h:64,px:1,raw:true};

function scene() {
  const tileset = ink.createBlankTileset({width:3,height:3,background:'#dce7ce'});
  const data = Buffer.from(tileset.data,'base64');
  data[4*4+3] = 0;
  const rev = T.revision(plain);
  return {id:'tint-workshop',style:'slate',solids:[],camera:{target:[0,.7,0],dist:5,yaw:0,pitch:0,projection:'orthographic'},
    tilesets:{paint:{...tileset,data:data.toString('base64')}},
    topologyMeshes:{wing:{part:'panel',document:plain,materials:[{id:'tile',texture:{tileset:'paint'}}],
      bindings:[{id:'corner',domain:'corners',element:'west/1'}],
      bakes:[{id:'finish',material:'tile',maps:{roughness:.45}}],
      shapeKeys:{format:'ink-studio/mesh-shape-keys',version:1,mesh:plain.id,restRevision:rev,keys:[]},
      attachments:T.attachments.create(plain,[])}}};
}

test('paint a single seam corner, expand a vertex to incident corners, and sample and clear exact authored values',()=>{
  const one = plan(plain,{tool:'paint',corner:'west/1',color:warm});
  assert.equal(one.report.changedCorners,1);
  assert.deepEqual(tint(one.document,'west/1'),warm);
  assert.equal(tint(one.document,'east/0'),undefined);
  assert.deepEqual(one.document.faces[0].corners[1].attributes['uv/1'],[1,1]);
  assert.deepEqual(T.uv.select(one.document,{domain:'faces',tint:{color:warm}}).faces,['west']);
  const vertex = plan(one.document,{tool:'paint',vertex:'v4',color:cool});
  assert.deepEqual(vertex.report.changes.map(row=>row.corner),['west/2','east/3']);
  const sample = plan(vertex.document,{tool:'eyedropper',vertex:'v4'});
  assert.deepEqual(sample.report.samples.map(row=>row.color),[cool,cool]);
  assert.equal(sample.document,vertex.document);
  const cleared = plan(vertex.document,{tool:'erase',corner:'west/2'});
  const read = plan(cleared.document,{tool:'eyedropper',corner:'west/2'}).report.samples[0];
  assert.deepEqual(read,{face:'west',corner:'west/2',vertex:'v4',tint:null,color:[1,1,1]});
  assert.deepEqual(tint(cleared.document,'east/3'),cool);
  assert.equal(plan(cleared.document,{tool:'erase',corner:'west/2'}).report.changedCorners,0);
  assert.throws(()=>plan(plain,{tool:'paint',color:[2,0,0],face:'west'}),/normalized RGB/);

  const split = T.subdivide(one.document);
  assert(split.faces.some(face=>face.corners.some(corner=>corner.attributes?.tint?.[1]===.71)));
  assert.deepEqual(T.triangulate(plain).indices,T.triangulate(one.document).indices);

  const legacy = T.edit(plain,{faces:[{...plain.faces[0],corners:plain.faces[0].corners.map(row=>
    ({...row,attributes:{...row.attributes,tint:[.2,.3]}}))}]});
  assert.throws(()=>plan(legacy,{tool:'paint',face:'west',color:warm}),/generic attribute/);
  assert.equal(plan(legacy,{tool:'erase',face:'west'}).document,legacy);
});

test('accept saved UV-corner and component selections and keep scene attachments, bakes, coverage and atlas registered',()=>{
  const original = scene(), editor = ink.createSceneEditor(original);
  const before = ink.render(editor.build(),{...view,passes:['depth']});
  const selection = T.select(plain,{domain:'faces',ids:['east']});
  const operation = {tool:'paint',selection,color:'#7bd6ff'};
  const review = editor.planMeshTint('wing',operation,{part:'panel'});
  assert.equal(review.report.changedCorners,4);
  assert.deepEqual(editor.editMeshTint('wing',operation,{part:'panel'}),review.report);
  const after = editor.snapshot();
  assert.deepEqual(after.tilesets,original.tilesets);
  for (const key of ['materials','bindings','bakes']) assert.deepEqual(after.topologyMeshes.wing[key],original.topologyMeshes.wing[key]);
  assert.equal(after.topologyMeshes.wing.attachments.revision,review.report.afterRevision);
  assert.equal(after.topologyMeshes.wing.shapeKeys.restRevision,review.report.afterRevision);
  const painted = ink.render(editor.build(),{...view,passes:['depth']});
  assert.notDeepEqual(before.rgb,painted.rgb);
  assert.deepEqual(before.passes.depth,painted.passes.depth);
  assert.throws(()=>editor.planMeshTint('wing',operation),/topology revision/);
  const corners = T.uv.select(review.document,{domain:'corners',ids:['east/1','east/3']});
  const erase = editor.editMeshTint('wing',{tool:'erase',selection:corners},{part:'panel'});
  assert.deepEqual(erase.changes.map(row=>row.corner),['east/1','east/3']);
  assert(editor.undo());
  assert.deepEqual(editor.snapshot(),after);
  assert(editor.undo());
  assert.deepEqual(editor.snapshot(),original);
  assert(editor.redo());
  assert.deepEqual(editor.snapshot(),after);
});

test('preview and commit tint with exact native PNGs and reject a stale CLI receipt',t=>{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'ink-mesh-tint-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const at = file=>path.join(dir,file);
  const save = (file,value)=>fs.writeFileSync(at(file),JSON.stringify(value));
  const base = ['mesh-topology','tint','source.json','request.json','--object','wing','--part','panel'];
  const invoke = (...args)=>JSON.parse(execFileSync(process.execPath,[cli,...base,...args],{cwd:dir,encoding:'utf8'}));
  save('source.json',scene());
  save('request.json',{tool:'paint',color:'#ff8762'});
  save('corners.json',T.uv.select(plain,{domain:'corners',ids:['west/0']}));
  const preview = invoke('--selection','corners.json','--preview','review');
  assert.equal(preview.changedCorners,1);
  assert(preview.native.changedPixels>0);
  const [before,after,diff] = preview.native.files.map(file=>PNG.raster(at('review/'+file)));
  assert.notDeepEqual(before.data,after.data);
  assert.equal(diff.data.filter((value,i)=>i%4===0 && value===250).length,preview.native.changedPixels);
  save('receipt.json',preview);
  assert.deepEqual(invoke('--selection','corners.json','--expect','receipt.json','--out','painted.json').changes,preview.changes);
  save('request.json',{tool:'erase',corner:'west/0'});
  const stale=spawnSync(process.execPath,[cli,...base,'--expect','receipt.json','--out','stale.json'],{cwd:dir,encoding:'utf8'});
  assert.equal(stale.status,1);
  assert.equal(JSON.parse(stale.stdout).conflicts[0].code,'stale-preview');
  assert(!fs.existsSync(at('stale.json')));
});

test('WebGL uploads a tinted face between untinted draws and interpolates a single corner', {skip:!process.env.INK_TEST_CHROME},()=>{
  const result = require('../cli/look-webgl.js')({},fixture,(kit,mesh,backend)=>{
    const api = kit.KIT.meshTopology, doc=api.create(mesh());
    const world = source=>kit.makeBuilder(19,[0x112233]).finish({meshes:[api.toSceneMesh(source,{
      materials:[{id:'tile',color:0xdce7ce}]} )],radius:5,dither:0,cam:{target:[0,.7,0],dist:5,yaw:0,pitch:0,ortho:true}});
    const original=world(doc), tinted=world(api.planTint(doc,{tool:'paint',corner:'west/0',color:[1,.15,.12]}).document);
    const renderer=backend(100,64,{raw:true,dither:0}), coords={inside:[34,41],higher:[34,23],neighbor:[64,36]};
    try {
      const draw = scene=>{renderer.draw(scene); return renderer.sample(coords);};
      return {before:draw(original),after:draw(tinted),reset:draw(original)};
    } finally { renderer.close(); }
  });
  assert.deepEqual(result.before,result.reset);
  assert.deepEqual(result.before.neighbor,result.after.neighbor);
  assert(result.before.inside[1]>result.after.inside[1]+25,JSON.stringify(result));
  assert(result.after.higher[1]>result.after.inside[1]+15,JSON.stringify(result));
});
