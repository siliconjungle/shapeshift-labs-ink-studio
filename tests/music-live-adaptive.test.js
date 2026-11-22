const test=require('node:test'), assert=require('node:assert/strict');
const {KIT}=require('..').load(), live=KIT.music.production.live, rate=8000;
const patch={type:'fm',ratio:2,index:.67,env:{attack:.021,decay:.17,sustain:.6,release:.42},
  echo:{delay:.147,feedback:.51,send:.38}};
function cue(notes) {
  return {seed:101,arrangement:{score:{key:{root:'D3'},tempoMap:{tempo:120},
    harmonies:{home:{root:'D3',quality:'unison'}}},motifs:{},parts:{reed:{role:'lead'}},
    sections:[{id:'phrase',bars:2,harmony:'home'}]},patches:{reed:patch},
    tracks:{reed:{patch:'reed',gain:-9,pan:-.17,send:.66,clips:[{id:'source',beat:0,length:8,
      voices:[{id:'voice',notes:notes.map(([beat,duration,midi],i)=>({id:'note-'+i,beat,duration,midi,velocity:.81}))}]}]}},
    room:{gain:-1,size:1.21,decay:1.26,damping:.42}};
}
const sources={air:cue([[.20,2.8,57]]),silent:cue([]),reply:cue([[.30,.4,65]]),
  changed:cue([[.55,.3,72]])};
const timeline={entry:'bank',segments:{bank:{source:'air',end:2},
  tower:{source:'silent',end:1},tunnel:{source:'reply',end:1}},
  performers:{tracks:['reed']},transitions:[{from:'bank',to:'tower',exit:1}]};
const options={sampleRate:rate};
const transition=(from,to,time,rule='advance')=>({kind:'music-transition',from,to,time,rule});
const trigger=(resource,time,linked)=>({kind:'music-cue',resource,cue:resource,time,...(linked && {transition:linked})});
const event=(intent,observedAt=intent.time)=>({intent,observedAt});
const hasAudio=samples=>samples.some(n=>Math.abs(n)>.0001);

test('live joins preserve the original note, resonance, tape and room across the real authored exit',async()=>{
  const events=[event(transition('bank','tower',.42))];
  const result=await live.replay(sources,timeline,{end:1.95,events,blockFrames:131},options);
  const control=await live.replay(sources,timeline,{end:1.95,events:[],blockFrames:511},options);
  assert.deepEqual(result.value.samples,control.value.samples);
  const [join]=result.report.joins;
  assert.equal(join.frame,8000);
  assert.equal(join.exit.played,1);
  assert.equal(join.trigger.time,.42);
  assert.equal(join.carry.held[0].pitch,57);
  assert.equal(join.carry.held[0].phaseFrames,7200);
  assert.equal(join.carry.held[0].state,'held');
  assert.deepEqual(join.carry.echoes,['reed']);
  assert.equal(join.audio.clippedFrames,0);
  assert(hasAudio(result.value.samples.slice(1.65*rate*2)));
});

test('reversal cancels a pending exit and a delayed event is audible at the next valid marker',async()=>{
  const events=[event(transition('bank','tower',.15)),event(transition('tower','bank',.36,'reverse')),
    event(transition('bank','tower',.54),1.33)];
  const out=await live.replay(sources,timeline,{end:3.4,events},options);
  assert.equal(out.report.profile.cancellations,1);
  assert.equal(out.report.profile.lateEvents,1);
  assert.equal(out.report.joins.length,1);
  assert.equal(out.report.joins[0].time,3);
  assert.equal(out.report.joins[0].arrivalFrame,Math.round(1.33*rate));
  assert.equal(out.report.joins[0].heard.phrases.bank,1);
  assert(out.report.trace.some(row=>row.reason==='reversal'));
});

