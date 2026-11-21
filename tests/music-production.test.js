const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {createSceneAudio}=require('../cli/scene-audio.js');
const WAV=require('../cli/wav.js');
const kit=require('..').load(), K=kit.KIT, P=K.music.production;
const folder=path.resolve(__dirname,'../examples/music-production');
const recipe=require(path.join(folder,'relay-glass.json'));
const assets=Object.fromEntries(Object.entries(recipe.assets).map(([name,file])=>[name,WAV.read(path.join(folder,file))]));

function small() {
  const melody={length:4,events:[{beat:0,duration:.45,midi:60,velocity:.52},
    {beat:1,duration:.45,midi:63,velocity:.76,play:{retrigger:2,brightness:.9}},
    {beat:2,duration:1.4,midi:67,velocity:.9,play:{delay:.017,glide:.06,vibrato:14}}]};
  return {arrangement:{score:{key:{root:'C4',mode:'minor'},harmonies:{home:{root:'C4',quality:'minor',notes:[60]}}},
    motifs:{melody},parts:{lead:{role:'lead',material:'melody'}},sections:[{id:'home',bars:1,harmony:'home'}]},
    patches:{glass:{type:'fm',ratio:2.01,index:2.4}},tracks:{lead:{patch:'glass',send:.5,gain:-9,highpass:180}}};
}
const clockPosition=(n,rate)=>({numerator:n,denominator:rate});

test('production uses expressive performed notes and exact synthesis, room and filter history for a trimmed window',()=>{
  const source=small(), inspected=P.inspect(source);
  const rows=inspected.events.lead;
  assert.deepEqual(rows.map(note=>note.midi),[60,63,63,67]);
  assert.equal(rows[3].time,1.017);
  assert.equal(rows[3].fromFrequency,rows[2].frequency);
  const full=P.render(source,{}, {sampleRate:8000,stems:true});
  const clip=P.render(source,{}, {start:.625,end:1.5,sampleRate:8000,stems:true});
  const crop=audio=>audio.samples.slice(10000,24000);
  assert.deepEqual(clip.value.samples,crop(full.value));
  assert.deepEqual(clip.stems.room.samples,crop(full.stems.room));
  assert(full.stems.room.samples.some(x=>Math.abs(x)>.0001));
  const muted=P.render(source,{}, {sampleRate:8000,stems:true,layers:{lead:0}});
  assert.equal(muted.report.peak,0);
});

test('sample zones use velocity, articulation and alternate takes, with a shared choke group',()=>{
  const sample=(frequency)=>({sampleRate:8000,channels:1,samples:Float32Array.from({length:4000},(_,i)=>.4*Math.sin(i*frequency))});
  const bank={low:sample(.1),a:sample(.2),b:sample(.3),open:sample(.4)};
  const source=small();
  source.arrangement.parts.lead.role='percussion';
  source.arrangement.motifs.melody.events=[
    {beat:0,duration:.06,velocity:.3},
    {beat:1,duration:.06,velocity:.9},
    {beat:2,duration:.06,velocity:.9},
    {beat:2.5,duration:.06,velocity:.9,play:{articulation:'open'}}];
  source.patches.glass={type:'sample',zones:[
    {samples:['low'],velocity:[0,.5]},
    {samples:['a','b'],velocity:[.5,1]},
    {samples:['open'],articulation:'open'}]};
  source.tracks.lead={patch:'glass',choke:'cymbals'};
  const notes=P.inspect(source,bank).events.lead;
  assert.equal(notes[2].choke,1.25);
  const samples=P.render(source,bank,{sampleRate:8000}).value.samples;
  for (const onset of [0,.5,1,1.25]) assert(Math.abs(samples[Math.floor((onset+.007)*16000)])>.001);
  assert.notDeepEqual(samples.slice(8100,8500),samples.slice(16100,16500));
});

test('generated answers respond to musical context, while pocket and pad revisions preserve the hook',()=>{
  const {production}=recipe;
  const proposals=P.suggest(production,{},assets);
  assert.deepEqual(proposals.variants.map(row=>row.id),['lead','pocket','arrival']);
  const original=P.inspect(production,assets);
  const keep=note=>({time:note.time,midi:note.midi,velocity:note.velocity});
  for (const proposal of proposals.variants.filter(row=>row.id!=='lead')) {
    const revised=P.revise(production,proposal.revision,assets);
    assert.deepEqual(P.inspect(revised,assets).events.lead.map(keep),original.events.lead.map(keep));
  }
  const changed=structuredClone(production);
  const harmonic=changed.arrangement.score.harmonies.clear;
  harmonic.root='A3';
  harmonic.quality='major7';
  const alternative=P.suggest(changed,{intent:'lead'},assets);
  assert.notDeepEqual(alternative.variants[0].revision.edits,proposals.variants[0].revision.edits);
  const pocket=proposals.variants.find(row=>row.id==='pocket');
  assert.deepEqual(pocket.parts,['bass','snare']);
  const pinned=structuredClone(production);
  pinned.arrangement.pins=['part:lead'];
  assert(P.suggest(pinned,{},assets).blocked.some(block=>block.id==='lead'));
  assert.throws(()=>P.revise(pinned,{tracks:{lead:{pan:.4}}},assets),/pinned part/);
  assert.throws(()=>P.revise(pinned,{patches:{glass:{type:'fm'}}},assets),/pinned part/);
  const findings=P.analyze(production,assets,{section:'pressure'});
  assert(findings.sections[0].pairs.some(row=>row.parts.includes('kick') && row.parts.includes('bass')));
});

