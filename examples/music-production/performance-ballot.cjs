/* Run: node examples/music-production/performance-ballot.cjs output-directory [Blackwater source-session.json] */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const WAV=require('../../cli/wav.js'), {write,json}=require('../../cli/asset-files.js');
if (!process.argv[2]) throw new TypeError('Choose a listening demo directory');
const dir=path.resolve(process.argv[2]), read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const CLI=path.resolve(__dirname,'../../cli/ink-studio.js');
const run=(script,...args)=>JSON.parse(execFileSync(process.execPath,[script,...args],{encoding:'utf8'}));
const sourceDir=path.join(dir,'original');
if (!process.argv[3]) run(path.join(__dirname,'performance-accompaniment.cjs'),sourceDir);
const source=process.argv[3] ?? path.join(sourceDir,'source-session.json'), {session}=read(source);
const clips=session.takes.kept.tracks.reed.phrases;
const range=(from,to)=>({from:{beat:from},to:{beat:to}});
const readbacks=session.comp.filter(row=>row.lane==='reed' && row.take==='kept');
const lim=value=>Math.min(1,Math.max(0,value));
const note=(name,fields)=>({clip:'call',voice:'line',note:name,...fields});

function alternative(id,change,effort,tilt,notes,returnNotes) {
  const edits=clips.map(({from,to,mapping,drivers,id},index)=>({
    op:'record-phrase',lane:'reed',take:'new-delivery',phrase:{id,from,to,mapping,
      drivers:Object.fromEntries(Object.entries(drivers).map(([key,points])=>[key,points.map(point=>{
        const u=(point.beat-from)/(to-from);
        const value=key==='effort' ? point.value*effort(u,index) :
          key==='tilt' ? point.value+tilt*Math.sin(u*Math.PI*2) : point.value*(1+.12*Math.sin(u*10));
        return {...point,value:lim(value)};
      })])),notes:index ? returnNotes : notes}
  }));
  edits.push(...readbacks.map(({take,...pick})=>({op:'comp',...pick,take:'new-delivery'})));
  return {id,change,edits};
}

