const assert = require('node:assert/strict');
const {test} = require('node:test');
const {execFileSync} = require('node:child_process');
const path = require('node:path');
const {load} = require('..');
const {embedStoryDocuments} = require('../cli/story-document.js');
const example = '../examples/story-documents/';
const bench = require(example+'bench-inspection.host.cjs');
const {runtime:R,storyHosts:H,storyEvents:E} = load().KIT.world;
const copy = value=>JSON.parse(JSON.stringify(value));
const fixture = example+'bench-inspection.world.json';
const source = () => embedStoryDocuments(copy(require(fixture)),path.resolve(__dirname,fixture));
const options = (overrides={}) => ({implementations:{'story-host':H.adapter({...bench.capabilities,...overrides})}});
const probe = (run,field,args) => run.query().probe(field,undefined,args).value;
const key = 'bench-inspection/release';
const lifecycle = run => probe(run,'world/story-lifecycle')[key];
const balance = (run,account) => probe(run,'world/account',{account}).balance;
const order = run => probe(run,'crew/orders',{agent:'mira'}).outcomes.at(-1);
const imported = () => copy(require(example+'bench-inspection.imported.events.json'));

test('the same story can authorize a native interaction or a host operation and settle into native accounts', () => {
  const native = R.create(source()), world = bench.world(source()), config = options(), host = R.create(world,config);
  assert.throws(()=>R.create(world),/Unknown or reserved system station/);
  assert.equal(R.storyPreflight(world,config).valid,true);
  assert.equal(probe(host,'station/bench-open'),false);
  host.advance(2);
  assert.equal(probe(host,'station/bench-open'),true);
  const saved = copy(host.checkpoint()), resumed = R.create(saved.world,{...config,checkpoint:saved});
  native.advance(12);
  host.advance(12);
  resumed.advance(12);
  assert.deepEqual(resumed.checkpoint(),host.checkpoint());
  assert.deepEqual(R.replay(copy(host.recording()),config).checkpoint(),host.checkpoint());

  const nativeProof = lifecycle(native).flow.route[0].objectives.approved.receipt.event.receipt;
  const hostProof = lifecycle(host).flow.route[0].objectives.approved.receipt.event.receipt;
  assert.equal(nativeProof.applied,2);
  assert.equal(hostProof.format,H.format);
  assert.equal(hostProof.detail.parts,2);
  assert.equal(hostProof.status,'applied');
  assert.deepEqual(order(host).results.at(-1).receipt,hostProof);
  assert.deepEqual(probe(host,'bench/attempts',{id:hostProof.attempt}).receipt,hostProof);
  assert.equal(host.history.filter(row=>row.kind==='inspection-signed').length,1);
  for (const run of [native,host]) {
    assert.equal(lifecycle(run).outcome,'shipped');
    assert.deepEqual(['station/raw','station/approved','harbor/pier'].map(account=>balance(run,account)),[0,0,2]);
  }
  const damage = copy(host.checkpoint());
  damage.states.bench.outcomes[0].receipt.attempt = 'different-attempt';
  assert.throws(()=>R.create(damage.world,{...config,checkpoint:damage}),/Invalid saved interaction outcome/);
});

test('a refused operation retains its receipt and leaves the story, accounts and host state uncommitted', () => {
  const config = options({perform:()=>({status:'blocked',reason:'bench-closed',receipt:{id:'closed-bench',detail:{retry:true}}})});
  const run = R.create(bench.world(source()),config);
  run.advance(12);
  const attempts = probe(run,'bench/attempts').outcomes;
  assert.equal(attempts[0].status,'failed');
  assert.equal(attempts[0].receipt.status,'blocked');
  assert.equal(order(run).phase,'failed');
  assert.deepEqual(order(run).results.at(-1).receipt,attempts[0].receipt);
  assert.equal(lifecycle(run).status,'active');
  assert.deepEqual(lifecycle(run).flow.current.objectives,{});
  assert.deepEqual(['station/raw','station/approved','harbor/pier'].map(account=>balance(run,account)),[2,0,0]);
  assert.equal(run.history.some(row=>row.kind==='inspection-signed'),false);
  const saved = copy(run.checkpoint());
  assert.deepEqual(R.create(saved.world,{...config,checkpoint:saved}).checkpoint(),run.checkpoint());
});

test('malformed host outputs fail transactionally and typed reads enforce their declared shape', () => {
  const world = bench.world(source());
  const malformed = R.create(world,options({read:()=>({status:'ok',value:'open'})}));
  assert.throws(()=>probe(malformed,'station/bench-open'),/Wrong value type/);
  const invalid = R.create(world,options({perform:state=>({
    status:'blocked',reason:'bench-closed',receipt:{id:'rejected'},state:{...state,changed:true}
  })}));
  invalid.advance(5);
  const before = invalid.checkpoint();
  assert.throws(()=>invalid.step(),/Invalid story host operation result/);
  assert.deepEqual(invalid.checkpoint(),before);
  const noEffects = options({step:state=>({state,events:[{kind:'unexpected'}]})});
  assert.throws(()=>R.create(world,noEffects).step(),/Undeclared or invalid host event/);
});

test('recordings provide analysis and playable cues without a story world or host implementation', () => {
  const record = imported(), selection = {story:'archive/send-signal'}, report = E.analyze(record,selection);
  assert.deepEqual(report.timeline.map(row=>row.event.id),record.events.map(event=>event.id));
  assert.equal(report.stories[selection.story].outcome,'sent');
  assert.equal(report.timeline.find(row=>row.event.id==='switch-confirmed').time,1.5);
  const timeline = E.timeline(record,selection);
  const playback = R.create({id:'presentation',dt:record.dt,timeline,eventActions:{
    highlight:{on:{kind:'story-cue',where:{path:'/outcome',value:'sent'}},
      actions:[{action:'world/event',args:{kind:'presentation-highlight'}}]}
  }});
  playback.advance(record.to);
  assert.equal(playback.timeline.duration,3);
  assert.equal(playback.history.find(event=>event.kind==='presentation-highlight').tick,8);
  assert.deepEqual(playback.history.filter(event=>event.kind==='story-cue').map(event=>[event.tick,event.sourceEvent]),
    record.events.map(event=>[event.tick,event.id]));
  const duplicate = imported();
  duplicate.events[3].id = duplicate.events[2].id;
  assert.throws(()=>E.read(duplicate),/unique and events must be in tick order/);
  const unsorted = imported();
  unsorted.events[4].tick = 1;
  assert.throws(()=>E.read(unsorted),/unique and events must be in tick order/);
  const cli = path.resolve(__dirname,'../cli/ink-studio.js');
  const text = execFileSync(process.execPath,[cli,'story','events',path.resolve(__dirname,example+'bench-inspection.imported.events.json'),
    '--story',selection.story,'--format','markdown'],{encoding:'utf8'});
  assert.match(text,/Coverage complete/);
  assert.match(text,/1\.500000 \| 6 \| switch-confirmed/);
});

test('retained native history can be inspected offline and merges the final tick in commit order', () => {
  const world = bench.world(source());
  world.history = {where:{path:'/kind',value:'story-branch-chosen'}};
  const host = R.create(world,options());
  host.advance(6);
  const archive = E.read(copy(host.recording()));
  assert.equal(archive.coverage,'retained');
  assert.deepEqual(archive.events,host.events);
  const report = E.analyze(archive,{story:key});
  assert.equal(report.hostReceipts[0].id,'inspection-1');
  assert.equal(report.stories[key].outcome,'shipped');
});
