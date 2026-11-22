/* Native insert contracts report algorithmic latency and audible tail separately. */
(function (P) {
  const S=P.mediaGraphSupport, {fields,finite,check,db}=P.musicInstruments;
  const checkpoint=P.audioCheckpoint;
  const floorLevel=.001, levelDb=x=>20*Math.log10(Math.max(1e-10,x));
  const schema={
    gain:{db:[0,-96,24]},
    drive:{amount:[2,.1,12]},
    lowpass:{hz:[3200,20,24000]},
    highpass:{hz:[80,20,24000]},
    delay:{seconds:[.18,.001,2,true],feedback:[.35,0,.85]},
    reverb:{decay:[1.65,.08,8,true],size:[1,.3,2,true],damping:[.44,0,.94]},
    compressor:{thresholdDb:[-24,-80,0],ratio:[4,1,40],attack:[.007,.0001,1,true],
      release:[.11,.001,4,true],lookahead:[0,0,.15,true],makeupDb:[0,-24,24]}
  };
  function compile(raw,rate,time,asset,host) {
    const type=raw?.type, wet=time.lane(raw?.wet,1,0,1,type+' wet');
    if (type==='limiter') return S.mixerPeak.limiter(raw,rate,time,wet);
    if (type==='external') return S.externalMixerInsert(raw,rate,time,wet,host);
    const design=S.soundDesign(raw,rate,time,asset);
    if (design) {
      if (wet.max===0) return {type,latency:design.latency ?? 0,wet,tail:0,cost:1,block() {}};
      return {type,latency:0,wet,...design};
    }
    const tool=S.mixerTool(raw,rate,time);
    if (tool) return {type,latency:0,wet,...tool,tail:wet.max===0 ? 0 : tool.tail};
    const controls=Object.hasOwn(schema,type) && schema[type];
    check(controls && fields(raw,['type','wet',...Object.keys(controls)]),'Unknown mixer processor or parameter');
    const params=Object.fromEntries(Object.entries(controls).map(([name,[fallback,min,max,fixed]])=>{
      const value=raw[name] ?? fallback;
      if (fixed) {
        check(finite(value,min,max),'Invalid fixed '+type+' '+name);
        return [name,value];
      }
      return [name,time.lane(value,fallback,min,max,type+' '+name)];
    }));
    const latency=type==='compressor' ? Math.round(params.lookahead*rate) : 0;
    let tail=0, delayFrames, roomLines;
    if (type==='delay') {
      delayFrames=Math.max(1,Math.round(params.seconds*rate));
      const feedback=params.feedback.max;
      tail=delayFrames*(feedback===0 ? 1 : 1+Math.ceil(Math.log(floorLevel)/Math.log(feedback)));
    } else if (type==='reverb') {
      roomLines=[.0193,.0277,.0349,.0437,.0211,.0293,.0371,.0473].map(t=>{
        const size=Math.max(1,Math.round(t*params.size*rate));
        return {size,feedback:floorLevel**(size/(rate*params.decay))};
      });
      const damp=params.damping.max;
      // Use the slower pole of the damped comb, including its round-trip lag.
      tail=Math.max(...roomLines.map(({size,feedback})=>{
        let low=0, high=-Math.log(feedback)/size;
        for (let i=0;i<24;i++) {
          const mid=(low+high)/2;
          if (damp*Math.exp(mid)+(1-damp)*feedback*Math.exp(mid*size)<1) low=mid;
          else high=mid;
        }
        return size+Math.ceil(-Math.log(floorLevel)/low);
      }));
    } else if (type==='lowpass' || type==='highpass') {
      const pole=S.sampleKitMix.poleAt(params.hz.min,rate);
      tail=Math.ceil(Math.log(floorLevel)/Math.log1p(-pole));
    }
    function make() {
      if (type==='gain') {
        const gain=params.db.reader();
        return checkpoint((l,r,kl,kr,t,out)=>{
          const scale=db(gain(t));
          out[0]=l*scale; out[1]=r*scale;
        });
      }
      if (type==='drive') {
        const drive=params.amount.reader();
        return checkpoint((l,r,kl,kr,t,out)=>{
          const amount=drive(t), norm=1/Math.tanh(amount);
          out[0]=Math.tanh(l*amount)*norm; out[1]=Math.tanh(r*amount)*norm;
        });
      }
      if (type==='lowpass' || type==='highpass') {
        const hz=params.hz.reader(), high=type==='highpass';
        const state={lowL:0,lowR:0};
        return checkpoint((l,r,kl,kr,t,out)=>{
          const a=S.sampleKitMix.poleAt(hz(t),rate);
          state.lowL+=(l-state.lowL)*a; state.lowR+=(r-state.lowR)*a;
          out[0]=high ? l-state.lowL : state.lowL; out[1]=high ? r-state.lowR : state.lowR;
        },state);
      }
      if (type==='delay') {
        const feedback=params.feedback.reader(), line=new Float64Array(delayFrames*2);
        const state={index:0};
        return checkpoint((l,r,kl,kr,t,out)=>{
          const retain=feedback(t), {index}=state;
          out[0]=line[index]; out[1]=line[index+1];
          line[index]=l+out[0]*retain; line[index+1]=r+out[1]*retain;
          state.index=(index+2)%line.length;
        },state,line);
      }
      if (type==='reverb') {
        const damping=params.damping.reader(), channels=[0,0];
        const lines=roomLines.map(({size,feedback})=>({ring:new Float64Array(size),state:{at:0,damped:0},feedback}));
        return checkpoint((l,r,kl,kr,t,out)=>{
          const damp=damping(t);
          channels[0]=.81*l+.19*r; channels[1]=.81*r+.19*l;
          out[0]=0; out[1]=0;
          for (let i=0;i<lines.length;i++) {
            const {ring,state,feedback}=lines[i], channel=i<4 ? 0 : 1;
            const sample=ring[state.at];
            state.damped+=(sample-state.damped)*(1-damp);
            ring[state.at]=channels[channel]+state.damped*feedback;
            if (++state.at===ring.length) state.at=0;
            out[channel]+=sample*.25;
          }
        },...lines.flatMap(({ring,state})=>[ring,state]));
      }
      const threshold=params.thresholdDb.reader(), ratio=params.ratio.reader(), makeup=params.makeupDb.reader();
      const attack=1-Math.exp(-1/(rate*params.attack)), release=1-Math.exp(-1/(rate*params.release));
      const state={smooth:0};
      return checkpoint((l,r,kl,kr,t,out)=>{
        const over=Math.max(0,levelDb(Math.max(Math.abs(kl),Math.abs(kr)))-threshold(t));
        const aim=over*(1/ratio(t)-1);
        state.smooth+=(aim-state.smooth)*(aim<state.smooth ? attack : release);
        const gain=db(state.smooth+makeup(t));
        out[0]=l*gain; out[1]=r*gain;
      },state);
    }
    return {type,latency,tail:wet.max===0 ? 0 : tail,sidechain:type==='compressor',wet,make,
      cost:type==='reverb' ? 28 : 8};
  }
  S.mixerProcessor=compile;
})(KIT.procedural);
