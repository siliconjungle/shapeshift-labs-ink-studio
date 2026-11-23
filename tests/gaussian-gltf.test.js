const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { mkdtemp, readFile, writeFile, rm } = fs.promises;
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const ink = require('..');
const { document, readGlb, pack } = require('../cli/glb-file.js');
const { pick } = require('../src/art-passes.js');
const tidalBeacon = require('../examples/gaussian-gltf/tidal-beacon.js');
const toolkit = ink.load();
const ext = 'KHR_gaussian_splatting';
const close = (a,b) => assert(Math.abs(a-b)<1e-5, a+' differs from '+b);

function fixture() {
  const { gltf, accessor, add, finish } = document();
  gltf.extensionsUsed = [ext];
  const vec = (values, type) => accessor(Float32Array.from(values),type,{ bounds:type === 'VEC3' });
  const a = (key, index) => [ext+':'+key,index];
  const alpha = accessor(Uint8Array.from([255,0]),'SCALAR');
  gltf.accessors[alpha].normalized = true;
  const cloud = {
    mode:0, indices:accessor(Uint16Array.from([0]),'SCALAR'),
    attributes:{POSITION:vec([0,0,.35,0,0,-.35],'VEC3'),...Object.fromEntries([
      a('ROTATION',vec([0,0,0,1,0,0,0,1],'VEC4')),
      a('SCALE',vec([.23,.08,.12,.08,.08,.08],'VEC3')),
      a('OPACITY',alpha), a('SH_DEGREE_0_COEF_0',vec([-.9,.6,.6,0,0,0],'VEC3')),
      a('SH_DEGREE_1_COEF_0',vec([0,0,0,0,0,0],'VEC3')),
      a('SH_DEGREE_1_COEF_1',vec([0,0,0,0,0,0],'VEC3')),
      a('SH_DEGREE_1_COEF_2',vec([.4,0,0,0,0,0],'VEC3'))
    ])},
    extensions:{[ext]:{kernel:'ellipse',colorSpace:'lin_rec709_display'}}
  };
  const material = add('materials',{name:'white',pbrMetallicRoughness:{baseColorFactor:[1,1,1,1]}});
  const tri = { attributes:{POSITION:vec([-1,-1,0,1,-1,0,0,1,0],'VEC3')}, material };
  const mesh = add('meshes',{name:'Mixed',primitives:[tri,cloud]});
  const node = add('nodes',{name:'A',mesh,translation:[1,0,0]});
  const parent = add('nodes',{children:[node],translation:[1,2,3],scale:[2,3,4],rotation:[0,0,Math.SQRT1_2,Math.SQRT1_2]});
  gltf.scenes[0].nodes = [parent];
  return finish();
}

test('one node pose drives triangle coordinates, means, covariance and rotated SH',async () => {
  const { gaussianGltfWorld } = await import('../src/gaussian-gltf.mjs');
  const { gaussianSplatColors } = await import('../src/gaussian-splats.mjs');
  const world = await gaussianGltfWorld(fixture(),{ toolkit });
  const [mesh, gaussian] = world.gltfParts.parts;
  assert.equal(gaussian.object,mesh.object);
  assert.notEqual(gaussian.id,mesh.id);
  assert.deepEqual(mesh.matrix,gaussian.matrix);
  assert.equal(world.count,1);
  [1,4,4.4,1].forEach((v,i)=>close(world.data[i],v));
  close(world.data[4],(.08*3)**2);
  close(world.data[8],(.23*2)**2);
  close(world.data[10],(.12*4)**2);
  assert.equal(world.renderMetadata.targets[world.renderMetadata.targetIds[0]].part,gaussian.id);
  const layer = toolkit.KIT.sceneMeshes.layer(world.meshes[0]);
  close(layer.vertices[0],4);
  close(layer.vertices[1],2);
  close(layer.vertices[2],3);
  const shade = dir => gaussianSplatColors(world,0,{ back:dir,ortho:true });
  assert.equal(shade([0,-1,0]).base[0],136);
  assert(shade([0,-1,0]).rgb[0] < shade([0,1,0]).rgb[0]);
  assert.equal(shade([1,0,0]).rgb[0],shade([1,0,0]).base[0]);
});

