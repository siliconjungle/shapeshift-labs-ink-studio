const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const test = require('node:test');
const ink = require('..');
const PNG = require('../cli/png.js');
const {document} = require('../cli/glb-file.js');

const read = file => JSON.parse(fs.readFileSync(file,'utf8'));
const setup = t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'ink-cage-bake-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const run = (name, receiver, options) => ink.exportGlb(receiver,{out:path.join(root,name+'.glb'),
    bakeDir:path.join(root,name),textureSize:256,...options});
  return {root,run};
};
const plan = row => ({format:'ink-studio/material-cage-bake',version:1,receivers:[{front:.3,back:.15,...row}]});

function plate() {
  return {name:'receiver',points:[[-1,-1,0],[1,-1,0],[1,1,0],[-1,1,0]],faces:[[0,1,2,3]],
    uvs:[[[.1,.9],[.9,.9],[.9,.1],[.1,.1]]],materials:[{color:[.18,.26,.35],roughness:.7}]};
}

function sampler(file) {
  const mesh = read(file).meshes[0], dir = path.dirname(file), maps = {...mesh.maps,...mesh.masks};
  const rasters = new Map();
  return {mesh,pixel(name,u,v) {
    if (!rasters.has(name)) rasters.set(name,PNG.raster(path.join(dir,maps[name].file)));
    const {w,h,data}=rasters.get(name), i=(Math.floor(v*h)*w+Math.floor(u*w))*4;
    return Array.from(data.subarray(i,i+4));
  }};
}

test('mesh cage writes tangent normals and signed relief while blocking cross-part hits and keeping misses on the receiver', t=>{
  const {run}=setup(t), receiver=plate();
  const source={kind:'mesh',model:{
    points:[[-1,-1,-.12],[.6,-1,.20],[.6,1,.20],[-1,1,-.12],[-.07,-1,.24],[.26,-1,.24],[.26,1,.24],[-.07,1,.24]],
    faces:[[0,1,2,3],[4,5,6,7]],faceParts:['panel','bolt'],faceMaterials:[0,1],
    materials:[{color:[.75,.22,.06],roughness:.32,masks:{worn:.8}},{color:[0,1,0]}]}};
  const base=sampler(run('flat',receiver).materialBake);
  const baked=run('baked',receiver,{cageBake:plan({source,part:'panel'})}), next=sampler(baked.materialBake);
  const report=next.mesh.cageBake;
  assert(report.hits>10000 && report.misses>1000 && report.rejectedCrossPart>1000);
  assert.equal(report.sampled,report.hits+report.misses+report.rejectedCrossPart);
  assert(report.offsets.min<-.10 && report.offsets.max>.16);
  assert.equal(report.examples.rejectedCrossPart[0].sourcePart,'bolt');
  assert.equal(next.pixel('cage-hit',.24,.5)[0],255);
  assert(next.pixel('cage-relief',.24,.5)[0]<128);
  assert(next.pixel('normal',.24,.5)[0]<112);
  assert.equal(next.pixel('roughness',.24,.5)[0],82);
  assert.equal(next.pixel('worn',.24,.5)[0],204);
  for (const [u,status] of [[.54,'cage-cross-part'],[.84,'cage-miss']]) {
    assert.equal(next.pixel(status,u,.5)[0],255);
    assert.equal(next.pixel('cage-hit',u,.5)[0],0);
    assert.equal(next.pixel('cage-relief',u,.5)[0],128);
    for (const name of ['pigment','normal','roughness']) assert.deepEqual(next.pixel(name,u,.5),base.pixel(name,u,.5));
  }
  assert(next.mesh.mipmaps.levels.every(row=>row.masks['cage-hit'] && row.masks['cage-relief']));
  assert.throws(()=>run('missing-plan',receiver,{rebakeFrom:baked.materialBake}),/Resupply the cage plan/);
  const rebake=run('allowed',receiver,{cageBake:plan({source,part:'panel',partPolicy:'allow'}),rebakeFrom:baked.materialBake});
  const allowed=sampler(rebake.materialBake);
  assert.equal(allowed.pixel('cage-cross-part',.54,.5)[0],255);
  assert.equal(allowed.pixel('cage-hit',.54,.5)[0],255);
  assert.deepEqual(allowed.pixel('pigment',.54,.5).slice(0,3),[0,255,0]);
});

