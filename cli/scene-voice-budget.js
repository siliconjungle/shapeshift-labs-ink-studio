/* Allocate spatial voices at arrivals, departures, and recorded gain changes. */
const {select}=require('../src/world-voice-budget.js');

function planWorldVoices(voices,resolve,{end,sampleRate,policy}){
  const changes=[], fade=Math.round(policy.stealFade*sampleRate);
  for(const track of voices){
    const {budget,first,points}=track;
    if(!budget||first>=end)continue;
    track.admissions=[];
    const source=resolve(track.asset);
    if(!source.samples.length)continue;
    const natural=Math.max(0,Math.ceil((source.samples.length/source.channels/source.sampleRate-
      (track.offset??0))/(track.rate??1)*sampleRate));
    const stop=Math.min(end,track.end??end,track.loop?end:first+natural);
    if(stop<=first)continue;
    const row={...budget,track,first,stop,gain:points?.[0]?.rankGain??points?.[0]?.gain??1};
    changes.push({sample:first,add:row},{sample:stop,remove:row});
    let prior=row.gain;
    for(const point of points??[]){
      const gain=point.rankGain??point.gain;
      if(point.sample>first&&point.sample<stop&&gain!==prior){
        changes.push({sample:point.sample,row,gain});
        prior=gain;
      }
    }
  }
  changes.sort((a,b)=>a.sample-b.sample);
  const live=new Map(), counters={admitted:0,dropped:0,stolen:0,virtual:0,resumed:0,peakVoices:0};
  let kept=new Map(), retiring=[], omitted=0;
  const decisions=[];
  function note(row,sample,action,reason){
    counters[action]++;
    const {audit}=row.track;
    if(audit){
      if(!audit.voiceBudget)audit.voiceBudget={action,sample,...(reason&&{reason})};
      else if(action==='stolen')audit.voiceBudget.stolenAt=sample;
    }
    const item={sample,action,id:row.id,cue:row.cue,priority:row.priority,protected:row.protected,
      ...(row.group!==undefined&&{group:row.group}),...(reason&&{reason}),
      ...(audit?.source?.beatId&&{beatId:audit.source.beatId})};
    if(decisions.length<1024)decisions.push(item);
    else omitted++;
  }
  for(let i=0;i<changes.length;){
    const {sample}=changes[i];
    while(i<changes.length&&changes[i].sample===sample){
      const {add,remove,row,gain}=changes[i++];
      if(add)live.set(add.id,add);
      else if(remove)live.delete(remove.id);
      else row.gain=gain;
    }
    const candidates=[...live.values()].filter(row=>row.gain>0);
    for(const row of candidates)row.incumbent=kept.has(row.id);
    const {selected,rejected}=select(candidates,policy);
    const next=new Map([...selected].map(id=>[id,live.get(id)]));
    counters.peakVoices=Math.max(counters.peakVoices,next.size);
    retiring=retiring.filter(span=>span.end>sample);
    for(const [id,row] of kept){
      if(next.has(id)||row.stop<=sample)continue;
      const reason=rejected.get(id), span=row.track.admissions.at(-1);
      span.end=Math.min(row.stop,sample+(reason?fade:0));
      if(reason){
        span.fadeFrom=sample;
        if(span.end>sample){
          if(retiring.length>=policy.maxVoices)retiring.shift().end=sample;
          retiring.push(span);
        }
        note(row,sample,'stolen',reason);
      }
      if(row.mode==='cue')live.delete(id);
    }
    for(const [id,row] of next){
      if(kept.has(id))continue;
      const spans=row.track.admissions, last=spans.at(-1);
      if(last&&last.end>sample)last.end=sample;
      spans.push({first:sample,end:row.stop,fadeIn:sample>row.first?fade:0});
      note(row,sample,last?'resumed':'admitted');
      row.virtual=false;
    }
    for(const [id,reason] of rejected){
      const row=live.get(id);
      if(!row)continue;
      if(row.mode==='cue'){
        note(row,sample,'dropped',reason);
        live.delete(id);
      }else if(!row.virtual){
        row.virtual=true;
        if(!kept.has(id))note(row,sample,'virtual',reason);
      }
    }
    kept=next;
  }
  return {...policy,...counters,decisions,omitted};
}

module.exports={planWorldVoices};
