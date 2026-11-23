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

test('layer ramps follow the sample clock on one held note, including retargets and late delivery',async()=>{
  const dry=cue([[0,3.8,57]]);
  const {echo,...dryPatch}=dry.patches.reed;
  dry.patches.reed=dryPatch;
  dry.tracks.reed.send=0;
  const assets={air:dry}, arranged={entry:'bank',segments:{bank:{source:'air',end:2,loop:false}}};
  const settings={...options,startTime:10};
  const layer=(time,gain,ramp,serial)=>({kind:'music-layer',time,part:'reed',gain,ramp,serial});
  const route={end:1.6,layerGains:{reed:0},events:[
    event(layer(10.25,1,.5,1)),event(layer(10.5,.25,.25,2)),
    event(layer(10.3,.8,.1,3),10.625),event(layer(10.875,0,.25,4),11)
  ]};
  const faded=await live.replay(assets,arranged,{...route,blockFrames:131},settings);
  const reblocked=await live.replay(assets,arranged,{...route,blockFrames:512},settings);
  const baseline=await live.replay(assets,arranged,{end:route.end,events:[]},settings);
  assert.deepEqual(faded.value.samples,reblocked.value.samples);
  assert.equal(faded.report.profile.starts,1);
  assert.equal(faded.report.profile.lateEvents,2);
  assert.deepEqual(faded.report.joins,[]);
  assert.deepEqual(faded.report.trace.filter(row=>row.kind==='layer-gain')
    .map(({from,target,startFrame,endFrame})=>[from,target,startFrame,endFrame]),
  [[0,1,2000,6000],[.5,.25,4000,6000],[.25,0,8000,10000]]);
  assert(faded.report.trace.some(row=>row.kind==='layer-ignored' && row.reason==='stale-intent'));
  assert.deepEqual(faded.report.layerGains.reed,{gain:0,target:0,startFrame:8000,endFrame:10000});

  const {samples}=baseline.value;
  for (let i=0;i<samples.length;i++) {
    const frame=i>>1;
    const gain=frame<4000 ? Math.max(0,(frame-2000)/4000) :
      frame<6000 ? .5-.25*(frame-4000)/2000 : .25*Math.min(1,Math.max(0,(10000-frame)/2000));
    assert(Math.abs(faded.value.samples[i]-samples[i]*gain)<2e-8,`feed at frame ${frame}`);
  }
});

test('world recordings and live clock updates share initial layers, ramps, and held-note playback',async()=>{
  const base=cue([[0,3.8,57]]);
  const assets={air:base}, arranged={entry:'bank',segments:{bank:{source:'air',end:2,loop:false}}};
  const clock={entry:'bank',sections:{bank:{resource:'bank'}},parameters:{danger:{default:.4,attack:.8}},
    layerControls:{reed:{parameter:'danger',range:[.2,.6],attack:.35,release:.15}}};
  const updates=[{time:.25,parameters:{danger:1}},{time:.75,parameters:{danger:0}}];
  const world=KIT.world.runtime.create({id:'alarm',dt:.05,systems:{score:{kind:'adaptive-music',config:clock}},
    commands:updates.map(row=>({tick:Math.round(row.time/.05),action:'world/input',
      args:{port:'score/parameter.danger',value:row.parameters.danger}}))});
  world.advance(26);
  const rehearsal=KIT.music.production.rehearsal;
  const trace=rehearsal.capture(world.recording(),{id:'watch'});
  const steps=rehearsal.captureScore(clock,updates,{id:'watch',end:1.3});
  assert(Math.abs(trace.layerGains.reed-.5)<1e-10);
  const ramps=val=>val.intents.map(({kind,time,part,gain,ramp})=>[kind,time,part,gain,ramp]);
  assert.deepEqual(ramps(trace),[
    ['music-layer',.25,'reed',1,.35],['music-layer',.75,'reed',0,.15]
  ]);
  assert.deepEqual(ramps(trace),ramps(steps));
  const replay=await live.replay(assets,arranged,live.fromTrace(JSON.parse(JSON.stringify(trace))),options);
  const engine=live.open(assets,arranged,{...options,clock});
  const livePCM=new Float32Array(replay.value.samples.length);
  let frame=0;
  for (const row of updates) {
    const next=Math.round(row.time*rate);
    livePCM.set(engine.pull(next-frame).samples,frame*2);
    engine.update(row);
    frame=next;
  }
  livePCM.set(engine.pull(livePCM.length/2-frame).samples,frame*2);
  assert.deepEqual(livePCM,replay.value.samples);
  assert.equal(replay.report.profile.starts,1);
  assert.equal(replay.report.joins.length,0);
  assert.throws(()=>engine.dispatch({kind:'music-layer',time:1.3,part:'absent',gain:1}),/Invalid live adaptive score intent/);
  assert.throws(()=>engine.dispatch({kind:'music-layer',time:1.3,part:'reed',gain:-1}),/Invalid live adaptive score intent/);
});

