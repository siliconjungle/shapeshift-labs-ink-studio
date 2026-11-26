const assert = require('node:assert/strict');
const {test} = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {KIT:K} = require('..').load();
const {prepare} = require('../cli/channel-tools.js');
const {compile} = require('../cli/character-rig-assembly.js');
const WAV = require('../cli/wav.js');

const cli = path.resolve(__dirname,'../cli/ink-studio.js');
const ratio = (numerator,denominator=1)=>({numerator,denominator});
function work(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'ink-channels-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const file = name=>path.join(root,name);
  const write = (name,value)=>fs.writeFileSync(file(name),JSON.stringify(value));
  const call = (...args)=>spawnSync(process.execPath,[cli,...args],{cwd:root,encoding:'utf8'});
  const run = (...args)=>{
    const child=call(...args);
    assert.equal(child.status,0,child.stderr);
    return JSON.parse(child.stdout);
  };
  return {file,write,call,run};
}
function fixtures(w) {
  w.write('wave.json',{format:'ink-studio/sample-trace',version:1,sampleRate:8,startSample:1,frames:8,
    channels:{probe:{unit:'Pa',samples:[0,2,4,6,8,10,12,14]}}});
  fs.writeFileSync(w.file('rec.wav'),WAV.encode({sampleRate:8,channels:1,samples:[.25,-.25,.5,-.5,.75,-.75]},
    {encoding:'pcm24',bwf:{timeReference:2}}));
  const rig={format:'ink-studio/character-rig',version:1,id:'hinge',components:[],joints:[
    {id:'arm.pivot',parent:null,at:[0,0,0],limit:{type:'hinge',axis:[0,0,1],angle:[0,90]}}
  ]};
  w.write('rig.json',rig);
  w.write('motion.json',{format:'ink-studio/character-motion',version:1,id:'signal',rigHash:compile(rig,K).hash,
    clips:{bend:{type:'curves',duration:1,joints:{'arm.pivot':[{time:0,value:[0]},{time:1,value:[60]}]}}}});
  return {format:'ink-studio/channel-plan',version:1,id:'check',clock:{rate:4,frames:4},
    sources:{wave:{kind:'simulation',file:'wave.json',offset:ratio(-1,8)},rec:{kind:'audio',file:'rec.wav'},
      rig:{kind:'animation',file:'motion.json',rig:'rig.json',clip:'bend'}},
    stages:{
      rms:{op:'resample',input:'rec/ch1',method:'rms'},
      slow:{op:'filter',mode:'lowpass',input:'rms',seconds:1/(4*Math.log(2))},
      mapped:{op:'filter',mode:'map',input:'rig/arm.pivot.angle',map:{input:[0,60],output:[0,1],unit:'FS'}},
      combined:{op:'blend',missing:'zero',inputs:[{input:'slow',weight:.5},{input:'mapped',weight:.5}]},
      fractional:{op:'resample',input:'wave/probe',method:'mean',clock:{rate:4,start:ratio(1,16),frames:2}}
    },traces:{pcm:'rms',filter:'slow',arm:'rig/arm.pivot.angle',mix:'combined',probe:'wave/probe'},
    routes:{brightness:{input:'combined',map:{input:[0,1],output:[0,12]}}}};
}

