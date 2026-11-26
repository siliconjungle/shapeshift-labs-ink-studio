const assert=require('node:assert/strict');
const {test}=require('node:test');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const kit=require('..').load(), W=kit.KIT.world;
const {execute,lower}=require('../cli/solver-network.js');

const cli=path.resolve(__dirname,'../cli/ink-studio.js');
function work(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ink-solver-network-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const file=name=>path.join(root,name), read=name=>JSON.parse(fs.readFileSync(file(name),'utf8'));
  function write(name,doc) {
    fs.mkdirSync(path.dirname(file(name)),{recursive:true});
    fs.writeFileSync(file(name),JSON.stringify(doc)+'\n');
  }
  const call=(...args)=>spawnSync(process.execPath,[cli,...args],{cwd:root,encoding:'utf8',maxBuffer:8*1024**2});
  function run(...args){
    const result=call(...args);
    assert.equal(result.status,0,result.stderr);
    return result.stdout.trim().startsWith('{')?JSON.parse(result.stdout):undefined;
  }
  return {root,file,read,write,call,run};
}
function fixture(w){
  w.write('author/stages/gain.json',{format:'ink-studio/solver-stage',version:1,id:'gain',kind:'control',
    revision:1,config:{op:'scale',scale:2},ports:{inputs:{value:'number'},outputs:{value:'number'}}});
  const network={format:'ink-studio/solver-network',version:1,id:'typed-bench',revision:2,numerics:{dt:1/60},
    library:{gain:{file:'stages/gain.json',revision:1},
      values:{kind:'fields',revision:1,config:{fields:{warmth:{type:'number',units:'K',axes:'xz',default:12}}}}},
    stages:{key:{use:'gain',config:{scale:1}}, relay:{use:'gain'}, survey:{use:'values'}},
    connections:[{from:'key/value',to:'relay/value'}],
    inputs:{dial:'key/value'},outputs:{gain:'relay/value'},
    commands:[{tick:10,input:'dial',value:.25,id:'shared-pending'}]};
  w.write('author/stages/inner.json',{format:W.models.format,version:1,id:'inside',revision:4,seed:10,
    numerics:{dt:1/60},domain:{},parameters:{},initial:{},boundaries:{},operators:{pass:{kind:'control',revision:1}},
    inputs:{drive:'pass/value'},outputs:{result:'pass/value'},probes:{}});
  w.write('author/stages/module.json',{format:'ink-studio/solver-stage',version:1,id:'nested',kind:'simulation-model',
    revision:1,config:{model:{file:'inner.json',revision:4}},ports:{inputs:{drive:'number'},outputs:{result:'number'}}});
  network.library.module={file:'stages/module.json',revision:1};
  network.stages.child={use:'module'};
  network.connections.push({from:'relay/value',to:'child/drive'});
  network.outputs.child='child/result';
  w.write('author/network.json',network);
  w.write('author/commands.json',[{frame:3,input:'dial',value:.8}]);
  const plan={format:'ink-studio/solver-network-run',version:1,id:'compare',fps:24,network:'network.json',
    branches:{
      choice:{from:{branch:'hold',frame:2},to:5,frames:[2,3,4,5],commands:'commands.json',checkpoints:[4]},
      hold:{to:5,frames:[0,1,2,3,4,5],commands:[{frame:1,input:'dial',value:.4}]}
    },inspect:{grid:{kind:'field',field:'survey/warmth',samples:{grid:{min:[-1,0,0],max:[1,0,0],counts:[3,1,1]}}}}};
  w.write('author/run.json',plan);
  return {network,plan};
}

