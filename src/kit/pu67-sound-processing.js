/* Resolve source coloration and acoustic-path treatments without touching the asset. */
(function(K){
  const W=K.world, {check,record}=W.data, {freeze}=K.procedural.data;
  const finite=(n,min,max)=>Number.isFinite(n)&&n>=min&&n<=max;
  const token=value=>typeof value==='string'&&value.length>0&&value.length<=512&&!!value.trim();
  const keys=(row,allowed)=>record(row)&&Object.keys(row).every(name=>allowed.includes(name));
  const direct=['cue','object','entity'];
  const neutral=freeze({profiles:[],lowpass:22000,highpass:0,peaks:[],gainDb:0});

  function compile(config){
    check(keys(config,['profiles','path','rules'])&&record(config.profiles)&&
      (config.path===undefined||token(config.path)),'Invalid spatial sound processing');
    const entries=Object.entries(config.profiles);
    check(entries.length>0&&entries.length<=64,'Spatial sound processing needs one to 64 profiles');
    const profiles=new Map(entries.map(([name,row])=>{
      check(token(name)&&keys(row,['lowpass','highpass','peaks','gainDb']),'Invalid sound profile '+name);
      const {lowpass=22000,highpass=0,peaks=[],gainDb=0}=row;
      check(finite(lowpass,40,22000)&&finite(highpass,0,4000)&&highpass<lowpass&&finite(gainDb,-36,12)&&
        Array.isArray(peaks)&&peaks.length<=2&&Array.from(peaks).every(peak=>
          keys(peak,['hz','q','gainDb'])&&finite(peak.hz,40,16000)&&finite(peak.q,.25,12)&&finite(peak.gainDb,-24,18)),
      'Invalid sound profile '+name);
      return [name,freeze({lowpass,highpass,peaks,gainDb})];
    }));
    const {rules=[],path}=config, ids=new Set();
    check(Array.isArray(rules)&&rules.length<=128,'Invalid spatial sound processing rules');
    const compiled=Array.from(rules,row=>{
      check(keys(row,['id','profile','when'])&&token(row.id)&&!ids.has(row.id)&&profiles.has(row.profile)&&
        keys(row.when,[...direct,'room','opening','maxOpen','medium','minMeters'])&&Object.keys(row.when).length>0,
      'Invalid sound processing rule');
      const {when}=row, needsPath=['room','opening','medium'].some(key=>when[key]!==undefined);
      check([...direct,'room','opening','medium'].every(key=>when[key]===undefined||token(when[key]))&&
        (!needsPath||path!==undefined)&&
        (when.maxOpen===undefined||when.opening!==undefined&&finite(when.maxOpen,0,1))&&
        (when.minMeters===undefined||when.medium!==undefined&&finite(when.minMeters,0,1e6)),
      'Invalid sound processing rule '+row.id);
      ids.add(row.id);
      return {...row,needsPath};
    });

    function resolve(base,context,query,from,to){
      let pathRead=false, route;
      function matches({when,needsPath}){
        if(!direct.every(key=>when[key]===undefined||when[key]===context[key]))return false;
        if(!needsPath)return true;
        if(!pathRead){
          pathRead=true;
          const reading=from&&to&&query?.trace(path,to,{from});
          const result=reading?.status==='ok'?reading.value?.path:null;
          if(result&&[result.rooms,result.openings,result.segments].every(Array.isArray))route=result;
        }
        if(!route||when.room!==undefined&&!route.rooms.includes(when.room))return false;
        if(when.opening!==undefined&&!route.openings.some(opening=>
          opening.id===when.opening&&(when.maxOpen===undefined||opening.fraction<=when.maxOpen)))return false;
        if(when.medium!==undefined){
          let meters=0;
          for(const segment of route.segments)for(const part of segment.media)
            if(part.medium===when.medium)meters+=part.meters;
          if(meters<=0||meters<(when.minMeters??0))return false;
        }
        return true;
      }
      const rule=compiled.find(matches);
      const selected=[...new Set([base,rule?.profile].filter(name=>profiles.has(name)))];
      if(!selected.length)return neutral;
      const rows=selected.map(name=>profiles.get(name));
      return {profiles:selected,...(rule&&{rule:rule.id}),
        lowpass:Math.min(...rows.map(profile=>profile.lowpass)),highpass:Math.max(...rows.map(profile=>profile.highpass)),
        peaks:rows.flatMap(profile=>profile.peaks),gainDb:rows.reduce((sum,profile)=>sum+profile.gainDb,0)};
    }
    return {has:name=>profiles.has(name),resolve};
  }

  W.spatialSoundProcessing=Object.freeze({compile});
})(KIT);
