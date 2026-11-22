const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {execFileSync}=require('node:child_process');
const {KIT}=require('..').load(), A=KIT.procedural.mediaGraph,D=A.soundDiscovery;
const WAV=require('../cli/wav.js');
const rate=8000, env={attack:.009,decay:.22,sustain:.73,release:.32};
const reed={type:'graph',tail:.38,output:'out',nodes:{
  shift:{type:'curve',points:[[0,0],[.35,0],[.43,.49],[1,.50]]},
  body:{type:'oscillator',wave:'sine',ratio:{base:1,from:{shift:1}}},
  air:{type:'envelope',env},out:{type:'gain',input:'body',amount:{base:0,from:{air:.79}}}
}};
const source={sampleRate:rate,channels:1,samples:Float32Array.from({length:3200},(_,i)=>
  .53*Math.sin(i*2*Math.PI*262/rate)*Math.min(1,i/22)*Math.exp(-i/1600))};
const spec={id:'bench',seed:120,candidates:[
  {id:'reed',family:'register-break',patch:reed,root:60},
  {id:'porcelain',family:'captured',source:{asset:'tone'},root:60},
  {id:'breath',family:'exciter',source:{gesture:{model:'breath',duration:.45,parameters:{pitchStart:218,pitchEnd:382}}}}
],settings:{sampleRate:rate,keys:[55,60],velocities:[.45,.86]}};
const sourceAssets={tone:source};

test('one performance probes native, captured and procedural sounds on a fixed clock',()=>{
  const result=D.audition(spec,sourceAssets), {bank,libraries,clips,report}=result;
  assert.equal(report.candidates.length,3);
  assert.deepEqual(report.candidates.map(row=>row.origin.kind),['patch','asset','gesture']);
  assert.deepEqual(report.candidates.map(row=>row.cells.length),[4,4,4]);
  for (const row of report.candidates) {
    assert.equal(row.anchorLufs,report.lufs);
    const listened=clips[row.id][report.anchor.id];
    assert.equal(listened.samples.length/2,report.frames);
    assert(Math.abs(KIT.music.production.loudness(listened)-report.lufs)<.001);
    assert(KIT.music.production.meters(listened,true).truePeak<=10**(-2/20)+1e-6);
    assert.deepEqual(row.cells[3].events.map(event=>event.kind),
      ['attack','attack','repeat','attack','legato','attack']);
    assert(row.cells[2].rms<row.cells[3].rms);
  }
  assert.notDeepEqual(clips.reed[report.anchor.id].samples,clips.porcelain[report.anchor.id].samples);
  const kept=D.keep(bank,libraries,{candidate:'reed',reason:'One attack passes into a higher sustained pitch.',
    projection:{pitchStep:3,minNoteMs:120},range:{low:53,high:77}});
  assert.equal(kept.patch.type,'zoned');
  assert.deepEqual(kept.patch.instruments.voice,reed);
  assert(kept.motif.motifs.contour.events.some(note=>note.midi>64));
  const slice={cell:report.anchor.id,fromSample:5150,toSample:6450};
  const resampled=D.keep(bank,libraries,{candidate:'porcelain',from:'slice',slice,resample:true,reason:'Keep the bright transient.'});
  assert.deepEqual(resampled.reference.samples,clips.porcelain[slice.cell].samples.slice(2*slice.fromSample,2*slice.toSample));
  assert.equal(resampled.patch.zones[0].root,60);
  assert.deepEqual(resampled.assets['discovery-resample'],resampled.reference);
  assert.deepEqual(resampled.report.address,slice);
  assert.throws(()=>D.keep(bank,libraries,{candidate:'porcelain',from:'slice',reason:'Try an empty window.',
    slice:{...slice,toSample:slice.fromSample}}),/sample clock/);
});

test('the CLI can reopen a saved audition and resample the exact heard PCM',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-sound-discovery-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const save=(name,value)=>fs.writeFileSync(path.join(dir,name),JSON.stringify(value));
  const cli=(...args)=>JSON.parse(execFileSync(process.execPath,[path.resolve(__dirname,'../cli/ink-studio.js'),
    'music','instrument',...args],{cwd:dir,encoding:'utf8'}));
  fs.writeFileSync(path.join(dir,'tone.wav'),WAV.encode(source,{encoding:'float32'}));
  save('source.json',{discovery:{...spec,candidates:[spec.candidates[1]],settings:{sampleRate:rate,keys:[60],velocities:[.86]}},
    assets:{tone:'tone.wav'}});
  const result=cli('discover','source.json','--out','bank');
  const report=JSON.parse(fs.readFileSync(result.report)), cell=report.anchor.id;
  const {startSample}=report.candidates[0].cells[0].events.find(row=>row.id==='strike');
  const toSample=startSample+620;
  save('select.json',{candidate:'porcelain',from:'slice',slice:{cell,fromSample:startSample,toSample},resample:true,
    reason:'Keep the onset I heard in the cue.'});
  const kept=cli('keep-discovery',result.bank,'select.json','--out','instruments');
  const anchor=WAV.read(path.join(dir,'bank',report.takes.porcelain[cell]));
  const capture=WAV.read(kept.audio);
  assert.deepEqual(capture.samples,anchor.samples.slice(startSample*2,toSample*2));
  assert(fs.existsSync(kept.motif));
});
