import {instruments} from './instrument-core.mjs';

class SessionInstrument extends AudioWorkletProcessor {
  voices=new Map();
  releases=[];
  turn=0;
  constructor() {
    super();
    this.port.onmessage=({data})=>{
      try {this.receive(data);}
      catch (error) {this.port.postMessage({error:error.message,id:data.id});}
    };
  }
  stop(key) {
    const voice=this.voices.get(key);
    if (voice) {
      voice.off=voice.age;
      this.voices.delete(key);
      if (this.releases.length>=8) this.releases.shift();
      this.releases.push(voice);
    }
  }
  receive(data) {
    if (data.type==='patch') {
      this.voices.clear();
      this.releases=[];
      this.patch=instruments.compile(data.patch,data.assets);
      this.gain=data.gain;
      this.port.postMessage({id:data.id,ready:true});
    } else if (data.type==='on' && this.patch) {
      this.stop(data.key);
      if (this.voices.size>=8) this.stop(this.voices.keys().next().value);
      const values={...data.values}, voice={age:0,values,pitchAt:0,pitchSum:0};
      const ratio=()=>2**((values.pitchCents ?? 0)/1200);
      const expression={pitchRatio:ratio,pitchMax:2**(1/6),
        pitchTime:t=>voice.pitchSum+(t-voice.pitchAt)*ratio(),
        gain:()=>values.amplitude ?? 1,
        controls:Object.fromEntries(['pressure','breath','contact'].map(name=>[name,()=>values[name]]))};
      voice.expression=expression;
      const turn=this.turn++;
      voice.sound=this.patch.prepare({midi:data.midi,velocity:data.velocity,frequency:instruments.hz(data.midi),
        play:{},roundRobin:turn,salt:turn+1,expression},sampleRate,30);
      this.voices.set(data.key,voice);
    } else if (data.type==='off') this.stop(data.key);
    else if (data.type==='control') {
      const voice=this.voices.get(data.key);
      if (!voice) return;
      if (data.name==='pitchCents') {
        const time=voice.age/sampleRate;
        voice.pitchSum=voice.expression.pitchTime(time);
        voice.pitchAt=time;
      }
      voice.values[data.name]=data.value;
    }
  }
  process(_inputs,[out]) {
    const releaseFrames=Math.round(.095*sampleRate);
    const render=voice=>{
      const {sound}=voice;
      for (let i=0;i<out[0].length;i++) {
        const frame=voice.age++, time=frame/sampleRate;
        if (time>=sound.duration || voice.off!==undefined && frame-voice.off>=releaseFrames) return false;
        const fade=voice.off===undefined ? 1 : (1-(frame-voice.off)/releaseFrames)**2;
        const gain=fade*this.gain*.55;
        const left=sound.signal(time,frame,0);
        out[0][i]+=left*gain;
        out[1][i]+=(sound.stereo ? sound.signal(time,frame,1) : left)*gain;
      }
      return true;
    };
    for (const [key,voice] of this.voices) if (!render(voice)) this.voices.delete(key);
    this.releases=this.releases.filter(render);
    for (const output of out) for (let i=0;i<output.length;i++) output[i]=Math.max(-1,Math.min(1,output[i]));
    return true;
  }
}
registerProcessor('ink-session-instrument',SessionInstrument);
