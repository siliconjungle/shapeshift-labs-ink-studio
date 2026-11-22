const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');

const root=path.resolve(process.argv[3]??path.join(__dirname,'../..'));
const out=path.resolve(process.argv[2]??'studio/out/portable-story-packs');
const original=path.join(out,'authoring'), portable=path.join(out,'portable'), reports=path.join(out,'reports');
const cli=path.join(root,'cli/ink-studio.js'), ink=require(root), WAV=require(path.join(root,'cli/wav.js'));
const run=(cwd,...args)=>execFileSync(process.execPath,[cli,...args],{cwd,encoding:'utf8'});
function save(file,value){
  fs.mkdirSync(path.dirname(file),{recursive:true});
  fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n');
}
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const write=(name,value)=>save(path.join(original,name),value);
const report=name=>path.join(reports,name);
const archived=name=>path.join(portable,name+'.project.json');
const name=(asset,revision=1)=>({asset:'lantern/'+asset,revision});

fs.mkdirSync(portable,{recursive:true});
fs.mkdirSync(reports,{recursive:true});
const source=read(path.join(root,'examples/world-access/harbor.world.json'));
const {storyDocuments:[document],...world}=source;
document.requirements={capabilities:[{kind:'query',id:'world/account'},{kind:'action',id:'world/story-choose'}],
  assets:[{pack:'canal-kit',revision:2,kind:'material',id:'canal-kit/stone'}]};
const {format,version,id,...body}=document;
write('story/harbor-watch.json',document);
write('story/watch.template.json',{format:'ink-studio/story-template',version:1,id:'lantern-watch',revision:1,
  parameters:{},document:body});
write('story/canal-kit.json',read(path.join(root,'examples/story-documents/canal-kit.asset-pack.json')));
write('inputs/lamp-controls.json',{format:'ink-studio/input-recording',version:1,initial:{lamp:0},
  events:[{time:.2,channel:'lamp',value:1}]});
write('inputs/watch-instance.json',{id:'relay-watch',revision:1});
write('inputs/choose.json',[{tick:2,id:'release-signal',action:'world/story-choose',
  args:{document:id,story:'dispatch',stage:'plan',visit:1,branch:'release',reason:'relay-authorized'}}]);
write('inputs/cues.json',{format:'ink-studio/presentation-cue-plan',version:1,id:'lantern-cues',
  rules:{light:{on:{kind:'story-branch-chosen'},cue:{kind:'lantern-cue',label:'Light the western signal',
    assets:{sound:name('chime')}}}}});

const sampleRate=16000;
const samples=Float64Array.from({length:sampleRate/2},(_,i)=>{
  const t=i/sampleRate;
  return .55*Math.min(t*240,1)*Math.exp(-8*t)*(Math.sin(2*Math.PI*660*t)+.28*Math.sin(2*Math.PI*990*t));
});
fs.mkdirSync(path.join(original,'media'),{recursive:true});
fs.writeFileSync(path.join(original,'media/chime.wav'),WAV.encode({sampleRate,channels:1,samples}));
write('picture/signal.graph.json',{format:'ink-studio/graph-project',version:1,assetRegistry:'../assets.json',
  assets:{chime:{format:'wav',file:name('chime')}},nodes:{
    picture:{op:'raster.canvas',inputs:{width:128,height:64,color:[226,139,41,255]}},
    chime:{op:'audioAsset',inputs:{name:'chime'}}
  },outputs:{picture:{node:'picture'},audio:{node:'chime'}},
  exports:{signal:{output:'picture',format:'png'},chime:{output:'audio',format:'wav'}}});
write('assets.draft.json',{format:'ink-studio/asset-registry',version:1,entries:[
  {...name('chime'),kind:'sound',file:'media/chime.wav'},
  {...name('signal'),kind:'graph',file:'picture/signal.graph.json'}
]});
run(original,'assets','lock','assets.draft.json','--out','assets.json');
run(original,'graph','run','picture/signal.graph.json','--out','card');
const originalCard=path.join(original,'card','artifacts','signal.png');
assert(fs.existsSync(originalCard));

