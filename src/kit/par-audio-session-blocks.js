/* Block identity includes the earlier input history a causal processor depends on. */
(function (P) {
  const S=P.mediaGraphSupport,A=P.musicProduction;
  const {check}=P.musicInstruments;
  const blockFrames=8192;
  const bytes=value=>ArrayBuffer.isView(value) ? value.byteLength :
    value && typeof value==='object' ? 32+Object.values(value).reduce((size,row)=>size+bytes(row),0) : 16;

  function lru(limit) {
    const rows=new Map();
    let used=0;
    return {
      get(key) {
        const row=rows.get(key);
        if (!row) return undefined;
        rows.delete(key);
        rows.set(key,row);
        return row.value;
      },
      set(key,value,size) {
        if (size>limit) return;
        const old=rows.get(key);
        if (old) {
          rows.delete(key);
          used-=old.size;
        }
        while (used+size>limit) {
          const first=rows.keys().next().value;
          used-=rows.get(first).size;
          rows.delete(first);
        }
        used+=size;
        rows.set(key,{value,size});
      }
    };
  }

  function createBlocks() {
    const identities=lru(16*1024*1024), voices=lru(32*1024*1024), sources=lru(96*1024*1024), mixes=lru(128*1024*1024);
    const takes=lru(2*1024*1024), peaks=lru(2*1024*1024);
    let serial=0;
    function identify(key) {
      let value=identities.get(key);
      if (value===undefined) {
        value=++serial;
        identities.set(key,value,64+key.length*2);
      }
      return value;
    }

    // A reader can resume from any retained checkpoint on this exact prefix.
    // When an edit changes an input block, descendants get different identities.
    function sequence(keys,cache,create,stats) {
      let next=0,runtime;
      return index=>{
        const found=cache.get(keys[index]);
        if (found) {
          if (stats) stats.outputBlockHits++;
          return found;
        }
        const floor=runtime && next<=index ? next : 0;
        let checkpoint=index, prior;
        while (checkpoint>floor) {
          prior=cache.get(keys[checkpoint-1]);
          if (prior?.state) break;
          checkpoint--;
        }
        if (checkpoint!==next || !runtime || next>index) {
          next=checkpoint;
          runtime=create();
          if (checkpoint) {
            runtime.restore(prior.state);
            if (stats && stats.resumedFrom===null) stats.resumedFrom=checkpoint*blockFrames;
          }
        }
        let value;
        while (next<=index) {
          const key=keys[next], save=next%4===3;
          value=runtime.block(next,save);
          cache.set(key,value,96+bytes(value));
          next++;
        }
        return value;
      };
    }

    function scoreSource(plan,lane,take) {
      const {signature}=S.musicSessionModel;
      const {score,source}=plan.producers.get(take), track=score.tracks[lane], rate=plan.rate;
      const local=score.cue?.perTrack[lane], patch=source.patches[track.patch];
      const fade=score.arrangement.score.endFade ?? .09;
      const send=track.mix.send, echo=track.echo;
      const room=send>0 || local?.room.some(row=>row.send.some(level=>level>0)) ||
        local?.depth.some(row=>row.send>0) ? score.room : null;
      const config=identify(signature([rate,plan.frames,score.end,score.gain,fade,patch,track.mix,track.gestures,
        local,room,score.cue?.roomCuts,echo]));
      const finger=identify(signature([rate,score.end,patch,local?.tail]));
      const onset=note=>note.start ?? note.time;
      const notes=track.performance ? score.events[lane].slice().sort((a,b)=>onset(a)-onset(b)) : score.events[lane];
      const blocks=Array.from({length:Math.ceil(plan.frames/blockFrames)},()=>[]);
      let work=0;
      for (const note of notes) {
        if (onset(note)>=score.end) break;
        const {first,last:end}=A.prepareVoice(track,note,score.end,rate,local?.tail);
        const last=Math.min(plan.frames,end);
        if (last<=Math.max(0,first)) continue;
        check((work+=last-first)<=64e6,'Session lane exceeds its voice rendering budget');
        const key=identify(signature([finger,first,last,note]));
        const voice={first,last,key,note};
        for (let index=Math.floor(Math.max(0,first)/blockFrames);index<=Math.floor((last-1)/blockFrames);index++)
          blocks[index].push(voice);
      }
      const duck=track.mix.duck && score.events[track.mix.duck.from];
      let duckIndex=0, prefix=config;
      const keys=blocks.map((rows,index)=>{
        const last=(index+1)*blockFrames/rate, changes=[];
        while (duck && duckIndex<duck.length && duck[duckIndex].time<last) {
          const {time,velocity}=duck[duckIndex++];
          changes.push([time,velocity]);
        }
        prefix=identify(signature([prefix,rows.map(voice=>voice.key),changes]));
        return prefix;
      });
      function readVoice({key,first,last,note}) {
        let buffer=voices.get(key);
        if (!buffer) {
          buffer=new Float64Array(2*(last-first));
          A.prepareVoice(track,note,score.end,rate,local?.tail).write(buffer,first,last);
          voices.set(key,buffer,64+buffer.byteLength);
        }
        return buffer;
      }
      const block=sequence(keys,sources,()=>{
        const strip=A.scoreStrip(score,lane,rate), out=[0,0,0,0];
        return {restore:strip.restore,block(index,save) {
          const from=index*blockFrames, to=Math.min(plan.frames,from+blockFrames), n=to-from;
          const dry=new Float32Array(n*2);
          const roomLevel=strip.roomAutomation ? new Float32Array(n) : null;
          const echoLevel=strip.echoAutomation ? new Float32Array(n) : null;
          for (const voice of blocks[index]) {
            const buffer=readVoice(voice);
            const start=Math.max(from,voice.first), stop=Math.min(to,voice.last);
            for (let at=start;at<stop;at++) {
              const local=(at-from)*2, inVoice=(at-voice.first)*2;
              dry[local]+=buffer[inVoice]; dry[local+1]+=buffer[inVoice+1];
            }
          }
          for (let i=0;i<n;i++) {
            const at=from+i;
            strip.tick(dry[i*2],dry[i*2+1],at,out);
            const gain=fade ? Math.max(0,Math.min(1,(score.end-at/rate)/fade)) : 1;
            dry[i*2]=out[0]*gain; dry[i*2+1]=out[1]*gain;
            if (roomLevel) roomLevel[i]=out[2];
            if (echoLevel) echoLevel[i]=out[3];
          }
          return {dry,roomLevel,echoLevel,state:save ? strip.snapshot() : undefined};
        }};
      });
      return {keys,block,send,echo,roomSpec:room,roomCuts:score.cue?.roomCuts,trackCuts:local?.cuts};
    }

    function audioSource(plan,row,prepared) {
      const {signature}=S.musicSessionModel;
      const key=identify(signature([plan.rate,plan.frames,plan.map,row]));
      return {keys:null,key,block(index) {
        const from=index*blockFrames, to=Math.min(plan.frames,from+blockFrames);
        const id=identify('audio/'+key+'/'+index);
        const prior=sources.get(id);
        if (prior) return prior;
        const dry=new Float32Array(2*(to-from));
        prepared(dry,from,to);
        const value={dry};
        sources.set(id,value,64+dry.byteLength);
        return value;
      }};
    }

    return {identify,scoreSource,audioSource,takes,mixes,peaks,sequence};
  }
  S.sessionBlocks={createBlocks,blockFrames};
})(KIT.procedural);
