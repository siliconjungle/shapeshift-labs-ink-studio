const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const kit=require('..').load(), {KIT:K}=kit, W=K.world, R=W.runtime;
const {open,execute}=require('../cli/material-lab.js');
const {study}=require('../examples/material-lab/study.cjs');
const settings={substeps:1,passes:4,contactPasses:2,gravity:[0,0,0],damping:0,bounceSpeed:.25};
const plan=(config,run={})=>({format:'ink-studio/material-lab-plan',version:1,id:'material-check',
  config:{settings,...config},run:{dt:.02,ticks:12,every:1,...run}});
function near(a,b,tolerance=1e-4){
  assert(Math.abs(a-b)<=tolerance,a+' should be near '+b);
}

test('measured grain impact matches two-body restitution and keeps overlap bias out of velocity',()=>{
  const source=plan({grains:{
    a:{at:[-.115,0,0],velocity:[1,0,0],radius:.1,mass:1,material:'glass'},
    b:{at:[ .115,0,0],velocity:[-1,0,0],radius:.1,mass:1,material:'glass'}
  }},{ticks:1});
  const {report}=execute(open(kit,source)), frame=report.frames[1], [a,b]=frame.points;
  near(a.velocity[0],-.8);
  near(b.velocity[0], .8);
  near((a.velocity[0]+b.velocity[0]),0);
  near(b.position[0]-a.position[0],.2);
  assert.equal(frame.samples.length,1);
  const hit=frame.samples[0];
  near(hit.approach,2);
  near(hit.normalImpulse,1.8);
  near(hit.force[0]*hit.interval,hit.impulse[0],1e-10);
  assert.equal(hit.format,W.contactSamples.format);
  assert.equal(hit.pair,'glass/glass');
  assert.deepEqual(hit.normal,[-1,0,0]);
});

test('material pairs produce different measured slip under identical loading and audit all capped samples',()=>{
  const grain=(x,material)=>({at:[x,.11,0],velocity:[1,-1,0],radius:.1,mass:1,material});
  const input=plan({settings:{...settings,maxContactSamples:1},grains:{a:grain(-1,'grit'),b:grain(1,'glass')},
    surfaces:{floor:{material:'polished',shape:{kind:'plane',normal:[0,1,0]}}},
    pairs:{'grit/polished':{staticFriction:.8,dynamicFriction:.8,restitution:0},
      'glass/polished':{staticFriction:.1,dynamicFriction:.1,restitution:0}}},{ticks:1});
  const {report}=execute(open(kit,input)), frame=report.frames[1], [a,b]=frame.points;
  near(a.velocity[0],.2);near(b.velocity[0],.9);
  near(a.velocity[1],0);near(b.velocity[1],0);
  near(frame.contact.pairs['grit/polished'].slipAfter,.2);
  near(frame.contact.pairs['glass/polished'].slipAfter,.9);
  assert.equal(frame.samples.length,1);
  assert.equal(report.summary.contact.omitted,1);
  assert.equal(Object.values(report.summary.contact.pairs).reduce((n,row)=>n+row.count,0),2);
  assert.equal(frame.contact.pairs['grit/polished'].sliding,1);
});

test('explicit tetrahedra, tendon, unilateral constraints and angle presets compose in a native world',()=>{
  const point=(x,y,z,pin=false)=>({at:[x,y,z],pin,radius:0,material:'silicone'});
  const source=plan({
    points:{a:point(0,0,0,true),b:point(1,0,0,true),c:point(0,1,0,true),d:point(0,0,1),
      root:point(2,0,0,true),tip:point(3,0,0),stop:point(2,-2,0,true),strut:point(2.4,-2,0),
      axle:point(3,1,0,true),above:point(3,2,0,true),hinge:point(4,1,0)},
    cells:{wedge:{nodes:['a','b','c','d'],material:'silicone',group:'wedge'}},
    constraints:{
      shorten:{preset:'tendon',points:['root','tip']},
      maximum:{preset:'cable',points:['root','tip'],target:1.01},
      minimum:{preset:'spacer',points:['stop','strut'],target:.52},
      fold:{preset:'hinge',points:['above','axle','hinge'],target:Math.PI/3},
      fixed:{preset:'seam',points:['axle','hinge'],target:1}
    }
  },{ticks:20,commands:[{tick:1,action:'drive',args:{constraint:'shorten',activation:1}},
    {tick:3,action:'anchor',args:{point:'c',at:[0,.82,0]}}]});
  const {report}=execute(open(kit,source)), frame=report.frames.at(-1);
  assert.equal(frame.strain.wedge.inverted,0);
  assert(frame.strain.wedge.ratio>.8 && frame.strain.wedge.ratio<1.2);
  const all=Object.fromEntries(frame.constraints.map(row=>[row.id,row]));
  assert.equal(all.shorten.activation,1);
  assert(Math.abs(all.shorten.error)<.025);
  assert(Math.abs(all.fold.error)<.032);
  assert(all.maximum.error<.02&&all.minimum.error>-.02);
});

test('work caps fail transactionally and dense scenes retain a deterministic replay',()=>{
  const grains=Object.fromEntries(Array.from({length:16},(_,i)=>['g'+i,
    {at:[i*.004,0,0],radius:.1,material:'glass'}]));
  const limited=open(kit,plan({settings:{...settings,maxWork:120},grains})).run;
  const saved=limited.checkpoint();
  assert.throws(()=>limited.step(),/per-tick work budget/);
  assert(R.checkpointsEqual(limited.checkpoint(),saved));
  assert.throws(()=>execute(open(kit,plan({grains},{maxTotalWork:20}))),/total work budget/);
  const runPlan=study();
  runPlan.run={...runPlan.run,ticks:44,every:11,checkpoints:[20],
    commands:runPlan.run.commands.filter(row=>row.tick<=44)};
  const {report,output}=execute(open(kit,runPlan),{artifacts:true}), end=report.frames.at(-1);
  assert(end.strain.A.ratio>end.strain.B.ratio+.15);
  assert(end.strain.A.inverted===0&&end.strain.B.inverted===0);
  const get=name=>JSON.parse(JSON.stringify(output.find(row=>row.file===name).document));
  const log=get('materials.run.json'), checkpoint=get('checkpoints/20.json');
  const replay=R.openRecording(log,{checkpoint});
  replay.advance(log.end.tick);
  assert(R.checkpointsEqual(replay.checkpoint(),log.end));
});

test('headless CLI publishes an editable world and verified native recording',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-material-lab-'));
  const cli=path.join(__dirname,'../cli/ink-studio.js'), native=(...args)=>execFileSync(process.execPath,[cli,...args],{encoding:'utf8'});
  const file=path.join(dir,'plan.json'), out=path.join(dir,'run');
  try{
    fs.writeFileSync(file,JSON.stringify(plan({grains:{single:{at:[0,1,0],material:'grit'}}},{ticks:2,checkpoints:[1]})));
    const presets=JSON.parse(native('material-lab','presets'));
    assert(presets.materials.foam&&presets.constraints.hinge);
    const world=JSON.parse(native('material-lab','compile',file));
    native('material-lab','run',file,'--out',out);
    const read=name=>JSON.parse(fs.readFileSync(path.join(out,name),'utf8'));
    assert.deepEqual(world,read('materials.world.json'));
    assert.equal(read('checkpoints/1.json').tick,1);
    assert.deepEqual(JSON.parse(native('material-lab','run',file)),read('report.json'));
    assert.equal(JSON.parse(native('sim','verify',path.join(out,'materials.run.json'))).status,'verified');
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
