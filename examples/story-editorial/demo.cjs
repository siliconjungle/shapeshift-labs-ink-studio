const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const repo = path.resolve(process.env.INK_STUDIO_REPO ?? path.join(__dirname,'../..'));
const ink = require(repo), out = path.resolve(process.argv[2] ?? './lantern-gate-handoff');
const ffmpeg = process.env.INK_HANDOFF_FFMPEG ?? 'ffmpeg';
const file = name => path.join(out,name), read = name => JSON.parse(fs.readFileSync(file(name),'utf8'));
const save = (name,doc) => fs.writeFileSync(file(name),JSON.stringify(doc,null,2)+'\n');
const cli = (...args) => execFileSync(process.execPath,[path.join(repo,'cli/ink-studio.js'),...args],
  {cwd:out,encoding:'utf8',stdio:'pipe'});
fs.mkdirSync(file('assets'),{recursive:true});
for (const name of ['gate.world.json','gate.performance.json','gate.soundtrack.json','gate.music.json','gate.handoff.json']) {
  if (path.join(__dirname,name)!==file(name)) fs.copyFileSync(path.join(__dirname,name),file(name));
}
for (const [name,text] of [['lower','Lower the gate.'],['clear','Channel clear.']]) {
  const asset='assets/'+name+'.wav', bundled=path.join(__dirname,asset);
  if (fs.existsSync(bundled)) {
    if (bundled!==file(asset)) fs.copyFileSync(bundled,file(asset));
  } else if (!fs.existsSync(file(asset))) {
    const temp='assets/'+name+'.aiff';
    execFileSync('say',['-v','Samantha','-r','185','-o',file(temp),text]);
    execFileSync(ffmpeg,['-hide_banner','-loglevel','error','-y','-i',file(temp),'-af','volume=0.55',file(asset)]);
    fs.rmSync(file(temp));
  }
}
const sampleRate=48000;
function audio(name,duration,sample) {
  const samples=Float32Array.from({length:Math.floor(sampleRate*duration)},(_,i)=>sample(i/sampleRate));
  fs.writeFileSync(file('assets/'+name+'.wav'),ink.encodeWav({sampleRate,channels:1,samples}));
}
const tone=(hz,t)=>Math.sin(2*Math.PI*hz*t);
audio('latch',.45,t=>(tone(156,t)*.55+tone(584,t)*.3+tone(1313,t)*.16)*Math.exp(-t*16)*Math.min(1,t*180)*.42);
audio('water',2,t=>(tone(88,t)*tone(.5,t)+tone(131,t)*tone(2,t)+.3*tone(987,t)*tone(5,t))*.038);
const world=read('gate.world.json');
for (let tick=25;tick<=53;tick++) world.commands.push({tick,action:'world/patch',args:{edits:[
  {op:'set',path:'/entities/gate/position',value:[.15,Math.max(.14,.58-(tick-25)*.066),0]},
  {op:'set',path:'/entities/skiff/position',value:[1.56,.14,.97-(tick-25)*.062]}
]}});
save('gate.take-world.json',world);
cli('sim','run','gate.take-world.json','--ticks','77','--record','gate.run.json');
cli('story','handoff','gate.run.json','gate.handoff.json','--ffmpeg',ffmpeg,'--out','wide');
const crop=read('gate.handoff.json');
crop.picture.fromFrame=38; crop.picture.toFrame=82;
save('gate.crop.json',crop);
cli('story','handoff','gate.run.json','gate.crop.json','--ffmpeg',ffmpeg,'--out','crop');
for (const version of ['wide','crop']) {
  const {clock,picture}=read(version+'/handoff.json');
  assert.equal(picture.shots.length,2);
  assert.equal(ink.readWav(file(version+'/audio/mix.wav'),{metadata:true}).bwf.timeReference,String(clock.firstSample));
  const wave = ink.readWav(file(version+'/audio/dialogue.wav'));
  assert(wave.samples.some(sample=>Math.abs(sample)>.05));
  const notes=read(version+'/parts.json').tracks.keys.notes;
  assert(notes.length>=2);
  const dialogue=read(version+'/dialogue.json').lines;
  assert(dialogue.every(row=>row.clip && row.beatId));
  cli('timeline',version+'/timeline.json','--out',version+'/marker-review.json');
  cli('music','editorial','inspect',version+'/dialogue-edit.json','--out',version+'/dialogue-review.json');
  execFileSync(ffmpeg,['-hide_banner','-loglevel','error','-y','-i',file(version+'/picture.mov'),'-i',
    file(version+'/audio/mix.wav'),'-c:v','copy','-c:a','aac','-movflags','+faststart',file(version+'-preview.mp4')]);
}
assert(read('crop/dialogue.json').lines[0].clip.sourceIn>0);
assert.equal(read('crop/parts.json').tracks.keys.notes[0].startSample,0);
console.log(out);
