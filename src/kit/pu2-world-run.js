/* A fixed-tick simulation host with registered systems and portable run state. */
(function (K) {
  const W = K.world, P = K.procedural, Q = W.query, U = K.quantities, freeze = P.data.freeze;
  const {check,record,id,vector,own,copy,equal,endpoint,portOf} = W.data;
  const factories = new Map();
  const clock = () => typeof performance === 'undefined' ? Date.now() : performance.now();
  const maxTick = 10000000, maxPendingCommands=100000;
  const tickOK = value => Number.isSafeInteger(value) && value >= 0 && value <= maxTick;
  const ordered = value => Object.keys(value).sort();
  const worldActions = ['input','patch','event','transfer'];
  const worldAction = (plan, name) => worldActions.includes(name) || plan.chunks?.actions.includes(name) ||
    plan.storyLifecycle && W.storyLifecycle.actions.includes(name) ||
    plan.incidentCandidates && name===W.incidentCandidates.action;
  const checkpointFormat = 'ink-studio/checkpoint', runFormat = 'ink-studio/run';
  const savedCheckpoints=new WeakSet(), branchToken=Symbol('live checkpoint');

  function stepTiming(world,at,timing) {
    const baseDt=world.dt, substeps=timing?.substeps??1, detail=timing?.detail;
    const time=timing&&timing.end!==1?(at-1+timing.end)*baseDt:at*baseDt;
    const dt=detail?baseDt*((timing.substep===1?detail.elapsed-1:0)+1/substeps):
      timing?baseDt*timing.every/substeps:baseDt;
    const lod=detail&&Object.freeze({chunk:detail.chunk,level:detail.level,tuning:detail.tuning,
      activeTicks:detail.activeTicks,time:baseDt*(detail.activeTicks-1+timing.substep/substeps)});
    return {tick:at,time,dt,...(timing&&{baseDt,every:timing.every,substep:timing.substep,substeps}),
      ...(lod&&{simulationLOD:lod})};
  }
  function randomSource(seed,name,at,timing){
    const base=timing?.substeps>1?at+'.'+timing.substep:at;
    const randomTick=timing?.segment===undefined ? base : base+'.segment.'+timing.segment;
    return key=>P.data.hash(name+'/'+randomTick+'/'+String(key),seed)/4294967296;
  }
  function eventContext(ctx,start) {
    const eventAt = (fraction,event) => W.timedEvents.within(start,ctx.time,fraction,event);
    return Object.freeze({...ctx,eventAt,
      emitAt:(fraction,kind,event={},parents)=>ctx.emit(kind,eventAt(fraction,event),parents)});
  }
  function* partitionGroups(names,barriers){
    let start=0;
    for(let i=0;i<names.length;i++)if(barriers.has(names[i])){
      yield names.slice(start,i+1);
      start=i+1;
    }
    if(start<names.length)yield names.slice(start);
  }
  function partitionKernel(source,implementations={}){
    const world=freeze(source), catalog=W.materials.catalog(world), providers=new Map(), models=new Map();
    const boundary=()=>{throw Error('Partition solvers need declared boundary inputs');};
    const query=new Proxy({}, {get:boundary});
    const restricted={world:{get:boundary},states:{get:boundary},...(world.causality&&{causal:{get:boundary}})};
    return ({name,state,input,at,timing,model,profile})=>{
      let provider=providers.get(name);
      if(!provider){
        const spec=world.systems[name];
        const factory=factoryFor(spec,implementations);
        provider=factory?.(spec.config??{},{world,id:name,catalog});
        check(provider?.partitionStep===true,'System cannot run in a worker partition: '+name);
        providers.set(name,provider);
      }
      let adapter;
      if(model){
        const key=name+'/'+state.level;
        adapter=models.get(key);
        if(!adapter){
          adapter=W.simulationAggregate.define(provider,freeze(model),name);
          models.set(key,adapter);
        }
      }
      const effects=[];
      const note=method=>(...args)=>{effects.push([method,args.map(value=>value===undefined?value:copy(value))]);};
      const spatial=provider.dependencies&&Object.freeze({write:note('write'),rebuilt:note('rebuilt'),
        changes(){throw Error('Partition solvers cannot read spatial invalidations');}});
      const contracted=provider.contract!==undefined||world.systems[name].contract!==undefined;
      const step=stepTiming(world,at,freeze(timing)), emit=note('emit');
      const stamps=eventContext({time:step.time,emit},Math.max(0,step.time-step.dt));
      const ctx=Object.freeze(Object.defineProperties({id:name,...step,input:freeze(input),query,
        emit,eventAt:stamps.eventAt,emitAt:stamps.emitAt,...(spatial&&{spatial}),random:randomSource(world.seed,name,at,timing),
        ...(contracted&&{read(alias){throw Error('Undeclared system state read '+name+'/'+String(alias));}})},restricted));
      const start=profile?clock():0, saved=freeze(state);
      const next=adapter?W.simulationAggregate.advance(adapter,saved,ctx):provider.step(saved,ctx);
      return { ...(next===saved?{unchanged:true}:{state:next}),effects,ms:profile?clock()-start:0 };
    };
  }

  function register(kind, factory, { worker = false, revision = 1 } = {}) {
    const versions = factories.get(kind) ?? new Map();
    check(id(kind) && typeof factory === 'function' && Number.isSafeInteger(revision) && revision > 0 &&
      !versions.has(revision), 'Invalid or duplicate system kind ' + kind + ' revision ' + revision);
    versions.set(revision, {factory, worker});
    factories.set(kind, versions);
  }
  function registration(spec) {
    const versions = factories.get(spec.kind);
    return spec.operatorRevision === undefined ? versions?.values().next().value : versions?.get(spec.operatorRevision);
  }
  function factoryFor(spec, implementations) {
    if (spec.operatorRevision === undefined && own(implementations, spec.kind)) return implementations[spec.kind];
    const resolved = registration(spec);
    check(spec.operatorRevision === undefined || resolved,
      'Unregistered simulation operator ' + spec.kind + ' revision ' + spec.operatorRevision);
    return resolved?.factory;
  }
  const types = {
    bool:value => typeof value === 'boolean',
    number:Number.isFinite,
    event:Array.isArray,
    vec3:value => vector(value),
    record
  };
  const defaults = {bool:false,number:0,event:[],vec3:[0,0,0],record:{}};
  function portValue(descriptor,value,name) {
    check(descriptor && types[descriptor.type]?.(value), 'Invalid value for ' + name);
    if (descriptor.type==='event') for (const event of value) W.timedEvents.timeOf(event);
    return freeze(copy(value));
  }
  function portDeclarations(spec, system, name) {
    const declarations = spec.portQuantities === undefined ? {} : spec.portQuantities;
    check(record(declarations) && Object.entries(declarations).every(([direction, table]) =>
      ['inputs','outputs'].includes(direction) && record(table) &&
      Object.keys(table).every(port => own(system[direction],port))),
    'Unknown port in physical quantity declarations for ' + name);
    return declarations;
  }
  function physicalPort(descriptor, override, path) {
    if (descriptor.quantity === undefined && override === undefined) return descriptor;
    check(['number','vec3'].includes(descriptor.type), 'Physical world port ' + path + ' needs number or vec3');
    const inherited = U.normalize(descriptor.quantity,path), added = U.normalize(override,path);
    const quantity = {...inherited,...added};
    U.assertLink(quantity,inherited,path,path);
    return {...descriptor,quantity};
  }
  function physicalRates(world, ports, schedule) {
    const T = P.takeTime;
    const rate = world.takeClock?.simulationRate;
    let base;
    for (const table of Object.values(ports)) for (const [path, descriptor] of Object.entries(table)) {
      if (!descriptor.quantity) continue;
      base ??= rate === undefined ? T.div(T.read(1),T.period(world.dt)) : T.read(rate);
      const [name] = endpoint(path);
      const cadences = schedule.chunks?.rates(name) ?? [schedule.rates[name]];
      const rates = [];
      for (const {every,substeps} of cadences) {
        const value = U.rateValue(T.mul(base,[BigInt(substeps),BigInt(every)]));
        if (!rates.some(rate => U.equalRate(rate,value))) rates.push(value);
      }
      const {sampleRate, ...physical} = descriptor.quantity;
      check(sampleRate === undefined || rates.length === 1 && U.equalRate(sampleRate,rates[0]),
        'Declared sample rate ' + (sampleRate === undefined ? '' : U.rateText(sampleRate)) +
        ' on ' + path + ' does not match its schedule (' + rates.map(U.rateText).join(', ') + ')');
      table[path] = freeze({...descriptor, quantity:{...physical,...(rates.length === 1 && {sampleRate:rates[0]})},
        ...(rates.length > 1 && {sampleRates:rates})});
    }
  }
  function compile(world, implementations = {}, interfacesOnly = false) {
    const systems = {};
    const catalog = W.materials.catalog(world);
    const ports = {inputs:{},outputs:{}};
    for (const name of ordered(world.systems)) {
      const spec = world.systems[name], factory = factoryFor(spec,implementations);
      check(name !== 'world' && id(spec.kind) && typeof factory === 'function', 'Unknown or reserved system ' + name + ' (' + spec.kind + ')');
      check(record(spec.config??{}),'Invalid config for '+name);
      const system = factory(spec.config ?? {},{world,id:name,catalog});
      check(record(system) && typeof system.initial === 'function', 'System needs an initial state: ' + name);
      const declarations = portDeclarations(spec,system,name);
      for (const direction of ['inputs','outputs']) {
        for (const [key,raw] of Object.entries(system[direction] ?? {})) {
          const path = name + '/' + key;
          const descriptor = typeof raw === 'string' ? {type:raw} : raw;
          check(id(key) && record(descriptor) && own(types,descriptor.type), 'Invalid port ' + path);
          check(descriptor.timing===undefined || direction==='inputs' && descriptor.type==='event' &&
            (descriptor.timing==='split' && typeof system.react==='function' && typeof system.step==='function' ||
              descriptor.timing==='forward' && system.timedForward===true),
          'Invalid timed event input '+path);
          const value = portValue(descriptor,descriptor.default ?? defaults[descriptor.type],path);
          ports[direction][path] = freeze({...physicalPort(descriptor,declarations[direction]?.[key],path),default:value});
        }
      }
      for (const [key,handler] of Object.entries(system.actions ?? {}))
        check(id(key) && typeof handler === 'function', 'Invalid action ' + name + '/' + key);
      systems[name] = system;
    }
    if(interfacesOnly)return {systems,ports};
    const chunks=W.simulationChunks.compile(world,systems);
    const aggregates=W.simulationAggregate.bind(systems,chunks);
    const reservations=W.reservations.bind(systems);
    const worksites=W.worksites.bind(systems);
    if (world.visual?.volume!==undefined) check(typeof world.visual.volume==='string'&&
      own(systems,world.visual.volume)&&typeof systems[world.visual.volume].volumeFrame==='function',
    'Visual volume must name a live volume system');
    if(world.visual?.enclosedWater!==undefined)check(typeof world.visual.enclosedWater==='string'&&
      own(systems,world.visual.enclosedWater)&&typeof systems[world.visual.enclosedWater].waterFrame==='function',
    'Visual enclosed water must name an enclosed water system');
    const consumers = Object.values(systems).filter(system => system.checkFields);
    const visualFabric=world.visual?.fields?.deformables;
    const visualLinks=world.visual?.fields?.routedLinks;
    const visualPipes=world.visual?.fields?.pipes;
    const visualPower=world.visual?.fields?.powerLines;
    const visualCharacters=world.visual?.fields?.characters;
    const visualIce=world.visual?.fields?.ice;
    const visualContacts=world.visual?.fields?.contactEffects;
    if (consumers.length || world.visual?.fields?.surface!==undefined || visualFabric!==undefined ||
        visualLinks!==undefined || visualPipes!==undefined || visualPower!==undefined || visualCharacters!==undefined ||
        visualIce!==undefined || visualContacts!==undefined || world.visual?.air!==undefined) {
      const query = Q.create({world},systems);
      for (const system of consumers) system.checkFields(query);
      W.materials.checkSurface(query,world.visual?.fields?.surface);
      if(world.visual?.air!==undefined)W.ventilation.checkVisual(query,world.visual.air);
      if(visualFabric!==undefined)check((Array.isArray(visualFabric)?visualFabric:[visualFabric]).every(field=>
        typeof field==='string'&&query.field(field)?.role==='deformable-surfaces'), 'Invalid visual deformable surface field');
      if(visualLinks!==undefined)check((Array.isArray(visualLinks)?visualLinks:[visualLinks]).every(field=>
        typeof field==='string'&&query.field(field)?.role==='routed-links'), 'Invalid visual routed link field');
      if(visualPipes!==undefined)check((Array.isArray(visualPipes)?visualPipes:[visualPipes]).every(field=>
        typeof field==='string'&&query.field(field)?.role==='pipe-network-pipes'), 'Invalid visual pipe field');
      if(visualPower!==undefined)check((Array.isArray(visualPower)?visualPower:[visualPower]).every(field=>
        typeof field==='string'&&query.field(field)?.role==='power-lines'), 'Invalid visual power line field');
      if(visualCharacters!==undefined)check((Array.isArray(visualCharacters)?visualCharacters:[visualCharacters]).every(field=>
        typeof field==='string'&&query.field(field)?.role==='character-actors'), 'Invalid visual character field');
      if(visualContacts!==undefined)check(typeof visualContacts==='string'&&query.field(visualContacts)?.role==='contact-effects-frame',
        'Visual contact effects needs a contact-effects frame field');
      if(visualIce!==undefined){
        const field=typeof visualIce==='string'&&query.field(visualIce);
        check(field?.type==='number'&&field.units==='world','Visual ice needs a numeric thickness field in world units');
      }
    }
    const coupledFields=Object.values(systems).filter(system=>system.spatialCouplings);
    let fieldQuery;
    const relays=coupledFields.length?W.fieldCoupling.relays(coupledFields,fieldQuery=Q.create({world},systems)):[];
    function canonical(entry,writer) {
      const name = typeof entry === 'string' ? entry : entry?.field;
      const field = typeof name === 'string' && !name.includes('/') ? (writer ? writer+'/'+name : (fieldQuery ??= Q.create({world},systems)).field(name)?.name ?? name) : name;
      return typeof entry === 'string' ? field : {...entry,field};
    }
    const navigationSources=new Map();
    const navigationWrites=new Map();
    for (const system of Object.values(systems)) for (const field of system.navigationReads??[]) {
      const canonicalName=(fieldQuery??=Q.create({world},systems)).field(field)?.name;
      if (!canonicalName||navigationSources.has(canonicalName)) continue;
      const [writer]=endpoint(canonicalName);
      if (!systems[writer].navigationSource) continue;
      navigationSources.set(canonicalName,writer);
      if (!navigationWrites.has(writer)) navigationWrites.set(writer,[]);
      navigationWrites.get(writer).push(canonicalName);
    }
    const systemDependencies=Object.entries(systems).filter(([name,system])=>system.dependencies!==undefined||navigationWrites.has(name));
    const dependencies = P.spatialDependencies.create(Object.fromEntries(systemDependencies.map(([name,system])=>{
      const spec = system.dependencies??{};
      check(record(spec) && Array.isArray(spec.reads ?? []) && Array.isArray(spec.writes ?? []),
        'Invalid spatial dependencies for '+name);
      const writes=(spec.writes??[]).map(entry=>canonical(entry,name));
      for (const field of navigationWrites.get(name)??[]) if (!writes.includes(field)) writes.push(field);
      return [name,{reads:(spec.reads ?? []).map(entry=>canonical(entry)),writes}];
    })),{relays});
    const transfers = W.transfers.bind(systems);
    for (const name of transfers.producers) systems[name].checkTransfers?.(transfers.validate);
    const timedInputs = Object.entries(ports.inputs).filter(([,port])=>port.timing!==undefined);
    const timedSolvers = new Map();
    for (const [port,descriptor] of timedInputs) {
      const [name,key] = endpoint(port);
      check(!chunks?.managed.has(name), 'Timed event input needs a fixed receiving schedule: '+port);
      if (descriptor.timing==='split') {
        if (!timedSolvers.has(name)) timedSolvers.set(name,[]);
        timedSolvers.get(name).push(key);
      }
    }
    const schedule = W.rates.schedules(world,systems,chunks,timedInputs.length>0);
    const couplings = W.transferCoupling.bind(systems,transfers,schedule);
    for (const [name,system] of Object.entries(systems)) if (system.processingLimit) {
      const {every,substeps}=schedule.rates[name];
      check(every===1 && substeps===1 && !chunks?.managed.has(name),
        'Prepared kernel needs a fixed sample clock: '+name);
    }
    physicalRates(world,ports,schedule);
    const incoming = new Map(), edges = new Map(), indegree = new Map();
    let filters;
    const {contracts,edges:phaseEdges} = W.systemComposition.compile(world,systems);
    const names = ordered(systems);
    for (const name of names) {
      edges.set(name,[]);
      indegree.set(name,0);
    }
    for (const raw of world.connections) {
      check(record(raw), 'Invalid connection');
      const edge={...raw,from:portOf(world,raw.from),to:portOf(world,raw.to)};
      const [from] = endpoint(edge.from), [to] = endpoint(edge.to);
      const source = ports.outputs[edge.from], target = ports.inputs[edge.to];
      check(source && target && source.type === target.type, 'Incompatible or missing ports: ' + edge.from + ' -> ' + edge.to);
      const delay = edge.delay ?? 0;
      const {sample,signal} = W.rates.policy(edge,source.type,schedule.active);
      const advanced = W.signalCrossings.isAdvanced(sample);
      if (!advanced) check(Number.isSafeInteger(delay) && delay >= 0 && delay <= 3600, 'Invalid connection delay');
      check(!incoming.has(edge.to), 'More than one connection feeds ' + edge.to);
      const crossing = advanced ? W.signalCrossings.compile({...edge,sample},schedule,from,to,systems[from].combinational,filters ??= W.signalCrossings.filterBank()) : undefined;
      const varying = source.sampleRates || target.sampleRates;
      U.assertLink(source.quantity,target.quantity,edge.from,edge.to,{sampled:edge.sample !== undefined || edge.signal==='accumulated' || !!varying});
      if (target.quantity && varying && edge.sample === undefined && edge.signal!=='accumulated')
        throw Error('Incompatible physical ports ' + edge.from + ' -> ' + edge.to +
          ': variable sample rates need an explicit world sampling policy');
      const earlyEvent = sample==='events' && delay===0 && target.timing!==undefined && !systems[from].combinational;
      incoming.set(edge.to,{from:edge.from,to:edge.to,delay,sample,signal,...(crossing && {crossing}),
        ...(earlyEvent && {earlyEvent:true})});
      if (earlyEvent || crossing?.immediate || !crossing && delay === 0 && sample !== 'average' && systems[from].combinational)
        phaseEdges.push({kind:'signal',from,to,output:edge.from,input:edge.to});
    }
    if (world.simulationModel) W.models.checkInterface(world,ports,incoming,systems);
    const blockSize = world.simulationModel?.blockSize, blockSystem = names[0];
    if (blockSize !== undefined) {
      check(Number.isSafeInteger(blockSize) && blockSize >= 1 && blockSize <= W.kernels.maxBlockSize &&
        names.length === 1 && systems[blockSystem].kernel?.block === true &&
        typeof systems[blockSystem].stepBlock === 'function' && !incoming.size && !schedule.active &&
        !contracts.size, 'Block models need one block kernel on the model clock without connections or system contracts');
    }
    for (const {from,to} of phaseEdges) {
      indegree.set(to,indegree.get(to)+1);
      edges.get(from).push(to);
    }
    if (contracts.size) for (const targets of edges.values()) targets.sort();
    const ready = names.filter(name => indegree.get(name) === 0), order = [];
    for (let i=0;i<ready.length;i++) {
      const name = ready[i];
      order.push(name);
      for (const other of edges.get(name)) {
        const degree = indegree.get(other)-1;
        indegree.set(other,degree);
        if (!degree) ready.push(other);
      }
    }
    check(order.length === names.length, contracts.size ?
      'Same-phase simulation dependency cycle prevents scheduling: '+names.filter(name=>indegree.get(name)>0).join(', ') :
      'Instantaneous signal cycle; use a delay or a stateful system');
    const causePolicy = W.causality.policy(world.causality);
    const rates = schedule.active ? W.rates.bind(schedule,systems,ports,incoming,order,Boolean(causePolicy)) : null;
    const interactions = W.interactionRuntime.bind({world,systems,chunks,transfers,ports,incoming,portValue});
    const influence = W.influenceRuntime.bind({systems,transfers,chunks});
    const population = W.populationRuntime.bind({systems,transfers,chunks});
    const plan = {world,systems,ports,incoming,order,names,transfers,couplings,dependencies,schedule,rates,timedSolvers,chunks,aggregates,reservations,worksites,
      interactions,influence,population,causePolicy,contracts,phaseEdges,navigationSources};
    plan.storyteller = W.storyteller.compile(world.storyteller,world.dt,world.seed);
    const templates = world.storyTemplates === undefined ? undefined : W.storyTemplates.compile(world);
    if (templates || world.storyDocuments !== undefined || world.storyBindings !== undefined) {
      plan.storyRoles = W.storyRoles.compile(templates?.documents ?? (world.storyDocuments === undefined ? [] : world.storyDocuments),
        templates?.bindings ?? world.storyBindings);
      if (templates) plan.storyTemplates = templates.instances;
      const { documents } = plan.storyRoles;
      plan.storyTriggers = W.storyTriggers.compile(documents, world, systems);
      plan.incidentCatalog = W.incidentCatalog.compile(documents,plan.storyTemplates);
      plan.incidentVariety = W.incidentVariety.compile(documents);
      plan.storyReferences = W.storyReferences.compile(documents, world, systems);
      plan.storyCommitments = W.storyCommitments.compile(documents, systems);
      plan.storyHandoffs = W.storyHandoffs.compile(documents, systems);
      plan.storySettlement = W.storySettlement.compile(documents, systems, transfers);
      plan.storyLifecycle = W.storyLifecycle.compile(documents, world, systems);
      plan.incidentCooldowns = W.incidentCooldowns.compile(documents,world.dt);
      plan.incidentCandidates = W.incidentCandidates.compile(documents,world.dt,plan.storyLifecycle?.feasibility,world.seed,
        world.incidentPressure,plan.incidentCooldowns,plan.storyteller,plan.incidentVariety);
      plan.storyDiagnostics = freeze(documents.flatMap(document =>
        StoryAnalysis.analyze(document).diagnostics.map(issue => ({document:document.id, ...issue}))));
    }
    plan.incidentPressure = plan.incidentCandidates?.pressure??W.incidentPressure.compile(world.incidentPressure,{});
    const eventActions = templates ? templates.eventActions : world.eventActions;
    if (eventActions !== undefined) plan.eventActions = K.eventActions.compile(
      plan.storyRoles ? plan.storyRoles.resolve(eventActions, 'world.eventActions') : eventActions, {
      dt: world.dt, validateAction: command => actionCheck(command, plan, 1, false),
      validateSource: ({ system }) => check(system === undefined || system === 'world' || own(systems, system),
        'Unknown event action source ' + system)
    });
    return plan;
  }
  function actionCheck(raw, plan, min = 1, resolveRoles = true) {
    if (resolveRoles && plan.storyRoles) raw = plan.storyRoles.command(raw);
    check(record(raw) && tickOK(raw.tick) && raw.tick >= min && record(raw.args ?? {}) &&
      (raw.id === undefined || id(raw.id)), 'Invalid scheduled command or command tick');
    const [system,key] = endpoint(raw.action);
    let args = raw.args ?? {};
    if (system === 'world') {
      check(worldAction(plan,key), 'Unknown world action ' + key);
      if (key === 'input') {
        args={...args,port:portOf(plan.world,args.port)};
        check(!plan.incoming.has(args.port), 'A connected input is driven by its source: ' + args.port);
        portValue(plan.ports.inputs[args.port],args.value,args.port);
      } else if (key === 'patch') {
        check(Array.isArray(args.edits) && args.edits.length<=10000 && args.edits.every(edit =>
          record(edit)&&['set','remove','merge','test'].includes(edit.op)&&(edit.op==='remove'||own(edit,'value'))&&
          ['entities','metadata'].includes(W.data.selector(edit.path)[0])),
        'Live patches may change entities and metadata');
      } else if(plan.chunks?.actions.includes(key))plan.chunks.checkAction(key,args);
      else if (key === 'transfer') plan.transfers.validate(args);
      else if (key===W.incidentCandidates.action) plan.incidentCandidates.checkAction(args);
      else if (W.storyLifecycle.actions.includes(key)) plan.storyLifecycle.checkAction(key,args);
      else {
        check(id(args.kind), 'An event needs a kind');
        W.timedEvents.timeOf(args);
      }
    } else {
      check(own(plan.systems[system]?.actions,key), 'Unknown action ' + raw.action);
      plan.systems[system].checkAction?.(key,args);
    }
    return freeze(copy({...raw,args}));
  }
  function scenarioCheck(scenario,plan) {
    if (!scenario) return;
    check(record(scenario) && Array.isArray(scenario.commands ?? []) && Array.isArray(scenario.rules ?? []) &&
      (scenario.allow === undefined || Array.isArray(scenario.allow)) &&
      (scenario.start === undefined || Array.isArray(scenario.start)) &&
      (scenario.until === undefined || tickOK(scenario.until)), 'Invalid scenario specification');
    for (const name of scenario.allow ?? []) {
      const [system,action] = endpoint(name);
      check(system === 'world' ? worldAction(plan,action) : own(plan.systems[system]?.actions,action),
        'Unknown allowed action ' + name);
    }
    const ids = new Set();
    for (const rule of scenario.rules ?? []) {
      check(record(rule) && id(rule.id) && !ids.has(rule.id) && id(rule.kind) &&
        ['score','win','fail','metric'].includes(rule.kind) &&
        (rule.kind !== 'score' || Number.isFinite(rule.value)), 'Invalid or duplicate scenario rule');
      ids.add(rule.id);
      if (rule.field !== undefined) check(typeof rule.field === 'string', 'Invalid scenario field');
      Q.condition(rule.when,{});
    }
    for (const command of scenario.commands ?? []) actionCheck(command,plan);
  }
  function weatherProgram(world, catalog) {
    const tracks = world.visual?.weatherTracks;
    if ((tracks === undefined || tracks === false) && !world.visual?.environmentPreset) return null;
    const config = W.visualEnvironment(world,catalog);
    return K.weather.tracks.compile(config.skyEnvironment,config.weatherTracks);
  }
  function timelineCommands(world, timeline) {
    const clock = world.takeClock === undefined ? null : K.timeDomains.take(world.takeClock);
    if (clock) check(clock.dt === world.dt, 'Take simulation rate must match the world timestep');
    return (timeline?.events ?? []).map(row => {
      const { id, time, kind, detail, path } = row;
      const floor = Math.floor(time / world.dt);
      const tick = clock ? timeline.locate(row, clock).cueTick : Math.max(1, floor + Number(time > floor * world.dt));
      return { tick, action: 'world/event', args: { ...detail, kind, timeline: { id, path, time } } };
    });
  }
  function prepare(source,{implementations} = {}) {
    const world = source?.format === W.models.format ? W.models.compile(source) : W.manifest(W.models.expand(source));
    const plan = compile(world,implementations);
    for (const command of world.commands) actionCheck(command,plan);
    scenarioCheck(world.scenario,plan);
    const catalog = W.materials.catalog(world);
    const visual = W.validateLooks(world, catalog);
    const timeline = W.sceneTimeline(world);
    for (const command of timelineCommands(world, timeline)) actionCheck(command,plan);
    const weather = weatherProgram(world,catalog);
    check(world.history === undefined || record(world.history), 'Invalid history policy');
    if (world.history?.where !== undefined) Q.condition(world.history.where,{});
    if (world.history?.enabled !== undefined) check(typeof world.history.enabled==='boolean','History enabled must be boolean');
    if (world.history?.limit !== undefined) check(Number.isSafeInteger(world.history.limit) &&
      world.history.limit > 0 && world.history.limit <= 100000, 'History limit must be 1–100000');
    const past=world.history?.past??[];
    check(Array.isArray(past)&&past.length<=100000&&past.every(event=>record(event)&&id(event.id)&&
      id(event.kind)&&Number.isSafeInteger(event.tick)&&event.tick<0)&&new Set(past.map(row=>row.id)).size===past.length,
      'Past history needs unique IDs, event kinds and negative ticks');
    for (const [name,prefab] of Object.entries(world.prefabs)) {
      const sandbox = W.manifest({id:'prefab-check',prefabs:{[name]:prefab},assetPacks:world.assetPacks});
      const stamped = W.stamp(sandbox,name,'instance').world;
      W.validateLooks({...stamped,visual,dataInputs:world.dataInputs}, catalog);
      const prefabPlan = compile(stamped,implementations);
      for (const port of Object.values(stamped.entities.instance.ports))
        check(own(prefabPlan.ports.inputs,port) || own(prefabPlan.ports.outputs,port), 'Invalid public prefab port ' + port);
    }
    return {world,plan,weather,timeline};
  }
  const implementationsFor=(implementations,workerPool)=>workerPool?.implementations?
    {...workerPool.implementations,...implementations}:implementations;
  const validate=(source,{implementations,workerPool}={})=>
    prepare(source,{implementations:implementationsFor(implementations,workerPool)}).world;
  function storyPreflight(source,{implementations,workerPool}={}) {
    const options = {implementations:implementationsFor(implementations,workerPool)};
    let {world,plan} = prepare(source,options);
    if (world.scenario?.start?.length) ({world,plan} = prepare(W.apply(world,world.scenario.start).world,options));
    return freeze({format:'ink-studio/story-preflight',version:1,world:world.id,valid:true,
      documents:plan.storyRoles?.documents.map(document => document.id) ?? [], diagnostics:plan.storyDiagnostics ?? [],
      ...(plan.storyTemplates && {templates:plan.storyTemplates}),
      ...(plan.incidentCatalog?.length && {incidentCatalog:W.incidentCatalog.find(plan.incidentCatalog)}),
      ...(plan.incidentCandidates && {incidentCandidates:plan.incidentCandidates.policies}),
      ...(plan.incidentPressure && {incidentPressure:plan.incidentPressure}),
      ...(plan.incidentCooldowns && {incidentCooldowns:plan.incidentCooldowns}),
      ...(plan.incidentVariety && {incidentVariety:plan.incidentVariety}),
      ...(plan.storyteller && {storyteller:{active:plan.storyteller.active,profiles:plan.storyteller.profiles,
        candidates:plan.incidentCandidates?.direction??{}}}),
      ...(plan.storyLifecycle?.feasibility && {feasibility:plan.storyLifecycle.feasibility}),
      ...(plan.storyLifecycle?.decisions && {decisions:plan.storyLifecycle.decisions}),
      ...(plan.storyLifecycle?.beats && {beats:plan.storyLifecycle.beats}),
      ...(plan.storyReferences && {liveReferences:plan.storyReferences.definitions}),
      ...(plan.storyCommitments && {commitments:plan.storyCommitments}),
      ...(plan.storyHandoffs && {handoffs:plan.storyHandoffs}),
      ...(plan.storySettlement && {settlements:plan.storySettlement}),
      ...(plan.storyRoles && Object.keys(plan.storyRoles.roles).length > 0 && {roles:plan.storyRoles.roles})});
  }
  function modelInterface(source) {
    const {world,plan:{systems,ports}} = prepare(source);
    return {world,systems,ports};
  }
  function create(source, {checkpoint,implementations,profile = false,validated = false,workerPool,regionRevisions,traceSteps,
    recordRun,playback,skipInitialSubmission=false,validateEntities} = {}, token) {
    check(workerPool===undefined||typeof workerPool?.solve==='function'&&
      (workerPool.async===undefined||typeof workerPool.async==='boolean'),'Invalid simulation worker pool');
    check(validateEntities===undefined||typeof validateEntities==='function','Invalid entity validation callback');
    const modules=workerPool?.implementations;
    const installed=implementationsFor(implementations,workerPool);
    let result=validated?{world:source,plan:compile(source,installed)}:prepare(source,{implementations:installed});
    let {world}=result;
    if (!checkpoint && world.scenario?.start?.length) {
      const edited = W.apply(world,world.scenario.start).world;
      result=prepare(edited,{implementations:installed});
      world=result.world;
    }
    const {plan, weather = weatherProgram(world), timeline = W.sceneTimeline(world)}=result;
    const {systems,ports,incoming,order,names,transfers,couplings,dependencies,rates,chunks,aggregates,reservations,worksites,
      interactions,influence,population,causePolicy,contracts,phaseEdges,eventActions,storyTriggers,storyLifecycle,storyReferences,storyCommitments,storyHandoffs,storySettlement,storyRoles,storyTemplates,incidentCatalog,incidentCandidates,incidentPressure,incidentCooldowns,incidentVariety,storyteller,navigationSources} = plan;
    let composition, inspection;
    const regions=regionRevisions===undefined?null:W.regionRevisions.capture(world,regionRevisions,systems);
    const debug=traceSteps===undefined?null:W.stepDebug.capture(traceSteps);
    const observers=names.filter(name=>systems[name].afterStep);
    const partitioned=workerPool&&new Set(names.filter(name=>{
      const spec=world.systems[name], {kind}=spec;
      return systems[name].partitionStep===true&&!plan.timedSolvers.has(name)&&!Object.keys(contracts.get(name)?.reads??{}).length&&
        (spec.operatorRevision===undefined&&own(installed,kind)?
          own(modules,kind)&&installed[kind]===modules[kind]:registration(spec)?.worker);
    }));
    const partitionBarriers=workerPool&&new Set();
    if(partitioned?.size)for(const {from,to} of phaseEdges)
      if(partitioned.has(to))partitionBarriers.add(from);
    const jobsBySystem=new Map();
    let partitionBatches=0, peakWorkers=0;
    const projection = Q.projection(systems);
    const slowReaders = new Map(rates ? dependencies.describe.filter(({id,reads})=>reads.length&&
      (rates.rates[id].every>1||chunks?.managed.get(id)?.schedules))
      .map(({id})=>[id,rates.rates[id].every]) : []);
    const rootInputs = Object.fromEntries(Object.entries(ports.inputs).map(([name,port]) => [name,port.default]));
    const rootOutputs = Object.fromEntries(Object.entries(ports.outputs).map(([name,port]) => [name,port.default]));
    const rootDelays = Object.fromEntries([...incoming.values()].filter(edge => edge.delay && !edge.crossing).map(edge =>
      [edge.to,Array(edge.delay).fill(W.rates.buffered(edge)?W.rates.zero(ports.outputs[edge.from].type):rootOutputs[edge.from])]));
    const metrics = new Map();
    const scheduled = new Map();
    let eventInputs;
    let commandTicks;
    const added = [];
    const historyLimit = world.history?.limit ?? 10000;
    let tick = 0, states = {}, outputs = rootOutputs, manual = rootInputs, delays = rootDelays,
      history = [], dropped = 0, lastEvents = [], scenario = {status:'running',score:0,matched:{},metrics:{}};
    let pendingWrites = [], lastDependencies = null, sampling, spatialSampling = {};
    let causalState, weatherTrackState, chunkState;
    let currentQuery, lastTransfers = [], lastSignals = {...rootInputs,...rootOutputs};
    let lastCheckpoint, eventActionCounts = freeze({}), storyTriggerState, asyncActive=false, inFlightTick=0;
    let storyLifecycleState = storyLifecycle?.initial();
    let storyFeasibilityState = storyLifecycle?.initialFeasibility?.();
    let storyReferenceState, incidentCandidateState = incidentCandidates?.initial();

    const stateViews=names.filter(name=>systems[name].viewState), viewCache=new WeakMap();
    function visibleStates(values){
      const base=aggregates?.view(values)??values;
      if(!stateViews.length)return base;
      let visible=viewCache.get(base);
      if(!visible){
        const descriptors=Object.getOwnPropertyDescriptors(base);
        for(const name of stateViews){
          let projected;
          descriptors[name]={enumerable:true,get:()=>projected??=systems[name].viewState(base[name])};
        }
        visible=Object.freeze(Object.create(Object.getPrototypeOf(base),descriptors));
        if(Object.isFrozen(values))viewCache.set(base,visible);
      }
      return visible;
    }
    function view(worldValue = world, statesValue = states, signals = lastSignals, tickValue = tick, receipts = lastTransfers,
      causes = causalState, chunkView = chunkState) {
      return Object.freeze({world:worldValue,states:visibleStates(statesValue),
        ...((aggregates||stateViews.length)&&{[W.simulationAggregate.rawStates]:statesValue}),signals,tick:tickValue,time:tickValue*worldValue.dt,history,dropped,
        ...(receipts.length && {transfers:receipts}),...(causes && {causality:causes}),
        ...(chunkView&&{simulationChunks:chunkView}),
        ...(storyTriggerState && {storyTriggers:storyTriggerState}),
        ...(storyLifecycleState && {storyLifecycle:storyLifecycleState}),
        ...(storyCommitments && {storyCommitmentDefinitions:storyCommitments}),
        ...(storyHandoffs && {storyHandoffDefinitions:storyHandoffs}),
        ...(storySettlement && {storySettlementDefinitions:storySettlement}),
        ...(storyFeasibilityState && {storyFeasibility:storyFeasibilityState,storyFeasibilityRules:storyLifecycle.feasibility}),
        ...(storyReferenceState && {storyReferences:storyReferenceState}),
        ...(storyRoles && {storyRoles:storyRoles.roles}),
        ...(incidentCatalog?.length && {incidentCatalog}),
        ...(incidentPressure && {incidentPressure}),
        ...(incidentCooldowns && {incidentCooldowns}),
        ...(incidentVariety && {incidentVariety}),
        ...(storyteller && {storyteller,storytellerCandidates:incidentCandidates?.direction}),
        ...(incidentCandidates && {incidentCandidatePolicies:incidentCandidates.policies,incidentCandidates:incidentCandidateState}),
        ...(storyTemplates && {storyTemplates}),
        ...((storyTemplates||storyLifecycle?.decisions||storyLifecycle?.beats) && {storyDocuments:storyRoles.documents}),
        ...(storyLifecycle?.decisions && {storyDecisions:storyLifecycle.decisions}),
        ...(storyLifecycle?.beats && {storyBeats:storyLifecycle.beats}),
        ...(weatherTrackState && {weatherTrackState})});
    }
    function phaseReader(name,snapshot,staged) {
      const contract=contracts.get(name);
      if (!contract) return undefined;
      return alias => {
        check(typeof alias==='string'&&own(contract.reads,alias),'Undeclared system state read '+name+'/'+String(alias));
        const {system,sample}=contract.reads[alias];
        if (sample!=='current'||!own(staged,system)) return rootedState(visibleStates(snapshot)[system]);
        const state=aggregates ? aggregates.readState(system,staged[system]) : staged[system];
        return rootedState(systems[system].viewState ? systems[system].viewState(state) : state);
      };
    }
    function context(name, worldValue, statesValue, at, input, emit, query, spatial, timing, causal, read) {
      const step = stepTiming(worldValue,at,timing);
      return eventContext({world:worldValue,query,id:name,states:visibleStates(statesValue),
        ...step,input,emit,
        ...(spatial && {spatial}),...(causal && {causal}),...(read && {read}),
        random:randomSource(worldValue.seed,name,at,timing)}, Math.max(0,step.time-step.dt));
    }
    function rootedState(value) {
      return P.data.isImmutable(value) ? value : freeze(copy(value));
    }
    function packCommands() {
      return [...scheduled.keys()].sort((a,b) => a-b).flatMap(key => scheduled.get(key));
    }
    function queue(entries,log) {
      if(entries.length) {
        lastCheckpoint=undefined;
        commandTicks=undefined;
      }
      for (const item of entries) {
        let items = scheduled.get(item.tick);
        if (!items) scheduled.set(item.tick,items = []);
        items.push(item);
      }
      if (log) added.push(...entries);
    }
    function parseCommands(commands,log,min){
      check(Array.isArray(commands) && commands.length <= 100000, 'Expected a bounded command list');
      return commands.map(raw => {
        const command = actionCheck(raw,plan,min);
        if (log && world.scenario?.allow) check(world.scenario.allow.includes(command.action), 'Action is disabled in this scenario: ' + command.action);
        return command;
      });
    }
    function enqueue(commands, log) {
      const entries=parseCommands(commands,log,Math.max(tick,inFlightTick)+1);
      check(entries.length + packCommands().length <= maxPendingCommands, 'Pending command budget exceeded');
      queue(entries,log);
      if(log)evidence?.submit(tick,entries.length);
    }
    function readOutputs(name,state,ctx,target) {
      const out = systems[name].output?.(state,ctx) ?? {};
      check(record(out) && Object.keys(out).every(key => own(ports.outputs,name+'/'+key)), 'Unknown output from ' + name);
      for (const [key,raw] of Object.entries(systems[name].outputs ?? {})) {
        const full = name+'/'+key, spec = ports.outputs[full];
        target[full] = portValue(spec,out[key] ?? spec.default,full);
      }
    }
    function currentValues(name, inputs, live, previous, delayState) {
      const values = {};
      for (const key of Object.keys(systems[name].inputs ?? {})) {
        const port = name+'/'+key, edge = incoming.get(port);
        values[key] = !edge ? inputs[port] : edge.delay ? delayState[port][0] : live[edge.from] ?? previous[edge.from];
      }
      return freeze(values);
    }
    function historyWith(events, policy) {
      if (!events.length || policy?.enabled === false) return {history,dropped};
      const entries = events.filter(event => Q.condition(policy?.where,event));
      if (!entries.length) return {history,dropped};
      const overflow=Math.max(0,history.length+entries.length-historyLimit);
      return {history:freeze(history.slice(overflow).concat(entries.slice(Math.max(0,overflow-history.length)))),
        dropped:dropped+overflow};
    }
    function save() {
      if(lastCheckpoint)return lastCheckpoint;
      lastCheckpoint=freeze({format:checkpointFormat,version:1,tick,world,states,outputs,manual,delays,history,dropped,
        signals:lastSignals,events:lastEvents,pending:packCommands(),scenario,
        ...(eventActions && {eventActionCounts}),
        ...(storyTriggers && {storyTriggerState}),
        ...(storyLifecycle && {storyLifecycleState}),
        ...(storyFeasibilityState && {storyFeasibilityState}),
        ...(storyReferenceState && {storyReferenceState}),
        ...(incidentCandidates && {incidentCandidateState}),
        ...(lastTransfers.length && {transfers:lastTransfers}),
        ...(weatherTrackState && {weatherTrackState}),
        ...(pendingWrites.length && {dependencyWrites:pendingWrites}),...(rates && {sampling}),
        ...(chunkState&&{simulationChunks:chunkState}),
        ...(Object.keys(spatialSampling).length && {spatialSampling}),...(causalState && {causality:causalState})});
      savedCheckpoints.add(lastCheckpoint);
      return lastCheckpoint;
    }
    function install(payload) {
      ({tick,states,outputs,manual,delays,history,dropped,scenario,signals:lastSignals,events:lastEvents}=payload);
      eventActionCounts = payload.eventActionCounts ?? freeze({});
      storyTriggerState = payload.storyTriggerState;
      storyLifecycleState = payload.storyLifecycleState;
      storyFeasibilityState = payload.storyFeasibilityState;
      storyReferenceState = payload.storyReferenceState;
      incidentCandidateState = payload.incidentCandidateState;
      chunkState=payload.simulationChunks;
      sampling=payload.sampling;
      lastTransfers=payload.transfers??[];
      pendingWrites=payload.dependencyWrites??[];
      spatialSampling=payload.spatialSampling??{};
      causalState=payload.causality;
    }
    function restore(saved) {
      check(record(saved) && saved.format === checkpointFormat && saved.version === 1 && equal(saved.world,world) && tickOK(saved.tick),
        'Checkpoint belongs to a different world or version');
      const payload=savedCheckpoints.has(saved)?saved:freeze(copy(saved));
      if(token===branchToken){
        for(const name of names)if(systems[name].shareCheckpoint!==true)systems[name].validateState?.(payload.states[name]);
        install(payload);
        weatherTrackState=payload.weatherTrackState;
        queue(payload.pending,false);
        lastCheckpoint=payload;
        return;
      }
      check(record(payload.states) && equal(ordered(payload.states),names) && record(payload.scenario) &&
        Array.isArray(payload.history) && Array.isArray(payload.events) && Number.isSafeInteger(payload.dropped) && payload.dropped>=0 && Array.isArray(payload.pending),
        'Malformed checkpoint state');
      for (const [bag, schema] of [[payload.outputs,ports.outputs],[payload.manual,ports.inputs],[payload.signals,{...ports.inputs,...ports.outputs}]]) {
        check(record(bag) && equal(ordered(bag),ordered(schema)), 'Malformed checkpoint ports');
        for (const name of ordered(schema)) portValue(schema[name],bag[name],name);
      }
      check(record(payload.delays) && equal(ordered(payload.delays),ordered(rootDelays)), 'Malformed checkpoint delays');
      for (const name of ordered(rootDelays)) {
        check(Array.isArray(payload.delays[name]) && payload.delays[name].length === rootDelays[name].length,'Invalid delay buffer ' + name);
        for (const value of payload.delays[name]) portValue(ports.inputs[name],value,name);
      }
      if(chunks)chunks.validate(payload.simulationChunks,payload.tick);
      else check(!own(payload,'simulationChunks'),'Unexpected simulation chunk checkpoint data');
      aggregates?.validate(payload.states,payload.simulationChunks);
      if (rates) {
        rates.validate(payload.sampling,portValue,payload.tick,payload.simulationChunks);
      }
      for (const name of names) systems[name].validateState?.(payload.states[name]);
      if (eventActions) eventActions.validate(payload.eventActionCounts);
      else check(!own(payload, 'eventActionCounts'), 'Unexpected event action checkpoint data');
      if (storyTriggers) storyTriggers.validate(payload.storyTriggerState,payload.tick);
      else check(!own(payload, 'storyTriggerState'), 'Unexpected story trigger checkpoint data');
      if (storyLifecycle) storyLifecycle.validate(payload.storyLifecycleState,payload.tick,payload.storyFeasibilityState,payload.storyTriggerState);
      else check(!own(payload, 'storyLifecycleState'), 'Unexpected story lifecycle checkpoint data');
      if (!storyLifecycle?.feasibility) check(!own(payload,'storyFeasibilityState'),'Unexpected story feasibility checkpoint data');
      if (incidentCandidates) incidentCandidates.validate(payload.incidentCandidateState,payload.tick,payload.storyTriggerState,
        payload.storyLifecycleState,payload.storyFeasibilityState);
      else check(!own(payload,'incidentCandidateState'),'Unexpected incident candidate checkpoint data');
      if (storyReferences) storyReferences.validate(payload.storyReferenceState,payload.tick,payload.storyLifecycleState);
      else check(!own(payload,'storyReferenceState'),'Unexpected story live reference checkpoint data');
      transfers.validateBalances(payload.states);
      reservations?.validate(payload.states,payload.tick);
      if (own(payload,'transfers')) transfers.validateReceipts(payload.transfers,payload.tick);
      if (own(payload,'dependencyWrites')) {
        check(Array.isArray(payload.dependencyWrites),'Invalid saved spatial writes');
        dependencies.begin(payload.dependencyWrites);
      }
      if (own(payload,'spatialSampling')) {
        check(record(payload.spatialSampling),'Malformed spatial sampling buffers');
        for (const [name,notices] of Object.entries(payload.spatialSampling)) {
          const waiting=chunks?.managed.has(name)?payload.simulationChunks.clocks[name].lastTick!==payload.tick:payload.tick%slowReaders.get(name);
          check(slowReaders.has(name) && waiting && Array.isArray(notices) &&
            dependencies.begin(notices,{propagate:false}).affected(name).length===notices.length,'Invalid saved spatial notices for '+name);
        }
      }
      if (causePolicy) {
        W.causality.validate(payload.causality,payload.tick,ports,incoming,systems,causePolicy);
      } else check(!own(payload,'causality'),'Unexpected causal checkpoint data');
      install(payload);
      if (weather) weatherTrackState = weather.validate(payload.weatherTrackState,tick*world.dt);
      else check(!own(payload,'weatherTrackState'),'Unexpected weather track checkpoint data');
      enqueue(payload.pending,false);
    }
    if (checkpoint) restore(checkpoint);
    else {
      const initialQuery = Q.create(view(),systems,projection);
      for (const name of names) states[name] = rootedState(systems[name].initial(
        context(name,world,Object.freeze({}),0,{},() => {},initialQuery)));
      states = freeze(states);
      const initializers=names.filter(name=>systems[name].settleInitial);
      if(initializers.length){
        const snapshot=states, sceneQuery=Q.create(view(),systems,projection), settled={...snapshot};
        for(const name of initializers)settled[name]=rootedState(systems[name].settleInitial(snapshot[name],
          context(name,world,snapshot,0,{},()=>{},sceneQuery)));
        states=freeze(settled);
      }
      transfers.validateBalances(states);
      if(chunks){
        let focusQuery;
        chunkState=chunks.select(chunks.blank(),at=>(focusQuery??=Q.create(view(),systems,projection)).target(at),0).state;
        if(aggregates){
          const draft={...states};
          if(aggregates.transition(draft,chunkState))states=freeze(draft);
        }
      }
      const startQuery = Q.create(view(),systems,projection);
      const initialOutputs = {};
      for (const name of names) readOutputs(name,states[name],context(name,world,states,0,{},() => {},startQuery,
        undefined,undefined,undefined,phaseReader(name,states)),initialOutputs);
      outputs = freeze(initialOutputs);
      if (causePolicy) causalState = W.causality.initial(ports,incoming,outputs,causePolicy);
      sampling = rates?.seed(outputs,causalState?.outputs);
      lastSignals = freeze({...manual,...outputs});
      const past=world.history?.enabled===false?[]:(world.history?.past??[]).filter(event=>Q.condition(world.history?.where,event));
      history=freeze(copy(past.slice(-historyLimit)));
      dropped=Math.max(0,past.length-historyLimit);
      if (weather) {
        const initialView = view();
        weatherTrackState = weather.step(undefined,{time:0,view:initialView,query:Q.create(initialView,systems,projection)});
      }
      if (storyReferences) storyReferenceState = storyReferences.initial(Q.create(view(),systems,projection));
      if (storyTriggers) storyTriggerState = storyTriggers.initial(Q.create(view(),systems,projection));
      enqueue([...world.commands,...(world.scenario?.commands ?? []),...timelineCommands(world,timeline)],false);
    }
    const origin = save();
    const evidence=recordRun===undefined||recordRun===false?null:W.runRecords.capture(recordRun,origin,rates,query);
    const authoredBlockSize = world.simulationModel?.blockSize;
    const blockSize = authoredBlockSize===undefined ? undefined :
      Math.min(authoredBlockSize,systems[names[0]].processingLimit?.()??authoredBlockSize);
    const blockSystem = blockSize !== undefined && !world.scenario && !weather && !timeline && !eventActions && !storyTriggers &&
      !storyLifecycle && !causePolicy && !regions && !evidence && !playback && !debug ? names[0] : undefined;
    if(!skipInitialSubmission&&playback?.has(tick))enqueue(playback.get(tick),true);
    regions?.publish(view());
    debug?.publish(origin);
    function query() {
      return currentQuery ?? (currentQuery = Q.create(view(),systems,projection));
    }
    function projectEntities(overlay){
      if(!overlay||!Object.keys(overlay.entities).length)return Object.freeze({view:view(),query:query()});
      W.entityLifecycle.assertAvailable(Object.keys(overlay.entities),world.entities);
      const frame=Object.freeze({...view(),world:W.manifest({...world,entities:{...world.entities,...overlay.entities}}),
        [W.entityLifecycle.projection]:overlay});
      return Object.freeze({view:frame,query:Q.create(frame,systems)});
    }
    function evaluateScenario(nextView, events) {
      const rules = nextView.world.scenario;
      if (!rules || scenario.status !== 'running') return scenario;
      const next = {...scenario,matched:{...scenario.matched},metrics:{...scenario.metrics}};
      const now = Q.create(nextView,systems);
      for (const rule of rules.rules ?? []) {
        if (next.matched[rule.id] && rule.once !== false) continue;
        const read = rule.field === undefined ? null : now.probe(rule.field,rule.at,rule.args);
        const candidate = rule.field === undefined ? {tick:nextView.tick,time:nextView.time,events} : read.value;
        if (read && read.status !== 'ok' || !Q.condition(rule.when,candidate)) continue;
        next.matched[rule.id] = (next.matched[rule.id] ?? 0)+1;
        if (rule.kind === 'score') next.score += rule.value;
        if (rule.kind === 'metric') next.metrics[rule.id] = candidate ?? null;
        if (rule.kind === 'win' || rule.kind === 'fail') {
          next.status = rule.kind;
          next.reason = rule.id;
          break;
        }
      }
      if (next.status === 'running' && rules.until !== undefined && nextView.tick >= rules.until) {
        next.status = 'timeout';
        next.reason = 'time limit';
      }
      return freeze(next);
    }
    function* tickWork() {
      const at = tick+1, commands = scheduled.get(at) ?? [], events = [], storyCommands = storyLifecycle && [];
      const candidateCommands = incidentCandidates && [];
      check(tickOK(at),'Tick budget exceeded');
      debug?.start();
      const observedSteps=debug?[]:null;
      const observedTiming=evidence?[]:null;
      let nextWorld = world, changedEntities = new Set();
      const drafts = {...states}, nextManual = {...manual}, requests = [];
      let nextChunkState=chunkState;
      const commanded=chunks&&new Set();
      let trace = pendingWrites.length ? dependencies.begin(pendingWrites) : null;
      const nextWrites = [], activeTrace = () => trace ??= dependencies.begin();
      function navigationChanges(before,after) {
        const changed=[];
        for (const [field,writer] of navigationSources) {
          const old=before.navigationSource(field,true), source=after.navigationSource(field,true);
          if ((!old&&!source)||old&&source&&old.key===source.key) continue;
          const areas=old&&source?.changes?.(old.key);
          const notices=(areas??[null]).map(bounds=>({writer,field,bounds,reason:'navigation-source-changed'}));
          // Keep pending change records bounded even when a large grid changes in many places.
          const compact=notices.length>16?W.simulationChunks.mergeWrites([],notices):notices;
          for (const notice of compact) changed.push({...notice,reason:'navigation-source-changed'});
        }
        return changed;
      }
      function spatial(name, stepping) {
        if (!systems[name].dependencies) return undefined;
        return Object.freeze({
          changes:bounds=>trace?.affected(name,bounds) ?? [],
          write(field,bounds,reason) {
            check(typeof field === 'string','Spatial writes need a field name');
            const canonical = field.includes('/') ? field : name+'/'+field;
            if (!stepping) return activeTrace().change(name,canonical,bounds,reason);
            check(nextWrites.length < P.spatialDependencies.limit,'Spatial write budget exceeded');
            nextWrites.push(dependencies.write(name,canonical,bounds,reason));
          },
          rebuilt:(kind,detail,bounds)=>activeTrace().recordWork(name,kind,detail,bounds)
        });
      }
      const causal = causePolicy && W.causality.begin(causalState,at,ports,incoming,causePolicy);
      const makeEmit = (system,scope,root) => (kind,detail = {},parents) => {
        check(id(kind) && record(detail) && events.length < 10000, 'Invalid event or per-tick event budget exceeded');
        W.timedEvents.timeOf(detail);
        const row=freeze({...copy(detail),kind,system,tick:at,id:at+'.'+events.length});
        events.push(row);
        if (causal) return causal.event(row,parents??scope?.emitParents()??(root?[root]:[]),scope?.location,
          parents?'declared':root?'command':'observed-inputs');
      };
      function setInput(port,next,root){
        const descriptor=ports.inputs[port];
        if (causal && (!rates || descriptor.type!=='event' || next.length))
          causal.manual(port,root,rates && descriptor.type==='event' && nextManual[port].length>0);
        nextManual[port] = rates && descriptor.type==='event' ?
          W.rates.add(nextManual[port],next,'event') : next;
      }
      function systemEmit(name,scope,root) {
        const emit=makeEmit(name,scope,root), allowed=contracts.get(name)?.emits;
        if (!allowed) return emit;
        return (kind,detail,parents) => {
          check(allowed.includes(kind),'Undeclared simulation event '+String(kind)+' from '+name);
          return emit(kind,detail,parents);
        };
      }
      const cleanedStories = storyLifecycle?.cleanup ? storyLifecycle.cleanup(storyLifecycleState, at, ({kind,target}) => {
        const {system} = target, before = drafts[system];
        const query = Q.create(view(nextWorld,{...drafts}),systems,projection);
        const ctx = context(system,nextWorld,Object.freeze({...drafts}),at,{},systemEmit(system),query,spatial(system,false));
        const result = systems[system].storyCleanup[kind].run(before,target,ctx);
        if (result.state !== before) {
          drafts[system] = rootedState(result.state);
          commanded?.add(system);
        }
        return result;
      }, makeEmit('world')) : storyLifecycleState;
      if (storyCommitments) for (const {story,order} of W.storyCommitments.releases(storyCommitments,cleanedStories,at)) {
        const {system,agent,generation,sequence} = order;
        const query = Q.create(view(nextWorld,{...drafts}),systems,projection);
        const sample = query.probe(system+'/orders',undefined,{agent,generation});
        if (sample.status!=='ok') continue;
        const {active,paused,queue} = sample.value;
        if (![active,...paused,...queue].some(row=>row?.sequence===sequence)) continue;
        const ctx = context(system,nextWorld,Object.freeze({...drafts}),at,{},systemEmit(system),query,spatial(system,false));
        drafts[system] = rootedState(systems[system].actions['cancel-order'](drafts[system],{agent,generation,order:sequence},ctx));
        commanded?.add(system);
        makeEmit('world')('story-commitment-released',{story,order});
      }
      for (const item of commands) {
        const [name,key] = endpoint(item.action);
        if(debug)debug.enter({system:W.stepDebug.actionSystem(item),inputs:item.args});
        const root = causal?.command(name,item), emit = makeEmit(name,undefined,root);
        if (name === 'world') {
          if (key === 'input') {
            const {port,value} = item.args, descriptor = ports.inputs[port];
            if(commanded)commanded.add(endpoint(port)[0]);
            const next = portValue(descriptor,value,port);
            setInput(port,next,root);
          }
          if (key === 'patch') {
            const result = W.apply(nextWorld,item.args.edits);
            if(result.world.entities!==nextWorld.entities)validateEntities?.(result.world.entities);
            for(const edge of nextWorld.connections)
              check(portOf(nextWorld,edge.from)===portOf(result.world,edge.from)&&
                portOf(nextWorld,edge.to)===portOf(result.world,edge.to),'Live patch rebinds a connected port');
            for(const path of result.paths)if(changedEntities&&path[0]==='entities'){
              if(path.length===1)changedEntities=null;
              else changedEntities.add(String(path[1]));
            }
            nextWorld = result.world;
            if (result.paths.length) emit('edit',{paths:result.paths});
          }
          if (key === 'event') {
            const {kind,...detail} = item.args;
            emit(kind,detail);
          }
          if (key === 'transfer') {
            requests.push({name,request:item.args,root});
            if(commanded)for(const port of [item.args.from,item.args.to])commanded.add(endpoint(port)[0]);
          }
          if (candidateCommands && key===W.incidentCandidates.action) candidateCommands.push({args:item.args,publish:emit});
          if (storyCommands && W.storyLifecycle.actions.includes(key)) storyCommands.push({action:key,args:item.args,publish:emit});
          if(chunks?.actions.includes(key))nextChunkState=chunks.action(nextChunkState,key,item.args,at);
        } else {
          commanded?.add(name);
          const actionQuery = Q.create(view(nextWorld,{...drafts}),systems,projection);
          const scope=causal?.scope(name,{}, {},actionQuery,{root,queryTick:tick,queryTime:tick*nextWorld.dt});
          causal?.action(name,root);
          const ctx = context(name,nextWorld,Object.freeze({...drafts}),at,{},systemEmit(name,scope,root),actionQuery,
            spatial(name,false),undefined,scope?.api);
          drafts[name] = rootedState(systems[name].actions[key](drafts[name],item.args,ctx));
        }
      }
      debug?.leave();
      projection?.change(world.entities,nextWorld.entities,changedEntities);
      let focusQuery;
      const chunkStep=chunks?.select(nextChunkState,at=>(focusQuery??=Q.create(view(nextWorld,drafts),systems,projection)).target(at),at,{
        commanded, hasEvents:name=>rates.hasEvents(name,sampling,nextManual,delays),
        affected(name,members){
          const external=row=>!members.includes(row.writer);
          return spatialSampling[name]?.some(external)||trace?.affected(name).some(external);
        },
        emit:makeEmit('world')
      });
      if(chunkStep)nextChunkState=chunkStep.state;
      const detailed=name=>{
        const managed=chunks?.managed.get(name), entry=managed&&nextChunkState.entries[managed.chunk];
        return !entry||!entry.sleeping&&!managed.models.has(entry.level);
      };
      population?.run(drafts,{tick:at,root:rootedState,emit:systemEmit,
        query:()=>Q.create(view(nextWorld,{...drafts},lastSignals,at,[],causalState,nextChunkState),systems,projection),
        context:(name,query)=>context(name,nextWorld,Object.freeze({...drafts}),at,{},systemEmit(name),query,spatial(name,false)),
        detail:(name,state)=>aggregates?aggregates.readState(name,state):state,
        retain:(name,previous,state)=>aggregates?aggregates.retainDetail(name,previous,state):state
      });
      if(reservations)Object.assign(drafts,reservations.run(drafts,{tick:at,emit:makeEmit},detailed));
      if (transfers.producers.length) {
        const before = Object.freeze({...drafts});
        const requestQuery = Q.create(view(nextWorld,before,lastSignals,at,[],causalState,nextChunkState),systems,projection);
        for (const name of transfers.producers) {
          const managed=chunks?.managed.has(name), detail=managed&&chunkStep.due.get(name);
          if(managed&&!detail)continue;
          const input = currentValues(name,nextManual,{},outputs,delays);
          const timing=detail&&{start:0,end:1,every:detail.every,substeps:1,substep:1,detail};
          const ctx = context(name,nextWorld,before,at,input,systemEmit(name),requestQuery,undefined,timing||undefined);
          const planned = systems[name].requestTransfers(before[name],ctx,Math.max(0,W.transfers.limit-requests.length));
          check(Array.isArray(planned) && planned.length + requests.length <= W.transfers.limit,
            'Expected a bounded transfer request list from '+name);
          for (const request of planned) requests.push({name,request});
        }
      }
      check(requests.length <= W.transfers.limit,'Transfer request budget exceeded');
      let confirmations;
      function balanceChanges(before,after,ref,queryNow) {
        let query;
        for (const [index,account] of before.entries()) {
          const site=account.at;
          let anchor=null;
          if (Array.isArray(site)) anchor={point:site};
          else if (site) {
            query??=queryNow();
            const target=W.worksites.frame(query,site);
            anchor={...site,...(target?.point&&{point:target.point})};
          }
          causal.balance(account,after[index],ref,anchor);
        }
      }
      function settleTransfer(request,name,emit) {
        const accounts=[request.from,request.to];
        const before=causal?.balance&&accounts.map(account=>transfers.inspect(drafts,account));
        const receipt=transfers.settle(drafts,request,at,name,rootedState);
        const ref=emit('transfer',receipt);
        if (before&&receipt.status!=='blocked')
          balanceChanges(before,accounts.map(account=>transfers.inspect(drafts,account)),ref,
            ()=>Q.create(view(nextWorld,{...drafts}),systems,projection));
        return receipt;
      }
      let receipts = requests.map(({name,request,root})=>{
        const receipt = settleTransfer(request,name,makeEmit(name,undefined,root));
        if(systems[name]?.receiveTransfers){
          confirmations??=new Map();
          if(!confirmations.has(name))confirmations.set(name,[]);
          confirmations.get(name).push(receipt);
        }
        return receipt;
      });
      for(const [name,confirmed] of confirmations??[])
        drafts[name]=rootedState(systems[name].receiveTransfers(drafts[name],confirmed,{tick:at,emit:systemEmit(name)}));
      for (const {name,solve} of couplings) {
        const {enabled}=currentValues(name,nextManual,{},outputs,delays);
        const {requests,report}=solve(drafts,{tick:at,dt:nextWorld.dt,requester:name,root:rootedState,enabled});
        check(receipts.length+requests.length<=W.transfers.limit,'Transfer coupling exceeds the tick receipt budget');
        const emit=makeEmit(name);
        for (const request of requests) receipts.push(settleTransfer(request,name,emit));
        drafts[name]=rootedState(report);
      }
      function lateTransfer(source,request){
        if(receipts.length>=W.transfers.limit)return undefined;
        const receipt=rootedState(settleTransfer(request,source,systemEmit(source)));
        receipts.push(receipt);
        return receipt;
      }
      const queryDrafts=()=>Q.create(view(nextWorld,{...drafts},lastSignals,at,receipts.slice(),causalState,nextChunkState),systems,projection);
      aggregates?.transition(drafts,nextChunkState,makeEmit('world'));
      worksites?.run(drafts,{tick:at,dt:nextWorld.dt,detailed,root:rootedState,emit:makeEmit,
        input:name=>currentValues(name,nextManual,{},outputs,delays),
        query:()=>Q.create(view(nextWorld,{...drafts},lastSignals,at,receipts,causalState,nextChunkState),systems,projection),
        context:(name,query)=>context(name,nextWorld,Object.freeze({...drafts}),at,{},systemEmit(name),query,spatial(name,false))
      });
      interactions?.run(drafts,{world:nextWorld,tick:at,detailed,root:rootedState,emit:systemEmit,input:setInput,
        query:queryDrafts,
        effect(source,effect,query,interaction){
          if((effect.destinations??[effect.destination]).some(name=>!detailed(name)||
            W.simulationAggregate.isAggregate(drafts[name])))return {reason:'effect-asleep'};
          if(effect.kind==='transfer'){
            const receipt=lateTransfer(source,effect.request);
            if(!receipt)return {reason:'transfer-budget'};
            return {receipt,...(receipt.status==='blocked'&&{reason:'transfer-blocked'})};
          }
          if(effect.kind==='input')return {port:effect.port,value:effect.value};
          const {destination,handler,args}=effect, emit=systemEmit(destination), writer=spatial(destination,false);
          const base=context(destination,nextWorld,Object.freeze({...drafts}),at,{},emit,query,writer);
          const notes=[], deferred=(write)=>(...args)=>notes.push(()=>write(...args));
          const staged=Object.freeze({...base,emit:deferred(emit),...(writer&&{spatial:Object.freeze({
            ...writer,write:deferred(writer.write),rebuilt:deferred(writer.rebuilt)
          })})});
          const prepared = effect.kind==='story-host' ?
            effect.host(drafts[destination],args,staged,{service:source,...interaction}) : handler.run(drafts[destination],args,1,staged);
          const detail = effect.kind==='story-host' ? {receipt:prepared.receipt} : {};
          if(prepared.reason)return {reason:prepared.reason,...detail};
          drafts[destination]=rootedState(prepared.state);
          for(const publish of notes)publish();
          return detail;
        }
      });
      if(influence){
        const available=account=>{
          const [name]=endpoint(account);
          return detailed(name)&&!W.simulationAggregate.isAggregate(drafts[name]);
        };
        influence.run(drafts,{tick:at,root:rootedState,detailed,emit:systemEmit,query:queryDrafts,previousEvents:lastEvents,events,
          transfer:(source,request)=>available(request.from)&&available(request.to)?lateTransfer(source,request):undefined,
          balance:account=>available(account)?transfers.inspect(drafts,account):null,
          context:(name,query)=>context(name,nextWorld,Object.freeze({...drafts}),at,{},systemEmit(name),query,spatial(name,false))
        });
      }
      freeze(receipts);
      const committed = freeze(drafts);
      const navigationBefore=navigationSources.size&&Q.create(
        view(nextWorld,committed,lastSignals,tick,receipts,causalState,nextChunkState),systems,projection);
      if (navigationBefore) for (const notice of navigationChanges(query(),navigationBefore))
        activeTrace().change(notice.writer,notice.field,notice.bounds,notice.reason);
      let nextSpatial = spatialSampling;
      if (slowReaders.size && (trace || Object.keys(spatialSampling).length)) {
        nextSpatial = {...spatialSampling};
        for (const [name,every] of slowReaders) {
          const waiting = nextSpatial[name] ?? [];
          const managed=chunks?.managed.has(name), due=managed?chunkStep.due.has(name):at%every===0;
          if (due) {
            for (const notice of waiting) activeTrace().deliver(notice,name);
            delete nextSpatial[name];
          } else {
            const current = trace?.affected(name) ?? [];
            if (current.length) {
              if(managed)nextSpatial[name]=W.simulationChunks.mergeWrites(waiting,current);
              else{
                const tracked=row=>row.reason==='navigation-source-changed';
                const ordinary=waiting.filter(row=>!tracked(row)).concat(current.filter(row=>!tracked(row))
                  .map(({writer,field,bounds,reason})=>({writer,field,bounds,reason})));
                const navigation=W.simulationChunks.mergeWrites(waiting.filter(tracked),current.filter(tracked))
                  .map(row=>({...row,reason:'navigation-source-changed'}));
                check(ordinary.length+navigation.length<=P.spatialDependencies.limit,'Spatial sampling buffer exceeds its budget');
                nextSpatial[name]=ordinary.concat(navigation);
              }
            }
          }
        }
        nextSpatial=freeze(nextSpatial);
      }
      const spent = {};
      let workerResults=null, workerBatches=0, workersThisTick=0;
      const offloaded=partitioned?.size?new Map():null;
      function* launch(group,snapshot,peekInput,timingFor){
        const jobs=[];
        for(const name of group)if(partitioned.has(name)){
          const timing=timingFor?.(name);
          if(timingFor&&!timing)continue;
          const state=snapshot[name], model=W.simulationAggregate.modelSpec(state,chunks?.managed.get(name)?.models);
          jobs.push({name,state,input:peekInput(name),at,timing,model,profile});
        }
        workerResults=null;
        if(!jobs.length)return;
        const batch=yield jobs;
        workerResults=batch.results;
        workerBatches++;
        workersThisTick=Math.max(workersThisTick,batch.workers);
        for(const {name} of jobs)offloaded.set(name,(offloaded.get(name)??0)+1);
      }
      const prepare=partitioned?.size?launch:undefined;
      const groupsFor=prepare&&(ordered=>partitionGroups(ordered,partitionBarriers));
      let phaseQuery, phaseStart;
      function integrate(name, snapshot, input, timing, target, sources, priorOutputs, stagedStates) {
        if (!phaseQuery || phaseStart !== timing?.start) {
          phaseStart = timing?.start;
          const base = view(nextWorld,snapshot,timing?.signals??lastSignals,tick,receipts,causalState,nextChunkState);
          phaseQuery = Q.create(timing ? {...base,time:(tick+timing.start)*nextWorld.dt} : base,systems,projection);
        }
        const system = systems[name], state = snapshot[name];
        const scope=causal?.scope(name,input,sources,phaseQuery,{substep:timing?.substeps>1?timing.substep:undefined,
          queryTick:tick,queryTime:(tick+(timing?.start??0))*nextWorld.dt});
        if (scope) for (const key of Object.keys(input)) scope.api.input(key);
        const ctx = context(name,nextWorld,snapshot,at,input,systemEmit(name,scope),phaseQuery,spatial(name,true),timing,scope?.api,
          phaseReader(name,snapshot,stagedStates));
        const observed=debug&&{system:name,fraction:timing?.end??1,substep:timing?.substep??1,
          substeps:timing?.substeps??1,dt:ctx.dt,inputs:input};
        const eventStart=debug?events.length:0, writeStart=debug?nextWrites.length:0;
        if(debug)debug.enter(observed);
        const start = profile ? clock() : 0;
        const worker=workerResults?.get(name);
        if(worker?.error)throw Error(worker.error.message,{cause:worker.error});
        const timedInputs=plan.timedSolvers.get(name);
        const split=timedInputs?.some(key=>input[key].length);
        let next=state, calls=1;
        if(worker){
          if(!worker.unchanged)next=rootedState(worker.state);
          for(const [method,args] of worker.effects){
            if(method==='emit')ctx.emit(...args);
            else ctx.spatial[method](...args);
          }
        }else if(system.step) {
          if (split) {
            const end=ctx.time, begin=Math.max(0,end-ctx.dt);
            const groups=W.timedEvents.boundaries(timedInputs,input,begin,end);
            const eventsOff=Object.fromEntries(Object.keys(system.inputs).filter(key=>
              ports.inputs[name+'/'+key].type==='event').map(key=>[key,[]]));
            const splitOff=Object.fromEntries(timedInputs.map(key=>[key,[]]));
            const levels=freeze({...input,...eventsOff});
            let prior=begin, segment=0;
            const segmentContext=(time,dt,values,reaction=false)=>eventContext({...ctx,
              time,dt,input:values,segment,reaction,
              random:randomSource(nextWorld.seed,name,at,{...timing,segment})},time-dt);
            function stepTo(time) {
              if (time<=prior) return;
              const values=segment===0?freeze({...input,...splitOff}):levels;
              const part=segmentContext(time,time-prior,values);
              next=rootedState(system.step(next,part));
              if (observedTiming) observedTiming.push([name,part.dt,prior/nextWorld.dt-at+1,
                time/nextWorld.dt-at+1,timing?.every??1,timing?.substep??1,timing?.substeps??1,null]);
              segment++;
              prior=time;
            }
            for (const group of groups) {
              stepTo(group.time);
              next=rootedState(system.react(next,segmentContext(group.time,0,freeze({...levels,...group.ports}),true)));
            }
            stepTo(end);
            calls=segment;
            if (debug) observed.reactions=groups.map(({time,ports})=>({time,ports}));
          } else next=rootedState(system.step(state,ctx));
        }
        readOutputs(name,next,ctx,target);
        if(debug){
          const outputs=Object.fromEntries(Object.keys(system.outputs??{}).map(key=>[key,target[name+'/'+key]]));
          observedSteps.push({...observed,state:next,outputs,
            ...(eventStart<events.length&&{events:events.slice(eventStart)}),
            ...(writeStart<nextWrites.length&&{invalidations:nextWrites.slice(writeStart)})});
          debug.leave();
        }
        if (causal) {
          for (const key of Object.keys(system.outputs??{})) {
            const port=name+'/'+key;
            causal.output(name,key,target[port],scope,priorOutputs[port]);
          }
          causal.ran(name);
        }
        if (profile) {
          const cost = spent[name] ??= {calls:0,ms:0};
          cost.calls+=calls;
          cost.ms += clock()-start+(worker?.ms??0);
        }
        if(observedTiming&&system.step&&!split)observedTiming.push([name,ctx.dt,timing?.start??0,timing?.end??1,
          timing?.every??1,timing?.substep??1,timing?.substeps??1,timing?.detail?.level??null]);
        return next;
      }

      let nextStates, nextOutputs, publishedSignals, nextSampling, delayedSamples;
      if (rates) {
        const frame = yield* rates.advance(at,nextWorld.dt,committed,outputs,nextManual,delays,lastSignals,sampling,integrate,causal,chunkStep,
          prepare&&{prepare,groupsFor});
        ({states:nextStates,outputs:nextOutputs,signals:publishedSignals,buffers:nextSampling,delayedSamples}=frame);
      } else {
        nextStates = {}; nextOutputs = {};
        const immediate = {}, observed = {};
        const groups=prepare?groupsFor(order):[order];
        for(const group of groups){
          if(prepare)yield* prepare(group,committed,name=>currentValues(name,nextManual,immediate,outputs,delays));
          for (const name of group) {
            const input = currentValues(name,nextManual,immediate,outputs,delays);
            for (const [key,value] of Object.entries(input)) observed[name+'/'+key] = value;
            const sources=causal && Object.fromEntries(Object.keys(input).map(key=>{
              const port=name+'/'+key, edge=incoming.get(port);
              return [key,{parents:causal.held(port,edge,own(immediate,edge?.from)),source:edge?.from,delay:edge?.delay}];
            }));
            nextStates[name] = integrate(name,committed,input,undefined,nextOutputs,sources,outputs,nextStates);
            if (systems[name].combinational) for (const key of Object.keys(systems[name].outputs ?? {}))
              immediate[name+'/'+key] = nextOutputs[name+'/'+key];
          }
        }
        publishedSignals = {...observed,...nextOutputs};
      }
      if(reservations)nextStates=reservations.run(nextStates,{tick:at,emit:makeEmit});
      const nextDelays = Object.fromEntries([...incoming.values()].filter(edge => edge.delay && !edge.crossing).map(edge =>
        [edge.to,[...delays[edge.to].slice(1),delayedSamples?.[edge.to] ?? nextOutputs[edge.from]]]));
      publishedSignals = freeze(publishedSignals);
      let nextStoryTriggers, nextStoryLifecycle, nextStoryFeasibility, nextStoryReferences, storyStarts = [];
      let completed;
      const completedView = () => {
        const frame = view(nextWorld,freeze(nextStates),publishedSignals,at,receipts,causalState,nextChunkState);
        return nextStoryReferences ? {...frame,storyReferences:nextStoryReferences} : frame;
      };
      const completedQuery = () => completed ??= Q.create(
        completedView(),systems,projection);
      function beginStoryTransaction() {
        const notes = [], transfersAtBoundary = [];
        const stage = publish => (kind,detail,parents) => notes.push(()=>publish(kind,detail,parents));
        let trial = {...nextStates};
        const query = () => Q.create({...completedView(),states:visibleStates(trial),
          [W.simulationAggregate.rawStates]:trial},systems,projection);
        const available = name => detailed(name)&&!W.simulationAggregate.isAggregate(trial[name]);
        function action(name,key,args) {
          const ctx = context(name,nextWorld,Object.freeze({...trial}),at,{},stage(systemEmit(name)),query());
          trial[name] = rootedState(systems[name].actions[key](trial[name],args,ctx));
        }
        return { query, available, action,
          allocate(board, isDetailed) {
            trial = reservations.run(trial,{tick:at,emit:name=>stage(makeEmit(name))},isDetailed,board);
          },
          transfer(args) {
            const accounts = [args.from,args.to];
            if (!accounts.every(account=>available(endpoint(account)[0]))) return {blocked:'account-not-detailed'};
            if (receipts.length+transfersAtBoundary.length>=W.transfers.limit) return {blocked:'transfer-budget'};
            const before = causal?.balance&&accounts.map(account=>transfers.inspect(trial,account));
            const receipt = transfers.settle(trial,{...args,mode:'exact'},at,'world',rootedState);
            if (receipt.status!=='full') return {blocked:'transfer-limited',detail:receipt};
            transfersAtBoundary.push(receipt);
            const after = before&&accounts.map(account=>transfers.inspect(trial,account));
            notes.push(()=>{
              const ref = systemEmit('world')('transfer',receipt);
              if (before) balanceChanges(before,after,ref,query);
            });
            return {detail:receipt};
          },
          postJob(board,args) {
            if (!available(board)) return {blocked:'board-not-detailed'};
            const blocked = systems[board].reservationBoard.postingBlocker(trial[board],args,at);
            if (blocked) return {blocked};
            action(board,'post-job',args);
            return {detail:{board,job:query().probe(board+'/jobs',undefined,{job:args.job}).value}};
          },
          social(name,key,args) {
            if (!available(name)) return {blocked:'social-ledger-not-detailed'};
            const provider = systems[name].storySocial;
            const result = provider.apply(trial[name],key,args,at);
            if (result.blocked) return result;
            trial[name] = rootedState(result.state);
            stage(systemEmit(name))(provider.events[key],result.detail);
            return {detail:{ledger:name,...result.detail}};
          },
          commit() {
            nextStates = trial;
            if (transfersAtBoundary.length) receipts = freeze([...receipts,...transfersAtBoundary]);
            completed = undefined;
            for (const publish of notes) publish();
          }
        };
      }
      function settleStory(effects,row,owner) {
        const tx = beginStoryTransaction();
        const report = W.storySettlement.apply(effects,row,owner,at,tx);
        if (report.status==='applied') tx.commit();
        return report;
      }
      function dispatchCommitment(actor,order,from,settleActivation) {
        const {system,agent,generation} = actor, scope = W.storyCommitments;
        const tx = beginStoryTransaction();
        if (!tx.available(system)) return {check:scope.blocked('simulation','defer','actor-not-detailed')};
        const probeTrial = (name,args) => tx.query().probe(name,undefined,args);
        let release;
        if (from) {
          const {system:prior,agent,generation,sequence} = from;
          const book = probeTrial(prior+'/orders',{agent,generation}).value;
          const pending = book&&[book.active,...book.paused,...book.queue].find(row=>row?.sequence===sequence);
          const previous = pending??book?.outcomes.find(row=>row.sequence===sequence);
          const evidence = previous?undefined:[events,lastEvents,history].map(rows=>rows.find(row=>
            row.system===prior&&row.agent===agent&&row.generation===generation&&row.sequence===sequence&&
            Array.isArray(row.results)&&['order-cancelled','order-failed','order-succeeded'].includes(row.kind))).find(Boolean);
          const work = previous?{task:previous.task,phase:previous.phase,nextStep:previous.step,results:previous.results}:
            evidence?{task:evidence.task,phase:evidence.kind.slice(6),nextStep:evidence.results.length,results:evidence.results}:null;
          release = {status:book?'settled':'unavailable',work};
          if (pending) {
            if (!tx.available(prior))
              return {check:scope.blocked('release','defer','outgoing-actor-not-detailed')};
            tx.action(prior,'cancel-order',{agent,generation,order:sequence});
            if (pending.reservation)
              tx.allocate(pending.reservation.board);
            release = {status:'cancelled',work};
          }
        }
        tx.action(system,'issue-order',{agent,generation,order});
        const sequence = probeTrial(system+'/orders',{agent,generation}).value.active.sequence;
        const owner = {...actor,sequence};
        let reservation;
        if (order.reservation) {
          const {board} = order.reservation;
          tx.allocate(board,detailed);
          const sample = probeTrial(board+'/claim',owner), claim = sample.value;
          if (claim?.status!=='held') return {check:scope.blocked('reservation',claim?.status==='failed'?'refuse':'defer',
            claim?.reason??'reservation-unavailable',{board,require:order.reservation.require})};
          reservation = scope.pass('reservation',{board,grants:claim.grants,until:claim.until});
        }
        const settlement = settleActivation?.(tx,owner);
        if (settlement?.status==='blocked') return {settlement,
          check:scope.blocked('settlement','defer',settlement.blocker.reason,settlement.blocker)};
        tx.commit();
        return {order:owner,...(settlement&&{settlement}),...(reservation&&{check:reservation}),...(release&&{release})};
      }
      if (storyReferences) {
        nextStoryReferences = storyReferences.advance(storyReferenceState,at,completedQuery(),events,storyLifecycleState,makeEmit('world'));
        completed = undefined;
      }
      if (storyTriggers) {
        const activated = storyTriggers.advance(storyTriggerState, events, at, completedQuery);
        nextStoryTriggers = activated.state;
        storyStarts = activated.starts;
      }
      const queueUpdate = incidentCandidates?.advance(incidentCandidateState,storyStarts,candidateCommands,at,completedQuery,cleanedStories,makeEmit('world'));
      if (queueUpdate) storyStarts = queueUpdate.starts;
      if (storyLifecycle) {
        ({state:nextStoryLifecycle,gates:nextStoryFeasibility} =
          storyLifecycle.advance(cleanedStories,storyStarts,storyCommands,at,makeEmit('world'),events,completedQuery,storyFeasibilityState,nextStoryReferences,dispatchCommitment,settleStory,queueUpdate?.released));
      } else if (storyStarts.length) {
        const emit = makeEmit('world');
        for (const row of storyStarts) emit('story-started',row);
      }
      if (incidentCooldowns) W.incidentCooldowns.publish(incidentCooldowns,nextStoryLifecycle,at,makeEmit('world'));
      const routed = eventActions?.route(eventActionCounts, events, at);
      if (routed?.commands.length) {
        check(routed.commands.length + packCommands().length - commands.length <= maxPendingCommands, 'Pending command budget exceeded');
        const emit = makeEmit('world');
        for (const row of routed.scheduled) emit('event-action-scheduled', row);
      }
      const submitted=playback?.has(at)?parseCommands(playback.get(at),true,at+1):null;
      if(submitted)check(submitted.length+(routed?.commands.length??0)+packCommands().length-commands.length<=maxPendingCommands,
        'Pending command budget exceeded');
      if(observers.length){
        freeze(events);
        const snapshot=freeze(nextStates), completed=Q.create(completedView(),systems,projection);
        nextStates={...snapshot};
        for(const name of observers){
          const managed=chunks?.managed.has(name);
          const sample=managed?chunkStep.due.has(name):at%(nextWorld.systems[name].schedule?.every??1)===0;
          const start=profile?clock():0;
          nextStates[name]=rootedState(systems[name].afterStep(snapshot[name],{
            id:name,tick:at,time:at*nextWorld.dt,dt:nextWorld.dt,query:completed,events,sample
          }));
          if(profile){
            const elapsed=clock()-start, cost=metrics.get(name)??{calls:0,ms:0,maxMs:0};
            cost.ms+=elapsed;
            cost.maxMs=Math.max(cost.maxMs,elapsed);
            metrics.set(name,cost);
          }
        }
      }
      const memory = historyWith(events,nextWorld.history);
      const dependencyReport = trace && trace.report();
      const nextCausal = causal?.finish();
      const nextView = {...view(nextWorld,freeze(nextStates),publishedSignals,at,receipts,nextCausal,nextChunkState),...memory,
        ...(storyTriggers && {storyTriggers:nextStoryTriggers}),...(storyLifecycle && {storyLifecycle:nextStoryLifecycle}),
        ...(nextStoryFeasibility && {storyFeasibility:nextStoryFeasibility}),
        ...(nextStoryReferences && {storyReferences:nextStoryReferences}),
        ...(queueUpdate && {incidentCandidates:queueUpdate.state})};
      if (navigationBefore) for (const notice of navigationChanges(navigationBefore,Q.create(nextView,systems,projection))) {
        check(nextWrites.length<P.spatialDependencies.limit,'Spatial write budget exceeded');
        nextWrites.push(dependencies.write(notice.writer,notice.field,notice.bounds,notice.reason));
      }
      const nextScenario = evaluateScenario(nextView,events);
      const nextWeather = weather?.step(weatherTrackState,{time:nextView.time,view:nextView,events,
        query:Q.create(nextView,systems,projection)});
      const recordView=evidence&&weather?{...nextView,weatherTrackState:nextWeather}:nextView;
      const retained=evidence?.prepare(recordView,()=>Q.create(recordView,systems,projection),commands,observedTiming);
      tick = at;
      world = nextWorld;
      states = nextStates;
      outputs = freeze(nextOutputs);
      lastSignals = publishedSignals;
      manual = freeze(Object.fromEntries(Object.entries(nextManual).map(([name,value]) => [name,ports.inputs[name].type==='event'?[]:value])));
      delays = freeze(nextDelays);
      history = memory.history;
      dropped = memory.dropped;
      lastEvents = freeze(events);
      lastTransfers = receipts;
      causalState = nextCausal;
      chunkState = nextChunkState;
      storyTriggerState = nextStoryTriggers;
      storyLifecycleState = nextStoryLifecycle;
      storyFeasibilityState = nextStoryFeasibility;
      storyReferenceState = nextStoryReferences;
      if (queueUpdate) incidentCandidateState = queueUpdate.state;
      sampling = nextSampling;
      spatialSampling = nextSpatial;
      pendingWrites = freeze(nextWrites);
      lastDependencies = dependencyReport;
      scenario = nextScenario;
      weatherTrackState = nextWeather;
      scheduled.delete(at);
      if (routed) {
        eventActionCounts = routed.counts;
        queue(routed.commands, false);
      }
      if(submitted){
        queue(submitted,true);
        evidence?.submit(tick,submitted.length);
      }
      if(retained)evidence.publish(retained);
      currentQuery = undefined;
      lastCheckpoint=undefined;
      for (const [name,{calls,ms}] of Object.entries(spent)) {
        const value = metrics.get(name) ?? {calls:0,ms:0,maxMs:0};
        metrics.set(name,{...value,calls:value.calls+calls,ms:value.ms+ms,maxMs:Math.max(value.maxMs,ms),
          maxCallsPerTick:Math.max(value.maxCallsPerTick??0,calls)});
      }
      if(workerBatches){
        partitionBatches+=workerBatches;
        peakWorkers=Math.max(peakWorkers,workersThisTick);
        for(const [name,count] of offloaded)jobsBySystem.set(name,(jobsBySystem.get(name)??0)+count);
      }
      const committedView=view();
      regions?.publish(committedView,commands);
      if(debug)debug.publish(save(),commands,observedSteps);
      return committedView;
    }
    function step() {
      check(!asyncActive,'A simulation advance is already in progress');
      check(!workerPool?.async||!partitioned?.size,'Use stepAsync or advanceAsync with asynchronous simulation workers');
      const work=tickWork();
      let result=work.next();
      while(!result.done)result=work.next(workerPool.solve(plan.world,result.value));
      return result.value;
    }
    async function stepInBackground(){
      inFlightTick=tick+1;
      try{
        const work=tickWork();
        let result=work.next();
        while(!result.done)result=work.next(await workerPool.solve(plan.world,result.value));
        return result.value;
      }finally{
        inFlightTick=0;
      }
    }
    async function stepAsync(){
      check(!asyncActive,'A simulation advance is already in progress');
      asyncActive=true;
      try{return await stepInBackground();}
      finally{asyncActive=false;}
    }
    function runBlock(end, held, eventValues) {
      const first = tick+1, commands = scheduled.get(first) ?? [];
      if (commands.some(row => row.action !== 'world/input')) return false;
      const nextManual = {...manual};
      for (const {args:{port,value}} of commands) nextManual[port] = portValue(ports.inputs[port],value,port);
      Object.assign(nextManual,held);
      const input = currentValues(blockSystem,nextManual,{},outputs,delays);
      const start = profile ? clock() : 0, samples = end-tick;
      const {state,events:emitted} = systems[blockSystem].stepBlock(states[blockSystem],{start:tick,end,input});
      if (eventValues) for (const [port,rows] of Object.entries(emitted))
        eventValues[port] = W.rates.add(eventValues[port]??[],rows,'event');
      const nextOutputs = {};
      readOutputs(blockSystem,state,undefined,nextOutputs);

      states = freeze({[blockSystem]:state});
      outputs = freeze(nextOutputs);
      manual = freeze(nextManual);
      lastSignals = freeze({...manual,...outputs});
      lastEvents = freeze([]);
      currentQuery = undefined;
      lastCheckpoint = undefined;
      lastDependencies = null;
      scheduled.delete(first);
      tick = end;
      if (profile) {
        const prior = metrics.get(blockSystem) ?? {calls:0,ms:0,maxMs:0};
        const ms = clock()-start;
        metrics.set(blockSystem,{calls:prior.calls+samples,ms:prior.ms+ms,maxMs:Math.max(prior.maxMs,ms),
          blockCalls:(prior.blockCalls??0)+1,blockSamples:(prior.blockSamples??0)+samples});
      }
      return true;
    }
    function blockEnd(to) {
      commandTicks ??= [...scheduled.keys()].sort((a,b) => a-b);
      let low = 0, high = commandTicks.length;
      while (low < high) {
        const mid = Math.floor((low+high)/2);
        if (commandTicks[mid] <= tick+1) low = mid+1;
        else high = mid;
      }
      return Math.min(to,tick+blockSize,(commandTicks[low] ?? Infinity)-1);
    }
    function advanceBlocks(to, held, eventValues) {
      while (tick < to) {
        if (runBlock(blockEnd(to),held,eventValues)) continue;
        check(held === undefined,'Held model inputs need a level-only sample block');
        step();
      }
      return view();
    }
    function advanceHeld(to, held) {
      check(!asyncActive && tickOK(to) && to >= tick, 'Invalid held block target');
      const values = Object.fromEntries(Object.entries(held).map(([port,value]) =>
        [port,portValue(ports.inputs[port],value,port)]));
      const eventValues = {};
      advanceBlocks(to,values,eventValues);
      return eventValues;
    }
    function advance(to, {onTick,stopOnOutcome = false} = {}) {
      check(!asyncActive,'A simulation advance is already in progress');
      check(tickOK(to) && to >= tick, 'Target tick precedes current state or exceeds the run budget');
      if (blockSystem && onTick === undefined) return advanceBlocks(to);
      while (tick < to && (!stopOnOutcome || scenario.status === 'running')) {
        step();
        onTick?.(view(),query());
      }
      return view();
    }
    async function advanceAsync(to,{onTick,stopOnOutcome=false}={}){
      check(!asyncActive,'A simulation advance is already in progress');
      check(tickOK(to)&&to>=tick,'Target tick precedes current state or exceeds the run budget');
      asyncActive=true;
      try{
        while(tick<to&&(!stopOnOutcome||scenario.status==='running')){
          if (blockSystem && onTick === undefined && runBlock(blockEnd(to))) {
            await Promise.resolve();
            continue;
          }
          const completed=await stepInBackground();
          if(onTick)await onTick(completed,query());
        }
        return view();
      }finally{asyncActive=false;}
    }
    function recording() {
      const trace=debug?.recording(),end=save();
      return freeze({format:runFormat,version:1,origin,commands:added.slice(),end,...(trace&&{trace}),
        ...(evidence&&{evidence:evidence.document(end)})});
    }
    function queues(){
      let pending=0;
      for(const entries of scheduled.values())pending+=entries.length;
      const rows={commands:{pending,capacity:maxPendingCommands,unit:'commands'}};
      const capacity=W.rates.maxEvents;
      eventInputs??=Object.keys(ports.inputs).filter(port=>ports.inputs[port].type==='event');
      for(const port of eventInputs){
        if(Array.isArray(sampling?.[port]))rows['events/'+port]={pending:sampling[port].length,capacity,unit:'events'};
        const slots=delays[port];
        if(slots)rows['delay/'+port]={pending:slots.reduce((sum,slot)=>sum+slot.length,0),
          capacity:capacity*slots.length,unit:'events'};
      }
      for(const name of names)for(const [port,count] of Object.entries(systems[name].childQueueDepths?.(states[name])??{}))
        rows['bridge/'+name+'/'+port]={pending:count,capacity,unit:'events'};
      return rows;
    }
    return Object.freeze({view,query,projectEntities,step,advance,stepAsync,advanceAsync,...(blockSystem&&{[W.models.heldAdvance]:advanceHeld}),...(timeline&&{timeline}),...(regions&&{regions:regions.api}),
      ...(debug&&{stepFrame:debug.latest,stepAttempt:debug.attempt}),
      get scenario(){return scenario;}, get history(){return history;}, get events(){return lastEvents;},
      schedule:commands => enqueue(commands,true),checkpoint:save,recording,queues,
      storyDiagnostics:() => plan.storyDiagnostics ?? [],
      commandCounts:() => {
        const all=[...origin.pending,...added];
        return {scheduled:all.length,applied:all.filter(command=>command.tick<=tick).length,pending:packCommands().length};
      },
      processing:() => Object.fromEntries(names.flatMap(name=>{
        const report=systems[name].processingReport?.()??systems[name].childProcessing?.(states[name]);
        return report && Object.keys(report).length ? [[name,report]] : [];
      })),
      profile:() => rates && profile ? Object.fromEntries(names.map(name=>[name,
        metrics.get(name)??{calls:0,ms:0,maxMs:0}])) : Object.fromEntries(metrics),
      rates:() => rates ? {subdivision:rates.subdivision,systems:rates.rates} : null,
      composition() {
        composition ??= W.systemComposition.describe(plan);
        if (inspection?.execution.tick !== tick) {
          const execution = W.executionPlan.describe(plan,{
            tick,world,states,delays,sampling,chunkState,partitioned,observers
          });
          inspection = Object.freeze({...composition,execution});
        }
        return inspection;
      },
      partitions:()=>({workers:workerPool?.size??0,peakWorkers,batches:partitionBatches,
        systems:Object.fromEntries(names.filter(name=>jobsBySystem.has(name)).map(name=>[name,jobsBySystem.get(name)]))}),
      dependencies:() => ({declarations:dependencies.describe,
        ...(lastDependencies ?? {changes:[],affected:[],work:[]}),pending:pendingWrites}),
      fork:() => branch(save(),playback),
      reset:() => branch(origin)});
    function branch(checkpoint,remaining){
      return create(checkpoint.world,{checkpoint,implementations,profile,validated:true,workerPool,traceSteps,
        recordRun:evidence?.plan,playback:remaining,skipInitialSubmission:true,validateEntities},
        checkpoint.world===plan.world?branchToken:undefined);
    }
  }
  function openRecording(log,{checkpoint, ...options}={}){
    const playback=W.runRecords.playback(log), start=checkpoint??log.origin;
    check(tickOK(start.tick)&&start.tick>=log.origin.tick&&start.tick<=log.end.tick&&
      ['id','seed','dt'].every(key=>start.world?.[key]===log.origin.world[key]),'Checkpoint lies outside the recording');
    return create(start.world,{...options,checkpoint:start,playback,skipInitialSubmission:checkpoint!==undefined});
  }
  function prepareReplay(log,options){
    return openRecording(log,{...options,checkpoint:undefined,recordRun:log?.evidence?.plan??options?.recordRun});
  }
  function assertReplay(run,log,options){
    if(log.evidence){
      const mismatch=W.runRecords.difference(log.evidence,run.recording().evidence);
      if(mismatch)W.runRecords.mismatch(mismatch);
    }
    if(!checkpointsEqual(run.checkpoint(),log.end,options))
      W.runRecords.mismatch({kind:'checkpoint',tick:log.end.tick});
    return run;
  }
  function replay(log, options) {
    const run=prepareReplay(log,options);
    run.advance(log.end.tick);
    return assertReplay(run,log,options);
  }
  async function replayAsync(log,options){
    const run=prepareReplay(log,options);
    await run.advanceAsync(log.end.tick);
    return assertReplay(run,log,options);
  }
  function verification(log,mismatch){
    const {origin,end,evidence}=log;
    return freeze({status:mismatch?'diverged':'verified',scene:origin.world.id,seed:origin.world.seed,
      fromTick:origin.tick,toTick:end.tick,observations:evidence?.observations.length??0,
      revisions:evidence?.scene.revisions.length??0,actions:evidence?.actions.reduce((sum,row)=>sum+row.commands.length,0)??0,
      ...(mismatch&&{mismatch})});
  }
  function verify(log,options){
    try{replay(log,options);}
    catch(error){if(!error.runMismatch)throw error;return verification(log,error.runMismatch);}
    return verification(log);
  }
  async function verifyAsync(log,options){
    try{await replayAsync(log,options);}
    catch(error){if(!error.runMismatch)throw error;return verification(log,error.runMismatch);}
    return verification(log);
  }
  function checkpointsEqual(actual,expected,{implementations,workerPool}={}){
    if(equal(actual,expected))return true;
    if(!record(expected?.states)||!equal(actual.world,expected.world))return false;
    const {systems}=compile(actual.world,implementationsFor(implementations,workerPool),true);
    const states={...actual.states};
    for(const [name,system] of Object.entries(systems))
      if(system.legacyCheckpoint)states[name]=system.legacyCheckpoint(states[name],expected.states[name]);
    return equal({...actual,states},expected);
  }
  function diff(a,b) {
    check(a?.format === checkpointFormat && b?.format === checkpointFormat && a.tick === b.tick,
      'Simulation diff needs two checkpoints at the same tick');
    return {tick:a.tick,time:{before:a.tick*a.world.dt,after:b.tick*b.world.dt},edits:Q.keyedChanges(a,b)};
  }
  W.runtime = Object.freeze({register,validate,storyPreflight,create,openRecording,replay,replayAsync,verify,verifyAsync,diff,firstDivergence:W.stepDebug.firstDivergence,
    checkpointFormat,runFormat,maxTick,partitionKernel,checkpointsEqual,modelInterface,
    prefabInterfaces:(world,{implementations}={})=>compile(world,implementations,true)});
})(KIT);