function resonant({ratio,index,sub,attack,release,breath=0.05,gain=.8}) {
  return {type:'graph',output:'out',tail:release,nodes:{
    exciter:{type:'oscillator',wave:'sine',ratio},
    voice:{type:'oscillator',wave:'sine',phaseInput:'exciter',index:{base:index,by:{pressure:.17}}},
    lower:{type:'oscillator',wave:'sine',ratio:sub},
    low:{type:'gain',input:'lower',amount:{base:.12,by:{pressure:.14}}},
    air:{type:'noise'}, pore:{type:'filter',input:'air',mode:'bandpass',
      cutoff:{base:920,by:{breath:1800}},resonance:1.85},
    airLevel:{type:'gain',input:'pore',amount:{base:breath,by:{breath:.12}}},
    blend:{type:'mix',inputs:['voice','low','airLevel']},
    envelope:{type:'envelope',env:{attack,decay:.36,sustain:.59,release}},
    out:{type:'gain',input:'blend',amount:{base:0,from:{envelope:gain}}}
  },controls:{pressure:.57,breath:.31,damping:.18},
  articulations:{steady:{nodes:{voice:{ratio:1}}}}};
}
const sources=[
  {id:'bowed-glass',family:'glass',change:'Try a tapered, almost bowed glass tone under the kept phrasing.',
    patch:resonant({ratio:2.014,index:.052,sub:.5,attack:.093,release:.44})},
  {id:'wire-reed',family:'string',change:'Try a more immediate struck wire with a low sympathetic note.',
    patch:resonant({ratio:1.997,index:.17,sub:.5,attack:.013,release:.26,gain:.71})},
  {id:'hollow-ceramic',family:'vessel',change:'Try a low, inharmonic ceramic resonance with air on the attack.',
    patch:resonant({ratio:3.524,index:.09,sub:.5,attack:.036,release:.4,breath:.13})},
  {id:'slow-porcelain',family:'vessel',change:'Let a quieter ceramic resonance bloom into the gap.',
    patch:resonant({ratio:2.676,index:.088,sub:1,attack:.15,release:.52,breath:.07,gain:.69})},
  {id:'unvoiced-probe',family:'wire',change:'Screen a wire treatment whose lead exciter never opens.',
    patch:resonant({ratio:1.997,index:.17,sub:.5,attack:.013,release:.26,gain:0})}
];
const performances=[
  alternative('suspended','Let the second attack sag, then keep the long note afloat.',
    (u,i)=>i ? .79+.36*Math.sin(u*2.9) : .58+.58*u,.13,
    [note('lean',{delay:.074,gate:.78,accent:.92}),note('hold',{delay:.038,gate:1.45,accent:.87})],
    [note('return-lean',{delay:.076,gate:.77,accent:.87}),note('return-lift',{delay:.021,gate:.92,accent:1.07})]),
  alternative('pull-forward','Make the little call urgent and cut the held note earlier.',
    u=>.93+.2*Math.cos(5*u),-.12,
    [note('start',{delay:-.022,gate:.78}),note('lean',{delay:-.03,gate:.86,accent:1.28}),
      note('hold',{delay:-.02,gate:1.06,accent:1.13})],
    [note('return-start',{delay:-.025,gate:.77,accent:1.12}),note('return-lean',{delay:-.042,gate:.8,accent:1.26})]),
  alternative('soft-catch','Let the first note breathe, then make the second one catch sharply.',
    (u,i)=>i ? .34+.8*Math.min(1,u*4) : .36+.74*Math.sin(Math.PI*u),.27,
    [note('start',{delay:.044,gate:.64,accent:.77}),note('lean',{delay:.032,gate:.91,accent:1.35}),
      note('hold',{delay:.028,gate:1.26,accent:.82})],
    [note('return-start',{delay:.047,gate:.64,accent:.71}),note('return-lean',{delay:.036,gate:.86,accent:1.26})]),
  alternative('loose-thread','Hold the first attack back, then let the high note hang over the release.',
    u=>.67+.33*Math.sin(u*4.3),.19,
    [note('start',{delay:.029,gate:.77}),note('lift',{delay:.06,gate:.94}),
      note('hold',{delay:-.012,gate:1.44,accent:1.05})],
    [note('return-start',{delay:.025,gate:.75}),note('return-lift',{delay:.037,gate:1.03,accent:1.12})])
];
const arrangements=[
  {id:'held-f',family:'pedal',return:'withheld',settings:{returnMidi:29,withhold:{beat:17.85}},
    change:'Answer the new held note, then reveal a low F pedal under the quote.'},
  {id:'held-b-flat',family:'pedal',return:'withheld',settings:{returnMidi:34,withhold:{beat:18}},
    change:'Answer the new held note, then reveal a higher B-flat pedal under the quote.'},
  {id:'bare',family:'space',return:'exposed',settings:{metalMidi:55},
    change:'Answer the new release and pull the support out of the returning call.'},
  {id:'struck',family:'handoff',return:'handoff',settings:{metalMidi:60},
    change:'Answer the new phrasing, then let three tuned strikes carry the call.'},
  {id:'low-struck',family:'handoff',return:'handoff',settings:{metalMidi:53},
    change:'Let the newly timed handoff ring in a lower register.'},
  {id:'fifth-answer',family:'space',return:'exposed',settings:{bassMidi:31,metalMidi:57},
    change:'Have the bass answer a fifth away, then expose the reed return.'}
];
const brief={id:'blackwater-listening',seed:732,lead:'reed',context:range(4,31),call:range(4,8.95),
  recall:range(19.8,24.25),scout:range(19.5,24.5),gapSeconds:2.15,advance:3,sources,performances,arrangements,
  accompaniment:{bass:'bass',metal:'click',response:range(4,17.35),hook:range(20,24)}};
const briefFile=path.join(dir,'brief.json');
json(briefFile,brief);
const result=run(CLI,'music','session','performance-ballot',source,briefFile,'--out',path.join(dir,'review'));
const search=read(result.report).search;
assert(search.source.batch.candidates.some(row=>row.axes.sound.id==='unvoiced-probe' &&
  row.status==='rejected' && row.reason==='Hook is silent in scout'));
const pub=path.dirname(result.player), {questions,sampleRate,labels}=read(result.manifest);
const reels={};
for (const question of questions) {
  const gap=Math.round(sampleRate*.65), stride=question.frames+gap;
  const samples=new Float64Array(2*(stride*labels.length-gap));
  const order=labels.map((label,i)=>{
    const clip=WAV.read(path.join(pub,question.files[label]));
    assert.equal(clip.samples.length,question.frames*2);
    samples.set(clip.samples,2*i*stride);
    return {label,seconds:i*stride/sampleRate};
  });
  const file=path.join(dir,'blind-'+question.id+'.wav');
  write(file,WAV.encode({sampleRate,channels:2,samples},{encoding:'pcm24'}));
  reels[question.id]={file,order};
}
json(path.join(dir,'listening-reels.json'),reels);
console.log(JSON.stringify({...result,reels},null,2));
