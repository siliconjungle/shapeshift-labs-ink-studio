const assert = require('node:assert/strict');
const {test} = require('node:test');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const {load,validateStoryDocument,preflightStoryDocument} = require('..');
const {embedStoryDocuments} = require('../cli/story-document.js');
const directory = '../examples/story-documents/';
const read = name=>JSON.parse(JSON.stringify(require(directory+name)));
const documents = ()=>['harbor-pressures.json','harbor-encounters.json'].map(read);
const source = ()=>{
  const file = 'harbor-catalog.world.json';
  return embedStoryDocuments(read(file),path.resolve(__dirname,directory+file));
};
const {incidentCatalog:C,runtime:R,storyEvents:E} = load().KIT.world;
const readCatalog = (run,args)=>run.query().probe('world/incident-catalog',undefined,args).value;
const visitor = 'harbor-encounters/relief-barge', recovery = 'harbor-encounters/quiet-watch';
const incident = (run,id)=>readCatalog(run,{incident:id}).incidents[0];
const copy = value=>JSON.parse(JSON.stringify(value));

test('offline catalogs merge definitions deterministically, classify six categories and retain legacy incidents',()=>{
  const legacy = read('burned-mill.json'), input = [...documents(),legacy];
  const all = C.find(C.compile(input)), reverse = C.find(C.compile(input.reverse()));
  assert.deepEqual(reverse,all);
  assert.equal(all.total,7);
  assert.deepEqual(all.counts,{discovery:1,recovery:1,visitor:1,'environmental-change':1,setback:1,opportunity:1,unclassified:1});
  assert.equal(C.find(C.compile(input),{category:'unclassified'}).incidents[0].id,'burned-mill/mill-fire');
  assert.equal(all.incidents.find(row=>row.id==='burned-mill/mill-fire').intensity,null);
  const registry = C.compile(documents());
  assert.deepEqual(C.find(registry,{tags:['harbor','supplies'],maxIntensity:0,text:'SHORTAGES'}).incidents.map(row=>row.id),[recovery]);
  assert.deepEqual(C.find(registry,{minIntensity:3,maxIntensity:4}).incidents.map(row=>row.category),['environmental-change','setback']);
  assert.equal(C.find(registry,{incident:visitor}).incidents[0].title,'A relief barge asks to dock');
  const preview = preflightStoryDocument(documents()[1],{story:'quiet-watch'});
  assert.equal(preview.stories[0].incident.category,'recovery');
  assert.throws(()=>C.compile([legacy,legacy]),/Duplicate story document ID/);
});

test('validated metadata only classifies incident definitions and filters reject invalid shapes',()=>{
  const [document] = documents(), story = document.stories['high-water'];
  const original = story.incident;
  for (const [spec,message] of [
    [{...original,category:'other'},/known incident category/],
    [{...original,intensity:2.5},/integer from 0 to 5/],
    [{...original,tags:['tide','tide']},/unique tag IDs/]
  ]) {
    story.incident = spec;
    assert.throws(()=>validateStoryDocument(document),message);
  }
  story.incident = original;
  story.kind = 'questlet';
  assert.throws(()=>validateStoryDocument(document),/metadata requires an incident/);
  const registry = C.compile(documents());
  assert.throws(()=>C.find(registry,{incident:'relief-barge'}),/document\/story ID/);
  assert.throws(()=>C.find(registry,{category:'unknown'}),/Unknown incident category/);
  assert.throws(()=>C.find(registry,{status:'completed'}),/Invalid incident status filter/);
});

test('world catalog follows waiting, offered, completed, expired and trigger-only incidents through replay',()=>{
  const world = source(), welcome = R.create(world), ignored = R.create(world);
  assert.equal(R.storyPreflight(world).incidentCatalog.total,6);
  assert.equal(readCatalog(welcome,{status:'waiting'}).incidents.length,6);
  welcome.schedule(read('harbor-catalog.welcome.actions.json'));
  welcome.advance(4);
  assert.equal(incident(welcome,visitor).status,'available');
  assert.equal(incident(welcome,'harbor-pressures/high-water').status,'completed');
  const saved = welcome.checkpoint(), resumed = R.create(saved.world,{checkpoint:copy(saved)});
  welcome.advance(9);
  assert.equal(incident(welcome,visitor).status,'completed');
  assert.equal(incident(welcome,recovery).status,'waiting');
  assert.equal(incident(welcome,'harbor-encounters/old-channel-chart').status,'started');
  welcome.advance(13);
  resumed.advance(13);
  ignored.advance(13);
  assert.equal(incident(ignored,visitor).status,'expired');
  assert.equal(incident(welcome,recovery).start.tick,10);
  assert.equal(incident(welcome,recovery).transition.outcome,'rested');
  assert.equal(welcome.query().probe('world/account',undefined,{account:'goods/pier'}).value.balance,2);
  assert.equal(ignored.query().probe('world/account',undefined,{account:'goods/pier'}).value.balance,0);
  assert.equal(welcome.query().probe('standing/reputation',undefined,{subject:'watch',faction:'harbor'}).value.value,1);
  assert.equal(welcome.history.find(row=>row.kind==='harbor-quiet').tick,11);
  assert.equal(welcome.history.find(row=>row.kind==='story-started'&&row.story==='old-channel-chart').incident.category,'discovery');
  const quiet = E.analyze(welcome.recording(),{story:recovery});
  assert(quiet.timeline.some(({event})=>event.incident?.category==='recovery'));
  assert.deepEqual(readCatalog(resumed),readCatalog(welcome));
  assert.deepEqual(R.replay(copy(welcome.recording())).checkpoint(),welcome.checkpoint());
});

test('resolved templates appear with provenance and a matched trigger can wait on feasibility',()=>{
  const world = source(), doc = world.storyDocuments[1], spec = doc.stories['relief-barge'];
  spec.lifecycle.feasibility = {stock:{state:{field:'world/account',args:{account:'food/pantry'},
    select:'/balance',when:{op:'gte',value:10}}}};
  const run = R.create(world);
  run.advance(5);
  assert.equal(incident(run,visitor).status,'pending');
  assert.equal(incident(run,visitor).start.trigger,'arrival');

  const legacy = documents()[1].stories['old-channel-chart'];
  legacy.incident.category = {$param:'category'};
  const template = {format:'ink-studio/story-template',version:1,id:'finding',revision:2,
    parameters:{category:{type:'id',default:'opportunity'}},document:{stories:{finding:legacy}}};
  world.storyTemplates = [{id:'another-chart',template}];
  const registry = R.storyPreflight(world).incidentCatalog;
  const row = registry.incidents.find(item=>item.id==='another-chart/finding');
  assert.deepEqual(row.template,{id:'finding',revision:2});
  assert.equal(row.category,'opportunity');
  assert.deepEqual(row.tags,['harbor','survey']);
});

test('the CLI discovers category, tag and intensity matches across separate source documents',()=>{
  const cli = path.resolve(__dirname,'../cli/ink-studio.js');
  const args = ['harbor-pressures.json','harbor-encounters.json'].map(file=>path.resolve(__dirname,directory+file));
  const found = JSON.parse(execFileSync(process.execPath,[cli,'story','catalog',...args,'--tags','harbor,supplies',
    '--category','recovery','--max-intensity','0'],{encoding:'utf8'}));
  assert.deepEqual(found.incidents.map(row=>row.id),[recovery]);
});
