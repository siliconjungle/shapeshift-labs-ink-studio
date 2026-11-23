const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {execFileSync,spawn}=require('node:child_process'),{once}=require('node:events');
const dirOfRepo=path.join(__dirname,'../..');
const beatId='ink:beat:audition-workshop/main/16.0', from='.35', to='2.05';

function fixture(out,repo=dirOfRepo,rate=48000){
  const ink=require(repo), W=ink.load().KIT.world;
  const file=name=>path.join(out,name), cli=path.join(repo,'cli/ink-studio.js');
  fs.mkdirSync(out,{recursive:true});
  const save=(name,data)=>fs.writeFileSync(file(name),JSON.stringify(data,null,2)+'\n');
  const run=(...args)=>execFileSync(process.execPath,[cli,...args],{cwd:out,stdio:['ignore','pipe','pipe']});
  const sine=(hz,t)=>Math.sin(2*Math.PI*hz*t);
  function sound(name,seconds,make){
    const samples=Float32Array.from({length:Math.round(seconds*rate)},(_,i)=>make(i/rate));
    fs.writeFileSync(file(name+'.wav'),ink.encodeWav({samples,channels:1,sampleRate:rate}));
  }
  sound('wood',.27,t=>Math.min(1,t/.001)*Math.exp(-t/.047)*
    (.47*sine(144,t)+.21*sine(338,t)+.18*sine(1250,t)*Math.exp(-t/.012)));
  sound('metal',.39,t=>Math.min(1,t/.001)*Math.exp(-t/.08)*
    (.34*sine(583,t)+.18*sine(1493,t)+.18*sine(2219,t)+.13*sine(3359,t)));
  sound('bed',1,t=>.024*sine(86,t)+(.023+.012*sine(2,t))*sine(131,t)+.009*sine(204,t));
  sound('relay',.14,t=>Math.min(1,t/.003)*Math.exp(-t/.035)*.29*sine(390,t));
  const hit=(tick,time)=>({tick,action:'world/event',args:W.timedEvents.at(time,{
    kind:'tool-contact',action:'drop',prop:'wrench',surface:'boards',speed:2.5,at:[1.6,1,-2]
  })});
  save('workshop.world.json',{format:'ink-studio/world',version:1,id:'audition-workshop',dt:.05,commands:[
    hit(16,.775),{tick:24,action:'world/event',args:{kind:'audio-cue',cue:'relay',at:[-1.5,1,-2]}},
    hit(33,1.625)
  ]});
  run('sim','run','workshop.world.json','--ticks','44','--record','workshop.run.json');
  save('workshop.audio.json',{format:'ink-studio/scene-audio',version:1,sampleRate:rate,
    assets:{wood:'wood.wav',metal:'metal.wav',bed:'bed.wav',relay:'relay.wav'},
    listener:[0,1,0],tracks:[{asset:'bed',loop:true,bus:'ambience'}],
    spatial:{distance:{reference:2,rolloff:.5},soundSeed:21,
      cues:{wood:{asset:'wood',bus:'foley',gain:.9},metal:{asset:'metal',bus:'effects',gain:.9},
        relay:{asset:'relay',bus:'effects'}},
      soundFamilies:{boards:{takes:{knock:'wood'}},metal:{takes:{clang:'metal'}},
        ineligible:{takes:{light:{cue:'metal',strength:[0,.1]}}}},
      bindings:{drop:{on:{kind:'tool-contact'},select:[{id:'board',family:'boards'}],speedForFullStrength:4}}},
    post:{strips:{foley:{fader:.8},ambience:{fader:.8}}}});
  return {out,repo,ink,file,run};
}
async function open({out,repo},options=[]){
  const args=[path.join(repo,'cli/ink-studio.js'),'story','audition','workshop.run.json','workshop.audio.json',
    '--beat',beatId,'--from',from,'--to',to,...options];
  const child=spawn(process.execPath,args,{cwd:out,stdio:['ignore','pipe','pipe']});
  const done=once(child,'exit'), failure=[];
  child.stderr.on('data',chunk=>failure.push(chunk));
  const close=async()=>{if(child.exitCode===null&&child.signalCode===null){child.kill();await done;}};
  try{
    const [data]=await Promise.race([once(child.stdout,'data'),done.then(([code])=>{
      throw Error('World audition exited with '+code+' '+Buffer.concat(failure).toString());
    })]);
    const {url}=JSON.parse(data.toString()), session=await (await fetch(url+'/session')).json();
    const post=(edit,key=session.key)=>fetch(url+'/render',{method:'POST',
      headers:{'content-type':'application/json','x-ink-session':key},body:JSON.stringify(edit)});
    async function render(edit){
      const response=await post(edit), value=await response.json();
      assert.ok(response.ok,value.error);
      return value;
    }
    return {url,session,render,post,close};
  }catch(error){await close();throw error;}
}
const pcm=result=>Buffer.from(result.waves,'base64');

