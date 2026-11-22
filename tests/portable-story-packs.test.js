const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const assert=require('node:assert/strict');
const {test}=require('node:test');
const ink=require('..');
const K=ink.load().KIT,W=K.world;
const {embedStoryDocuments}=require('../cli/story-document.js');
const {hash}=require('../cli/asset-references.js');
const world=require('../examples/world-access/harbor.world.json');

function fixture(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ink-story-archive-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const file=name=>path.join(root,name);
  const save=(name,value)=>{
    const json=JSON.stringify(value)+'\n';
    fs.writeFileSync(file(name),json);
    return hash(json);
  };
  const story=structuredClone(world.storyDocuments[0]), sound={asset:'harbor/chime',revision:1};
  story.requirements={capabilities:[{kind:'query',id:'world/account'}]};
  save('story.json',story);
  const bytes=require('../cli/wav.js').encode({sampleRate:8000,channels:1,samples:Float64Array.of(.5,0,-.5)});
  fs.writeFileSync(file('chime.wav'),bytes);
  save('assets.json',{format:K.authoring.assetReferences.format,version:1,entries:[
    {...sound,kind:'sound',file:'chime.wav',sha256:hash(bytes)}
  ]});
  save('patch.json',{format:'ink-studio/graph-project',version:1,assetRegistry:'assets.json',
    assets:{chime:{format:'wav',file:sound}},nodes:{audio:{op:'audioAsset',inputs:{name:'chime'}}},
    outputs:{audio:{node:'audio'}}});
  const registry=JSON.parse(fs.readFileSync(file('assets.json'),'utf8'));
  registry.entries.push({asset:'harbor/patch',revision:1,kind:'graph',file:'patch.json',sha256:hash(fs.readFileSync(file('patch.json')))});
  save('assets.json',registry);
  save('pack.json',{format:'ink-studio/story-pack',version:1,id:'harbor-pack',revision:2,documents:['story.json'],
    assetRegistry:'assets.json',assets:{picture:{asset:'harbor/patch',revision:1}}});
  const build=(name,out)=>ink.packProject(file(name),{out:file(out)}).project;
  return {file,save,build,story,sound,bytes};
}

test('a portable pack pins graph dependencies and installs exactly its requested story revision',t=>{
  const {file,save,build,story,sound,bytes}=fixture(t);
  build('pack.json','pack.project.json');
  fs.unlinkSync(file('story.json'));
  fs.unlinkSync(file('chime.wav'));
  const project=ink.readProjectBundle(file('pack.project.json'));
  assert.equal(project.metadata.revision,2);
  assert.deepEqual(project.storyDocuments(),[story]);
  const cap=project.storyInventory().capabilities.find(row=>row.id==='world/account');
  assert(cap.usedBy.some(row=>row.source==='declared'));
  assert.deepEqual(Buffer.from(project.readFile(project.resolveStoryAsset(sound,'sound').path)),bytes);
  const archived=project.snapshot();
  delete archived.files['chime.wav'];
  save('missing.project.json',archived);
  assert.throws(()=>ink.readProjectBundle(file('missing.project.json')),/Missing project file: chime.wav/);
  const tampered=project.snapshot();
  tampered.files['story.json'].data='{}';
  save('tampered.project.json',tampered);
  assert.throws(()=>ink.readProjectBundle(file('tampered.project.json')),/Corrupt story bundle file: story.json/);
  const imported={...world,storyDocuments:[{pack:'pack.project.json',revision:2}]};
  const installed=embedStoryDocuments(imported,file('incoming.json'));
  assert.deepEqual(installed.storyDocuments,[story]);
  assert.throws(()=>embedStoryDocuments({...imported,storyDocuments:[{pack:'pack.project.json',revision:1}]},
    file('incoming.json')),/Expected story pack revision 1/);
});

test('native run bundles verify events against replay while event-only bundles remain editorial sources',async t=>{
  const {file,save,build,story}=fixture(t);
  const run=W.runtime.create({...world,storyDocuments:[story]},{recordRun:true});
  run.schedule([{id:'choose-lamp',action:'world/story-choose',tick:2,args:{
    document:'harbor-watch',story:'dispatch',stage:'plan',visit:1,branch:'release',reason:'approved'
  }}]);
  const events=[];
  run.advance(3,{onTick:()=>events.push(...run.committedEvents())});
  save('recording.json',run.recording());
  const log={format:W.storyEvents.envelopeFormat,version:1,world:world.id,dt:world.dt,from:1,to:3,
    coverage:'complete',dropped:0,events};
  save('events.json',log);
  const recipe={format:'ink-studio/story-run',version:1,id:'harbor-run',pack:'pack.json',events:'events.json'};
  save('events-only.json',recipe);
  save('full.json',{...recipe,recording:'recording.json'});
  const project=build('full.json','full.project.json');
  const checked=await ink.verifyStoryBundle(file('full.project.json'));
  assert.equal(checked.compared,events.length);
  assert.equal(checked.replay,'native');
  assert.equal(checked.passed,true);
  const {run:played}=await ink.replayStoryBundle(file('full.project.json'));
  assert.deepEqual(played.checkpoint(),run.checkpoint());
  const reviewed=build('events-only.json','events.project.json');
  assert.equal(reviewed.storyRecordingPath(),undefined);
  assert.equal((await ink.verifyStoryBundle(file('events.project.json'))).replay,'none');
  assert.deepEqual(reviewed.storyEvents(),project.storyEvents());
  assert.equal(W.storyEvents.analyze(reviewed.storyEvents()).stories['harbor-watch/dispatch'].outcome,'lit');
  const changed=structuredClone(log);
  changed.events.find(row=>row.kind==='story-branch-chosen').payload.branch='hold';
  save('events.json',changed);
  build('full.json','changed.project.json');
  const diverged=await ink.verifyStoryBundle(file('changed.project.json'));
  assert.equal(diverged.status,'diverged');
  assert.equal(diverged.mismatch.kind,'events');
  assert.equal(diverged.mismatch.tick,2);
});
