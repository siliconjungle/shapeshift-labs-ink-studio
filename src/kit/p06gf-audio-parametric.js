/* Shared stereo state-variable filter for cue and mixer EQ. */
(function (P) {
  const {db}=P.musicInstruments;
  function tuning(mode,rate,hz,q,gainDb) {
    let g=Math.tan(Math.PI*hz/rate), k=1/q;
    const a=db(gainDb/2);
    if (mode==='peak') k/=a;
    if (mode==='low-shelf') g/=Math.sqrt(a);
    if (mode==='high-shelf') g*=Math.sqrt(a);
    return {g,k,a};
  }
  function band(mode,rate,hz,q,gainDb) {
    // State-variable outputs are mixed into the selected EQ response.
    let lastHz,lastQ,lastGain,g,k,m0,m1,m2,a1,a2,a3;
    const ic1=new Float64Array(2), ic2=new Float64Array(2);
    return P.audioCheckpoint((l,r,t,out)=>{
      const f=hz(t), width=q(t), gain=gainDb(t);
      if (f!==lastHz || width!==lastQ || gain!==lastGain) {
        const settings=tuning(mode,rate,f,width,gain), {a}=settings;
        ({g,k}=settings);
        const squared=a*a;
        m0=1; m1=0; m2=0;
        if (mode==='peak') m1=k*(squared-1);
        else if (mode==='low-shelf') {m1=k*(a-1);m2=squared-1;}
        else if (mode==='high-shelf') {m0=squared;m1=k*(1-a)*a;m2=1-squared;}
        else if (mode==='lowpass') {m0=0;m2=1;}
        else if (mode==='highpass') {m1=-k;m2=-1;}
        else if (mode==='bandpass') {m0=0;m1=k;}
        else m1=-k;
        a1=1/(1+g*(g+k)); a2=g*a1; a3=g*a2;
        lastHz=f; lastQ=width; lastGain=gain;
      }
      for (let ch=0;ch<2;ch++) {
        const x=ch===0 ? l : r, v3=x-ic2[ch];
        const v1=a1*ic1[ch]+a2*v3, v2=ic2[ch]+a2*ic1[ch]+a3*v3;
        ic1[ch]=2*v1-ic1[ch]; ic2[ch]=2*v2-ic2[ch];
        out[ch]=m0*x+m1*v1+m2*v2;
      }
    },ic1,ic2);
  }
  P.audioParametric=Object.freeze({tuning,band});
})(KIT.procedural);