test('muted stems reveal the common playhead through wraps, ramps and section changes',async()=>{
  const assets={silent:cue([])};
  const arranged={entry:'bank',segments:{bank:{source:'silent',end:.075},tower:{source:'silent',end:.05}}};
  const loopFrames=607, phaseFrames=73, bassStart=117, rhythmStart=701, frames=2143;
  const pcm={
    bottom:Float32Array.from({length:1200},(_,i)=>.24*Math.sin(i*.075)),
    drums:Float32Array.from({length:1540},(_,i)=>.1+.25*Math.cos(i*.023))
  };
  const settings={...options,masterGain:0,pageSize:256,maxPages:12,
    streams:{bottom:{frames:pcm.bottom.length,channels:1,sampleRate:rate,pan:-1},
      drums:{frames:pcm.drums.length,channels:1,sampleRate:rate,pan:1}},
    readPage:async(name,first,count)=>pcm[name].slice(first,first+count),
    stemGroups:{bed:{frames:loopFrames,phaseFrames,parts:{
      bass:{stream:'bottom',startFrame:bassStart},rhythm:{stream:'drums',startFrame:rhythmStart}
    }}}};
  const layer=(at,gain,ramp)=>event({kind:'music-layer',part:'bass',time:at/rate,gain,ramp:ramp/rate});
  const route={end:frames/rate,layerGains:{bass:0},events:[
    layer(998,1,286),event(transition('bank','tower',1100/rate)),layer(1810,0,120)
  ]};
  const small=await live.replay(assets,arranged,{...route,blockFrames:73},settings);
  const wide=await live.replay(assets,arranged,{...route,blockFrames:301},settings);
  assert.deepEqual(small.value.samples,wide.value.samples);
  assert.equal(small.report.profile.streamGaps,0);
  assert.equal(small.report.profile.starts,0);
  assert.equal(small.report.joins[0].frame,1100);
  assert.equal(small.report.stemGroups.bed.positionFrame,(frames+phaseFrames)%loopFrames);

  for (let frame=0;frame<frames;frame++) {
    const phase=(frame+phaseFrames)%loopFrames;
    const gain=Math.max(0,Math.min(1,(frame-998)/286,1-(frame-1810)/120));
    assert.equal(small.value.samples[2*frame],gain ? Math.fround(pcm.bottom[bassStart+phase]*gain) : 0);
    assert.equal(small.value.samples[2*frame+1],pcm.drums[rhythmStart+phase]);
  }
});

