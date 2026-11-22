/* A written pad pattern can play notes, a sample kit and Foley on one clock. */
(function (P) {
  const M=P.mediaGraph,T=P.takeTime,H=P.musicHarmony;
  const {id,integer,fields,record,finite,check}=P.musicInstruments;
  const round=value=>Number(value.toFixed(9));
  const real=value=>T.seconds(T.read(value));
  const samples=value=>({samples:value});
  const seconds=(sample,rate)=>({numerator:sample,denominator:rate});
  const frame=(time,rate)=>Math.ceil(time*rate-1e-7);
  const bindings=(raw,max,label)=>{
    check(record(raw) && Object.keys(raw).length<=max && Object.keys(raw).every(id),'Invalid rhythm '+label+' routes');
    return Object.entries(raw);
  };
  function project(pattern,routes,settings={}) {
    check(fields(pattern,['id','length','seed','steps','fills']) && Array.isArray(pattern.steps) &&
      (pattern.fills===undefined || Array.isArray(pattern.fills)) &&
      fields(routes,['notes','pads','foley']) &&
      fields(settings,['startBeat','cycles','seed','fills','map','sampleRate','timing','scale','clipId','mode']),
    'Choose a written pad pattern, its routes and a playback clock');
    const {startBeat=0,cycles=1,seed,fills=[],map,sampleRate=48000,timing=1,scale={root:'C4',mode:'major'},
      clipId=pattern.id,mode}=settings;
    check(integer(sampleRate,8000,96000) && finite(timing,0,2) && fields(scale,['root','mode']),
      'Choose an audio rate, scale and timing amount between zero and two');
    const scaleRoot=H.midi(scale.root ?? 'C4'), steps=H.scaleSteps(scale.mode);
    const input=rows=>Array.from(rows,step=>({...step,...(step.offset!==undefined && {offset:round(real(step.offset)*timing)})}));
    const played={...pattern,steps:input(pattern.steps),...(pattern.fills && {fills:pattern.fills.map(fill=>{
      check(Array.isArray(fill?.steps),'An addressed fill needs steps');
      return {...fill,steps:input(fill.steps)};
    })})};
    const {events,report}=M.padPattern.perform(played,{startBeat,cycles,seed,fills,render:{sampleRate,...(map && {map})}});
    const clock=P.musicTiming.compile(map), origin=real(startBeat), length=round(real(pattern.length)*cycles);
    const trace=new Map(report.events.map(row=>[row.id,row]));
    const entries=events.map(event=>{
      check(id(event.pad),'Rhythm projection needs each step on a named logical pad');
      const beat=round(real(event.time.beat)), time=clock.timeAt(event.time);
      const sample=frame(time,sampleRate);
      return {event,beat,time,sample,gate:event.until && round(real(event.until.beat)-beat)};
    }).sort((a,b)=>a.beat-b.beat || a.event.id.localeCompare(b.event.id));
    const byPad=new Map();
    for (const row of entries) {
      if (!byPad.has(row.event.pad)) byPad.set(row.event.pad,[]);
      byPad.get(row.event.pad).push(row);
    }
    const authored=[...pattern.steps,...(pattern.fills ?? []).flatMap(fill=>fill.steps)];
    const order=new Map(authored.map((step,index)=>[step.id,index]));
    const logical=new Set(authored.map(step=>step.pad));
    check(logical.size>0 && [...logical].every(id),'Choose named logical pads for the rhythm');
    const hits=name=>{
      check(logical.has(name),'Unknown logical rhythm pad '+name);
      return byPad.get(name) ?? [];
    };
    function pitch(value) {
      if (!record(value)) return H.midi(value);
      check(fields(value,['degree']) && integer(value.degree,-35,36),'Use a MIDI pitch or a scale degree');
      const n=value.degree-1;
      return scaleRoot+steps[(n%steps.length+steps.length)%steps.length]+12*Math.floor(n/steps.length);
    }
    const voices=bindings(routes.notes ?? {},8,'note').map(([name,row])=>{
      check(fields(row,['from','pitches','transpose','play']) && Array.isArray(row.pitches) &&
        integer(row.pitches.length,1,64) && integer(row.transpose ?? 0,-48,48) &&
        (row.play===undefined || record(row.play)),'A note voice needs a logical pad and a pitch sequence');
      const pitches=Array.from(row.pitches,value=>H.midi(pitch(value)+(row.transpose ?? 0)));
      const list=hits(row.from);
      const writtenOrder=list.map(({event})=>trace.get(event.id)).sort((a,b)=>
        a.cycle-b.cycle || order.get(a.step)-order.get(b.step) || a.sub-b.sub);
      const pitchByHit=new Map(writtenOrder.map(({id},index)=>[id,pitches[index%pitches.length]]));
      const notes=list.map(({event,beat,sample,gate},index)=>{
        const local=round(beat-origin), next=list[index+1]?.beat ?? origin+length;
        const duration=round(Math.min(gate ?? .2,next-beat,origin+length-beat));
        check(duration>=1e-5,'Use distinct written attacks within each pitched rhythm voice');
        // Allow for decimal beat rounding while keeping the native attack on the shared sample.
        const delay=round((sample-.125)/sampleRate-clock.timeAt({beat}));
        return {id:event.id,beat:local,duration,midi:pitchByHit.get(event.id),velocity:event.velocity ?? .8,
          play:{...row.play,delay}};
      });
      return {id:name,notes};
    });
    const clip=voices.length ? P.musicNoteClips.clip({id:clipId,beat:origin,length,voices,...(mode && {mode})}) : undefined;
    const padRows=bindings(routes.pads ?? {},64,'pad').flatMap(([name,row])=>{
      check(fields(row,['pad','note','articulation','play']) && (row.pad!==undefined || row.note!==undefined),
        'A sampler route needs a destination pad or MIDI pitch');
      return hits(name).map(hit=>({...hit,route:row}));
    });
    const atSample=padRows.reduce((first,row)=>Math.min(first,row.sample),frame(clock.timeAt({beat:startBeat}),sampleRate));
    const performance=M.padPattern.validate({events:padRows.map(({route,event,sample})=>{
      const {pad,note,articulation,play}=route;
      const until=event.until && Math.max(sample+1,frame(clock.timeAt(event.until),sampleRate));
      return {id:event.id,time:seconds(sample-atSample,sampleRate),pad,note,velocity:event.velocity,
        articulation:event.articulation ?? articulation,play:{...play,...event.play},
        ...(until && {until:seconds(until-atSample,sampleRate)})};
    }).map(row=>Object.fromEntries(Object.entries(row).filter(([,value])=>value!==undefined))),options:{sampleRate}});
    const foley=bindings(routes.foley ?? {},64,'Foley').flatMap(([name,row])=>{
      check(fields(row,['track','take','takes','comp','fades','gain']) && id(row.take) &&
        record(row.takes) && Object.hasOwn(row.takes,row.take) && finite(row.gain ?? 1,0,4),
        'A Foley route needs an editorial take and source range');
      return hits(name).filter(({event})=>event.velocity!==0).map(({event,sample})=>
        ({...row,id:event.id,spot:samples(sample),gain:(row.gain ?? 1)*(event.velocity ?? .8)}));
    });
    check(foley.length<=512,'Projected Foley exceeds the editorial clip budget');
    return P.data.freeze(P.data.clone({...(clip && {clip}),pads:{at:samples(atSample),performance},foley:{clips:foley},
      report:{id:pattern.id,seed:report.seed,timing,scale:{root:scaleRoot,steps},
        hits:entries.map(({event,beat,sample,gate})=>({...trace.get(event.id),logicalPad:event.pad,beat,sample,
          offset:event.time.offset===undefined ? 0 : real(event.time.offset),
          ...(gate!==undefined && {gate}),velocity:event.velocity ?? .8}))}}));
  }

  M.rhythmProjection=Object.freeze({project});
})(KIT.procedural);