test('audition matches actual loudness and constrains oversampled peaks while keeping editable takes and stems',()=>{
  const source=small();
  const run=P.audition(source,[{id:'before'},{id:'after',tracks:{lead:{gain:-3}}}],{},
    {sampleRate:8000,target:-20,ceiling:-1});
  const [before,after]=run.takes;
  assert.notEqual(before.before.lufs,after.before.lufs);
  assert.equal(before.report.lufs,after.report.lufs);
  assert(Math.abs(P.meters(before.value,true).lufs-P.meters(after.value,true).lufs)<.01);
  assert(before.report.truePeak<=10**(-1/20));
  assert.deepEqual(Object.keys(after.stems),['lead','room']);
  assert.equal(after.production.tracks.lead.gain,-3);
});

function adaptive() {
  return {tempo:120,entry:'idle',sections:{idle:{resource:'idle'},active:{resource:'active',layers:{lead:.7}}},
    parameters:{intensity:{default:0}},
    cues:{mark:{resource:'mark'}},
    transitions:[{id:'open',from:'idle',to:'active',quantize:'bar',
      when:{path:'/parameters/intensity',op:'gte',value:.5},cue:'mark'}]};
}
function timeline() {
  return {entry:'idle',end:4,segments:{idle:{source:'track'},active:{source:'track',start:{beat:1}},
    bridge:{source:'track',start:0,end:.24},mark:{source:'track',start:.25,end:.47}},
    transitions:[{from:'idle',to:'active',exit:{beat:3},entry:{beat:1},bridge:'bridge',pickup:.18,
      tail:.14,fadeIn:.06}],stingers:{mark:'mark'}};
}

test('real adaptive intents place an exit, pickup and stinger and remain sample-aligned after trimming',()=>{
  const machine=K.music.create(adaptive());
  const ready=machine.advance(machine.initial(),{time:.5,parameters:{intensity:1}});
  const result=machine.advance(ready.state ?? ready,{time:2.5});
  const events=[...ready.intents,...result.intents];
  assert.deepEqual(events.map(row=>row.kind),['music-transition','music-cue']);
  assert.equal(events[0].time,2);
  const bank={track:small()}, spec=timeline();
  const whole=P.renderTimeline(bank,spec,events,{}, {sampleRate:8000,stems:true});
  const trim=P.renderTimeline(bank,spec,events,{},
    {sampleRate:8000,start:clockPosition(14211,8000),end:clockPosition(20017,8000),stems:true});
  assert.deepEqual(trim.value.samples,whole.value.samples.slice(28422,40034));
  assert.equal(whole.report.markers[0].beat,4);
  assert(whole.report.placements.some(row=>row.kind==='bridge' && Math.abs(row.at-1.82)<1e-9));
  assert(whole.report.placements.some(row=>row.kind==='stinger' && row.at===2));
  assert(whole.report.placements.some(row=>row.segment==='idle' && row.to===1.5 && row.tail===.14));
});

test('scene export replays the production soundtrack with identical samples in a trimmed take',()=>{
  const score=adaptive(), world={format:'ink-studio/world',id:'production-world',dt:.05,
    systems:{score:{kind:'adaptive-music',config:score}},
    commands:[{tick:10,action:'world/input',args:{port:'score/parameter.intensity',value:1}}]};
  const program=createSceneAudio({format:'ink-studio/scene-audio',version:1,sampleRate:8000,
    music:{system:'score',production:{sources:{track:small()},timeline:timeline()}}},
  {kit,resolveAsset:()=>undefined,runtime:()=>K.world.runtime.create(world)});
  const T=K.procedural.takeTime;
  const full=program.render({startPoint:T.read(0),endPoint:T.read(4)});
  const piece=program.render({startPoint:T.read(clockPosition(14099,8000)),endPoint:T.read(clockPosition(20033,8000))});
  assert.equal(full.report.stems.music.voices,1);
  assert.deepEqual(WAV.decode(piece.waves.music).samples,WAV.decode(full.waves.music).samples.slice(28198,40066));
  const fixed=P.renderTimeline({track:small()},timeline(),[],{},{sampleRate:8000});
  assert.notDeepEqual(WAV.decode(full.waves.music).samples.slice(32000,34000),fixed.value.samples.slice(32000,34000));
});
