const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { load, instantiateStoryTemplate } = require('..');
const { embedStoryDocuments } = require('../cli/story-document.js');

const R = load().KIT.world.runtime;
const directory = path.resolve(__dirname, '../examples/story-documents');
const read = name => JSON.parse(fs.readFileSync(path.join(directory,name),'utf8'));
const world = (name, dependency) => embedStoryDocuments(read(name),path.join(directory,name),dependency);
const supply = dependency => world('supply-dispatch.world.json',dependency);
const query = (run,field,args) => run.query().probe(field,undefined,args).value;
const json = value => JSON.parse(JSON.stringify(value));
const balance = (run,name) => query(run,'world/account',{account:'dispatch/'+name}).balance;

test('several template instances preserve separate cast, destinations, deadlines and reward routes through replay', () => {
  const dependencies = [], source = supply(file => dependencies.push(file));
  assert.deepEqual(dependencies,[path.join(directory,'supply-dispatch.template.json')]);
  const preflight = R.storyPreflight(source);
  assert.deepEqual(preflight.documents,['mill-run','quay-run','ridge-run']);
  assert.deepEqual(preflight.diagnostics,[]);
  assert.deepEqual(preflight.templates['mill-run'].defaults,['cases','timeBudget','treasury','reward']);
  assert.equal(preflight.templates['quay-run'].parameters.cases,4);
  assert.equal(preflight.roles['ridge-run/delivery'].courier.value.agent,'suri');
  const run = R.create(source);
  run.schedule(read('supply-dispatch.actions.json'));
  run.advance(9);
  const before = query(run,'world/story-lifecycle');
  assert(!Object.hasOwn(before['quay-run/delivery'].flow.current.objectives,'deliver'));
  const early = run.history.find(row => row.document==='quay-run' && row.kind==='story-progress-rejected');
  assert.deepEqual([early.reason,early.pending],['objectives-pending',['deliver']]);
  const saved = json(run.checkpoint()), resumed = R.create(saved.world,{checkpoint:saved});
  run.advance(14);
  resumed.advance(14);
  const history = run.history, results = query(run,'world/story-lifecycle');
  for (const [key, agent, amount, tick] of [['mill-run','mai',2,10],['quay-run','nilo',4,12]]) {
    const result = results[key+'/delivery'];
    assert.deepEqual([result.status,result.outcome,result.since],['completed','delivered',tick]);
    const {arrive,deliver} = result.flow.route[0].objectives;
    assert.equal(arrive.receipt.args.agent,agent);
    assert.equal(deliver.receipt.event.applied,amount);
  }
  assert.equal(results['ridge-run/delivery'].status,'expired');
  assert.deepEqual(results['ridge-run/delivery'].deadline,{clock:'work',budgetTicks:4,spentTicks:4});
  assert.deepEqual(['mai','nilo','suri','treasury'].map(name => balance(run,name)),[3,7,0,20]);
  assert.deepEqual(history.filter(row => row.kind==='event-action-scheduled').map(row => row.rule),
    ['mill-run.dispatch','quay-run.dispatch','ridge-run.dispatch','mill-run.reward','quay-run.reward']);
  assert.deepEqual(query(resumed,'world/story-templates'),preflight.templates);
  assert.deepEqual(resumed.checkpoint(),run.checkpoint());
  const recording = json(run.recording());
  assert.deepEqual(recording.origin.world.storyTemplates,source.storyTemplates);
  assert.deepEqual(R.replay(recording).checkpoint(),run.checkpoint());
});

