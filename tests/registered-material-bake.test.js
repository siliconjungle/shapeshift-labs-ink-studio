const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const studio=require('..');
const PNG=require('../cli/png.js');
const {readGlb}=require('../cli/glb-file.js');

function plate() {
  return {
    name:'plates',
    points:[[-1,-1,0],[1,-1,0],[1,1,0],[-1,1,0],[-.35,-.35,1],[.35,-.35,1],[.35,.35,1],[-.35,.35,1]],
    faces:[[0,1,2,3],[4,5,6,7]],
    uvs:[[[.10,.70],[.45,.70],[.45,.10],[.10,.10]],[[.55,.70],[.90,.70],[.90,.10],[.55,.10]]],
    materials:[{name:'enamel',color:[.13,.18,.38],roughness:.24,metallic:.17,normal:[.12,0,1],
      emission:[0,1.35,.08],masks:{ground:.85}}],
    maskNames:['edge'],
    sampleSurface(p,_normal,face){
      return {...this.materials[0],masks:{ground:.85,edge:face===0 && p[0]<-.6?1:0}};
    }
  };
}
const pixel=(image,u,v)=>Array.from(image.data.subarray((Math.floor(v*image.h)*image.w+Math.floor(u*image.w))*4,
  (Math.floor(v*image.h)*image.w+Math.floor(u*image.w))*4+4));
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));

test('capture and paint use one atlas and a hidden surface rejects front-view paint',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-registered-bake-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const model=plate(), captures=path.join(dir,'captures'), paint=path.join(dir,'painted');
  const capturePaint={format:'ink-studio/material-paint-cameras',version:1,views:[
    {id:'face',width:65,height:63,camera:{pitch:0}},
    {id:'quarter',width:65,height:63,camera:{yaw:1.1,pitch:0,ortho:false,dist:4}}
  ]};
  const base=studio.exportGlb(model,{out:path.join(dir,'base.glb'),textureSize:256,bakeDir:captures,capturePaint});
  const source=read(base.materialBake), planFile=path.join(captures,source.paintManifest), plan=read(planFile);
  const parent=path.dirname(planFile);
  for (const [i,view] of plan.views.entries()) {
    const rgb=new Uint8Array(view.width*view.height*3);
    for(let p=0;p<rgb.length;p+=3)rgb.set(i?[0,210,20]:[253,0,0],p);
    PNG.write(path.join(parent,view.paint),view.width,view.height,rgb);
    if(i){
      const mask=new Uint8Array(view.width*view.height);
      for(let y=10;y<41;y++)for(let x=15;x<33;x++)mask[y*view.width+x]=255;
      view.mask='quarter-mask.png';
      fs.writeFileSync(path.join(parent,view.mask),PNG.encodeGray(view.width,view.height,mask));
    }
  }
  const frontOnly=path.join(parent,'one.json');
  fs.writeFileSync(frontOnly,JSON.stringify({...plan,views:plan.views.slice(0,1)}));
  const approvedPaint=path.join(parent,plan.views[0].paint), approvedBytes=fs.readFileSync(approvedPaint);
  assert.throws(()=>studio.exportGlb(model,{out:path.join(dir,'redo.glb'),textureSize:256,bakeDir:captures,capturePaint}),
    /preserve the existing paint files/);
  assert.deepEqual(fs.readFileSync(approvedPaint),approvedBytes);
  const one=studio.exportGlb(model,{out:path.join(dir,'one.glb'),textureSize:256,bakeDir:paint,paintViews:frontOnly});
  const first=read(one.materialBake).meshes[0], reference=source.meshes[0];
  const before=PNG.raster(path.join(captures,reference.maps.pigment.file)), after=PNG.raster(path.join(paint,first.maps.pigment.file));
  assert.deepEqual(pixel(after,.275,.40),pixel(before,.275,.40));
  assert.deepEqual(pixel(after,.725,.40).slice(0,3),[253,0,0]);
  assert(first.paintViews[0].occluded>10);
  assert.equal(first.uvLayout,reference.uvLayout);
  for(const name of ['normal','roughness','emission','coverage','metallicRoughness'])
    assert.equal(first.maps[name].sha256,reference.maps[name].sha256,name);
  for(const name of ['ground','edge'])
    assert.equal(first.masks[name].sha256,reference.masks[name].sha256,name);
  assert(pixel(PNG.raster(path.join(paint,first.maps.roughness.file)),.725,.4)[0]===61);
  assert.equal(first.emissionStrength,1.35);

  fs.writeFileSync(planFile,JSON.stringify(plan));
  const bothDir=path.join(dir,'both'), bothFile=path.join(dir,'both.glb');
  const both=studio.exportGlb(model,{out:bothFile,textureSize:256,bakeDir:bothDir,paintViews:planFile});
  const actual=read(both.materialBake).meshes[0];
  assert(actual.paintViews.every(view=>view.texels>0));
  assert(actual.paintViews[1].maskHash);
  assert(actual.masks['projected-paint'] && actual.masks['paint-quarter']);
  const {gltf,bin}=readGlb(fs.readFileSync(bothFile)), mat=gltf.materials[0];
  for (const [map,slot] of [['pigment',mat.pbrMetallicRoughness.baseColorTexture],
    ['normal',mat.normalTexture],['metallicRoughness',mat.pbrMetallicRoughness.metallicRoughnessTexture],['emission',mat.emissiveTexture]]) {
    const view=gltf.bufferViews[gltf.images[gltf.textures[slot.index].source].bufferView], at=view.byteOffset??0;
    assert.deepEqual(bin.subarray(at,at+view.byteLength),fs.readFileSync(path.join(bothDir,actual.maps[map].file)));
  }
  model.points[0][0]-=.01;
  assert.throws(()=>studio.exportGlb(model,{out:path.join(dir,'changed.glb'),textureSize:256,bakeDir:bothDir,paintViews:planFile}),
    /captured from different geometry/);
});

