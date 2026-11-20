/* A fixed-tick simulation host with registered systems and portable run state. */
(function (K) {
  const W = K.world, P = K.procedural, Q = W.query, freeze = P.data.freeze;
  const {check,record,id,vector,own,copy,equal,endpoint,portOf} = W.data;
  const factories = new Map();
  const bundledPartitions = new Set();
  const clock = () => typeof performance === 'undefined' ? Date.now() : performance.now();
  const maxTick = 10000000;
  const tickOK = value => Number.isSafeInteger(value) && value >= 0 && value <= maxTick;
  const ordered = value => Object.keys(value).sort();
  const worldActions = ['input','patch','event','transfer'];
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
    const randomTick=timing?.substeps>1?at+'.'+timing.substep:at;
    return key=>P.data.hash(name+'/'+randomTick+'/'+String(key),seed)/4294967296;
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
        const factory=own(implementations,spec.kind)?implementations[spec.kind]:factories.get(spec.kind);
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
      const ctx=Object.freeze(Object.defineProperties({id:name,...stepTiming(world,at,freeze(timing)),input:freeze(input),query,
        emit:note('emit'),...(spatial&&{spatial}),random:randomSource(world.seed,name,at,timing)},restricted));
      const start=profile?clock():0, saved=freeze(state);
      const next=adapter?W.simulationAggregate.advance(adapter,saved,ctx):provider.step(saved,ctx);
      return { ...(next===saved?{unchanged:true}:{state:next}),effects,ms:profile?clock()-start:0 };
    };
  }

  function register(kind, factory, { worker = false } = {}) {
    check(id(kind) && typeof factory === 'function' && !factories.has(kind), 'Invalid or duplicate system kind ' + kind);
    factories.set(kind,factory);
    if(worker)bundledPartitions.add(kind);
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
    return freeze(copy(value));
  }
  function compile(world, implementations = {}, interfacesOnly = false) {
    const systems = {};
    const catalog = W.materials.catalog(world);
    const ports = {inputs:{},outputs:{}};
    for (const name of ordered(world.systems)) {
      const spec = world.systems[name], factory = own(implementations,spec.kind) ? implementations[spec.kind] : factories.get(spec.kind);
      check(name !== 'world' && id(spec.kind) && typeof factory === 'function', 'Unknown or reserved system ' + name + ' (' + spec.kind + ')');
      check(record(spec.config??{}),'Invalid config for '+name);
      const system = factory(spec.config ?? {},{world,id:name,catalog});
      check(record(system) && typeof system.initial === 'function', 'System needs an initial state: ' + name);
      for (const direction of ['inputs','outputs']) {
        for (const [key,raw] of Object.entries(system[direction] ?? {})) {
          const path = name + '/' + key;
          const descriptor = typeof raw === 'string' ? {type:raw} : raw;
          check(id(key) && record(descriptor) && own(types,descriptor.type), 'Invalid port ' + path);
          const value = portValue(descriptor,descriptor.default ?? defaults[descriptor.type],path);
          ports[direction][path] = freeze({...descriptor,default:value});
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
    const systemDependencies = Object.entries(systems).filter(([,system])=>system.dependencies !== undefined);
    let fieldQuery;
    function canonical(entry,writer) {
      const name = typeof entry === 'string' ? entry : entry?.field;
      const field = typeof name === 'string' && !name.includes('/') ? (writer ? writer+'/'+name : (fieldQuery ??= Q.create({world},systems)).field(name)?.name ?? name) : name;
      return typeof entry === 'string' ? field : {...entry,field};
    }
    const dependencies = P.spatialDependencies.create(Object.fromEntries(systemDependencies.map(([name,system])=>{
      const spec = system.dependencies;
      check(record(spec) && Array.isArray(spec.reads ?? []) && Array.isArray(spec.writes ?? []),
        'Invalid spatial dependencies for '+name);
      return [name,{reads:(spec.reads ?? []).map(entry=>canonical(entry)),writes:(spec.writes ?? []).map(entry=>canonical(entry,name))}];
    })));
    const transfers = W.transfers.bind(systems);
    for (const name of transfers.producers) systems[name].checkTransfers?.(transfers.validate);
    const schedule = W.rates.schedules(world,systems,chunks);
    const incoming = new Map(), edges = new Map(), indegree = new Map();
    for (const name of ordered(systems)) {
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
      check(Number.isSafeInteger(delay) && delay >= 0 && delay <= 3600, 'Invalid connection delay');
      check(!incoming.has(edge.to), 'More than one connection feeds ' + edge.to);
      const sample = W.rates.policy(edge,source.type,schedule.active);
      incoming.set(edge.to,{from:edge.from,to:edge.to,delay,sample});
      if (delay === 0 && sample !== 'average' && systems[from].combinational) {
        indegree.set(to,indegree.get(to)+1);
        edges.get(from).push(to);
      }
    }
    const names = ordered(systems), ready = names.filter(name => indegree.get(name) === 0), order = [];
    for (let i=0;i<ready.length;i++) {
      const name = ready[i];
      order.push(name);
      for (const other of edges.get(name)) {
        const degree = indegree.get(other)-1;
        indegree.set(other,degree);
        if (!degree) ready.push(other);
      }
    }
    check(order.length === names.length, 'Instantaneous signal cycle; use a delay or a stateful system');
    const causePolicy = W.causality.policy(world.causality);
    const rates = schedule.active ? W.rates.bind(schedule,systems,ports,incoming,order) : null;
    return {world,systems,ports,incoming,order,names,transfers,dependencies,rates,chunks,aggregates,reservations,causePolicy};
  }
  function actionCheck(raw, plan, min = 1) {
    check(record(raw) && tickOK(raw.tick) && raw.tick >= min && record(raw.args ?? {}) &&
      (raw.id === undefined || id(raw.id)), 'Invalid scheduled command or command tick');
    const [system,key] = endpoint(raw.action);
    let args = raw.args ?? {};
    if (system === 'world') {
      check(worldActions.includes(key)||plan.chunks?.actions.includes(key), 'Unknown world action ' + key);
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
      else check(id(args.kind), 'An event needs a kind');
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
      check(system === 'world' ? worldActions.includes(action)||plan.chunks?.actions.includes(action) : own(plan.systems[system]?.actions,action),
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
    return (timeline?.events ?? []).map(({ id, time, kind, detail, path }) => {
      const floor = Math.floor(time / world.dt);
      const tick = Math.max(1, floor + Number(time > floor * world.dt));
      return { tick, action: 'world/event', args: { ...detail, kind, timeline: { id, path, time } } };
    });
  }
  function prepare(source,{implementations} = {}) {
    const world = W.manifest(source), plan = compile(world,implementations);
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
  const validate=(source,options)=>prepare(source,options).world;
  function create(source, {checkpoint,implementations,profile = false,validated = false,workerPool,regionRevisions,traceSteps} = {}, token) {
    check(workerPool===undefined||typeof workerPool?.solve==='function','Invalid simulation worker pool');
    const modules=workerPool?.implementations;
    const installed=modules?{...modules,...implementations}:implementations;
    let result=validated?{world:source,plan:compile(source,installed)}:prepare(source,{implementations:installed});
    let {world}=result;
    if (!checkpoint && world.scenario?.start?.length) {
      const edited = W.apply(world,world.scenario.start).world;
      result=prepare(edited,{implementations:installed});
      world=result.world;
    }
    const {plan, weather = weatherProgram(world), timeline = W.sceneTimeline(world)}=result;
    const {systems,ports,incoming,order,names,transfers,dependencies,rates,chunks,aggregates,reservations,causePolicy} = plan;
    const regions=regionRevisions===undefined?null:W.regionRevisions.capture(world,regionRevisions,systems);
    const debug=traceSteps===undefined?null:W.stepDebug.capture(traceSteps);
    const partitioned=workerPool&&new Set(names.filter(name=>{
      const {kind}=world.systems[name];
      return systems[name].partitionStep===true&&(own(installed,kind)?
        own(modules,kind)&&installed[kind]===modules[kind]:bundledPartitions.has(kind));
    }));
    const partitionBarriers=workerPool&&new Set();
    if(partitioned?.size)for(const {from,to,delay,sample} of incoming.values()){
      const source=endpoint(from)[0];
      if(!delay&&sample!=='average'&&systems[source].combinational&&partitioned.has(endpoint(to)[0]))
        partitionBarriers.add(source);
    }
    const jobsBySystem=new Map();
    let partitionBatches=0, peakWorkers=0;
    const projection = Q.projection(systems);
    const slowReaders = new Map(rates ? dependencies.describe.filter(({id,reads})=>reads.length&&
      (rates.rates[id].every>1||chunks?.managed.get(id)?.schedules))
      .map(({id})=>[id,rates.rates[id].every]) : []);
    const rootInputs = Object.fromEntries(Object.entries(ports.inputs).map(([name,port]) => [name,port.default]));
    const rootOutputs = Object.fromEntries(Object.entries(ports.outputs).map(([name,port]) => [name,port.default]));
    const rootDelays = Object.fromEntries([...incoming.values()].filter(edge => edge.delay).map(edge =>
      [edge.to,Array(edge.delay).fill(W.rates.buffered(edge)?W.rates.zero(ports.outputs[edge.from].type):rootOutputs[edge.from])]));
    const metrics = new Map();
    const scheduled = new Map();
    const added = [];
    const historyLimit = world.history?.limit ?? 10000;
    let tick = 0, states = {}, outputs = rootOutputs, manual = rootInputs, delays = rootDelays,
      history = [], dropped = 0, lastEvents = [], scenario = {status:'running',score:0,matched:{},metrics:{}};
    let pendingWrites = [], lastDependencies = null, sampling = rates?.initial, spatialSampling = {};
    let causalState, weatherTrackState, chunkState;
    let currentQuery, lastTransfers = [], lastSignals = {...rootInputs,...rootOutputs};
    let lastCheckpoint;

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
        ...(weatherTrackState && {weatherTrackState})});
    }
    function context(name, worldValue, statesValue, at, input, emit, query, spatial, timing, causal) {
      return Object.freeze({world:worldValue,query,id:name,states:visibleStates(statesValue),
        ...stepTiming(worldValue,at,timing),input,emit,
        ...(spatial && {spatial}),...(causal && {causal}),
        random:randomSource(worldValue.seed,name,at,timing)});
    }
    function rootedState(value) {
      return P.data.isImmutable(value) ? value : freeze(copy(value));
    }
    function packCommands() {
      return [...scheduled.keys()].sort((a,b) => a-b).flatMap(key => scheduled.get(key));
    }
    function queue(entries,log) {
      if(entries.length)lastCheckpoint=undefined;
      for (const item of entries) {
        let items = scheduled.get(item.tick);
        if (!items) scheduled.set(item.tick,items = []);
        items.push(item);
      }
      if (log) added.push(...entries);
    }
    function enqueue(commands, log) {
      check(Array.isArray(commands) && commands.length <= 100000, 'Expected a bounded command list');
      const entries = commands.map(raw => {
        const command = actionCheck(raw,plan,tick+1);
        if (log && world.scenario?.allow) check(world.scenario.allow.includes(command.action), 'Action is disabled in this scenario: ' + command.action);
        return command;
      });
      check(entries.length + packCommands().length <= 100000, 'Pending command budget exceeded');
      queue(entries,log);
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
            dependencies.begin(notices).affected(name).length===notices.length,'Invalid saved spatial notices for '+name);
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
      for (const name of names) readOutputs(name,states[name],context(name,world,states,0,{},() => {},startQuery),initialOutputs);
      outputs = freeze(initialOutputs);
      if (causePolicy) causalState = W.causality.initial(ports,incoming,outputs,causePolicy);
      lastSignals = freeze({...manual,...outputs});
      const past=world.history?.enabled===false?[]:(world.history?.past??[]).filter(event=>Q.condition(world.history?.where,event));
      history=freeze(copy(past.slice(-historyLimit)));
      dropped=Math.max(0,past.length-historyLimit);
      if (weather) {
        const initialView = view();
        weatherTrackState = weather.step(undefined,{time:0,view:initialView,query:Q.create(initialView,systems,projection)});
      }
      enqueue([...world.commands,...(world.scenario?.commands ?? []),...timelineCommands(world,timeline)],false);
    }
    const origin = save();
    regions?.publish(view());
    debug?.publish(origin);
    function query() {
      return currentQuery ?? (currentQuery = Q.create(view(),systems,projection));
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
    function step() {
      const at = tick+1, commands = scheduled.get(at) ?? [], events = [];
      check(tickOK(at),'Tick budget exceeded');
      debug?.start();
      const observedSteps=debug?[]:null;
      let nextWorld = world, changedEntities = new Set();
      const drafts = {...states}, nextManual = {...manual}, requests = [];
      let nextChunkState=chunkState;
      const commanded=chunks&&new Set();
      let trace = pendingWrites.length ? dependencies.begin(pendingWrites) : null;
      const nextWrites = [], activeTrace = () => trace ??= dependencies.begin();
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
        const row=freeze({...copy(detail),kind,system,tick:at,id:at+'.'+events.length});
        events.push(row);
        if (causal) causal.event(row,parents??scope?.emitParents()??(root?[root]:[]),scope?.location,
          parents?'declared':root?'command':'observed-inputs');
      };
      for (const item of commands) {
        const [name,key] = endpoint(item.action);
        if(debug)debug.enter({system:W.stepDebug.actionSystem(item),inputs:item.args});
        const root = causal?.command(name,item), emit = makeEmit(name,undefined,root);
        if (name === 'world') {
          if (key === 'input') {
            const {port,value} = item.args, descriptor = ports.inputs[port];
            if(commanded)commanded.add(endpoint(port)[0]);
            const next = portValue(descriptor,value,port);
            if (causal && (!rates || descriptor.type!=='event' || next.length))
              causal.manual(port,root,rates && descriptor.type==='event' && nextManual[port].length>0);
            nextManual[port] = rates && descriptor.type==='event' ?
              W.rates.add(nextManual[port],next,'event') : next;
          }
          if (key === 'patch') {
            const result = W.apply(nextWorld,item.args.edits);
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
          if(chunks?.actions.includes(key))nextChunkState=chunks.action(nextChunkState,key,item.args,at);
        } else {
          commanded?.add(name);
          const actionQuery = Q.create(view(nextWorld,{...drafts}),systems,projection);
          const scope=causal?.scope(name,{}, {},actionQuery,{root,queryTick:tick,queryTime:tick*nextWorld.dt});
          causal?.action(name,root);
          const ctx = context(name,nextWorld,Object.freeze({...drafts}),at,{},makeEmit(name,scope,root),actionQuery,
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
      if(reservations)Object.assign(drafts,reservations.run(drafts,{tick:at,emit:makeEmit},name=>{
        const managed=chunks?.managed.get(name), entry=managed&&nextChunkState.entries[managed.chunk];
        return !entry||!entry.sleeping&&!managed.models.has(entry.level);
      }));
      if (transfers.producers.length) {
        const before = Object.freeze({...drafts});
        const requestQuery = Q.create(view(nextWorld,before,lastSignals,at,[],causalState,nextChunkState),systems,projection);
        for (const name of transfers.producers) {
          const managed=chunks?.managed.has(name), detail=managed&&chunkStep.due.get(name);
          if(managed&&!detail)continue;
          const input = currentValues(name,nextManual,{},outputs,delays);
          const timing=detail&&{start:0,end:1,every:detail.every,substeps:1,substep:1,detail};
          const ctx = context(name,nextWorld,before,at,input,makeEmit(name),requestQuery,undefined,timing||undefined);
          const planned = systems[name].requestTransfers(before[name],ctx,Math.max(0,W.transfers.limit-requests.length));
          check(Array.isArray(planned) && planned.length + requests.length <= W.transfers.limit,
            'Expected a bounded transfer request list from '+name);
          for (const request of planned) requests.push({name,request});
        }
      }
      check(requests.length <= W.transfers.limit,'Transfer request budget exceeded');
      let confirmations;
      const receipts = requests.length ? rootedState(requests.map(({name,request,root})=>{
        const receipt = transfers.settle(drafts,request,at,name,rootedState);
        makeEmit(name,undefined,root)('transfer',receipt);
        if(systems[name]?.receiveTransfers){
          confirmations??=new Map();
          if(!confirmations.has(name))confirmations.set(name,[]);
          confirmations.get(name).push(receipt);
        }
        return receipt;
      })) : [];
      for(const [name,confirmed] of confirmations??[])
        drafts[name]=rootedState(systems[name].receiveTransfers(drafts[name],confirmed,{tick:at,emit:makeEmit(name)}));
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
                check(waiting.length+current.length<=P.spatialDependencies.limit,'Spatial sampling buffer exceeds its budget');
                nextSpatial[name]=waiting.concat(current.map(({writer,field,bounds,reason})=>({writer,field,bounds,reason})));
              }
            }
          }
        }
        nextSpatial=freeze(nextSpatial);
      }
      aggregates?.transition(drafts,nextChunkState,makeEmit('world'));
      const committed = freeze(drafts);
      const spent = {};
      let workerResults=null, workerBatches=0, workersThisTick=0;
      const offloaded=partitioned?.size?new Map():null;
      function launch(group,snapshot,peekInput,timingFor){
        const jobs=[];
        for(const name of group)if(partitioned.has(name)){
          const timing=timingFor?.(name);
          if(timingFor&&!timing)continue;
          const state=snapshot[name], model=W.simulationAggregate.modelSpec(state,chunks?.managed.get(name)?.models);
          jobs.push({name,state,input:peekInput(name),at,timing,model,profile});
        }
        workerResults=null;
        if(!jobs.length)return;
        const batch=workerPool.solve(plan.world,jobs);
        workerResults=batch.results;
        workerBatches++;
        workersThisTick=Math.max(workersThisTick,batch.workers);
        for(const {name} of jobs)offloaded.set(name,(offloaded.get(name)??0)+1);
      }
      const prepare=partitioned?.size?launch:undefined;
      const groupsFor=prepare&&(ordered=>partitionGroups(ordered,partitionBarriers));
      let phaseQuery, phaseStart;
      function integrate(name, snapshot, input, timing, target, sources, priorOutputs) {
        if (!phaseQuery || phaseStart !== timing?.start) {
          phaseStart = timing?.start;
          const base = view(nextWorld,snapshot,timing?.signals??lastSignals,tick,receipts,causalState,nextChunkState);
          phaseQuery = Q.create(timing ? {...base,time:(tick+timing.start)*nextWorld.dt} : base,systems,projection);
        }
        const system = systems[name], state = snapshot[name];
        const scope=causal?.scope(name,input,sources,phaseQuery,{substep:timing?.substeps>1?timing.substep:undefined,
          queryTick:tick,queryTime:(tick+(timing?.start??0))*nextWorld.dt});
        if (scope) for (const key of Object.keys(input)) scope.api.input(key);
        const ctx = context(name,nextWorld,snapshot,at,input,makeEmit(name,scope),phaseQuery,spatial(name,true),timing,scope?.api);
        const observed=debug&&{system:name,fraction:timing?.end??1,substep:timing?.substep??1,
          substeps:timing?.substeps??1,dt:ctx.dt,inputs:input};
        const eventStart=debug?events.length:0, writeStart=debug?nextWrites.length:0;
        if(debug)debug.enter(observed);
        const start = profile ? clock() : 0;
        const worker=workerResults?.get(name);
        if(worker?.error)throw Error(worker.error.message,{cause:worker.error});
        let next=state;
        if(worker){
          if(!worker.unchanged)next=rootedState(worker.state);
          for(const [method,args] of worker.effects){
            if(method==='emit')ctx.emit(...args);
            else ctx.spatial[method](...args);
          }
        }else if(system.step)next=rootedState(system.step(state,ctx));
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
          cost.calls++;
          cost.ms += clock()-start+(worker?.ms??0);
        }
        return next;
      }

      let nextStates, nextOutputs, publishedSignals, nextSampling, delayedSamples;
      if (rates) {
        const frame = rates.advance(at,committed,outputs,nextManual,delays,lastSignals,sampling,integrate,causal,chunkStep,
          prepare&&{prepare,groupsFor});
        ({states:nextStates,outputs:nextOutputs,signals:publishedSignals,buffers:nextSampling,delayedSamples}=frame);
      } else {
        nextStates = {}; nextOutputs = {};
        const immediate = {}, observed = {};
        const groups=prepare?groupsFor(order):[order];
        for(const group of groups){
          if(prepare)prepare(group,committed,name=>currentValues(name,nextManual,immediate,outputs,delays));
          for (const name of group) {
            const input = currentValues(name,nextManual,immediate,outputs,delays);
            for (const [key,value] of Object.entries(input)) observed[name+'/'+key] = value;
            const sources=causal && Object.fromEntries(Object.keys(input).map(key=>{
              const port=name+'/'+key, edge=incoming.get(port);
              return [key,{parents:causal.held(port,edge,own(immediate,edge?.from)),source:edge?.from,delay:edge?.delay}];
            }));
            nextStates[name] = integrate(name,committed,input,undefined,nextOutputs,sources,outputs);
            if (systems[name].combinational) for (const key of Object.keys(systems[name].outputs ?? {}))
              immediate[name+'/'+key] = nextOutputs[name+'/'+key];
          }
        }
        publishedSignals = {...observed,...nextOutputs};
      }
      if(reservations)nextStates=reservations.run(nextStates,{tick:at,emit:makeEmit});
      const nextDelays = Object.fromEntries([...incoming.values()].filter(edge => edge.delay).map(edge =>
        [edge.to,[...delays[edge.to].slice(1),delayedSamples?.[edge.to] ?? nextOutputs[edge.from]]]));
      publishedSignals = freeze(publishedSignals);
      const memory = historyWith(events,nextWorld.history);
      const dependencyReport = trace && trace.report();
      const nextCausal = causal?.finish();
      const nextView = {...view(nextWorld,freeze(nextStates),publishedSignals,at,receipts,nextCausal,nextChunkState),...memory};
      const nextScenario = evaluateScenario(nextView,events);
      const nextWeather = weather?.step(weatherTrackState,{time:nextView.time,view:nextView,events,
        query:Q.create(nextView,systems,projection)});
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
      sampling = nextSampling;
      spatialSampling = nextSpatial;
      pendingWrites = freeze(nextWrites);
      lastDependencies = dependencyReport;
      scenario = nextScenario;
      weatherTrackState = nextWeather;
      scheduled.delete(at);
      currentQuery = undefined;
      lastCheckpoint=undefined;
      for (const [name,{calls,ms}] of Object.entries(spent)) {
        const value = metrics.get(name) ?? {calls:0,ms:0,maxMs:0};
        metrics.set(name,{calls:value.calls+calls,ms:value.ms+ms,maxMs:Math.max(value.maxMs,ms)});
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
    function advance(to, {onTick,stopOnOutcome = false} = {}) {
      check(tickOK(to) && to >= tick, 'Target tick precedes current state or exceeds the run budget');
      while (tick < to && (!stopOnOutcome || scenario.status === 'running')) {
        step();
        onTick?.(view(),query());
      }
      return view();
    }
    function recording() {
      const trace=debug?.recording();
      return freeze({format:runFormat,version:1,origin,commands:added.slice(),end:save(),...(trace&&{trace})});
    }
    return Object.freeze({view,query,step,advance,...(timeline&&{timeline}),...(regions&&{regions:regions.api}),
      ...(debug&&{stepFrame:debug.latest,stepAttempt:debug.attempt}),
      get scenario(){return scenario;}, get history(){return history;}, get events(){return lastEvents;},
      schedule:commands => enqueue(commands,true),checkpoint:save,recording,
      commandCounts:() => {
        const all=[...origin.pending,...added];
        return {scheduled:all.length,applied:all.filter(command=>command.tick<=tick).length,pending:packCommands().length};
      },
      profile:() => rates && profile ? Object.fromEntries(names.map(name=>[name,
        metrics.get(name)??{calls:0,ms:0,maxMs:0}])) : Object.fromEntries(metrics),
      rates:() => rates ? {subdivision:rates.subdivision,systems:rates.rates} : null,
      partitions:()=>({workers:workerPool?.size??0,peakWorkers,batches:partitionBatches,
        systems:Object.fromEntries(names.filter(name=>jobsBySystem.has(name)).map(name=>[name,jobsBySystem.get(name)]))}),
      dependencies:() => ({declarations:dependencies.describe,
        ...(lastDependencies ?? {changes:[],affected:[],work:[]}),pending:pendingWrites}),
      fork:() => branch(save()),
      reset:() => branch(origin)});
    function branch(checkpoint){
      return create(checkpoint.world,{checkpoint,implementations,profile,validated:true,workerPool,traceSteps},
        checkpoint.world===plan.world?branchToken:undefined);
    }
  }
  function replay(log, options) {
    check(record(log) && log.format === runFormat && log.version === 1, 'Invalid world recording');
    const run = create(log.origin.world,{...options,checkpoint:log.origin});
    run.schedule(log.commands);
    run.advance(log.end.tick);
    check(checkpointsEqual(run.checkpoint(),log.end,options),'Replay diverged at tick ' + log.end.tick);
    return run;
  }
  function checkpointsEqual(actual,expected,{implementations}={}){
    if(equal(actual,expected))return true;
    if(!record(expected?.states)||!equal(actual.world,expected.world))return false;
    const {systems}=compile(actual.world,implementations,true);
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
  W.runtime = Object.freeze({register,validate,create,replay,diff,firstDivergence:W.stepDebug.firstDivergence,
    checkpointFormat,runFormat,maxTick,partitionKernel,checkpointsEqual,
    prefabInterfaces:(world,{implementations}={})=>compile(world,implementations,true)});
})(KIT);
