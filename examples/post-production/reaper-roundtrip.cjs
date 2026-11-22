/* Build the workshop from the Lantern Gate story and optionally verify it in REAPER. */
const fs=require('node:fs'), path=require('node:path'), os=require('node:os'), assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const ink=require('../..'), {KIT}=ink.load(), P=KIT.procedural, T=P.takeTime;
const rate=48000, ffmpeg=process.env.INK_HANDOFF_FFMPEG ?? 'ffmpeg';
const WAV=require('../../cli/wav.js');
const root=path.resolve(process.argv[2] ?? 'post-production');
const file=name=>path.join(root,name);
const read=name=>JSON.parse(fs.readFileSync(file(name),'utf8'));
function save(name,value) {fs.writeFileSync(file(name),JSON.stringify(value,null,2)+'\n');}
function cli(...args) {
  return JSON.parse(execFileSync(process.execPath,[path.resolve(__dirname,'../../cli/ink-studio.js'),...args],
    {encoding:'utf8',cwd:root}));
}
function video(...args) {
  execFileSync(ffmpeg,['-hide_banner','-loglevel','error','-nostdin','-y',...args],{stdio:'inherit'});
}
const tone=(hz,sample)=>Math.sin(2*Math.PI*hz*sample/rate);
const pcm=samples=>({sampleRate:rate,channels:1,samples});
function noise(frames,level,seed,hz) {
  let low=0,state=seed;
  return Float64Array.from({length:frames},(_,i)=>{
    state=(Math.imul(state,1664525)+1013904223)>>>0;
    const white=state/2147483648-1;
    low+=(white-low)*.094;
    return level*(.47*white+.33*low+.19*tone(hz,i)+.11*tone(hz*.73,i));
  });
}
function write(name,value,options) {fs.writeFileSync(file(name),WAV.encode(value,options));}
function edit(recipe,ops) {
  const assets=Object.fromEntries(Object.entries(recipe.assets).map(([name,ref])=>[name,WAV.read(file(ref))]));
  const {value}=P.mediaGraph.audioEditorial.revise(recipe.session,assets,ops);
  return {session:value,assets:recipe.assets};
}
function setup() {
  fs.mkdirSync(file('recordings'),{recursive:true});
  const wide='lantern-source/wide';
  if (!fs.existsSync(file(wide+'/handoff.json')))
    execFileSync(process.execPath,[path.resolve(__dirname,'../story-editorial/demo.cjs'),file('lantern-source')],{stdio:'inherit'});
  cli('music','post','from-story',wide+'/handoff.json','--out','story-project.json');
  const recipe=read('story-project.json'), picture=recipe.session.picture;
  const takeClock=T.create({fps:picture.fps,sampleRate:rate}), absoluteZero=takeClock.at(picture.startFrame).firstSample;
  const shotAt=frame=>picture.shots.find(shot=>frame>=shot.inFrame&&frame<shot.inFrame+shot.frames);
  const indices=Array.from({length:picture.shots.reduce((sum,shot)=>sum+shot.frames,0)},(_,i)=>takeClock.at(picture.startFrame+i));
  const frameAt=sample=>indices.find(row=>row.firstSample<=sample+absoluteZero && row.endSample>sample+absoluteZero).frame;
  const reference=read(wide+'/handoff.json');
  const cues=read(wide+'/cues.json').cues;
  const worldTime=cues.find(row=>row.label==='latch').offsetSample;
  const original=recipe.session.clips.find(row=>row.id==='cue-1');
  const voice=WAV.read(file(recipe.assets[original.takes.source.asset])).samples;
  const head=2400, adrHead=3700, length=voice.length+9000, clockStart=5*rate;
  const body=noise(length,.017,19,113), clean=noise(length,.008,335,179);
  const aerial=new Float64Array(length*2), adr=new Float64Array(length);
  for (let i=0;i<length;i++) {
    const n=i-head, index=i-adrHead, dry=n>=0 && n<voice.length ? voice[n] : 0;
    const echo=n>=368 && n-368<voice.length ? voice[n-368] : 0;
    const alternate=index>=0 && index<voice.length ? voice[index] : 0;
    const following=index+1>=0&&index+1<voice.length ? voice[index+1] : alternate;
    aerial[2*i]=dry*.53+echo*.24+body[i]+.044*tone(60,i)+.016*tone(120,i);
    aerial[2*i+1]=dry*.77+clean[i]+.006*tone(60,i);
    adr[i]=.82*alternate+.07*(alternate-following)+clean[i]*.42;
  }
  aerial[2*(head+9400)]+=.22;
  write('recordings/scene-24C-take-02.wav',{sampleRate:rate,channels:2,samples:aerial},
    {encoding:'pcm24',bwf:{description:'Scene 24C take 02, boom and lav',timeReference:clockStart}});
  write('recordings/scene-24C-adr-08.wav',pcm(adr),{encoding:'pcm24'});
  write('recordings/room-donor.wav',pcm(noise(37000,.012,85,163)));
  write('recordings/room-target.wav',pcm(noise(27000,.025,11,121)));
  const foley=WAV.read(file('lantern-source/assets/latch.wav'));
  write('recordings/latch.wav',foley,{encoding:'pcm24'});
  recipe.assets={...recipe.assets,poly:'recordings/scene-24C-take-02.wav',adr:'recordings/scene-24C-adr-08.wav',
    latch:'recordings/latch.wav'};
  recipe.session.clips=recipe.session.clips.filter(row=>row.id!=='foley');
  for (const clip of recipe.session.clips.filter(row=>row.track==='dialogue')) {
    const {samples}=clip.spot, frame=frameAt(samples), shot=shotAt(frame);
    clip.spot={shot:shot.id,sourceFrame:frame};
    clip.offsetSamples=samples-(takeClock.at(frame).firstSample-absoluteZero);
    clip.fades={inSamples:64,outSamples:375,curve:'equal-power'};
  }
  const [a,b]=picture.shots;
  const sourceFrame=b.inFrame+2, lostFrame=frameAt(worldTime);
  const latchTake={asset:'latch',sync:{sample:0},fromSample:0,toSample:foley.samples.length/foley.channels};
  recipe.session.clips.push({id:'gate-latch',track:'foley',spot:{shot:b.id,sourceFrame},take:'latch',takes:{latch:latchTake},
    fades:{outSamples:240,curve:'linear'},gain:.56});
  recipe.session.clips.push({id:'temp-latch',track:'effects',spot:{shot:a.id,sourceFrame:lostFrame},
    take:'latch',takes:{latch:latchTake},gain:.31});
  save('spotting.json',recipe);
  save('field-sheet.json',{recordings:[
    {id:'boom',asset:'poly',scene:'24C',take:'02',kind:'boom',channels:[0]},
    {id:'lav',asset:'poly',scene:'24C',take:'02',kind:'lav',channels:[1]},
    {id:'adr-read',asset:'adr',scene:'24C',take:'08',kind:'adr',anchors:{line:adrHead}}
  ],links:[{clip:'cue-1',scene:'24C',take:'02',recorderSample:String(clockStart+head),anchor:'line',
    prefer:'boom',alternates:['adr-read'],handles:2100}]});
  cli('music','post','relink','spotting.json','field-sheet.json','--out','relinked');
  save('repair.json',{clip:'cue-1',take:'boom',as:'boom-repaired',select:true,options:{
    hum:{frequency:60,harmonics:2,amount:1,reference:{fromSample:head+voice.length,toSample:length}},
    declick:{ranges:[{fromSample:head+9400,toSample:head+9401}]},
    preview:{fromSample:head,toSample:head+voice.length}
  }});
  cli('music','post','repair','relinked/project.json','repair.json','--out','repair');
  const afterPicture={...picture,shots:[{...a,inFrame:a.inFrame+4,frames:a.frames-10},{...b,frames:b.frames-3}]};
  save('recut.json',{picture:afterPicture});
  cli('music','post','review','repair/project.json','recut.json','--out','review');
  const reconform=read('review/report.json');
  assert(reconform.attention.some(row=>row.clip==='temp-latch'&&row.reason==='source-frame-trimmed'));
  assert(reconform.changes.some(row=>row.status==='moved' && row.id==='cue-2'));
  const frames=afterPicture.shots.reduce((sum,row)=>sum+row.frames,0);
  const recutSamples=takeClock.at(afterPicture.startFrame+frames).firstSample-absoluteZero;
  save('room.json',{reference:'recordings/room-target.wav',options:{
    donor:{fromSample:1000,toSample:35000},reference:{fromSample:500,toSample:26000},
    frames:recutSamples,crossfadeSamples:4800,maxBandDb:9,seed:225
  }});
  cli('music','post','room','recordings/room-donor.wav','room.json','--out','room');
  const revised=read('review/project.json');
  revised.assets=Object.fromEntries(Object.entries(revised.assets).map(([name,ref])=>[name,path.join('review',ref)]));
  Object.assign(revised.assets,{room:'room/audio/room-tone.wav','room-donor':'recordings/room-donor.wav',
    'room-reference':'recordings/room-target.wav'});
  const bed={asset:'room',sync:{sample:0},fromSample:0,toSample:recutSamples};
  const fixed=edit(revised,[{op:'remove-clip',clip:'temp-latch'},{op:'add-clip',clip:{
    id:'room-bed',track:'ambience',spot:{samples:0},take:'woven',takes:{woven:bed},
    fades:{inSamples:1400,outSamples:3800,curve:'equal-power'},gain:.78
  }}]);
  save('cut-project.json',fixed);
  const framesDir=file('cut-frames');
  fs.mkdirSync(framesDir,{recursive:true});
  let index=0;
  for (const shot of afterPicture.shots) for (let i=0;i<shot.frames;i++) {
    const original=shot.inFrame+i-reference.picture.fromFrame, name=n=>'frame-'+String(n).padStart(6,'0')+'.png';
    fs.copyFileSync(file(wide+'/picture/'+name(original)),path.join(framesDir,name(index++)));
  }
  video('-framerate',picture.fps.numerator+'/'+picture.fps.denominator,'-i',path.join(framesDir,'frame-%06d.png'),
    '-frames:v',String(frames),'-an','-movie_timescale',String(picture.fps.numerator),'-vf','scale=768:480:flags=neighbor','-c:v','libx264','-pix_fmt','yuv420p',
    file('cut.mov'));
  save('handoff-settings.json',{picture:'cut.mov',records:{'field-sheet':'field-sheet.json',repair:'repair.json',
    'room-tone':'room.json',recut:'recut.json','reconform-review':'review/report.json'}});
  cli('music','post','export','cut-project.json','handoff-settings.json','--out','handoff');
}
function verify(executable) {
  const manifest=read('handoff/handoff.json'), folder=file('handoff');
  const line=manifest.items.find(row=>row.clip==='cue-1'), foley=manifest.items.find(row=>row.clip==='gate-latch');
  const picture=manifest.items.find(row=>row.role==='picture'), shift=1200;
  const fields={folder,project:file('handoff/edit.rpp'),dialogue:line.guid,adr:line.takes.find(row=>row.id==='adr-read').guid,
    foley:foley.guid,picture:picture.guid,shift,rate,frames:manifest.frames};
  const options=fs.mkdtempSync(path.join(os.tmpdir(),'ink-reaper-profile-')), config=path.join(options,'verify.lua');
  const settings=Object.entries(fields).map(([name,value])=>name+'='+JSON.stringify(value)).join(',\n');
  fs.writeFileSync(config,'return {\n'+settings+'\n}\n');
  for (const name of ['reaper-error.txt','reaper-return.json','reaper-picture.txt','reaper-pcm.wav'])
    fs.rmSync(file('handoff/'+name),{force:true});
  try {
    execFileSync(executable,['-newinst','-cfgfile',path.join(options,'reaper.ini'),fields.project,
      path.join(__dirname,'verify-reaper.lua')],
    {env:{...process.env,INK_REAPER_VERIFY_CONFIG:config},timeout:45000,stdio:'inherit'});
  } finally {
    fs.rmSync(options,{recursive:true,force:true});
  }
  const errorFile=file('handoff/reaper-error.txt');
  if (fs.existsSync(errorFile)) throw Error(fs.readFileSync(errorFile,'utf8'));
  cli('music','post','import','handoff','handoff/reaper-return.json','--out','returned');
  const report=read('returned/report.json');
  const dx=report.edits.find(row=>row.clip==='cue-1'), fx=report.edits.find(row=>row.clip==='gate-latch');
  assert.equal(dx.take,'adr-read');
  assert.equal(dx.shiftSamples,0);
  assert.equal(dx.syncSample,line.syncSample);
  assert.equal(fx.shiftSamples,shift);
  assert.equal(fx.syncSample,foley.syncSample+shift);
  const external=WAV.read(file('handoff/reaper-pcm.wav')), returned=WAV.read(file('returned/mix.wav'));
  const padding=external.samples.length-returned.samples.length;
  assert(padding>=0 && padding<=rate*.040 && external.samples.subarray(returned.samples.length).every(value=>value===0),
    'REAPER did not return a complete picture window with silent padding');
  const aligned={...external,samples:external.samples.subarray(0,returned.samples.length)};
  const compare=P.mediaGraph.postProduction.verify(returned,{reaper:aligned});
  assert(compare.maxError<5e-6,'REAPER and Ink renders differ at sample '+compare.worstSample+' by '+compare.maxError);
  const [application,duration,pictureRate]=fs.readFileSync(file('handoff/reaper-picture.txt'),'utf8').trim().split('\n');
  assert(Math.abs(Number(pictureRate)-manifest.pictureRate)<.00005,'REAPER project frame rate differs from Ink');
  save('verification.json',{application,pictureSeconds:Number(duration),pictureFrameRate:Number(pictureRate),
    dialogue:dx,foley:fx,recombinedStems:report.verification,inkVsReaper:{...compare,trimmedSilentFrames:padding/2}});
  for (const [name,sound] of [['before','handoff/ink/prints/mix.wav'],['after','returned/mix.wav']])
    video('-i',file('cut.mov'),'-i',file(sound),'-map','0:v','-map','1:a','-c:v','copy','-c:a','aac','-movflags','+faststart',file(name+'.mp4'));
  console.log(file('verification.json'));
}
if (process.argv[4]!=='--verify-only') setup();
if (process.argv[3]) verify(path.resolve(process.argv[3]));