async function demo(out,repo){
  const prepared=fixture(out,repo), {file,ink,run}=prepared;
  run('story','audio','workshop.run.json','workshop.audio.json','--from',from,'--to',to,'--out','original');
  const audition=await open(prepared);
  try{
    const {session}=audition, original=session.original;
    assert(pcm(original).equals(fs.readFileSync(file('original/mix.wav'))));
    const passes=[
      {name:'original',value:original},
      {name:'metal',edit:{binding:'drop',family:'metal'}},
      {name:'quieter',edit:{binding:'drop',family:'metal',gainDb:-7}},
      {name:'filtered',edit:{binding:'drop',family:'metal',gainDb:-7,lowpass:720}}
    ];
    for(const pass of passes)pass.value??=await audition.render(pass.edit);
    const first=ink.decodeWav(pcm(original)), size=first.samples.length, gap=Math.round(first.sampleRate*.09)*2;
    const joined=new Float32Array((size+gap)*passes.length-gap);
    const report=passes.map(({name,edit,value},i)=>{
      const bytes=pcm(value), wav=ink.decodeWav(bytes);
      assert.equal(wav.samples.length,size);
      if(i)fs.writeFileSync(file(name+'.wav'),bytes);
      joined.set(wav.samples,i*(size+gap));
      return {name,edit,storyFromSample:value.firstSample,storyEndSample:value.endSample,
        listenAt:i*(size+gap)/2/first.sampleRate,voices:value.voices};
    });
    assert.equal(report[1].voices[0].bus,'foley');
    const later=Math.round((1.5-Number(from))*first.sampleRate)*2;
    for(const pass of passes.slice(1)){
      const samples=ink.decodeWav(pcm(pass.value)).samples;
      assert.deepEqual(samples.subarray(later),first.samples.subarray(later));
      assert.notDeepEqual(samples.subarray(0,later),first.samples.subarray(0,later));
    }
    fs.writeFileSync(file('world-cue-audition.wav'),ink.encodeWav({samples:joined,channels:2,sampleRate:first.sampleRate}));
    fs.writeFileSync(file('demo-summary.json'),JSON.stringify({beatId,passes:report},null,2)+'\n');
    fs.writeFileSync(file('README.txt'),`Ink Studio world cue audition

The reel plays the same scene window four times. The first wrench impact
uses wood, then metal, then metal at -7 dB, then a 720 Hz low-pass.
The ambience, relay, second impact, and Foley routing stay in the mix.

Start the interactive loop:

  ink-studio story audition workshop.run.json workshop.audio.json --beat ${beatId} --from ${from} --to ${to}

Open the URL printed by Ink. Press Play loop and change the family, gain, or
filters. The finished render enters on a loop boundary. Original mix restores
the authored cue. The audition leaves the recording and soundtrack files intact.
`);
    console.log('Rendered four live audition revisions. The original matches scene audio and the later interaction is unchanged.');
  }finally{await audition.close();}
}

if(require.main===module){
  if(!process.argv[2])throw Error('Use node demo.cjs <output-directory> [ink-studio-repository]');
  demo(path.resolve(process.argv[2]),path.resolve(process.argv[3]??dirOfRepo)).catch(error=>{
    console.error(error.message);process.exitCode=1;
  });
}
module.exports={fixture,open,pcm,beatId,from,to};
