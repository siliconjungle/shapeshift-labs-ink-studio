/* Reusable patch gestures and deterministic phrase automation. */
(function (P) {
  const I=P.musicInstruments, {record,fields,finite,id,check,clamp}=I;
  const tau=2*Math.PI;
  const mixFields=['gain','pan','cutoff','echo'];
  const noteFields=['gate','glide','vibrato','brightness','accent','delay','articulation','legato'];
  const numeric={
    gain:[-48,12],pan:[-1,1],cutoff:[80,24000],echo:[0,1],
    gate:[.05,2],glide:[0,2],vibrato:[0,100],brightness:[0,1],accent:[0,2],delay:[-.1,.1]
  };
  function value(raw,name) {
    if (name==='articulation') return id(raw);
    if (name==='legato') return typeof raw==='boolean';
    return finite(raw,...numeric[name]);
  }

  function patch(raw,assets) {
    check(record(raw),'Expected a music patch');
    const {gestures={},echo,...instrument}=raw;
    check(record(gestures) && Object.keys(gestures).length<=24 && Object.keys(gestures).every(id),'Invalid patch gestures');
    const curves=Object.fromEntries(Object.entries(gestures).map(([name,gesture])=>{
      check(fields(gesture,[...mixFields,...noteFields]) && Object.keys(gesture).length,'A gesture needs named curves');
      const compiled=Object.fromEntries(Object.entries(gesture).map(([lane,points])=>{
        let previous=-1;
        check(Array.isArray(points) && points.length>=1 && points.length<=32,'Gesture curves allow one to thirty-two points');
        return [lane,Array.from(points,point=>{
          check(Array.isArray(point) && point.length===2 && finite(point[0],0,1) &&
            point[0]>previous && value(point[1],lane),'Invalid gesture point on '+lane);
          previous=point[0];
          return point.slice();
        })];
      }));
      check(echo || !compiled.echo,'An echo curve needs an echo processor on its patch');
      return [name,compiled];
    }));
    let tape;
    if (echo!==undefined) {
      check(fields(echo,['delay','feedback','damping','wow','flutter','width','send']),'Invalid tape echo settings');
      tape={delay:.25,feedback:.36,damping:.5,wow:.16,flutter:.12,width:.4,send:0,...echo};
      check(finite(tape.delay,.025,1.5) && finite(tape.feedback,0,.8) &&
        ['damping','wow','flutter','width','send'].every(name=>finite(tape[name],0,1)),'Invalid tape echo parameter');
    }
    return {player:I.compile(instrument,assets),gestures:curves,echo:tape,
      color:instrument.color ?? (instrument.type==='drum' ? .55 : instrument.type==='keys' ? .5 : .6)};
  }

  function score(raw,patch,plan,clock) {
    if (raw===undefined) return [];
    check(Array.isArray(raw) && raw.length<=128,'A track allows up to 128 gesture placements');
    const total=plan.sections.at(-1).end;
    const placements=Array.from(raw,entry=>{
      check(fields(entry,['gesture','section','from','to','amount']) && Object.hasOwn(patch.gestures,entry.gesture),
        'A placement needs a gesture from the track patch');
      const section=entry.section===undefined ? null : plan.sections.find(candidate=>candidate.id===entry.section);
      check(entry.section===undefined || section,'Unknown gesture section');
      const origin=section?.beat ?? 0, length=section ? section.end-origin : total;
      const {from=0,to=length,amount=1}=entry;
      check(finite(from,0,length) && finite(to,from+1e-5,length) && finite(amount,0,1),'Invalid gesture range or strength');
      const start=origin+from, end=origin+to;
      const curves=patch.gestures[entry.gesture];
      const mixers=Object.fromEntries(mixFields.filter(name=>curves[name]).map(name=>[name,curves[name].map(([phase,value])=>
        [clock.timeAt({beat:start+(end-start)*phase}),value])]));
      return {gesture:entry.gesture,...(section && {section:section.id}),start,end,amount,curves,mixers,
        time:clock.timeAt({beat:start}),endTime:clock.timeAt({beat:end})};
    }).sort((a,b)=>a.start-b.start);
    check(placements.every((entry,index)=>index===0 || placements[index-1].end<=entry.start+1e-9),
      'Gesture placements on a track cannot overlap');
    return placements;
  }

  function at(placements,position,key,endKey) {
    let lo=0, hi=placements.length;
    while (lo<hi) {
      const mid=(lo+hi)>>>1;
      if (placements[mid][key]<=position+1e-9) lo=mid+1;
      else hi=mid;
    }
    const found=placements[lo-1];
    return found && position<found[endKey]-1e-9 ? found : null;
  }
  function sample(curve,x,step=false) {
    let i=1;
    while (i<curve.length && curve[i][0]<=x) i++;
    const a=curve[i-1], b=curve[i];
    if (step || !b || x<=a[0]) return a[1];
    return a[1]+(b[1]-a[1])*(x-a[0])/(b[0]-a[0]);
  }

  function perform(placements,beat,base,color) {
    const entry=at(placements,beat,'start','end');
    if (!entry?.amount) return {play:base,accent:1,legato:false};
    const phase=clamp((beat-entry.start)/(entry.end-entry.start)), play={...base};
    const {curves,amount}=entry;
    for (const name of ['gate','glide','vibrato','brightness','delay']) if (curves[name]) {
      const defaultValue=name==='gate'?1:name==='brightness'?color:0;
      const original=play[name] ?? defaultValue;
      const target=sample(curves[name],phase);
      play[name]=name==='delay' ? Math.max(-.125,Math.min(.125,original+target*amount)) :
        original+(target-original)*amount;
    }
    if (curves.articulation && amount>=.5) play.articulation=sample(curves.articulation,phase,true);
    const legato=curves.legato && amount>=.5 && sample(curves.legato,phase,true);
    return {play,legato:Boolean(legato),gesture:entry.gesture,
      accent:curves.accent ? 1+(sample(curves.accent,phase)-1)*amount : 1};
  }

  function automate(placements,defaults,rate) {
    if (!placements.some(entry=>entry.amount && Object.keys(entry.mixers).length)) return null;
    const smooth=1-Math.exp(-1/(rate*.007));
    const state={...defaults};
    let index=0;
    return time=>{
      while (index<placements.length && placements[index].endTime<=time+1e-9) index++;
      const active=placements[index];
      const entry=active && active.time<=time+1e-9 ? active : null;
      for (const name of mixFields) {
        const base=defaults[name], curve=entry?.mixers[name];
        const target=curve ? base+(sample(curve,time)-base)*entry.amount : base;
        state[name]+=(target-state[name])*smooth;
      }
      return state;
    };
  }

  function tapeEcho(spec,rate) {
    if (!spec) return null;
    const frames=Math.ceil(rate*(spec.delay+.01))+4;
    const left=new Float32Array(frames),right=new Float32Array(frames), out=[0,0];
    const pole=1-Math.exp(-tau*(1250+7100*(1-spec.damping))/rate);
    const delay=rate*spec.delay,wow=rate*.004*spec.wow,flutter=rate*.0008*spec.flutter;
    let write=0,l=0,r=0;
    const read=(buffer,age)=>{
      const at=write+frames-age, i=Math.floor(at);
      const a=buffer[i%frames], b=buffer[(i+1)%frames];
      return a+(b-a)*(at-i);
    };
    return (frame,inputL,inputR,send)=>{
      const time=frame/rate;
      const drift=wow*Math.sin(tau*time*.48)+flutter*Math.sin(tau*time*5.8);
      const wetL=read(left,delay+drift),wetR=read(right,delay+drift*.81+spec.width*rate*.003);
      l+=(wetL-l)*pole; r+=(wetR-r)*pole;
      const cross=spec.width*.45;
      left[write]=Math.tanh(inputL*send+(l+(r-l)*cross)*spec.feedback);
      right[write]=Math.tanh(inputR*send+(r+(l-r)*cross)*spec.feedback);
      write=(write+1)%frames;
      out[0]=l; out[1]=r;
      return out;
    };
  }

  P.musicGestures=Object.freeze({patch,score,perform,automate,tapeEcho});
})(KIT.procedural);
