/* Rehearse a late picture recut and score edit through one native session. */
const assert=require('node:assert/strict'), fs=require('node:fs'), os=require('node:os'), path=require('node:path');
const {execFileSync}=require('node:child_process'), {performance}=require('node:perf_hooks');
const ink=require('../..'), {KIT}=ink.load(), M=KIT.procedural.mediaGraph;
const WAV=require('../../cli/wav.js');

const poly=({voices,...section})=>({...section,voices:Array.from({length:3},(_,voice)=>
  ({id:'voice-'+voice,notes:voices[0].notes.filter((_,index)=>index%3===voice)}))});

const rate=24000, fps=24, bars=152, tempo=120, from=146, to=150, simulationRate=10;
const sample=seconds=>Math.round(seconds*rate);
const time=bar=>({bar});
const preview={from:time(from),to:time(to),leadInSamples:sample(2)};
const take=(asset,at=0)=>({asset,sync:{sample:sample(at)}});
const note=(id,beat,midi,duration,velocity)=>({id,beat,midi,duration,velocity});
const clip=(id,beat,length,notes,voice='line')=>({id,beat,length,voices:[{id:voice,notes}]});
const lead=clip('gate-call',146*4,16,[
  note('lift',.66,68,.67,.56),note('reach',1.52,71,.53,.61),note('drop',3.04,66,1.38,.57),
  note('reply',7.48,73,.7,.64),note('bend',8.59,71,1.06,.68),note('last',11.23,68,.93,.55)
]);
const noteEdit=velocity=>({op:'note',take:'reference',lane:'reed',clip:lead.id,voice:'line',note:'bend',set:{velocity}});
const keep={op:'keep-release',lane:'reed',take:'long-breath',clip:lead.id,voice:'line',note:'last',fadeSamples:240};
const defaultPicture={fps,shots:[{id:'approach',frames:6960},{id:'ladder',frames:56},
  {id:'wheel',frames:88},{id:'waterline',frames:192}]};
const revisedPicture={fps,shots:[defaultPicture.shots[0],{id:'ladder',inFrame:4,frames:44},
  {id:'wheel',inFrame:4,frames:100},defaultPicture.shots[3]]};