test('the CLI traces a native signed diorama directly and preserves receiver pigment in a normals-only bake', t=>{
  const {root}=setup(t), {KIT:K}=ink.load();
  const doc=K.meshTopology.create({id:'panel',vertices:plate().points.map((position,i)=>({id:'v'+i,position})),
    faces:[{id:'front',corners:plate().uvs[0].map((uv,i)=>({id:'c'+i,vertex:'v'+i,uv}))}]});
  const save=(file,data)=>{const target=path.join(root,file);fs.writeFileSync(target,JSON.stringify(data));return target;};
  const receiver=save('receiver.json',doc);
  save('detailed.json',{id:'forge',solids:[{id:'badge',kind:'ball',at:[0,0,-.35],r:.59,
    mat:{role:'stone',model:{color:[.9,.3,.04],masks:{patina:.6}}}}]});
  const recipe=save('cage.json',plan({part:'badge',faces:['front'],source:{kind:'sdf',file:'detailed.json'},
    channels:['normal','masks']}));
  const dir=path.join(root,'forge'), cli=path.resolve(__dirname,'../cli/ink-studio.js');
  execFileSync(process.execPath,[cli,'export-glb',receiver,'--out',path.join(root,'forge.glb'),'--texture-size','256',
    '--cage-bake',recipe,'--bake-dir',dir],{stdio:'pipe'});
  const baked=sampler(path.join(dir,'material-bake.json'));
  assert.equal(baked.mesh.cageBake.source.kind,'sdf');
  assert(baked.mesh.cageBake.hits>1000 && baked.mesh.cageBake.misses>1000);
  assert.equal(baked.pixel('cage-hit',.5,.5)[0],255);
  assert.equal(baked.pixel('patina',.5,.5)[0],153);
  assert(baked.pixel('cage-relief',.5,.5)[0]>216);
  assert(baked.pixel('normal',.62,.5)[0]>155);
  assert.deepEqual(baked.pixel('pigment',.5,.5),baked.pixel('pigment',.18,.5));
});

test('a scan-proxy GLB contributes registered source maps and ignores transparent texels', t=>{
  const {run,root}=setup(t), doc=document();
  const material=doc.add('materials',{alphaMode:'MASK',
    pbrMetallicRoughness:{baseColorTexture:{index:doc.texture(PNG.encode(2,1,Uint8Array.of(30,210,60,255,255,0,0,0),4),'Scan diffuse')},
      metallicRoughnessTexture:{index:doc.texture(PNG.encode(1,1,Uint8Array.of(255,52,21)),'Scan roughness')}},
    normalTexture:{index:doc.texture(PNG.encode(1,1,Uint8Array.of(191,128,238)),'Scan normal')},
    emissiveTexture:{index:doc.texture(PNG.encode(1,1,Uint8Array.of(4,62,8)),'Scan glow')},emissiveFactor:[1,1,1]});
  const pos=doc.accessor(Float32Array.from(plate().points.flatMap(([x,y])=>[x,y,.115])),'VEC3',{bounds:true});
  const uv=doc.accessor(Float32Array.of(0,1,1,1,1,0,0,0),'VEC2');
  const indices=doc.accessor(Uint16Array.of(0,1,2,0,2,3),'SCALAR');
  const mesh=doc.add('meshes',{primitives:[{attributes:{POSITION:pos,TEXCOORD_0:uv},material,indices}]});
  doc.gltf.scenes[0].nodes.push(doc.add('nodes',{mesh}));
  const file=path.join(root,'scan.glb');
  fs.writeFileSync(file,doc.finish());
  const baked=sampler(run('scan',plate(),{cageBake:plan({source:{kind:'scan-proxy',file,part:'panel'},part:'panel'})}).materialBake);
  assert.equal(baked.mesh.cageBake.source.kind,'scan-proxy');
  assert.equal(baked.mesh.cageBake.source.triangles,2);
  assert.equal(baked.pixel('cage-hit',.3,.5)[0],255);
  assert.equal(baked.pixel('cage-miss',.72,.5)[0],255);
  assert.deepEqual(baked.pixel('pigment',.3,.5).slice(0,3),[30,210,60]);
  assert.deepEqual(baked.pixel('emission',.3,.5).slice(0,3),[4,62,8]);
  assert.equal(baked.pixel('roughness',.3,.5)[0],52);
  assert(baked.pixel('normal',.3,.5)[0]>179);
});

test('the cast stops on an in-range backface and reports a miss outside the authored cage',t=>{
  const {run}=setup(t);
  const source={kind:'mesh',model:{
    points:[[-1,-1,.04],[0,-1,.04],[0,1,.04],[-1,1,.04],[-1,-1,0],[1,-1,0],[1,1,0],[-1,1,0]],
    faces:[[3,2,1,0],[4,5,6,7]],materials:[{color:[.9,.7,.3]}]}};
  const stop=sampler(run('closed',plate(),{cageBake:plan({source,front:.08,back:.03})}).materialBake);
  assert.equal(stop.pixel('cage-backface',.25,.5)[0],255);
  assert.equal(stop.pixel('cage-hit',.25,.5)[0],0);
  assert.equal(stop.pixel('cage-hit',.75,.5)[0],255);
  const outside={kind:'mesh',model:{...source.model,faces:[[3,2,1,0]]}};
  const short=sampler(run('short',plate(),{cageBake:plan({source:outside,front:.02,back:.03})}).materialBake);
  assert.equal(short.mesh.cageBake.sampled,short.mesh.cageBake.misses);
});