test('the CLI writes registered maps from an authored material and rejects ambiguous UVs',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-material-cli-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const scene=path.join(dir,'capsule.json'), out=path.join(dir,'model.glb'), bakeDir=path.join(dir,'maps');
  fs.writeFileSync(scene,JSON.stringify({id:'registered-capsule',solids:[
    {kind:'box',id:'block',at:[0,0,0],half:[.45,.61,.37],
      mat:{role:'stone',model:{roughness:.53,emission:[.01,.02,0],masks:{body:.7},normal:[0,0,1]}}}
  ]}));
  execFileSync(process.execPath,[path.join(__dirname,'../cli/ink-studio.js'),'export-glb',scene,'--out',out,'--res','.2',
    '--texture-size','256','--bake-dir',bakeDir],{stdio:'pipe'});
  const maps=read(path.join(bakeDir,'material-bake.json')).meshes[0];
  assert(maps.masks.body);
  assert.equal(PNG.layout(path.join(bakeDir,maps.maps.normal.file)).w,256);
  const overlap=plate();
  overlap.uvs[1]=overlap.uvs[0];
  assert.throws(()=>studio.exportGlb(overlap,{out,textureSize:256,bakeDir}),/needs a non-overlapping UV atlas/);
});

test('registered pigment includes a PNG texture and vertex color before export',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-material-pigment-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const model=plate();
  delete model.sampleSurface;
  model.materials=[{color:[1,1,1],texture:{bytes:PNG.encode(1,1,Uint8Array.of(200,160,120)),mimeType:'image/png'}}];
  model.colors=model.points.map(()=>[1,.5,1]);
  const out=path.join(dir,'model.glb');
  const result=studio.exportGlb(model,{out,textureSize:256,bakeDir:dir});
  const {file}=read(result.materialBake).meshes[0].maps.pigment;
  assert.deepEqual(pixel(PNG.raster(path.join(dir,file)),.725,.4).slice(0,3),[200,116,120]);
  const {gltf}=readGlb(fs.readFileSync(out));
  assert.equal(gltf.meshes[0].primitives[0].attributes.COLOR_0,undefined);
});
