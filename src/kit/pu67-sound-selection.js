/* Deterministic one-shot selection for spatial event bindings. */
(function(K){
  const W=K.world,{check,record}=W.data;
  const {hash}=K.procedural.data, {noise}=K.procedural.musicInstruments;
  const finite=(value,min,max)=>Number.isFinite(value)&&value>=min&&value<=max;
  const key=value=>typeof value==='string'&&/^[A-Za-z0-9_][A-Za-z0-9._/-]{0,127}$/.test(value);
  const keys=(value,allowed)=>record(value)&&Object.keys(value).every(name=>allowed.includes(name));
  const labels=['action','object','surface'];
  const measurements=['strength','wetness'];
  const unit=value=>finite(value,0,1);
  const band=value=>Array.isArray(value)&&value.length===2&&value.every(unit)&&value[0]<value[1];
  const within=(range,value)=>range===undefined||unit(value)&&value>=range[0]&&(value<range[1]||value===1&&range[1]===1);

  function compile(raw,seed,cues){
    check(record(raw)&&Object.keys(raw).length<=128&&Number.isSafeInteger(seed),'Invalid spatial sound families or seed');
    const families=new Map(Object.entries(raw).map(([family,spec])=>{
      check(key(family)&&keys(spec,['takes'])&&record(spec.takes),'Invalid spatial sound family '+family);
      const ids=Object.keys(spec.takes).sort();
      check(ids.length>0&&ids.length<=64&&ids.every(key),'Sound family needs one to 64 named takes: '+family);
      const takes=ids.map(id=>{
        const value=spec.takes[id], take=typeof value==='string'?{cue:value}:value;
        check(keys(take,['cue','strength','weight'])&&cues.has(take.cue)&&
          (take.strength===undefined||band(take.strength))&&finite(take.weight??1,.000001,1000000),
        'Invalid sound take '+family+'/'+id);
        return {id,cue:take.cue,strength:take.strength,weight:take.weight??1};
      });
      return [family,takes];
    }));

    function rules(raw,binding){
      check(Array.isArray(raw)&&raw.length>0&&raw.length<=64,'Expected sound selection rules for '+binding);
      const ids=new Set();
      return Array.from(raw,row=>{
        check(keys(row,['id','when','family'])&&key(row.id)&&!ids.has(row.id)&&families.has(row.family)&&
          keys(row.when??{},[...labels,...measurements]),'Invalid sound selection rule for '+binding);
        const when=row.when??{};
        check(labels.every(name=>when[name]===undefined||key(when[name]))&&
          measurements.every(name=>when[name]===undefined||band(when[name])),'Invalid context in sound rule '+row.id);
        ids.add(row.id);
        return {id:row.id,when,family:row.family,takes:families.get(row.family)};
      });
    }

    function choose(rules,context,event,binding){
      for(const {id,when,family,takes} of rules){
        if(!labels.every(name=>when[name]===undefined||when[name]===context[name])||
          !measurements.every(name=>within(when[name],context[name])))continue;
        const eligible=takes.filter(take=>within(take.strength,context.strength));
        if(!eligible.length)continue;
        const total=eligible.reduce((sum,take)=>sum+take.weight,0);
        let draw=(noise(0,hash(JSON.stringify(['sound-take-v1',seed,event,binding,id,family])))+1)*.5*total;
        const chosen=eligible.find(take=>(draw-=take.weight)<0)??eligible.at(-1);
        return {cue:chosen.cue,selection:{binding,rule:id,family,take:chosen.id,context,eligible:eligible.map(take=>take.id)}};
      }
      return null;
    }
    return {rules,choose};
  }

  function contactContext(row,contact,profile,speedForFullStrength){
    const details=record(row.contact)?row.contact:contact;
    const authored=[row,details,row.fact?.data,row.data];
    const value=(name,valid)=>authored.map(item=>item?.[name]).find(valid);
    const action=value('action',key)??[row.interaction,row.kind].find(key);
    const object=value('object',key)??[row.entity,row.source].find(key);
    const surface=value('surface',key)??[row.material,details?.material,profile?.id].find(key);
    const speed=speedForFullStrength===undefined?undefined:value('speed',n=>Number.isFinite(n)&&n>=0);
    const strength=value('strength',unit)??(speed===undefined?undefined:Math.min(1,speed/speedForFullStrength));
    const wetness=value('wetness',unit)??(unit(profile?.wetness)?profile.wetness:undefined);
    return Object.fromEntries(Object.entries({action,object,surface,strength,wetness}).filter(([,item])=>item!==undefined));
  }
  W.spatialSoundSelection=Object.freeze({compile,contactContext});
})(KIT);
