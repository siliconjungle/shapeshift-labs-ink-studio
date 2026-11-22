/* Run: node examples/music-production/performance-accompaniment.cjs output-directory [kept-session.json] */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const {KIT}=require('../..').load(), A=KIT.procedural.mediaGraph;
const WAV=require('../../cli/wav.js'), {write,json}=require('../../cli/asset-files.js');
if (!process.argv[2]) throw new TypeError('Choose an accompaniment demo directory');
const dir=path.resolve(process.argv[2]);
const file=(name,value)=>{const target=path.join(dir,name);json(target,value);return target;};
const read=name=>JSON.parse(fs.readFileSync(name,'utf8'));
const run=(script,...args)=>JSON.parse(execFileSync(process.execPath,[script,...args],{encoding:'utf8'}));
const cli=(...args)=>run(path.resolve(__dirname,'../../cli/ink-studio.js'),'music','session',...args);
const kept=process.argv[3] ?? run(path.join(__dirname,'phrase-performance.cjs'),path.join(dir,'source')).session;
const {session}=read(kept);
const {tracks,arrangement}=session.production;
arrangement.sections.push({id:'return',bars:3,harmony:'home'});
for (const track of Object.values(tracks)) track.clips[0].length=32;
const note=(id,beat,duration,midi,velocity,play)=>({id,beat,duration,midi,velocity,...(play && {play})});
const rows=lane=>tracks[lane].clips[0].voices[0].notes;
const shift=16, returnStart=4+shift, returnEnd=8+shift;
const extension=rows('reed').slice(0,3).map(row=>({...row,id:'return-'+row.id,beat:row.beat+shift}));
extension[2].duration=1.01;
rows('reed').push(...extension,note('coda',26.06,1.13,58,.58,{articulation:'steady'}));
tracks.bass.clips[0].voices[0].notes=rows('bass').filter(row=>row.id!=='pickup');
rows('bass').push(note('inhale',18.38,1.48,36,.65),note('settled',24.42,2.38,34,.66),
  note('ebb',28.24,2.39,36,.46));
rows('glass').push(note('glint',19.26,.45,70,.45),note('answer',24.29,1.38,63,.58),
  note('floor',27,2.61,55,.57),note('air',30.24,.91,62,.38));
rows('click').push(note('inhale',18.88,.1,60,.44),note('wake',24.17,.10,60,.65),note('recede',28.15,.1,57,.41));
Object.assign(session.production.patches.click,{decay:.26,color:.65,click:.32});
tracks.click.gain=-13.7;
tracks.click.send=.21;
const {drivers,mapping}=session.takes.lean.tracks.reed.phrases[0];
const returnDrivers=Object.fromEntries(Object.entries(drivers).map(([id,points])=>{
  const end=returnEnd-shift, from=points.findLast(row=>row.beat<=end), to=points.find(row=>row.beat>end);
  const tail=from.value+(to.value-from.value)*(end-from.beat)/(to.beat-from.beat);
  return [id,[...points.filter(row=>row.beat<end).map(row=>({...row,beat:row.beat+shift})),
    {id:'return-decay',beat:returnEnd,value:tail}]];
}));
const E=A.musicSession.create(), source=E.edit(session,[
  {op:'record-phrase',lane:'reed',take:'kept',phrase:{
    id:'return',from:returnStart,to:returnEnd,drivers:returnDrivers,mapping,
    notes:[{clip:'call',voice:'line',note:'return-lean',delay:.022,gate:1.04,accent:1.16}]}},
  {op:'comp',lane:'reed',take:'kept',from:{beat:returnStart},to:{beat:returnEnd}}
]);
assert.deepEqual(source.takes.kept.tracks.reed.phrases[0],session.takes.kept.tracks.reed.phrases[0]);
const range=(from,to)=>({from:{beat:from},to:{beat:to}});
const brief={lead:'reed',bass:'bass',metal:'click',response:range(4,17.35),hook:range(20,24),context:range(4,31),
  withhold:{beat:18},returnMidi:29,metalMidi:60};
const result=cli('arrange-performance',file('source-session.json',{session:source}),file('brief.json',brief),
  '--out',path.join(dir,'returns'));
const evidence=read(result.report);
assert.equal(evidence.replies.bass.hold.take,'kept');
assert.equal(evidence.replies.bass.hold.note,'hold');
assert.equal(evidence.replies.metal.call.take,'kept');
assert.deepEqual(evidence.attacks.hook.map(row=>row.take),['kept','kept','kept']);
const files=['exposed','withheld','handoff'].map(id=>({id,value:WAV.read(result.audio[id])}));
const reel=A.gestureBank.audition(files,{sampleRate:source.sampleRate,levelMatch:'shared',
  gapSeconds:.52,peakDb:-1,targetRmsDb:-18,maxGainDb:0});
const destination=path.join(dir,'blackwater-three-returns.wav');
write(destination,WAV.encode(reel.value,{encoding:'pcm24'}));
file('listening-order.json',reel.report);
console.log(JSON.stringify({...result,reel:destination},null,2));