test('pending exit can be cancelled at the boundary and linked sound follows the selected section',async()=>{
  const arranged={...timeline,stingers:{hit:'tunnel'},stingerRules:[{resource:'hit',section:'tower',linked:true}]};
  const events=[event(transition('bank','tower',.5)),event(trigger('hit',.5,'advance'))];
  const out=await live.replay(sources,arranged,{end:1.55,events},options);
  assert(out.report.trace.some(row=>row.frame===rate && row.reason==='withheld'));
  const cancelled=await live.replay(sources,arranged,{end:1.55,
    events:[...events,event(transition('tower','bank',1,'reverse'))]},options);
  assert.equal(cancelled.report.joins.length,0);
  assert.equal(cancelled.report.profile.cancellations,1);
});

test('only completed and admitted phrases participate in the choice, with bounded traces through a long dwell',async()=>{
  const arranged={...timeline,segments:{...timeline.segments,tower:{source:'reply',end:1}},
    phrasing:{listen:{tower:['reed']},routes:{tower:[
      {id:'familiar',source:'changed',when:{heard:[{phrase:'tower'}]}}
    ]}}};
  const events=[event(transition('bank','tower',.5))];
  const out=await live.replay(sources,arranged,{end:32,events},{...options,traceLimit:3});
  assert.equal(out.report.joins[0].entry.phrase,'tower');
  assert.equal(out.report.heard.tower,1);
  assert.equal(out.report.heard.familiar,29);
  assert(out.report.trace.length<=3);
  assert(out.report.profile.peakClips<=2);
  const muted=await live.replay(sources,arranged,{end:4.1,
    events:[event({...transition('bank','tower',.5),layers:{reed:0}})]},options);
  assert.deepEqual(muted.report.heard,{});
});

test('foreground voice slots survive competing PCM cues and page reads stay bounded',async()=>{
  const events=Array.from({length:17},(_,i)=>event(trigger('metal',i*.016)));
  const reads=[];
  const streamOpts={...options,maxVoices:3,reservedVoices:1,foreground:['reed'],pageSize:256,maxPages:5,
    streams:{metal:{frames:3700,sampleRate:rate,channels:1,gain:-18}},
    readPage:async(name,first,frames)=>{
      reads.push([name,first,frames]);
      return Float32Array.from({length:frames},(_,i)=>.35*Math.sin((first+i)*.26));
    }};
  const out=await live.replay(sources,timeline,{end:1,events,blockFrames:117},streamOpts);
  assert(out.report.profile.dropped>0);
  assert.equal(out.report.profile.foregroundStarts,1);
  assert.equal(out.report.profile.foregroundDropped,0);
  assert(out.report.profile.peakVoices<=3);
  assert.equal(out.report.profile.streamGaps,0);
  assert(out.report.profile.stream.pages<=5);
  assert(reads.some(([,first])=>first>0));
  assert(reads.every(([,first,count])=>first%256===0 && count<=256));
  assert(hasAudio(out.value.samples));
});

test('missing PCM fades out and resumes at its elapsed time, with cold misses reported',async()=>{
  const engine=live.open(sources,timeline,{...options,pageSize:256,maxPages:2,streams:{
    metal:{frames:2000,sampleRate:rate,channels:1}},
  readPage:async(name,first,count)=>new Float32Array(count).fill(.25+first/4000)});
  engine.dispatch(trigger('metal',0));
  assert(!hasAudio(engine.pull(448).samples));
  assert.equal(engine.inspect().profile.streamGaps,1);
  await engine.prefetch(256);
  const page=engine.pull(64).samples;
  assert(page[0]>.004 && page[0]<.02);
  assert(page[2*31]>.14);
  assert.equal(engine.inspect().profile.streamGaps,1);
});