test('stem prefetch wraps within the authored PCM region and resumes from current phase after a miss',async()=>{
  const assets={silent:cue([])}, arranged={entry:'bank',segments:{bank:{source:'silent'}}};
  const pcm=Float32Array.from({length:2000},(_,i)=>i/2500);
  const reads=[];
  const settings={...options,masterGain:0,pageSize:256,maxPages:2,
    streams:{tape:{frames:pcm.length,channels:1,sampleRate:rate,pan:-1}},
    readPage:async(name,first,count)=>{
      reads.push([name,first]);
      return pcm.slice(first,first+count);
    },
    stemGroups:{room:{frames:1280,parts:{ambience:{stream:'tape',startFrame:300}}}}};
  const engine=live.open(assets,arranged,settings);
  const seam=live.open(assets,arranged,{...settings,
    stemGroups:{room:{...settings.stemGroups.room,phaseFrames:1240}}});
  await seam.prefetch(90);
  assert.deepEqual(reads,[['tape',1536],['tape',256]]);
  const across=seam.pull(90).samples;
  for (let frame=0;frame<90;frame++) assert.equal(across[frame*2],pcm[300+(1240+frame)%1280]);

  assert(!hasAudio(engine.pull(349).samples));
  await engine.prefetch(100);
  const recovered=engine.pull(100).samples;
  assert.equal(recovered[0],pcm[649]/32);
  assert.equal(recovered[62],pcm[680]);
  assert.equal(recovered[158],pcm[728]);
  const report=engine.inspect();
  assert.equal(report.profile.stream.pages,2);
  assert.equal(report.profile.streamGaps,1);
  assert.deepEqual(report.trace[0],{
    kind:'stream-underrun',frame:0,time:0,name:'tape',sourceFrame:300,group:'room',part:'ambience',positionFrame:0
  });

  assert.throws(()=>live.open(assets,arranged,{...settings,stemGroups:{
    room:{frames:1280,parts:{ambience:{stream:'tape',startFrame:900}}}
  }}),/full loop range/);
  assert.throws(()=>live.open(assets,arranged,{...settings,stemGroups:{
    room:{...settings.stemGroups.room,phaseFrames:1280}
  }}),/Invalid live stem group/);
});

