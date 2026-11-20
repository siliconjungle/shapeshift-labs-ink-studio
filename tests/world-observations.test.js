const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const studio=require('..');
const {KIT:{world:W}}=studio.load();
const signal=(port,ticks)=>({field:'world/signal',args:{port},...(ticks&&{ticks})});
const input=(tick,port,value)=>({tick,action:'world/input',args:{port,value}});
const find=(group,observation,tick)=>group.summary.find(row=>row.observation===observation&&row.tick===tick);
const meter=({gain=1},{world})=>({initial:()=>0,inputs:{level:'number'},outputs:{total:'number'},
  step:(_,ctx)=>ctx.input.level*gain+world.seed,output:state=>({total:state}),
  fields:{reading:{type:'record',read:({state})=>W.query.ok({total:state})},
    number:{type:'number',units:'m',read:({state})=>W.query.ok(state)}}});
const runtime={implementations:{meter}};
const source={format:'ink-studio/world',id:'meter',dt:.2,systems:{meter:{kind:'meter',config:{gain:1}}}};

test('a reusable plan aligns heterogeneous schedules across all seeds and settings',()=>{
  const plan=W.observations.prepare({ticks:{from:1,to:6,every:2},seeds:[2,5],observations:{
    total:{field:'meter/number'}, projected:{field:'meter/reading',path:'/total',ticks:[4,2,4],units:'m'}
  },parameters:{
    gain:{path:'/systems/meter/config/gain',values:[2,4]},
    level:{port:'meter/level',values:[1,3]}
  }});
  const result=plan.run(source,{runtime});
  assert.equal(result.format,W.observations.format);
  assert.equal(result.runs.length,8);
  assert.deepEqual(result.groups.map(row=>row.parameters),[
    {gain:2,level:1},{gain:2,level:3},{gain:4,level:1},{gain:4,level:3}
  ]);
  assert.deepEqual(plan.observations.map(item=>item.ticks),[[1,3,5,6],[2,4]]);
  assert.deepEqual(result.runs[0].samples.map(s=>[s.tick,s.observation]),
    [[1,'total'],[2,'projected'],[3,'total'],[4,'projected'],[5,'total'],[6,'total']]);
  assert.deepEqual(find(result.groups[0],'total',6),{observation:'total',tick:6,time:1.2000000000000002,
    count:2,available:2,units:'m',numeric:{count:2,min:4,max:7,mean:5.5}});
  assert.deepEqual(find(result.groups[3],'projected',4).numeric,{count:2,min:14,max:17,mean:15.5});
  assert.deepEqual(plan.run(source,{runtime}),result);
  assert(Object.isFrozen(result.groups[0].summary));
  assert.equal(source.systems.meter.config.gain,1);
});

test('missing values, valid zeros and incompatible units remain distinguishable in paired tick summaries',()=>{
  const read=(config,{world})=>({initial:()=>null,fields:{
    wet:{type:'number',units:'m',read:()=>world.seed===1?W.query.ok(0):{status:'dry',value:0}},
    mixed:{type:'number',units:world.seed===1?'m':'cm',read:()=>W.query.ok(1)},
    shape:{type:'record',read:()=>W.query.ok({tag:'stable'})}
  }});
  const report=W.observations.run({systems:{gauge:{kind:'read'}}},{ticks:[0],seeds:[1,2],observations:{
    wet:{field:'gauge/wet'}, mixed:{field:'gauge/mixed'},
    absent:{field:'gauge/shape',path:['absent']}, category:{field:'gauge/shape',path:['tag']}
  }},{runtime:{implementations:{read}}});
  const [first,second]=report.runs;
  assert.equal(first.samples[0].value,0);
  assert.equal(second.samples[0].status,'dry');
  assert.equal(second.samples[0].value,0);
  assert.equal(first.samples[2].status,'missing');
  assert.equal(first.samples[3].value,'stable');
  const group=report.groups[0];
  assert.deepEqual(find(group,'wet',0).numeric,{count:1,min:0,max:0,mean:0});
  assert.equal(find(group,'wet',0).available,1);
  assert.equal(find(group,'mixed',0).mixedUnits,true);
  assert.equal(find(group,'mixed',0).numeric,null);
  assert.equal(find(group,'absent',0).available,0);
  assert.equal(find(group,'category',0).numeric,null);
  assert.throws(()=>W.observations.run(source,{ticks:[0],observations:{value:{field:'meter/number',units:'cm'}}},{runtime}),
    /units do not match/);
});

