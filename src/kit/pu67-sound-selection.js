/* Deterministic one-shot selection for spatial event bindings. */
(function(K){
  const W=K.world,{check,record,vector}=W.data;
  const {hash}=K.procedural.data, {noise}=K.procedural.musicInstruments;
  const finite=(value,min,max)=>Number.isFinite(value)&&value>=min&&value<=max;
  const key=value=>typeof value==='string'&&/^[A-Za-z0-9_][A-Za-z0-9._/-]{0,127}$/.test(value);
  const keys=(value,allowed)=>record(value)&&Object.keys(value).every(name=>allowed.includes(name));
  const labels=['action','object','surface','prop'];
  const measurements=['strength','wetness'];
  const unit=value=>finite(value,0,1);
  const band=value=>Array.isArray(value)&&value.length===2&&value.every(unit)&&value[0]<value[1];
  const within=(range,value)=>range===undefined||unit(value)&&value>=range[0]&&(value<range[1]||value===1&&range[1]===1);

  function velocityLayers(raw,takes,family){
    if(raw===undefined)return;
    check(Array.isArray(raw)&&raw.length>=2&&raw.length<=16,'Sound family needs two to 16 velocity layers: '+family);
    const byId=new Map(takes.map(take=>[take.id,take]));
    let prior=-1;
    return Array.from(raw,row=>{
      check(keys(row,['at','takes'])&&unit(row.at)&&row.at>prior&&Array.isArray(row.takes)&&
        row.takes.length>0&&row.takes.length<=takes.length&&new Set(row.takes).size===row.takes.length&&
        Array.from(row.takes).every(id=>byId.has(id)),'Invalid velocity layer in sound family '+family);
      prior=row.at;
      return {at:row.at,takes:[...row.takes].sort().map(id=>byId.get(id))};
    });
  }

  function bracket(layers,strength){
    if(strength===undefined||strength<=layers[0].at)return [{...layers[0],weight:1}];
    const upper=layers.findIndex(layer=>layer.at>=strength);
    if(upper<0)return [{...layers.at(-1),weight:1}];
    const high=layers[upper];
    if(high.at===strength)return [{...high,weight:1}];
    const low=layers[upper-1], weight=(strength-low.at)/(high.at-low.at);
    return [{...low,weight:1-weight},{...high,weight}];
  }

  function createPlayback(){
    const pools=new Map(), recent=new Map();
    let previous=-Infinity;
    return {pools,recent,observe(time){
      if(time<previous){pools.clear();recent.clear();}
      previous=time;
    },remember(event,members){
      if(recent.size>=16384)recent.delete(recent.keys().next().value);
      recent.set(event,members);
    }};
  }

  function variation(raw){
    if(raw===undefined)return;
    check(keys(raw,['rotate','pitchCents']),'Invalid sound take variation');
    const {rotate=false,pitchCents=[0,0]}=raw;
    check(typeof rotate==='boolean'&&Array.isArray(pitchCents)&&pitchCents.length===2&&
      Array.from(pitchCents).every(value=>Number.isInteger(value)&&finite(value,-1200,1200))&&pitchCents[0]<=pitchCents[1],
    'Sound variation needs a rotation flag and an ordered integer-cent range within an octave');
    return {rotate,pitchCents};
  }

  function compile(raw,seed,cues){
    check(record(raw)&&Object.keys(raw).length<=128&&Number.isSafeInteger(seed),'Invalid spatial sound families or seed');
    const families=new Map(Object.entries(raw).map(([family,spec])=>{
      check(key(family)&&keys(spec,['takes','layers','variation'])&&record(spec.takes),'Invalid spatial sound family '+family);
      const ids=Object.keys(spec.takes).sort();
      check(ids.length>0&&ids.length<=64&&ids.every(key),'Sound family needs one to 64 named takes: '+family);
      const takes=ids.map(id=>{
        const value=spec.takes[id], take=typeof value==='string'?{cue:value}:value;
        check(keys(take,['cue','strength','weight'])&&cues.has(take.cue)&&
          (take.strength===undefined||band(take.strength))&&finite(take.weight??1,.000001,1000000),
        'Invalid sound take '+family+'/'+id);
        return {id,cue:take.cue,strength:take.strength,weight:take.weight??1};
      });
      return [family,{takes,layers:velocityLayers(spec.layers,takes,family),variation:variation(spec.variation)}];
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
        return {id:row.id,when,family:row.family,...families.get(row.family)};
      }).sort((a,b)=>Number(b.when.prop!==undefined)-Number(a.when.prop!==undefined));
    }

    const unitDraw=salt=>(noise(0,hash(JSON.stringify(salt)))+1)*.5;
    function draw(takes,salt){
      const total=takes.reduce((sum,take)=>sum+take.weight,0);
      let ticket=unitDraw(salt)*total;
      return takes.find(take=>(ticket-=take.weight)<0)??takes.at(-1);
    }

    function pick(takes,salt,playback,pool,settings,saved){
      if(!settings?.rotate)return saved??draw(takes,salt);
      if(!playback.pools.has(pool))playback.pools.set(pool,{used:new Set(),last:null});
      const history=playback.pools.get(pool);
      const allowed=takes.length>1?takes.filter(take=>take.id!==history.last):takes;
      const unused=allowed.filter(take=>!history.used.has(take.id));
      if(!unused.length&&takes.length>1)history.used.clear();
      const chosen=saved??draw(unused.length?unused:allowed,salt);
      history.used.add(chosen.id);
      history.last=chosen.id;
      return chosen;
    }

    function choose(rules,{context,measurement},event,binding,playback,replay){
      const address=JSON.stringify([event,binding]), remembered=playback.recent.get(address);
      if(remembered)return remembered;
      for(const {id,when,family,takes,layers,variation:settings} of rules){
        if(!labels.every(name=>when[name]===undefined||when[name]===context[name])||
          !measurements.every(name=>within(when[name],context[name])))continue;
        const salt=['sound-take-v1',seed,event,binding,id,family], strength=context.strength;
        const adjacent=layers?bracket(layers,strength):[{takes,weight:1}];
        const groups=adjacent.map(layer=>({...layer,eligible:layer.takes.filter(take=>within(take.strength,strength))}))
          .filter(layer=>layer.eligible.length);
        if(!groups.length)continue;
        let saved;
        if(replay){
          check(settings&&replay.length===groups.length,'Saved sound choice does not match eligible layers for '+binding);
          saved=groups.map(({at,eligible})=>{
            const row=replay.find(row=>row.layer===at), take=row&&eligible.find(take=>take.id===row.take);
            check(take&&row.rule===id&&row.family===family&&row.cue===take.cue&&row.asset===cues.get(take.cue).asset&&
              Number.isInteger(row.pitchCents)&&finite(row.pitchCents,-1200,1200)&&finite(row.rate,.001,64),
              'Saved sound choice is no longer eligible for '+binding);
            return {row,take};
          });
        }
        const members=groups.map(({at,weight,eligible},index)=>{
          const layerSalt=at===undefined?salt:[...salt,at], prior=saved?.[index];
          const take=pick(eligible,layerSalt,playback,JSON.stringify([binding,family,at]),settings,prior?.take);
          const choices=eligible.map(candidate=>candidate.id);
          const selection=layers?{binding,rule:id,family,context,take:take.id,eligible:choices,
            layer:{at,weight:groups.length===1?1:weight},
            ...(measurement?{measurement}:{fallback:'quiet-layer'}),
            ...(groups.length<adjacent.length&&{fallback:'available-layer'})}:
            {binding,rule:id,family,take:take.id,context,eligible:choices};
          if(settings){
            const [min,max]=settings.pitchCents;
            selection.variation=prior?{pitchCents:prior.row.pitchCents,rate:prior.row.rate}:
              {pitchCents:min+Math.floor(unitDraw([...layerSalt,'pitch',take.id])*(max-min+1))};
          }
          return {cue:take.cue,selection};
        });
        if(settings)playback.remember(address,members);
        return members;
      }
      check(!replay,'Saved sound choice is no longer eligible for '+binding);
      return null;
    }
    return {rules,choose};
  }

  function readContact(row,contact,profile,{speedForFullStrength,loadForFullStrength,threshold}){
    const details=record(row.contact)?row.contact:contact;
    const authored=[row,details,row.fact?.data,row.data];
    const value=(name,valid)=>authored.map(item=>item?.[name]).find(valid);
    const nonnegative=n=>Number.isFinite(n)&&n>=0;
    const surfaceRecord=value('surface',record);
    const action=value('action',key)??[row.interaction,row.kind].find(key);
    const entity=value('entity',key)??value('source',key);
    const prop=value('prop',key)??entity;
    const object=value('object',key)??entity;
    const surface=value('surface',key)??[surfaceRecord?.id,row.material,details?.material,profile?.id].find(key);
    const wetness=value('wetness',unit)??[surfaceRecord?.wetness,profile?.wetness].find(unit);
    const explicit=value('strength',unit);
    const readLoad=()=>value('load',nonnegative)??authored.map(normalLoad).find(nonnegative);
    const readSpeed=()=>value('speed',nonnegative);
    let measurement;
    if(explicit!==undefined)measurement={kind:'strength',value:explicit,reference:1};
    else{
      const load=loadForFullStrength===undefined?undefined:readLoad();
      const speed=speedForFullStrength===undefined?undefined:readSpeed();
      if(load!==undefined)measurement={kind:'load',value:load,reference:loadForFullStrength};
      else if(speed!==undefined)measurement={kind:'speed',value:speed,reference:speedForFullStrength};
    }
    const strength=measurement&&Math.min(1,measurement.value/measurement.reference);
    const context=Object.fromEntries(Object.entries({action,object,surface,strength,wetness,prop}).filter(([,item])=>item!==undefined));
    const reading={context,measurement};
    if(threshold){
      const {measure}=threshold;
      reading.thresholdValue=measure==='strength'?strength:measurement?.kind===measure?measurement.value:
        measure==='load'?readLoad():readSpeed();
    }
    return reading;
  }

  function normalLoad(row){
    if(!vector(row?.force)||!vector(row?.normal))return;
    const length=K.V.len(row.normal);
    if(Number.isFinite(length)&&length>0)return Math.abs(K.V.dot(row.force,K.V.mul(row.normal,1/length)));
  }
  W.spatialSoundSelection=Object.freeze({compile,readContact,createPlayback});
})(KIT);