test('environment factors ramp independently while pursuit holds, with exact recorded replay',async()=>{
  const arranged={entry:'bank',segments:{bank:{source:'silent',end:2}}}, assets={silent:cue([])};
  const clock={entry:'bank',sections:{bank:{resource:'bank'}},
    parameters:{pursuit:{default:.75},'weather-intensity':{default:.3},exposure:{default:.8},
      shelter:{field:'terrain/cover',at:{entity:'listener'}}},
    layerControls:{
      chase:{parameter:'pursuit',release:.2},
      storm:{factors:{
        weather:{parameter:'weather-intensity',attack:.8},
        exposure:{parameter:'exposure',release:.2},
        cover:{parameter:'shelter',range:[1,0],attack:.15,release:.6}
      }}
    }};
  const updates=[
    {time:.25,parameters:{'weather-intensity':1,shelter:1}},
    {time:.35,parameters:{exposure:.4}},
    {time:.55,parameters:{shelter:0}},
    {time:.95,parameters:{pursuit:.25}}
  ];
  const commands=updates.flatMap(({time,parameters})=>Object.entries(parameters).map(([key,value])=>({
    tick:Math.round(time/.05),
    ...(key==='shelter' ? {action:'terrain/set',args:{field:'cover',
      region:{id:'roof',bounds:{min:[-1,-1],max:[1,1]},value}}} :
      {action:'world/input',args:{port:'score/parameter.'+key,value}})
  })));
  const world=KIT.world.runtime.create({id:'storm-test',dt:.05,entities:{listener:{position:[0,0,0]}},
    systems:{score:{kind:'adaptive-music',config:clock},terrain:{kind:'fields',config:{
      fields:{cover:{type:'number',axes:'xz',default:0}}
    }}},commands});
  world.advance(26);
  const rehearsal=KIT.music.production.rehearsal;
  const capture=rehearsal.capture(world.recording(),{id:'storm'});
  const standalone=rehearsal.captureScore(clock,updates,{id:'storm',end:1.3});
  assert.deepEqual(capture.layerFactors,{storm:{weather:.3,exposure:.8,cover:1}});
  assert.deepEqual(capture.layerGains,{chase:.75});
  const intents=trace=>trace.intents.map(({part,factor,gain,ramp})=>[part,factor,gain,ramp]);
  assert.deepEqual(intents(capture),intents(standalone));
  assert.deepEqual(intents(capture),[
    ['storm','weather',1,.8],['storm','cover',0,.6],['storm','exposure',.4,.2],
    ['storm','cover',1,.15],['chase',undefined,.25,.2]
  ]);

  const frames=1024, settings={...options,masterGain:0,layerGains:{storm:.6},
    streams:{rain:{frames,channels:1,sampleRate:rate,pan:-1},pulse:{frames,channels:1,sampleRate:rate,pan:1}},
    readPage:async(name,first,count)=>new Float32Array(count).fill(name==='rain'?.5:.25),
    stemGroups:{bed:{frames,parts:{storm:{stream:'rain'},chase:{stream:'pulse'}}}}};
  const route=live.fromTrace(JSON.parse(JSON.stringify(capture)));
  const replay=await live.replay(assets,arranged,{...route,blockFrames:131},{
    ...settings,layerFactors:{storm:{weather:.9}}
  });
  const engine=live.open(assets,arranged,{...settings,clock});
  await engine.prefetch(1.3*rate);
  const livePCM=new Float32Array(replay.value.samples.length);
  let frame=0;
  for (const row of [...updates,{time:1.3}]) {
    const next=Math.round(row.time*rate);
    livePCM.set(engine.pull(next-frame).samples,2*frame);
    if (row.parameters) engine.update(row);
    frame=next;
  }
  assert.deepEqual(livePCM,replay.value.samples);
  assert.equal(replay.report.profile.streamGaps,0);
  const {samples}=replay.value;
  assert(Math.abs(samples[6400]-.5*.6*.43125*.7*.75)<1e-7);
  for (let n=1;n<.95*rate*2;n+=2) assert.equal(samples[n],.25*.75);
  const mix=replay.report.layerFactors.storm;
  assert.deepEqual(mix.factors.cover,{gain:1,target:1,startFrame:4400,endFrame:5600});
  assert(Math.abs(mix.gain-.24)<1e-12);
  engine.dispatch({kind:'music-layer',time:.4,part:'storm',factor:'weather',gain:.7});
  engine.dispatch({kind:'music-layer',time:.4,part:'storm',factor:'cover',gain:.1});
  engine.pull(1);
  const settled=engine.inspect().layerFactors.storm.factors;
  assert.equal(settled.weather.target,.7);
  assert.equal(settled.cover.target,1);
  assert.throws(()=>engine.dispatch({kind:'music-layer',time:1.3,part:'storm',factor:'unknown',gain:1}),
    /Invalid live adaptive score intent/);
  const invalid={...clock,layerControls:{storm:{parameter:'pursuit',factors:clock.layerControls.storm.factors}}};
  assert.throws(()=>KIT.music.create(invalid),/Invalid live layer factors/);
});