test('checkpoint and recording inputs keep pending commands while branching live parameter changes',()=>{
  const world={format:'ink-studio/world',id:'stored',dt:.25,seed:4,
    systems:{meter:{kind:'control',config:{op:'scale',scale:2}}}};
  const run=W.runtime.create(world);
  run.schedule([input(6,'meter/value',9)]);
  run.advance(3);
  const checkpoint=run.checkpoint();
  const plan={ticks:[3,4,6],seeds:[4],observations:{total:signal('meter/value')},
    parameters:{level:{port:'meter/value',values:[1,3]}}};
  const report=W.observations.run(checkpoint,plan);
  assert.deepEqual(report.runs.map(row=>row.samples.map(s=>s.value)),[[0,2,18],[0,6,18]]);
  assert.deepEqual(W.observations.run(JSON.parse(JSON.stringify(run.recording())),plan),report);
  assert.equal(run.checkpoint(),checkpoint);
  assert.throws(()=>W.observations.run(checkpoint,{...plan,seeds:[3]}),/Checkpoint observations/);
  assert.throws(()=>W.observations.run(checkpoint,{...plan,ticks:[2]}),/precedes the starting checkpoint/);
});

test('common, case and factor changes apply in order without mutating the reusable plan',()=>{
  const plan=W.observations.prepare({ticks:[1,2],observations:{value:signal('meter/total')},
    actions:[input(1,'meter/level',2)],
    cases:[{id:'base'},{id:'high',edits:[{op:'set',path:'/systems/meter/config/gain',value:4}],
      actions:[input(1,'meter/level',8)]}],
    parameters:{level:{port:'meter/level',tick:2,values:[3]}}
  });
  const report=plan.run(source,{runtime,actions:[input(1,'meter/level',99)]});
  assert.deepEqual(report.runs.map(row=>row.samples.map(sample=>sample.value)),[[3,4],[33,13]]);
  assert.deepEqual(report.groups.map(row=>row.case),['base','high']);
  assert.throws(()=>W.observations.prepare({observations:{none:signal('meter/total')}}),/No tick schedule/);
  assert.throws(()=>W.observations.prepare({ticks:[0],observations:{none:signal('x/y')},seeds:[2,2]}),
    /distinct safe integers/);
  assert.throws(()=>W.observations.prepare({ticks:{from:0,to:100000},observations:{none:signal('x/y')}}),
    /sample budget/);
  assert.throws(()=>W.observations.prepare({ticks:[0],observations:{none:signal('x/y')},
    parameters:{a:{path:'/dt',values:[1]},b:{path:['dt'],values:[.2]}}}),/distinct paths/);
});

test('observations send eligible systems through the existing workers without changing the report',t=>{
  const workers=studio.createSimulationWorkers(2);
  t.after(()=>workers.close());
  const world={dt:.1,systems:{pond:{kind:'water',config:{width:3,height:2,rain:.03}}}};
  const plan=W.observations.prepare({ticks:[1,2,4],seeds:[4,8],observations:{
    depth:{field:'pond/depth',at:[.5,0,.5]}
  },parameters:{rain:{path:'/systems/pond/config/rain',values:[.03,.07]}}});
  assert.deepEqual(plan.run(world,{runtime:{workerPool:workers}}),plan.run(world));
});

test('sim sweep writes the shared schedule report and still accepts legacy sweep arrays',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-observations-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const world={format:'ink-studio/world',id:'sweep',dt:.1,seed:10,
    systems:{meter:{kind:'control',config:{op:'scale',scale:2}}}};
  const spec={ticks:[0,2],seeds:[3,4],observations:{amount:signal('meter/value')},
    parameters:{input:{port:'meter/value',values:[1,2]}}};
  const write=(name,value)=>{
    const file=path.join(dir,name);
    fs.writeFileSync(file,JSON.stringify(value));
    return file;
  };
  const source=write('world.json',world), observation=write('plan.json',spec), out=path.join(dir,'report.json');
  const cli=path.resolve(__dirname,'../cli/ink-studio.js');
  const run=(file,...args)=>execFileSync(process.execPath,[cli,'sim','sweep',source,file,...args],{encoding:'utf8'});
  run(observation,'--out',out);
  assert.deepEqual(JSON.parse(fs.readFileSync(out)),JSON.parse(JSON.stringify(W.observations.run(world,spec))));
  const old=JSON.parse(run(write('cases.json',[{id:'old',ticks:2,
    actions:[input(1,'meter/value',5)],probes:[signal('meter/value')]}])));
  assert.equal(old.runs[0].measurements[0].value,10);
});
