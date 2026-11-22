const {test}=require('node:test'), assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {execFileSync}=require('node:child_process'),{KIT}=require('..').load(),WAV=require('../cli/wav.js');
const P=KIT.procedural, A=P.mediaGraph, rate=8000;
const beat=n=>({beat:n}), range=(from,to)=>({from:beat(from),to:beat(to)});
const note=(id,beat,midi,velocity=.65,duration=.36)=>({id,beat,duration,midi,velocity});
const clips=(notes,mode)=>[{id:'line',beat:0,length:12,voices:[{id:'voice',notes}],...(mode && {mode})}];
const hook=[note('quote',.52,64),note('hook-a',4.1,64),note('hook-b',4.9,67),note('hook-c',5.7,69),note('after',9.52,62)];
const bass=offset=>clips([note('b0',.75,40),note('b1',4+offset,40,.78,.58),note('b2',5.5+offset,38,.68,.62)]);
const patch=amount=>({type:'fm',index:amount,env:{attack:.009,decay:.16,sustain:.67,release:.11}});
const fixture=()=>({format:'ink-studio/music-edit-session',version:1,id:'experiment',sampleRate:rate,production:{
  arrangement:{score:{tempoMap:{tempo:120},endFade:0,key:{root:'E4'},harmonies:{home:{root:'E3',quality:'unison'}}},
    motifs:{guide:{length:1,events:[note('off',0,60,0)]}},parts:{lead:{role:'lead',material:'guide'},
      bass:{role:'bass',material:'guide'},kick:{role:'percussion',material:'guide'}},
    sections:[{id:'cue',bars:3,harmony:'home'}]},
  patches:{lead:patch(.42),kick:{type:'drum',kind:'kick'},bass:{type:'analog'}},
  tracks:{lead:{patch:'lead',clips:clips(hook),gain:-13},kick:{patch:'kick',gain:-13,
    clips:clips([note('k0',.75,36),note('k1',4,36),note('k2',5.5,36)],'layer')},
    bass:{patch:'bass',clips:bass(0),gain:-14}}},
  mixer:{output:'master',strips:{master:{}},peakPolicy:'error'},
  automation:{intro:{target:{strip:'lead',parameter:'fader'},unit:'beats',curve:'hold',
    points:[{id:'prologue',at:0,value:1},{id:'return',at:2,value:1}]}}});
const focus={id:'return-search',seed:319,focus:range(4,8),context:range(0,12),roles:{hook:'lead',kick:'kick',bass:'bass'}};
const treatments=[
  {id:'bright',family:'clean',revision:{patches:{lead:patch(2.7)}}},
  {id:'dim',family:'muffled',revision:{patches:{lead:patch(.16)}}}
];
const grooves=[
  {id:'together',revision:{tracks:{bass:{clips:bass(0)}}}},
  {id:'behind',revision:{tracks:{bass:{clips:bass(.23)}}}}
];
const intro=value=>[{op:'automation',lane:'intro',point:'prologue',value}];

test('all three axes use one session clock, preserve hook onsets and keep editable heard combinations',()=>{
  const source=fixture(), editor=A.musicSession.create(), brief={...focus,axes:{
    sound:treatments,phrase:grooves,cue:[{id:'original'},{id:'quieter',edits:intro(.45)}]},
    advance:{limit:5,disagreement:1,diversity:['phrase','cue','sound']}};
  const observed=[];
  const {value,clips}=editor.experiment(source,brief,{onScout(id,pcm){observed.push([id,pcm.samples.length]);}});
  assert.equal(value.attempted,8);
  assert.equal(value.scoutRenders,8);
  assert.equal(observed.length,8);
  assert(observed.every(([,samples])=>samples===rate*2*2));
  assert(value.shortlist.filter(row=>row.reason==='coverage').some(row=>row.axis==='phrase'));
  const candidates=value.candidates.filter(row=>row.status==='advanced');
  assert(new Set(candidates.map(row=>row.axes.phrase.family)).size===2);
  assert(value.shortlist.some(row=>row.reason==='disagreement'));
  assert(value.candidates.some(row=>row.scoutTwinOf));
  const row=value.shortlist.find(row=>row.status==='heard'), kept=editor.keepExperiment(source,value,
    {candidate:row.id,reason:'Keep this comparison as the next working take.'});
  const anchored=editor.inspect(source).lanes.lead.takes.reference.map(({beat,time,midi})=>[beat,time,midi]);
  assert.deepEqual(editor.inspect(kept.value).lanes.lead.takes.reference.map(({beat,time,midi})=>[beat,time,midi]),anchored);
  assert.deepEqual(editor.render(kept.value,brief.context).value.samples,clips[row.id].samples);
  assert.equal(kept.decision.axes.sound,candidates.find(candidate=>candidate.id===row.id).axes.sound.id);
  const changed={...source,production:{...source.production,seed:8}};
  assert.throws(()=>editor.keepExperiment(changed,value,{candidate:row.id,reason:'Changed source'}),/different session/);
});

