/* Sample-clock instrument circuits with independent state for each performed note. */
(function (P) {
  const I=P.musicInstruments,S=P.musicSubtractive,{check,fields,record,id,finite,integer,clamp,envelope,level}=I;
  const E=P.musicNoteExpression, tau=2*Math.PI;
  const sources=[...E.names,'velocity','gate','key','phase'];
  const bounded=(value,lo,hi)=>Math.max(lo,Math.min(hi,value));
  const own=(map,name)=>Object.hasOwn(map,name) ? map[name] : undefined;

  function parameter(raw,[fallback,lo,hi],label) {
    const value=raw ?? fallback, defaultBase=typeof fallback==='number' ? fallback : fallback.base;
    if (finite(value,lo,hi)) return {base:value,by:[],from:[],lo,hi};
    check(fields(value,['base','by','from']) && finite(value.base ?? defaultBase,lo,hi) &&
      fields(value.by ?? {},sources) && record(value.from ?? {}) && Object.keys(value.from ?? {}).length<=8,
    'Invalid instrument graph parameter '+label);
    const by=Object.entries(value.by ?? {}), from=Object.entries(value.from ?? {});
    check(from.every(([name])=>id(name)) && [...by,...from].every(([,gain])=>finite(gain,-4*(hi-lo),4*(hi-lo))),
      'Invalid modulation depth on '+label);
    return {base:value.base ?? defaultBase,by,from,lo,hi};
  }

  function node(name,raw,assets) {
    check(record(raw),'Expected an instrument node on '+name);
    const {type,input}=raw, params={};
    const shape=keys=>check(fields(raw,['type',...keys]),'Unknown '+type+' field on '+name);
    const param=(key,spec)=>{params[key]=parameter(raw[key],spec,name+'.'+key);};
    let args={}, inputs=[];
    switch (type) {
      case 'oscillator':
        shape(['wave','hz','ratio','detune','width','phase','phaseInput','index']);
        args={wave:raw.wave ?? 'sine',hz:raw.hz,phase:raw.phase ?? 0};
        check(['sine','triangle','saw','pulse'].includes(args.wave) && finite(args.phase,0,1) &&
          (args.hz===undefined || finite(args.hz,.01,24000)) &&
          (raw.phaseInput===undefined || id(raw.phaseInput) && args.wave==='sine'),
        'Invalid oscillator on '+name);
        param('ratio',[1,.03125,32]);param('detune',[0,-48,48]);param('width',[.5,.04,.96]);
        if (raw.phaseInput!==undefined) {inputs=[raw.phaseInput];param('index',[.12,0,2]);}
        else check(raw.index===undefined,'An oscillator index needs a phase input on '+name);
        break;
      case 'noise':
        shape([]);
        break;
      case 'sample': {
        shape(['zones','env','channel','startSeconds']);
        const {zones,env,channel='mix',startSeconds=0}=raw;
        check(['mix','left','right'].includes(channel) && finite(startSeconds,0,6),'Invalid sample channel or start on '+name);
        args={channel,startSeconds,player:I.sampler({type,zones,env},assets)};
        break;
      }
      case 'envelope':
        shape(['env']);
        args={env:envelope(raw.env)};
        break;
      case 'curve': {
        shape(['points','clock']);
        const clock=raw.clock ?? 'gate', points=raw.points;
        check(['gate','seconds'].includes(clock) && Array.isArray(points) && integer(points.length,1,64) &&
          Array.from(points).every((point,i)=>Array.isArray(point) && point.length===2 &&
            finite(point[0],0,clock==='gate' ? 1 : 60) && finite(point[1],-48,48) &&
            (!i || point[0]>points[i-1][0])),'Invalid instrument curve on '+name);
        args={clock,points:points.map(point=>point.slice())};
        break;
      }
      case 'mix':
        shape(['inputs']);
        check(Array.isArray(raw.inputs) && integer(raw.inputs.length,1,16),'Mix needs 1–16 inputs on '+name);
        inputs=Array.from(raw.inputs);
        break;
      case 'gain':
        shape(['input','amount']);
        inputs=[input];param('amount',[1,-8,8]);
        break;
      case 'drive':
        shape(['input','amount']);
        inputs=[input];param('amount',[1,.05,20]);
        break;
      case 'filter':
        shape(['input','mode','cutoff','resonance']);
        args={mode:raw.mode ?? 'lowpass'};
        check(['lowpass','highpass','bandpass'].includes(args.mode),'Unknown graph filter mode on '+name);
        inputs=[input];param('cutoff',[1200,10,24000]);param('resonance',[.8,.5,12]);
        break;
      case 'resonator':
        shape(['input','hz','ratio','decay','contact','modes']);
        check((raw.hz===undefined || finite(raw.hz,10,24000)) && Array.isArray(raw.modes) &&
          integer(raw.modes.length,1,12),'A resonator needs 1–12 modes on '+name);
        args={hz:raw.hz,modes:Array.from(raw.modes,mode=>{
          check(fields(mode,['ratio','gain','decay','shape']) && finite(mode.ratio,.125,32) &&
            finite(mode.gain ?? 1,0,4) && finite(mode.decay ?? 1,.03,2) &&
            (mode.shape===undefined || integer(mode.shape,1,32)),'Invalid resonator mode on '+name);
          return {ratio:mode.ratio,gain:mode.gain ?? 1,decay:mode.decay ?? 1,shape:mode.shape};
        })};
        inputs=[input];
        param('ratio',[1,.03125,32]);param('decay',[.45,.006,8]);
        param('contact',[{base:0,by:{contact:1}},0,1]);
        break;
      case 'delay':
        shape(['input','samples','seconds','gain']);
        check(raw.samples===undefined ? finite(raw.seconds,.00001,.25) :
          raw.seconds===undefined && integer(raw.samples,1,2000),'A delay needs samples or seconds on '+name);
        args={samples:raw.samples,seconds:raw.seconds};
        inputs=[input];param('gain',[.65,-.98,.98]);
        break;
      default: throw new RangeError('Unknown instrument node type '+type+' on '+name);
    }
    const refs=[...inputs,...Object.values(params).flatMap(value=>value.from.map(([source])=>source))];
    check(refs.every(id),'Instrument node inputs must name nodes on '+name);
    return {name,type,inputs,refs,params,...args};
  }

  function model(raw,assets) {
    check(fields(raw,['type','nodes','output','tail','controls']) && raw.type==='graph' && record(raw.nodes) &&
      integer(Object.keys(raw.nodes).length,1,32) && Object.keys(raw.nodes).every(id),'A graph patch needs 1–32 named nodes');
    const {tail=.35,controls={},output}=raw;
    check(finite(tail,0,6) && fields(controls,E.names) && Object.values(controls).every(value=>finite(value,0,1)),
      'Invalid graph tail or expression defaults');
    const outputs=typeof output==='string' ? [output] : fields(output,['left','right']) ? [output.left,output.right] : [];
    check(outputs.length && outputs.every(name=>id(name) && own(raw.nodes,name)),'Choose graph output nodes');
    const nodes=new Map(Object.entries(raw.nodes).map(([name,spec])=>[name,node(name,spec,assets)]));
    for (const row of nodes.values()) for (const ref of row.refs)
      check(nodes.has(ref),'Unknown graph input '+ref+' on '+row.name);
    const ordered=[], pending=new Set(), sorted=new Set(), used=new Set();
    function visit(row) {
      if (sorted.has(row.name)) return;
      check(!pending.has(row.name),'Instrument graph cycle needs an explicit delay at '+row.name);
      pending.add(row.name);
      if (row.type!=='delay') for (const name of row.refs) visit(nodes.get(name));
      pending.delete(row.name);
      sorted.add(row.name);
      ordered.push(row);
    }
    function requireNode(name) {
      if (used.has(name)) return;
      used.add(name);
      for (const ref of nodes.get(name).refs) requireNode(ref);
    }
    outputs.forEach(requireNode);
    nodes.forEach(visit);
    const active=ordered.filter(row=>used.has(row.name)), delays=active.filter(row=>row.type==='delay');
    const seconds=delays.reduce((sum,row)=>sum+(row.seconds ?? row.samples/8000),0);
    check(seconds<=.5,'Instrument graph delays exceed half a second per voice at 8 kHz');
    return {active,outputs,tail,controls:{...E.controls,...controls}};
  }

  function bind(params,state) {
    return Object.fromEntries(Object.entries(params).map(([key,{base,by,from,lo,hi}])=>{
      const routes=from.map(([name,amount])=>[state.indices.get(name),amount]);
      return [key,by.length || from.length ? ()=>{
        let value=base;
        for (const [name,amount] of by) value+=state.controls[name]*amount;
        for (const [index,amount] of routes) value+=state.values[index]*amount;
        return bounded(value,lo,hi);
      } : ()=>base];
    }));
  }

  function oscillator(row,read,params,state,rate) {
    const {wave,hz}=row, fixedMax=hz ?? state.upper;
    // Arbitrary node modulation can exceed static note bounds. Use the
    // instantaneous frequency and a table ladder for those oscillators.
    const moving=['ratio','detune'].some(name=>row.params[name].by.length || row.params[name].from.length);
    const steps=wave==='saw' || wave==='pulse' ? new Map() : null;
    const band=step=>{
      const key=boundBand(step);
      if (!steps.has(key)) steps.set(key,S.sawBand(key/rate));
      return steps.get(key);
    };
    const fixedBand=steps && !moving ? S.sawBand(fixedMax*params.ratio()*2**(params.detune()/12)/rate) : null;
    let phase=row.phase, previousWidth;
    return ()=>{
      const frequency=(hz ?? state.pitch)*params.ratio()*2**(params.detune()/12);
      const turn=phase;
      phase=(turn+frequency/rate)%1;
      const width=wave==='pulse' ? params.width() : 0;
      const edgeSpeed=previousWidth===undefined ? 0 : Math.abs(width-previousWidth)*rate;
      previousWidth=width;
      const guard=clamp((.49*rate-frequency-edgeSpeed)/(.06*rate));
      if (!guard) return 0;
      if (wave==='sine') return Math.sin(tau*(turn+(params.index ? read()*params.index() : 0)))*guard;
      if (wave==='triangle') {
        const top=Math.min(31,Math.floor(.45*rate/frequency));
        let value=0;
        for (let h=1;h<=top;h+=2) value+=Math.sin(tau*turn*h)*clamp((.45*rate/frequency-h)/2)/((h%4===1 ? 1 : -1)*h*h);
        return value*.8105694691*guard;
      }
      const saw=fixedBand && edgeSpeed===0 ? fixedBand : band(frequency+edgeSpeed), current=saw(turn);
      return (wave==='pulse' ? saw(turn-width)-current : current)*guard;
    };
  }

  // Round up to eighth-octave bands to bound the harmonic table cache.
  function boundBand(frequency) { return 2**(Math.ceil(Math.log2(Math.max(.001,frequency))*8)/8); }

  function resonator(row,read,params,state,rate) {
    const modes=row.modes.map(mode=>({...mode,x:0,y:0}));
    let previousHz,previousDecay,previousContact;
    return ()=>{
      const input=read(), hz=(row.hz ?? state.pitch)*params.ratio(), decay=params.decay(), contact=params.contact();
      let out=0;
      for (const mode of modes) {
        if (hz!==previousHz) {
          const frequency=hz*mode.ratio, angle=tau*Math.min(frequency,.49*rate)/rate;
          mode.c=Math.cos(angle);mode.s=Math.sin(angle);
          mode.guard=clamp((.48*rate-frequency)/(.05*rate));
        }
        if (decay!==previousDecay) {
          mode.r=Math.exp(-Math.log(1000)/(rate*decay*mode.decay));
          mode.drive=Math.sqrt(1-mode.r);
        }
        if (contact!==previousContact)
          mode.pick=mode.shape===undefined ? 1 : Math.sin(Math.PI*mode.shape*contact);
        const {x,y,c,s,r}=mode;
        mode.x=r*(c*x-s*y)+input*mode.drive*mode.pick*mode.guard;
        mode.y=r*(s*x+c*y);
        out+=mode.y*mode.gain*mode.guard;
      }
      previousHz=hz;previousDecay=decay;previousContact=contact;
      return out;
    };
  }

  function operator(row,state,note,rate,gate) {
    const params=bind(row.params,state), refs=row.inputs.map(name=>state.indices.get(name));
    const values=state.values, index=state.indices.get(row.name), read=()=>values[refs[0]];
    let process,write;
    switch (row.type) {
      case 'oscillator': process=oscillator(row,read,params,state,rate);break;
      case 'noise': {
        const salt=note.salt^I.hash(row.name);
        process=()=>I.noise(state.frame,salt);break;
      }
      case 'sample': {
        const sound=row.player.prepare(note,rate,Math.max(0,gate-row.startSeconds));
        const first=Math.ceil(row.startSeconds*rate-1e-7);
        process=()=>{
          const t=state.t-row.startSeconds, frame=state.frame-first;
          if (frame<0 || t>=sound.duration) return 0;
          if (!sound.stereo || row.channel==='left') return sound.signal(t,frame,0);
          const right=sound.signal(t,frame,1);
          return row.channel==='right' ? right : (right+sound.signal(t,frame,0))*.5;
        };
        break;
      }
      case 'envelope': process=()=>level(row.env,state.t,gate);break;
      case 'curve': {
        let next=1;
        const {points,clock}=row;
        process=()=>{
          const time=clock==='gate' ? state.controls.phase : state.t;
          while (next<points.length && time>points[next][0]) next++;
          const [start,a]=points[next-1];
          if (time<=start || next===points.length) return a;
          const [stop,b]=points[next];
          return a+(b-a)*(time-start)/(stop-start);
        };
        break;
      }
      case 'mix': process=()=>refs.reduce((sum,at)=>sum+values[at],0);break;
      case 'gain': process=()=>read()*params.amount();break;
      case 'drive': process=()=>Math.tanh(read()*params.amount());break;
      case 'filter': {
        const tick=S.filterState(rate,row.mode);
        process=()=>tick(read(),Math.min(.46*rate,params.cutoff()),params.resonance());break;
      }
      case 'resonator': process=resonator(row,read,params,state,rate);break;
      case 'delay': {
        const buffer=new Float32Array(row.samples ?? Math.max(1,Math.round(rate*row.seconds)));
        let at=0;
        process=()=>buffer[at];
        write=()=>{
          buffer[at]=Math.tanh(read()*params.gain());
          if (++at===buffer.length) at=0;
        };
        break;
      }
    }
    return {tick:()=>{values[index]=process();},write};
  }

  function compile(raw,assets) {
    const {active,outputs,tail,controls}=model(raw,assets);
    const indices=new Map(active.map(({name},index)=>[name,index]));
    const channels=outputs.map(name=>indices.get(name));
    return {prepare(note,rate,gate) {
      const bend=note.frequency*2**((note.play.bend ?? 0)/1200);
      const {glide=0,vibrato=0}=note.play, pitchCurve=note.expression?.pitchRatio;
      const slide=glide && note.fromFrequency ? note.fromFrequency-bend : 0;
      const vibratoHz=bend*(2**(vibrato/1200)-1);
      const upper=bend+Math.max(0,slide)+bend*Math.max(0,(note.expression?.pitchMax ?? 1)-1)+vibratoHz;
      const pitch=slide || vibratoHz || pitchCurve ? t=>Math.max(.001,bend*(pitchCurve?.(t) ?? 1)+
        (slide ? slide*Math.max(0,1-t/glide) : 0)+vibratoHz*Math.sin(t*tau*5.2)) : ()=>bend;
      const state={values:new Float64Array(active.length),indices,t:0,frame:undefined,pitch:bend,upper,
        controls:{...controls,velocity:note.velocity,key:note.midi/127,gate:1,phase:0}};
      const motion=E.names.map(name=>[name,note.expression?.controls?.[name],note.play[name] ?? controls[name]]);
      const graph=active.map(row=>operator(row,state,note,rate,gate));
      const writes=graph.flatMap(row=>row.write ? [row.write] : []);
      const duration=gate+tail, gain=note.velocity**.7;
      let amp=0;
      return {duration,stereo:channels.length===2,signal(t,frame,channel=0) {
        if (frame!==state.frame) {
          state.frame=frame;
          state.t=t;
          state.controls.phase=clamp(t/Math.max(gate,1/rate));
          state.controls.gate=t<gate ? 1 : 0;
          for (const [name,curve,base] of motion) state.controls[name]=curve?.(t) ?? base;
          state.pitch=pitch(t);
          for (const row of graph) row.tick();
          for (const write of writes) write();
          amp=gain*clamp(t*1000)*clamp((duration-t)*125);
        }
        const out=state.values[channels[channel]]*amp, mag=Math.abs(out);
        return mag<=.85 ? out : Math.sign(out)*(.85+.15*(mag-.85)/(mag-.7));
      }};
    }};
  }

  function articulate(base,override) {
    const {nodes,controls,...rest}=override;
    check((nodes===undefined || record(nodes) && Object.values(nodes).every(record)) &&
      (controls===undefined || fields(controls,E.names)),'Invalid graph articulation overrides');
    return {...base,...rest,...(controls!==undefined && {controls:{...base.controls,...controls}}),
      ...(nodes && {nodes:{...base.nodes,...Object.fromEntries(Object.entries(nodes).map(([name,row])=>
        [name,{...own(base.nodes,name),...row}]))}})};
  }

  function inspect(raw,assets={}) {
    check(record(raw) && raw.type==='graph','Inspect a graph instrument patch');
    const {articulations,gestures,echo,performance,...base}=raw;
    const bank=Object.fromEntries(Object.entries(assets).map(([name,pcm])=>[name,P.mediaGraph.audio(pcm)]));
    P.musicGestures.patch(raw,bank);
    const {active,outputs,tail,controls}=model(base,bank);
    const order=active.map(({name})=>name);
    return {output:outputs,tail,controls,assets:[...new Set(I.assetNames(raw))],
      inactive:Object.keys(base.nodes).filter(name=>!order.includes(name)),order,nodes:active.map(({name,type,inputs,params,...spec})=>({name,type,inputs,
        ...(type==='delay' && {writesAfterFrame:true}),
        ...(type==='curve' && {clock:spec.clock,points:spec.points}),parameters:Object.fromEntries(Object.entries(params)
          .map(([key,{base,by,from}])=>[key,{base,by:Object.fromEntries(by),from:Object.fromEntries(from)}]))}))};
  }
  P.musicInstrumentGraph=Object.freeze({compile,articulate,inspect});
})(KIT.procedural);
