const test=require('node:test'), assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {execFileSync}=require('node:child_process');
const {inspectSceneResource,convertSceneResource}=require('..');
const {document}=require('../cli/glb-file.js');
const PNG=require('../cli/png.js');
const python=process.env.INK_TEST_SCENE_PYTHON;
const blender=process.env.INK_TEST_SCENE_BLENDER;

function dir(t) {
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'ink-scene-resources-'));
  t.after(()=>fs.rmSync(folder,{recursive:true,force:true}));
  return name=>path.join(folder,name);
}
function fixture(filename,missing=false) {
  const out=document(), d=out.gltf, a=(values,type)=>out.accessor(Float32Array.from(values),type,{bounds:type==='VEC3'});
  const p=a([0,0,0, 1,0,0, 0,1,0],'VEC3'), n=a([0,0,1, 0,0,1, 0,0,1],'VEC3');
  const uv0=a([0,0, 1,0, 0,1],'VEC2'), uv1=a([.17,.30, .67,.83, .33,.94],'VEC2');
  const i=out.texture(PNG.encode(1,1,Uint8Array.of(242,91,47,243),4),'Glass glaze');
  const finish=out.texture(PNG.encode(1,1,Uint8Array.of(215,115,163,255),4),'Packed finish');
  Object.assign(d,{
    nodes:[{name:'Housing',translation:[1,2,3],children:[1,2]},{name:'Panel',scale:[1.2,.75,1.1],mesh:0},
      {name:'Mount marker',translation:[0,.5,.5]}],
    materials:[
      {name:'Glaze',alphaMode:'MASK',alphaCutoff:.61,doubleSided:true,
        pbrMetallicRoughness:{baseColorTexture:{index:i,texCoord:1},baseColorFactor:[.81,.89,.6,.92],metallicFactor:.2,roughnessFactor:.44,
          metallicRoughnessTexture:{index:finish}}},
      {name:'Sand',pbrMetallicRoughness:{metallicFactor:0,roughnessFactor:.66}},
      {name:'Reserve',pbrMetallicRoughness:{metallicFactor:.4,roughnessFactor:.3}}
    ],
    meshes:[{name:'Mesh groups',primitives:[
      {material:0,attributes:{POSITION:p,NORMAL:n,TEXCOORD_0:uv0,...(!missing&&{TEXCOORD_1:uv1})}},
      {material:1,attributes:{POSITION:p}}
    ]}]
  });
  d.scenes[0]={name:'Fixture',nodes:[0]};
  fs.writeFileSync(filename,out.finish());
  return filename;
}

test('scene resource validation relates each material map to the UV set on its mesh group', t=>{
  const at=dir(t), model=fixture(at('source.glb'));
  const report=inspectSceneResource(model);
  assert.equal(report.name,'Fixture');
  assert.deepEqual(report.groups.map(n=>n.name),['Housing','Panel','Mount marker']);
  assert.deepEqual(report.groups[1].parts.map(p=>p.uvSets),[[0,1],[]]);
  assert.equal(report.materials[0].maps.base.uv,1);
  assert.equal(report.materials[0].maps.opacity.channel,'a');
  assert.equal(report.materials[0].maps.roughness.sha256,report.materials[0].maps.metallic.sha256);
  assert.equal(report.uniqueTextures,2);
  const copy=convertSceneResource(model,{out:at('copy.gltf')});
  assert(Object.values(copy.roundTrip).every(Boolean));
  assert.throws(()=>inspectSceneResource(fixture(at('bad.glb'),true)),/missing TEXCOORD_1.*base/);
  assert.throws(()=>convertSceneResource(model,{out:model}),/different scene output/);
});

