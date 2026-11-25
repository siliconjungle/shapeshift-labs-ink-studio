const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const ink = require('..');
const PNG = require('../cli/png.js');
const { readGlb } = require('../cli/glb-file.js');
const demo = require('../examples/material-channel-uvs.cjs');

const kit = ink.load(), K = kit.KIT, topology = K.meshTopology, UV = topology.uv;

test('editing a material layout scopes its selection, pins and scene invalidations', () => {
  const { document } = demo.fixture(kit);
  const layout = UV.inspect(document,'decal');
  assert.equal(layout.uvSet,2);
  const selection=UV.select(document,{domain:'islands',ids:['faceplate'],uvSet:'decal'});
  assert.equal(selection.uvSet,2);
  assert.throws(()=>UV.plan(document,{uvSet:'pigment',operations:[{op:'transform',selection,scale:.8}]}),/UV selection from this mesh revision/);

  const scene = require('../examples/mesh-topology-transaction.cjs').fixture().scene;
  const original = scene.topologyMeshes.relay.document;
  const scoped = topology.edit(original,{uvBindings:{decal:2},faces:original.faces.map(face=>({
    ...face,corners:face.corners.map(corner=>({...corner,attributes:{...corner.attributes,'uv/2':corner.uv}}))
  }))});
  scene.topologyMeshes.relay.document = scoped;
  const editor = ink.createSceneEditor(scene);
  const before=editor.snapshot().topologyMeshes.relay;
  const moved=editor.editMeshUV('relay',{uvSet:'decal',operations:[
    {op:'transform',ids:['cover'],scale:.85},{op:'pin',ids:['cover/cap'],pinned:true}
  ]});
  assert.equal(moved.topology.bakes.length,0);
  const after=editor.snapshot().topologyMeshes.relay;
  assert.deepEqual(after.bakes,before.bakes);
  assert.deepEqual(UV.inspect(after.document,'pigment').corners,UV.inspect(before.document,'pigment').corners);
  assert(UV.inspect(after.document,'decal').corners.find(row=>row.id==='cover/cap').pinned);
  assert(editor.undo());
  assert.deepEqual(editor.snapshot().topologyMeshes.relay.document,before.document);

  const mesh=topology.toSceneMesh(document);
  const first=K.sceneMeshes.channelUV(mesh,0,[1,0,0],'pigment');
  assert.notDeepEqual(K.sceneMeshes.channelUV(mesh,0,[1,0,0],'decal'),first);
  assert(K.sceneMeshes.clipUV(mesh,{...demo.lettering,uvSet:'decal'}).triangles.length>0);
  assert.throws(()=>UV.plan(document,{bindings:{pigment:7}}),/bound UV layout needs authored coordinates/);
});

