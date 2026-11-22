/* The host owns the inspection model and publishes a portable snapshot. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function world(source) {
  const result = JSON.parse(JSON.stringify(source));
  const {station,bench,crew} = result.systems;
  result.id = 'bench-inspection-host';
  const {raw,approved} = station.config.accounts;
  result.systems.station = {kind:'story-host',config:{
    initial:{benchOpen:false,inspections:0,balances:{raw:raw.initial,approved:approved.initial}},
    fields:{'bench-open':{type:'boolean'}}, operations:['approve'], events:['inspection-signed'],
    accounts:Object.fromEntries(Object.entries({raw,approved}).map(([name,{initial,...spec}])=>[name,spec]))
  }};
  bench.config.targets.crate.verbs.inspect.effect = {action:'station/approve',args:{amount:2}};
  crew.config.orders.tasks.inspect.steps.unshift({op:'wait',field:'station/bench-open',when:{value:true}});
  return result;
}

const capabilities = {
  version:1,
  step(state,{tick}) {
    return {state:tick>=2&&!state.benchOpen?{...state,benchOpen:true}:state};
  },
  read(state,{field}) {
    return field==='bench-open'?{status:'ok',value:state.benchOpen}:{status:'missing',reason:'Unknown bench field'};
  },
  perform(state,{operation,actor,args,attempt}) {
    assert.equal(operation,'approve');
    const {amount} = args;
    const {raw,approved} = state.balances, id = 'inspection-'+(state.inspections+1);
    if (!state.benchOpen||!Number.isSafeInteger(amount)||amount<1||raw<amount)
      return {status:'blocked',reason:'inspection-unavailable',receipt:{id,detail:{available:raw}}};
    const detail = {by:actor.id,parts:amount,method:'host-bench'};
    return {status:'applied',receipt:{id,detail},events:[{kind:'inspection-signed',detail:{attempt,receipt:id,...detail}}],
      state:{...state,inspections:state.inspections+1,balances:{raw:raw-amount,approved:approved+amount}}};
  }
};

function runDemo(root,directory) {
  const { KIT } = require(root).load(), {runtime,storyHosts,storyEvents} = KIT.world;
  const file = path.join(directory,'bench-inspection.world.json');
  const { embedStoryDocuments } = require(path.join(root,'cli/story-document.js'));
  const source = world(embedStoryDocuments(JSON.parse(fs.readFileSync(file,'utf8')),file));
  const options = {implementations:{'story-host':storyHosts.adapter(capabilities)}};
  const write = (name,value) => fs.writeFileSync(path.join(directory,name),JSON.stringify(value,null,2)+'\n');
  write('host-preflight.json',runtime.storyPreflight(source,options));
  const run = runtime.create(source,options), events = [];
  run.advance(12,{onTick:()=>events.push(...run.events)});
  const recording = run.recording();
  assert.deepEqual(runtime.replay(recording,options).checkpoint(),run.checkpoint());
  const scenario = run.query().probe('world/story-lifecycle').value['bench-inspection/release'];
  assert.equal(scenario.outcome,'shipped');
  const proof = scenario.flow.route[0].objectives.approved.receipt.event.receipt;
  assert.equal(proof.detail.parts,2);
  assert.equal(run.query().probe('world/account',undefined,{account:'harbor/pier'}).value.balance,2);
  write('host-receipt.json',proof);
  write('host.run.json',recording);
  write('host.events.json',storyEvents.read({format:storyEvents.format,version:1,id:source.id,
    dt:source.dt,from:0,to:12,coverage:'complete',dropped:0,events}));
}

if (require.main===module) runDemo(path.resolve(process.argv[2]??'.'),path.resolve(process.argv[3]??__dirname));
module.exports = {world,capabilities};
