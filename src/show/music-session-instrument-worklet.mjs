import {instruments,phrasing} from './instrument-core.mjs';

const smoothControls=new Set(['pressure','breath','room']);

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
  stop(key,crossfade) {
    const voice=this.voices.get(key);
    if (voice) {
      voice.off=voice.age;
      voice.crossfade=crossfade!==undefined;
      voice.releaseFrames=Math.max(1,Math.round((crossfade ?? .095)*sampleRate));
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
      this.performance=phrasing.compile(data.performance,data.patch);
      this.defaults=data.patch.controls ?? {};
      this.gain=data.gain;
      this.port.postMessage({id:data.id,ready:true});
    } else if (data.type==='on' && this.patch) {
      this.stop(data.key);
      const channel=data.key.split('/')[0], active=[...this.voices].filter(([,voice])=>voice.channel===channel);
      let rule;
      if (this.performance && active.length===1) {
        const [key,previous]=active[0], interval=data.midi-previous.midi;
        if (Math.abs(interval)<=this.performance.interval)
          rule=phrasing.select(this.performance,'legato',interval,data,true);
        if (rule) this.stop(key,this.performance.fade);
      }
      if (this.voices.size>=8) this.stop(this.voices.keys().next().value);
      const values={...data.values}, voice={age:0,values,pitchAt:0,pitchSum:0,channel,midi:data.midi,ramps:{},
        fadeIn:rule ? Math.round(this.performance.fade*sampleRate) : 0};
      const ratio=()=>2**((values.pitchCents ?? 0)/1200);
      const expression={pitchRatio:ratio,pitchMax:2**(1/6),
        pitchTime:t=>voice.pitchSum+(t-voice.pitchAt)*ratio(),
        gain:()=>values.amplitude ?? 1,
        controls:Object.fromEntries(['pressure','breath','contact','room'].map(name=>[name,()=>values[name]]))};
      voice.expression=expression;
      const turn=this.turn++;
      voice.sound=this.patch.prepare({midi:data.midi,velocity:data.velocity,frequency:instruments.hz(data.midi),
        play:rule ? {articulation:rule.articulation} : {},roundRobin:turn,salt:turn+1,expression},sampleRate,30);
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
      if (smoothControls.has(data.name)) {
        const current=voice.values[data.name] ?? this.defaults[data.name];
        if (current!==undefined) {
          voice.values[data.name]=current;
          voice.ramps[data.name]={target:data.value,frames:Math.max(1,Math.round(.008*sampleRate))};
          return;
        }
      }
      voice.values[data.name]=data.value;
    }
  }
  process(_inputs,[out]) {
    const render=voice=>{
      const {sound}=voice;
      for (let i=0;i<out[0].length;i++) {
        const frame=voice.age++, time=frame/sampleRate;
        if (time>=sound.duration || voice.off!==undefined && frame-voice.off>=voice.releaseFrames) return false;
        const fadeOut=voice.off===undefined ? 1 : 1-(frame-voice.off)/voice.releaseFrames;
        const release=voice.crossfade ? Math.sin(fadeOut*Math.PI/2) : fadeOut**2;
        const attack=frame<voice.fadeIn ? Math.sin(frame/voice.fadeIn*Math.PI/2) : 1;
        const gain=attack*release*this.gain*.55;
        for (const name in voice.ramps) {
          const ramp=voice.ramps[name];
          voice.values[name]+=(ramp.target-voice.values[name])/ramp.frames;
          if (!--ramp.frames) delete voice.ramps[name];
        }
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