test('rebaking a moved decal layout keeps original map and mip hashes and round-trips all channel selectors',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ink-material-uvs-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const source=demo.fixture(kit), before=path.join(root,'before'), after=path.join(root,'after');
  const first=demo.bake(source,before), edit=UV.plan(source.document,demo.edit);
  assert(edit.report.canCommit);
  const second=demo.bake({...source,document:edit.document},after,{rebakeFrom:path.join(before,'material-bake.json')});
  assert.deepEqual(second.uvBindings,demo.bindings);
  assert.equal(second.maps.pigment.texCoord,0);
  assert.equal(second.maps.normal.texCoord,1);
  assert.equal(second.maps.roughness.texCoord,1);
  assert.equal(second.masks.wear.texCoord,3);
  for (const set of [0,1,3]) {
    const old=first.uvAtlases[set], current=second.uvAtlases[set];
    assert.equal(current.chartReport.sampledTexels,0);
    assert.deepEqual(current.maps,old.maps);
    assert.deepEqual(current.masks,old.masks);
    assert.deepEqual(current.mipmaps.levels.map(({maps,masks})=>({maps,masks})),
      old.mipmaps.levels.map(({maps,masks})=>({maps,masks})));
  }
  const wear = PNG.raster(path.join(after,second.masks.wear.file));
  assert(wear.data.some((value,i)=>i%4===0&&value>150));
  const glb=path.join(after,'case.glb'), {gltf}=readGlb(fs.readFileSync(glb));
  const [mesh]=gltf.meshes, { attributes, material:slot }=mesh.primitives[0], material=gltf.materials[slot];
  assert.deepEqual(Object.keys(attributes).filter(key=>key.startsWith('TEXCOORD_')),
    ['TEXCOORD_0','TEXCOORD_1','TEXCOORD_2','TEXCOORD_3']);
  assert.equal(material.pbrMetallicRoughness.baseColorTexture.texCoord??0,0);
  assert.equal(material.pbrMetallicRoughness.metallicRoughnessTexture.texCoord,1);
  assert.equal(material.normalTexture.texCoord,1);
  assert.deepEqual(mesh.extras.inkStudioMaterialUV.bindings,demo.bindings);
  const read=ink.readMesh(glb,{allUVSets:true});
  const original=ink.readMesh(path.join(before,'case.glb'),{allUVSets:true});
  for (const set of [0,1,3]) assert.deepEqual(read.uvSets[set],original.uvSets[set]);
  assert.notDeepEqual(read.uvSets[2],original.uvSets[2]);
  assert.deepEqual(read.uvBindings,demo.bindings);
  assert.deepEqual(Object.keys(read.uvSets),['0','1','2','3']);
  const out=path.join(root,'imported.json'), cli=path.resolve(__dirname,'../cli/ink-studio.js');
  execFileSync(process.execPath,[cli,'mesh-uv','import',glb,'--out',out],{encoding:'utf8'});
  const reimport=JSON.parse(fs.readFileSync(out,'utf8'));
  assert.deepEqual(reimport.uvBindings,demo.bindings);
  assert.equal(UV.inspect(reimport,'mask/wear').uvSet,3);

  const maskEdit=UV.plan(edit.document,{uvSet:'mask/wear',operations:[
    {op:'transform',ids:['rear'],translate:[0,.04]}
  ]});
  assert(maskEdit.report.canCommit);
  const third=demo.bake({...source,document:maskEdit.document},path.join(root,'wear'),
    {rebakeFrom:path.join(after,'material-bake.json')});
  assert.deepEqual(third.maps.pigment,second.maps.pigment);
  assert.deepEqual(third.maps.normal,second.maps.normal);
  assert.notEqual(third.masks.wear.sha256,second.masks.wear.sha256);
  assert.equal(third.uvAtlases[3].chartReport.updated.length,1);
});

test('approved camera paint coverage stays on the pigment layout',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ink-material-uv-paint-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const source=demo.fixture(kit), capture=path.join(root,'capture');
  demo.bake(source,capture,{capturePaint:{format:'ink-studio/material-paint-cameras',version:1,
    views:[{id:'front',width:70,height:56,camera:{pitch:0,yaw:0}}]}});
  const plan=path.join(capture,'paint-views','approved.json');
  const {views:[front]}=JSON.parse(fs.readFileSync(plan,'utf8'));
  const rgb=Uint8Array.from({length:front.width*front.height*3},(_,i)=>[218,120,45][i%3]);
  PNG.write(path.join(path.dirname(plan),front.paint),front.width,front.height,rgb);
  const projected=demo.bake(source,path.join(root,'painted'),{paintViews:plan});
  assert.equal(projected.masks['projected-paint'].texCoord,0);
  assert.equal(projected.masks['paint-front'].texCoord,0);
  assert.equal(projected.masks.wear.texCoord,3);
});


test('sparse authored UV set numbers stay stable in a valid GLB',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ink-sparse-uvs-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const {document}=demo.fixture(kit);
  const source=topology.edit(document,{uvBindings:{pigment:3},faces:document.faces.map(face=>({
    ...face,corners:face.corners.map(corner=>({...corner,attributes:{'uv/3':corner.attributes['uv/3']}}))
  }))});
  const glb=path.join(root,'case.glb');
  ink.exportGlb(source,{out:glb,textureSize:256});
  const {gltf}=readGlb(fs.readFileSync(glb)), primitive=gltf.meshes[0].primitives[0];
  assert.equal(primitive.attributes.TEXCOORD_1,primitive.attributes.TEXCOORD_0);
  assert.equal(primitive.attributes.TEXCOORD_2,primitive.attributes.TEXCOORD_0);
  assert.equal(gltf.materials[primitive.material].pbrMetallicRoughness.baseColorTexture.texCoord,3);
  const result=ink.readMesh(glb,{allUVSets:true});
  assert.deepEqual(result.uvBindings,{pigment:3});
  assert.deepEqual(Object.keys(result.uvSets),['0','3']);
});
