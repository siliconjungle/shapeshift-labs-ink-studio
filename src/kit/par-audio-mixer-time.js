/* Project automation points onto the same sample grid as edited clips. */
(function (P) {
  const T=P.takeTime, {fields,integer,finite,check}=P.musicInstruments;
  const units=['beats','seconds','samples'], zero=T.read(0);
  function mixerTime(rate,map) {
    const clock=P.musicTiming.compile(map), sampleRate=T.read(rate);
    const frame=time=>T.index(T.roundDown(T.mul(time,sampleRate)));
    function seconds(raw) {
      const time=T.read(raw);
      check(finite(T.seconds(time),0,3600),'Mixer position is outside the seconds range');
      return time;
    }
    function samples(raw) {
      check(integer(raw,0,rate*3600),'Mixer position needs an integer sample address');
      return T.div(T.read(raw),sampleRate);
    }
    function position(raw) {
      if (P.musicTiming.isPosition(raw)) return clock.resolve(raw);
      check(fields(raw,['samples','seconds']) && Object.keys(raw).length===1,
        'A mixer position needs samples, seconds, or a musical address');
      return raw.samples===undefined ? seconds(raw.seconds) : samples(raw.samples);
    }
    function offset(origin,raw,count=1) {
      check(fields(raw,['beats','seconds','samples']) && Object.keys(raw).length===1,
        'A mixer duration needs beats, seconds or samples');
      const scale=T.read(count);
      if (raw.beats!==undefined) {
        const [numerator,denominator]=T.mul(T.read(raw.beats),scale);
        return clock.offsetBeats(origin,{numerator:T.index(numerator),denominator:T.index(denominator)});
      }
      return T.add(origin,T.mul(raw.seconds===undefined ? samples(raw.samples) : seconds(raw.seconds),scale));
    }
    function beatClock() {
      const keys=[...new Set([0,...(map?.changes ?? []).map(row=>row.beat)])];
      const segments=keys.map(beat=>{
        const {time,tempo,swing}=clock.forPosition({beat});
        return {beat,at:time*rate,length:60*rate/tempo,swing};
      });
      function segment(value,key) {
        let lo=1,hi=segments.length;
        while (lo<hi) {
          const mid=(lo+hi)>>>1;
          if (segments[mid][key]<=value) lo=mid+1;
          else hi=mid;
        }
        return segments[lo-1];
      }
      function sampleAt(beat) {
        const row=segment(beat,'beat'), whole=Math.floor(beat), frac=beat-whole;
        const played=frac<=.5 ? 2*frac*row.swing : row.swing+2*(frac-.5)*(1-row.swing);
        return row.at+(whole-row.beat+played)*row.length;
      }
      function beatAt(sample) {
        const row=segment(sample,'at'), steps=(sample-row.at)/row.length, whole=Math.floor(steps), frac=steps-whole;
        return row.beat+whole+(frac<=row.swing ? frac/(2*row.swing) : .5+(frac-row.swing)/(2*(1-row.swing)));
      }
      const stretched=Math.max(...segments.map(row=>2*row.length*Math.max(row.swing,1-row.swing)));
      return {beatAt,sampleAt,maxFrames:beats=>Math.ceil(beats*stretched)+2};
    }
    function lane(raw,fallback,low,high,label,origin) {
      if (raw===undefined || finite(raw,low,high)) {
        const value=raw ?? fallback;
        return {min:value,max:value,points:[{sample:0,value}],curve:'hold',reader:()=>()=>value};
      }
      check(fields(raw,['unit','curve','points']) && units.includes(raw.unit) &&
        ['linear','hold'].includes(raw.curve ?? 'linear') && Array.isArray(raw.points) &&
        integer(raw.points.length,1,2048),'Invalid '+label+' value or automation lane');
      const knots=[];
      let prior=null, min=Infinity, max=-Infinity;
      for (const knot of raw.points) {
        check(fields(knot,['at','value']) && finite(knot.value,low,high),'Invalid '+label+' automation point');
        const at=T.read(knot.at);
        check(T.compare(at,zero)>=0 && (!prior || T.compare(prior,at)<0),'Automation points need increasing nonnegative positions');
        const absolute=raw.unit==='beats' ?
          (origin ? clock.offsetBeats(origin,knot.at) : clock.resolve({beat:knot.at})) :
          T.add(origin ?? zero,raw.unit==='samples' ? samples(knot.at) : seconds(knot.at));
        const sample=frame(absolute), row={sample,value:knot.value};
        check(integer(sample,-rate*3600,rate*3600),'Automation sample position exceeds the mixer range');
        if (knots.at(-1)?.sample===sample) knots[knots.length-1]=row;
        else knots.push(row);
        min=Math.min(min,knot.value);
        max=Math.max(max,knot.value);
        prior=at;
      }
      return {min,max,automated:true,points:knots,curve:raw.curve ?? 'linear',reader() {
        let index=0;
        return sample=>{
          while (index+1<knots.length && knots[index+1].sample<=sample) index++;
          const a=knots[index], b=knots[index+1];
          if (raw.curve==='hold' || !b || sample<=a.sample) return a.value;
          return a.value+(b.value-a.value)*(sample-a.sample)/(b.sample-a.sample);
        };
      }};
    }
    return {frame,position,offset,beatClock,lane};
  }

  // Play score-time lanes against a monotonic sample clock. DSP state and
  // the beat history used by tempo delay stay continuous across score seeks.
  function mixerTransport(time,ranges) {
    const score=time.beatClock();
    let cursor=0, beat=0;
    const spans=ranges.map(({from,to})=>{
      const start=score.beatAt(from), row={cursor,beat,from,start};
      cursor+=to-from;
      beat+=score.beatAt(to)-start;
      return row;
    });
    const find=(key,value)=>{
      let lo=1,hi=spans.length;
      while (lo<hi) {
        const mid=(lo+hi)>>>1;
        if (spans[mid][key]<=value) lo=mid+1;
        else hi=mid;
      }
      return spans[lo-1];
    };
    return {...time,beatClock:()=>({
      beatAt(sample) {
        const row=find('cursor',sample);
        return row.beat+score.beatAt(row.from+sample-row.cursor)-row.start;
      },
      sampleAt(beat) {
        const row=find('beat',beat);
        return row.cursor+score.sampleAt(row.start+beat-row.beat)-row.from;
      },
      maxFrames:score.maxFrames
    }),lane(raw,fallback,low,high,label,origin) {
      const lane=time.lane(raw,fallback,low,high,label,origin);
      if (!fields(raw,['unit','curve','points']) || origin!==undefined) return lane;
      return {...lane,reader() {
        let span, read;
        return sample=>{
          const current=find('cursor',sample);
          if (current!==span) {span=current; read=lane.reader();}
          return read(span.from+sample-span.cursor);
        };
      }};
    }};
  }
  Object.assign(P.mediaGraphSupport,{mixerTime,mixerTransport});
})(KIT.procedural);
