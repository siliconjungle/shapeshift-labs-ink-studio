const assert=require('node:assert/strict');
const test=require('node:test');
const { execFileSync }=require('node:child_process');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const ink=require('..');
const toolkit=ink.load();
const { prepare,planarWeight }=toolkit.KIT.reflection.proxy;
const dock=require('../examples/reflection-proxy-dock.js')(toolkit);
const browser=require('../cli/look-webgl.js');

test('reflection weights are continuous at the distance and roughness bands',()=>{
  const policy=prepare({distance:[6,8],roughness:.6,roughnessRange:[.4,.8],probe:'room'});
  assert(Math.abs(planarWeight(policy,6)-.5)<1e-10);
  assert(Math.abs(planarWeight(policy,7)-.25)<1e-10);
  assert.equal(planarWeight(policy,8),0);
  assert.equal(planarWeight(prepare({distance:false,roughnessRange:false}),1000),1);
  assert.equal(planarWeight(prepare({distance:[7,7]}),7),1);
  assert.equal(planarWeight(prepare({distance:[7,7]}),7.01),0);
  assert.throws(()=>prepare({distance:[10,4]}),/ordered/);
  assert.throws(()=>prepare({probe:'room',probeSize:128}),/pixel probe/);
  assert.throws(()=>prepare({roughness:1.1}),/roughness/);
});

test('a single shot keeps planar water and glass and samples capped probes and the environment elsewhere',()=>{
  const world=dock.build(dock.seed), options={w:192,h:120,px:1,raw:true,renderStats:true,passes:['reflections','depth']};
  const frame=ink.render(world,options), stats=frame.renderStats;
  const names=Object.fromEntries(stats.reflectionSources.receivers.map(row=>[row.plane,row]));
  assert(names.pool.planar>100);
  assert(names.window.planar>50);
  assert.equal(names.window.id,'signal glass');
  assert(names.panel.probeSamples>10);
  assert.equal(names.panel.planar,0);
  assert(names.runoff.environment>100);
  assert.equal(names.runoff.planar,0);
  assert.equal(stats.planarCaptures,2);
  assert.equal(stats.reflectionProbeFaces,6);
  assert.equal(stats.reflectionProbePixels,32*32*6);

  const reference=ink.render(world,{...options,reflectionProxies:false});
  assert.equal(reference.renderStats.planarCaptures,4);
  assert.deepEqual(frame.passes.depth,reference.passes.depth);
  assert.equal(stats.planarPixels*2,reference.renderStats.planarPixels);
  const far=ink.render(world,{...options,dist:15,fov:.35});
  assert.equal(far.renderStats.planarCaptures,0);
  assert(far.renderStats.reflectionSources.receivers.find(row=>row.plane==='window').environment>50);

  const noProbe=ink.render(world,{...options,reflectionProbes:false});
  const fallback=noProbe.renderStats.reflectionSources.receivers.find(row=>row.plane==='panel');
  assert.equal(fallback.probeSamples,0);
  assert(fallback.environment>50);
  assert.equal(noProbe.renderStats.reflectionProbeFaces,0);
});

test('WebGL water shades with the environment and skips a far planar capture',
  {skip:!process.env.INK_TEST_CHROME},()=>{
  const result=browser({},function build({KIT:K,makeBuilder,SpriteSurface}){
    const B=makeBuilder(4,[0,0xff0000]);
    B.disc(0,1,-2,[0,0,1],.72,.01,B.P[1],1);
    const floor=SpriteSurface.make();
    floor.face([-1,-.8,-3],[2,0,0],[0,0,5],1,1,()=>0);
    const water=K.procedural.waterBodies;
    const pool=water.create({id:'lake',bounds:{min:[-1,-3],max:[1,2]},sample:()=>({bed:-1,surface:0}),
      resolution:[8,8],optics:{tint:[0,0,0],extinction:[0,0,0],surfaceColor:[1,1,1],surface:1,
        refraction:0,foam:0,caustics:0,reflection:{plane:'mirror',distortion:0,proxy:{distance:[9,10]}}}});
    return B.finish({water:water.scene([pool]),spriteSurfaces:floor.finish(),reflections:[K.reflection.plane({id:'mirror'})],
      skyEnvironment:{defaults:{zenith:'#3577e6',horizon:'#365ed8',ground:'#15395f',sunStrength:0}},
      cam:{target:[0,0,0],dist:Math.sqrt(45),pitch:Math.atan(.5),yaw:0},radius:8});
  },(kit,build,backend)=>{
    const w=build(kit), v=backend(97,97,{raw:true,dither:0,reflectionScale:1});
    try {
      const near=[],far=[];
      v.draw(w,{reflectionSourceFrame:r=>near.push(r)});
      const reflected=v.sample({p:[48,48]}).p;
      v.draw(w,{camera:{target:[0,0,0],dist:15,pitch:Math.atan(.5),yaw:0,fov:.35},
        reflectionSourceFrame:r=>far.push(r)});
      return {reflected,distant:v.sample({p:[48,48]}).p,near,far};
    } finally {v.close();}
  });
  assert(result.reflected[0]>60&&result.reflected[0]>result.reflected[2]+45);
  assert(result.distant[2]>65&&result.distant[2]>result.distant[0]+40);
  assert.equal(result.near[0].planarCaptures,1);
  assert.equal(result.far[0].planarCaptures,0);
  assert.equal(result.far[0].sources[0].path,'environment');
});

test('the render CLI writes a JSON receipt for the selected reflection paths',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-reflection-source-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const cwd=path.resolve(__dirname,'..'), report=path.join(dir,'report.json');
  execFileSync(process.execPath,['cli/ink-studio.js','render','examples/reflection-proxy-dock.js',
    '--w','112','--h','80','--px','1','--raw','--reflection-report',report,'--out',path.join(dir,'dock.png')],{cwd});
  const receipt=JSON.parse(fs.readFileSync(report));
  assert.equal(receipt.scene,dock.id);
  assert.equal(receipt.planarCaptures,2);
  assert.equal(receipt.probePixels,6144);
  assert(receipt.receivers.find(row=>row.plane==='runoff').environment>0);
});