function sourceSession() {
  const events=[];
  const world=KIT.world.runtime.create({format:KIT.world.format,version:1,id:'spillway',dt:1/simulationRate,
    history:{enabled:false},commands:[
      {tick:2942,id:'catch',action:'world/event',args:{kind:'latch-catches',body:'spillway-gate'}},
      {tick:2954,id:'open',action:'world/event',args:{kind:'gate-releases',body:'spillway-gate'}}
    ]});
  world.advance(2960,{onTick:()=>events.push(...world.committedEvents())});
  const initial=events.find(event=>event.kind==='latch-catches').id;
  const revised=events.find(event=>event.kind==='gate-releases').id;
  const chapters=['intake','screen','settling','pump','channel','standpipe','walk','spillway'];
  const roots=[37,33,40,35,37,30,33,37];
  const pads=chapters.slice(0,-1).map((id,index)=>clip(id,index*80,80,
    Array.from({length:24},(_,i)=>note('pulse-'+i,(i%3)*1.23+Math.floor(i/3)*10,roots[index]+[24,31,36][i%3],
      [3.44,2.18,1.52][i%3],.34+(i%5)*.04))));
  const stabs=clip('last-turn',144*4,32,[
    note('pre-one',4.46,61,2.54,.55),note('pre-two',5.82,64,1.92,.43),note('pre-three',7.1,71,2.37,.41),
    note('wheel-one',10.31,57,2.84,.53),note('wheel-two',12.67,64,2.63,.47),note('silence',15.62,62,1.2,.38),
    note('release-one',17.29,64,2.77,.46),note('release-two',19.49,73,1.12,.52),note('release-three',21.09,71,1.77,.31),
    note('surface',25.67,57,3.94,.36)
  ]);
  const bass=clip('floor',144*4,32,[note('wait',4,37,3.1,.61),note('enough',9.92,33,2.1,.69),
    note('drift',13.38,35,2.9,.64),note('let-go',19.62,37,3.46,.63),note('last-air',26,37,2.23,.35)]);
  const reed={type:'subtractive',saw:.14,pulse:.36,sub:.11,pulseWidth:.39,pwm:{rate:.67,depth:.11},
    filter:{cutoff:740,resonance:.77,keyTrack:.55,envAmount:22},
    env:{attack:.08,decay:.56,sustain:.57,release:.25}};
  return {revised,worldLog:world.recording(),session:{format:'ink-studio/music-edit-session',version:1,id:'Spillway',sampleRate:rate,
    production:{seed:143,arrangement:{score:{tempoMap:{tempo},key:{root:'C#3',mode:'minor'},harmonies:{home:{root:'C#3',quality:'minor'}}},
      parts:{keys:{role:'pad'},bass:{role:'bass'},reed:{role:'lead'}},motifs:{},
      sections:chapters.map((id,index)=>({id,bars:index===7 ? 12 : 20,harmony:'home'}))},
      patches:{keys:{type:'keys',tine:.74,bite:.23,dust:.035,wear:.31,
        env:{attack:.019,decay:.77,sustain:.26,release:.69}},reed,
        bass:{type:'subtractive',saw:.16,pulse:.07,sub:.8,filter:{cutoff:315},
          env:{attack:.056,decay:.65,sustain:.73,release:.3}}},
      tracks:{keys:{patch:'keys',gain:-17,pan:-.22,send:.52,clips:[...pads,stabs].map(poly)},
        reed:{patch:'reed',gain:-15,pan:.18,send:.61,clips:[
          clip('distant-call',80*4,32,[note('first',17.2,66,1.21,.47),note('second',19.63,68,3.01,.49)]),lead]},
        bass:{patch:'bass',gain:-18,send:.05,clips:[bass]}},
      room:{gain:-9,size:1.22,decay:1.18,damping:.66}},
    takes:{'long-breath':{patches:{reed:{...reed,env:{...reed.env,release:1.13}}}}},
    audio:{
      speech:{take:'production',takes:{production:{clips:[{id:'warning',track:'dialogue',spot:{shot:'wheel',sourceFrame:29},
        take:'call',takes:{call:take('line'),radio:take('line-radio')},gain:.74,
        fades:{inSamples:240,outSamples:720,curve:'equal-power'}}]}}},
      foley:{take:'sync',takes:{sync:{clips:[{id:'gate-latch',spot:{event:'latch'},take:'hard',
        takes:{hard:take('latch-hard',.018),soft:take('latch-soft',.044)},gain:.73,
        fades:{inSamples:60,outSamples:480}}]}}},
      water:{take:'bay',takes:{bay:{clips:[{id:'under-gate',spot:{shot:'approach',sourceFrame:fps*288},
        take:'original',takes:{original:take('water')},gain:.75,
        fades:{inSamples:sample(1.8),outSamples:sample(1.6),curve:'equal-power'}}]}}}
    },
    editorial:{picture:defaultPicture,world:{simulationRate,events,aliases:{latch:initial}}},
    mixer:{output:'master',tail:'cut',peakPolicy:'error',strips:{master:{},foley:{sends:{space:{tap:'pre',level:.31}}},
      speech:{pan:-.07},keys:{sends:{space:{level:.17}}},water:{inserts:[{processor:'duck',sidechain:{strip:'foley',tap:'input'}}]},
      space:{inserts:['delay'],fader:.63}},processors:{
      delay:{type:'tempo-delay',beats:.625,feedback:.37,wet:1},
      duck:{type:'compressor',thresholdDb:-35,ratio:8,attack:.003,release:.52}},taps:{water:{strip:'water'},foley:{strip:'foley'}}},
    automation:{'water-ride':{target:{strip:'water',parameter:'fader'},unit:'seconds',curve:'linear',
      points:[{id:'base',at:0,value:.98},{id:'before',at:292,value:.98},{id:'open',at:296.85,value:.78}]}}
  }};
}