test('native audio origins, simulation clocks and animation phases align on one exact grid',t=>{
  const w=work(t), plan=fixtures(w), owner=w.file('plan.json');
  const build=()=>prepare(plan,owner,K);
  const index=build().output('discover');
  assert.deepEqual(index.sources.rec.clock.origin,ratio(1,4));
  assert.equal(index.sources.rec.timeReference,'2');
  assert.deepEqual(index.sources.wave.clock.origin,ratio(0));
  assert.deepEqual(index.sources.rig.channels['arm.pivot.angle'].axis,[0,0,1]);
  const report=build().output('run');
  assert.deepEqual(report,build().output('run'));
  assert.deepEqual(report.timecodes,[ratio(0),ratio(1,4),ratio(1,2),ratio(3,4)]);
  assert.deepEqual(report.traces.pcm.values,[null,.25,.5,.75]);
  assert.deepEqual(report.traces.filter.values,[null,.25,.375,.5625]);
  assert.deepEqual(report.traces.arm.values.map(Math.round),[0,15,30,45]);
  assert.deepEqual(report.traces.probe.values,[0,4,8,12]);
  assert.deepEqual(report.traces.mix.values,[0,.25,.4375,.65625]);
  assert.deepEqual(report.controls.brightness.values,[0,3,5.25,7.875]);
  assert.deepEqual(build().output('resample','fractional').traces.fractional.values,[2,6]);
  w.write('plan.json',plan);
  assert.equal(w.run('channels','filter','plan.json','slow').traces.slow.values[2],.375);
  assert.equal(w.run('channels','blend','plan.json','combined').traces.combined.values[3],.65625);
  assert(w.call('channels','run','plan.json','--out','wave.json').status!==0);
});

test('routes retain gaps, reject incompatible units and fail on cycles',t=>{
  const w=work(t), plan=fixtures(w), owner=w.file('plan.json');
  plan.routes.direct={input:'rms',fallback:-1};
  assert.deepEqual(prepare(plan,owner,K).output('route').controls.direct.values,[-1,.25,.5,.75]);
  plan.stages.combined.inputs.push({input:'wave/probe'});
  assert.throws(()=>prepare(plan,owner,K).output('blend','combined'),/same unit/);
  plan.stages.combined.inputs.pop();
  plan.stages.rms.input='slow';
  assert.throws(()=>prepare(plan,owner,K).output('route'),/Cyclic channel stage/);
});

test('graph clip replays routed numeric controls on exact frames and keys the cache by route',t=>{
  const w=work(t), plan=fixtures(w);
  plan.clock={rate:ratio(24000,1001),start:ratio(1001,24000),frames:2};
  plan.routes={brightness:{input:'rig/arm.pivot.angle',map:{input:[0,6],output:[1,15]}}};
  w.write('plan.json',plan);
  const route=w.run('channels','route','plan.json','--out','routed.json');
  assert.deepEqual(route.timecodes,[ratio(1001,24000),ratio(1001,12000)]);
  w.write('graph.json',{format:'ink-studio/graph-project',version:1,inputs:{controls:{type:'record'}},nodes:{
    bind:{op:'scene.bindControls',inputs:{controls:{input:'controls'},template:{commands:[
      {type:'rect',rect:[0,0,16,16],fill:'#112233'},{type:'rect',rect:[0,0,1,16],fill:'#f0a17a'}]},
      targets:[{control:'brightness',path:'/commands/1/rect/2'}]}},
    get:{op:'data.get',inputs:{record:{node:'bind'},key:'commands'}},
    draw:{op:'draw.render',inputs:{width:16,height:16,edges:'hard',commands:{node:'get'}}}
  },outputs:{picture:{node:'draw'}}});
  const args=['graph','clip','graph.json','--output','picture','--from','1','--to','3','--fps','24000/1001',
    '--out','frames','--cache','cache','--controls','routed.json'];
  const initial=w.run(...args);
  assert.deepEqual(initial.controlRoute.names,['brightness']);
  assert.notEqual(initial.frames[0].sha256,initial.frames[1].sha256);
  w.write('routed.json',{...route,controls:{brightness:{values:[3,3]}}});
  const changed=w.run(...args);
  assert.notEqual(changed.controlRoute.sha256,initial.controlRoute.sha256);
  assert.equal(changed.frames[0].sha256,changed.frames[1].sha256);
  assert.match(w.call(...args,'--warmup','1').stderr,/including warmup/);
  w.write('routed.json',{...route,controls:{brightness:{values:[3,null]}}});
  assert.match(w.call(...args).stderr,/gap at graph frame 2/);
});
