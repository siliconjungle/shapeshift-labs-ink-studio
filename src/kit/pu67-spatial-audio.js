/* Renderer-independent cue resolution and spatial mixing over world queries. */
(function(K){
  const W=K.world,Q=W.query,{V,M}=K,{check,copy,id,own,record,vector}=W.data;
  const {freeze}=K.procedural.data, eps=1e-6, front=[0,0,-1], vertical=[0,1,0];
  const bands=['low','mid','high'], buses=['dialogue','foley','effects','ambience','music'];
  const finite=(n,min,max)=>Number.isFinite(n)&&n>=min&&n<=max;
  const cueName=n=>typeof n==='string'&&n.length<=512&&!!n.trim();
  const key=n=>typeof n==='string'&&/^[A-Za-z0-9_][A-Za-z0-9._/-]{0,127}$/.test(n);
  const point=p=>vector(p)&&p.every(n=>Math.abs(n)<=1e6);
  const keys=(obj,allowed)=>record(obj)&&Object.keys(obj).every(key=>allowed.includes(key));
  const selector=at=>point(at)||keys(at,['entity','socket'])&&id(at.entity)&&(at.socket===undefined||id(at.socket));
  const field=n=>typeof n==='string'&&n.length>0&&n.length<=193;
  const amplitude=db=>10**(-db/20);
  const ordered=rows=>Object.keys(rows).sort().map(key=>[key,rows[key]]);
  const eventKinds=['material-sound','audio-cue','animation-sound'];
  const impactLayers=['strike','surface','rattle','tail'];
  const cueFields=['cue','interaction','at','gain','select','speedForFullStrength','loadForFullStrength'];

  function distanceSettings(raw={},base={reference:1,max:50,rolloff:1,fade:5}){
    check(keys(raw,['reference','max','rolloff','fade']),'Invalid audio distance settings');
    const {reference=base.reference,max=base.max,rolloff=base.rolloff}=raw;
    const fade=raw.fade??Math.min(base.fade,max-reference);
    check(finite(reference,.001,1e5)&&finite(max,reference,1e5)&&finite(rolloff,0,16)&&
      finite(fade,0,max-reference),'Invalid audio distance settings');
    return {reference,max,rolloff,fade};
  }
  function distanceGain(distance,{reference,max,rolloff,fade}){
    if(distance>max)return 0;
    const spread=reference/(reference+rolloff*Math.max(0,distance-reference));
    return fade?spread*Math.min(1,(max-distance)/fade):spread;
  }
  function occlusionStyle(raw={},base={lossDb:12,cutoff:1200}){
    check(keys(raw,['lossDb','cutoff']),'Invalid acoustic obstacle settings');
    const {lossDb=base.lossDb,cutoff=base.cutoff}=raw;
    check(finite(lossDb,0,120)&&finite(cutoff,20,22000),'Invalid acoustic obstacle settings');
    return {lossDb,cutoff};
  }
  function table(input,max,label,valid=key){
    check(record(input)&&Object.keys(input).length<=max&&Object.keys(input).every(valid),'Invalid audio '+label);
    return ordered(input);
  }
  const resolve=(query,at)=>point(at)?{point:at}:at&&query?.frame(at);
  function listenerFrame(query,raw){
    const spec=selector(raw)?{at:raw}:raw;
    check(keys(spec,['at','forward','up'])&&selector(spec.at)&&
      [spec.forward,spec.up].every(p=>p===undefined||point(p)&&V.len(p)>eps),'Invalid audio listener');
    const pose=resolve(query,spec.at);
    if(!point(pose?.point))return null;
    const orient=value=>pose.rotation?M.app(pose.rotation,value):value;
    const forward=V.norm(spec.forward??orient(front)), up=V.norm(spec.up??orient(vertical));
    const right=V.cross(forward,up);
    check(V.len(right)>eps,'Audio listener forward and up must be distinct axes');
    return {position:pose.point,forward,up:V.cross(V.norm(right),forward),
      exclude:spec.at.entity?[spec.at.entity]:[]};
  }

  function create(definition={}){
    const config=copy(definition);
    check(keys(config,['cues','emitters','bindings','materials','surface','distance','occlusion','propagationDelay','soundFamilies','soundSeed','contactLoops']),
      'Invalid spatial audio settings');
    const distance=distanceSettings(config.distance), cueList=table(config.cues??{},512,'cues',cueName);
    const {propagationDelay=false,surface}=config;
    check(typeof propagationDelay==='boolean'&&(surface===undefined||field(surface)),'Invalid audio surface or delay setting');
    const {acoustic,rays=[],segments=[],lossDb,cutoff,materials:occluders={}}=config.occlusion??{};
    check(keys(config.occlusion??{},['acoustic','rays','segments','lossDb','cutoff','materials'])&&
      (acoustic===undefined||field(acoustic))&&[rays,segments].every(list=>Array.isArray(list)&&list.length<=8&&
        list.every(field)&&new Set(list).size===list.length),'Invalid acoustic fields or traces');
    const obstacle=occlusionStyle({lossDb,cutoff});
    const obstacles=new Map(table(occluders,128,'occluding materials').map(([name,raw])=>[name,occlusionStyle(raw,obstacle)]));
    const cues=new Map(cueList.map(([name,raw])=>{
      const spec=typeof raw==='string'?{asset:raw}:raw;
      check(keys(spec,['asset','at','gain','pitch','distance','occlusion','follow','bus'])&&
        typeof spec.asset==='string'&&spec.asset.length<=512&&!!spec.asset.trim()&&
        (spec.at===undefined||selector(spec.at))&&finite(spec.gain??1,0,16)&&finite(spec.pitch??1,.0625,8)&&
        typeof (spec.occlusion??true)==='boolean' && typeof (spec.follow??false)==='boolean' &&
        (spec.bus===undefined||buses.includes(spec.bus)),'Invalid audio cue '+name);
      return [name,{...spec,gain:spec.gain??1,pitch:spec.pitch??1,
        distance:distanceSettings(spec.distance,distance),occlusion:spec.occlusion??true}];
    }));
    const emitters=table(config.emitters??{},128,'emitters').map(([name,row])=>{
      check(keys(row,['cue','at','gain','offset'])&&cues.has(row.cue)&&(row.at===undefined||selector(row.at))&&
        finite(row.gain??1,0,16)&&finite(row.offset??0,0,1e9),'Invalid audio emitter '+name);
      return { ...row,name };
    });
    const materials=new Map(table(config.materials??{},256,'materials').map(([name,row])=>{
      check(keys(row,['roll','step','impact'])&&Object.values(row).every(cue=>cues.has(cue)),
        'Invalid material audio cues '+name);
      return [name,row];
    }));
    const S=W.spatialSoundSelection, selection=S.compile(config.soundFamilies??{},config.soundSeed??0,cues);
    const contactPlayback=config.contactLoops===undefined?null:W.spatialContactAudio.compile(config.contactLoops,cues,(query,row)=>{
      const at=eventAt(row);
      return {at,material:row.material??row.surface?.id??surfaceAt(query,at)?.id};
    });
    const createPlayback=()=>Object.assign(S.createPlayback(),{contactFrame:contactPlayback?.()});
    const livePlayback=createPlayback();
    function compileCue(name,row,impact){
      const {cue,interaction,at,gain,select,threshold,delay,bus,speedForFullStrength,loadForFullStrength}=row;
      check((cue!==undefined?cues.has(cue):interaction!==undefined?['roll','step','impact'].includes(interaction):select!==undefined)&&
        [speedForFullStrength,loadForFullStrength].every(value=>value===undefined||
          (select!==undefined||threshold?.measure==='strength')&&finite(value,.000001,1e12))&&
        (at===undefined||selector(at))&&finite(gain??1,0,16),'Invalid cue binding '+name);
      if(impact){
        check((threshold===undefined||keys(threshold,['measure','min'])&&['strength','speed','load'].includes(threshold.measure)&&
          finite(threshold.min,0,threshold.measure==='strength'?1:1e12))&&finite(delay??0,0,10)&&
          (bus===undefined||buses.includes(bus)),'Invalid compound impact layer '+name);
      }
      return {name,...row,impact,select:select===undefined?undefined:selection.rules(select,name)};
    }
    const bindings=new Map();
    for(const [name,row] of table(config.bindings??{},128,'bindings')){
      const compound=record(row)&&row.impactLayers!==undefined;
      const allowed=compound?['on','at','gain','impactLayers']:['on',...cueFields];
      check(keys(row,allowed)&&keys(row.on,['kind','system','where'])&&id(row.on.kind)&&
        (row.on.system===undefined||id(row.on.system)),'Invalid cue binding '+name);
      Q.condition(row.on.where,{});
      if(!bindings.has(row.on.kind))bindings.set(row.on.kind,[]);
      const definitions=bindings.get(row.on.kind);
      if(!compound){
        definitions.push(compileCue(name,row));
        continue;
      }
      check(keys(row.impactLayers,impactLayers)&&Object.keys(row.impactLayers).length>0&&
        (row.at===undefined||selector(row.at))&&finite(row.gain??1,0,16),'Invalid compound impact binding '+name);
      for(const layer of impactLayers){
        if(!own(row.impactLayers,layer))continue;
        const spec=row.impactLayers[layer], address='impact:'+name+'/'+layer;
        check(keys(spec,[...cueFields,'threshold','delay','bus']),'Invalid compound impact layer '+address);
        definitions.push({...compileCue(address,spec,{binding:name,layer}),on:row.on,
          at:spec.at??row.at,gain:(row.gain??1)*(spec.gain??1)});
      }
    }

    function mix(query,listener,input){
      const cue=cues.get(input.cue);
      if(!cue)return null;
      const at=input.at??cue.at, positioned=at!==undefined, source=resolve(query,at);
      const variation=input.selection?.variation, detune=variation?2**(variation.pitchCents/1200):1;
      const pitch=variation?.rate??Math.max(.001,Math.min(64,(input.pitch??1)*cue.pitch*detune));
      const scale=Math.min(16384,(input.gain??1)*cue.gain);
      const bus=input.bus??cue.bus??(input.impact?'effects':undefined);
      const result={id:input.id,cue:input.cue,asset:cue.asset,mode:input.mode,offset:input.offset??0,
        rate:pitch,...(input.duration!==undefined&&{duration:input.duration}),...(bus!==undefined&&{bus}),
        ...(input.impact&&{impact:input.impact,startDelay:input.startDelay}),
        ...(input.sourceEvent!==undefined&&{sourceEvent:input.sourceEvent}),
        ...(input.selection!==undefined&&{selection:variation?{...input.selection,variation:{...variation,rate:pitch}}:input.selection}),
        ...(cue.follow&&input.mode==='cue'&&at?.entity&&{attachment:{cue:input.cue,at,
          ...(input.gain!==undefined&&{gain:input.gain}),...(input.pitch!==undefined&&{pitch:input.pitch}),
          ...(input.exclude!==undefined&&{exclude:input.exclude})}})};
      const contact=factor=>input.contact&&{contact:{...input.contact,targetGain:input.contact.targetGain*cue.gain*factor}};
      if(!positioned)return {...result,...contact(1),status:'unpositioned',position:null,distance:null,gain:scale,
        bands:{low:scale,mid:scale,high:scale},cutoff:22000,delay:0};
      const position=source?.point;
      if(!point(position)||!listener)return {...result,...contact(0),status:'unavailable',position:point(position)?position:null,
        distance:null,gain:0,bands:{low:0,mid:0,high:0},cutoff:22000,delay:0};
      const range=V.dist(position,listener.position), spread=distanceGain(range,cue.distance);
      let apparent=position, route, delay=0, cutoff=22000, blocker, attenuation=[1,1,1];
      if(cue.occlusion&&spread>0&&query){
        if(acoustic){
          const reading=query.probe(acoustic,listener.position,{from:position});
          if(reading.status==='ok'){
            route=reading.value.status;
            if(route==='blocked')attenuation=[0,0,0];
            else if(reading.value.bands&&Number.isFinite(reading.value.distanceLossDb)){
              // The cue owns distance falloff. Keep just the path and medium transmission.
              attenuation=bands.map(band=>amplitude(Math.max(0,reading.value.bands[band].lossDb-reading.value.distanceLossDb)));
              if(point(reading.value.apparentSource))apparent=reading.value.apparentSource;
              delay=reading.value.delaySeconds??0;
            }
          }
        }
        const delta=V.sub(apparent,listener.position), length=V.len(delta);
        if(route!=='blocked'&&length>eps){
          const exclude=[...listener.exclude,...(at.entity?[at.entity]:[]),...(input.exclude?[input.exclude]:[])];
          const direction=V.mul(delta,1/length);
          for(const trace of rays){
            const hit=query.trace(trace,listener.position,{direction,distance:Math.min(1e5,length-eps),exclude});
            if(hit.status==='ok'&&hit.value.distance<length-eps&&(!blocker||hit.value.distance<blocker.distance)){
              const {id,material,distance}=hit.value;
              blocker={trace,id:id??null,material:material??null,distance};
            }
          }
          for(const trace of segments){
            const to=V.mad(listener.position,direction,length-eps);
            const hit=query.trace(trace,listener.position,{to});
            if(hit.status==='ok'&&hit.value.status==='blocked'&&point(hit.value.point)){
              const distance=V.dist(hit.value.point,listener.position);
              if(!blocker||distance<blocker.distance)blocker={trace,id:null,material:hit.value.material??null,distance};
            }
          }
          if(blocker){
            const style=obstacles.get(blocker.material)??obstacle;
            attenuation=attenuation.map(gain=>gain*amplitude(style.lossDb));
            cutoff=style.cutoff;
          }
        }
      }
      const levels=Object.fromEntries(bands.map((band,i)=>[band,scale*spread*attenuation[i]]));
      return {...result,...contact(spread*attenuation[1]),status:spread===0?'out-of-range':route==='blocked'?'blocked':blocker?'occluded':'spatial',
        position,apparentSource:apparent,distance:range,gain:levels.mid,bands:levels,cutoff,
        ...(blocker&&{blocker}),...(route&&{acoustic:route}),delay:propagationDelay?delay:0};
    }

    function eventAt(row) {
      for (const at of [row.at,row.point,row.emitter,row.contact?.at,row.contact?.point,row.fact?.at]) {
        if (selector(at)) return at;
        if (point(at?.point)) return at.point;
        if (id(at?.entity) && (at.socket===undefined || id(at.socket)))
          return {entity:at.entity,...(at.socket!==undefined&&{socket:at.socket})};
      }
      const entity=row.entity??row.contact?.entity;
      return id(entity)?{entity}:undefined;
    }
    function surfaceAt(query,at){
      const position=resolve(query,at)?.point;
      return position&&W.materials.probe(query,surface,position);
    }
    function materialCue(query,row,at,interaction){
      const profile=surfaceAt(query,at);
      const material=row.material??row.contact?.material??row.surface?.id??row.contact?.surface?.id??profile?.id;
      return materials.get(material)?.[interaction]??profile?.sounds?.[interaction];
    }
    function frame({query,time=0,from=time,listener,events=[],animation=[],timeline,captureSources=false,
      playback=livePlayback,receipts,contacts}={}){
      check(finite(time,0,1e9)&&finite(from,-1e9,time)&&Array.isArray(events)&&events.length<=10000&&
        Array.isArray(animation)&&animation.length<=128&&
        (contacts===undefined||Array.isArray(contacts)&&contacts.length<=4096)&&
        (!timeline||typeof timeline.sample==='function'&&typeof timeline.between==='function'),'Invalid spatial audio frame');
      const ear=listenerFrame(query,listener), active=[], shots=[], known=new Set();
      playback.observe(time);
      function add(input,target){
        if(known.has(input.id))return;
        known.add(input.id);
        const voice=mix(query,ear,input);
        if(voice)target.push(input.onset===undefined?voice:{...voice,onset:input.onset});
        check(active.length+shots.length<=4096,'Spatial audio mix exceeds its voice budget');
      }
      function route(row,serial,contact){
        const at=eventAt(row), gain=row.gain??1, pitch=row.pitch??1;
        if(!finite(gain,0,64)||!finite(pitch,.0625,8))return;
        const raw={mode:'cue',at,gain,pitch,onset:W.timedEvents.timeOf(row),exclude:id(row.entity)?row.entity:undefined,
          ...(captureSources&&typeof row.id==='string'&&W.committedEvents.eventId(row.id)&&{sourceEvent:row.id})};
        const recorded=receipts?.get(row.id);
        let matched=false, profile, replayed=0;
        for(const binding of bindings.get(row.kind)??[]){
          if(binding.on.system!==undefined&&binding.on.system!==row.system||!Q.condition(binding.on.where,row))continue;
          const {impact,threshold}=binding;
          if(impact)matched=true;
          if(binding.select&&profile===undefined)profile=surfaceAt(query,at)??null;
          const reading=(binding.select||threshold)&&S.readContact(row,contact,profile,binding);
          if(threshold&&(reading.thresholdValue===undefined||reading.thresholdValue<threshold.min))continue;
          let chosen;
          if(binding.select){
            const replay=recorded?.get(binding.name);
            chosen=selection.choose(binding.select,reading,serial,binding.name,playback,replay);
            if(replay)replayed++;
            if(!chosen&&binding.cue===undefined&&binding.interaction===undefined)continue;
          }
          matched=true;
          const site=binding.at??at, voiceId=serial+'/'+binding.name, level=gain*(binding.gain??1);
          const layerInput=impact?{...raw,bus:binding.bus,startDelay:binding.delay??0,
            impact:{...impact,...(threshold&&{threshold:{...threshold,value:reading.thresholdValue}})}}:raw;
          if(chosen){
            for(const {cue,selection} of chosen){
              const layer=selection.layer;
              add({...layerInput,id:layer?'layer:'+JSON.stringify([voiceId,layer.at]):voiceId,
                cue,selection,at:site,gain:level*(layer?.weight??1)},shots);
            }
          }else{
            const cue=binding.cue??materialCue(query,row,site,binding.interaction)??row.cue;
            if(cue)add({...layerInput,id:voiceId,cue,at:site,gain:level},shots);
          }
        }
        check(!recorded||replayed===recorded.size,'Saved sound choice no longer matches its binding');
        if(!matched&&eventKinds.includes(row.kind)&&cueName(row.cue))add({...raw,id:serial,cue:row.cue},shots);
      }
      for(const row of emitters)add({...row,id:'emitter:'+row.name,mode:'loop',offset:(row.offset??0)+time*cues.get(row.cue).pitch},active);
      const sustained=playback.contactFrame?.(time,query,events,contacts);
      if(sustained)for(const voice of sustained.active)add(voice,active);
      events.forEach((row,i)=>{
        if(record(row)&&id(row.kind))route(row,'world:'+JSON.stringify(row.id??[time,i]));
      });
      const streams=new Set();
      for(const stream of animation){
        check(keys(stream,['id','at','frame','contacts'])&&id(stream.id)&&!streams.has(stream.id)&&
          (stream.at===undefined||selector(stream.at))&&Array.isArray(stream.frame?.events)&&
          stream.frame.events.length<=10000&&record(stream.contacts??{}),'Invalid animation audio stream');
        streams.add(stream.id);
        const anchors=new Map((stream.frame.constraints??[]).map(row=>[row.id,row.target??row.position]));
        stream.frame.events.forEach((event,i)=>{
          const types={sound:'animation-sound',contact:'animation-contact',animation:'animation-marker'};
          const kind=own(types,event.type)&&types[event.type];
          if(!kind)return;
          const contact=own(stream.contacts??{},event.contact)&&stream.contacts[event.contact];
          const row={...event,kind,system:stream.id,material:contact?.material??event.data?.material,
            at:contact?.at??anchors.get(event.contact)??event.data?.at??stream.at};
          route(row,'animation:'+JSON.stringify([stream.id,event.layer??null,event.time??time,event.eventId??event.id??null,i]),contact);
        });
      }
      if(timeline){
        const trackId=clip=>'timeline:'+JSON.stringify([clip.path,clip.id,clip.time]);
        for(const clip of timeline.sample(time).audio){
          const cue=cues.get(clip.cue);
          if(!cue)continue;
          add({id:trackId(clip),cue:clip.cue,mode:'clip',gain:clip.gain,pitch:clip.rate,
            offset:clip.offset+(clip.position-clip.offset)*cue.pitch,duration:clip.end-time},active);
        }
        for(const item of timeline.between(from,time))if(item.type==='audio'&&!item.duration)
          add({id:trackId(item),cue:item.cue,mode:'cue',gain:item.gain,offset:item.offset},shots);
      }
      const contactChanges=sustained?.changes.map(change=>({...change,voice:mix(query,ear,change.voice)}));
      return freeze(copy({time,listener:ear&&{position:ear.position,forward:ear.forward,up:ear.up},active,cues:shots,
        ...(contactChanges?.length&&{contactChanges})}));
    }
    function cue({ query, listener, cue, at, gain, pitch, exclude } = {}) {
      return mix(query, listenerFrame(query, listener), { cue, at, gain, pitch, exclude, mode: 'cue' });
    }
    return Object.freeze({frame,cue,createPlayback});
  }
  W.spatialAudio=Object.freeze({create});
})(KIT);
