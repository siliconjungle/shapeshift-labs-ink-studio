/* Parametric filters and linked stereo dynamics for the mixer insert bank. */
(function (P) {
  const S=P.mediaGraphSupport,{fields,finite,integer,check,db}=P.musicInstruments;
  const pole=(rate,time)=>1-Math.exp(-1/(rate*time));
  const hertz=(rate,hz)=>S.sampleKitMix.poleAt(hz,rate);
  const level=x=>20*Math.log10(Math.max(1e-10,x));
  const modes=['peak','low-shelf','high-shelf','lowpass','highpass','notch'];
  const {tuning,band}=P.audioParametric;
  function tailFor({g,k}) {
    // Map the analog poles through the bilinear transform.
    const real=-k/2, discriminant=real*real-1;
    let radius;
    if (discriminant<0) {
      const imagSquared=-g*g*discriminant;
      radius=Math.sqrt(((1+g*real)**2+imagSquared)/((1-g*real)**2+imagSquared));
    } else {
      const roots=[real-Math.sqrt(discriminant),real+Math.sqrt(discriminant)];
      radius=Math.max(...roots.map(root=>Math.abs((1+g*root)/(1-g*root))));
    }
    return 2+Math.ceil(Math.log(1e-5)/Math.log(radius));
  }
  function eq(raw,rate,time) {
    check(fields(raw,['type','wet','bands']) && Array.isArray(raw.bands) && integer(raw.bands.length,1,8),
      'EQ needs one to eight parametric bands');
    let tail=0;
    const bands=Array.from(raw.bands,row=>{
      check(fields(row,['mode','hz','q','gainDb']) && modes.includes(row.mode), 'Unknown EQ band type');
      const colored=['peak','low-shelf','high-shelf'].includes(row.mode);
      check(colored || row.gainDb===undefined,'EQ gain applies to bell and shelf bands');
      const hz=time.lane(row.hz,1000,20,Math.min(rate*.48,24000),'EQ frequency');
      const q=time.lane(row.q,.707,.35,12,'EQ Q');
      const gain=time.lane(row.gainDb,0,-24,24,'EQ gain');
      let longest=0;
      for (const f of [hz.min,hz.max]) for (const width of [q.min,q.max]) for (const db of [gain.min,gain.max])
        longest=Math.max(longest,tailFor(tuning(row.mode,rate,f,width,db)));
      tail+=longest;
      return ()=>band(row.mode,rate,hz.reader(),q.reader(),gain.reader());
    });
    return {tail,cost:12*bands.length,make() {
      const stages=bands.map(make=>make());
      const process=(l,r,kl,kr,t,out)=>{
        out[0]=l; out[1]=r;
        for (const filter of stages) filter(out[0],out[1],t,out);
      };
      return Object.assign(process,{
        snapshot:()=>stages.map(filter=>filter.snapshot()),
        restore(states){stages.forEach((filter,i)=>filter.restore(states[i]));}
      });
    }};
  }
  const schemas={
    gate:{thresholdDb:[-36,-96,0],rangeDb:[48,0,96],hysteresisDb:[4,0,24],
      attack:[.003,.0001,1,true],hold:[.022,0,2,true],release:[.09,.001,4,true]},
    expander:{thresholdDb:[-36,-96,0],rangeDb:[24,0,96],ratio:[2,1,20],
      attack:[.003,.0001,1,true],release:[.09,.001,4,true]},
    transient:{attackDb:[0,-18,18],sustainDb:[0,-18,18],
      fast:[.003,.0002,.04,true],slow:[.055,.006,.3,true]},
    saturation:{driveDb:[8,-24,24],bias:[0,-.65,.65],outputDb:[-2,-24,24],
      toneHz:[7200,200,24000]}
  };
  function dynamics(raw,rate,time) {
    const {type}=raw, schema=schemas[type];
    check(fields(raw,['type','wet',...Object.keys(schema)]),'Unknown '+type+' parameter');
    const p=Object.fromEntries(Object.entries(schema).map(([name,[fallback,min,max,fixed]])=>{
      const value=raw[name] ?? fallback;
      if (!fixed) return [name,time.lane(value,fallback,min,max,type+' '+name)];
      check(finite(value,min,max),'Invalid '+type+' '+name);
      return [name,value];
    }));
    if (type==='transient') {
      check(p.fast<p.slow,'Transient fast envelope must precede the slow envelope');
      return {tail:0,cost:10,make() {
        const attack=p.attackDb.reader(), sustain=p.sustainDb.reader();
        const fast=pole(rate,p.fast),slow=pole(rate,p.slow);
        const state={a:0,b:0};
        return P.audioCheckpoint((l,r,kl,kr,t,out)=>{
          const x=Math.max(Math.abs(l),Math.abs(r));
          state.a+=(x-state.a)*fast; state.b+=(x-state.b)*slow;
          const {a,b}=state;
          const gain=db(a>b ? attack(t)*(a-b)/Math.max(1e-12,a) : sustain(t)*(b-a)/Math.max(1e-12,b));
          out[0]=l*gain; out[1]=r*gain;
        },state);
      }};
    }
    if (type==='saturation') {
      const dc=hertz(rate,16);
      return {tail:Math.ceil(Math.log(.001)/Math.log1p(-dc)),cost:18,make() {
        const drive=p.driveDb.reader(), bias=p.bias.reader(), tone=p.toneHz.reader(), gain=p.outputDb.reader();
        const average=new Float64Array(2), low=new Float64Array(2);
        return P.audioCheckpoint((l,r,kl,kr,t,out)=>{
          const amount=db(drive(t)), offset=bias(t), shift=Math.tanh(offset),
            color=hertz(rate,tone(t)), trim=db(gain(t));
          for (let ch=0;ch<2;ch++) {
            const shape=Math.tanh((ch===0 ? l : r)*amount+offset)-shift;
            average[ch]+=(shape-average[ch])*dc;
            low[ch]+=(shape-average[ch]-low[ch])*color;
            out[ch]=low[ch]*trim;
          }
        },average,low);
      }};
    }
    const gate=type==='gate', openSpeed=pole(rate,p.attack), closeSpeed=pole(rate,p.release);
    const holdFrames=gate ? Math.round(rate*p.hold) : 0;
    return {tail:0,sidechain:true,cost:10,make() {
      const threshold=p.thresholdDb.reader(), range=p.rangeDb.reader();
      const hysteresis=gate && p.hysteresisDb.reader(), ratio=!gate && p.ratio.reader();
      const state={closeAt:0,isOpen:false,smoothed:undefined};
      return P.audioCheckpoint((l,r,kl,kr,t,out)=>{
        const key=level(Math.max(Math.abs(kl),Math.abs(kr))), edge=threshold(t), limit=range(t);
        let target;
        if (gate) {
          if (key>=(state.isOpen ? edge-hysteresis(t) : edge)) {state.isOpen=true;state.closeAt=t+holdFrames;}
          else if (t>=state.closeAt) state.isOpen=false;
          target=state.isOpen ? 0 : -limit;
        } else target=-Math.min(limit,Math.max(0,edge-key)*(ratio(t)-1));
        state.smoothed ??= target;
        state.smoothed+=(target-state.smoothed)*(target>state.smoothed ? openSpeed : closeSpeed);
        const gain=db(state.smoothed);
        out[0]=l*gain; out[1]=r*gain;
      },state);
    }};
  }
  S.parametricBand=band;
  S.parametricTail=(mode,rate,hz,q,db)=>tailFor(tuning(mode,rate,hz,q,db));
  S.mixerTool=(raw,rate,time)=>raw?.type==='eq' ? eq(raw,rate,time) :
    Object.hasOwn(schemas,raw?.type) ? dynamics(raw,rate,time) :
    ['deesser','band-duck'].includes(raw?.type) ? S.dialogueBand(raw,rate,time) : null;
})(KIT.procedural);