test('CLI and SDK render hybrid GLB and local companion glTF with identical part IDs',async t=>{
  const folder = await mkdtemp(path.join(os.tmpdir(),'ink-gaussian-gltf-'));
  t.after(()=>rm(folder,{recursive:true,force:true}));
  const file = path.join(folder,'beacon.glb'), json = path.join(folder,'beacon.gltf'), image = path.join(folder,'render.png');
  const bytes = tidalBeacon(), { gltf,bin } = readGlb(bytes);
  await writeFile(file,bytes);
  gltf.buffers[0].uri = 'beacon.bin';
  await writeFile(path.join(folder,'beacon.bin'),bin);
  await writeFile(json,JSON.stringify(gltf));
  const deps = [], world = await ink.readGaussianGltf(json,{onFile:file=>deps.push(path.basename(file))});
  assert.deepEqual(deps,['beacon.gltf','beacon.bin']);
  assert.equal(world.count,1500);
  assert.equal(world.meshes.length,16);
  const cli = (cmd,filename,...options) => execFileSync(process.execPath,
    [path.resolve(__dirname,'../cli/ink-studio.js'),cmd,filename,...options],{encoding:'utf8'});
  assert.deepEqual(JSON.parse(cli('inspect-gltf',file)),world.gltfParts);
  assert.deepEqual(JSON.parse(cli('inspect-gltf',json)),world.gltfParts);
  cli('render',json,'--w','160','--h','110','--px','1','--out',image);
  assert((await readFile(image)).length > 1000);
  const { passes } = ink.render(world,{w:180,h:120,px:1,dist:4.5,passes:['opaque-surface','partId']});
  const pixel = passes.surfaceKind.findIndex((surface,i)=>surface===1 && passes.partId[i]>0);
  assert(pixel>=0);
  const hit = pick(passes,pixel%passes.w,Math.floor(pixel/passes.w));
  assert(world.gltfParts.parts.some(part=>part.id===hit.part&&part.object===hit.object&&part.kind==='mesh'));
  const gaussian = world.gltfParts.parts.find(part=>part.kind==='gaussian');
  const i = gaussian.firstSplat + 130, [x,y,z] = world.data.subarray(i*16,i*16+3);
  const { ray } = JSON.parse(cli('inspect-gltf',file,'--ray',[x,y,z+1,0,0,-1].join(',')));
  assert(ray.contributions.some(hit=>hit.target.part===gaussian.id && hit.target.entity===gaussian.object));

});

test('bounds, missing harmonic terms and unsupported compression fail explicitly', async () => {
  const { gaussianGltfWorld } = await import('../src/gaussian-gltf.mjs');
  const { gltf,bin } = readGlb(fixture());
  const read = () => gaussianGltfWorld(pack(gltf,bin),{toolkit});
  const attributes = gltf.meshes[0].primitives[1].attributes;
  const name = ext+':SH_DEGREE_1_COEF_1', original = attributes[name];
  delete attributes[name];
  await assert.rejects(read,/SH_DEGREE_1_COEF_1/);
  attributes[name]=original;
  gltf.extensionsRequired = [ext,ext+'_compression_spz_2'];
  await assert.rejects(read,/Unsupported required glTF extensions/);
  gltf.extensionsRequired.pop();
  const a = gltf.accessors[attributes[ext+':ROTATION']];
  gltf.bufferViews[a.bufferView].byteLength -= 1;
  await assert.rejects(read,/exceeds its buffer view/);
  await assert.rejects(gaussianGltfWorld(tidalBeacon(),{toolkit,maxSplats:750}),/exceeds the splat limit/);
});

test('WebGL draws native mesh paint and live Gaussian harmonics from the same GLB', {
  skip: !process.env.INK_TEST_CHROME
}, () => {
  const output = require('../cli/look-webgl.js')({asyncFixture:true}, async (kit,asset) =>
    kit.gaussianGltfWorld(Uint8Array.from(atob(asset),c=>c.charCodeAt(0)),{toolkit:kit}),
  async (kit,build,backend,asset) => {
    const w = await build(kit,asset);
    const view = backend(180,120,{offscreen:true,dist:4.5,dither:0,reflection:false});
    try {
      view.draw(w);
      const all = view.image();
      view.draw(w,{gaussianColor:'baked',raw:true});
      const baked = view.image();
      view.draw({...w,meshes:[]});
      const clouds = view.image();
      return { all,baked,clouds };
    } finally { view.close(); }
  },tidalBeacon().toString('base64'));
  const difference = (a,b) => {
    const left=Buffer.from(a,'base64'),right=Buffer.from(b,'base64');
    return left.reduce((sum,n,i)=>sum+(Math.abs(n-right[i])>3),0);
  };
  assert(difference(output.all,output.clouds)>300);
  assert(difference(output.all,output.baked)>50);
});
