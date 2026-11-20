const test=require('node:test');
const assert=require('node:assert/strict');
const {KIT:{world:W}}=require('..').load();
const json=value=>JSON.parse(JSON.stringify(value));
const command=(tick,action,args)=>({tick,action,args});
const event=(tick,kind,detail)=>command(tick,'world/event',{kind,...detail});
const read=run=>run.query().probe('game/status').value;
const gate=run=>run.query().frame({entity:'door'}).point[1];

function mission(){
  return {dt:.1,systems:{
    game:{kind:'gameplay',config:{
      inputs:{authorized:{type:'bool',default:true}},
      timers:{window:{ticks:8}},
      objectives:{recover:{target:2,active:false,fail:{timer:'window'}},
        readout:{active:true,complete:{probe:'sensor/safe',at:[0,0,0],when:{op:'gte',value:1}}}},
      states:{
        idle:{transitions:[{to:'searching',when:{all:[{input:'authorized'},
          {event:'start',when:{path:'/detail/console',value:'east'}}]}}]},
        searching:{enter:[{kind:'timer',timer:'window',op:'start'},{kind:'objective',objective:'recover',op:'activate'}],
          transitions:[{to:'failed',when:{timer:'window'}},
            {to:'access',when:{all:[{objective:'recover'},{objective:'readout'}]}}]},
        access:{enter:[{kind:'timer',timer:'window',op:'pause'}]},failed:{}
      }
    }},
    sensor:{kind:'fields',config:{fields:{safe:{default:1}}}},
    drive:{kind:'control',config:{op:'choose'}},
    rig:{kind:'mechanics',config:{gravity:[0,0,0],
      bodies:{door:{position:[0,.6,0],half:[.15,.6,1]}},joints:{
        gate:{kind:'slider',mode:'position',child:'door',anchor:[0,.6,0],range:[0,1.4],speed:7}
      }}}
  },connections:[
    {from:'game/state.access',to:'drive/enabled'},{from:'drive/value',to:'rig/drive.gate'}
  ],eventActions:{
    begin:{on:{kind:'console-used',system:'world'},actions:[
      {action:'game/signal',args:{kind:'start',detail:{console:'west'}},bindings:{'/detail/console':'/console'}}
    ]},
    pickup:{on:{kind:'picked-up',where:{path:'/item',value:'cell'}},limit:2,actions:[
      {action:'game/objective',args:{objective:'recover',op:'advance'}}
    ]},
    release:{on:{kind:'gameplay-state-changed',system:'game',where:{path:'/to',value:'access'}},
      actions:[{action:'world/event',args:{kind:'authorized-passage'}}]}
  },commands:[
    command(1,'world/input',{port:'drive/b',value:1.4}),
    event(1,'console-used',{console:'east'}),
    event(3,'picked-up',{item:'cell'})
  ]};
}

test('gameplay events start a timed objective whose completion drives a scene actuator',()=>{
  const run=W.runtime.create(mission());
  run.advance(4);
  assert.equal(read(run).state.id,'searching');
  assert.deepEqual(read(run).timers.window,{status:'running',due:10,ticks:8,remaining:6});
  assert.deepEqual(read(run).objectives.recover,{status:'active',progress:1,target:2});
  assert.equal(read(run).objectives.readout.status,'completed');
  assert.equal(gate(run),.6);
  const checkpoint=json(run.checkpoint()), restored=W.runtime.create(checkpoint.world,{checkpoint}), late=run.fork();
  for(const current of [run,restored]){
    current.schedule([event(5,'picked-up',{item:'cell'})]);
    current.advance(6);
    assert.deepEqual(read(current).state,{id:'access',previous:'searching',enteredTick:6});
    assert.equal(read(current).objectives.recover.progress,2);
    assert.equal(read(current).timers.window.status,'paused');
    assert.equal(current.query().probe('signal',{}, {port:'game/state.access'}).value,true);
    assert(current.events.some(row=>row.kind==='event-action-scheduled'&&row.rule==='release'));
    current.advance(8);
    assert.equal(gate(current),2);
    assert.equal(current.history.filter(row=>row.kind==='authorized-passage').length,1);
  }
  late.advance(11);
  assert.equal(read(late).state.id,'failed');
  assert.equal(read(late).objectives.recover.status,'failed');
  assert.equal(read(late).timers.window.status,'expired');
  assert.equal(gate(late),.6);
  assert.deepEqual(run.checkpoint(),restored.checkpoint());
  assert.deepEqual(W.runtime.replay(json(run.recording())).checkpoint(),run.checkpoint());
  assert.deepEqual(W.runtime.replay(json(late.recording())).checkpoint(),late.checkpoint());
});

test('slow gameplay updates retain commands and measure paused timers in world ticks',()=>{
  const world={systems:{game:{kind:'gameplay',schedule:{every:3},config:{timers:{round:{ticks:6}}}}},
    commands:['start','pause','resume'].map((op,i)=>command(1+i*3,'game/timer',{timer:'round',op}))};
  const run=W.runtime.create(world);
  run.advance(2);
  assert.equal(read(run).pending,1);
  const checkpoint=json(run.checkpoint()), restored=W.runtime.create(checkpoint.world,{checkpoint});
  for(const current of [run,restored]){
    current.advance(3);
    assert.equal(read(current).timers.round.due,7);
    current.advance(6);
    assert.deepEqual(read(current).timers.round,{status:'paused',remaining:3,ticks:6});
    current.advance(9);
    assert.equal(read(current).timers.round.due,10);
    current.advance(12);
    assert.deepEqual(read(current).timers.round,{status:'expired',due:10,remaining:0,ticks:6});
    assert.equal(current.history.filter(row=>row.kind==='gameplay-timer-expired').length,1);
  }
  assert.deepEqual(run.checkpoint(),restored.checkpoint());
});

test('a buffered signal triggers only one transition and the first matching edge wins',()=>{
  const world={systems:{game:{kind:'gameplay',schedule:{substeps:4},config:{
    states:{
      idle:{transitions:[{to:'first',when:{event:'fire'}},{to:'other',when:{event:'fire'}}]},
      first:{transitions:[{to:'other',when:{event:'fire'}}]},other:{}
    }
  }}},commands:[
    command(1,'world/input',{port:'game/signals',value:[{kind:'fire'}]}),
    command(2,'game/signal',{kind:'fire'})
  ]};
  const run=W.runtime.create(world);
  run.step();
  assert.equal(read(run).state.id,'first');
  assert.equal(run.events.filter(row=>row.kind==='gameplay-state-changed').length,1);
  const signals=run.query().probe('signal',{}, {port:'game/events'}).value;
  assert.equal(signals.filter(row=>row.kind==='gameplay-state-changed').length,1);
  run.step();
  assert.equal(read(run).state.id,'other');
});

test('gameplay validates state references and rejects corrupted timer checkpoints',()=>{
  const world=mission();
  world.systems.game.config.states.idle.transitions[0].to='unknown';
  assert.throws(()=>W.runtime.create(world),/Invalid gameplay transition/);
  const invalidProbe=mission();
  invalidProbe.systems.game.config.objectives.readout.complete.probe='sensor/missing';
  assert.throws(()=>W.runtime.create(invalidProbe),/Unknown gameplay probe/);
  const run=W.runtime.create(mission());
  run.advance(4);
  const saved=json(run.checkpoint());
  saved.states.game.timers.window.due=-1;
  assert.throws(()=>W.runtime.create(saved.world,{checkpoint:saved}),/Invalid saved gameplay timer/);
});