test('template parameters accept cast bindings and compose with concrete story documents', () => {
  const source = supply(), input = {...source};
  delete input.storyTemplates;
  const cast = query(R.create(input),'world/story-candidates',{
    rosters:['crew'], requirements:{actor:{where:{path:'/agent',value:'nilo'}}},
    binding:{kind:'supply-courier',select:{agent:'/agent',system:'/system',generation:'/generation',seek:'/metadata/seek'}}
  });
  const [{template, ...spec}] = source.storyTemplates;
  const originalTemplate = json(template);
  spec.parameters.courier = cast.candidates[0].binding;
  const result = instantiateStoryTemplate(template,{...spec,id:'extra-run'});
  assert.deepEqual(result.storyBindings['extra-run/delivery'].courier,cast.candidates[0].binding);
  assert.equal(result.eventActions['extra-run.dispatch'].actions[0].action.story,'extra-run/delivery');
  assert.equal(result.document.stories.delivery.lifecycle.deadlines.work.for,2.5);
  const {document,storyBindings,eventActions} = result;
  const mixed = R.create({...input,storyTemplates:[{template,...spec}],storyDocuments:[document],storyBindings,eventActions});
  mixed.schedule([{tick:1,action:'world/event',args:{kind:'supply-requested',document:'extra-run'}}]);
  mixed.advance(2);
  assert.equal(query(mixed,'world/story-lifecycle')['mill-run/delivery'],null);
  assert.equal(query(mixed,'world/story-lifecycle')['extra-run/delivery'].status,'active');
  assert.equal(query(mixed,'world/story-roles',{story:'extra-run/delivery',role:'courier'}).value.agent,'nilo');
  assert.equal(query(mixed,'world/story-templates',{id:'mill-run'}).parameters.courier.value.agent,'nilo');
  assert.deepEqual(template,originalTemplate);
});

test('arc instances expose child waits and can query resolved parameters through native evidence', () => {
  const source = world('lantern-pass.world.json'), [{id,format,version,...document}] = source.storyDocuments;
  delete source.storyDocuments;
  document.stories.corridor.stages.survey.objectives = {threshold:{title:'Inspect configured threshold',type:'observe',params:{
    state:{field:'world/story-templates',args:{id:{$instance:true}},select:'/parameters/threshold',when:{value:4}}
  }}};
  source.storyTemplates = [{id,parameters:{},template:{format:'ink-studio/story-template',version:1,id:'corridor-template',
    revision:1,document,parameters:{threshold:{type:'integer',default:4}}}}];
  const run = R.create(source);
  run.advance(2);
  const stage = query(run,'world/story-lifecycle')['lantern-pass/corridor'].flow.current;
  assert.deepEqual(stage.children.pending,['ford-report','ridge-report']);
  assert.equal(stage.objectives.threshold.receipt.value,4);
});

test('instantiation rejects stale revisions, malformed parameters and world collisions', () => {
  const source = supply(), [{template, ...spec}] = source.storyTemplates;
  assert.throws(() => instantiateStoryTemplate(template,{...spec,revision:2}), /expected template revision 2/);
  assert.throws(() => instantiateStoryTemplate(template,{...spec,parameters:null}), /object of values/);
  assert.throws(() => instantiateStoryTemplate(template,{...spec,parameters:{...spec.parameters,unknown:true}}), /unknown parameter unknown/);
  const parameters = {...spec.parameters};
  delete parameters.courier;
  assert.throws(() => instantiateStoryTemplate(template,{...spec,parameters}), /Missing required parameter.*courier/);
  assert.throws(() => instantiateStoryTemplate(template,{...spec,parameters:{...spec.parameters,cases:'4'}}), /cases expects integer/);
  assert.throws(() => instantiateStoryTemplate(template,{...spec,parameters:{...spec.parameters,cases:0}}), /parameter bounds/);
  const bad = json(template);
  bad.document.title = {$param:'missing'};
  assert.throws(() => instantiateStoryTemplate(bad,spec), /Unknown or invalid template parameter/);
  bad.document.title = {$param:'destination',path:'/missing'};
  assert.throws(() => instantiateStoryTemplate(bad,spec), /Missing template parameter path/);
  bad.document.title = {$param:'destination',path:'/__proto__'};
  assert.throws(() => instantiateStoryTemplate(bad,spec), /Invalid edit path/);
  assert.throws(() => R.storyPreflight({...source,storyTemplates:[source.storyTemplates[0],source.storyTemplates[0]]}),
    /Duplicate story template instance mill-run/);
  const {document,storyBindings,eventActions} = instantiateStoryTemplate(template,spec);
  assert.throws(() => R.storyPreflight({...source,storyDocuments:[document]}), /Duplicate story document ID mill-run/);
  assert.throws(() => R.storyPreflight({...source,storyBindings}), /Duplicate story role binding/);
  assert.throws(() => R.storyPreflight({...source,eventActions}), /Duplicate story template event action/);
});
