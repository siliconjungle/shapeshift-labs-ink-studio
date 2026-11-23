/* Sustained contact voices with deterministic gain envelopes and source positions. */
(function(K){
  const W=K.world, {check,record}=W.data;
  const types=['drag','roll','scrape'];
  const actions=new Set(['contact-start','contact-update','contact-end']);
  const finite=(value,min,max)=>Number.isFinite(value)&&value>=min&&value<=max;
  const token=value=>typeof value==='string'&&value.length>0&&value.length<=256;
  const fields=(row,allowed)=>record(row)&&Object.keys(row).every(key=>allowed.includes(key));
  const clamp=value=>Math.min(1,Math.max(0,value));

  function compile(config,cues,locate){
    check(fields(config,['fields','interactions','attack','crossfade','release','response']),
      'Invalid continuous contact audio settings');
    const {fields:names=[],interactions,attack=.035,crossfade=.12,release=.16,response=.04}=config;
    check(Array.isArray(names)&&names.length<=8&&names.every(token)&&new Set(names).size===names.length&&
      fields(interactions,types)&&Object.keys(interactions).length>0&&
      [attack,crossfade,release,response].every(value=>finite(value,0,10)),
      'Invalid continuous contact audio settings');
    const rules=new Map();
    for(const [type,row] of Object.entries(interactions)){
      check(fields(row,['cue','materials','speedForFullRate','loadForFullGain','rate']),
        'Invalid continuous contact audio interaction '+type);
      const {cue,materials={},speedForFullRate=3,loadForFullGain=10,rate=[.55,1.65]}=row;
      check(cues.has(cue)&&record(materials)&&Object.keys(materials).length<=256&&
        Object.entries(materials).every(([material,name])=>token(material)&&cues.has(name))&&
        finite(speedForFullRate,.000001,1e12)&&finite(loadForFullGain,.000001,1e12)&&
        Array.isArray(rate)&&rate.length===2&&finite(rate[0],.0625,8)&&finite(rate[1],rate[0],8),
        'Invalid continuous contact audio interaction '+type);
      rules.set(type,{cue,materials:new Map(Object.entries(materials)),speedForFullRate,loadForFullGain,rate});
    }

    return function createPlayback(){
      const contacts=new Map(), voices=new Map(), seen=new Set();
      let previous=0, serial=0;
      function level(voice,time){
        return voice.end<=voice.start ? voice.target :
          K.mix(voice.from,voice.target,clamp((time-voice.start)/(voice.end-voice.start)));
      }
      function offset(voice,time){
        return voice.offset+(time-voice.changedAt)*voice.rate;
      }
      function raw(voice,time){
        const {id,cue,at,pitch,contact,end,target}=voice;
        return {id,cue,at,pitch,mode:'loop',offset:offset(voice,time),gain:level(voice,time),
          contact:{...contact,remaining:Math.max(0,end-time),targetGain:target}};
      }

      return function frame(time,query,events,observations){
        if(time<previous){
          contacts.clear(); voices.clear(); seen.clear(); previous=0; serial=0;
        }
        const changes=[];
        function note(voice,at,ended=false){
          check(changes.length<16384,'Continuous contact automation exceeds its frame budget');
          changes.push({time:at,voice:raw(voice,at),ended});
        }
        function advance(to){
          for(const voice of voices.values()){
            if(voice.settled||voice.end>to)continue;
            voice.settled=true;
            note(voice,voice.end,voice.retiring);
            if(voice.retiring){
              voices.delete(voice.id);
              voice.layers.delete(voice.cue);
            }
          }
        }
        function fade(voice,to,time,duration,retiring=false){
          Object.assign(voice,{from:level(voice,time),target:to,start:time,end:time+duration,retiring,settled:false});
        }
        function close(key,time){
          const contact=contacts.get(key);
          if(!contact)return;
          contacts.delete(key);
          for(const voice of contact.layers.values()){
            fade(voice,0,time,release,true);
            note(voice,time);
          }
        }
        function measure(key,name,row,time,snapshot){
          const old=contacts.get(key);
          const interaction=row.interaction??old?.interaction;
          const rule=rules.get(interaction);
          if(!rule || (row.speed!==undefined&&!finite(row.speed,0,1e12)) ||
            (row.load!==undefined&&!finite(row.load,0,1e12)) ||
            (row.material!=null&&!token(row.material))){
            if(snapshot)close(key,time);
            return;
          }
          const reading=snapshot?row:{...old?.reading,...row};
          const {at,material}=locate(query,reading);
          const speed=reading.speed??0, load=reading.load??rule.loadForFullGain;
          const motion=clamp(speed/rule.speedForFullRate);
          const pitch=K.mix(rule.rate[0],rule.rate[1],motion);
          const gain=Math.sqrt(motion*clamp(load/rule.loadForFullGain));
          const cue=rule.materials.get(material)??rule.cue;
          const layers=old?.layers??new Map(), changed=old&&old.cue!==cue;
          if(!old) check(contacts.size<512,'Continuous contact limit exceeded');
          const contact={name,interaction,reading,snapshot,cue,layers};
          contacts.set(key,contact);
          if(!layers.has(cue)){
            check(voices.size<2048,'Continuous contact voice limit exceeded');
            const id='contact:'+(++serial);
            const voice={id,cue,layers,offset:0,changedAt:time,rate:0,from:0,target:0,start:time,end:time};
            layers.set(cue,voice);
            voices.set(id,voice);
          }
          for(const voice of layers.values()){
            const primary=voice.cue===cue, target=primary?gain:0;
              const layerMaterial=primary?material:voice.contact?.material;
            const next={id:name,interaction,speed,load,...(layerMaterial!==undefined&&{material:layerMaterial})};
            const unchanged=voice.contact&&voice.pitch===pitch&&voice.target===target&&!changed&&
              voice.contact.speed===speed&&voice.contact.load===load&&voice.contact.interaction===interaction&&
              voice.contact.material===layerMaterial&&JSON.stringify(voice.at)===JSON.stringify(at);
            if(unchanged)continue;
            const fresh=!voice.contact;
            Object.assign(voice,{offset:offset(voice,time),changedAt:time,at,pitch,contact:next,
              rate:pitch*cues.get(voice.cue).pitch});
            if(fresh||changed||voice.target!==target){
              const duration=changed?crossfade:fresh?attack:Math.max(response,voice.end-time);
              fade(voice,target,time,duration,!primary);
            }
            note(voice,time);
          }
        }

        const input=events.filter(row=>actions.has(row?.kind)&&token(row.contact?.id));
        const commands=W.timedEvents.select(input,time).ready
          .map(row=>({row,time:Math.min(time,Math.max(previous,W.timedEvents.timeOf(row)??time))}))
          .sort((a,b)=>a.time-b.time);
        for(const {row,time:at} of commands){
          if(token(row.id)&&seen.has(row.id))continue;
          if(token(row.id)){
            seen.add(row.id);
            if(seen.size>8192)seen.delete(seen.values().next().value);
          }
          advance(at);
          const name=row.contact.id, key='event:'+name;
          if(row.kind==='contact-end')close(key,at);
          else if(row.kind==='contact-start'||contacts.has(key))measure(key,name,row.contact,at,false);
        }
        advance(time);
        const current=new Map();
        for(const row of observations??[]){
          if(token(row?.id))current.set('observed:'+row.id,{name:row.id,row});
        }
        for(const field of names){
          const sample=query?.probe(field);
          if(sample?.status!=='ok'||!Array.isArray(sample.value))continue;
          for(const row of sample.value){
            if(!record(row)||!rules.has(row.interaction))continue;
            const participants=[row.source??null,row.entity??null,row.wheel??null,row.interaction];
            if(!token(row.entity)&&!token(row.wheel)&&!token(row.contactId))continue;
            const name=JSON.stringify([field,row.contactId??participants]);
            current.set('field:'+name,{name,row});
          }
        }
        check(current.size<=4096,'Continuous contact observations exceed their budget');
        for(const [key,contact] of contacts){
          if(contact.snapshot&&!current.has(key))close(key,time);
          else if(!contact.snapshot)measure(key,contact.name,contact.reading,time,false);
        }
        for(const [key,{name,row}] of current)measure(key,name,row,time,true);
        advance(time);
        previous=time;
        return {active:[...voices.values()].map(voice=>raw(voice,time)),
          changes:changes.sort((a,b)=>a.time-b.time)};
      };
    };
  }
  W.spatialContactAudio=Object.freeze({compile});
})(KIT);
