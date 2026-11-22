/* Band-limited reconstruction and decimation around a nonlinear offline insert. */
(function (P) {
  const S=P.mediaGraphSupport,{fields,check,db}=P.musicInstruments;
  const radius=24, sinc=x=>x===0 ? 1 : Math.sin(Math.PI*x)/(Math.PI*x);
  const window=x=>Math.abs(x)>=1 ? 0 : .42+.5*Math.cos(Math.PI*x)+.08*Math.cos(2*Math.PI*x);
  const kernels=new Map();
  function normalized(length,tap) {
    const values=Float64Array.from({length},(_,i)=>tap(i)), sum=values.reduce((a,b)=>a+b,0);
    return values.map(value=>value/sum);
  }
  function filters(factor) {
    if (!kernels.has(factor)) {
      const up=Array.from({length:factor-1},(_,phase)=>normalized(radius*2,tap=>{
        const x=radius-1+(phase+1)/factor-tap;
        return sinc(x)*window(x/radius);
      }));
      const reach=radius*factor;
      const down=normalized(2*reach+1,tap=>{
        const x=tap-reach;
        return sinc(.94*x/factor)*window(x/reach);
      });
      kernels.set(factor,{up,down,reach});
    }
    return kernels.get(factor);
  }
  function clip(x,ceiling,width) {
    const level=Math.abs(x);
    if (!width || level>=ceiling+width) return Math.sign(x)*Math.min(ceiling,level);
    if (level<=ceiling-width) return x;
    const extra=level-ceiling+width;
    return Math.sign(x)*(level-extra*extra/(4*width));
  }
  S.oversampledWaveshaper=(raw,rate,time)=>{
    const saturate=raw.type==='saturation', factor=raw.oversample ?? 4;
    const specific=saturate ? ['bias','toneHz'] : ['ceilingDb','kneeDb'];
    check(fields(raw,['type','wet','oversample','driveDb','outputDb',...specific]) && [2,4,8].includes(factor),
      'Choose 2×, 4× or 8× oversampling and valid waveshaper controls');
    const control=(name,fallback,min,max)=>time.lane(raw[name],fallback,min,max,raw.type+' '+name);
    const drive=control('driveDb',saturate ? 8 : 0,-24,24), outputGain=control('outputDb',saturate ? -2 : 0,-24,24);
    const bias=saturate ? control('bias',0,-.65,.65) : null;
    const tone=saturate ? control('toneHz',7200,200,24000) : null;
    const ceiling=saturate ? null : control('ceilingDb',-1,-24,0);
    const knee=saturate ? null : control('kneeDb',0,0,12);
    const {up,down,reach}=filters(factor);
    const pole=hz=>-Math.expm1(-2*Math.PI*hz/(rate*factor));
    function block(input,output) {
      const frames=input.length/2, count=output.length/2, capacity=2*reach+factor+1;
      const left=new Float64Array(capacity), right=new Float64Array(capacity), dc=new Float64Array(2), low=new Float64Array(2);
      const readDrive=drive.reader(), readOutput=outputGain.reader(), controlA=(bias ?? ceiling).reader(),
        controlB=(tone ?? knee).reader();
      const dcPole=pole(16);
      let online=0;
      for (let frame=-radius;frame<count+radius;frame++) {
        const first=frame-radius+1, begin=Math.max(0,-first), end=Math.min(2*radius,frames-first);
        for (let phase=0;phase<factor;phase++) {
          let l=0,r=0;
          if (!phase) {
            l=input[frame*2] ?? 0;r=input[frame*2+1] ?? 0;
          } else {
            const kernel=up[phase-1];
            for (let tap=begin;tap<end;tap++) {
              const i=2*(first+tap), weight=kernel[tap];
              l+=input[i]*weight;r+=input[i+1]*weight;
            }
          }
          const at=frame+phase/factor, gain=db(readDrive(at)), trim=db(readOutput(at)), a=controlA(at), b=controlB(at);
          let outL,outR;
          if (saturate) {
            const shift=Math.tanh(a), color=pole(b);
            const x=Math.tanh(l*gain+a)-shift, y=Math.tanh(r*gain+a)-shift;
            dc[0]+=(x-dc[0])*dcPole;dc[1]+=(y-dc[1])*dcPole;
            low[0]+=(x-dc[0]-low[0])*color;low[1]+=(y-dc[1]-low[1])*color;
            outL=low[0];outR=low[1];
          } else {
            const limit=db(a), width=limit*(1-db(-b));
            outL=clip(l*gain,limit,width);outR=clip(r*gain,limit,width);
          }
          left[online]=outL*trim;right[online]=outR*trim;
          if (++online===capacity) online=0;
        }
        if (frame<radius) continue;
        let l=0,r=0, index=(online+1)%capacity;
        for (let tap=0;tap<down.length;tap++) {
          const weight=down[tap];
          l+=left[index]*weight;r+=right[index]*weight;
          if (++index===capacity) index=0;
        }
        const outputFrame=frame-radius;
        output[outputFrame*2]=l;output[outputFrame*2+1]=r;
      }
      return {oversample:factor,interpolator:'windowed-sinc',lookaheadSamples:2*radius,
        ...(saturate ? {} : {ceiling:'internal waveshaper'})};
    }
    // The centered interpolator and decimator each need one radius of future signal.
    const tail=2*radius+(saturate ? Math.ceil(Math.log(1000)*rate/(2*Math.PI*16)) : 0);
    return {latency:2*radius,tail,cost:12*factor,block};
  };
})(KIT.procedural);