test('invalid and locked forks are screened before rendering and duplicate documents are skipped',()=>{
  const source=fixture(), editor=A.musicSession.create(), {revision}=treatments[0];
  const brief={...focus,axes:{sound:[
    {id:'same'},
    {id:'moves-hook',revision:{tracks:{lead:{clips:clips(hook.map(row=>row.id==='hook-b' ? {...row,beat:4.83} : row))}}}},
    {id:'bad',revision:{patches:{lead:{type:'invalid'}}}},
    {id:'real',revision},
    {id:'clone',revision}
  ]}};
  const {value}=editor.experiment(source,brief);
  assert.equal(value.scoutRenders,1);
  const [same,moved,bad,real,duplicate]=value.candidates;
  assert.equal(same.duplicateOf,'reference');
  assert.match(moved.reason,/locked onsets/);
  assert.match(bad.reason,/Unknown music instrument/);
  assert.equal(real.status,'advanced');
  assert.equal(duplicate.duplicateOf,real.id);
  assert.throws(()=>editor.keepExperiment(source,value,{candidate:bad.id,reason:'Test'}),/fully auditioned/);
  const pinned={...source,pins:{lead:'all'}};
  assert.match(editor.experiment(pinned,{...focus,axes:{sound:[treatments[0]]}}).value.candidates[0].reason,/locked all/);
});

test('early cue edits with identical scouts still audition their different lead-ins',()=>{
  const editor=A.musicSession.create(), source=fixture(), brief={...focus,
    axes:{cue:[{id:'quiet',edits:intro(.4)},{id:'louder',edits:intro(1.42)}]},
    advance:{limit:2,disagreement:0,diversity:['cue']}};
  const {value,clips}=editor.experiment(source,brief);
  assert.equal(value.contextHeard,2);
  assert(value.candidates.every(row=>row.scoutTwinOf==='reference'));
  for (const [id,take] of Object.entries(clips)) if (id!=='reference') {
    assert.notDeepEqual(take.samples.slice(0,rate*4),clips.reference.samples.slice(0,rate*4));
    assert.deepEqual(take.samples.slice(rate*4),clips.reference.samples.slice(rate*4));
  }
});

test('CLI publishes scout and context WAVs and a portable chosen session',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-session-experiment-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const save=(file,value)=>fs.writeFileSync(path.join(dir,file),JSON.stringify(value));
  const read=file=>JSON.parse(fs.readFileSync(path.join(dir,file),'utf8'));
  const cli=path.resolve(__dirname,'../cli/ink-studio.js');
  const run=(...args)=>JSON.parse(execFileSync(process.execPath,[cli,'music','session',...args],{cwd:dir,encoding:'utf8'}));
  save('session.json',{session:fixture()});
  save('brief.json',{...focus,axes:{sound:treatments}});
  run('experiment','session.json','brief.json','--scouts','--out','batch');
  const report=read('batch/report.json'), pick=report.shortlist.find(row=>row.status==='heard');
  assert.equal(Object.keys(report.files.scouts).length,2);
  assert(WAV.read(path.join(dir,'batch',report.files.context[pick.id])).samples.some(Boolean));
  save('keep.json',{report:'batch/report.json',candidate:pick.id,reason:'Keep the heard take.'});
  run('keep-experiment','session.json','keep.json','--out','chosen');
  assert.equal(read('chosen/decision.json').candidate,pick.id);
  run('render','chosen/session.json','--out','printed');
  const candidate=WAV.read(path.join(dir,'batch',report.files.context[pick.id]));
  assert.deepEqual(candidate.samples,WAV.read(path.join(dir,'printed/mix.wav')).samples);
});

test('a short scout can pass before a context overload, even with default print normalization',()=>{
  const source=fixture();
  delete source.mixer.peakPolicy;
  source.audio={shot:{take:'hit',takes:{hit:{asset:'hit',at:beat(10)}}}};
  source.automation.level={target:{strip:'master',parameter:'fader'},unit:'beats',curve:'hold',
    points:[{id:'normal',at:0,value:1},{id:'after',at:9,value:1}]};
  const samples=new Float64Array(480);
  samples.fill(.73);
  const editor=A.musicSession.create({hit:{sampleRate:rate,channels:1,samples}});
  const result=editor.experiment(source,{...focus,axes:{cue:[{id:'loud-after',edits:[
    {op:'automation',lane:'level',point:'after',value:4}
  ]}]}});
  assert.equal(result.value.scoutRenders,1);
  assert.equal(result.value.candidates[0].scoutTwinOf,'reference');
  assert.equal(result.value.shortlist[0].status,'rejected');
  assert.match(result.value.shortlist[0].error,/exceeds full scale/);
  assert.deepEqual(Object.keys(result.clips),['reference']);
});
