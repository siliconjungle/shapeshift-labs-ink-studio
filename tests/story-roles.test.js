const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { load, readStoryDocument, preflightStoryDocument, validateStoryDocument } = require('..');
const { embedStoryDocuments } = require('../cli/story-document.js');

const R = load().KIT.world.runtime;
const directory = path.resolve(__dirname, '../examples/story-documents');
const read = name => JSON.parse(fs.readFileSync(path.join(directory,name),'utf8'));
const world = name => embedStoryDocuments(read(name),path.join(directory,name));
const charter = variant => world(`relief-charter-${variant}.world.json`);
const key = 'relief-charter/courier';
const sample = (run,field,args) => run.query().probe(field,undefined,args).value;
const json = value => JSON.parse(JSON.stringify(value));
const balance = (run,account) => sample(run,'world/account',{account}).balance;

test('the same authored story and commands bind different rosters, places, witnesses, and rewards', () => {
  const commands = read('relief-charter.actions.json'), original = json(commands);
  const records = [];
  for (const variant of ['ridge','quay']) {
    const input = charter(variant), bindings = input.storyBindings[key], escort = bindings.escort.value;
    const checked = R.storyPreflight(input);
    assert.deepEqual(checked.diagnostics, []);
    assert.deepEqual(checked.roles[key].escort, { kind:'courier', source:'world', value:escort });
    const run = R.create(input);
    assert.equal(run.view().tick, 0);
    assert.deepEqual(sample(run,'world/story-roles',{story:key,role:'escort'}), checked.roles[key].escort);
    assert.equal(run.query().probe('world/story-roles',undefined,{story:key,role:'missing'}).status,'missing');
    run.schedule(commands);
    run.advance(6);
    const checkpoint = json(run.checkpoint()), restored = R.create(checkpoint.world,{checkpoint});
    run.advance(18);
    restored.advance(18);
    assert.deepEqual(restored.checkpoint(),run.checkpoint());
    const row = sample(run,'world/story-lifecycle')[key], objectives = row.flow.route[0].objectives;
    assert.deepEqual([row.status,row.outcome], ['completed','delivered']);
    assert.equal(objectives['escort-arrives'].receipt.field,escort.system+'/position');
    assert.equal(objectives['escort-arrives'].receipt.args.agent,escort.agent);
    assert.equal(objectives['cargo-arrives'].receipt.event.to,bindings.destination.value.account);
    assert.equal(objectives['witness-check'].receipt.event.witness,bindings.witness.value);
    assert.equal(objectives['witness-check'].receipt.event.rival,bindings.rival.value);
    assert.equal(balance(run,escort.wallet),3);
    assert.equal(balance(run,bindings['reward-source'].value),9);
    const issued = run.history.find(event => event.kind === 'order-issued');
    assert.equal(issued.system,escort.system);
    assert.equal(issued.agent,escort.agent);
    const recording = json(run.recording());
    assert.deepEqual(R.replay(recording).checkpoint(),run.checkpoint());
    assert.deepEqual(recording.origin.world.storyBindings,input.storyBindings);
    records.push(recording);
  }
  assert.deepEqual(commands,original);
  assert.deepEqual(records[0].origin.world.storyDocuments,records[1].origin.world.storyDocuments);
  assert.notEqual(records[0].commands[1].args.to,records[1].commands[1].args.to);
});

test('role kinds are authored and values can be nested JSON, reference defaults, null, or false', () => {
  const doc = {format:'ink-studio/story',version:1,id:'settings',references:{
    nominal:{kind:'asset-key',id:'catalog/asset'}
  },stories:{activation:{kind:'incident',title:'Set arbitrary roles',entry:'ready',lifecycle:{},
    roles:{custom:{kind:'sensor-settings',required:true}, asset:{kind:'asset-key',ref:'nominal'}, spare:{kind:'any-kind'}},
    triggers:{notice:{event:{kind:'setting-read',where:{all:[
      {path:'/answer',value:{$role:'custom',path:['a/~',2]}},
      {path:'/nothing',value:{$role:'custom',path:'/a~1~0/1'}},
      {path:'/asset',value:{$role:'asset'}}
    ]}}}},stages:{ready:{title:'Ready',next:{finish:{outcome:'ok'}}}},outcomes:{ok:{title:'OK'}}}}};
  const story = 'settings/activation', input = { id:'settings', storyDocuments:[doc],
    storyBindings:{[story]:{custom:{kind:'sensor-settings',value:{'a/~':[0,null,false]}}}},
    commands:[{tick:1,action:'world/event',args:{kind:'setting-read',
      answer:{$role:'custom',story,path:'/a~1~0/2'},nothing:{$role:'custom',story,path:['a/~',1]},
      asset:{$role:'asset',story}}}] };
  const run = R.create(input);
  run.step();
  assert.equal(sample(run,'world/story-lifecycle')[story].status,'active');
  assert.deepEqual(sample(run,'world/story-roles',{story,role:'asset'}),{kind:'asset-key',source:'reference',value:'catalog/asset'});
  assert.deepEqual(sample(run,'world/story-roles',{story,role:'spare'}),{kind:'any-kind',source:'unbound'});
  const event = run.history.find(row => row.kind==='setting-read');
  assert.deepEqual([event.answer,event.nothing,event.asset],[false,null,'catalog/asset']);
  const recording = json(run.recording());
  assert.deepEqual(recording.origin.world.commands,input.commands);
  assert.deepEqual(R.replay(recording).checkpoint(),run.checkpoint());
});

