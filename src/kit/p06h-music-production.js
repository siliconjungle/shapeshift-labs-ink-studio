/* An arranged cue with independent performance, instrumentation and mix. */
(function (P) {
  const C=P.musicComposer, H=P.musicHarmony, T=P.takeTime, I=P.musicInstruments;
  const {record,fields,finite,integer,id,check,clamp,db,hash}=I;
  const epsilon=1e-8;
  const number=(raw,key,fallback,low,high)=>{
    const value=raw[key] ?? fallback;
    check(finite(value,low,high),'Invalid production '+key);
    return value;
  };
  const round=value=>Number(value.toFixed(9));
  const json=value=>JSON.parse(JSON.stringify(value));
  const pc=value=>((value%12)+12)%12;
  function table(raw,max,label) {
    check(record(raw) && Object.keys(raw).length<=max && Object.keys(raw).every(id),'Invalid '+label+' table');
    return Object.entries(raw);
  }
  function groove(raw={}) {
    check(fields(raw,['step','timing','accents','offset']),'Invalid groove profile');
    const step=number(raw,'step',.25,.0625,4), offset=number(raw,'offset',0,-.1,.1);
    const {timing=[0],accents=[1]}=raw;
    check(Array.isArray(timing) && Array.isArray(accents) && [timing,accents].every(row=>row.length>=1 && row.length<=128) &&
      Array.from(timing).every(v=>finite(v,-.05,.05)) && Array.from(accents).every(v=>finite(v,0,2)),
      'Groove profiles need bounded timing and accent tables');
    return {step,timing:timing.slice(),accents:accents.slice(),offset};
  }
  function grooveAt(profile,beat) {
    const step=Math.floor((beat+epsilon)/profile.step);
    return {delay:profile.offset+profile.timing[step%profile.timing.length],
      accent:profile.accents[step%profile.accents.length]};
  }

  function pad(raw,sections) {
    check(fields(raw,['voices','low','high','anchor','spread','tie','rhythm','brightness',...(sections ? ['sections'] : [])]),
      'Invalid pad voicing');
    const {voices=3,low='A3',high='E5',anchor='C5',tie=true,rhythm}=raw;
    const min=H.midi(low), max=H.midi(high), top=H.midi(anchor);
    check(integer(voices,1,5) && max>=min && max-min<=48 && top>=min && top<=max &&
      typeof tie==='boolean' && (rhythm===undefined || fields(rhythm,['every','length','offset','velocity'])), 'Invalid pad register or rhythm');
    const spread=number(raw,'spread',0,0,.2);
    const pattern=rhythm && {every:number(rhythm,'every',2,.125,64),length:number(rhythm,'length',1.5,.05,64),
      offset:number(rhythm,'offset',0,0,64),velocity:number(rhythm,'velocity',.72,0,1)};
    check(!pattern || pattern.offset<pattern.every && pattern.length<=pattern.every,'Pad rhythm needs bounded pulses');
    const brightness=raw.brightness===undefined ? undefined : number(raw,'brightness',.5,0,1);
    const base={voices,min,max,top,spread,tie,pattern,brightness};
    if (!sections) return base;
    const {sections:overrides={},...defaults}=raw;
    return {...base,sections:Object.fromEntries(table(overrides,64,'pad section').map(([name,value])=>{
      check(sections.some(section=>section.id===name) && record(value),'Unknown pad section');
      return [name,pad({...defaults,...value})];
    }))};
  }

  function eventAt(events,time) {
    let hi=events.length, lo=0;
    while(lo<hi) {
      const mid=(lo+hi)>>>1;
      if (events[mid].time<=time+epsilon) lo=mid+1;
      else hi=mid;
    }
    return events[lo-1];
  }
  function voiceChord(config,spec,previous) {
    if (!spec) return previous;
    const {root,notes}=spec;
    const rootMidi=H.midi(root);
    const classes=[...new Set(notes.map(pc))];
    const candidates=[];
    for (let bottom=config.min;bottom<=config.max;bottom++) {
      if (!classes.includes(pc(bottom))) continue;
      const row=[bottom];
      for (let pitch=bottom+1;pitch<=config.max && row.length<config.voices;pitch++)
        if (classes.includes(pc(pitch))) row.push(pitch);
      if (row.length===config.voices) candidates.push(row);
    }
    check(candidates.length,'Pad register cannot fit its chord voicing');
    const cost=row=>Math.abs(row.at(-1)-config.top)*.65+
      (previous ? row.reduce((sum,n,i)=>sum+Math.abs(n-previous[i]),0)*.9 : 0)+
      (row.includes(rootMidi) || row.some(n=>pc(n)===pc(rootMidi)) ? 0 : 2.2);
    candidates.sort((a,b)=>cost(a)-cost(b));
    return candidates[0];
  }

  function scoreRows(plan,program,clock,name,voicing) {
    const part=plan.parts[name];
    const tag=new Map(plan.cues.filter(row=>row.part===name).map(row=>[row.beat,row]));
    let rows=part.voice.sequence.flatMap(note=>{
      const start=clock.timeAt({beat:note.beat}), end=clock.timeAt({beat:round(note.beat+note.duration)});
      const positions=note.offset===undefined && note.midi===undefined && !voicing ?
        [start,...program.events.filter(row=>row.time>start+epsilon && row.time<end-epsilon).map(row=>row.time),end] : [start,end];
      return positions.slice(0,-1).map((time,index)=>({beat:clock.sample(time).beat,time,end:positions[index+1],
        velocity:note.level ?? 1,play:tag.get(note.beat)?.play ?? {},...program.pitch(name,time)}));
    });
    if (!voicing) return rows;
    if (voicing.pattern || Object.values(voicing.sections).some(value=>value.pattern)) {
      const patterns=plan.sections.filter(section=>(voicing.sections[section.id] ?? voicing).pattern);
      rows=rows.flatMap(row=>{
        const kept=[];
        let at=row.time;
        for (const section of patterns) {
          if (section.endTime<=at || section.time>=row.end) continue;
          if (section.time>at) kept.push({...row,time:at,end:section.time});
          at=section.endTime;
        }
        if (at<row.end) kept.push({...row,time:at});
        return kept;
      });
      rows.push(...patterns.flatMap(section=>{
        if (!plan.materials[name].some(row=>row.section===section.id && (row.value || row.sustain))) return [];
        const {every,length,offset,velocity}=(voicing.sections[section.id] ?? voicing).pattern;
        const pulses=Math.max(0,Math.ceil((section.end-section.beat-offset)/every));
        check(pulses<=4096,'Pad pulses exceed their event budget');
        return Array.from({length:pulses},(_,index)=>{
          const beat=round(section.beat+offset+index*every);
          return {beat,time:clock.timeAt({beat}),end:clock.timeAt({beat:round(Math.min(beat+length,section.end))}),
            velocity,play:{}};
        });
      }));
      rows.sort((a,b)=>a.time-b.time);
    }
    const maxVoices=Math.max(voicing.voices,...Object.values(voicing.sections).map(value=>value.voices));
    check(rows.length*maxVoices<=16384,'Pad voicing exceeds its event budget');
    const result=[], active=[];
    let previous;
    const boundaries=[...new Set([...program.events.map(change=>change.time),...plan.sections.map(s=>s.time)])]
      .sort((a,b)=>a-b);
    for (const row of rows) {
      const changes=boundaries.filter(time=>time>row.time+epsilon && time<row.end-epsilon);
      const cues=[row.time,...changes,row.end];
      for (let index=0;index<cues.length-1;index++) {
        const at=cues[index], end=cues[index+1], harmony=eventAt(program.events,at);
        if (!harmony) continue;
        const section=plan.sections.findLast(section=>section.time<=at+epsilon);
        const settings=voicing.sections[section?.id] ?? voicing;
        const spec=plan.score.harmonies[harmony.harmony];
        const notes=spec.notes ? spec.notes.filter(note=>note!==null).map(H.midi) :
          H.chord(harmony.root,harmony.quality,spec.inversion);
        const pitches=voiceChord(settings,{root:harmony.root,notes:notes.length?notes:[H.midi(harmony.root)]},
          settings.voices===previous?.length ? previous : null);
        for (const [voice,midi] of pitches.entries()) {
          const last=active[voice];
          if (settings.tie && last?.midi===midi && Math.abs(last.end-at)<epsilon) {
            last.end=end;
            continue;
          }
          const time=at+settings.spread*voice;
          if (time>=end) continue;
          const play=settings.brightness===undefined ? row.play : {brightness:settings.brightness,...row.play};
          const entry={...row,time,end,midi,play,frequency:program.chordPitch(midi,at),
            beat:clock.sample(at).beat,voice};
          active[voice]=entry;
          result.push(entry);
        }
        previous=pitches;
      }
    }
    return result;
  }

  function compile(source,assets={}) {
    check(fields(source,['arrangement','patches','tracks','room','gain','seed']) &&
      Number.isSafeInteger(source.seed ?? 0), 'A production needs an arrangement, patches and tracks');
    const plan=source.arrangement?.format==='ink-studio/phrase-arrangement' ?
      C.compose(source.arrangement.definition) : C.compose(source.arrangement);
    const program=P.musicScore.compile(plan.score), clock=P.musicTiming.compile(plan.score.tempoMap);
    const assetMap=Object.fromEntries(table(assets,128,'instrument asset').map(([name,asset])=>{
      const audio=P.mediaGraph.audio(asset);
      check(audio.channels<=2 && audio.samples.length>0 && audio.samples.length/audio.channels/audio.sampleRate<=60,
        'Sample assets need up to two channels and sixty seconds');
      return [name,audio];
    }));
    check(Object.values(assetMap).reduce((sum,asset)=>sum+asset.samples.length,0)<=32e6,'Instrument samples exceed their budget');
    const patches=Object.fromEntries(table(source.patches,64,'patch').map(([name,patch])=>[name,I.compile(patch,assetMap)]));
    const gain=db(number(source,'gain',0,-48,12));
    const roomSpec=source.room ?? {};
    check(fields(roomSpec,['gain','size','decay','damping']),'Invalid production room');
    const room={gain:db(number(roomSpec,'gain',-10,-60,6)),size:number(roomSpec,'size',.8,.2,2),
      decay:number(roomSpec,'decay',.42,.05,2),damping:number(roomSpec,'damping',.65,0,1)};
    const tracks=Object.fromEntries(table(source.tracks,8,'production track').map(([name,raw])=>{
      check(name!=='room' && Object.hasOwn(plan.parts,name) &&
        fields(raw,['patch','gain','pan','highpass','lowpass','send','groove','pad','choke','duck']) &&
        Object.hasOwn(patches,raw.patch) && (raw.choke===undefined || id(raw.choke)), 'Track needs a score part and an instrument patch');
      check(raw.duck===undefined || fields(raw.duck,['from','depth','release']),'Invalid ducking settings');
      const duck=raw.duck && {from:raw.duck.from,depth:number(raw.duck,'depth',4,0,18),
        release:number(raw.duck,'release',.1,.015,1)};
      check(!duck || Object.hasOwn(source.tracks,duck.from) && duck.from!==name,'Ducking needs a different production track');
      const mix={gain:db(number(raw,'gain',0,-60,18)), pan:number(raw,'pan',0,-1,1),
        highpass:number(raw,'highpass',0,0,4000),lowpass:number(raw,'lowpass',20000,80,24000),
        send:number(raw,'send',0,0,1),choke:raw.choke,duck};
      return [name,{patch:raw.patch,play:patches[raw.patch],mix,
        groove:groove(raw.groove),pad:raw.pad===undefined ? null : pad(raw.pad,plan.sections)}];
    }));
    check(Object.keys(tracks).length>0,'A production needs at least one track');
    const events={}, end=program.duration;
    let eventCount=0;
    for (const [name,track] of Object.entries(tracks)) {
      const rows=scoreRows(plan,program,clock,name,track.pad), g=track.groove;
      const notes=[], last=new Map();
      for (const row of rows) {
        if (row.midi===null || !row.frequency || !row.velocity) continue;
        const beatStyle=grooveAt(g,row.beat), play=row.play;
        const time=Math.max(0,row.time+beatStyle.delay+(play.delay ?? 0)), velocity=clamp(row.velocity*beatStyle.accent);
        const gate=Math.max(.001,(row.end-row.time)*(play.gate ?? 1));
        const voice=row.voice ?? 0, retrigger=play.retrigger ?? 1, fromFrequency=last.get(voice);
        last.set(voice,row.frequency);
        for (let r=0;r<retrigger;r++) {
          const onset=round(time+r*gate/retrigger);
          if (onset>=end) continue;
          const salt=hash([source.seed ?? 0,name,round(row.beat),voice,r]);
          notes.push({part:name,beat:round(row.beat),time:onset,gate:gate/retrigger,midi:row.midi,
            frequency:row.frequency,velocity,play,fromFrequency,salt,roundRobin:notes.length});
          check(++eventCount<=32768,'Production exceeds its event budget');
        }
      }
      notes.sort((a,b)=>a.time-b.time);
      events[name]=notes;
    }
    const chokeGroups=new Map();
    for (const [name,track] of Object.entries(tracks)) if (track.mix.choke) {
      const group=track.mix.choke, rows=chokeGroups.get(group) ?? [];
      rows.push(...events[name]);
      chokeGroups.set(group,rows);
    }
    for (const rows of chokeGroups.values()) {
      rows.sort((a,b)=>a.time-b.time);
      let next=Infinity;
      for (let i=rows.length-1;i>=0;i--) {
        const at=rows[i].time;
        if (rows[i+1]?.time>at) next=rows[i+1].time;
        if (next!==Infinity) rows[i].choke=next;
      }
    }
    return {arrangement:plan,events,end,program,clock,tracks,room,gain};
  }

  function sampleAt(time,rate) {
    return T.index(T.roundDown(T.mul(T.read(time),[BigInt(rate),1n])));
  }
  const roomTimes=[.019,.029,.043,.057,.073,.097,.117,.149,.183,.211,.254,.287,.331,.383,.449];
  function renderCompiled(music,options={}) {
    check(fields(options,['start','end','sampleRate','stems','tail','layers']),'Invalid production render options');
    const {start=0,end=music.end,sampleRate=48000,stems=false,tail=0,layers={}}=options;
    check(finite(start,0,music.end) && finite(end,start,music.end) && end>start &&
      integer(sampleRate,8000,96000) && typeof stems==='boolean' && finite(tail,0,8), 'Invalid production export range');
    const begin=sampleAt(start,sampleRate), stop=sampleAt(end+tail,sampleRate), n=stop-begin;
    const names=Object.keys(music.tracks);
    check(record(layers) && Object.entries(layers).every(([name,level])=>names.includes(name) &&
      finite(level,0,1)), 'Invalid production layer levels');
    check(n>0 && stop*(names.length+3)*2<=36e6,'Production exceeds its sample budget');
    const buffers={}, mix=new Float32Array(n*2), feed=new Float32Array(stop*2);
    for (const name of names) {
      const track=music.tracks[name], data=new Float32Array(stop*2);
      for (const note of music.events[name]) {
        if (note.time>=end) break;
        const first=Math.ceil(note.time*sampleRate-1e-7);
        if (first>=stop) break;
        const sound=track.play.prepare(note,sampleRate,Math.min(note.gate,end-note.time));
        const endTime=Math.min(note.choke ?? Infinity,note.time+sound.duration);
        const last=Math.min(stop,Math.ceil(endTime*sampleRate));
        for (let at=first;at<last;at++) {
          const t=Math.max(0,at/sampleRate-note.time);
          const fade=note.choke===endTime ? clamp((endTime-at/sampleRate)*250) : 1;
          const frame=at-first;
          const left=sound.signal(t,frame,0)*fade;
          data[2*at]+=left;
          data[2*at+1]+=sound.stereo ? sound.signal(t,frame,1)*fade : left;
        }
      }
      const desk=track.mix, panL=Math.sqrt((1-desk.pan)/2), panR=Math.sqrt((1+desk.pan)/2);
      const coefficient=frequency=>1-Math.exp(-2*Math.PI*Math.min(sampleRate*.49,frequency)/sampleRate);
      const high=coefficient(desk.highpass), low=coefficient(desk.lowpass);
      const dry=stems ? new Float32Array(n*2) : null;
      let lowL=0,lowR=0,highL=0,highR=0, hit=0;
      const anchors=desk.duck && music.events[desk.duck.from].filter(note=>note.time<end);
      const gain=desk.gain*music.gain*(layers[name] ?? 1);
      for (let i=0;i<stop;i++) {
        const index=2*i, time=i/sampleRate;
        let l=data[index],r=data[index+1], volume=gain;
        highL+=(l-highL)*high; highR+=(r-highR)*high;
        lowL+=(l-highL-lowL)*low; lowR+=(r-highR-lowR)*low;
        if (anchors?.length) {
          while (hit+1<anchors.length && anchors[hit+1].time<=time) hit++;
          const dt=time-anchors[hit].time;
          if (dt>=0 && dt<6*desk.duck.release)
            volume*=db(-desk.duck.depth*anchors[hit].velocity*clamp(dt/.005)*Math.exp(-dt/desk.duck.release));
        }
        l=lowL*volume*panL; r=lowR*volume*panR;
        feed[index]+=l*desk.send; feed[index+1]+=r*desk.send;
        if (i<begin) continue;
        const at=2*(i-begin);
        if (dry) { dry[at]=l; dry[at+1]=r; }
        mix[at]+=l; mix[at+1]+=r;
      }
      if (dry) buffers[name]={sampleRate,channels:2,samples:dry};
    }
    const wet=stems ? new Float32Array(n*2) : null;
    let left=0,right=0;
    const taps=roomTimes.map((seconds,i)=>{
      const time=seconds*music.room.size;
      return {samples:Math.max(1,Math.round(time*sampleRate)),
        gain:music.room.gain*Math.exp(-3*time/music.room.decay)*(i%3===1?-.31:.28), cross:i%2===0};
    });
    const smoothing=.06+.39*(1-music.room.damping);
    const fadeDuration=tail ? 0 : music.arrangement.score.endFade ?? .09;
    let peak=0,power=0,clipped=0;
    for (let i=0;i<stop;i++) {
      let l=0,r=0;
      for (const tap of taps) {
        const at=(i-tap.samples)*2;
        if (at<0) continue;
        l+=feed[at+Number(tap.cross)]*tap.gain;
        r+=feed[at+Number(!tap.cross)]*tap.gain;
      }
      left+=(l-left)*smoothing; right+=(r-right)*smoothing;
      if (i<begin) continue;
      const at=2*(i-begin);
      const fade=fadeDuration ? clamp((music.end-i/sampleRate)/fadeDuration) : 1;
      if (wet) { wet[at]=left*fade; wet[at+1]=right*fade; }
      mix[at]=(mix[at]+left)*fade; mix[at+1]=(mix[at+1]+right)*fade;
      if (stems && fade<1) for (const name of names) {
        buffers[name].samples[at]*=fade;
        buffers[name].samples[at+1]*=fade;
      }
      const p=Math.max(Math.abs(mix[at]),Math.abs(mix[at+1]));
      peak=Math.max(peak,p); clipped+=Number(p>1);
      power+=mix[at]**2+mix[at+1]**2;
    }
    if (wet) buffers.room={sampleRate,channels:2,samples:wet};
    return {value:{sampleRate,channels:2,samples:mix},stems:buffers,
      report:{sampleRate,firstSample:begin,endSample:stop,peak,rms:Math.sqrt(power/(2*n)),clipped}};
  }

  function render(source,assets,options) {return renderCompiled(compile(source,assets),options);}
  function inspect(source,assets) {
    const {arrangement,events,end}=compile(source,assets);
    return P.data.freeze({arrangement,events:json(events),duration:end});
  }
  P.musicProduction=Object.freeze({compile,renderCompiled,render,inspect,grooveAt});
})(KIT.procedural);