test('drive the same live engine from a recorded control clock or live world updates',async()=>{
  const clock={tempo:120,entry:'bank',sections:{bank:{resource:'bank'},tower:{resource:'tower'}},
    parameters:{alarm:{}},transitions:[{id:'alarm',from:'bank',to:'tower',quantize:'half-bar',
      when:{path:'/parameters/alarm',op:'gte',value:1}}]};
  const updates=[{time:.22,parameters:{alarm:1}},{time:.68,parameters:{alarm:0}},
    {time:1.08,parameters:{alarm:1}},{time:2.4}];
  const trace=KIT.music.production.rehearsal.captureScore(clock,updates,{id:'rising',end:2.8});
  assert(trace.requests.some(row=>row.outcome==='cancelled'));
  const replay=await live.replay(sources,timeline,live.fromTrace(trace),options);
  const engine=live.open(sources,timeline,{...options,clock}), samples=new Float32Array(replay.value.samples.length);
  let cursor=0;
  for (const row of [...updates,{time:2.8}]) {
    const frame=Math.round(row.time*rate);
    // The world advances before this buffer is handed to the output device.
    const start=frame-cursor;
    engine.update(row);
    samples.set(engine.pull(start).samples,cursor*2);
    cursor=frame;
  }
  assert.deepEqual(samples,replay.value.samples);
  assert.deepEqual(engine.inspect().joins,replay.report.joins.map(({audio,...rest})=>rest));
});

test('late superseded control instructions cannot resurrect a cancelled exit or its cue',async()=>{
  const arranged={...timeline,stingers:{hit:'tunnel'}};
  const events=[event(transition('bank','tower',.19)),event(trigger('hit',.19,'advance')),
    event(transition('tower','bank',.37,'back')),event(transition('bank','tower',.32,'old'),.92),
    event(trigger('hit',.19,'advance'),1.05)];
  const out=await live.replay(sources,arranged,{end:2,events},options);
  assert.equal(out.report.joins.length,0);
  assert(out.report.trace.some(row=>row.reason==='stale-intent'));
  assert.equal(out.report.trace.filter(row=>row.reason==='transition-did-not-land').length,2);
  const baseline=await live.replay(sources,arranged,{end:2,events:[]},options);
  assert.deepEqual(out.value.samples,baseline.value.samples);
});

test('a bridge can sound as a pickup and stops admitting notes when its transition is cancelled',async()=>{
  const arranged={...timeline,segments:{...timeline.segments,bridge:{source:'accent',end:1}},
    transitions:[{from:'bank',to:'tower',exit:1,bridge:'bridge',pickup:.60}]};
  const assets={...sources,accent:cue([[.12,.36,70],[1.24,.40,80]])};
  const events=[event(transition('bank','tower',.18)),event(transition('tower','bank',.68,'back'))];
  const out=await live.replay(assets,arranged,{end:1.3,events},options);
  const baseline=await live.replay(assets,arranged,{end:1.3,events:[]},options);
  assert.equal(out.report.profile.starts,2);
  assert.equal(out.report.joins.length,0);
  assert.notDeepEqual(out.value.samples,baseline.value.samples);
});

test('native WAV pages match the corresponding ranges of the original sample',async()=>{
  const fs=require('node:fs/promises'), os=require('node:os'), path=require('node:path'), WAV=require('../cli/wav');
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ink-live-pcm-'));
  try {
    const file=path.join(dir,'page.wav');
    const value={sampleRate:rate,channels:2,samples:Float32Array.from({length:3072},(_,i)=>Math.sin(i*.043))};
    const bytes=WAV.encode(value,{encoding:'pcm24'});
    await fs.writeFile(file,bytes);
    const reader=await WAV.openPages(file);
    try {
      assert.equal(reader.frames,1536);
      assert.equal(reader.sampleRate,rate);
      assert.equal(reader.channels,2);
      assert.deepEqual(await reader.readPage(791,316),Float32Array.from(WAV.decode(bytes).samples.slice(1582,2214)));
      await assert.rejects(reader.readPage(1535,2),/page range/);
    } finally {
      await reader.close();
    }
  } finally {
    await fs.rm(dir,{recursive:true,force:true});
  }
});