test('reused stage contracts, exact frame addresses, and pending commands survive branches',t=>{
  const w=work(t), {network,plan}=fixture(w);
  const index=lower(kit,network,w.file('author/network.json'));
  assert.equal(index.report.stages.relay.ports.outputs.value.type,'number');
  assert.equal(index.model.operators.key.config.scale,1);
  assert.equal(index.model.operators.relay.config.scale,2);
  const run=()=>execute(kit,plan,w.file('author/run.json'),()=>{},{artifacts:true});
  const {report,artifacts}=run();
  assert.deepEqual(run().report,report);
  assert.deepEqual(report.order,['hold','choice']);
  const parent=report.branches.hold, child=report.branches.choice;
  assert.deepEqual(parent.frames.map(row=>row.tick),[0,2,5,7,10,12]);
  assert.deepEqual(parent.frames[1].timecode,{numerator:1,denominator:24});
  assert.equal(parent.commands[0].tick,3);
  assert.deepEqual(parent.frames[2],child.frames[0]);
  assert.equal(child.commands[0].tick,8);
  assert.equal(child.frames[1].outputs.gain,.8);
  assert.equal(child.frames[2].outputs.gain,.5);
  assert.equal(parent.frames[4].outputs.gain,.5);
  assert.equal(parent.frames[2].inspect.grid.value.samples[0].value,12);
  assert.equal(parent.checkpoints[2].tick,5);
  const saved=JSON.parse(artifacts.find(row=>row.file===parent.checkpoints[2].file).bytes);
  assert.equal(saved.format,W.runtime.checkpointFormat);
  assert(saved.pending.some(row=>row.id==='shared-pending'));
});

test('invalid stage contracts, branch cycles and interventions in the committed past fail',t=>{
  const w=work(t), {network,plan}=fixture(w), owner=w.file('author/run.json');
  const source=w.read('author/stages/gain.json');
  w.write('author/stages/gain.json',{...source,ports:{outputs:{value:'bool'}}});
  assert.throws(()=>lower(kit,network,w.file('author/network.json')),/expected bool but resolved number/);
  w.write('author/stages/gain.json',source);
  const cyclic={...plan,branches:{...plan.branches,hold:{...plan.branches.hold,from:{branch:'choice',frame:2},frames:[2,5]}}};
  assert.throws(()=>execute(kit,cyclic,owner),/Cyclic solver branch/);
  const invalid={...plan,branches:{...plan.branches,choice:{...plan.branches.choice,commands:[{frame:2,input:'dial',value:1}]}}};
  assert.throws(()=>execute(kit,invalid,owner),/outside its editable committed tick range/);
});

test('portable networks reopen an exported checkpoint and verify after their source tree is moved',t=>{
  const w=work(t),{plan}=fixture(w);
  w.run('solver-network','run','author/run.json','--out','author/bake');
  const report=w.read('author/bake/report.json'), historic=report.branches.hold.checkpoints[2];
  const external={...plan,branches:{
    resumed:{...plan.branches.choice,from:{checkpoint:'bake/'+historic.file,frame:2}}
  }};
  w.write('author/resume.json',external);
  const resumed=w.run('solver-network','run','author/resume.json');
  assert.deepEqual(resumed.branches.resumed.frames,report.branches.choice.frames);
  w.write('author/experiment.json',{format:'ink-studio/simulation-experiment',version:1,id:'portable-solver',runs:{
    full:{kind:'solver-network',source:'run.json',expected:'bake/report.json'},
    resume:{kind:'solver-network',source:'resume.json',expected:'resume-expected.json'}}});
  w.write('author/resume-expected.json',resumed);
  w.run('project','pack','author/experiment.json','--root','author','--out','exchange.json');
  const packed=w.read('exchange.json');
  assert(Object.hasOwn(packed.files,'stages/gain.json'));
  assert(Object.hasOwn(packed.files,'commands.json'));
  assert(Object.hasOwn(packed.files,'stages/inner.json'));
  assert(Object.hasOwn(packed.files,'bake/'+historic.file));
  fs.renameSync(w.file('author'),w.file('relocated'));
  const verification=w.run('project','verify','exchange.json');
  assert.equal(verification.passed,true,JSON.stringify(verification));
  assert.equal(verification.runs.full.status,'matched');
  assert.equal(verification.runs.resume.status,'matched');
});
