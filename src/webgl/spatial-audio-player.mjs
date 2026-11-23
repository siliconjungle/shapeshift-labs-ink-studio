/* Play spatial mix frames through caller-owned Web Audio resources. */
import * as sharedBudget from '../world-voice-budget.js';
const voiceBudget=sharedBudget.default??globalThis[Symbol.for('ink-studio.world-voice-budget')];
const clamp=(value,min,max)=>Math.min(max,Math.max(min,value));
const finite=(value,min,max)=>Number.isFinite(value)&&value>=min&&value<=max;
const buses=['dialogue','foley','effects','ambience','music'];
const position=value=>Array.isArray(value)&&value.length===3&&value.every(Number.isFinite);

export function createSpatialAudioPlayer(context, {
  resolveAsset, destination=context?.destination, destinations={}, panning='HRTF', maxVoices, smoothing=.025
}={}) {
  if(typeof context?.createBufferSource!=='function'||!context.listener||!destination||
    typeof resolveAsset!=='function'||!['HRTF','equalpower'].includes(panning)||
    (maxVoices!==undefined&&(!Number.isSafeInteger(maxVoices)||maxVoices<1||maxVoices>128))||!finite(smoothing,0,1))
    throw new TypeError('Spatial audio needs a Web Audio context, asset resolver, and valid mix settings');

  if(!destinations||![Object.prototype,null].includes(Object.getPrototypeOf(destinations))||
    Object.entries(destinations).some(([name,node])=>!buses.includes(name)||node?.context!==context||typeof node.connect!=='function'))
    throw new TypeError('Spatial audio bus destinations must be AudioNodes on the player context');
  const outputs=new Map(Object.entries(destinations)), output=voice=>outputs.get(voice.bus)??destination;
  const voices=new Map(), seen=new Set(), assets=new Map(), retiring=new Set();
  const fallback=voiceBudget.compile({maxVoices:maxVoices??32,reservedVoices:0});
  let disposed=false, previousTime=-Infinity, policy=fallback, configured=false;
  let inspection=Object.freeze({selected:[],rejected:[]});
  function remember(id){
    seen.add(id);
    if(seen.size>8192)seen.delete(seen.values().next().value);
  }
  function asset(id){
    if(!assets.has(id)){
      const pending=Promise.resolve().then(()=>resolveAsset(id)).then(buffer=>{
        if(!buffer||!finite(buffer.duration,Number.EPSILON,1e9)||typeof buffer.getChannelData!=='function')
          throw new TypeError('Audio asset resolver must return an AudioBuffer for '+id);
        return buffer;
      }).catch(error=>{if(assets.get(id)===pending)assets.delete(id);throw error;});
      assets.set(id,pending);
      if(assets.size>512)assets.delete(assets.keys().next().value);
    }
    return assets.get(id);
  }
  function parameter(param,value,time,immediate=false){
    param.cancelScheduledValues(time);
    if(smoothing&&!immediate)param.setTargetAtTime(value,time,smoothing);
    else param.setValueAtTime(value,time);
  }
  function coordinates(node,name,value,time,immediate){
    value.forEach((n,i)=>parameter(node[name+'XYZ'[i]],n,time,immediate));
  }
  function listen(listener,immediate){
    if(!listener)return;
    const native=context.listener, at=context.currentTime;
    if(native.positionX){
      coordinates(native,'position',listener.position,at,immediate);
      coordinates(native,'forward',listener.forward,at,immediate);
      coordinates(native,'up',listener.up,at,immediate);
    }else{
      native.setPosition(...listener.position);
      native.setOrientation(...listener.forward,...listener.up);
    }
  }
  function tune(row,immediate){
    if(!row.source)return;
    const {voice,gain,low,high,filter,panner}=row, at=context.currentTime;
    if(voice.contact){
      const start=Math.max(at,row.started), {remaining,targetGain}=voice.contact;
      row.source.playbackRate.setValueAtTime(voice.rate,start);
      gain.gain.cancelScheduledValues(start);
      gain.gain.setValueAtTime(voice.gain,start);
      if(remaining)gain.gain.linearRampToValueAtTime(targetGain,start+remaining);
    }else parameter(gain.gain,voice.gain,at,immediate);
    const relative=band=>voice.gain>0?
      clamp(20*Math.log10(Math.max(1e-8,voice.bands[band]/voice.gain)),-60,40):0;
    parameter(low.gain,relative('low'),at,immediate);
    parameter(high.gain,relative('high'),at,immediate);
    parameter(filter.frequency,Math.min(voice.cutoff,context.sampleRate*.49),at,immediate);
    if(row.tone){
      const {highpass,lowpass,peaks}=row.tone, plan=voice.processing;
      const limit=context.sampleRate/2;
      parameter(highpass.frequency,Math.min(plan.highpass,limit*.98),at,immediate);
      parameter(lowpass.frequency,plan.lowpass===22000?limit:Math.min(plan.lowpass,limit*.98),at,immediate);
      peaks.forEach((node,i)=>{
        const peak=plan.peaks[i];
        parameter(node.gain,peak?.gainDb??0,at,immediate);
        if(peak){
          parameter(node.frequency,Math.min(peak.hz,limit*.98),at,immediate);
          parameter(node.Q,peak.q,at,immediate);
        }
      });
    }
    if(panner){
      const point=voice.apparentSource??voice.position;
      if(panner.positionX)coordinates(panner,'position',point,at,immediate);
      else panner.setPosition(...point);
    }
  }
  function disconnect(row){
    for(const node of row.nodes??[])node.disconnect();
  }
  function stop(row,fade=false){
    if(voices.get(row.voice.id)===row)voices.delete(row.voice.id);
    if(!row.source)return;
    const now=context.currentTime, tail=fade&&context.state==='running'&&row.started<=now?
      (configured?policy.stealFade:smoothing*3):0;
    if(tail){
      while(retiring.size>=policy.maxVoices)stop(retiring.values().next().value);
      const param=row.gain.gain;
      if(configured){
        if(param.cancelAndHoldAtTime)param.cancelAndHoldAtTime(now);
        else parameter(param,param.value,now,true);
        param.linearRampToValueAtTime(0,now+tail);
      }else parameter(param,0,now);
      retiring.add(row);
    }
    else retiring.delete(row);
    row.source.stop(now+tail);
    if(!tail)disconnect(row);
  }
  function reset(){
    for(const row of voices.values())stop(row);
    for(const row of retiring)stop(row);
    seen.clear();
    inspection=Object.freeze({selected:[],rejected:[]});
    previousTime=-Infinity;
  }
  function start(voice,at){
    const row={voice,when:at+voice.delay+(voice.startDelay??0)};
    voices.set(voice.id,row);
    row.pending=asset(voice.asset).then(buffer=>{
      if(disposed||voices.get(voice.id)!==row)return;
      const live=row.voice, when=Math.max(context.currentTime,row.when), late=when-row.when;
      let offset=live.offset+late*live.rate;
      const remaining=live.duration===undefined?undefined:live.duration-late;
      if(live.mode==='loop')offset%=buffer.duration;
      if(offset>=buffer.duration||remaining!==undefined&&remaining<=0){
        voices.delete(live.id);
        if(live.mode==='clip')remember(live.id);
        return;
      }
      const source=context.createBufferSource(), low=context.createBiquadFilter(), high=context.createBiquadFilter(),
        filter=context.createBiquadFilter(), gain=context.createGain();
      source.buffer=buffer;
      source.loop=live.mode==='loop';
      source.playbackRate.value=live.rate;
      low.type='lowshelf';low.frequency.value=Math.min(250,context.sampleRate*.1);
      high.type='highshelf';high.frequency.value=Math.min(2600,context.sampleRate*.4);
      filter.type='lowpass';filter.Q.value=-3;
      source.connect(low);low.connect(high);high.connect(filter);
      const nodes=[source,low,high,filter,gain];
      let tail=filter, tone;
      if(live.processing){
        const highpass=context.createBiquadFilter(), lowpass=context.createBiquadFilter();
        highpass.type='highpass';lowpass.type='lowpass';
        highpass.Q.value=lowpass.Q.value=-3.01029995664;
        const peaks=Array.from({length:4},()=>{
          const node=context.createBiquadFilter();
          node.type='peaking';
          return node;
        });
        for(const node of [highpass,...peaks,lowpass]){
          tail.connect(node);nodes.push(node);tail=node;
        }
        tone={highpass,peaks,lowpass};
      }
      tail.connect(gain);
      let panner;
      if(live.position){
        panner=context.createPanner();
        panner.panningModel=panning;
        panner.rolloffFactor=0;
        gain.connect(panner);panner.connect(output(live));nodes.push(panner);
      }else gain.connect(output(live));
      Object.assign(row,{source,low,high,filter,gain,panner,nodes,tone,started:when});
      tune(row,true);
      source.onended=()=>{
        retiring.delete(row);
        if(voices.get(live.id)===row){
          voices.delete(live.id);
          if(live.mode==='clip')remember(live.id);
        }
        disconnect(row);
      };
      if(remaining===undefined)source.start(when,offset);
      else source.start(when,offset,remaining*live.rate);
    }).catch(error=>{
      if(voices.get(voice.id)!==row)return;
      voices.delete(voice.id);
      if(voice.mode==='cue')seen.delete(voice.id);
      disconnect(row);
      throw error;
    });
    return row.pending;
  }
  function validProcessing(plan){
    return plan&&finite(plan.highpass,0,4000)&&finite(plan.lowpass,40,22000)&&
      Array.isArray(plan.peaks)&&plan.peaks.length<=4&&Array.from(plan.peaks).every(peak=>
        peak&&finite(peak.hz,40,16000)&&finite(peak.q,.25,12)&&finite(peak.gainDb,-24,18));
  }
  function validate(frame){
    if(!frame||!finite(frame.time,0,1e9)||!Array.isArray(frame.active)||!Array.isArray(frame.cues)||
      frame.active.length+frame.cues.length>4096||
      frame.listener&&![frame.listener.position,frame.listener.forward,frame.listener.up].every(position))
      throw new TypeError('Expected a spatial audio mix frame');
    const ids=new Set();
    for(const [rows,modes] of [[frame.active,['loop','clip']],[frame.cues,['cue']]])for(const row of rows){
      if(typeof row?.id!=='string'||ids.has(row.id)||typeof row.asset!=='string'||!modes.includes(row.mode)||
        !voiceBudget.validVoice(row)||!finite(row.gain,0,16384)||!['low','mid','high'].every(band=>finite(row.bands?.[band],0,16384))||
        !finite(row.rate,.001,64)||!finite(row.offset,0,65e9)||!finite(row.cutoff,20,22000)||
        (row.contact&&(row.mode!=='loop'||!finite(row.contact.targetGain,0,16384)||
          !finite(row.contact.remaining,0,10.000001)))||
        (row.startDelay!==undefined&&(row.mode!=='cue'||!finite(row.startDelay,0,10)))||
        (row.processing!==undefined&&!validProcessing(row.processing))||
        !finite(row.delay,0,1e9)||row.position!==null&&!position(row.position)||
        row.apparentSource!==undefined&&!position(row.apparentSource)||
        (row.mode==='clip'?!finite(row.duration,0,1e9):
          row.mode==='cue'&&row.sound?!finite(row.duration,.001,3600):row.duration!==undefined))
        throw new TypeError('Invalid spatial audio voice');
      ids.add(row.id);
    }
  }
  return Object.freeze({
    update(frame,{seek=false}={}){
      if(disposed)throw new Error('Spatial audio player is disposed');
      validate(frame);
      const authored=frame.voiceBudget===undefined?null:voiceBudget.compile(frame.voiceBudget);
      configured=authored!==null;
      const capacity=maxVoices===undefined?authored?.maxVoices:Math.min(maxVoices,authored?.maxVoices??maxVoices);
      policy=authored?{...authored,maxVoices:capacity,reservedVoices:Math.min(authored.reservedVoices,capacity)}:fallback;
      if(seek||frame.time<previousTime)reset();
      listen(frame.listener,previousTime===-Infinity);
      previousTime=frame.time;
      const desired=new Map();
      for(const row of voices.values())if(row.voice.mode==='cue')desired.set(row.voice.id,row.voice);
      for(const voice of frame.active){
        const sustained=voice.contact&&(voice.contact.targetGain>0||!configured&&voices.has(voice.id));
        if((voice.gain>0||sustained)&&!seen.has(voice.id))desired.set(voice.id,voice);
      }
      for(const voice of frame.cues)if(!seen.has(voice.id)){
        remember(voice.id);
        if(voice.gain>0)desired.set(voice.id,voice);
      }
      const candidates=[...desired.values()].map(voice=>({...voice,incumbent:voices.has(voice.id),
        gain:configured?Math.max(voice.gain,voice.contact?.targetGain??0):voice.gain}));
      const stable=configured||candidates.some(voice=>voice.priority!==undefined||voice.protected!==undefined);
      const ranked=voiceBudget.select(candidates,policy,stable);
      const selected=new Map([...ranked.selected].map(id=>[id,desired.get(id)]));
      const info=(id,decision)=>{
        const {cue,priority=0,protected:critical=false,group}=desired.get(id);
        return Object.freeze({id,cue,priority,protected:critical,...(group!==undefined&&{group}),...decision});
      };
      inspection=Object.freeze({time:frame.time,limit:policy.maxVoices,reservedVoices:policy.reservedVoices,
        selected:Object.freeze([...selected.keys()].map(id=>info(id,{}))),
        rejected:Object.freeze([...ranked.rejected].map(([id,reason])=>info(id,{reason,
          action:voices.has(id)?'displaced':desired.get(id).mode==='cue'?'dropped':'virtual'})))});
      while(retiring.size>policy.maxVoices)stop(retiring.values().next().value);
      for(const row of voices.values())if(!selected.has(row.voice.id))stop(row,true);
      const pending=[], at=context.currentTime;
      for(const [id,voice] of selected){
        let row=voices.get(id);
        if(row&&(row.voice.asset!==voice.asset||(!voice.contact&&row.voice.rate!==voice.rate)||
          Boolean(row.voice.processing)!==Boolean(voice.processing)||
          output(row.voice)!==output(voice)||Boolean(row.voice.position)!==Boolean(voice.position))){
          stop(row);
          row=undefined;
        }
        if(row){
          if(!row.source){
            if(voice.mode!=='cue')row.when=context.currentTime+voice.delay;
            pending.push(row.pending);
          }
          row.voice=voice;
          tune(row,false);
        }else pending.push(start(voice,at));
      }
      return Promise.all(pending).then(()=>undefined);
    },
    reset,
    inspectVoices:()=>inspection,
    dispose(){if(!disposed){disposed=true;reset();assets.clear();}}
  });
}
