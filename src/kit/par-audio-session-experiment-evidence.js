/* Cheap measurements and allocation for a session experiment's listening rounds. */
(function (P) {
  const {check}=P.musicInstruments;
  const round=n=>Number(n.toFixed(6)), db=(power)=>10*Math.log10(Math.max(1e-16,power));
  const mean=rows=>rows.reduce((sum,value)=>sum+value,0)/Math.max(1,rows.length);

  function measure(result,taps,targets,from=0,to=result.report.frames) {
    const {value,report}=result, master=value.samples, hop=Math.round(value.sampleRate*.024);
    const pick=name=>result.taps[taps[name]]?.samples;
    const hook=pick('hook'), kick=pick('kick'), bass=pick('bass');
    const shape=[], active=[], pulse=[];
    let signal=0, peak=0;
    for (let start=from;start<to;start+=hop) {
      const end=Math.min(to,start+hop), n=(end-start)*2;
      let sum=0,h=0,bed=0,k=0,b=0;
      for (let i=start*2;i<end*2;i++) {
        const x=master[i];
        peak=Math.max(peak,Math.abs(x));
        sum+=x*x;
        if (hook) {h+=hook[i]**2;bed+=(x-hook[i])**2;}
        if (kick) k+=kick[i]**2;
        if (bass) b+=bass[i]**2;
      }
      signal+=sum;
      shape.push(sum/n);
      if (hook) active.push({start,hook:h/n,bed:bed/n});
      if (kick) pulse.push({start,kick:k/n,bass:b/n});
    }
    const count=(to-from)*2, rmsDb=db(signal/Math.max(1,count)), peakDb=db(peak*peak);
    check(Number.isFinite(rmsDb) && Number.isFinite(peakDb),'Nonfinite experiment audio');
    const powers=shape.slice().sort((a,b)=>a-b);
    const percentile=part=>powers[Math.min(powers.length-1,Math.floor(part*powers.length))] ?? 0;
    const contrast=db(percentile(.90))-db(percentile(.48));
    let exposure=null, overlap=null, hookFirstSample=null;
    const loudest=active.reduce((best,row)=>Math.max(best,row.hook),0);
    if (loudest>1e-12) {
      const audible=active.filter(row=>row.hook>=loudest*.06);
      exposure=db(mean(audible.map(row=>row.hook)))-db(mean(audible.map(row=>row.bed)));
      hookFirstSample=report.warmupSamples+audible[0].start;
    }
    const maxKick=pulse.reduce((best,row)=>Math.max(best,row.kick),0);
    const maxBass=pulse.reduce((best,row)=>Math.max(best,row.bass),0);
    const strikes=maxKick>1e-12 ? pulse.filter(row=>row.kick>=maxKick*.22) : [];
    const kickFirstSample=strikes.length ? report.warmupSamples+strikes[0].start : null;
    if (strikes.length && maxBass>1e-12) overlap=mean(strikes.map(row=>Math.sqrt(row.bass/maxBass)));
    const closeness=(value,target,tolerance)=>1/(1+Math.abs(value-target)/tolerance);
    const foreground=exposure===null ? hook ? 0 : closeness(rmsDb,targets.levelDb,9) : closeness(exposure,targets.hookDb,6);
    const dynamic=closeness(contrast,targets.contrastDb,8);
    const pocket=overlap===null ? dynamic : .4*dynamic+.6*closeness(overlap,targets.kickBass,.25);
    return {rmsDb:round(rmsDb),peakDb:round(peakDb),hookToBedDb:exposure===null ? null : round(exposure),
      contrastDb:round(contrast),kickBassOverlap:overlap===null ? null : round(overlap),hookFirstSample,kickFirstSample,
      foreground:round(foreground),pocket:round(pocket),gain:report.mixer.headroom};
  }

  function advance(candidates,{limit,disagreement,diversity},seed) {
    const tie=row=>P.musicInstruments.hash([seed,row.id])>>>0;
    const by=(rank)=>[...candidates].sort((a,b)=>b.metrics[rank]-a.metrics[rank] || tie(a)-tie(b) || a.id.localeCompare(b.id));
    const ranks=['foreground','pocket'];
    const tables=ranks.map(name=>{
      const ordered=by(name), table=new Map();
      for (let from=0;from<ordered.length;) {
        let to=from+1;
        while (to<ordered.length && ordered[to].metrics[name]===ordered[from].metrics[name]) to++;
        for (let i=from;i<to;i++) table.set(ordered[i].id,(from+to+1)*.5);
        from=to;
      }
      return table;
    });
    for (const row of candidates) {
      const [foreground,pocket]=tables.map(table=>table.get(row.id));
      row.ranks={foreground,pocket,consensus:round((row.metrics.foreground+row.metrics.pocket)*.5),
        disagreement:round(Math.abs(foreground-pocket)/Math.max(1,candidates.length-1))};
    }
    const best=[...candidates].sort((a,b)=>b.ranks.consensus-a.ranks.consensus || tie(a)-tie(b) || a.id.localeCompare(b.id));
    const disagree=best.slice().sort((a,b)=>b.ranks.disagreement-a.ranks.disagreement ||
      Math.min(a.ranks.foreground,a.ranks.pocket)-Math.min(b.ranks.foreground,b.ranks.pocket) ||
      b.ranks.consensus-a.ranks.consensus || tie(a)-tie(b) || a.id.localeCompare(b.id));
    const kept=new Map(), families=new Set(), audio=new Set();
    function add(row,slot) {
      kept.set(row.id,{id:row.id,...slot});
      audio.add(row.fingerprint);
      for (const [axis,entry] of Object.entries(row.axes)) families.add(axis+'/'+entry.family);
    }
    function eligible(row) {
      if (kept.has(row.id)) return false;
      // A cue's setup or aftermath can differ beyond the scout.
      return !audio.has(row.fingerprint) || !families.has('cue/'+row.axes.cue?.family) && row.axes.cue!==undefined;
    }
    const coverage=limit-disagreement;
    for (const axis of diversity) {
      if (!best.some(row=>row.axes[axis])) continue;
      for (const row of best) {
        if (kept.size>=coverage) break;
        const family=row.axes[axis].family;
        if (!families.has(axis+'/'+family) && eligible(row)) add(row,{reason:'coverage',axis,family});
      }
    }
    for (const row of best) {
      if (kept.size>=coverage) break;
      if (eligible(row)) add(row,{reason:'consensus'});
    }
    let contested=0;
    for (const row of disagree) {
      if (contested>=disagreement || kept.size>=limit) break;
      if (row.ranks.disagreement>0 && eligible(row)) {
        add(row,{reason:'disagreement'});
        contested++;
      }
    }
    for (const row of best) {
      if (kept.size>=limit) break;
      if (eligible(row)) add(row,{reason:'consensus'});
    }
    return [...kept.values()];
  }
  P.mediaGraphSupport.sessionExperimentEvidence=Object.freeze({measure,advance});
})(KIT.procedural);
