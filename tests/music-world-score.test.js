const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createSceneAudio}=require('../cli/scene-audio.js');
const WAV=require('../cli/wav.js');
const kit=require('..').load(), K=kit.KIT, P=K.music.production, T=K.procedural.takeTime;
const sampleRate=8000;
const point=n=>({numerator:n,denominator:sampleRate});
const bank={score:{
  arrangement:{score:{key:{root:'C4',mode:'minor'},harmonies:{home:{root:'C4',quality:'minor',notes:[60]}},
    tempoMap:{tempo:120,changes:[{beat:2,tempo:60}]}},motifs:{},
    parts:{pad:{role:'pad',material:{sustain:true}},reply:{role:'percussion'}},
    sections:[{id:'home',bars:1,harmony:'home'}]},
  patches:{tone:{type:'fm'},rim:{type:'drum',kind:'rim',decay:.035}},
  tracks:{pad:{patch:'tone',send:.6,gain:-18},reply:{patch:'rim',gain:-12,choke:'metal'}}
}};
const timeline={entry:'approach',end:3,segments:{
  approach:{source:'score',end:{beat:2}},reveal:{source:'score',start:{beat:2}}}};
const intents=[{kind:'music-transition',time:1.9,from:'approach',to:'reveal'}];
const rhythm={id:'answer',cue:'relay',track:'reply',segments:['approach'],grid:.5,
  hits:[{beat:0},{beat:.5,level:.4}]};
const space=[
  {id:'dip',cue:'step',hold:.15,attack:.05,release:.15,tracks:['pad'],level:.25},
  {id:'overlap',from:.64,to:.7,attack:0,release:0,tracks:['pad'],level:.5},
  {id:'cut',from:1.66,to:1.98,attack:.06,release:.2}
];
const rows=[{cue:'relay',time:.39,strength:.8},{cue:'relay',time:.88},{cue:'relay',time:1.8},
  {cue:'relay',time:2.22},{cue:'step',time:.61}];
const render=(world,options={},score=timeline,changes=intents)=>
  P.renderTimeline(bank,score,changes,{}, {sampleRate,stems:true,world,...options});
const window=(wave,from,to)=>wave.samples.slice(Math.round(from*sampleRate)*2,Math.round(to*sampleRate)*2);

test('a cue answers on the active score grid across a loop, then the percussion stops at the transition',()=>{
  const before=P.inspect(bank.score).events;
  const result=render({rhythms:[rhythm],events:rows});
  const hits=result.report.world.responses;
  assert.deepEqual(hits.map(row=>row.time),[.5,.75,1,1.25]);
  assert.deepEqual(hits.slice(0,2).map(row=>Math.round(row.velocity*100)),[80,32]);
  assert(hits.every(row=>row.track==='reply' && row.segment==='approach'));
  for (const {time} of hits) assert(window(result.stems.reply,time,time+.03).some(value=>Math.abs(value)>.001));
  assert(window(result.stems.reply,1.9,3).every(value=>value===0));
  assert.deepEqual(P.inspect(bank.score).events,before);
  const reveal=render({rhythms:[{...rhythm,segments:['reveal']}],events:rows});
  assert.deepEqual(reveal.report.world.responses.map(row=>row.time),[2.4,2.9]);
  assert.throws(()=>render({rhythms:[{...rhythm,track:'pad'}],events:rows}),/percussion track/);
});

test('score space uses absolute sample windows, silences room tails, and combines overlapping controls',()=>{
  const rules={rhythms:[rhythm],space,events:rows};
  const whole=render(rules), dry=render({rhythms:[rhythm],events:rows});
  const at=Math.round(.66*sampleRate)*2;
  assert(Math.abs(dry.stems.pad.samples[at])>.001);
  assert.equal(whole.stems.pad.samples[at],dry.stems.pad.samples[at]*.25);
  assert.deepEqual(whole.stems.room.samples.slice(at,at+1000),dry.stems.room.samples.slice(at,at+1000));
  assert.deepEqual(whole.stems.reply.samples.slice(at,at+1000),dry.stems.reply.samples.slice(at,at+1000));
  assert(window(dry.value,1.66,1.98).some(x=>Math.abs(x)>.001));
  assert(window(whole.value,1.66,1.98).every(x=>x===0));
  assert(window(whole.stems.room,1.66,1.98).every(x=>x===0));
  const trim=render(rules,{start:point(4577),end:point(16933)});
  assert.deepEqual(trim.value.samples,whole.value.samples.slice(4577*2,16933*2));
  assert.deepEqual(trim.report.world,whole.report.world);
});