test('role values can feed query evidence and a cleanup target without changing their native rules', () => {
  const input = world('canal-camp.world.json'), story = 'canal-camp/commission';
  const definition = input.storyDocuments[0].stories.commission;
  const target = definition.lifecycle.cleanup['bench-claim'].claim;
  definition.roles = {bench:{kind:'reserve-handle'}, activated:{kind:'approval'}};
  input.storyBindings = {[story]:{
    bench:{kind:'reserve-handle',value:target}, activated:{kind:'approval',value:true}
  }};
  definition.lifecycle.cleanup['bench-claim'].claim = {$role:'bench'};
  definition.stages.commission.objectives.approval = {title:'Read explicit approval',type:'observe',params:{
    state:{field:'world/story-roles',args:{story,role:'activated'},select:'/value',when:{value:true}}
  }};
  const run = R.create(input);
  run.advance(3);
  assert.equal(sample(run,'world/story-lifecycle')[story].flow.current.objectives.approval.receipt.value,true);
  run.schedule(read('canal-camp-withdraw.actions.json'));
  run.advance(6);
  assert.deepEqual(sample(run,'booking/claims'),[]);
  assert.deepEqual(run.history.find(row => row.kind==='story-cleanup-resolved' && row.rule==='bench-claim').target,target);
  assert.deepEqual(R.replay(json(run.recording())).checkpoint(),run.checkpoint());
});

test('preflight checks role IDs, kinds, required slots, shape and safe paths', () => {
  const source = readStoryDocument(path.join(directory,'relief-charter.json'));
  assert.deepEqual(preflightStoryDocument(source).diagnostics,[]);
  const preview = preflightStoryDocument(source).stories[0];
  assert.equal(preview.roles.clearance.kind,'dispatch-authorization');
  assert(preview.stages[0].roles.includes('reward-source'));
  const badToken = json(source), rule = badToken.stories.courier.triggers.commission.event.where.all[0];
  rule.value.$role = 'unknown';
  assert(preflightStoryDocument(badToken).diagnostics.some(row => row.code==='missing-reference' && row.path.endsWith('.$role')));
  assert.throws(() => validateStoryDocument(badToken),/unknown role/);
  rule.value = {$role:'requester',path:'/__proto__'};
  assert.throws(() => validateStoryDocument(badToken),/expected a valid path/);

  const rejects = (change, expected) => {
    const input = charter('ridge');
    change(input,input.storyBindings[key]);
    assert.throws(() => R.storyPreflight(input),expected);
  };
  rejects((_, b) => delete b.clearance,/Missing required story role binding.*clearance/);
  rejects((_, b) => delete b.witness,/Missing story role binding.*witness.*witness-check/);
  rejects((_, b) => { b.escort.kind='unrelated'; },/expects a binding of kind courier/);
  rejects((_, b) => { delete b.destination.value.bounds.min; },/Missing story role value path.*destination/);
  rejects((_, b) => { b.destination.value.bounds.min='floor'; },/expected ordered finite XYZ bounds/);
  rejects((_, b) => { b.rival.value={$role:'witness'}; },/Role bindings need concrete values/);
  rejects(input => { input.storyBindings['relief-charter/elsewhere']={}; },/Unknown story for role bindings/);
  assert.throws(() => R.storyPreflight({storyDocuments:null}),/Expected up to 32 embedded story documents/);
});
