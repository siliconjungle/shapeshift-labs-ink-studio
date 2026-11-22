/* Linked, frequency-selective dynamics shared by dialogue and mix inserts. */
(function (P) {
  const S=P.mediaGraphSupport,{fields,finite,integer,check}=P.musicInstruments;
  const pole=(rate,seconds)=>-Math.expm1(-1/(rate*seconds));
  const constant=value=>()=>value;
  const modes=['peak','low-shelf','high-shelf'];
  const detectorMode={'peak':'bandpass','low-shelf':'lowpass','high-shelf':'highpass'};
  function duration(mode,rate,hz,q,gains) {
    let tail=0;
    for (const f of hz) for (const width of q) for (const gain of gains)
      tail=Math.max(tail,S.parametricTail(mode,rate,f,width,gain));
    return tail;
  }
  function band(rate,{mode,hz,q,filter,keyHz,keyQ,attack,release,threshold,ratio,range,direction,base}) {
    const open=pole(rate,attack), close=pole(rate,release), peakFall=Math.exp(-1/(rate*.009));
    const detect=filter ? S.parametricBand(filter,rate,keyHz,keyQ,constant(0)) : null;
    const key=[0,0], state={gain:0,reduction:0,envelope:0};
    const apply=S.parametricBand(mode,rate,hz,q,()=>state.gain);
    const process=P.audioCheckpoint((l,r,kl,kr,t,out)=>{
      if (detect) detect(kl,kr,t,key);
      else {key[0]=kl;key[1]=kr;}
      state.envelope=Math.max(state.envelope*peakFall,Math.abs(key[0]),Math.abs(key[1]));
      const level=20*Math.log10(Math.max(1e-10,state.envelope));
      const limit=range(t), goal=Math.min(limit,Math.max(0,level-threshold(t))*(1-1/ratio(t)));
      state.reduction+=(goal-state.reduction)*(goal>state.reduction ? open : close);
      if (state.reduction<1e-8) state.reduction=0;
      state.gain=base(t)+direction*Math.min(limit,state.reduction);
      apply(l,r,t,out);
    },state);
    const save=process.snapshot, load=process.restore;
    return Object.assign(process,{
      snapshot:()=>[save(),apply.snapshot(),detect?.snapshot()],
      restore([main,output,input]) {load(main);apply.restore(output);if (detect) detect.restore(input);}
    });
  }

  function dialogueBand(raw,rate,time) {
    const {type}=raw, deesser=type==='deesser';
    const top=Math.min(24000,rate*.47);
    const {hz=Math.min(deesser ? 6400 : 2200,rate*.36),q=deesser ? .85 : 1.1,
      keyHz=deesser ? hz : undefined,keyQ=.8,attack=deesser ? .0013 : .012,release=deesser ? .075 : .18}=raw;
    check(fields(raw,['type','wet','hz','q','keyHz','keyQ','thresholdDb','ratio','rangeDb','attack','release']) &&
      finite(hz,20,top) && finite(q,.35,12) && (keyHz===undefined || finite(keyHz,20,top)) &&
      finite(keyQ,.35,12) && finite(attack,.0001,1) && finite(release,.001,4),
    'Invalid dynamic dialogue band, detector or envelope');
    const threshold=time.lane(raw.thresholdDb,deesser ? -26 : -34,-96,0,type+' threshold'),
      ratio=time.lane(raw.ratio,deesser ? 6 : 4,1,40,type+' ratio'),
      range=time.lane(raw.rangeDb,deesser ? 8 : 5,0,24,type+' range');
    const tail=range.max===0 ? 0 : duration('peak',rate,[hz],[q],[0,-range.max]);
    return {cost:24+(keyHz===undefined ? 0 : 10),tail,sidechain:!deesser,make() {
      return band(rate,{mode:'peak',hz:constant(hz),q:constant(q),filter:keyHz===undefined ? null : 'bandpass',
        keyHz:constant(keyHz),keyQ:constant(keyQ),attack,release,threshold:threshold.reader(),ratio:ratio.reader(),
        range:range.reader(),direction:-1,base:constant(0)});
    }};
  }

  function dynamicEq(raw,rate,time) {
    check(fields(raw,['type','wet','bands']) && Array.isArray(raw.bands) && integer(raw.bands.length,1,6),
      'Dynamic EQ needs one to six bands');
    let tail=0, cost=0;
    const setup=raw.bands.map(row=>{
      const {mode='peak',direction='cut',detector='band',attack=.008,release=.12}=row ?? {};
      check(fields(row,['mode','hz','q','gainDb','direction','detector','keyHz','keyQ',
        'attack','release','thresholdDb','ratio','rangeDb']) && modes.includes(mode) &&
        ['cut','boost'].includes(direction) && ['band','wide'].includes(detector) &&
        (detector!=='wide' || row.keyHz===undefined && row.keyQ===undefined) &&
        finite(attack,.0001,1) && finite(release,.001,4),'Invalid dynamic EQ band or detector');
      const top=Math.min(24000,rate*.47), setting=(name,fallback,min,max)=>time.lane(row[name],fallback,min,max,'Dynamic EQ '+name);
      const hz=setting('hz',1000,20,top), q=setting('q',.85,.35,12);
      const keyHz=row.keyHz===undefined ? hz : setting('keyHz',1000,20,top);
      const keyQ=row.keyQ===undefined ? q : setting('keyQ',.85,.35,12);
      const threshold=setting('thresholdDb',-26,-96,0), ratio=setting('ratio',3,1,40);
      const range=setting('rangeDb',6,0,18), base=setting('gainDb',0,-18,18);
      const sign=direction==='cut' ? -1 : 1;
      const far=sign*range.max;
      tail+=duration(mode,rate,[hz.min,hz.max],[q.min,q.max],[base.min,base.max,base.min+far,base.max+far]);
      cost+=34+(detector==='band' ? 12 : 0);
      return ()=>band(rate,{mode,hz:hz.reader(),q:q.reader(),filter:detector==='band' ?
        (row.keyHz===undefined ? detectorMode[mode] : 'bandpass') : null,keyHz:keyHz.reader(),keyQ:keyQ.reader(),
        threshold:threshold.reader(),ratio:ratio.reader(),range:range.reader(),base:base.reader(),
        attack,release,direction:sign});
    });
    return {cost,tail,sidechain:true,make() {
      const stages=setup.map(make=>make());
      return Object.assign((l,r,kl,kr,t,out)=>{
        out[0]=l;out[1]=r;
        for (const stage of stages) stage(out[0],out[1],kl,kr,t,out);
      },{
        snapshot:()=>stages.map(stage=>stage.snapshot()),
        restore(values) {stages.forEach((stage,i)=>stage.restore(values[i]));}
      });
    }};
  }

  S.dialogueBand=dialogueBand;
  S.dynamicEq=dynamicEq;
})(KIT.procedural);