test('the graph can feed detected sound onsets directly into a production response',()=>{
  const impulse=Float32Array.from({length:sampleRate},(_,i)=>i>=1120 && i<1184 ? .7*Math.sin(i*1.69) : 0);
  const source={sampleRate,channels:1,samples:Array.from(impulse)};
  const graph=K.procedural.graph.create({nodes:{
    scan:{op:'audio.detectTransients',inputs:{source,options:{name:'relay'}}},
    music:{op:'music.renderTransitions',inputs:{sources:bank,timeline,intents,
      options:{sampleRate,world:{rhythms:[rhythm]}},worldEvents:{node:'scan',port:'events'}}}
  },outputs:{report:{node:'music',port:'report'}}});
  const hits=graph.evaluate().outputs.report.world.responses;
  assert.deepEqual(hits.map(row=>row.time),[.25,.5]);
  assert(hits.every(row=>row.cue==='relay' && row.cueTime>=.13 && row.cueTime<.15));
});

test('scene soundtrack follows spatial shots and timeline clips without changing their stems',()=>{
  const world={id:'score-world',dt:.01,takeClock:{simulationRate:100},
    timeline:{duration:3.4,audio:[{id:'latch',cue:'latch',time:1.68,duration:.12},
      {id:'last',cue:'latch',time:3.04,duration:.12}]},
    systems:{score:{kind:'adaptive-music',config:{tempo:120,entry:'approach',
      sections:{approach:{resource:'approach'},reveal:{resource:'reveal'}},parameters:{open:{default:0}},
      transitions:[{id:'open',from:'approach',to:'reveal',quantize:'none',
        when:{path:'/parameters/open',op:'gte',value:1}}]}}},
    commands:[
      {tick:39,action:'world/event',args:{kind:'audio-cue',cue:'relay',at:[3,0,0]}},
      {tick:190,action:'world/input',args:{port:'score/parameter.open',value:1}}
    ]};
  const options={kit,resolveAsset:()=>({sampleRate,channels:1,samples:new Float32Array(1600).fill(.15)}),
    runtime:()=>K.world.runtime.create(world)};
  const scene=rules=>createSceneAudio({format:'ink-studio/scene-audio',version:1,sampleRate,
    spatial:{cues:{relay:'click'}},
    music:{system:'score',production:{sources:bank,timeline,...(rules && {world:rules})}}},options);
  const take=(program,from,to)=>program.render({startPoint:T.read(from),endPoint:T.read(to)});
  const rules={rhythms:[rhythm],space:[{id:'latch-space',cue:'latch',attack:.12,release:.1}]};
  const baseline=take(scene(),0,3.2), whole=take(scene(rules),0,3.2);
  assert.deepEqual(whole.waves.spatial,baseline.waves.spatial);
  assert.deepEqual(whole.waves.timeline,baseline.waves.timeline);
  const report=whole.report.worldScore;
  assert.equal(report.responses[0].cueTime,.39);
  assert.equal(report.responses[0].time,.5);
  assert.equal(Math.round(report.windows[0].to*sampleRate),1.8*sampleRate);
  assert.equal(report.windows[1].from,3.04);
  assert(window(WAV.decode(whole.waves.music),1.68,1.8).every(x=>x===0));
  assert(window(WAV.decode(whole.waves.mix),1.68,1.8).every(x=>x>.1));
  const trim=take(scene(rules),point(13455),point(23896));
  for (const name of ['mix','music','timeline','spatial']) assert.deepEqual(WAV.decode(trim.waves[name]).samples,
    WAV.decode(whole.waves[name]).samples.slice(13455*2,23896*2));
  assert.deepEqual(trim.report.worldScore,report);
});