test('matched performance joins keep the outgoing holds, releases, tape and room',async()=>{
  const soft=cue([[.16,.46,57],[.82,.96,62]]);
  const drive=cue([[.07,.22,74],[2.7,.38,69]]);
  drive.room={gain:-40,size:.3,decay:.22,damping:.8};
  const assets={soft,drive}, arranged={entry:'restrained',segments:{
    restrained:{source:'soft',end:2},energetic:{source:'drive',end:2}},
    transitions:[{from:'restrained',to:'energetic',switchPoints:{lift:{beat:1.1},downbeat:{beat:2.6}}}]};
  const events=[event(transition('restrained','energetic',.27))];
  const out=await live.replay(assets,arranged,{end:1.6,events,blockFrames:123},options);
  const control=await live.replay(assets,arranged,{end:1.6,events:[]},options);
  const switchFrame=Math.round(.55*rate), nextAttack=Math.round(1.35*rate);
  assert.deepEqual(out.value.samples.slice(0,nextAttack*2),control.value.samples.slice(0,nextAttack*2));
  assert.notDeepEqual(out.value.samples.slice(nextAttack*2),control.value.samples.slice(nextAttack*2));
  const [join]=out.report.joins;
  assert.deepEqual(join.switchPoint,{id:'lift',position:.55});
  assert.equal(join.frame,switchFrame);
  assert.equal(join.entry.offset,join.exit.authored);
  assert.deepEqual(join.carry.held.map(({pitch,state,source})=>[pitch,state,source]),
    [[57,'release','soft'],[62,'held','soft']]);
  assert(join.carry.held.every(voice=>voice.releaseEndFrame>switchFrame));
  assert.deepEqual(join.carry.echoes,['soft/reed']);
  assert.equal(join.carry.roomLastInputFrame,switchFrame-1);
  assert.equal(out.report.profile.starts,3);
});

test('matched joins pick the next compatible point without moving the original sample grid',async()=>{
  const assets={soft:cue([]),drive:cue([])};
  const loop={end:.20015};
  const points={early:.100075,late:.1501};
  const arranged={entry:'restrained',segments:{restrained:{source:'soft',...loop},energetic:{source:'drive',...loop}},
    transitions:[{from:'restrained',to:'energetic',switchPoints:points},{from:'energetic',to:'restrained',switchPoints:points}]};
  const to=(at,energetic=true,arrival=at)=>event(transition(energetic?'restrained':'energetic',
    energetic?'energetic':'restrained',at/rate),arrival/rate);
  const route={end:.4,events:[to(120),to(500,false),to(660),to(1000,false,1400),to(2500)]};
  const out=await live.replay(assets,arranged,route,options);
  assert.deepEqual(out.report.joins.map(join=>[join.switchPoint.id,join.frame]),
    [['early',801],['early',2402],['late',2802]]);
  assert.equal(out.report.profile.cancellations,1);
  assert.equal(out.report.profile.lateEvents,1);

  const oneShot={...arranged,segments:{restrained:{...arranged.segments.restrained,loop:false},
    energetic:{...arranged.segments.energetic,loop:false}}};
  const missed=await live.replay(assets,oneShot,{end:.3,events:[to(1230)]},options);
  assert.deepEqual(missed.report.joins,[]);
  assert(missed.report.trace.some(row=>row.reason==='no-compatible-switch'));
  const incompatible=cue([]);
  incompatible.arrangement.score.tempoMap={tempo:121};
  assert.throws(()=>live.open({soft:assets.soft,drive:incompatible},arranged,options),/same score grid/);
  assert.throws(()=>live.open(assets,{...arranged,transitions:[{
    from:'restrained',to:'energetic',switchPoints:{a:.12,b:.12}
  }]},options),/distinct positions/);
});

