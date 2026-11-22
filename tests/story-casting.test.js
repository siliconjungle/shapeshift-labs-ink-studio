const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { load } = require('..');

const R = load().KIT.world.runtime;
const read = name => JSON.parse(fs.readFileSync(path.resolve(__dirname, '../examples/story-documents', name), 'utf8'));
const cast = (run, spec) => run.query().probe('world/story-candidates', undefined, spec).value;
const winners = report => report.candidates.filter(candidate => candidate.qualifies);
const row = (report, agent) => report.candidates.find(candidate => candidate.agent === agent);
const roundTrip = value => JSON.parse(JSON.stringify(value));

test('casting reads live multi-roster evidence and gives the same explanations after replay', () => {
  const input = read('beacon-casting.world.json'), spec = read('beacon-casting.query.json');
  const run = R.create(input), origin = run.checkpoint();
  const before = cast(run, spec);
  assert.deepEqual(run.checkpoint(), origin);
  assert.deepEqual([before.tick, before.considered, before.qualified, before.omitted], [0,4,1,0]);
  assert.equal(winners(before)[0].agent, 'ada');
  assert.equal(row(before, 'bow').checks['repair-kits'].actual.balance, 0);
  assert.deepEqual(row(before, 'rei').checks['keeper-trust'],
    {status:'fail', reason:'condition-mismatch', actual:{trust:0.3}});
  assert.equal(row(before, 'sol').checks['keeper-trust'].status, 'unavailable');
  assert.equal(row(before, 'sol').checks['local-guild'].reason, 'different-faction');
  assert.deepEqual(row(before, 'sol').checks['knows-route'].missing, ['local']);
  assert.equal(row(before, 'sol').checks['within-response-radius'].reason, 'outside-radius');
  assert.equal(row(before, 'sol').checks['can-carry'].reason, 'missing-required-tags');
  assert.deepEqual(winners(before)[0].checks['within-response-radius'].actual.point, [0.2,0,0]);
  run.schedule(read('beacon-shift.actions.json'));
  run.advance(2);
  const after = cast(run, spec);
  assert.deepEqual(winners(after).map(candidate => candidate.agent), ['bow']);
  assert.equal(row(after, 'bow').checks['repair-kits'].actual.balance, 2);
  assert.deepEqual(row(after, 'ada').checks['off-duty'].actual, {state:'busy', reason:'agent-orders'});
  assert.deepEqual(cast(R.replay(roundTrip(run.recording())), spec), after);
  const top = cast(run, {...spec, rosters:['visitors','crew'], limit:1});
  assert.deepEqual(top.candidates, winners(after));
  assert.deepEqual([top.considered, top.qualified, top.omitted], [4,1,3]);
});

test('a live query can bind candidate arguments and return a custom role value', () => {
  const run = R.create(read('beacon-casting.world.json')), spec = read('beacon-clearance.query.json');
  assert.deepEqual(winners(cast(run,spec)), []);
  run.schedule(read('beacon-shift.actions.json'));
  run.advance(2);
  const report = cast(run,spec), [rei] = winners(report);
  assert.equal(report.qualified, 1);
  assert.equal(rei.agent, 'rei');
  assert.deepEqual(rei.binding, {kind:'authorized-participant',value:'rei'});
  assert.deepEqual(rei.checks['keeper-approval'].actual,
    {field:'world/signal',args:{port:'clearance/rei-approved'},value:true});
  assert.equal(row(report,'sol').checks['keeper-approval'].reason, 'missing-query-argument');
  const probe = {field:'crew/agent',bind:{agent:'/agent',generation:'/generation'},
    select:'/metadata/faction',when:{value:'harbor'}};
  const scoped = cast(run, {rosters:['crew'],requirements:{native:{query:probe}},
    binding:{kind:'crew-member',select:{name:'/name',account:'/metadata/toolAccount'}}});
  assert.equal(scoped.qualified, 3);
  assert.deepEqual(row(scoped,'rei').binding.value, {name:'Rei',account:'kits/rei'});
  const missing = cast(run, {rosters:['visitors'],binding:{kind:'crew-member',select:'/metadata/approval'}});
  assert.deepEqual(row(missing,'sol').bindingMissing, ['value']);
  assert.equal(missing.qualified, 0);
});

test('a selected generation can bind a story objective and excludes a later replacement', () => {
  const input = read('beacon-casting.world.json'), spec = read('beacon-casting.query.json');
  const before = R.create(input);
  const shift = read('beacon-shift.actions.json');
  before.schedule(shift);
  before.advance(2);
  const [selected] = winners(cast(before,spec)), story = 'beacon-dispatch/response';
  const dispatch = read('beacon-dispatch.actions.json');
  const bound = {...input,storyDocuments:[read('beacon-dispatch.json')],storyBindings:{[story]:{escort:selected.binding}}};
  assert.deepEqual(R.storyPreflight(bound).diagnostics, []);
  const run = R.create(bound);
  const scoped = cast(run, {...spec,binding:{story,role:'escort'}});
  assert.equal(winners(scoped)[0].binding.kind, selected.binding.kind);
  run.schedule([...shift,...dispatch]);
  run.advance(16);
  const outcome = run.query().probe('world/story-lifecycle').value[story];
  assert.equal(outcome.status, 'completed');
  assert.deepEqual(outcome.flow.route[0].objectives.arrive.receipt.args, {agent:'bow',generation:selected.generation});
  before.schedule([
    {tick:3,action:'crew/despawn',args:{agent:'bow',generation:selected.generation}},
    {tick:4,action:'crew/spawn',args:{...input.systems.crew.config.agents.bow,agent:'bow'}}
  ]);
  before.advance(4);
  const [replacement] = winners(cast(before,spec));
  assert.equal(replacement.agent,'bow');
  assert.notEqual(replacement.generation,selected.generation);
  assert.equal(before.query().probe('crew/agent',undefined,{agent:'bow',generation:selected.generation}).status,'missing');
});

test('casting rejects malformed criteria and reports unavailable inputs without guessing', () => {
  const run = R.create(read('beacon-casting.world.json'));
  const req = requirements => cast(run,{rosters:['crew'],requirements});
  assert.throws(() => cast(run,{rosters:['unknown']}), /roster is unavailable/);
  assert.throws(() => req({bad:{traits:{all:['steady'],path:'/constructor'}}}), /bad: Invalid edit path/);
  assert.throws(() => req({bad:{query:{field:'world/story-candidates',when:{value:true}}}}), /bad:/);
  const report = req({
    balance:{inventory:{accountPath:'/metadata/absent',atLeast:0}},
    range:{proximity:{at:{entity:'missing'},within:2}},
    data:{query:{field:'crew/missing',when:{value:false}}}
  });
  assert.equal(report.qualified, 0);
  assert.deepEqual(Object.values(row(report,'ada').checks).map(check => check.reason),
    ['missing-or-invalid-account','target-unavailable','query-unavailable']);
});