test('OpenUSD, USDZ and MaterialX round-trip transforms, slots and texture bindings', {skip:!python}, t=>{
  const at=dir(t), model=fixture(at('source.glb')), convert=(file,name,extra={})=>
    convertSceneResource(file,{out:at(name),python,...extra});
  const stage=convert(model,'source.usda');
  assert(Object.values(stage.roundTrip).every(Boolean));
  assert.equal(stage.output.materials.length,3);
  assert.equal(stage.output.groups[2].name,'Mount marker');
  assert.match(fs.readFileSync(stage.file,'utf8'),/materialBind/);
  assert.match(fs.readFileSync(stage.file,'utf8'),/primvars:st1/);
  const xml=convert(stage.file,'look.mtlx');
  const text=fs.readFileSync(xml.file,'utf8');
  assert.match(text,/<standard_surface/);
  assert.match(text,/<texcoord/);
  assert.equal(xml.output.materials[0].maps.base.sha256,stage.source.materials[0].maps.base.sha256);
  const package=convert(stage.file,'package.usdz');
  assert(Object.values(package.roundTrip).every(Boolean));
  const output=convert(package.file,'reopen.glb',{materialx:xml.file});
  assert(Object.values(output.roundTrip).every(Boolean));
  assert.equal(output.output.groups[1].parts[1].normal,false);
  assert.equal(output.output.materials[0].alphaMode,'MASK');
  assert(Math.abs(output.output.materials[0].cutoff-.61)<1e-5);
  assert.deepEqual(output.output.groups[1].parts.map(p=>p.uvSets),[[0,1],[]]);

  const cli=path.resolve(__dirname,'../cli/ink-studio.js');
  const check=JSON.parse(execFileSync(process.execPath,[cli,'scene-resource','validate',package.file,'--python',python],
    {encoding:'utf8'}));
  assert.equal(check.passed,true);
});

test('an authored Z-up USD polygon stage converts its units and triangulates its face-varying UV data', {skip:!python}, t=>{
  const at=dir(t), file=at('author.usda');
  fs.writeFileSync(file,`#usda 1.0
(
    defaultPrim = "Console"
    metersPerUnit = 0.01
    upAxis = "Z"
)
def Xform "Console"
{
    double3 xformOp:translate = (10, 20, 100)
    uniform token[] xformOpOrder = ["xformOp:translate"]
    def Mesh "Window"
    {
        uniform token subdivisionScheme = "none"
        point3f[] points = [(0, 0, 0), (4, 0, 0), (4, 3, 0), (2, 1, 0), (0, 3, 0)]
        int[] faceVertexCounts = [5]
        int[] faceVertexIndices = [0, 1, 2, 3, 4]
        texCoord2f[] primvars:st = [(0, 0), (1, 0), (1, 1), (0.5, .3), (0, 1)] (
            interpolation = "faceVarying"
        )
    }
}
`);
  const result=convertSceneResource(file,{out:at('out.glb'),python});
  assert.equal(result.source.sourceSpace.upAxis,'Z');
  assert.equal(result.source.sourceSpace.metersPerUnit,.01);
  assert.equal(result.output.groups[1].parts[0].triangles,3);
  assert.deepEqual(result.output.groups[0].matrix.slice(12,15),[.1,1,-.2]);
  assert(Object.values(result.roundTrip).every(Boolean));
});

test('an explicitly selected Blender bridge imports and exports external OBJ scenes', {skip:!blender}, t=>{
  const at=dir(t), file=at('patch.obj');
  fs.writeFileSync(file,'o Patch\nv 0 0 0\nv 1 0 0\nv 0 1 0\nvt 0 0\nvt 1 0\nvt 0 1\nf 1/1 2/2 3/3\n');
  assert.throws(()=>inspectSceneResource(file),/requires --blender/);
  const glb=convertSceneResource(file,{out:at('patch.glb'),blender});
  assert.equal(glb.external,'Blender');
  assert.deepEqual(glb.output.groups[0].parts[0].uvSets,[0]);
  const obj=convertSceneResource(glb.file,{out:at('reopened.obj'),blender});
  assert.equal(obj.output.groups[0].parts[0].triangles,1);
});