write('lantern.pack.json',{format:'ink-studio/story-pack',version:1,id:'lantern-harbor',revision:2,
  documents:['story/harbor-watch.json'],templates:{watch:'story/watch.template.json'},
  assetPacks:['story/canal-kit.json'],assetRegistry:'assets.json',assets:{signal:name('signal'),chime:name('chime')},
  inputs:{controls:'inputs/lamp-controls.json',cues:'inputs/cues.json',instance:'inputs/watch-instance.json'},
  media:{poster:'card/artifacts/signal.png'}});
run(original,'project','pack','lantern.pack.json','--out','lantern.project.json');
fs.copyFileSync(path.join(original,'lantern.project.json'),archived('lantern'));
write('receiving.world.json',{...world,storyDocuments:[{pack:'lantern.project.json',revision:2}]});
run(original,'sim','preflight','receiving.world.json','--out',report('installed-preflight.json'));
run(original,'sim','run','receiving.world.json','--actions','inputs/choose.json','--ticks','4',
  '--record','native.run.json','--checkpoint-store','blocks');
run(original,'sim','fixture','native.run.json','--from','0','--ticks','4','--out','complete.fixture.json');
run(original,'story','events','complete.fixture.json','--format','envelopes','--out','committed.events.json');
const runRecipe={format:'ink-studio/story-run',version:1,id:'lantern-release',pack:'lantern.pack.json',
  events:'committed.events.json',inputs:{choice:'inputs/choose.json'},media:{audio:'card/artifacts/chime.wav'}};
write('full.run-bundle.json',{...runRecipe,recording:'native.run.json'});
write('events.run-bundle.json',{...runRecipe,id:'lantern-event-exchange'});
for(const type of ['full','events'])
  run(original,'project','pack',type+'.run-bundle.json','--out',archived(type));

const unpacked=fs.mkdtempSync(path.join(portable,'received-'));
const extraction=path.join(unpacked,'source');
run(portable,'project','unpack',archived('events'),'--out',extraction);
for(const type of ['lantern','full','events']){
  fs.writeFileSync(report(type+'-inspect.json'),run(portable,'project','inspect',archived(type)));
  run(portable,'project','verify',archived(type),'--out',report(type+'-verify.json'));
}
const verified=read(report('full-verify.json')), independent=read(report('events-verify.json'));
assert.equal(verified.replay,'native');
assert.equal(verified.compared,verified.events);
assert.equal(independent.replay,'none');
assert.equal(independent.events,verified.events);
run(portable,'sim','replay',archived('full'),'--out',report('replayed.json'));
fs.writeFileSync(report('instantiated-template.json'),run(portable,'story','instantiate',archived('lantern'),
  path.join(extraction,'inputs/watch-instance.json'),'--template','watch'));
assert.equal(read(report('instantiated-template.json')).document.id,'relay-watch');
run(portable,'story','events',archived('events'),'--format','timeline','--out',report('editing-timeline.json'));
run(portable,'story','cues',archived('events'),path.join(extraction,'inputs/cues.json'),'--out',report('presentation-cues.json'));
assert.equal(read(report('presentation-cues.json')).cues[0].assets.sound.asset,'lantern/chime');
const bundle=ink.readProjectBundle(archived('events'));
assert.equal(bundle.storyResource('inputs','controls').path,'inputs/lamp-controls.json');
assert.deepEqual(Buffer.from(bundle.storyResource('media','poster').bytes),fs.readFileSync(originalCard));
assert(WAV.decode(Buffer.from(bundle.storyResource('media','audio').bytes)).samples.some(sample=>sample>.1));
assert(ink.readProjectBundle(archived('lantern')).storyInventory().capabilities.some(item=>
  item.id==='world/account'&&item.usedBy.some(use=>use.source==='declared')));
run(portable,'graph','run',path.join(extraction,'picture/signal.graph.json'),'--out',path.join(out,'received-graph'));
console.log('Installed the revision 2 story pack with its capability declarations and material.');
console.log('Verified '+verified.events+' committed events against the relocated native run.');
console.log('The event-only bundle drove the editorial timeline and a cue with its pinned chime.');
