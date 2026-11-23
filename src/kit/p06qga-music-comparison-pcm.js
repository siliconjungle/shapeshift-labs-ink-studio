/* Print the same PCM sources without the live page or voice limits. */
(function (P) {
  const {check,finite}=P.musicInstruments;
  const sample=P.adaptiveRehearsalEvidence.sample;

  async function mix(value,scheduled,options,settings,gain,events) {
    const {sampleRate,samples}=value, frames=samples.length/2;
    const pcm=P.musicLiveStreams.open(sampleRate,options.streams,options.readPage,options.pageSize,options.maxPages);
    const groups=pcm.stemGroups(options.stemGroups);
    const cues=scheduled.cueDecisions.filter(row=>row.status==='played' && pcm.streams.has(row.resource));
    const evidence=new Map();
    if (!cues.length && !groups.length) return evidence;
    const room=P.musicProduction.makeSessionRoom(
      scheduled.performerSpec?.room ?? scheduled.compiled[scheduled.segments[settings.entry].source].room,sampleRate);
    const send=new Float32Array(samples.length), fade=Math.max(1,Math.round(sampleRate*.004));
    const buffers=new Map();
    let allocated=0, work=0;
    async function read(source,from,count) {
      const key=source.name+'/'+from, cached=buffers.get(key);
      if (cached?.length>=count*source.channels) return cached;
      check((allocated+=count*source.channels)<=16e6,'Audio comparison exceeds its offline PCM cache budget');
      const result=new Float32Array(count*source.channels);
      for (let at=0;at<count;at+=16384) {
        const n=Math.min(16384,count-at), page=await options.readPage(source.name,from+at,n);
        check(page instanceof Float32Array && page.length===n*source.channels && page.every(Number.isFinite),
          'Offline PCM reader returned an invalid page for '+source.name);
        result.set(page,at*source.channels);
      }
      buffers.set(key,result);
      return result;
    }
    function add(at,local,source,data,gain) {
      const index=at*2, input=local*source.channels;
      const left=data[input]*source.left*gain, right=data[input+source.channels-1]*source.right*gain;
      samples[index]+=left; samples[index+1]+=right;
      send[index]+=left*source.send; send[index+1]+=right*source.send;
    }
    for (const row of cues) {
      const source=pcm.streams.get(row.resource), first=sample(row.time,sampleRate);
      const strength=events[row.eventIndex].intent.data?.strength;
      const level=finite(strength,0,1) ? strength : 1, count=Math.min(frames-first,source.frames);
      if (!level || count<=0) {
        evidence.set(row.eventIndex,{status:level ? 'outside-window' : 'silent'});
        continue;
      }
      check((work+=count)<=48e6,'Audio comparison exceeds its offline PCM mixing budget');
      const data=await read(source,0,count);
      for (let i=0;i<count;i++) add(first+i,i,source,data,level*Math.min(1,(i+1)/fade,(source.frames-i)/fade));
      evidence.set(row.eventIndex,{status:'played',sample:first,variants:[{resource:source.name,segment:null,
        source:null,assets:[source.name],sample:first}]});
    }
    for (const group of groups) for (const {part,source,start} of group.parts) {
      check((work+=frames)<=48e6,'Audio comparison exceeds its offline PCM mixing budget');
      const data=await read(source,start,group.frames), atGain=gain.read(part);
      for (let i=0;i<frames;i++) add(i,group.position(i),source,data,atGain?.(i) ?? 1);
    }
    for (let i=0;i<samples.length;i+=2) {
      const wet=room(send[i],send[i+1],false);
      samples[i]+=wet[0]; samples[i+1]+=wet[1];
    }
    return evidence;
  }

  P.musicComparisonPCM=Object.freeze({mix});
})(KIT.procedural);