test('score space ducks the live score and its returns while Foley keeps its own sound',async()=>{
  const assets={air:cue([[0,3.8,57]])};
  const arranged={entry:'bank',segments:{bank:{source:'air',end:2}},
    scoring:{cues:{
      latch:{passThrough:true,space:{attack:.05,hold:.16,release:.1}},
      hush:{space:{gain:.25,attack:0,hold:.15,release:.06}}
    }}};
  const settings={...options,masterGain:0,streams:{latch:{frames:3000,sampleRate:rate,channels:1,send:.55}},
    readPage:async(name,first,count)=>Float32Array.from({length:count},(_,i)=>.2*Math.sin((first+i)*.027))};
  const route={end:1.15,events:[event(trigger('latch',.25)),event(trigger('hush',.49))]};
  const [mix,score,foley]=await Promise.all([
    live.replay(assets,arranged,route,settings),
    live.replay(assets,arranged,{...route,events:[]},settings),
    live.replay({air:cue([])},arranged,{...route,events:route.events.slice(0,1)},settings)
  ]);
  function expectedGain(frame) {
    const latch=frame<2000 || frame>=4480 ? 1 : frame<2400 ? 1-(frame-2000)/400 :
      frame<3680 ? 0 : (frame-3680)/800;
    const hush=frame<3920 || frame>=5600 ? 1 : frame<5120 ? .25 : .25+.75*(frame-5120)/480;
    return Math.min(latch,hush);
  }
  for (let i=0;i<mix.value.samples.length;i++) {
    const expected=score.value.samples[i]*expectedGain(i>>1)+foley.value.samples[i];
    assert(Math.abs(mix.value.samples[i]-expected)<3e-8,`mix at sample ${i}`);
  }
  assert(hasAudio(foley.value.samples.slice(.3*rate*2,.46*rate*2)));
  assert.equal(mix.report.profile.starts,2);
  assert.equal(mix.report.profile.streamGaps,0);
  assert.equal(mix.report.scoring.gain,1);
  assert.deepEqual(mix.report.trace.filter(row=>row.kind==='score-space')
    .map(({cue,startFrame,endFrame})=>[cue,startFrame,endFrame]),[['latch',2000,4480],['hush',3920,5600]]);
});

test('scored accents wait for actual openings, honor cooldowns, and expire on the audio clock',async()=>{
  const assets={silent:cue([])};
  const arranged={entry:'bank',segments:{bank:{source:'silent',end:1.5},tower:{source:'silent',end:1.5}},
    scoring:{openings:{bank:{breath:[{beat:1},{beat:2}]},tower:{breath:[.25,.75]}},
      cues:{spark:{accent:{resource:'bell',opening:'breath',cooldown:.4,expiresAfter:.45}},
        tap:{accent:{resource:'bell'}}}}};
  const settings={...options,streams:{bell:{frames:420,sampleRate:rate,channels:1}},
    readPage:async(name,first,count)=>Float32Array.from({length:count},(_,i)=>.4*Math.sin((first+i)*.1))};
  const events=[event(trigger('spark',.19)),event(trigger('spark',.32)),event(trigger('spark',.51)),
    event(trigger('spark',.58)),event(transition('bank','tower',.78)),event(trigger('tap',1.1)),
    event(trigger('spark',.7),1.25)];
  const route={end:1.4,events};
  const [small,wide]=await Promise.all([
    live.replay(assets,arranged,{...route,blockFrames:117},settings),
    live.replay(assets,arranged,{...route,blockFrames:407},settings)
  ]);
  assert.deepEqual(small.value.samples,wide.value.samples);
  assert.equal(small.report.profile.streamGaps,0);
  assert.equal(small.report.profile.starts,3);
  assert(!hasAudio(small.value.samples.slice(0,.5*rate*2)));
  assert.deepEqual(small.report.scoring.outcomes,{queued:4,played:3,cooldown:1,expired:2});
  assert.deepEqual(small.report.scoring.pending,[]);
  const decisions=small.report.trace.filter(row=>row.kind==='score-accent' && row.status!=='queued');
  assert.deepEqual(decisions.map(({cue,frame,status,section})=>[cue,frame,status,section]),[
    ['spark',4000,'played','bank'],['spark',4000,'cooldown',undefined],['spark',7681,'expired',undefined],
    ['spark',8240,'played','tower'],['tap',8800,'played','tower'],['spark',10000,'expired',undefined]
  ]);
  assert.equal(decisions[3].expiresFrame,8240);
  assert.throws(()=>live.open(assets,{...arranged,scoring:{...arranged.scoring,cues:{
    spark:{accent:{resource:'bell',opening:'missing'}}
  }}},settings),/known opening/);
});
