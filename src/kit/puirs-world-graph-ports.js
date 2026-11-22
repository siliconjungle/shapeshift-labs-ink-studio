/* Typed graph adapters for committed world state and event intervals. */
(function(K){
  const W=K.world,P=K.procedural,T=P.takeTime,{check,copy,id,own,read,record,selector}=W.data,{freeze}=P.data;
  const {fields}=W.boundarySignals, format='ink-studio/world-graph-frame';
  const maxEvents=100000;
  const optionsPort={type:'record',default:{}}, sourcePort={type:'worldFrame',default:null};
  const origins=new WeakMap();
  const tickOK=value=>Number.isSafeInteger(value)&&value>=0&&value<=W.runtime.maxTick;
  const emptyLog=freeze({format:'ink-studio/event-log',version:1,entries:[],dropped:0});

  function settings(options) {
    check(fields(options,['tick','eventFrom','queries','checkpointEvery','checkpointCache'])&&
      ['tick','eventFrom'].every(key=>options[key]===undefined||tickOK(options[key]))&&
      (options.queries===undefined||record(options.queries)&&Object.keys(options.queries).length<=128),
    'Invalid world graph port sampling options');
    const queries=Object.entries(options.queries??{}).map(([name,spec])=>{
      check(id(name)&&fields(spec,['field','at','args','select','when'])&&typeof spec.field==='string'&&spec.field.length>0&&
        (spec.args===undefined||record(spec.args)),'Invalid world graph query '+name);
      const {field,at,args,select,when}=spec;
      W.query.condition(when,undefined);
      return [name,{field,at,args,when,path:select===undefined?undefined:selector(select)}];
    });
    return {...options,queries};
  }

  function sampleQuery(query,{field,at,args,path,when}) {
    const sample=query.probe(field,at,args);
    if (sample.status!=='ok') return sample;
    if (!W.query.condition(when,sample.value)) return {status:'missing',reason:'query availability condition is false'};
    if (path===undefined) return sample;
    const value=read(sample.value,path);
    return value===undefined?{status:'missing',reason:'selected value is unavailable'}:{...sample,value};
  }

  function frameOf(view,query,queries,{events=[],eventFrom=view.tick+1}={}) {
    const samples=Object.fromEntries(queries.map(([name,probe])=>[name,sampleQuery(query,probe)]));
    const branch=W.committedEvents.branchAt(view.eventStream,view.tick), {id:world,seed,dt,takeClock}=view.world;
    return freeze({format,version:1,world,branch,seed,dt,tick:view.tick,eventFrom,events,samples,
      ...(takeClock?.simulationRate!==undefined&&{simulationRate:takeClock.simulationRate})});
  }

  function tickAt(time,period) {
    return T.index(T.roundDown(T.div(time,period)));
  }

  function worldSource() {
    let session, prior, configured, spec, stream;
    const run=({source,commands,options},{time,take})=>{
      if (configured!==options) {
        spec=settings(options);
        if (!W.data.equal(configured?.queries??{},options.queries??{})) stream={};
        configured=options;
      }
      const {checkpointEvery,checkpointCache}=spec;
      if (!Object.keys(source).length) return {value:null,checkpoint:{},report:{status:'missing',reason:'no world source'}};
      const inputs=[source,commands,checkpointEvery,checkpointCache];
      if (!prior||inputs.some((value,index)=>value!==prior[index])) {
        check([W.format,W.runtime.checkpointFormat,W.runtime.runFormat,W.models.format].includes(source.format),
          'World graph source needs a native world, model, checkpoint or recording');
        session=W.scrub.create(source,{commands,checkpointEvery,checkpointCache});
        prior=inputs;
        stream={};
      }
      const {dt,takeClock}=session.view().world, simulationRate=takeClock?.simulationRate, period=T.period(dt,simulationRate);
      const timing=spec.tick===undefined&&take!==undefined?T.requireFrame(take):undefined;
      const takeTick=point=>dt===timing.dt?timing.locate(point).tick:tickAt(point,period);
      const nearest=time/dt, rounded=Math.round(nearest);
      const tick=spec.tick??(timing?takeTick(timing.start):
        Math.abs(nearest-rounded)<=Number.EPSILON*Math.max(1,Math.abs(nearest))?rounded:Math.floor(nearest));
      const {fromTick,toTick}=session.status();
      if (!tickOK(tick)||tick<fromTick||tick>toTick)
        return {value:null,checkpoint:{},report:{status:'missing',reason:'outside world source range',tick,fromTick,toTick}};
      const previous=timing&&take.frame>0?takeTick(T.sub(timing.start,T.sub(timing.end,timing.start))):tick-1;
      const eventFrom=Math.max(fromTick,spec.eventFrom??previous+1);
      check(eventFrom<=tick+1,'World graph event range starts after its selected tick');
      const events=[];
      function collect(frame) {
        check(events.length+frame.events.length<=maxEvents,'World graph event window exceeds its event budget');
        for (const row of frame.events) events.push(W.committedEvents.read(row,frame.world.id,frame.eventStream));
      }
      const view=session.scan(Math.min(eventFrom,tick),tick,eventFrom<=tick?collect:()=>{});
      const value=frameOf(view,session.query(),spec.queries,{events,eventFrom});
      const {world,branch}=value;
      origins.set(value,stream);
      return {value,checkpoint:session.checkpoint(),report:{status:'live',world,branch,tick,eventFrom,events:events.length}};
    };
    run.clear=()=>{ session=prior=configured=spec=stream=undefined; };
    return run;
  }

  function pulse({source,options}) {
    const {kind,system,story,branch,where,missing='empty'}=options;
    check(fields(options,['kind','system','story','branch','where','missing'])&&
      [kind,system,branch].every(value=>value===undefined||id(value))&&
      (story===undefined||typeof story==='string'&&story.split('/').length===2&&story.split('/').every(id))&&
      ['empty','error'].includes(missing),'Invalid world pulse options');
    W.query.condition(where,undefined);
    if (!source) {
      check(missing!=='error','World pulse source is unavailable');
      return {value:emptyLog,report:{status:'missing',reason:'no world frame',count:0}};
    }
    const events=source.events.filter(row=>(kind===undefined||kind===row.kind)&&(system===undefined||system===row.system)&&
      (story===undefined||story===row.story)&&(branch===undefined||branch===row.branch)&&W.query.condition(where,row));
    const dt=source.simulationRate===undefined?source.dt:T.pack(T.period(source.dt,source.simulationRate));
    const value=events.length?W.outputAdapters.events(events,{dt}):emptyLog;
    return {value,report:{status:events.length?'live':'empty',count:events.length,tick:source.tick,eventFrom:source.eventFrom}};
  }

  function queryPort(type) {
    const scalar=type==='unitScalar', valid=P.graphTypes.validator(type);
    return {
      description:scalar?'Publish a named world query as a scalar clamped to [0,1].':
        'Publish a named world query as a structured record.',
      inputs:{source:sourcePort,options:optionsPort},outputs:{value:type,report:'record'},time:true,
      instantiate() {
        let settings, spec, held, prior;
        const run=({source,options},{time,take,sequence})=>{
          if (settings!==options) {
            const {query,range=[0,1],missing='fallback',fallback=scalar?0:{}}=options;
            check(fields(options,scalar?['query','range','missing','fallback']:['query','missing','fallback'])&&id(query)&&
              ['fallback','hold','error'].includes(missing)&&valid(fallback)&&
              (!scalar||Array.isArray(range)&&range.length===2&&range.every(Number.isFinite)&&
                range[1]>range[0]&&Number.isFinite(range[1]-range[0])),
            'Invalid '+(scalar?'bounded scalar':'world record')+' port settings');
            spec={query,range,missing,fallback:freeze(copy(fallback))};
            settings=options;
            held=prior=undefined;
          }
          const identity=source&&(origins.get(source)??JSON.stringify([source.world,source.branch,source.seed]));
          if (prior&&(sequence!==prior.sequence||time<prior.time||take?.cut||
            source&&(prior.identity!==undefined&&identity!==prior.identity||source.tick<prior.tick))) held=undefined;
          prior={sequence,time,identity:identity??prior?.identity,tick:source?.tick??prior?.tick};
          const sample=source?.samples&&own(source.samples,spec.query)?source.samples[spec.query]:undefined;
          const raw=sample?.value;
          const report={query:spec.query,tick:source?.tick??null};
          if (sample?.status==='ok'&&(scalar?Number.isFinite(raw):valid(raw))) {
            const [low,high]=spec.range, value=scalar?(raw<=low?0:raw>=high?1:(raw-low)/(high-low)):freeze(copy(raw));
            held={value,tick:source.tick};
            return {value,report:{...report,status:'live',...(scalar&&{raw,range:spec.range,clamped:raw<low||raw>high})}};
          }
          const reason=!source?'no world frame':!sample?'query is not published':
            sample.status==='ok'?'query value has the wrong type':sample.reason??sample.status;
          check(spec.missing!=='error','World graph query '+spec.query+': '+reason);
          if (spec.missing==='hold'&&held) return {value:held.value,report:{...report,status:'held',reason,fromTick:held.tick}};
          return {value:spec.fallback,report:{...report,status:'fallback',reason}};
        };
        run.clear=()=>{ settings=spec=held=prior=undefined; };
        return run;
      }
    };
  }

  const operations=Object.freeze({
    'sim.world':{
      description:'Sample a native world or recording once and publish a typed frame for graph ports.',
      inputs:{source:{type:'record',default:{},description:'Embedded world, model, checkpoint or recording. An empty record is unavailable.'},
        commands:{type:'array<record>',default:[]},options:{...optionsPort,properties:{
          tick:{type:'number',unit:'simulation tick',constraints:{integer:true,min:0}},
          eventFrom:{type:'number',unit:'simulation tick',constraints:{integer:true,min:0}},
          queries:{type:'record',description:'Named probes with field, args, at, select and availability condition.'}
        }}},
      outputs:{value:'worldFrame',checkpoint:'record',report:'record'},time:true,instantiate:worldSource
    },
    'sim.worldPulse':{
      description:'Filter committed event envelopes into a typed pulse log.',
      inputs:{source:sourcePort,options:optionsPort},outputs:{value:'eventLog',report:'record'},run:pulse
    },
    'sim.worldScalar':queryPort('unitScalar'),
    'sim.worldRecord':queryPort('record')
  });
  W.graphPorts=Object.freeze({format,operations,queries:value=>settings({queries:value}).queries,frameOf,
    tagFrame:(value,origin)=>origins.set(value,origin)});
  P.graph.operations=Object.freeze({...P.graph.operations,...operations});
})(KIT);
