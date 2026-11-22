const assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');
const path = require('node:path');
const {test} = require('node:test');
const {load,preflightStoryDocument} = require('..');
const {embedStoryDocuments} = require('../cli/story-document.js');

const cli = path.resolve(__dirname,'../cli/ink-studio.js');
const demo = path.resolve(__dirname,'../examples/story-documents');
const documentFile = path.join(demo,'canal-inspection.json');
const worldFile = path.join(demo,'canal-inspection.world.json');
const packFile = path.join(demo,'canal-kit.asset-pack.json');
const copy = file=>structuredClone(require(file));
const call = (...args)=>spawnSync(process.execPath,[cli,...args],{encoding:'utf8'});
const world = ()=>({...embedStoryDocuments(copy(worldFile),worldFile),assetPacks:[copy(packFile)]});
const {runtime:R} = load().KIT.world;

test('document inventory lists reusable role schemas, authored requirements, and referenced dependencies', () => {
  const document = copy(documentFile), report = preflightStoryDocument(document);
  assert.equal(report.valid,true);
  const {inventory} = report, definition = inventory.definitions[0];
  assert.equal(definition.id,'canal-inspection/inspect');
  assert.deepEqual(definition.roles.guide,{kind:'worker',required:true,usedAt:['story.stories.inspect.lifecycle.commitment.actor']});
  assert.deepEqual(inventory.assets.map(({pack,revision,kind,id})=>({pack,revision,kind,id})),
    [{pack:'canal-kit',revision:2,kind:'material',id:'canal-kit/stone'}]);
  assert(inventory.dependencies.some(row=>row.kind==='event'&&row.id==='inspection-commissioned'));
  assert(inventory.dependencies.some(row=>row.kind==='document'&&row.id==='canal-support'));
  const result = call('story','describe',documentFile,'inspect','--inventory');
  assert.equal(result.status,0,result.stderr);
  assert.deepEqual(JSON.parse(result.stdout),{format:'ink-studio/story-inventory',version:1,documentId:document.id,...inventory});
  assert.deepEqual(JSON.parse(call('story','describe',documentFile).stdout),document);
  const requirements = document.stories.inspect.requirements;
  requirements.capabilities.push(requirements.capabilities[0]);
  assert.match(preflightStoryDocument(document).diagnostics[0].message,/duplicate requirement/);
});

test('world inventory resolves registered interfaces and blocks missing requirements without executing runtime hooks', () => {
  const source = world(), effects = [];
  source.systems.station = {kind:'inventory-fixture'};
  const implementations = {'inventory-fixture':()=>({
    initial(){ effects.push('initial'); return {}; },
    step(state){ effects.push('step'); return state; },
    fields:{ready:{type:'boolean',read(){ effects.push('read'); return true; }}},
    storyHostOperations:new Map([['inspect',()=>effects.push('operation')]])
  })};
  source.storyDocuments[0].requirements.capabilities = [
    {kind:'system',id:'station'}, {kind:'query',id:'station/ready'},
    {kind:'operation',id:'station/inspect'}, {kind:'query',id:'world/scheduler'}
  ];
  const ready = R.storyPreflight(source,{implementations});
  assert.equal(ready.valid,true);
  assert.deepEqual(ready.diagnostics,[]);
  assert.deepEqual(effects,[]);
  assert(ready.inventory.capabilities.every(row=>row.status==='available'));
  assert.equal(ready.inventory.definitions[0].roles.guide.binding,'world');
  assert.equal(ready.inventory.assets[0].status,'available');
  assert.equal(ready.inventory.assets[0].installedRevision,2);
  assert.equal(ready.inventory.capabilities.find(row=>row.id==='station/inspect').provider,'inventory-fixture');

  source.storyDocuments.pop();
  source.assetPacks[0].revision = 1;
  source.storyDocuments[0].requirements.capabilities[2].id = 'station/absent';
  const missing = R.storyPreflight(source,{implementations});
  assert.equal(missing.valid,false);
  assert.deepEqual(missing.diagnostics.map(row=>row.code),
    ['missing-story-capability','missing-story-asset','missing-story-document']);
  assert.equal(missing.inventory.assets[0].reason,'revision-mismatch');
  assert.equal(missing.inventory.assets[0].installedRevision,1);
  assert.equal(missing.inventory.dependencies.find(row=>row.id==='canal-support').status,'missing');
  assert.throws(()=>R.create(source,{implementations}),/Missing story capability operation station\/absent/);
  assert.deepEqual(effects,[]);
});

test('CLI preflight reports loaded files and returns invalid inventory when a pack is missing', () => {
  const ready = call('sim','preflight',worldFile,'--strict','--asset-pack',packFile);
  assert.equal(ready.status,0,ready.stderr);
  assert.deepEqual(JSON.parse(ready.stdout).inventory.files,
    ['canal-inspection.json','canal-inspection.world.json','canal-kit.asset-pack.json','canal-support.json']);
  const missing = call('sim','preflight',worldFile);
  assert.equal(missing.status,1,missing.stderr);
  const report = JSON.parse(missing.stdout);
  assert.equal(report.valid,false);
  assert.equal(report.inventory.assets[0].reason,'pack-missing');
  assert.equal(report.diagnostics[0].path,'story.requirements.assets[0]');
  const run = call('sim','run',worldFile,'--ticks','1');
  assert.equal(run.status,1,run.stderr);
  assert.match(run.stderr,/Missing required story asset canal-kit\/stone/);
});

test('template instances carry requirements and revision dependencies into preflight', () => {
  const file = path.join(demo,'supply-dispatch.world.json'), source = embedStoryDocuments(copy(file),file);
  source.storyTemplates[0].template.document.requirements = {capabilities:[{kind:'account',id:'dispatch/mill-stock'}]};
  const {valid,inventory} = R.storyPreflight(source);
  assert.equal(valid,true);
  assert(inventory.capabilities.some(row=>row.id==='dispatch/mill-stock'&&row.status==='available'&&
    row.usedBy.some(use=>use.document==='mill-run'&&use.source==='declared')));
  assert.deepEqual(inventory.dependencies.filter(row=>row.kind==='template').map(row=>[row.instance,row.revision,row.status]),
    [['mill-run',1,'available'],['quay-run',1,'available'],['ridge-run',1,'available']]);
});
