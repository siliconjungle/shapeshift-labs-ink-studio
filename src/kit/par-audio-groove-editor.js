/* Place measured, addressed groove edits into ordinary production and session recipes. */
(function (P) {
  const A=P.musicProduction,S=P.mediaGraphSupport,I=P.musicInstruments,T=P.musicTimingEdits;
  const {check,fields,finite,integer,id}=I,{clone}=P.data;
  const reference='reference', eps=1e-8, round=(n,d=6)=>Number(n.toFixed(d));
  const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
  const ms=(frames,rate)=>round(frames*1000/rate,3);
  const point=samples=>({samples});
  const frame=(note,rate)=>Math.ceil((note.start ?? note.time)*rate-1e-7);
  const group=row=>JSON.stringify([row.take,row.part,T.key(row.at)]);
  const signature=row=>group(row)+':'+(row.retrigger ?? 0);
  const format='ink-studio/groove-timing';

  function pairs(rows,pair,rate) {
    if (!pair) return [];
    function first(track) {
      const hits=new Map();
      for (const row of rows.filter(row=>row.part===track && !row.retrigger)) {
        const existing=hits.get(row.beat);
        if (!existing || row.weight>existing.weight ||
          row.weight===existing.weight && row.triggerSample<existing.triggerSample) hits.set(row.beat,row);
      }
      return [...hits.values()].sort((a,b)=>a.beat-b.beat);
    }
    const anchors=first(pair.anchor), used=new Set();
    let lo=0;
    return first(pair.track).flatMap(target=>{
      while (lo<anchors.length && anchors[lo].beat<target.beat-pair.within-eps) lo++;
      let anchor, error=Infinity;
      for (let n=lo;n<anchors.length && anchors[n].beat<=target.beat+pair.within+eps;n++) {
        const distance=Math.abs(anchors[n].beat-target.beat);
        if (!used.has(anchors[n]) && distance<error) {anchor=anchors[n];error=distance;}
      }
      if (!anchor) return [];
      used.add(anchor);
      return [{anchor,target,writtenGapMs:ms(target.gridSample-anchor.gridSample,rate),
        triggerGapMs:ms(target.triggerSample-anchor.triggerSample,rate),
        audibleGapMs:anchor.inputMuted || target.inputMuted || anchor.audibleSample===null || target.audibleSample===null ? null :
          ms(target.audibleSample-anchor.audibleSample,rate)}];
    });
  }

  function open(input,assets={}) {
    const native=input.format==='ink-studio/music-edit-session';
    const studio=native ? P.mediaGraph.musicSession.create(assets) : null;
    function read(doc,raw) {
      check(fields(raw,['range','tracks','pair','sampleRate','searchMs','take']) &&
        finite(raw.searchMs ?? 160,30,300) && (raw.take===undefined || native && id(raw.take)),
      'Choose a groove range, score tracks, and optional session take or attack window');
      const plan=native ? S.musicSessionModel.compile(doc,assets) : null;
      const producers=plan?.producers ?? new Map([[reference,{source:doc,score:A.compile(doc,assets)}]]);
      const base=producers.get(reference).score;
      check(!raw.take || producers.has(raw.take),'Unknown score take '+raw.take);
      const rate=native ? doc.sampleRate : raw.sampleRate ?? 32000, searchMs=raw.searchMs ?? 160;
      check(integer(rate,8000,96000) && (!native || raw.sampleRate===undefined || raw.sampleRate===rate),
        'Use the native session sample rate or a production rate from 8 to 96 kHz');
      const time=S.mixerTime(rate,base.arrangement.score.tempoMap), bound=base.arrangement.sections.at(-1).end;
      const address=value=>time.position(typeof value==='number' ? {beat:value} : value);
      const range=raw.range ?? {from:0,to:bound};
      check(fields(range,['from','to']) && range.from!==undefined && range.to!==undefined,
        'Give the phrase range a start and end');
      const from=time.frame(address(range.from)),to=time.frame(address(range.to)), end=time.frame(address(bound));
      check(integer(from,0,end-1) && integer(to,from+1,end),'Choose a phrase inside the score');
      const beatOf=value=>base.clock.sample(P.takeTime.seconds(address(value))).beat;
      const beats=[beatOf(range.from),beatOf(range.to)];
      const pair=raw.pair;
      check(pair===undefined || fields(pair,['anchor','track','within']) && pair.anchor!==pair.track &&
        [pair.anchor,pair.track].every(name=>Object.hasOwn(base.tracks,name)) && finite(pair.within ?? .0625,0,.5),
      'Pair two distinct tracks with a written-beat match tolerance');
      const tracks=raw.tracks ?? (pair ? [pair.anchor,pair.track] : Object.keys(base.tracks));
      check(Array.isArray(tracks) && tracks.length>0 && new Set(tracks).size===tracks.length &&
        tracks.every(name=>Object.hasOwn(base.tracks,name)) && (!pair || tracks.includes(pair.anchor) && tracks.includes(pair.track)),
      'Choose score tracks including both tracks in the pair');
      const selection=Object.fromEntries(tracks.map(name=>[name,plan?.choices.filter(row=>row.lane===name) ?? []]));
      function weight(track,take,sample) {
        if (raw.take) return Number(take===raw.take);
        const booking=selection[track].find(row=>row.from<=sample && sample<row.to);
        if (!booking || booking.take===reference) return Number(take===reference);
        const amount=booking.fadeSamples ? Math.min(1,(sample-booking.from)/booking.fadeSamples,
          (booking.to-1-sample)/booking.fadeSamples) : 1;
        return take===reference ? 1-amount : take===booking.take ? amount : 0;
      }
      const privateRows=new Map(), events=[];
      let work=0;
      for (const [take,{source,score}] of producers) for (const part of tracks) {
        if (raw.take && take!==raw.take) continue;
        const rows=selection[part], input=plan?.mixer.strips[part].inputGain;
        const inlet=time.lane(input,1,0,1,'mixer input gain');
        let prior=-1, inletAt=inlet.reader();
        if (!raw.take && take!==reference && !rows.some(row=>row.take===take &&
          row.from<to+rate && row.to>from-rate)) continue;
        for (const note of score.events[part]) {
          if (note.velocity<=0 || note.beat<beats[0]-eps || note.beat>=beats[1]-eps) continue;
          const trigger=frame(note,rate);
          if (!weight(part,take,trigger) && !weight(part,take,trigger+Math.ceil(rate*searchMs/1000)) &&
            !rows.some(row=>row.from>=trigger && row.from<trigger+rate*searchMs/1000) &&
            !rows.some(row=>row.to>=trigger && row.to<trigger+rate*searchMs/1000)) continue;
          check((work+=Math.ceil(rate*searchMs/1000))<=25e6,'Select a shorter phrase for attack measurement');
          const measured=P.musicCritiqueDiagnosis.describeAttack(score,part,note,rate,searchMs);
          const attack=measured.info.audibleSample ?? trigger;
          const level=weight(part,take,attack);
          if (!level) continue;
          if (attack<prior) inletAt=inlet.reader();
          prior=attack;
          const event={...measured.info,take,weight:round(level),at:T.address(note),midi:note.midi,
            ...(inletAt(attack)===0 && {inputMuted:true}),
            playedSample:Math.round(note.time*rate),...(note.played && {performedClip:true}),
            ...(note.retrigger && {retrigger:note.retrigger}),sampleOffsetMs:round((note.play.offset ?? 0)*1000,3),
            ...(note.play.articulation && {articulation:note.play.articulation})};
          events.push(event);
          const key=signature(event);
          if (!privateRows.has(key)) privateRows.set(key,{source,score,note,measured:{info:measured.info,hit:measured.hit}});
        }
      }
      events.sort((a,b)=>a.beat-b.beat || tracks.indexOf(a.part)-tracks.indexOf(b.part) ||
        a.triggerSample-b.triggerSample || a.midi-b.midi);
      const report={format,version:1,sampleRate:rate,range:{from,to,fromBeat:round(beats[0],9),toBeat:round(beats[1],9)},
        estimator:{windowMs:searchMs,blockMs:2,relativeThreshold:.10,stage:'isolated voice before the mixer'},
        tracks,take:raw.take ?? (native ? 'saved comp' : reference),events,
        pairs:pairs(events,pair && {...pair,within:pair.within ?? .0625},rate)};
      return {report,privateRows,weight,plan,producers};
    }

    function edit(raw) {
      const {edits,...focus}=raw;
      check(Array.isArray(edits) && integer(edits.length,1,16),'Give the groove editor one to sixteen operations');
      const value=clone(input), original=read(value,focus), operations=[], locks=new WeakMap();
      let present=original;
      for (const op of edits) {
        const {report,privateRows,plan,weight}=present, rate=report.sampleRate;
        const changes=new Map(), entries=[];
        const blocked=entry=>{
          const {score}=privateRows.get(signature(entry));
          if (!locks.has(score)) locks.set(score,P.musicComposer.locks(score.arrangement));
          return plan?.pins[entry.part]==='all' || Object.hasOwn(locks.get(score),entry.part) ?
            'Pinned track' : entry.weight<1 ? 'Attack is inside a comp fade' : null;
        };
        function set(entry,field,value) {
          const token=JSON.stringify([entry.take,entry.part]), stored=changes.get(token);
          const {score}=privateRows.get(signature(entry));
          const edits=stored?.edits ?? new Map(score.tracks[entry.part].timingEdits);
          const key=T.key(entry.at);
          const old=edits.get(key) ?? {at:entry.at};
          edits.set(key,{...old,[field]:value});
          if (!stored) changes.set(token,{track:entry.part,take:entry.take,edits});
        }
        if (op?.op==='trim') {
          const keep=op.keepMs ?? 3;
          check(fields(op,['op','track','keepMs','at']) && report.tracks.includes(op.track) && finite(keep,0,30),
            'Choose a track, optional note address and remaining attack lead-in in milliseconds');
          const key=op.at && [...T.compile([{at:op.at,offset:0}]).keys()][0];
          const hits=report.events.filter(row=>row.part===op.track && !row.retrigger && (!key || T.key(row.at)===key));
          check(hits.length,'No attacks on the trim track in this phrase');
          const seen=new Set();
          for (const entry of hits) {
            const identity=group(entry);
            if (seen.has(identity)) continue;
            seen.add(identity);
            const {score,source,note,measured}=privateRows.get(signature(entry));
            let reason=blocked(entry);
            if (!reason && !I.sampleZones(source.patches[source.tracks[entry.part].patch]).length) reason='The voice has no sample start';
            const trim=reason ? null : P.musicCritiqueDiagnosis.trimAttack(score,entry.part,note,rate,report.estimator.windowMs,measured,keep);
            if (trim && weight(entry.part,entry.take,entry.triggerSample+Math.round(trim.latency*rate/1000))<1)
              reason='Trim would cross a comp edit';
            if (trim && !reason) set(entry,'offset',trim.offset);
            entries.push({before:entry,...(trim && !reason ? {offsetMs:round(trim.offset*1000,3)} :
              {reason:reason ?? 'No earlier attack retained enough energy'})});
          }
        } else {
          check(fields(op,['op','targetMs','metric']) && op.op==='gap' && focus.pair &&
            ['trigger','audible'].includes(op.metric ?? 'audible'),'A gap edit needs a kick/target pair and an audible or trigger metric');
          const targets=op.targetMs, metric=op.metric ?? 'audible';
          check(finite(targets,-150,150) || Array.isArray(targets) && integer(targets.length,1,64) &&
            targets.every((k,i)=>Array.isArray(k) && k.length===2 && finite(k[0],0,65536) &&
              finite(k[1],-150,150) && (!i || k[0]>targets[i-1][0])),
          'Give the target gap in milliseconds or ordered [beat, milliseconds] knots');
          function goal(beat) {
            if (!Array.isArray(targets)) return targets;
            const index=targets.findIndex(point=>point[0]>beat);
            const a=index<0 ? targets.at(-1) : targets[Math.max(0,index-1)], b=targets[index];
            return index<=0 ? a[1] : a[1]+(b[1]-a[1])*(beat-a[0])/(b[0]-a[0]);
          }
          check(report.pairs.length,'No written attacks matched within this phrase and tolerance');
          for (const pair of report.pairs) {
            const entry=pair.target, targetMs=round(goal(entry.beat),3), actual=pair[metric+'GapMs'];
            const {score,source}=privateRows.get(signature(entry));
            const notes=report.events.filter(row=>row.part===entry.part && row.take===entry.take &&
              row.beat===entry.beat && !row.retrigger);
            let reason=notes.map(blocked).find(Boolean) ?? (pair.anchor.weight<1 ? 'Anchor is inside a comp fade' : null);
            if (!reason && source.grooveMap?.anchors?.some(beat=>Math.abs(beat-entry.beat)<eps)) reason='Written timing anchor';
            if (!reason && actual===null) reason='There is no measured audible attack';
            if (!reason && Math.abs(targetMs-actual)>=500/rate) {
              const shift=(targetMs-actual)/1000;
              for (const note of notes) {
                const from=note.audibleSample ?? note.triggerSample;
                if (weight(note.part,note.take,Math.round(from+shift*rate))<1) {reason='Shift would cross a comp edit';break;}
              }
              if (!reason) for (const note of notes) {
                const prior=score.tracks[note.part].timingEdits.get(T.key(note.at))?.delay ?? 0;
                set(note,'delay',round(clamp(prior+shift,-.25,.25),9));
              }
            }
            entries.push({before:entry,anchor:pair.anchor,targetMs,metric,...(reason && {reason})});
          }
        }
        for (const {track,take,edits} of changes.values()) {
          const production=native ? take===reference ? value.production : value.takes[take] : value;
          production.tracks ??= {};
          production.tracks[track]={...production.tracks[track],timingEdits:[...edits.values()]};
        }
        if (changes.size) present=read(value,focus);
        const after=new Map(present.report.events.map(row=>[signature(row),row]));
        operations.push({op:op.op,entries:entries.map(entry=>{
          const next=after.get(signature(entry.before)) ?? null;
          const anchor=entry.anchor && after.get(signature(entry.anchor)), unit=entry.metric==='audible' ? 'audibleSample' : 'triggerSample';
          const gap=!(entry.metric==='audible' && (next?.inputMuted || anchor?.inputMuted)) && next?.[unit]!=null && anchor?.[unit]!=null ? ms(next[unit]-anchor[unit],rate) : null;
          return {...entry,after:next,...(entry.metric && {gapMs:gap,errorMs:gap===null ? null : round(gap-entry.targetMs,3)})};
        })});
      }
      return {value,report:{before:original.report,after:present.report,operations}};
    }

    function audition(doc,report,take) {
      const {range:{from,to},sampleRate:rate,tracks}=report;
      if (!native) return A.render(doc,assets,{sampleRate:rate,start:{numerator:from,denominator:rate},
        end:{numerator:to,denominator:rate},tail:0}).value;
      const switches=take ? tracks.map(lane=>({lane,take,pass:0,at:point(from)})) : [];
      const printed=studio.render(doc,{from:point(from),to:point(to),switches});
      const {value,report:{mixer}}=printed, headroom=mixer.headroom ?? 1;
      return headroom===1 ? value : {...value,samples:value.samples.map(sample=>sample/headroom)};
    }
    return {inspect:raw=>read(input,raw ?? {}).report,edit,audition};
  }
  P.musicGrooveEditor=Object.freeze({open});
})(KIT.procedural);
