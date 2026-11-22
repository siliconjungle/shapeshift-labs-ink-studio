const test=require('node:test'), assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{execFileSync}=require('node:child_process');
const ink=require('..'), P=ink.load().KIT.procedural, rate=8000;
const format='ink-studio/music-edit-session';
const notes=(positions,midi)=>positions.map((beat,i)=>({id:'n'+i,beat,midi,duration:.35,velocity:.78}));
const lane=(id,positions,midi)=>({id,beat:0,length:8,loopBeats:4,
  voices:[{id:'line',notes:notes(positions,midi)}],timing:'played'});
const focus={range:{from:0,to:8},pair:{anchor:'kick',track:'bass',within:.1},sampleRate:rate};
const bassRows=report=>report.events.filter(row=>row.part==='bass');
const makeAsset=()=>({sampleRate:rate,channels:1,samples:Float64Array.from({length:rate*.3},(_,i)=>{
  const t=i/rate-.048;
  return t<0 ? 0 : .56*Math.sin(2*Math.PI*t*147)*Math.min(t*400,1)*Math.exp(-t*13);
})});
function fixture() {
  return {arrangement:{score:{key:{root:'E3'},tempoMap:{tempo:116,swing:.53},endFade:0,
    harmonies:{home:{root:'E3',quality:'unison'}}},parts:{bass:{role:'bass'},kick:{role:'percussion'}},
    motifs:{},sections:[{id:'a',bars:2,harmony:'home'}]},
  patches:{tape:{type:'sample',zones:[{samples:['bass-tape'],root:40}]},drum:{type:'drum',kind:'kick'}},
  tracks:{kick:{patch:'drum',gain:-9,clips:[{...lane('kick',[.5,2.5],36),mode:'layer'}]},
    bass:{patch:'tape',gain:-9,clips:[lane('bass',[.54,2.53],40)]}}};
}

test('native groove edits distinguish repeated attacks, trim without moving triggers, and shape the audible gap',()=>{
  const src=fixture(), assets={'bass-tape':makeAsset()}, editor=P.musicGrooveEditor.open(src,assets);
  const initial=editor.inspect(focus);
  assert.equal(initial.pairs.length,4);
  assert.ok(initial.pairs.every(row=>row.audibleGapMs-row.triggerGapMs>=42));
  const first=bassRows(initial)[0];
  const isolated=editor.edit({...focus,edits:[{op:'trim',track:'bass',at:first.at,keepMs:4}]});
  const a=bassRows(isolated.report.after);
  assert.equal(a[0].triggerSample,first.triggerSample);
  assert.ok(a[0].audibleSample+rate*.038<first.audibleSample);
  assert.equal(a[2].audibleSample,bassRows(initial)[2].audibleSample);
  assert.deepEqual(isolated.value.tracks.bass.clips,src.tracks.bass.clips);
  const edit=editor.edit({...focus,edits:[{op:'trim',track:'bass',keepMs:4},
    {op:'gap',metric:'audible',targetMs:[[0,10],[8,30]]}]});
  assert.equal(edit.value.tracks.bass.timingEdits.length,4);
  assert.ok(edit.report.operations[0].entries.every(row=>row.before.triggerSample===row.after.triggerSample));
  assert.ok(edit.report.operations[1].entries.every(row=>Math.abs(row.errorMs)<.4));
  assert.equal(edit.report.after.pairs[0].audibleGapMs,11.375);
  assert.deepEqual(edit.report.after.events.filter(row=>row.part==='kick'),initial.events.filter(row=>row.part==='kick'));
  assert.deepEqual(edit.value.tracks.bass.clips,src.tracks.bass.clips);
  const old=editor.audition(src,edit.report.before), next=editor.audition(edit.value,edit.report.after);
  assert.equal(old.samples.length,next.samples.length);
  assert.notDeepEqual(old.samples,next.samples);
});

test('the CLI measures and edits the active score take and exports a sample-aligned portable audition',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-groove-editor-'));
  try {
    const source=fixture(), alt=structuredClone(source.tracks.bass.clips);
    alt[0].voices[0].notes[0].beat=.566;
    const session={format,version:1,id:'pocket',sampleRate:rate,production:source,
      takes:{later:{tracks:{bass:{clips:alt}}}},
      comp:[{lane:'bass',take:'later',from:{beat:0},to:{beat:4}}],
      mixer:{output:'master',strips:{master:{},bass:{inserts:[{processor:'key',sidechain:{strip:'kick',tap:'pre'}}]}},
        processors:{key:{type:'compressor',thresholdDb:-29,ratio:3}}}};
    const file=path.join(dir,'source.json'), edit=path.join(dir,'edits.json'), request=path.join(dir,'focus.json');
    fs.writeFileSync(path.join(dir,'bass.wav'),ink.encodeWav(makeAsset()));
    fs.writeFileSync(file,JSON.stringify({session,assets:{'bass-tape':'bass.wav'}}));
    fs.writeFileSync(request,JSON.stringify(focus));
    fs.writeFileSync(edit,JSON.stringify({...focus,edits:[{op:'trim',track:'bass'},
      {op:'gap',metric:'trigger',targetMs:12}]}));
    const cli=path.join(__dirname,'../cli/ink-studio.js');
    const run=(...args)=>execFileSync(process.execPath,[cli,'music','groove',...args],{encoding:'utf8'});
    assert.match(run('inspect',file,request),/Written\s+Played\s+Trigger\s+Attack/);
    const timeline=JSON.parse(run('inspect',file,request,'--json'));
    assert.deepEqual(bassRows(timeline).map(row=>row.take),['later','later','reference','reference']);
    const out=path.join(dir,'review'), files=JSON.parse(run('audition',file,edit,'--out',out,'--json'));
    const saved=JSON.parse(fs.readFileSync(files.edited)), report=JSON.parse(fs.readFileSync(files.report));
    assert.equal(saved.assets['bass-tape'],'../bass.wav');
    assert.deepEqual(saved.session.mixer,session.mixer);
    assert.deepEqual(saved.session.comp,session.comp);
    assert.deepEqual(saved.session.takes.later.tracks.bass.clips,alt);
    assert.equal(saved.session.takes.later.tracks.bass.timingEdits.length,2);
    assert.equal(saved.session.production.tracks.bass.timingEdits.length,2);
    assert.ok(report.operations[1].entries.every(row=>Math.abs(row.errorMs)<.2));
    assert.equal(ink.readWav(files.before).samples.length,ink.readWav(files.after).samples.length);
    assert.match(fs.readFileSync(files.timing,'utf8'),/Δ Trigger\s+Δ Attack/);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