function recordings(folder) {
  let state=73;
  const noise=()=>((state=(Math.imul(state,1664525)+1013904223)>>>0)/2147483648)-1;
  const sin=(hz,t)=>Math.sin(2*Math.PI*hz*t), env=(t,length)=>t<0 ? 0 : (1-Math.exp(-t*680))*Math.exp(-t*length);
  const make=(seconds,fn,channels=1)=>({sampleRate:rate,channels,samples:Float32Array.from(
    {length:sample(seconds)*channels},(_,i)=>fn(Math.floor(i/channels)/rate,i%channels))});
  const latch=(delay,soft)=>make(1.3,(t)=>{
    const x=t-delay, scrape=noise()*.16*env(x+.018,78);
    const strike=(.37*sin(683,x)+.24*sin(1237,x)+.16*sin(2011,x))*env(x,soft ? 16 : 8.7);
    return (soft ? .71 : 1)*(scrape+strike+.15*sin(357,x)*env(x-.092,13)+.12*noise()*env(x-.11,24));
  });
  let smooth=0,slow=0;
  const water=make(16,(t,ch)=>{
    smooth+=.024*(noise()-smooth);
    slow+=.0014*(noise()-slow);
    return .28*smooth*(.69+.31*sin(.81,t+ch*.3))+.55*slow+.055*sin(48.2,t+ch*.007)+
      .032*sin(87.6,t-ch*.005)+.018*sin(134.3,t);
  },2);
  const line=WAV.read(path.join(__dirname,'../production-benchmark/recordings/water-line.wav'));
  let center=0, dc=0;
  const lineRadio={...line,samples:Float32Array.from(line.samples,x=>{
    dc+=.038*(x-dc); center+=.31*(x-dc-center);
    return .8*Math.tanh(center*2.4);
  })};
  const assets={line,'line-radio':lineRadio,'latch-hard':latch(.018,false),'latch-soft':latch(.044,true),water};
  const paths=Object.fromEntries(Object.entries(assets).map(([id,pcm])=>{
    const ref='assets/'+id+'.wav';
    fs.writeFileSync(path.join(folder,ref),WAV.encode(pcm,{encoding:'pcm24'}));
    return [id,ref];
  }));
  return {paths,assets:Object.fromEntries(Object.entries(paths).map(([id,ref])=>[id,WAV.read(path.join(folder,ref))]))};
}

