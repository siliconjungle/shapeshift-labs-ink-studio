const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { test } = require('node:test');
const ink = require('..');

const kit=ink.load(), K=kit.KIT, W=K.world, rate=8000;
const cli=path.resolve(__dirname,'../cli/ink-studio.js');
const performance=require('../examples/story-editorial/gate.performance.json');
const music=require('../examples/story-editorial/gate.music.json');

test('a fractional crop exports one clock for picture, BWF, dialogue, source beats and performed notes', t=>{
  const room=fs.mkdtempSync(path.join(os.tmpdir(),'ink-story-editorial-'));
  t.after(()=>fs.rmSync(room,{recursive:true,force:true}));
  const file=name=>path.join(room,name);
  const save=(name,value)=>fs.writeFileSync(file(name),JSON.stringify(value));
  const read=name=>JSON.parse(fs.readFileSync(file(name),'utf8'));
  const call=(...args)=>execFileSync(process.execPath,[cli,...args],{cwd:room,encoding:'utf8',stdio:'pipe'});
  const fps={numerator:30000,denominator:1001};
  const run=W.runtime.create({id:'handoff-test',dt:.025,history:{enabled:false},takeClock:{fps,simulationRate:40,
    cuts:[{frame:2,id:'Closer'}]},visual:{bounds:{min:[-1,-.25,-1],max:[1,1,1]},resolution:.17},commands:[
    {tick:1,action:'world/event',args:{kind:'keeper-order'}},
    {tick:3,action:'world/event',args:W.timedEvents.at(.073,{kind:'gate-drop'})},
    {tick:4,action:'world/event',args:{kind:'arrival',actor:'keeper'}}
  ]});
  run.advance(8);
  save('run.json',run.recording());
  save('performance.json',performance);
  save('music.json',music);
  save('sound.json',{format:'ink-studio/scene-audio',version:1,sampleRate:rate,assets:{voice:'voice.wav',latch:'voice.wav'},
    spatial:{cues:{latch:{asset:'latch',bus:'foley'}},bindings:{drop:{on:{kind:'gate-drop'},cue:'latch'}}},post:{}});
  fs.writeFileSync(file('voice.wav'),ink.encodeWav({sampleRate:rate,channels:1,
    samples:Float32Array.from({length:900},(_,i)=>i/1800)}));
  save('plan.json',{format:'ink-studio/story-editorial-plan',version:1,id:'tiny-cut',
    soundtrack:'sound.json',picture:{fromFrame:1,toFrame:4,width:48,height:30,video:false},
    dialogue:{plan:'performance.json',assets:{lower:'voice'}},instruments:{session:'music.json'}});
  call('story','handoff','run.json','plan.json','--out','export');
  const report=read('export/handoff.json'), {clock}=report;
  assert.deepEqual([clock.firstSample,clock.endSample],[266,1067]);
  assert.equal(report.picture.frameCount,3);
  assert(report.picture.shots.some(row=>row.label==='Closer'));
  const frames=read('export/picture.json').frames;
  assert.deepEqual(frames.map(row=>row.firstSample),[266,533,800]);
  assert.equal(frames.at(-1).endSample,1067);
  assert(fs.existsSync(file('export/'+frames[0].file)));
  const wav=name=>ink.readWav(file('export/audio/'+name+'.wav'),{metadata:true});
  assert.equal(wav('mix').bwf.timeReference,'266');
  assert.equal(wav('mix').samples.length,801*2);
  assert(wav('dialogue').samples[0]>.03);
  assert(wav('foley').samples[319*2]>0);
  assert(wav('music').samples.some(value=>Math.abs(value)>.01));
  const [line]=read('export/dialogue.json').lines;
  assert.equal(line.clip.sourceIn,66);
  assert.equal(line.clip.offsetSample,0);
  assert.deepEqual(line.originalTimecode,{numerator:1,denominator:40});
  const cue=read('export/cues.json').cues.find(row=>row.kind==='audio');
  assert.deepEqual([cue.offsetSample,cue.beatId],[318,'ink:beat:handoff-test/main/3.0']);
  const timeline=JSON.parse(call('timeline','export/timeline.json'));
  assert(timeline.cues.some(row=>row.beatId===cue.beatId));
  const inspection=JSON.parse(call('music','editorial','inspect','export/dialogue-edit.json'));
  assert.equal(inspection.frames,801);
  const midi=W.midiFiles.decode(fs.readFileSync(file('export/notes.mid')));
  assert(midi.notes.some(row=>row.pitch===69));
  const parts=read('export/parts.json');
  assert.equal(parts.tracks.bass.notes[0].startSample,0);
  assert.equal(parts.tracks.bass.notes[0].inSample,0);
  const otio=read('export/edit.otio'), [video]=otio.tracks.children;
  assert.equal(video.kind,'Video');
  assert.equal(video.children.length,2);
  assert.equal(video.children[0].media_reference.OTIO_SCHEMA,'ImageSequenceReference.1');
  assert.equal(otio.global_start_time.value,1);
  assert(otio.tracks.children.some(row=>row.name.startsWith('Keeper') && !row.enabled));
});
