const test=require('node:test'), assert=require('node:assert/strict');
const {KIT}=require('..').load();
const P=KIT.procedural, recording=require('../cli/music-session-recording.js');
const rate=8000, loop={from:0,to:16000}, samples=value=>({samples:value});
const source={
  format:'ink-studio/music-edit-session',version:1,id:'test-recording',sampleRate:rate,
  production:{
    arrangement:{score:{tempoMap:{tempo:120},harmonies:{home:{root:'C4',quality:'unison'}}},
      sections:[{id:'main',bars:1,harmony:'home'}],parts:{lead:{role:'lead'}},motifs:{}},
    patches:{voice:{type:'analog'}},
    tracks:{lead:{patch:'voice',groove:{step:.5,timing:[.045],accents:[.8]},clips:[{id:'line',beat:0,length:4,voices:[{id:'line',notes:[
      {id:'note',beat:.4,midi:60,velocity:.6,duration:1.2}
    ]}]}]}}
  },
  mixer:{output:'master',strips:{master:{inserts:['tone']}},processors:{
    tone:{type:'eq',bands:[{mode:'highpass',hz:100,q:.8}]}
  }}
};
const header={client:'test',id:'0123456789abcdef01234567',from:loop.from,to:loop.to,pass:1};

test('append a microphone lane and native score take without restarting the live transport',()=>{
  const editor=P.mediaGraph.musicSession.create(), transport=editor.open(source,{preroll:false});
  const control=editor.open(source,{preroll:false});
  transport.pull(2803);
  control.pull(2803);
  const data=Buffer.alloc(loop.to*4);
  for (let i=0;i<loop.to;i++) data.writeFloatLE(.12*Math.sin(i*.04),i*4);
  const {take,changes,asset}=recording.capture(P,source,transport.state(),{
    ...header,lane:'lead',mic:{},notes:[
      {start:900,end:4800,midi:64,velocity:.6,curves:{pitchCents:[[0,0],[800,50]],pressure:[[0,.18],[3800,.8]]}},
      {start:1100,end:4000,midi:67,velocity:.7}
    ]
  },data,{});
  editor.addAsset(asset.name,asset.pcm);
  const before=transport.state();
  const after=transport.applyPrepared(editor.prepareLive(editor.edit(source,changes)));
  assert.equal(after.frame,before.frame);
  assert.equal(after.scoreSample,before.scoreSample);
  assert.deepEqual(after.lanes.mic.takes,['silence',take]);
  assert.deepEqual(after.lanes.lead.takes,['reference',take]);
  assert.equal(transport.inspect().lanes.mic.takes[take].at.samples,0);
  const notes=transport.inspect().lanes.lead.takes[take];
  assert.equal(Math.round(notes[0].time*rate),900);
  assert.equal(Math.round((notes[1].time+notes[1].gate)*rate),4000);
  assert.notEqual(notes[0].address[2],notes[1].address[2]);
  assert.equal(notes[0].play.curves.pitchCents[1][1],50);
  assert.deepEqual(transport.pull(64).value.samples,control.pull(64).value.samples);
  const afterKeep=editor.edit(transport.document(),[
    {op:'comp',lane:'mic',take,from:samples(0),to:samples(loop.to)},
    {op:'comp',lane:'lead',take,from:samples(0),to:samples(loop.to)}
  ]);
  const restored=P.mediaGraph.musicSession.create({[asset.name]:asset.pcm}).render(afterKeep);
  const saved=editor.render(afterKeep);
  assert.deepEqual(restored.value.samples,saved.value.samples);
});

test('gesture recording retains the score and stores addressed knots suitable for comping',()=>{
  const editor=P.mediaGraph.musicSession.create();
  const state=editor.open(source).state();
  const args={...header,lane:'lead',gesture:{breath:[[0,.4],[1200,.52],[7100,.9]],
    pitchCents:[[0,-50],[8192,110]]}};
  const {take,changes}=recording.capture(P,source,state,args,Buffer.alloc(0),{lead:'pitch'});
  const edited=editor.edit(source,changes), inspected=editor.inspect(edited);
  const lane=inspected.lanes.lead;
  assert.deepEqual(lane.takes[take].map(row=>row.midi),lane.takes.reference.map(row=>row.midi));
  assert.equal(lane.performances[take][0].drivers.breath[2].value,.9);
  assert.equal(lane.performances[take][0].drivers.breath[2].beat,1.775);
  assert.throws(()=>recording.capture(P,source,state,{...args,notes:[]},Buffer.alloc(0),{}),/notes/);
  assert.throws(()=>recording.capture(P,source,state,{...args,to:loop.to-1},Buffer.alloc(0),{}),/current loop/);
});

test('only contiguous scheduled loop passes can be recovered, including across a lead-in',async()=>{
  const {createPassClock}=await import('../src/show/music-session-recording-clock.mjs');
  const clock=createPassClock(), loop={from:400,to:800};
  clock.schedule({loop,frame:0,pass:0,scoreSample:280},500,240);
  clock.schedule({loop,frame:240,pass:0,scoreSample:520},750,280);
  assert.equal(clock.last(1050),undefined);
  clock.schedule({loop,frame:520,pass:1,scoreSample:400},1030,460);
  assert.deepEqual(clock.last(1430),{from:400,to:800,pass:1,first:1030,end:1430});
  assert.equal(clock.last(1429),undefined);
  clock.schedule({loop:{from:300,to:500},frame:980,pass:0,scoreSample:300},1490,220);
  assert.deepEqual(clock.last(1710),{from:300,to:500,pass:0,first:1490,end:1690});
});

test('MIDI notes crossing the loop retain pedal, release and recorded expression',async()=>{
  const {createMidiCapture}=await import('../src/show/music-session-recording-clock.mjs');
  const capture=createMidiCapture(rate);
  capture.midi([0xb2,2,30],100);
  capture.midi([0x92,64,100],500);
  capture.midi([0xd2,73],1250);
  capture.midi([0xb2,64,127],1500);
  capture.midi([0x82,64,0],1600);
  capture.midi([0xb2,2,127],1850);
  capture.midi([0xb2,64,0],2300);
  const [first]=capture.played(1000,2000), [second]=capture.played(2000,3000);
  assert.deepEqual([first.start,first.end,second.start,second.end],[0,1000,0,300]);
  assert.deepEqual(first.curves.breath,[[0,30/127],[850,1]]);
  assert.deepEqual(second.curves.pressure,[[0,73/127]]);
  assert.deepEqual(capture.gestures(1000,2000).breath,first.curves.breath);
});
