/* Reusable mixer graphs with named input ports, macro recall and aligned audition. */
(function (P) {
  const A=P.mediaGraph,T=P.takeTime, {fields,record,finite,integer,id,check}=P.musicInstruments;
  const format='ink-studio/audio-rack', stateFormat='ink-studio/audio-rack-state';
  function named(value,max,label) {
    check(record(value) && Object.keys(value).length<=max && Object.keys(value).every(id),'Invalid rack '+label);
    return Object.entries(value);
  }
  function parameter(root,path) {
    check(Array.isArray(path) && integer(path.length,3,8) && ['processors','strips'].includes(path[0]) &&
      path.every(key=>id(key) || integer(key,0,63)),'Invalid rack macro target path');
    if (path[0]==='strips') check(
      path.length===3 && ['fader','pan'].includes(path[2]) ||
      path.length===5 && path[2]==='sends' && path[4]==='level','Macro target must be a strip control');
    let object=root;
    for (const part of path.slice(0,-1)) {
      check(object && Object.hasOwn(object,part),'Rack macro target does not exist');
      object=object[part];
    }
    const key=path.at(-1);
    check(object && Object.hasOwn(object,key) && Number.isFinite(object[key]),
      'Rack macro targets need existing numeric controls');
    return {object,key};
  }
  function describe(rack) {
    check(fields(rack,['format','version','id','revision','title','description','inputs','output','strips','processors','taps','macros','assets']) &&
      rack.format===format && rack.version===1 && id(rack.id) && integer(rack.revision,1,1e6) &&
      typeof rack.title==='string' && rack.title.length>0 && rack.title.length<=80 &&
      (rack.description===undefined || typeof rack.description==='string' && rack.description.length<=240) &&
      id(rack.output) && record(rack.strips) && Object.hasOwn(rack.strips,rack.output),'Invalid audio rack definition');
    const inputs=named(rack.inputs,12,'input ports');
    check(Object.hasOwn(rack.inputs,'main') && inputs.every(([,name])=>id(name) && Object.hasOwn(rack.strips,name)) &&
      new Set(inputs.map(([,name])=>name)).size===inputs.length,'Rack needs distinct input strips and a main port');
    const macros=named(rack.macros ?? {},16,'macros'), driven=new Set();
    for (const [,macro] of macros) {
      check(fields(macro,['label','default','targets']) && typeof macro.label==='string' &&
        macro.label.length>0 && macro.label.length<=64 && finite(macro.default,0,1) &&
        Array.isArray(macro.targets) && integer(macro.targets.length,1,24),'Invalid rack macro');
      for (const target of macro.targets) {
        check(fields(target,['path','range']) && Array.isArray(target.range) && target.range.length===2 &&
          target.range.every(Number.isFinite),'Macro needs two finite endpoint values');
        parameter(rack,target.path);
        const key=JSON.stringify(target.path.map(String));
        check(!driven.has(key),'A rack control can belong to only one macro');
        driven.add(key);
      }
    }
    check(named(rack.strips,48,'strips').every(([,row])=>record(row) && !Object.hasOwn(row,'clips')),
      'Rack input ports supply audio clips at render time');
    const {assets={},...definition}=rack;
    const entries=named(assets,16,'asset paths');
    check(entries.every(([name,file])=>!Object.hasOwn(rack.inputs,name) &&
      typeof file==='string' && file.trim().length>0),'Rack asset paths must name files outside the input ports');
    // File references can be rebased when a rack definition is exported.
    if (rack.assets!==undefined) definition.assets=Object.keys(assets).sort();
    return {inputs,macros,fingerprint:(P.data.hash(JSON.stringify(definition))>>>0).toString(16).padStart(8,'0')};
  }
  function normalized(value) {
    if (finite(value,0,1)) return value;
    check(fields(value,['unit','curve','points']) && ['beats','seconds','samples'].includes(value.unit) &&
      ['linear','hold'].includes(value.curve ?? 'linear') && Array.isArray(value.points) &&
      integer(value.points.length,1,2048) && Array.from(value.points).every(point=>
        fields(point,['at','value']) && point.at!==undefined && finite(point.value,0,1)),
    'Rack macro needs a unit value or an automation lane');
    let last;
    for (const point of value.points) {
      const at=T.read(point.at);
      check(at[0]>=0n && (!last || T.compare(last,at)<0) &&
        (value.unit!=='samples' || Number.isSafeInteger(point.at)), 'Rack automation needs increasing nonnegative positions');
      last=at;
    }
    return value;
  }
  function recall(rack,settings={},description=describe(rack)) {
    const {fingerprint,macros}=description;
    const stored=settings?.format===stateFormat;
    check(fields(settings,stored ? ['format','version','rack','revision','fingerprint','bypass','macros'] : ['bypass','macros']) &&
      (settings.bypass===undefined || typeof settings.bypass==='boolean') &&
      (!stored || settings.version===1 && settings.rack===rack.id && settings.revision===rack.revision &&
        settings.fingerprint===fingerprint),'Rack state does not match the definition or revision');
    const overrides=new Map(named(settings.macros ?? {},16,'state controls'));
    check([...overrides.keys()].every(key=>macros.some(([name])=>name===key)),'Unknown rack macro in state');
    const values=Object.fromEntries(macros.map(([key,macro])=>{
      const value=normalized(overrides.has(key) ? overrides.get(key) : macro.default);
      return [key,P.data.clone(value)];
    }));
    return {format:stateFormat,version:1,rack:rack.id,revision:rack.revision,fingerprint,bypass:settings.bypass ?? false,macros:values};
  }
  function prepare(rack,sources,state,options) {
    const info=describe(rack), saved=recall(rack,state,info);
    check(record(sources) && info.inputs.every(([name])=>Object.hasOwn(sources,name)) &&
      fields(options,['sampleRate','map','end','tail','meter']), 'Supply every rack input port and valid render options');
    const rate=options.sampleRate ?? sources.main?.sampleRate;
    const mixer={id:rack.id,strips:P.data.clone(rack.strips),processors:P.data.clone(rack.processors ?? {}),
      output:rack.output,taps:P.data.clone(rack.taps ?? {}),...options,sampleRate:rate};
    for (const [name,strip] of info.inputs) mixer.strips[strip].clips=[{id:name,source:name}];
    for (const [name,macro] of info.macros) {
      const value=saved.macros[name];
      for (const {path,range:[lo,hi]} of macro.targets) {
        const {object,key}=parameter(mixer,path), scale=x=>lo+(hi-lo)*x;
        object[key]=typeof value==='number' ? scale(value) :
          {...value,points:value.points.map(row=>({...row,value:scale(row.value)}))};
      }
    }
    return {mixer,state:saved};
  }
  function dry(source,options,end) {
    return A.mixer.render({id:'bypass',output:'out',strips:{out:{clips:[{id:'main',source:'main'}]}},
      ...options,...(end && {end:{samples:end},tail:'cut'})},{main:source});
  }
  function render(rack,sources,state={},options={},host={}) {
    const ready=prepare(rack,sources,state,options);
    const {value,taps,report}=ready.state.bypass ? dry(sources.main,{...options,sampleRate:ready.mixer.sampleRate}) :
      A.mixer.render(ready.mixer,sources,host);
    return {value,taps,report:{...report,rack:rack.id,bypass:ready.state.bypass},state:ready.state};
  }
  function audition(rack,sources,state={},options={},host={}) {
    check(fields(options,['sampleRate','map','end','tail','targetLufs','ceilingDbTP']),
      'Invalid rack audition settings');
    const {targetLufs,ceilingDbTP,...settings}=options;
    const wet=render(rack,sources,{...state,bypass:false},settings,host);
    const dryTake=dry(sources.main,{...settings,sampleRate:wet.value.sampleRate},wet.report.frames);
    const result=A.mixerMonitor.compare(dryTake,wet,{targetLufs,ceilingDbTP});
    return {...result,state:wet.state,report:{...result.report,rack:rack.id,mixer:wet.report}};
  }
  A.audioRack=Object.freeze({state:recall,render,audition});
})(KIT.procedural);