function publish(folder) {
  fs.mkdirSync(path.join(folder,'assets'),{recursive:true});
  const {session,revised,worldLog}=sourceSession(), {paths,assets}=recordings(folder);
  const editor=M.musicSession.create(assets);
  const changes=[
    {op:'picture',picture:revisedPicture},
    {op:'world-spot',alias:'latch',event:revised},
    {op:'editorial',lane:'speech',take:'production',edits:[{op:'take',clip:'warning',take:'radio'}]},
    {op:'editorial',lane:'foley',take:'sync',edits:[{op:'comp',clip:'gate-latch',
      ranges:[{take:'soft',fromOffset:sample(.16),toOffset:sample(.8),fadeSamples:900,curve:'equal-power'}]}]},
    {op:'automation',lane:'water-ride',point:'open',at:296.57,value:1.27},
    noteEdit(.77),keep
  ];
  let edited=editor.edit(session,changes), window;
  const first=editor.render(session,preview);
  editor.render(edited,preview);
  const trials=[];
  for (let index=0;index<24;index++) {
    const start=performance.now();
    edited=editor.edit(edited,[noteEdit(.68+index*.004)]);
    const revisedAt=performance.now();
    window=editor.render(edited,preview);
    const end=performance.now();
    trials.push({editMs:revisedAt-start,renderMs:end-revisedAt,totalMs:end-start,...window.report.blocks});
  }
  const full=M.musicSession.create(assets).render(edited), begin=2*window.report.warmupSamples;
  function equality(window,print) {
    const samples=window.samples;
    let maxError=0;
    for (let i=0;i<samples.length;i++) maxError=Math.max(maxError,Math.abs(samples[i]-print.samples[begin+i]));
    return maxError;
  }
  const parity={mix:equality(window.value,full.value),...Object.fromEntries(Object.keys(window.taps).map(tap=>
    [tap,equality(window.taps[tap],full.taps[tap])]))};
  assert(Object.values(parity).every(value=>value===0),'Warm preview differs from the uninterrupted print');
  const predict={...preview,passes:2,switches:[{pass:1,at:{bar:148},lane:'reed',take:'long-breath',fadeSamples:288}]};
  const muted=editor.render(edited,{...preview,monitor:{mode:'mute',lane:'foley'}});
  const switchLive=editor.render(edited,predict);
  assert(muted.taps.foley.samples.every(sample=>sample===0));
  assert.notDeepEqual(muted.taps.water.samples,window.taps.water.samples);
  const rank=percentile=>trials.map(row=>row.totalMs).sort((a,b)=>a-b)[Math.ceil(percentile*trials.length)-1];
  let machine;
  try {machine=execFileSync('sysctl',['-n','hw.model'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();}
  catch {machine=os.hostname();}
  const benchmark={machine,cpu:os.cpus()[0].model,os:os.version(),arch:os.arch(),runtime:process.version,
    memoryGiB:Math.round(os.totalmem()/2**30),durationSeconds:full.report.frames/rate,sampleRate:rate,
    fourBarSeconds:8,leadInSeconds:2,previewStartsAt:begin/2/rate,
    warmup:'One reference preview and one revised preview. Each trial edits the same late note to a unique velocity.',
    medianMs:rank(.5),p95Ms:rank(.95),maximumMs:rank(1),targetMs:2000,passed:rank(.95)<2000,
    precision:'Native stereo PCM before WAV encoding. Cold, uninterrupted print with a fresh editor.',
    maxAbsSampleError:parity,trials};
  const json=(name,value)=>fs.writeFileSync(path.join(folder,name+'.json'),JSON.stringify(value,null,2)+'\n');
  const listen=(name,pcm)=>fs.writeFileSync(path.join(folder,name+'.wav'),WAV.encode(pcm,{encoding:'pcm24'}));
  for (const [name,result] of Object.entries({before:first,after:window,muted,'two-passes':switchLive})) listen(name,result.value);
  json('benchmark',benchmark);
  json('timeline',window.report.timeline);
  json('picture-before',first.report.timeline);
  json('world-run',worldLog);
  json('original-session',{session,assets:paths});
  json('revised-session',{session:edited,assets:paths});
  json('changes',changes);
  json('live',preview);
  const views=Object.fromEntries(Object.entries({before:first,after:window,muted}).map(([name,result])=>{
    const {lanes,editorial}=result.report.timeline;
    const offset=begin/2/rate;
    let end=0;
    const shots=editorial.picture.shots.flatMap(shot=>{
      const start=end;
      end+=shot.frames/fps;
      return start<offset+10 && end>offset ? [[shot.id,Math.max(0,start-offset),Math.min(10,end-offset)]] : [];
    });
    const cue=(lane,clip,label,row)=>{
      const hit=lanes[lane].flatMap(region=>region.clips).find(value=>value.id===clip);
      return hit ? [[label,hit.sessionSyncSample/rate-offset,row]] : [];
    };
    const comp=lanes.reed.find(row=>row.take==='long-breath');
    const marks=[...cue('speech','warning','Voice',0),...cue('foley','gate-latch','Latch',1),
      ...(comp ? [['Reed release',comp.from/rate-offset,2]] : [])];
    const description={before:'Original shot lengths, voice take and latch event.',
      after:'Recut picture, later latch, revised voice and a longer reed release.',
      muted:'Same revised cut with Foley muted before the compressor key and delay send.'}[name];
    return [name,{shots,marks,description}];
  }));
  const html=fs.readFileSync(path.join(__dirname,'long-form-session.html'),'utf8');
  fs.writeFileSync(path.join(folder,'index.html'),html.replace('__DEMO_DATA__',JSON.stringify(views)));
  process.stdout.write(JSON.stringify({folder,p95Ms:benchmark.p95Ms,medianMs:benchmark.medianMs,
    maximumMs:benchmark.maximumMs,passed:benchmark.passed,parity,last:trials.at(-1)},null,2)+'\n');
}
publish(path.resolve(process.argv[2] ?? 'out/long-form-session'));
