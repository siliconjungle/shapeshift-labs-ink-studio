const assert = require('node:assert/strict');
const { test } = require('node:test');
const { mkdtempSync, writeFileSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { execFileSync } = require('node:child_process');
const ink = require('..');
const { readGlb } = require('../cli/glb-file.js');

function capture() {
  const width=25,height=21,depth=new Float32Array(width*height).fill(3), data=new Uint8Array(depth.length*4);
  for(let i=0;i<depth.length;i++) data.set([48,133,109,255],i*4);
  for(let y=8;y<=12;y++) for(let x=10;x<=14;x++) depth[y*width+x]=0;
  return {width,height,depth,image:{width,height,data,channels:4},
    camera:{type:'orthographic',height:2.1},maxDepthJump:.05};
}

function observedCloud() {
  const rows=[
    {p:[-.7,0,-3],rgb:[48,133,109]},
    {p:[-.5,0,-3.02],rgb:[250,102,60]},
    {p:[.5,0,-3.32],rgb:[255,255,255]},
    {p:[.55,.3,-3],rgb:[255,40,10],alpha:.03},
    {p:[6,0,-3],rgb:[250,102,60]},
    {p:[.7,0,-2.81],rgb:[48,133,109]},
    {p:[0,0,-3.01],rgb:[250,102,60]},
    {p:[-.5,.55,-3],rgb:[48,133,109],sh:.3}
  ];
  return {
    count:rows.length,degree:1,
    positions:Float32Array.from(rows.flatMap(row=>row.p)),
    scales:Float32Array.from(rows.flatMap(()=>[.065,.05,.008])),
    rotations:Float32Array.from(rows.flatMap(()=>[0,0,0,1])),
    opacity:Float32Array.from(rows.map(row=>row.alpha??.95)),
    dc:Float32Array.from(rows.flatMap(row=>row.rgb.map(v=>(v/255-.5)/.28209479177387814))),
    sh:Float32Array.from(rows.flatMap(row=>[0,0,row.sh??0,0,0,0,0,0,0]))
  };
}

const options={name:'captured sign',paintRadius:0,rgbThreshold:12,tolerance:.07,residualLimit:6};

test('recovers indexed opaque depth, filters hidden and redundant observations, and retains useful harmonics',async t=>{
  const scan=await ink.scanToMesh(capture(),{...options,cloud:observedCloud()});
  assert.deepEqual(scan.report.reasons,{hidden:1,matched:1,outside:2,faint:1,relief:1,uncovered:0,appearance:2,budget:0});
  assert.equal(scan.report.residualSplats,3);
  assert(scan.report.triangles>700);
  const {gltf}=readGlb(scan.glb);
  assert.equal(gltf.meshes[0].primitives[0].mode,undefined);
  assert.equal(gltf.meshes[0].primitives[1].mode,0);
  const hybrid=await scan.world('hybrid');
  assert.equal(hybrid.meshes.length,1);
  assert.equal(hybrid.gaussianHarmonics.degree,1);
  assert(Math.abs(hybrid.gaussianHarmonics.sh[20]-.3)<1e-5);
  assert(hybrid.data[2]>-3 && hybrid.data[2]<-2.98,'on-surface detail needs a small foreground bias');
  assert(Math.abs(hybrid.data[18]+2.81)<1e-5,'real relief keeps its position');
  assert.deepEqual(Array.from(hybrid.renderMetadata.normals.slice(0,3)),[0,0,1]);
  const tight=await ink.scanToMesh(capture(),{...options,cloud:observedCloud(),residualLimit:1});
  assert.equal(tight.report.reasons.budget,2);
  assert.equal(tight.report.reasons.relief,1);

  const dir=mkdtempSync(join(tmpdir(),'ink-scan-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const file=join(dir,'scan.glb');
  writeFileSync(file,scan.glb);
  const loaded=await ink.readGaussianGltf(file);
  assert.deepEqual(hybrid.data,loaded.data);
});

test('ordinary rendering and the CLI preserve a scan hole with zero residual splats',async t=>{
  const observation=capture();
  const dir=mkdtempSync(join(tmpdir(),'ink-scan-cli-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const depthFile=join(dir,'depth.json'), out=join(dir,'capture.glb'), png=join(dir,'color.png');
  const {image,depth,...rest}=observation;
  writeFileSync(depthFile,JSON.stringify({...rest,depth:Array.from(depth)}));
  writeFileSync(png,require('../cli/png.js').encode(image.width,image.height,image.data,4));
  const cli=(...args)=>execFileSync(process.execPath,[resolve(__dirname,'../cli/ink-studio.js'),...args],{encoding:'utf8'});
  cli('scan-mesh',depthFile,'--image',png,'--out',out,'--residual-limit','0','--paint-radius','0');
  assert.equal(JSON.parse(readFileSync(join(dir,'capture.scan.json'))).residualSplats,0);
  cli('render',out,'--w','100','--h','100','--px','1','--out',join(dir,'render.png'));
  assert(readFileSync(join(dir,'render.png')).length>100);
  const world=await ink.readGaussianGltf(out), {KIT}=ink.load();
  assert.equal(world.count,0);
  assert.equal(world.meshes.length,1);
  const rear=KIT.sceneMeshes.create({id:'rear-card',positions:[-1,-.8,-3.2,1,-.8,-3.2,1,.8,-3.2,-1,.8,-3.2],
    uvs:new Float32Array(8),indices:[0,1,2,0,2,3],materials:[{id:'magenta',color:0xee40ac}]});
  const frame=ink.render({...world,meshes:[...world.meshes,rear]},{w:96,h:96,px:1,target:[0,0,-3],dist:4,
    yaw:0,pitch:0,ortho:true,passes:['opaque-surface']});
  const open=ink.pickSurface(frame.passes,48,48), surface=ink.pickSurface(frame.passes,66,48);
  assert.equal(open.object,'rear-card');
  assert.equal(surface.object,'gltf-node-0');
  assert(open.depth>surface.depth);
});

test('headless and WebGL draw the hybrid and support a moved inspection light', {skip:!process.env.INK_TEST_CHROME},async()=>{
  const scan=await ink.scanToMesh(capture(),{...options,cloud:observedCloud()});
  const world=await scan.world('hybrid');
  const light={id:'probe',shape:'disk',at:[-.55,0,-2.3],normal:[0,0,-1],
    size:[.12,.12],color:'#ffb76f',intensity:2,radius:1.5,sampleGrid:1,visible:false,shadows:false};
  const view={w:96,h:96,px:1,target:[0,0,-3],dist:4,yaw:0,pitch:0,ortho:true,raw:true};
  const plain=ink.render(world,view), lit=ink.render({...world,areaLights:[light]},view);
  assert(lit.rgb.some((v,i)=>v>plain.rgb[i]+8));
  const response=require('../cli/look-webgl.js')({hardware:true,asyncFixture:true},async (kit,input)=>
    kit.gaussianGltfWorld(Uint8Array.from(atob(input.asset),c=>c.charCodeAt(0)),{toolkit:kit}),
  async (kit,build,backend,input)=>{
    const world=await build(kit,input);
    const b=backend(96,96,{offscreen:true,camera:{target:[0,0,-3]},dist:4,yaw:0,pitch:0,ortho:true,raw:true});
    try {
      b.draw(world);
      const base=b.sample({hole:[48,48],surface:[66,48]}), original=b.image();
      b.draw({...world,areaLights:[input.light]});
      const relit=b.image();
      b.draw({...world,meshes:[]});
      const details=b.image();
      b.draw({...world,meshes:[],areaLights:[input.light]});
      return {base,original,relit,details,litDetails:b.image()};
    } finally {b.close();}
  },{asset:scan.glb.toString('base64'),light});
  assert.deepEqual(response.base.hole,[16,24,32]);
  assert(response.base.surface[1]>110);
  assert.notEqual(response.relit,response.original);
  assert.notEqual(response.litDetails,response.details);
});
