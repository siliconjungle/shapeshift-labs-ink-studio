/* Portable instruments. Patches and score events carry all expressive state. */
(function (K) {
  const P=K.procedural, H=P.musicHarmony, tau=2*Math.PI;
  const record=value=>value && [Object.prototype,null].includes(Object.getPrototypeOf(value));
  const fields=(value,keys)=>record(value) && Object.keys(value).every(key=>keys.includes(key));
  const finite=(value,lo,hi)=>Number.isFinite(value) && value>=lo && value<=hi;
  const integer=(value,lo,hi)=>Number.isSafeInteger(value) && finite(value,lo,hi);
  const id=value=>typeof value==='string' && /^[a-z][a-z0-9_-]{0,47}$/i.test(value) &&
    !['constructor','prototype','__proto__'].includes(value);
  const check=(value,message)=>{ if (!value) throw new RangeError(message); };
  const clamp=value=>Math.max(0,Math.min(1,value));
  const db=value=>10**(value/20);
  const hz=midi=>440*2**((midi-69)/12);
  const sin=turn=>Math.sin(turn*tau);
  const hash=parts=>P.data.hash(JSON.stringify(parts));
  const options=(raw,schema)=>{
    check(fields(raw,Object.keys(schema)),'Unknown instrument parameter');
    return Object.fromEntries(Object.entries(schema).map(([key,[fallback,lo,hi]])=>{
      const value=raw[key] ?? fallback;
      check(finite(value,lo,hi),'Invalid instrument parameter '+key);
      return [key,value];
    }));
  };
  function envelope(raw={}) {
    return options(raw,{attack:[.008,.001,4],decay:[.22,.001,8],sustain:[.65,0,1],release:[.14,.001,8]});
  }
  function level(env,age,gate) {
    const time=Math.min(age,gate);
    const held=time<env.attack ? time/env.attack : env.sustain+(1-env.sustain)*Math.exp(-3*(time-env.attack)/env.decay);
    return held*(age<gate ? 1 : clamp(1-(age-gate)/env.release)**2);
  }
  function noise(index,salt) {
    let x=(index^salt)>>>0;
    x=Math.imul(x^(x>>>16),0x21f0aaad);
    x=Math.imul(x^(x>>>15),0x735a2d97);
    return ((x^(x>>>15))>>>0)/2147483648-1;
  }
  function phase(note,time) {
    const {bend=0,glide=0,vibrato=0}=note.play;
    const frequency=note.frequency*2**(bend/1200);
    const ramp=Math.min(time,glide);
    const slide=glide && note.fromFrequency ? (note.fromFrequency-frequency)*ramp*(1-ramp/(2*glide)) : 0;
    const modulation=vibrato ? frequency*(2**(vibrato/1200)-1)*(1-Math.cos(time*tau*5.2))/(tau*5.2) : 0;
    const travel=note.expression?.pitchTime?.(time) ?? time;
    return frequency*travel+slide+modulation;
  }

  function synth(raw) {
    const {type,env, ...settings}=raw;
    const e=envelope(env);
    const params=options(settings,{ratio:[2,.125,12],index:[1.4,0,8],indexDecay:[.18,.001,8],
      body:[.22,0,1],width:[0,0,40],grain:[0,0,.4],color:[.6,0,1],drive:[1,.2,6]});
    return {prepare(note,rate,gate) {
      const bright=note.play.brightness ?? params.color;
      const accent=.48+.7*note.velocity;
      const upper=note.frequency*(note.expression?.pitchMax ?? 1);
      const index=params.index*(.35+.9*bright)*(.3+.7*note.velocity)*
        clamp((.48*rate/upper-params.ratio)/Math.max(1,params.ratio));
      const gain=Math.pow(note.velocity,.78), salt=note.salt;
      const spread=2**(params.width/1200)-1;
      return {duration:gate+e.release,signal(t,frame){
        const turn=phase(note,t), transient=Math.exp(-t/params.indexDecay);
        const fm=sin(turn+sin(turn*params.ratio)*index*(.13+.87*transient)/tau);
        const harmonics=sin(2*turn+.07)*.53*clamp((.5-2*upper/rate)*12)+
          sin(3*turn)*.26*clamp((.5-3*upper/rate)*12);
        let value=type==='fm' ? fm*(1-params.body)+params.body*sin(turn/2) :
          sin(turn)*.76+params.body*harmonics*accent;
        if (spread) value=value*.72+.14*sin(turn*(1+spread))+.14*sin(turn/(1+spread));
        if (params.grain) {
          const smoothNoise=(noise(frame-1,salt)+2*noise(frame,salt)+noise(frame+1,salt))/4;
          value=value*(1-params.grain)+smoothNoise*params.grain*(.4+.6*sin(t*21+.15)**2);
        }
        return Math.tanh(params.drive*value)*gain*level(e,t,gate);
      }};
    }};
  }

  function keys(raw) {
    const {type,env,...settings}=raw;
    const e=envelope(env);
    const p=options(settings,{tine:[.5,0,1],bite:[.5,0,1],dust:[.07,0,.25],wear:[.16,0,1],
      color:[.5,0,1],drive:[1.3,.2,6]});
    return {prepare(note,rate,gate) {
      const color=note.play.brightness ?? p.color, velocity=note.velocity, salt=note.salt;
      const brightness=(.35+.65*color)*(.35+.65*velocity);
      const partial=(ratio,gain)=>gain*clamp((.5-note.frequency*(note.expression?.pitchMax ?? 1)*ratio/rate)*12);
      const second=partial(1.999,.20*p.tine), third=partial(3.998,.38*p.bite*brightness);
      const strike=partial(6.84,.26*p.bite*brightness);
      return {duration:gate+e.release,signal(t,frame) {
        const turn=phase(note,t)+p.wear*.042*(1-Math.cos(tau*.84*t));
        const body=.8*sin(turn)+second*sin(turn*1.999+.063)*Math.exp(-t*3.4);
        const hammer=strike*sin(turn*6.84)*Math.exp(-t*35)+third*sin(turn*3.998)*Math.exp(-t*10);
        const dust=(noise(frame,salt)+noise(frame-1,salt))*p.dust*.5*Math.exp(-t*45);
        return Math.tanh(p.drive*(body+hammer+dust))*velocity**.82*level(e,t,gate);
      }};
    }};
  }

  function drum(raw) {
    const {type,kind, ...settings}=raw;
    check(['kick','snare','hat','rim','metal','brush'].includes(kind),'Unknown synthetic drum');
    const p=options(settings,{tune:[kind==='kick'?49:184,20,1600],decay:[.19,.02,2],
      click:[kind==='kick'?.12:.61,0,1],color:[.55,0,1],sweep:[80,0,500]});
    return {prepare(note,rate) {
      const duration=p.decay*(kind==='hat' && note.play.articulation==='open' ? 2.5 : 1);
      const velocity=note.velocity, amp=velocity**.84, salt=note.salt;
      const hardness=note.play.brightness ?? p.color;
      return {duration,signal(t,frame) {
        const n1=noise(frame,salt), n2=noise(frame-1,salt), edge=(n1-n2)*.5;
        const travel=note.expression?.pitchTime?.(t) ?? t;
        const body=sin(p.tune*travel+p.sweep*(1-Math.exp(-75*t))/75);
        const hiss=(n1*(.7-hardness*.45)+edge*(.3+hardness*.45));
        const ring=sin(p.tune*travel)*.55+sin(p.tune*2.73*travel)*.25+sin(p.tune*4.59*travel)*.2;
        let value;
        switch (kind) {
          case 'kick': value=.93*body*Math.exp(-4*t/duration)+p.click*hiss*Math.exp(-300*t); break;
          case 'snare': value=(.38*body*Math.exp(-19*t)+p.click*hiss*(.7+.3*velocity))*Math.exp(-4*t/duration); break;
          case 'rim': value=(ring*.73+edge*p.click)*Math.exp(-8*t/duration); break;
          case 'metal': value=(ring*.66+hiss*p.click)*Math.exp(-3.6*t/duration); break;
          case 'brush': {
            const sweep=Math.sin(Math.PI*clamp(t/duration))**.72;
            const grains=(.66+.24*sin(t*79+velocity)+.1*sin(t*137))*.92;
            const scrape=(n1+n2)*.19+edge*(.16+.32*hardness);
            value=scrape*(sweep*grains+p.click*Math.exp(-t*29))+
              ring*.22*velocity*Math.exp(-t*23);
            break;
          }
          default: value=(edge*.72+ring*.18)*Math.exp(-4*t/duration);
        }
        return value*amp*clamp(t*(kind==='kick'?660:1800))*clamp((duration-t)*250);
      }};
    }};
  }

  function sampler(raw,assets) {
    check(fields(raw,['type','zones','env']) && Array.isArray(raw.zones) && raw.zones.length>=1 &&
      raw.zones.length<=96,'A sampler needs a bounded list of sample zones');
    const e=envelope(raw.env ?? {attack:.002,decay:.4,sustain:1,release:.08});
    const zones=Array.from(raw.zones,zone=>{
      check(fields(zone,['samples','levels','root','low','high','velocity','articulation','oneShot','tune','gain','loop']) &&
        Array.isArray(zone.samples) && zone.samples.length>=1 && zone.samples.length<=16 &&
        Array.from(zone.samples).every(name=>id(name) && Object.hasOwn(assets,name)), 'Unknown sampler zone asset');
      const {samples,levels,root,low=0,high=127,velocity=[0,1],articulation,oneShot=true,tune=0,gain=0,loop}=zone;
      check(integer(low,0,127) && integer(high,low,127) && Array.isArray(velocity) && velocity.length===2 &&
        finite(velocity[0],0,1) && finite(velocity[1],velocity[0],1) &&
        (articulation===undefined || id(articulation)) && typeof oneShot==='boolean' &&
        finite(gain,-60,18) && finite(tune,-1200,1200) &&
        (levels===undefined || Array.isArray(levels) && levels.length===samples.length &&
          Array.from(levels).every(level=>finite(level,-24,24))) &&
        (loop===undefined || (!oneShot && Array.isArray(loop) && loop.length===2 &&
          finite(loop[0],0,30) && finite(loop[1],loop[0]+.005,30))), 'Invalid sampler zone');
      const buffers=samples.map(name=>assets[name]);
      check(!loop || buffers.every(b=>loop[1]*b.sampleRate<=b.samples.length/b.channels),'Sample loop is outside the asset');
      return {buffers,levels:levels?.map(db),root:root===undefined ? null : H.midi(root),low,high,
        velocity,articulation,oneShot,tune,gain:db(gain),loop};
    });
    return {prepare(note,rate,gate) {
      const midi=note.midi, articulation=note.play.articulation;
      const matching=zones.filter(z=>midi>=z.low && midi<=z.high && note.velocity>=z.velocity[0] &&
        note.velocity<=z.velocity[1] && (z.articulation===undefined || z.articulation===articulation));
      const zone=matching.find(z=>articulation!==undefined && z.articulation===articulation) ?? matching[0];
      if (!zone) return {duration:0,signal:()=>0};
      const alternate=note.roundRobin%zone.buffers.length;
      const {samples,channels,sampleRate}=zone.buffers[alternate];
      const frames=samples.length/channels, ratio=2**((zone.tune+(note.play.bend ?? 0))/1200)*
        (zone.root===null ? 1 : note.frequency/hz(zone.root));
      const offset=(note.play.offset ?? 0)*sampleRate;
      const travel=note.expression?.pitchTime;
      const span=P.musicNoteExpression.duration(travel,Math.max(0,(frames-offset)/(ratio*sampleRate)));
      const duration=zone.oneShot ? span : zone.loop ? gate+e.release : Math.min(span,gate+e.release);
      const gain=zone.gain*(zone.levels?.[alternate] ?? 1)*note.velocity**.72;
      return {duration,stereo:channels===2,signal(t,frame,channel) {
        let pos=offset+(travel?.(t) ?? t)*ratio*sampleRate;
        if (zone.loop && pos>=zone.loop[1]*sampleRate)
          pos=zone.loop[0]*sampleRate+(pos-zone.loop[0]*sampleRate)%((zone.loop[1]-zone.loop[0])*sampleRate);
        const at=Math.floor(pos), blend=pos-at, ch=channels===1 ? 0 : channel;
        if (at>=frames) return 0;
        const current=samples[at*channels+ch], next=samples[(at+1)*channels+ch] ?? 0;
        const shape=zone.oneShot ? clamp(t*1100)*clamp((duration-t)*250) : level(e,t,gate);
        return (current+(next-current)*blend)*gain*shape;
      }};
    }};
  }

  function zoned(raw,assets) {
    check(fields(raw,['type','instruments','zones','fallback']) && record(raw.instruments) &&
      integer(Object.keys(raw.instruments).length,1,16) && Array.isArray(raw.zones) &&
      integer(raw.zones.length,1,96),'A zoned patch needs named instruments and key and velocity zones');
    const players=new Map(Object.entries(raw.instruments).map(([name,child])=>{
      check(id(name) && record(child) && child.type!=='zoned','A zone needs a native instrument patch');
      return [name,articulated(child,assets)];
    }));
    check(raw.fallback===undefined || players.has(raw.fallback),'Unknown fallback zone instrument');
    const zones=Array.from(raw.zones,row=>{
      check(fields(row,['instrument','low','high','velocity','gainDb']) && players.has(row.instrument) &&
        integer(row.low,0,127) && integer(row.high,row.low,127) && Array.isArray(row.velocity) &&
        row.velocity.length===2 && row.velocity.every(value=>finite(value,0,1)) &&
        row.velocity[0]<row.velocity[1] && finite(row.gainDb ?? 0,-24,12),'Invalid key or velocity zone');
      return {...row,player:players.get(row.instrument),gain:db(row.gainDb ?? 0)};
    });
    for (const [i,a] of zones.entries()) for (const b of zones.slice(i+1)) {
      check(a.high<b.low || b.high<a.low || a.velocity[1]<=b.velocity[0] || b.velocity[1]<=a.velocity[0],
        'Key and velocity zones cannot overlap');
    }
    const fallback=players.get(raw.fallback);
    return {prepare(note,rate,gate) {
      const {midi,zoneVelocity:velocity=note.velocity}=note;
      const zone=zones.find(row=>midi>=row.low && midi<=row.high && velocity>=row.velocity[0] &&
        (velocity<row.velocity[1] || row.velocity[1]===1));
      const player=zone?.player ?? fallback;
      if (!player) return {duration:0,signal:()=>0};
      const body=player.prepare(note,rate,gate), gain=zone?.gain ?? 1;
      return gain===1 ? body : {...body,signal:(...args)=>body.signal(...args)*gain};
    }};
  }

  function instrument(raw,assets) {
    check(record(raw),'Expected a music instrument');
    if (raw.type==='sample') return sampler(raw,assets);
    if (raw.type==='graph') return P.musicInstrumentGraph.compile(raw,assets);
    if (raw.type==='zoned') return zoned(raw,assets);
    if (raw.type==='drum') return drum(raw);
    if (raw.type==='keys') return keys(raw);
    if (raw.type==='subtractive') return P.musicSubtractive.compile(raw);
    check(['fm','analog'].includes(raw.type),'Unknown music instrument type');
    return synth(raw);
  }
  function articulated(raw,assets) {
    check(record(raw),'Expected a music instrument');
    const {articulations,...base}=raw, patch=instrument(base,assets);
    if (articulations===undefined) return patch;
    check(!['sample','zoned'].includes(base.type) && record(articulations) && Object.keys(articulations).length<=16 &&
      Object.entries(articulations).every(([name,value])=>id(name) && record(value) && value.type===undefined),
      'Invalid instrument articulations');
    function override(value) {
      if (base.type==='subtractive') return P.musicSubtractive.articulate(base,value);
      if (base.type==='graph') return P.musicInstrumentGraph.articulate(base,value);
      return {...base,...value,...(value.env && {env:{...base.env,...value.env}})};
    }
    const variants=Object.fromEntries(Object.entries(articulations)
      .map(([name,value])=>[name,instrument(override(value),assets)]));
    return {prepare(note,...args) {
      const name=note.play.articulation;
      return (Object.hasOwn(variants,name) ? variants[name] : patch).prepare(note,...args);
    }};
  }

  function express(player,note,rate,gate,phraseOffset=0) {
    const authoredGate=(note.gate ?? gate)+(note.start===undefined ? 0 : note.time-note.start);
    const expression=P.musicNoteExpression.compile(note.play.curves,Math.max(gate,authoredGate),rate,note.phrase,phraseOffset);
    const body=player.prepare(expression ? {...note,expression} : note,rate,gate);
    const fadeIn=note.performance?.fadeIn;
    if (!expression?.gain && !expression?.filter && !expression?.roughness && !fadeIn) return body;
    const state=[0,0], roughRate=Math.min(70,Math.max(28,note.frequency*.24));
    return {...body,signal(t,frame,ch=0) {
      let sample=body.signal(t,frame,ch);
      if (expression?.filter) {
        state[ch]+=(sample-state[ch])*expression.filter(t);
        sample=state[ch];
      }
      if (expression?.roughness) {
        const depth=.64*expression.roughness(t);
        const center=1-depth*.5, swing=depth*.5;
        sample*=(center+swing*sin(roughRate*t+.25))/Math.sqrt(center**2+swing**2*.5);
      }
      const fade=fadeIn ? Math.sin(clamp(t/fadeIn)*Math.PI/2) : 1;
      return sample*fade*(expression?.gain?.(t) ?? 1);
    }};
  }

  function compile(raw,assets={}) {
    const player=articulated(raw,assets);
    return {prepare(note,rate,gate) {
      const body=express(player,note,rate,gate), release=note.performance?.release;
      const start=note.start ?? note.time;
      if (!release || note.suppressRelease || (note.choke ?? Infinity)<=start+gate+1e-8) return body;
      const tail=express(player,{...note,performance:null,gate:.075,start:undefined,roundRobin:release.roundRobin,
        zoneVelocity:note.velocity,velocity:clamp(note.velocity*release.level),
        play:{articulation:release.articulation,curves:release.curves}},rate,.075,gate);
      if (!tail.duration) return body;
      const stereo=body.stereo || tail.stereo, releaseFrame=Math.ceil(gate*rate-1e-7);
      let bodyFrame=-1, tailFrame=-1, dry=0, off=0;
      return {stereo,duration:Math.max(body.duration,gate+tail.duration),signal(t,frame,ch=0) {
        let sample=0;
        if (t<body.duration) {
          if (body.stereo) sample=body.signal(t,frame,ch);
          else {
            if (frame!==bodyFrame) {bodyFrame=frame;dry=body.signal(t,frame,0);}
            sample=dry;
          }
        }
        if (t>=gate && t-gate<tail.duration) {
          if (tail.stereo) sample+=tail.signal(t-gate,frame-releaseFrame,ch);
          else {
            if (frame!==tailFrame) {tailFrame=frame;off=tail.signal(t-gate,frame-releaseFrame,0);}
            sample+=off;
          }
        }
        return sample;
      }};
    }};
  }

  function sampleZones(patch) {
    const zones=row=>Array.isArray(row?.zones) ? row.zones : [];
    if (patch?.type==='sample') return zones(patch);
    if (patch?.type==='zoned') return Object.values(patch.instruments ?? {}).filter(child=>child?.type!=='zoned').flatMap(sampleZones);
    if (patch?.type==='graph') return [patch,...Object.values(patch.articulations ?? {})].flatMap(row=>
      Object.values(row?.nodes ?? {}).flatMap(zones));
    return [];
  }
  function articulationNames(patch) {
    const nested=patch.type==='zoned' ? Object.values(patch.instruments ?? {}).filter(child=>child && child.type!=='zoned')
      .flatMap(child=>[...articulationNames(child)]) : [];
    return new Set([...nested,...Object.keys(patch.articulations ?? {}),
      ...sampleZones(patch).flatMap(zone=>zone.articulation ? [zone.articulation] : []),
      ...(patch.type==='drum' && patch.kind==='hat' ? ['open'] : [])]);
  }
  const assetNames=patch=>sampleZones(patch).flatMap(zone=>Array.isArray(zone?.samples) ? zone.samples : []);

  P.musicInstruments=Object.freeze({compile,sampler,noise,sampleZones,articulationNames,assetNames,record,fields,finite,integer,id,check,clamp,db,hz,hash,options,envelope,level,phase});
})(KIT);
