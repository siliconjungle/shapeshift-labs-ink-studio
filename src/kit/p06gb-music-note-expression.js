/* Per-voice automation on the performed gate, with integrated pitch travel. */
(function (P) {
  const {fields,finite,check}=P.musicInstruments;
  const controls=Object.freeze({pressure:.5,breath:0,damping:.25,contact:.5});
  const names=Object.keys(controls);
  const limits={gainDb:[-60,12],pitchCents:[-1200,1200],cutoffHz:[40,24000],amplitude:[0,1],roughness:[0,1],brightness:[0,1],
    ...Object.fromEntries(names.map(name=>[name,[0,1]]))};

  function validate(raw) {
    check(fields(raw,Object.keys(limits)) && Object.keys(raw).length>0,'Use named per-note expression curves');
    return Object.fromEntries(Object.entries(raw).map(([name,points])=>{
      let prior=-1;
      check(Array.isArray(points) && points.length>=1 && points.length<=32,'Note curves need up to 32 points');
      return [name,Array.from(points,row=>{
        check(Array.isArray(row) && row.length===2 && finite(row[0],0,1) && row[0]>prior &&
          finite(row[1],...limits[name]),'Invalid note curve point on '+name);
        prior=row[0];
        return row.slice();
      })];
    }));
  }

  function curve(raw,gate,convert) {
    const points=raw.map(([time,value])=>[time*gate,convert(value)]);
    if (points[0][0]>0) points.unshift([0,points[0][1]]);
    let area=0;
    for (let i=0;i<points.length;i++) {
      const row=points[i], before=points[i-1];
      if (before) area+=(row[0]-before[0])*(row[1]+before[1])/2;
      row.push(area);
    }
    function value(time,integral) {
      let index=1;
      while (index<points.length && points[index][0]<=time) index++;
      const [start,first,sum]=points[index-1], stop=points[index], offset=Math.max(0,time-start);
      const current=stop ? first+(stop[1]-first)*offset/(stop[0]-start) : first;
      return integral ? sum+offset*(first+current)/2 : current;
    }
    return {value,max:Math.max(...points.map(row=>row[1]))};
  }
  function performedPitch(raw) {
    // Integrate an exponential in each cents-linear segment. Inserting a
    // comp boundary on the same slope preserves the oscillator's phase.
    const ratio=cents=>2**(cents/1200), slope=Math.LN2/1200;
    const clamp=value=>Math.max(-1200,Math.min(1200,value));
    const points=[];
    for (const [i,[at,cents]] of raw.entries()) {
      const before=raw[i-1];
      if (before) {
        const [time,value]=before;
        for (const bound of (cents<value ? [1200,-1200] : [-1200,1200])) {
          if (bound>Math.min(cents,value) && bound<Math.max(cents,value))
            points.push([time+(at-time)*(bound-value)/(cents-value),bound]);
        }
      }
      points.push([at,clamp(cents)]);
    }
    const measure=(row,time)=>row[1]*(Math.abs(row[2])<1e-12 ? time : Math.expm1(row[2]*time)/row[2]);
    let sum=0;
    const parts=points.map(([at,cents],i)=>{
      const next=points[i+1];
      const row=[at,ratio(cents),next ? slope*(next[1]-cents)/(next[0]-at) : 0,sum];
      if (next) sum+=measure(row,next[0]-at);
      return row;
    });
    return {max:Math.max(...parts.map(row=>row[1])),value(time,integral) {
      let low=0,high=parts.length;
      while (high-low>1) {
        const mid=(low+high)>>>1;
        if (parts[mid][0]<=time) low=mid; else high=mid;
      }
      const row=parts[low], elapsed=Math.max(0,time-row[0]);
      return integral ? row[3]+measure(row,elapsed) : row[1]*Math.exp(row[2]*elapsed);
    }};
  }

  function compile(raw,gate,rate,phrase,offset=0) {
    if (!raw && !phrase) return null;
    const note=raw ?? {}, lanes=phrase?.lanes ?? {};
    const control=(name,convert=n=>n)=>{
      const authored=note[name] && curve(note[name],gate,convert);
      const performed=lanes[name] && curve(lanes[name],1,convert);
      return performed ? t=>performed.value(t+offset) : authored && (t=>authored.value(t));
    };
    const ratio=n=>2**(n/1200);
    let pitch=note.pitchCents && curve(note.pitchCents,gate,ratio);
    if (lanes.pitchCents) {
      const base=note.pitchCents && curve(note.pitchCents,gate,n=>n);
      const other=curve(lanes.pitchCents,1,n=>n);
      const times=[...new Set([0,...(note.pitchCents ?? []).map(([at])=>at*gate),
        ...lanes.pitchCents.map(([at])=>at-offset).filter(at=>at>0)])].sort((a,b)=>a-b);
      pitch=performedPitch(times.map(at=>[at,(base?.value(at) ?? 0)+other.value(at+offset)]));
    }
    const amp=note.gainDb && curve(note.gainDb,gate,n=>n);
    const performedAmp=lanes.gainDb && curve(lanes.gainDb,1,n=>n);
    const amplitude=note.amplitude && curve(note.amplitude,gate,n=>n);
    const performedAmplitude=lanes.amplitude && curve(lanes.amplitude,1,n=>n);
    const roughness=control('roughness');
    const filter=control('cutoffHz',n=>Math.log(Math.min(n,rate*.47)));
    const motion=Object.fromEntries(names.filter(name=>note[name] || lanes[name]).map(name=>[name,control(name)]));
    return {controls:motion,gain:(amp || amplitude || performedAmp || performedAmplitude) && (t=>
      (amplitude?.value(t) ?? 1)*(performedAmplitude?.value(t+offset) ?? 1)*
      10**(((amp?.value(t) ?? 0)+(performedAmp?.value(t+offset) ?? 0))/20)),
      roughness,
      pitchTime:pitch && (t=>pitch.value(t,true)),
      pitchRatio:pitch && (t=>pitch.value(t)),
      pitchMax:pitch?.max ?? 1,
      filter:filter && (t=>1-Math.exp(-2*Math.PI*Math.exp(filter(t))/rate))};
  }
  function duration(travel,span) {
    if (!travel || span===0) return span;
    let lo=0,hi=span*2;
    for (let i=0;i<38;i++) {
      const middle=(lo+hi)*.5;
      if (travel(middle)<span) lo=middle;
      else hi=middle;
    }
    return (lo+hi)*.5;
  }
  P.musicNoteExpression=Object.freeze({validate,compile,duration,controls,names});
})(KIT.procedural);
