/* Sample a named SF2 preset into portable Ink zones with an external FluidSynth. */
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const WAV=require('./wav.js');
const int=(value,min,max)=>Number.isInteger(value) && value>=min && value<=max;
const validName=name=>typeof name==='string' && /^[a-z][a-z0-9_-]{0,47}$/i.test(name) &&
  !['__proto__','constructor','prototype'].includes(name);

function vlq(value) {
  const bytes=[value&127];
  for (value>>>=7;value;value>>>=7) bytes.unshift((value&127)|128);
  return bytes;
}
function midi({bank,program,hold,pitch,velocity,drum}) {
  const channel=drum ? 9 : 0;
  const track=Buffer.from([
    0,0xff,0x51,3,7,0xa1,0x20,
    0,0xb0|channel,0,bank>>7,0,0xb0|channel,32,bank&127,
    0,0xc0|channel,program,0,0x90|channel,pitch,velocity,
    ...vlq(Math.round(960*hold)),0x80|channel,pitch,0,
    ...vlq(480),0xff,0x2f,0
  ]);
  const header=Buffer.from([77,84,104,100,0,0,0,6,0,0,0,1,1,224,77,84,114,107,0,0,0,0]);
  header.writeUInt32BE(track.length,18);
  return Buffer.concat([header,track]);
}

module.exports=function soundfont(file,presetFile,opt) {
  if (!file || !presetFile || typeof opt.out!=='string' ||
    (opt.fluidsynth!==undefined && typeof opt.fluidsynth!=='string'))
    throw new TypeError('Use music soundfont <preset.sf2> <preset.json> --out directory [--fluidsynth path]');
  const raw=JSON.parse(fs.readFileSync(presetFile,'utf8'));
  const {id='soundfont',bank=0,program=0,notes=[48,55,60,67,72],velocities=[60,110],
    hold=1.4,release=.2,sampleRate=32000,drum=false}=raw;
  if (!validName(id) || !int(bank,0,16383) || !int(program,0,127) || typeof drum!=='boolean' ||
    ![notes,velocities].every(list=>Array.isArray(list) && list.length>=1 && list.every((n,i)=>n>(list[i-1] ?? -1))) ||
    notes.some(note=>!int(note,0,127)) || velocities.some(v=>!int(v,1,127)) ||
    notes.length*velocities.length>48 || !int(sampleRate,8000,48000) ||
    !Number.isFinite(hold) || hold<.1 || hold>5 || !Number.isFinite(release) || release<.05 || release>2)
    throw new RangeError('Invalid SoundFont bank, program, sample grid, or duration');
  const input=path.resolve(file), engine=opt.fluidsynth ?? 'fluidsynth';
  if (!fs.statSync(input).isFile()) throw new TypeError('A SoundFont must be a file');
  const target=path.resolve(opt.out), scratch=fs.mkdtempSync(path.join(os.tmpdir(),'ink-sf2-'));
  const assets={}, zones=[];
  try {
    for (const [i,pitch] of notes.entries()) for (const [j,velocity] of velocities.entries()) {
      const name=id+'-'+pitch+'-'+velocity, midiPath=path.join(scratch,'note.mid');
      const sampleFile=path.join(scratch,name+'.wav');
      fs.writeFileSync(midiPath,midi({bank,program,hold,pitch,velocity,drum}));
      execFileSync(engine,['-n','-i','-q','-R','0','-C','0','-o','synth.midi-bank-select=mma','-g','0.9',
        '-r',String(sampleRate),'-T','wav','-F',sampleFile,input,midiPath],{timeout:20000,stdio:['ignore','pipe','pipe']});
      const audio=WAV.read(sampleFile), frames=Math.min(audio.samples.length/audio.channels,
        Math.floor((hold+release)*sampleRate));
      const samples=audio.samples.slice(0,frames*audio.channels);
      if (!samples.some(x=>Math.abs(x)>1e-7)) throw new RangeError('SoundFont rendered a silent sample at '+pitch);
      const fade=Math.min(frames,Math.floor(sampleRate*.012));
      for (let f=0;f<fade;f++) for (let ch=0;ch<audio.channels;ch++)
        samples[(frames-1-f)*audio.channels+ch]*=f/fade;
      fs.writeFileSync(sampleFile,WAV.encode({...audio,samples}));
      assets[name]=name+'.wav';
      const split=(a,b)=>Math.floor((a+b)/2);
      zones.push({samples:[name],root:pitch,low:drum ? pitch : i===0 ? 0 : split(notes[i-1],pitch)+1,
        high:drum ? pitch : i===notes.length-1 ? 127 : split(pitch,notes[i+1]),
        velocity:[j===0 ? 0 : (split(velocities[j-1],velocity)+.5)/127,
          j===velocities.length-1 ? 1 : (split(velocity,velocities[j+1])+.5)/127],
        oneShot:drum});
    }
    fs.mkdirSync(target,{recursive:true});
    for (const asset of Object.values(assets)) fs.copyFileSync(path.join(scratch,asset),path.join(target,asset));
    const manifest=path.join(target,'instrument.json');
    fs.writeFileSync(manifest,JSON.stringify({assets,patches:{[id]:{type:'sample',zones,
      env:{attack:.002,decay:hold,sustain:1,release}}}},null,2)+'\n');
    process.stdout.write(JSON.stringify({manifest,zones:zones.length})+'\n');
    return {manifest,zones:zones.length};
  } catch (error) {
    if (error.code==='ENOENT' && error.path===engine)
      throw new Error('FluidSynth is required for SoundFont import. Set --fluidsynth to its executable path.');
    throw error;
  } finally {fs.rmSync(scratch,{recursive:true,force:true});}
};
