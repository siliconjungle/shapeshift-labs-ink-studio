const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const CheckpointStore = require('../src/simulation-checkpoint-store.js');
const {embedModels} = require('./simulation-model-files.js');
const {embedStoryDocuments} = require('./story-document.js');
const StoryRun = require('./story-run-controls.js');
const StoryWatch = require('./story-watch.js');
const StoryExplanation = require('./story-explanation.js');
const StoryForkCompare = require('./story-fork-compare.js');
const StorySeedMatrix = require('./story-seed-matrix.js');
const SimulationFixture = require('./simulation-fixture.js');

const read = file => JSON.parse(fs.readFileSync(path.resolve(file),'utf8'));
const parse = input => JSON.parse(String(input));
const numbers = value => String(value).split(',').map(Number);
function ensure(condition,message) {
  if (!condition) throw Error(message);
}
function write(file,value) {
  ensure(typeof file === 'string' && file.length > 0,'Expected an output file');
  const destination = path.resolve(file);
  fs.mkdirSync(path.dirname(destination),{recursive:true});
  const temporary = destination+'.'+randomUUID()+'.tmp';
  try {
    fs.writeFileSync(temporary,JSON.stringify(value,null,2)+'\n',{flag:'wx'});
    fs.renameSync(temporary,destination);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}
function readCheckpointFile(file) {
  const value = read(file);
  if (value?.format !== CheckpointStore.format) return { value };
  ensure(typeof value.store === 'string' && value.store.length > 0, 'Checkpoint reference needs a store path');
  const store = path.resolve(path.dirname(path.resolve(file)), value.store);
  return { value: CheckpointStore.openCheckpointStore(store).load(value), store };
}
function target(opt) {
  if (opt.select !== undefined) {
    ensure(opt.at === undefined && opt.entity === undefined && opt.socket === undefined, 'Use --select by itself');
    return parse(opt.select);
  }
  if (opt.at !== undefined) return {point:numbers(opt.at)};
  if (opt.entity !== undefined) return {entity:opt.entity,...(opt.socket?{socket:opt.socket}:{})};
  return {};
}

module.exports = function createCLI({kit,build,pose,dataScene,opt,renderOptions,sequenceHistory,inkOption,atmosphereEmittersOption,depthBandsOption,effectPalettesOption,stabilityOption,artDirectionOption,silhouetteOption,horizonOption,skyTransitionsOption,weatherTracksOption,skyOptions,cameraOptions,compositeOption,colorClustersOption,shot,shotReplay,shotRender}) {
  const W = kit.KIT.world, R = W.runtime;
  let workerPool;
  const args = () => opt.args ? parse(opt.args) : {};
  function sampleArgs() {
    if (opt.explain === undefined) return args();
    ensure(opt.explain === true,'Use --explain without a value');
    return {...args(),explain:true};
  }
  function fieldMetadata(query,name) {
    const descriptor = query.field?.(name);
    return descriptor?.spatial ? {type:descriptor.type,units:descriptor.units,spatial:descriptor.spatial} : {};
  }
  const respond = value => {
    if (opt.out) write(opt.out,value);
    else process.stdout.write(JSON.stringify(value,null,opt.json?0:2)+'\n');
  };
  function checkReportPath(sources,destination=opt.out,inputLabel='story sources') {
    if (destination===undefined) return;
    ensure(typeof destination==='string'&&destination.trim(),'--out needs a report path');
    const out = path.resolve(destination), existing = fs.existsSync(out)?fs.statSync(out):null;
    for (const source of sources) if (typeof source==='string') {
      const stat = existing&&fs.existsSync(source)?fs.statSync(source):null;
      ensure(path.resolve(source)!==out&&(!stat||stat.dev!==existing.dev||stat.ino!==existing.ino),
        'Use a report path separate from the '+inputLabel);
    }
  }
  function document(world, file, dependency) {
    const track = source=>{shot?.dependency(source); dependency?.(source);};
    if (file !== undefined) world = embedModels(world, file, track);
    if (world.format === W.models.format) world = W.models.compile(world);
    if (file !== undefined) world = require('./asset-references.js').visual(kit.KIT.authoring.assetReferences, world, 'world', file, track);
    if (file !== undefined) world = embedStoryDocuments(world, file, track);
    if (file !== undefined && world.dataInputs !== undefined) world = { ...world,
      dataInputs: require('./data-inputs.js').embed(kit.KIT.dataInputs, world.dataInputs, file, track) };
    if (opt['asset-pack'] === undefined) return {world};
    const packs = require('./asset-pack.js').install(kit.KIT.authoring.assetPacks, world.assetPacks, opt['asset-pack']);
    dependency?.(path.resolve(opt['asset-pack']));
    return {world:{...world,assetPacks:packs}};
  }
  function load(file, { lookPreview = false, dependency } = {}) {
    ensure(typeof file === 'string','Expected a scene or run file');
    if (/\.(js|cjs)$/i.test(file)) {
      const factory = require(path.resolve(file)), value = typeof factory === 'function' ? factory(kit) : factory;
      return [W.format,W.models.format].includes(value.format) ? document(value,file,dependency) :
        value.simulation ? document(value.simulation,file,dependency) : {legacy:file};
    }
    if (/\.json$/i.test(file)) {
      let { value,store } = readCheckpointFile(file);
      const bundles=kit.KIT.authoring.projectBundles;
      if(value?.format===bundles.format&&value.version===bundles.storyVersion){
        const project=require('./project-bundle.js').readProjectBundle(file);
        value=require('./story-exchange.js').readRecording(project);
        ensure(value,'This story bundle has no native recording. Use story events or import its definitions.');
      }
      if ([W.format,W.models.format].includes(value.format)) return document(value,file,dependency);
      if (!lookPreview && [R.checkpointFormat,R.runFormat].includes(value.format))
        ensure(opt['asset-pack']===undefined,'Recorded runs and checkpoints keep their original asset packs');
      if (value.format === R.checkpointFormat) return {world:value.world,checkpoint:value,store};
      if (value.format === R.runFormat) return {world:value.end.world,checkpoint:value.end,log:value,store};
      if (value.format === SimulationFixture.format) return {fixture:value};
      if (bundles && value.format === bundles.format) return { legacy: file, document: bundles.open(value).scene() };
      return {legacy:file,document:value};
    }
    return {legacy:file};
  }
  function sourceWorld(input) {
    ensure(input.world,'The scene must expose an Ink Studio world manifest');
    if (input.checkpoint) ensure(opt.seed===undefined && opt.dt===undefined,'A resumed run uses its checkpoint seed and timestep');
    if (input.world.simulationModel) ensure(opt.seed===undefined && opt.dt===undefined,'A simulation model pins its seed and timestep');
    const storyteller = opt.storyteller;
    if (storyteller!==undefined) {
      ensure(!input.checkpoint,'A recorded world keeps its original storyteller profile');
      ensure(typeof storyteller==='string'&&W.data.own(input.world.storyteller?.profiles,storyteller),
        '--storyteller needs an authored profile ID');
    }
    return !input.checkpoint && (opt.seed!==undefined||opt.dt!==undefined||storyteller!==undefined)
      ? {...input.world,...(opt.seed!==undefined&&{seed:Number(opt.seed)}),...(opt.dt!==undefined&&{dt:Number(opt.dt)}),
        ...(storyteller!==undefined&&{storyteller:{...input.world.storyteller,active:storyteller}})}
      : input.world;
  }
  function runtime(input, profile = false, regionRevisions, recordRun) {
    return R.create(sourceWorld(input),{checkpoint:input.checkpoint,profile,workerPool,regionRevisions,traceSteps:traceRetention(),
      recordRun,branch:opt.branch});
  }
  function recordingRun(input, options) {
    sourceWorld(input);
    return R.openRecording(input.log,{workerPool,traceSteps:traceRetention(),...options});
  }
  function recordOptions() {
    ensure(opt.observations===undefined||typeof opt.observations==='string'&&typeof opt.record==='string',
      '--observations needs a plan file and --record FILE');
    if(opt.observations===undefined)return opt.record?true:undefined;
    const plan=read(opt.observations);
    ensure(W.data.record(plan?.observations),'The observation plan needs named observations');
    return plan;
  }
  function traceRetention(){
    const value=opt['trace-steps'];
    if(value===undefined)return undefined;
    if(value===true)return 256;
    const count=Number(value);
    ensure(/^\d+$/.test(value)&&Number.isInteger(count)&&count>=1&&count<=4096,
      '--trace-steps needs a retention count from 1 to 4096');
    return count;
  }
  function to(run) {
    const {tick,world} = run.view(), modes = [opt.ticks,opt.steps,opt.t].filter(v => v !== undefined);
    ensure(modes.length<=1 && modes.every(v => v!==true && Number.isFinite(Number(v))),'Specify one finite time using --ticks, --steps or --t');
    return opt.ticks !== undefined ? Number(opt.ticks) :
      opt.steps !== undefined ? tick + Number(opt.steps) :
      opt.t !== undefined ? Math.floor(Number(opt.t)/world.dt+1e-10) :
      world.scenario?.until !== undefined ? Math.max(tick,world.scenario.until) : tick;
  }
  function schedule(run) {
    if (opt.actions) run.schedule(read(opt.actions));
  }
  function snapshotRun(input, run, tick) {
    if (input.log && tick < run.view().tick) {
      const { origin } = input.log;
      ensure(tick >= origin.tick, 'Tick precedes the start of the recording');
      run = recordingRun(input);
    }
    schedule(run);
    return run;
  }
  function advanceVisual(run, tick) {
    const emitters = kit.KIT.atmosphere.emitters;
    const { world, tick: start } = run.view();
    const program = emitters.settings(W.visualEnvironment(world).atmosphereEmitters, atmosphereEmittersOption?.());
    const targets = program?.targets.filter(target => target.entity !== undefined);
    if (!targets?.length || tick < start) {
      run.advance(tick);
      return;
    }
    const history = emitters.history(targets, program.lifetime);
    function observe(view, query) {
      history.capture(view.time, target => emitters.entityPose(query, target));
    }
    run.advance(Math.max(start, tick-Math.ceil(program.lifetime/world.dt)-1));
    observe(run.view(), run.query());
    run.advance(tick, {onTick:observe});
    return history.at;
  }
  function visualSnapshot(input, at) {
    const initial = runtime(input);
    const tick = at !== undefined ? Math.floor(at/initial.view().world.dt+1e-10) :
      opt.steps === undefined && opt.ticks === undefined && opt.t === undefined ? initial.view().tick : to(initial);
    const run = snapshotRun(input, initial, tick);
    const atmospherePose = advanceVisual(run,tick);
    const view = run.view(), Preview = require('./look-preview.js');
    const world = Preview.withAlbedo(() => W.visual(kit, view, run.query()));
    return { ...world, ...(atmospherePose && {atmospherePose}), id: view.world.id, assetPacks: view.world.assetPacks,
      ...(!input.checkpoint && { lookPreviewPacks: view.world.assetPacks }) };
  }
  function environmentSnapshot(file) {
    const input=load(file);
    return input.world ? visualSnapshot(input) : null;
  }
  function visualSweep(file, plan, directory, overrides = {}, anchor, loaded) {
    const input = loaded ?? load(file);
    ensure(input.world, 'A simulation sweep needs a world, checkpoint or recording');
    const current = sourceWorld(input);
    const world = input.checkpoint ?? { ...current, ...overrides };
    let previous, history;
    const render = require('./render.js');
    return require('./visual-sweep.js').runSimulation({
      kit: kit.KIT, source: file, plan, directory, input: world, workerPool, runtime: overrides, anchor,
      renderFrame(snapshot, query, { width: w, height: h, pixelSize: px, times }, id, tick, t) {
        if (previous !== id) {
          previous = id;
          history = times.length ? sequenceHistory() : undefined;
        }
        const world = W.visual(kit, snapshot, query);
        const temporal = times.includes(tick) ? history : undefined;
        return render.upscale(render.render(world, { ...temporal, w, h, px, t, transparent: false }), px);
      }
    });
  }
  function lookSnapshot(file) {
    const input = load(file, { lookPreview: true });
    return input.world ? visualSnapshot(input) : null;
  }
  function snapshot(input) {
    let run = runtime(input);
    if (opt.actions || opt.ticks !== undefined || opt.steps !== undefined || opt.t !== undefined) {
      const tick = to(run);
      run = snapshotRun(input, run, tick);
      run.advance(tick);
    }
    return run;
  }
  function view(file, {worldOnly=false} = {}) {
    const input = load(file);
    if (input.world) return snapshot(input).query();
    ensure(!worldOnly,'The inspector needs an Ink Studio world, checkpoint, or recording');
    const world = build(input.legacy);
    const t = Number(opt.t ?? 0);
    ensure(Number.isFinite(t) && t>=0,'Invalid probe time');
    pose(world,t);
    return W.query.fromScene(world,t);
  }
  function inspectLook(file) {
    return view(file).inspectLook({renderer:opt.renderer});
  }
  function inspectTimeline(file) {
    const input = load(file);
    const timeline = input.world ? W.sceneTimeline(input.world) :
      input.document?.format === W.scrub.takeFormat ? W.scrub.openTake(input.document) : build(input.legacy).timeline;
    ensure(timeline, 'This scene has no unified timeline');
    const at = Number(opt.at ?? 0), from = Number(opt.from ?? -1), to = Number(opt.to ?? timeline.duration);
    ensure(![opt.at, opt.from, opt.to].includes(true), 'Timeline times need numeric values');
    respond({ duration: timeline.duration, targets: timeline.targets, frame: timeline.sample(at), cues: timeline.between(from, to) });
  }
  function inspectCameraRig(file) {
    ensure(file && opt.at !== true, 'Use camera-rig <scene or world> [--at seconds] [--camera-shot ID]');
    const at = opt.at === undefined ? undefined : Number(opt.at);
    ensure(at === undefined || Number.isFinite(at) && at >= 0, 'Camera rig time must be nonnegative and finite');
    const input = load(file);
    const world = input.world ? visualSnapshot(input, at) : build(input.legacy);
    const t = at ?? world.lookSnapshot?.time ?? 0;
    if (!input.world) pose(world, t);
    const rig = world.cameraRig;
    ensure(rig, 'This scene has no authored camera rig');
    const { cameraShot } = cameraOptions();
    respond({ duration: rig.duration, shots: rig.shots, ...rig.sample(t, { shot: cameraShot }) });
  }
  function assert(run,rules) {
    ensure(Array.isArray(rules) && rules.length<=10000,'Expected an assertion list');
    const out=[], temporal=[];
    const log=run.recording(), tick=run.view().tick;
    function evaluate(rule,query,at) {
      const sample=query.probe(rule.field,rule.at,rule.args);
      return {id:rule.id,tick:at,pass:sample.status===(rule.status??'ok')&&W.query.condition(rule.when,sample.value),result:sample};
    }
    for(const [i,raw] of rules.entries()){
      ensure(raw&&typeof raw==='object','Expected assertion '+(i+1));
      const rule={id:i+1,...raw};
      if(rule.profile!==undefined){
        const metric=rule.metric??'ms', data=run.profile()[rule.profile]?.[metric];
        ensure(['ms','maxMs','calls'].includes(metric)&&Number.isFinite(rule.max)&&rule.max>=0,'Invalid profile assertion');
        out[i]={id:rule.id,pass:Number.isFinite(data)&&data<=rule.max,result:{metric,value:data??null,max:rule.max}};
        continue;
      }
      ensure(typeof rule.field==='string','Assertion '+rule.id+' needs a field');
      if(rule.tick===undefined&&rule.byTick===undefined){out[i]=evaluate(rule,run.query(),tick);continue;}
      const at=rule.tick??rule.byTick;
      ensure((rule.tick===undefined||rule.byTick===undefined)&&Number.isSafeInteger(at)&&at>=log.origin.tick&&at<=tick,
        'Assertion tick lies outside the run');
      temporal.push({i,rule,at});
    }
    if(temporal.length){
      const replay=R.openRecording(log,{workerPool});
      const exact=new Map(), deadlines=[];
      for(const item of temporal){
        if(item.rule.tick===undefined)deadlines.push(item);
        else {
          const group=exact.get(item.at)??[];
          group.push(item);
          exact.set(item.at,group);
        }
      }
      function sample(frame,query){
        for(const {i,rule} of exact.get(frame.tick)??[])out[i]=evaluate(rule,query,frame.tick);
        for(const {i,rule,at} of deadlines){
          if(out[i])continue;
          const result=evaluate(rule,query,frame.tick);
          if(result.pass||frame.tick===at)out[i]=result;
        }
      }
      sample(replay.view(),replay.query());
      replay.advance(Math.max(...temporal.map(item=>item.at)),{onTick:sample});
    }
    return out;
  }
  function summary(run, checks) {
    const checkpoint = run.checkpoint(), {world,tick} = checkpoint;
    const rates = run.rates?.();
    const chunkLevels=checkpoint.simulationChunks&&Object.fromEntries(Object.values(checkpoint.simulationChunks.entries)
      .map(({id,level})=>[id,level]));
    return {id:world.id,seed:world.seed,dt:world.dt,tick,time:tick*world.dt,...(rates && {rates}),
      ...(chunkLevels&&{chunkLevels}),
      ...(workerPool&&{partitions:run.partitions()}),
      systems:Object.keys(checkpoint.states),commands:run.commandCounts(),events:checkpoint.history.length,historyDropped:checkpoint.dropped,
      scenario:run.scenario,...(world.simulationModel&&{model:W.models.sample(run)}),...(checks?{checks}:{}),...(opt.profile?{profile:run.profile(),...processingSummary(run)}:{})};
  }
  function saveCheckpoints(sourceStore) {
    const directory=opt['checkpoint-store']==='off'?undefined:opt['checkpoint-store']??sourceStore;
    const store=directory&&CheckpointStore.openCheckpointStore(directory), storage={};
    return { storage, save(key,file,value) {
      if(!store){write(file,value);return;}
      ensure(typeof file==='string'&&file.length>0,'Expected an output file');
      const {reference,...stats}=store.save(value);
      const location=path.relative(path.dirname(path.resolve(file)),store.directory)||'.';
      write(file,{...reference,store:location});
      storage[key]={root:reference.root,...stats};
    } };
  }
  function processingSummary(run) {
    const processing = run.processing();
    return Object.keys(processing).length ? {processing} : {};
  }
  function finish(run, sourceStore, detail, output = respond) {
    const checks = opt.assert ? assert(run,read(opt.assert)) : null;
    const { storage, save } = saveCheckpoints(sourceStore);
    if (opt.checkpoint) save('checkpoint',opt.checkpoint,run.checkpoint());
    if (opt.record) save('record',opt.record,run.recording());
    const report = {...summary(run,checks),...(Object.keys(storage).length&&{storage}),...detail};
    output(report);
    if (checks?.some(row => !row.pass) || opt.scenario && ['fail','timeout'].includes(run.scenario.status))
      process.exitCode = 2;
    return report;
  }
  async function watchSimulation(input, mode, sources, play) {
    let watch, run;
    try {
      async function onStart(engine) {
        run = engine;
        watch = await StoryWatch.open(W,run.view(),opt,mode,[...sources,opt.actions,opt.assert,
          opt.observations,opt['until-condition'],opt.out,opt.checkpoint,opt.record]);
        await watch.begin();
        await watch.sample(run.view(),run.query());
      }
      const onTick = (frame,query)=>watch.sample(frame,query,run.events);
      const {unmet,...detail} = await play(onStart,onTick)??{};
      const output = opt['watch-out']!==undefined||opt.out?respond:()=>{};
      const report = finish(run,input.store,detail,output);
      await watch.end(report);
      if (unmet) process.exitCode = 2;
    } finally {
      await watch?.close();
    }
  }
  function getCheckpoint(file) {
    const input = load(file);
    ensure(input.checkpoint,'Expected a checkpoint or recording');
    if (opt.ticks === undefined || Number(opt.ticks)===input.checkpoint.tick) return input.checkpoint;
    ensure(input.log,'Earlier ticks require a recording');
    const at=Number(opt.ticks);
    ensure(Number.isSafeInteger(at)&&at>=input.log.origin.tick&&at<=input.log.end.tick,'Tick lies outside the recording');
    const session = W.scrub.create(input.log, { checkpointCache: 0, runtime: { workerPool } });
    session.seek(at);
    return session.checkpoint();
  }
  function scrubSession(input) {
    const world = sourceWorld(input);
    const number = key => opt[key] === undefined ? undefined :
      typeof opt[key] === 'string' && /^\d+$/.test(opt[key]) ? Number(opt[key]) : NaN;
    return W.scrub.create(input.log ?? input.checkpoint ?? world, {
      checkpointEvery: number('checkpoint-every'), checkpointCache: number('checkpoint-cache'),
      commands: opt.actions === undefined ? [] : read(opt.actions), runtime: { workerPool }
    });
  }
  function scrubSimulation(file) {
    const input = load(file), session = scrubSession(input);
    const value = opt.ticks ?? opt.t;
    ensure(!(opt.ticks !== undefined && opt.t !== undefined) && typeof value === 'string' &&
      value.split(',').every(item => item.trim()), 'Give an ordered seek list using --ticks N,N or --t seconds,seconds');
    const times = numbers(value);
    ensure(times.length <= 1000, 'Scrub supports up to 1000 seeks per report');
    const frames = times.map(at => {
      const view = opt.ticks === undefined ? session.seekTime(at) : session.seek(at);
      const { checkpointTick, replayedTicks } = session.status(), query = session.query();
      return { tick: view.tick, time: view.time, ...(opt.ticks === undefined && { requestedTime: at }),
        checkpointTick, replayedTicks, events: session.events(),
        ...(opt.field ? { sample: query.probe(opt.field, target(opt), args()) } :
          opt.entity ? { pose: query.frame(target(opt)) ?? null } : {}) };
    });
    let stored = {};
    if (opt.checkpoint !== undefined) {
      ensure(typeof opt.checkpoint === 'string' && (!opt.out || path.resolve(opt.checkpoint) !== path.resolve(opt.out)),
        'Use separate paths for the scrub report and checkpoint');
      const { storage, save } = saveCheckpoints(input.store);
      save('checkpoint', opt.checkpoint, session.checkpoint());
      if (storage.checkpoint) stored = { storage };
    }
    respond({ id: session.view().world.id, ...session.status(), frames, ...stored });
  }
  function captureTake(file) {
    const input = load(file), session = scrubSession(input);
    const tick = (key, fallback) => {
      const value = opt[key];
      if (value === undefined) return fallback;
      ensure(typeof value === 'string' && /^\d+$/.test(value), '--' + key + ' needs a tick number');
      return Number(value);
    };
    ensure(opt.t === undefined && opt.steps === undefined, 'Use --from and --ticks to set the take range');
    ensure(opt.tracks === undefined || typeof opt.tracks === 'string' && opt.entity === undefined && opt.part === undefined,
      'Use --tracks FILE or --entity ID with an optional --part ID');
    const tracks = opt.tracks ? read(opt.tracks) : W.scrub.motionTracks(opt.entity, opt.part);
    respond(session.recordTake({ tracks, from: tick('from', session.status().fromTick),
      to: tick('ticks', input.log?.end.tick), every: tick('every', 1) }));
  }
  function dependencyReport(file) {
    ensure(typeof file==='string','Supply a world, recording or retained dependency driver');
    if (/\.(js|cjs)$/i.test(file)) {
      const source = require(path.resolve(file));
      if (typeof source.dependencies === 'function') {
        ensure(['ticks','steps','t','actions'].every(key=>opt[key]===undefined),
          'Retained dependency drivers supply their own edits');
        return Promise.resolve(source.dependencies(kit)).then(respond);
      }
    }
    const input = load(file);
    const run = input.log ? recordingRun(input) : runtime(input);
    schedule(run);
    const start = run.view().tick;
    const end = input.log && opt.ticks===undefined && opt.steps===undefined && opt.t===undefined ? input.log.end.tick : to(run);
    const ticks = [];
    run.advance(end,{onTick(view) {
      const {changes,affected,work,pending} = run.dependencies();
      if (changes.length || work.length || pending.length) {
        ensure(ticks.length<10000,'Spatial dependency report exceeds its tick budget');
        ticks.push({tick:view.tick,changes,affected,work,...(pending.length && {pending})});
      }
    }});
    return respond({format:'ink-studio/spatial-dependencies',version:1,id:run.view().world.id,
      fromTick:start,toTick:end,declarations:run.dependencies().declarations,ticks,
      ...(workerPool&&{partitions:run.partitions()})});
  }
  async function sim(args) {
    ensure(opt['checkpoint-store']===undefined||typeof opt['checkpoint-store']==='string'&&
      opt['checkpoint-store'].length>0,'--checkpoint-store needs a directory or off');
    if(opt.workers!==undefined){
      ensure(typeof opt.workers==='string'&&/^\d+$/.test(opt.workers),'--workers needs a count from 1 to 32');
      workerPool=require('../index.js').createSimulationWorkers(Number(opt.workers));
    }
    try {
      return await runSimulation(args);
    } finally {
      workerPool?.close();
      workerPool=undefined;
    }
  }
  function regionUpdate(file){
    const input=load(file);
    ensure(typeof opt.stream==='string','Region revisions need --stream ID');
    ensure(opt.global===undefined||opt.global===true,'Use --global without a value');
    ensure(opt.regions===undefined||typeof opt.regions==='string','Use --regions ID,ID for an explicit selection');
    ensure(opt.near===undefined||typeof opt.near==='string','Use --near X,Y,Z for a nearby selection');
    ensure(opt.since===undefined||typeof opt.since==='string','Use --since FILE for an applied cursor');
    const regionRevisions={stream:opt.stream,...(opt.retain!==undefined&&{retain:opt.retain===true?NaN:Number(opt.retain)})};
    const run=input.log?recordingRun(input,{regionRevisions}):runtime(input,false,regionRevisions);
    schedule(run);
    const tick=input.log&&opt.ticks===undefined&&opt.steps===undefined&&opt.t===undefined?input.log.end.tick:to(run);
    run.advance(tick);
    if(input.log&&!opt.actions&&tick===input.log.end.tick)
      ensure(W.data.equal(run.checkpoint(),input.log.end),'Replay diverged at tick '+tick);
    const selected={
      ...(opt.regions!==undefined&&{regions:opt.regions===''?[]:opt.regions.split(',')}),
      ...(opt.near!==undefined&&{at:numbers(opt.near)}),...(opt.place!==undefined&&{place:opt.place}),
      ...(opt.radius!==undefined&&{radius:opt.radius===true?NaN:Number(opt.radius)}),...(opt.global&&{includeGlobal:true})
    };
    const last=opt.since&&read(opt.since);
    return respond(run.regions.pull(selected,{since:last?.cursor??last??undefined}));
  }
  function applyRegionUpdate(file,other){
    const mirror=W.regionRevisions.receiver();
    ensure(mirror.apply(read(file)).status==='applied','Expected a region snapshot as the baseline');
    const applied=mirror.apply(read(other));
    ensure(['applied','duplicate'].includes(applied.status),'Region update '+applied.status);
    return respond(mirror.snapshot());
  }
  function firstDivergence(file,other){
    ensure(opt.first===true,'Use --first without a value');
    ensure(opt.field===undefined&&opt.spec===undefined&&opt.t===undefined&&opt.steps===undefined,
      'Use --from and --ticks for a first-divergence comparison');
    const source=file=>{
      const input=load(file);
      ensure(input.world,'First-divergence comparison needs a world, checkpoint or recording');
      return input.log??input.checkpoint??input.world;
    };
    const count=(value,name)=>{
      if(value===undefined)return undefined;
      ensure(typeof value==='string'&&/^\d+$/.test(value),'--'+name+' needs a nonnegative integer');
      return Number(value);
    };
    const pools=[];
    function side(key){
      const workers=count(opt[key],key);
      if(workers===undefined)return workerPool;
      if(workers===0)return undefined;
      const pool=require('../index.js').createSimulationWorkers(workers);
      pools.push(pool);
      return pool;
    }
    try {
      return respond(R.firstDivergence(source(file),other===undefined?undefined:source(other),{
        from:count(opt.from,'from'),to:count(opt.ticks,'ticks'),limit:count(opt.limit,'limit'),
        leftOptions:{workerPool:side('left-workers')},rightOptions:{workerPool:side('right-workers')},
        leftReplay:opt['left-workers']!==undefined||opt.workers!==undefined,
        rightReplay:opt['right-workers']!==undefined||opt.workers!==undefined
      }));
    } finally {
      for(const pool of pools)pool.close();
    }
  }
  function modelCommand(mode,file) {
    ensure(['validate','inspect','compile'].includes(mode) && typeof file === 'string',
      'Use sim model validate|inspect|compile <model.json>');
    const source = embedModels(read(file), file, shot?.dependency);
    ensure(source?.format === W.models.format, 'Expected an Ink Studio simulation model');
    const world = R.validate(source,{workerPool});
    if (mode === 'compile') return respond(world);
    const {id,version,revision,inputs,outputs,probes} = world.simulationModel;
    if (mode === 'validate') return respond({valid:true,id,version,revision});
    const operators = Object.fromEntries(Object.entries(world.systems).map(([name, spec]) =>
      [name,{kind:spec.kind,revision:spec.operatorRevision,schedule:spec.schedule??{}}]));
    return respond({id,version,revision,seed:world.seed,numerics:source.numerics,domain:source.domain,
      parameters:source.parameters,initial:source.initial,boundaries:source.boundaries,
      operators,inputs,outputs,probes,
      ...(source.modules !== undefined && {modules:Object.fromEntries(Object.entries(source.modules).map(([name, model]) =>
        [name,{id:model.id,revision:model.revision}]))}),
      ...(source.instances !== undefined && {instances:source.instances}),
      ...(world.simulationModel.exposedParameters && {exposedParameters:world.simulationModel.exposedParameters})});
  }
  async function worldView(mode,file,other) {
    const Live=require('./live-world.js'), streaming=mode==='live';
    const common=['ticks','queries','policy','actions','workers'];
    const modeOptions=streaming?['step-ms','linger-ms','host','port','record']:['view','out','json'];
    const usage=streaming?Live.usage:
      'Use sim view <world|checkpoint|run> --policy access.json --view ID [--ticks N --queries queries.json --out file]';
    ensure(typeof file==='string'&&other===undefined&&Object.keys(opt).every(key=>common.includes(key)||modeOptions.includes(key))&&
      (opt.ticks===undefined||typeof opt.ticks==='string'&&/^\d+$/.test(opt.ticks))&&
      ['queries','actions','policy','record'].every(key=>opt[key]===undefined||typeof opt[key]==='string'&&opt[key].trim())&&
      (streaming||opt.policy!==undefined&&W.data.id(opt.view)&&(opt.json===undefined||opt.json===true)),usage);
    const sources=new Set([file,opt.queries,opt.policy,opt.actions]);
    const input=load(file,{dependency:source=>sources.add(source)});
    ensure(input.world&&(!input.log||opt.actions===undefined&&opt.record===undefined),
      'World views need a world, checkpoint or recording. Recordings are read-only.');
    checkReportPath([...sources],streaming?opt.record:opt.out,'world view inputs');
    const run=input.log?recordingRun(input):runtime(input,false,undefined,opt.record===undefined?undefined:true);
    const until=opt.ticks===undefined?input.log?.end.tick??(streaming?undefined:run.view().tick):Number(opt.ticks);
    ensure(!input.log||until<=input.log.end.tick,'World view exceeds the recording end tick');
    schedule(run);
    const queries=opt.queries===undefined?{}:read(opt.queries), policy=opt.policy===undefined?undefined:read(opt.policy);
    if(streaming){
      const emit=value=>new Promise((resolve,reject)=>
        process.stdout.write(JSON.stringify(value)+'\n',error=>error?reject(error):resolve()));
      await Live.serve(W,run,opt,{until,queries,policy,playback:!!input.log,emit});
      if(opt.record!==undefined)write(opt.record,run.recording());
      return;
    }
    const access=W.worldAccess.compile(policy,run.view().world,{queries});
    access.audience(opt.view);
    await run.advanceAsync(until);
    respond(access.project(opt.view,run.view(),run.query(),run.committedEvents()));
  }
  function runSimulation([mode,file,other,...extra]) {
    const watching = StoryWatch.enabled(opt);
    if (watching) ensure(['run','resume','fork','replay'].includes(mode)&&other===undefined,
      'Use sim run, resume, fork, or replay with '+StoryWatch.usage);
    ensure(opt.storyteller===undefined||['run','preflight','why','why-not','seed-matrix'].includes(mode),
      'Use --storyteller with a fresh world in sim run, preflight, why, why-not, or seed-matrix');
    ensure(opt.branch===undefined||['run','resume','fork'].includes(mode)&&W.data.id(opt.branch),
      'Use --branch ID with sim run, resume or fork');
    switch (mode) {
      case 'model': return modelCommand(file,other);
      case 'sections': {
        ensure(typeof file==='string' && other===undefined,'Use sim sections <plan.json> [--out report.json]');
        const result=require('./path-sections.js').measure(kit,read(file),file,shot?.dependency);
        return respond(result);
      }
      case 'mass-properties': {
        ensure(typeof file==='string' && other===undefined,'Use sim mass-properties <plan.json> [--asset-pack file.json --out report.json]');
        return respond(require('./mass-properties.js').measure(kit,read(file),file,
          {dependency:shot?.dependency,assetPack:opt['asset-pack']}));
      }
      case 'reference': {
        ensure((file===undefined||typeof file==='string')&&other===undefined&&
          Object.keys(opt).every(key=>['out','suite','json'].includes(key))&&
          (opt.suite===undefined||typeof opt.suite==='string')&&(opt.out===undefined||typeof opt.out==='string'),
        'Use sim reference [experiment] [--suite suite.json --out report.json]');
        const destination=opt.out===undefined?undefined:path.resolve(opt.out);
        const {report}=require('./reference-experiments.js').run(kit,{
          suite:opt.suite,id:file,dependency:source=>{
            ensure(path.resolve(source)!==destination,'Reference report must be separate from its source assets');
            shot?.dependency?.(source);
          }
        });
        respond(report);
        if(!report.passed)process.exitCode=2;
        return;
      }
      case 'review': {
        ensure(other===undefined,'Use sim review <recipe.json> --out directory [--require-match]');
        return require('./aligned-simulation-review.js').command(kit,file,opt);
      }
      case 'budget': {
        ensure(typeof file==='string'&&other===undefined&&Object.keys(opt).every(key=>['out','json','require-budget'].includes(key))&&
          (opt.out===undefined||typeof opt.out==='string')&&(opt['require-budget']===undefined||opt['require-budget']===true),
        'Use sim budget <plan.json> [--out report.json --require-budget]');
        const report=require('./simulation-performance.js').run(kit,file,{destination:opt.out,dependency:shot?.dependency});
        respond(report);
        if(opt['require-budget']&&!report.passed)process.exitCode=2;
        return;
      }
      case 'measure': {
        ensure(typeof file==='string'&&other===undefined&&Object.keys(opt).every(key=>['out','json'].includes(key)),
          'Use sim measure <run.json> [--out report.json]');
        const destination=typeof opt.out==='string'?path.resolve(opt.out):undefined;
        ensure(opt.out===undefined||destination&&destination!==path.resolve(file),'Measurement report needs a separate output file');
        const report=require('./simulation-measurements.js').run(kit,read(file),file,source=>{
          ensure(path.resolve(source)!==destination,'Measurement report must be separate from its source assets');
          shot?.dependency?.(source);
        });
        respond(report);
        if(!report.passed)process.exitCode=2;
        return;
      }
      case 'diagnose': {
        const failOn=opt['fail-on'];
        ensure(typeof file==='string'&&other===undefined&&(failOn===undefined||['warning','error'].includes(failOn)),
          'Use sim diagnose <plan.json> [--out report.json --fail-on warning|error]');
        const report=require('./simulation-diagnostics.js').run(kit,read(file),file,shot?.dependency);
        respond(report);
        if(failOn)ensure(report.status==='pass'||(report.status==='warning'&&failOn==='error'),
          'Simulation diagnostics reached '+report.status);
        return;
      }
      case 'sound-controls': {
        ensure(typeof file==='string'&&other===undefined&&(opt.at===undefined||opt.sample===undefined)&&
          (opt.at===undefined||typeof opt.at==='string')&&(opt.sample===undefined||typeof opt.sample==='string'),
        'Use sim sound-controls <run.json|controls.json> [--out controls.json] [--at seconds | --sample index]');
        const input=read(file), controls=W.motionSound;
        const result=input.format===controls.resultFormat?input:
          require('./motion-sound.js').run(kit,input,file,{build,dependency:shot?.dependency});
        return respond(opt.at!==undefined?controls.sample(result,{at:opt.at.trim().startsWith('{')?parse(opt.at):Number(opt.at)}):
          opt.sample!==undefined?controls.sample(result,{sample:Number(opt.sample)}):result);
      }
      case 'physical-audio': {
        ensure(typeof file==='string'&&other===undefined&&(opt.stems===undefined||typeof opt.stems==='string'),
          'Use sim physical-audio <run.json> [--out report.json --stems directory]');
        const physical=require('./physical-audio.js'), dependencies=new Set([file]);
        const result=physical.run(kit,read(file),file,filename=>{
          dependencies.add(filename);
          shot?.dependency?.(filename);
        });
        if(opt.stems!==undefined){
          if(typeof opt.out==='string')dependencies.add(opt.out);
          result.report.files=physical.writeStems(opt.stems,result,{exclude:[...dependencies]});
        }
        return respond(result.report);
      }
      case 'sensors': {
        ensure(typeof file==='string'&&other===undefined&&(opt.wav===undefined||typeof opt.wav==='string')&&
          (opt.wav===undefined||typeof opt.out!=='string'||path.resolve(opt.wav)!==path.resolve(opt.out)),
          'Use sim sensors <run.json> [--out report.json --wav microphones.wav]');
        const plan=read(file), sensors=require('./virtual-sensors.js');
        const report=sensors.run(kit,plan,file,shot?.dependency);
        if(opt.wav!==undefined)sensors.writeWav(opt.wav,report,plan.audio);
        return respond(report);
      }
      case 'controller': {
        ensure(typeof file==='string'&&other===undefined,'Use sim controller <run.json> [--out trace.json]');
        return respond(require('./controller-tools.js').run(kit,read(file),file,shot?.dependency));
      }
      case 'fit-targets': {
        ensure(typeof file==='string'&&other===undefined&&(opt['require-tolerance']===undefined||opt['require-tolerance']===true),
          'Use sim fit-targets <plan.json> [--out report.json --require-tolerance]');
        const report=require('./controller-tools.js').fit(kit,read(file),file,shot?.dependency);
        respond(report);
        if(opt['require-tolerance'])ensure(report.converged,'Inverse target fit ended with status '+report.status);
        return;
      }
      case 'fit-parameters': {
        ensure(typeof file==='string'&&other===undefined&&Object.keys(opt).every(key=>['out','json','require-tolerance'].includes(key))&&
          (opt['require-tolerance']===undefined||opt['require-tolerance']===true),
        'Use sim fit-parameters <run.json> [--out report.json --require-tolerance]');
        const destination=typeof opt.out==='string'?path.resolve(opt.out):undefined;
        ensure(opt.out===undefined||destination&&destination!==path.resolve(file),'Parameter fit needs a separate report file');
        const report=require('./parameter-fit.js').run(kit,read(file),file,source=>{
          ensure(path.resolve(source)!==destination,'Fit report must be separate from its source assets');
          shot?.dependency?.(source);
        });
        respond(report);
        if(opt['require-tolerance']&&!report.metTolerance)process.exitCode=2;
        return;
      }
      case 'input-compile': {
        ensure(typeof file==='string'&&other===undefined,'Use sim input-compile <plan.json> [--out score.json]');
        return respond(require('./input-compiler.js').load(kit,read(file),file,shot?.dependency));
      }
      case 'input-edit': {
        ensure(typeof file==='string'&&typeof other==='string','Use sim input-edit <score.json> <edits.json> [--out score.json]');
        return respond(W.inputCompilers.edit(read(file),read(other)));
      }
      case 'input-export': {
        const kind=opt.kind;
        ensure(typeof file==='string'&&['recording','events','gesture'].includes(kind)&&
          (kind==='gesture'?typeof other==='string':other===undefined),
        'Use sim input-export <score.json> --kind recording|events, or sim input-export <score.json> <bindings.json> --kind gesture');
        const score=W.inputCompilers.prepare(read(file));
        return respond(kind==='gesture'?score.gestures(read(other)):kind==='events'?score.events():score.recording());
      }
      case 'gesture-score': {
        const point=opt.t!==undefined||opt.tick!==undefined;
        const range=['from-tick','to-tick','every'].some(key=>opt[key]!==undefined);
        ensure(typeof file==='string'&&other===undefined&&!(point&&range)&&
          (opt.t===undefined||opt.tick===undefined)&&(!range||opt['to-tick']!==undefined)&&
          ['resume','checkpoint'].every(key=>opt[key]===undefined||typeof opt[key]==='string'),
        'Use sim gesture-score <score.json> [--t seconds | --tick N | --from-tick N --to-tick N --every N]');
        const score=W.gestureScores.prepare(read(file));
        const index=key=>{
          const value=opt[key];
          if(value===undefined)return undefined;
          ensure(typeof value==='string'&&/^\d+$/.test(value),'--'+key+' needs an integer score tick');
          return Number(value);
        };
        ensure(opt.t===undefined||typeof opt.t==='string'&&opt.t.trim(),'--t needs seconds');
        const checkpoint=opt.resume===undefined?undefined:read(opt.resume);
        const at=opt.t===undefined?index('tick'):score.tickAt(Number(opt.t));
        const result=score.trace({fromTick:point?at:index('from-tick'),toTick:point?at:index('to-tick'),
          every:index('every'),checkpoint});
        if(opt.checkpoint!==undefined){
          ensure(opt.out===undefined||path.resolve(opt.checkpoint)!==path.resolve(opt.out),
            'Gesture trace and checkpoint need distinct output paths');
          write(opt.checkpoint,result.checkpoint);
        }
        return respond(result);
      }
      case 'boundaries': {
        ensure(typeof file==='string'&&other===undefined&&
          (opt.t===undefined||typeof opt.t==='string')&&(opt.dt===undefined||typeof opt.dt==='string'),
        'Use sim boundaries <asset.json> [--t seconds --dt seconds --out file.json]');
        return respond(W.boundaryConditions.prepare(read(file)).sample(Number(opt.t??0),Number(opt.dt??0)));
      }
      case 'resonator': {
        ensure(['bake','render'].includes(file)&&typeof other==='string'&&
          (opt.wav===undefined||file==='render'&&typeof opt.wav==='string'),
        'Use sim resonator bake <plan.json> or sim resonator render <run.json> [--out file.json --wav sound.wav]');
        ensure(opt.wav===undefined||typeof opt.out!=='string'||path.resolve(opt.wav)!==path.resolve(opt.out),
          'Modal trace and WAV need distinct output files');
        const modal=require('./modal-resonator.js'), plan=read(other);
        const result=file==='bake'?modal.bake(kit,plan,other,shot?.dependency):modal.run(kit,plan,other,shot?.dependency);
        if(opt.wav!==undefined)modal.writeWav(opt.wav,result,plan.audio);
        return respond(result);
      }
      case 'excite': {
        ensure(typeof file==='string' && other===undefined && (opt.wav===undefined||typeof opt.wav==='string'),
        'Use sim excite <run.json> [--out trace.json --wav force.wav]');
        ensure(opt.wav===undefined||typeof opt.out!=='string'||path.resolve(opt.wav)!==path.resolve(opt.out),
          'Contact trace and WAV need distinct output files');
        const exciter=require('./contact-exciter.js'), plan=read(file);
        const result=exciter.run(kit,plan,file,shot?.dependency);
        if(opt.wav!==undefined)exciter.writeWav(opt.wav,result,plan.audio);
        return respond(result);
      }
      case 'waves': {
        ensure(typeof file==='string' && other===undefined && (opt.wav===undefined||typeof opt.wav==='string'),
        'Use sim waves <run.json> [--out trace.json --wav audition.wav]');
        ensure(opt.wav===undefined||typeof opt.out!=='string'||path.resolve(opt.wav)!==path.resolve(opt.out),
          'Wave trace and WAV need distinct output files');
        const wave=require('./wave-network.js'), plan=read(file);
        const result=wave.run(kit,plan,file,shot?.dependency);
        if(opt.wav!==undefined)wave.writeWav(opt.wav,result,plan.audio);
        return respond(result);
      }
      case 'network': {
        ensure(typeof file==='string' && other===undefined,'Use sim network <run.json> [--out trace.json]');
        return respond(require('./lumped-network.js').run(kit,read(file),file,shot?.dependency));
      }
      case 'solve': {
        ensure(typeof file==='string' && other===undefined &&
          (opt['require-convergence']===undefined||opt['require-convergence']===true),
        'Use sim solve <plan.json> [--out report.json --require-convergence]');
        const result=require('./numerical-solvers.js').run(kit,read(file),file,shot?.dependency);
        respond(result);
        if(opt['require-convergence'])ensure(result.converged,'Solve ended with status '+result.status);
        return;
      }
      case 'grid-ops': {
        ensure(typeof file==='string' && other===undefined,'Use sim grid-ops <plan.json> [--out report.json]');
        return respond(require('./grid-operators.js').run(kit,read(file),file,shot?.dependency));
      }
      case 'integrate': {
        ensure(typeof file==='string' && other===undefined,'Use sim integrate <plan.json> [--out trace.json]');
        return respond(require('./state-integrators.js').run(kit,read(file),file,shot?.dependency));
      }
      case 'reduce': {
        ensure(typeof file==='string' && other===undefined,'Use sim reduce <plan.json> [--out asset.json]');
        return respond(require('./model-reduction.js').bake(kit,read(file),file,shot?.dependency));
      }
      case 'remap': {
        ensure(typeof file==='string' && other===undefined,'Use sim remap <plan.json> [--out report.json]');
        return respond(require('./state-remap.js').run(kit,read(file),file,shot?.dependency));
      }
      case 'discretize': {
        ensure(typeof file==='string' && other===undefined,'Use sim discretize <plan.json> [--out compiled.json]');
        return respond(require('./discretization.js').compile(kit,read(file),file,shot?.dependency));
      }
      case 'domain': {
        ensure(typeof file==='string' && other===undefined &&
          (opt.section===undefined||typeof opt.section==='string') &&
          (opt.world===undefined?opt.ticks===undefined&&opt.steps===undefined&&opt.t===undefined:typeof opt.world==='string'),
        'Use sim domain <domain.json> [--world world.json --section tube/index --out file.json]');
        const source=read(file);
        let domain;
        if (source?.format===W.domains.compiledFormat) {
          ensure(source.version===1&&opt.world===undefined,'A compiled domain already pins its socket positions');
          domain=source;
        } else {
          let query,snapshot;
          if (opt.world!==undefined) {
            shot?.dependency(opt.world);
            const run=runtime(load(opt.world));
            if (opt.ticks!==undefined||opt.steps!==undefined||opt.t!==undefined) run.advance(to(run));
            query=run.query();
            const {world,tick}=run.view();
            snapshot={world:world.id,tick};
          }
          const {resolveSource}=require('./path-sections.js');
          domain=W.domains.compile(source,{query,snapshot,
            resolveSource:definition=>resolveSource(kit,definition,file,shot?.dependency)});
        }
        return respond(opt.section===undefined?domain:W.domains.trace(domain,opt.section));
      }
      case 'live':
      case 'view': return worldView(mode,file,other);
      case 'run':
      case 'resume':
      case 'fork': {
        const sources = new Set([file]);
        const input = load(file,{dependency:watching?source=>sources.add(source):undefined});
        ensure(mode==='run' || input.checkpoint,'Expected a checkpoint or recording to resume or fork');
        const run = runtime(input,!!(opt.profile||opt.assert),undefined,recordOptions());
        if (mode === 'run' && !input.checkpoint) for (const issue of run.storyDiagnostics())
          console.error(`Story warning [${issue.code}] ${issue.document} ${issue.path}: ${issue.message}`);
        const stopping = StoryRun.enabled(opt);
        let controls, limit = to(run);
        if (stopping) {
          ensure(other===undefined,'Use one world, checkpoint, or recording with story run controls');
          controls = StoryRun.create(W,run,opt,read);
          const {tick,world} = run.view();
          const timed = [opt.ticks,opt.steps,opt.t,world.scenario?.until].some(value=>value!==undefined);
          if (!timed) limit = Math.min(R.maxTick,tick+(controls.hasStops?1000:1));
          controls.schedule();
        }
        schedule(run);
        if (watching) {
          return watchSimulation(input,mode,sources,async (onStart,onTick)=>{
            await onStart(run);
            if (controls) return controls.advanceAsync(limit,!!opt.scenario,onTick);
            await run.advanceAsync(limit,{stopOnOutcome:!!opt.scenario,onTick});
          });
        }
        if (controls) {
          const {unmet,...detail} = controls.advance(limit,!!opt.scenario);
          finish(run,input.store,detail);
          if (unmet) process.exitCode = 2;
          break;
        }
        run.advance(limit,{stopOnOutcome:!!opt.scenario});
        finish(run,input.store);
        break;
      }
      case 'cast': {
        ensure(typeof file==='string' && other===undefined && typeof opt.spec==='string' && opt.args===undefined,
          'Use sim cast <world|checkpoint|run> --spec casting.json');
        const result = view(file).probe(W.storyCasting.field,undefined,read(opt.spec));
        ensure(result.status==='ok',result.reason);
        return respond(result.value);
      }
      case 'why':
      case 'why-not': {
        ensure(typeof file==='string'&&Object.keys(opt).every(key=>['offer','role','actor','spec','stage','outcome','trace',
          'ticks','steps','t','actions','seed','dt','storyteller','asset-pack','workers','out','json'].includes(key)),StoryExplanation.usage);
        const question = StoryExplanation.request(W,mode,other,opt,read);
        const sources = new Set([file,opt.spec,opt.actions]);
        const input = load(file,{dependency:source=>sources.add(source)});
        checkReportPath(sources);
        return respond(StoryExplanation.explain(W,snapshot(input),question));
      }
      case 'fork-compare': {
        ensure(typeof file==='string'&&typeof other==='string'&&!extra.length&&typeof opt.out==='string'&&opt.out.trim()&&
          Object.keys(opt).every(key=>['out','workers','seed','dt','asset-pack','json'].includes(key)),StoryForkCompare.usage);
        const sources = new Set([file,other]), plan = StoryForkCompare.prepare(W,read(other),other,read,sources);
        const input = load(file,{dependency:source=>sources.add(source)});
        const fromRecording = input.log&&(plan.capture.stage!==undefined||plan.capture.tick<input.checkpoint.tick);
        const report = StoryForkCompare.run(W,plan,{
          engine:fromRecording?recordingRun(input):runtime(input),recordedEnd:input.log?.end.tick,
          workerPool,destination:opt.out,sources
        });
        process.stdout.write(JSON.stringify(report,null,opt.json?0:2)+'\n');
        return;
      }
      case 'seed-matrix': {
        ensure(typeof file==='string'&&typeof other==='string'&&!extra.length&&
          Object.keys(opt).every(key=>['out','workers','storyteller','asset-pack','json'].includes(key)),StorySeedMatrix.usage);
        const sources = new Set([file,other]), plan = StorySeedMatrix.prepare(W,read(other),other,read,sources);
        const input = load(file,{dependency:source=>sources.add(source)});
        ensure(!input.checkpoint,'A seed matrix needs a fresh world. Checkpoints keep their original seed');
        checkReportPath(sources);
        return respond(StorySeedMatrix.run(W,sourceWorld(input),plan,{workerPool}));
      }
      case 'fixture': {
        ensure(typeof file==='string'&&other===undefined&&typeof opt.out==='string'&&opt.out.trim()&&
          Object.keys(opt).every(key=>['out','json','from','ticks','actions','event','event-where','fault','minimize',
            'workers','asset-pack'].includes(key))&&['from','ticks'].every(key=>opt[key]===undefined||/^\d+$/.test(opt[key]))&&
          (opt.actions===undefined||typeof opt.actions==='string')&&(opt['event-where']===undefined||
            typeof opt.event==='string'&&typeof opt['event-where']==='string')&&
          (opt.event===undefined||typeof opt.event==='string'&&opt.event.trim()&&opt.fault===undefined)&&
          ['fault','minimize'].every(key=>opt[key]===undefined||opt[key]===true),SimulationFixture.usage);
        const sources = new Set([file,opt.actions]);
        const input = load(file,{dependency:source=>sources.add(source)});
        checkReportPath(sources,opt.out,'source files');
        if (input.store) {
          const output = fs.existsSync(opt.out)?fs.realpathSync(opt.out):path.resolve(opt.out);
          const relative = path.relative(fs.realpathSync(input.store),output);
          ensure(relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative),
            'Write fixtures outside the source checkpoint store');
        }
        const where = opt['event-where']===undefined?undefined:parse(opt['event-where']);
        W.query.condition(where,undefined);
        const focus = opt.fault?{kind:'fault'}:opt.event?{kind:'event',event:opt.event,...(where!==undefined&&{where})}:undefined;
        const fixture = JSON.parse(JSON.stringify(SimulationFixture.build(W,input,{
          from:opt.from===undefined?undefined:Number(opt.from),until:opt.ticks===undefined?undefined:Number(opt.ticks),
          actions:opt.actions===undefined?undefined:read(opt.actions),focus,reduce:opt.minimize,workerPool
        })));
        const {report} = SimulationFixture.replay(W,fixture,{workerPool});
        ensure(report.status==='verified','Fixture could not be replayed after export at tick '+report.mismatch?.tick);
        write(opt.out,fixture);
        process.stdout.write(JSON.stringify({...report,file:path.resolve(opt.out),focus:fixture.focus,reduction:fixture.reduction},
          null,opt.json?0:2)+'\n');
        return;
      }
      case 'scheduler': {
        ensure(typeof file==='string'&&other===undefined&&opt.args===undefined&&
          (opt.incident===undefined||typeof opt.incident==='string'),
        'Use sim scheduler <world|checkpoint|run> [--ticks N] [--incident document/story]');
        const result = view(file,{worldOnly:true}).probe(W.schedulerInspector.field,undefined,
          opt.incident===undefined?{}:{incident:opt.incident});
        ensure(result.status==='ok',result.reason);
        return respond(result.value);
      }
      case 'preflight': {
        ensure(typeof file==='string','Use sim preflight <world.json> [--strict]');
        const source = path.resolve(file), directory = path.dirname(source), files = new Set([source]);
        const input = load(file,{dependency:filename=>files.add(path.resolve(filename))});
        ensure(!input.checkpoint && other===undefined && (opt.strict===undefined || opt.strict===true),
          'Use sim preflight <world.json> [--strict]');
        const report = R.storyPreflight(sourceWorld(input),{workerPool});
        const relative = [...files].map(filename=>path.relative(directory,filename).split(path.sep).join('/')).sort();
        respond({...report,inventory:{...report.inventory,files:relative}});
        if (!report.valid||opt.strict&&report.diagnostics.length) process.exitCode = 1;
        break;
      }
      case 'plan': return respond(runtime(load(file)).composition());
      case 'block-play': {
        ensure(typeof file==='string' && typeof opt.samples==='string' && /^\d+$/.test(opt.samples) &&
          (opt.resume===undefined||typeof opt.resume==='string') && (opt.seek===undefined||opt.seek===true),
        'Use sim block-play <model.json> --samples N [--resume file.json --checkpoint file.json --seek]');
        const source=embedModels(read(file),file,shot?.dependency);
        const {value:checkpoint,store}=opt.resume===undefined?{}:readCheckpointFile(opt.resume);
        const samples=Number(opt.samples);
        const play=W.blockReview.playback(source,{path:opt.path??'offline',checkpoint,retainEvents:true});
        if (opt.seek||samples<play.cursor()) play.seek(samples);
        else play.process(samples-play.cursor());
        const saved=play.checkpoint(), {storage,save}=saveCheckpoints(store);
        if(opt.checkpoint!==undefined) save('checkpoint',opt.checkpoint,saved);
        return respond({id:saved.identity.id,sample:play.cursor(),capacity:play.capacity,
          outputs:saved.kernel.outputs,pendingEvents:saved.events,...(Object.keys(storage).length&&{storage})});
      }
      case 'model-changes': {
        ensure(typeof file==='string' && (opt.samples===undefined||typeof opt.samples==='string' && /^\d+$/.test(opt.samples)) &&
          (opt.resume===undefined||typeof opt.resume==='string') &&
          (opt.checkpoint===undefined||typeof opt.checkpoint==='string') &&
          (opt.samples!==undefined||opt.resume===undefined&&opt.checkpoint===undefined),
        'Use sim model-changes <plan.json> [--samples N --resume file.json --checkpoint file.json]');
        const source=embedModels(read(file),file,shot?.dependency);
        const {value:checkpoint,store}=opt.resume===undefined?{}:readCheckpointFile(opt.resume);
        const play=W.modelChanges.create(source,{checkpoint});
        if (opt.samples!==undefined) play.process(Number(opt.samples)-play.cursor());
        const {storage,save}=saveCheckpoints(store);
        if (opt.checkpoint!==undefined) save('checkpoint',opt.checkpoint,play.checkpoint());
        return respond({...play.inspect(),...(Object.keys(storage).length&&{storage})});
      }
      case 'block-check': {
        ensure(typeof file==='string' && typeof other==='string' &&
          (opt.candidate===undefined||typeof opt.candidate==='string'),
        'Use sim block-check <model.json> <plan.json> [--candidate trace.json]');
        const source=embedModels(read(file),file,shot?.dependency);
        const {reference,report}=W.blockReview.review(source,read(other),opt.candidate===undefined?undefined:read(opt.candidate));
        if (opt['trace-out']!==undefined) write(opt['trace-out'],reference);
        respond(report);
        if (report.status==='diverged') process.exitCode=2;
        break;
      }
      case 'dependencies': return dependencyReport(file);
      case 'scrub': return scrubSimulation(file);
      case 'take': return captureTake(file);
      case 'regions': return regionUpdate(file);
      case 'regions-apply': return applyRegionUpdate(file,other);
      case 'reset': {
        const input=load(file);
        const recordRun=recordOptions();
        finish(input.log?R.create(input.log.origin.world,{checkpoint:input.log.origin,workerPool,recordRun}):
          runtime(input,false,undefined,recordRun),input.store);
        break;
      }
      case 'replay': {
        const input=load(file);
        ensure(input.log||input.fixture,'Expected a run recording or simulation fixture');
        ensure(opt.observations===undefined,'The replay uses the observation plan saved with the run');
        const options = {profile:!!(opt.profile||opt.assert),workerPool,traceSteps:traceRetention(),recordRun:recordOptions()};
        if(input.fixture){
          ensure(!watching&&other===undefined&&Object.keys(opt).every(key=>['out','json','workers','profile','assert',
            'checkpoint','record','checkpoint-store','trace-steps'].includes(key)),
          'Use sim replay <fixture> [--checkpoint file.json --record file.json --out report.json --workers N]');
          const outputs=[opt.out,opt.checkpoint,opt.record].filter(value=>value!==undefined);
          for (const [i,destination] of outputs.entries())
            checkReportPath([file,...outputs.slice(0,i)],destination,'source files');
          const {run,report}=SimulationFixture.replay(W,input.fixture,options);
          if(report.status==='diverged'){
            respond(report);
            process.exitCode=2;
            break;
          }
          finish(run,undefined,{fixture:report});
          break;
        }
        if (watching) return watchSimulation(input,mode,[file],async (onStart,onTick)=>{
          await R.replayAsync(input.log,{...options,onStart,onTick});
        });
        finish(R.replay(input.log,options),input.store);
        break;
      }
      case 'verify': {
        const {log,fixture}=load(file);
        ensure(log||fixture,'Expected a run recording or simulation fixture');
        if (fixture) {
          ensure(other===undefined&&Object.keys(opt).every(key=>['out','workers','json'].includes(key)),
            'Use sim verify <fixture> [--out report.json --workers N]');
          checkReportPath([file],opt.out,'source files');
        }
        const report=fixture?SimulationFixture.replay(W,fixture,{workerPool}).report:R.verify(log,{workerPool});
        respond(report);
        if(report.status==='diverged')process.exitCode=2;
        break;
      }
      case 'diff': {
        if(opt.first!==undefined)return firstDivergence(file,other);
        const a=getCheckpoint(file), b=getCheckpoint(other);
        if(!opt.field){respond(R.diff(a,b));break;}
        ensure(a.tick===b.tick,'Simulation diff needs matched ticks');
        const queries=[a,b].map(checkpoint=>R.create(checkpoint.world,{checkpoint}).query());
        const spec=opt.spec?read(opt.spec):null;
        const readings=queries.map(query=>spec?query.export(opt.field,spec,args()):query.probe(opt.field,target(opt),args()));
        respond({tick:a.tick,field:opt.field,edits:W.query.keyedChanges(...readings),...(spec?{grid:readings[0].grid}:{})});
        break;
      }
      case 'sweep': {
        const spec=read(other);
        if (W.data.record(spec) && spec.visual !== undefined) {
          const sweeps = require('./visual-sweep.js');
          const directory = sweeps.outputPath(opt, ['workers', 'seed', 'dt', 'actions']);
          const source = path.resolve(file), input = load(source);
          const actions = opt.actions === undefined ? [] : read(opt.actions);
          ensure(Array.isArray(actions) && Array.isArray(spec.actions ?? []), 'Sweep actions need a command list');
          const recipe = { ...spec, actions: [...actions, ...(spec.actions ?? [])] };
          const overrides = {
            ...(opt.dt !== undefined && { dt: Number(opt.dt) }),
            ...(opt.seed !== undefined && { seed: Number(opt.seed) })
          };
          const result = visualSweep(source, recipe, directory, overrides, undefined, input);
          console.log('wrote', result.report, '(' + result.cases + ' cases)');
          return;
        }
        if (W.data.record(spec)) {
          ensure(opt.ticks===undefined&&opt.steps===undefined&&opt.t===undefined,
            'The observation plan sets the sweep sample ticks');
          const input=load(file), world=sourceWorld(input);
          return respond(W.observations.run(input.checkpoint??world,spec,{
            runtime:{workerPool},actions:opt.actions===undefined?[]:read(opt.actions)
          }));
        }
        ensure(Array.isArray(spec) && spec.length>0 && spec.length<=2000,'Expected a bounded sweep list');
        const lookPreview = spec.some(row => row && Object.hasOwn(row, 'look'));
        const input=load(file,{lookPreview});
        ensure(input.world,'Sweep needs a simulation world');
        if (lookPreview) {
          const { report } = require('./look-compare.js').compare(visualSnapshot(input), spec, kit,
            renderOptions({ w: Number(opt.w ?? 720), h: Number(opt.h ?? 475) }), { opt, file: other });
          const { results, ...summary } = report;
          respond({ ...summary, runs: results });
          break;
        }
        const runs=spec.map((row,i)=>{
          let source=input.world;
          if (row.edits || row.seed!==undefined) {
            ensure(!input.checkpoint,'Use scheduled actions to vary a checkpoint branch');
            if (row.edits) source=W.apply(W.manifest(source),row.edits).world;
            if (row.seed!==undefined) source={...source,seed:row.seed};
          }
          const run=runtime({...input,world:source},!!(opt.profile||row.assert));
          run.schedule(row.actions??[]);
          run.advance(row.ticks??to(run),{stopOnOutcome:!!opt.scenario});
          const measurements=(row.probes??[]).map(spec=>({field:spec.field,...run.query().probe(spec.field,spec.at,spec.args)}));
          return {id:row.id??i, ...summary(run,row.assert?assert(run,row.assert):null),measurements};
        });
        respond({runs});
        if (runs.some(row => row.checks?.some(check => !check.pass))) process.exitCode=2;
        break;
      }
      case 'render': {
        const recording=shotReplay?.runtime;
        const input=recording ? null : load(file);
        const beat=opt.beat===undefined?undefined:W.inspectionLinks.parse(opt.beat);
        if(opt.beat!==undefined)ensure(beat&&!beat.projected&&W.committedEvents.eventId(beat.id)&&
          (recording||input.checkpoint)&&['t','ticks','steps','actions'].every(key=>opt[key]===undefined),
          'Render a native beat from a recording or checkpoint without time or action overrides');
        const initial=recording ? R.openRecording(recording,{workerPool,recordRun:recording.evidence?.plan}) : runtime(input);
        const tick=beat?W.committedEvents.tickOf(beat.id):recording?.end.tick??to(initial);
        if(beat)ensure((recording?tick===recording.end.tick:input.log?tick<=input.log.end.tick:tick===initial.view().tick),
          'Beat falls outside the recorded render source');
        const run=recording ? initial : snapshotRun(input,initial,tick);
        ensure(typeof opt.out==='string','Simulation render needs --out image.png');
        const output=path.resolve(opt.out), diagnostics=require('./look-preview.js').preview(opt);
        const suffixes=[...(diagnostics?.suffixes??[]),...(beat?['-beat.json']:[])];
        const beatReport=beat&&output.replace(/\.(?:a?png)$/i,'')+'-beat.json';
        if(beat){
          ensure(/\.png$/i.test(output),'Beat render needs a PNG output');
          checkReportPath([file],output,'render inputs');
          checkReportPath([file,output],beatReport,'render inputs');
        }
        shot?.destination(output,suffixes);
        const atmospherePose=advanceVisual(run,tick);
        const event=beat&&run.committedEvents().find(row=>W.inspectionLinks.identify(row)===opt.beat);
        if(beat)ensure(event,'Beat is absent from the recorded world, branch or tick');
        if (recording) ensure(W.data.equal(run.checkpoint(),recording.end),
          'Shot simulation checkpoint diverged at tick '+recording.end.tick);
        if (shot) {
          shot.seed(run.view().world.seed);
          shot.runtime(run.recording());
        }
        const world=W.visual(kit,run.view(),run.query(),{controls:opt.params===undefined?undefined:parse(opt.params)});
        if (atmospherePose) world.atmospherePose=atmospherePose;
        const studio=require('../index.js');
        const image=studio.render(world,{w:Number(opt.w??720),h:Number(opt.h??475),colored:!!opt.colored,
          ink:inkOption?.(),
          colorCurves:opt['color-curves']==='off'?false:undefined,
          colorLut:require('./lut.js').override(opt.lut),
          paletteConstraints:require('./palette-constraints.js').override(opt['palette-constraints']),
          colorClusters:colorClustersOption?.(),
          water:opt.water==='off'?false:undefined, effectPalettes:effectPalettesOption?.(), stable:stabilityOption?.(), artDirection:artDirectionOption?.(), silhouetteProtection:silhouetteOption?.(),
          horizonBands:horizonOption?.(), skyTransitions:skyTransitionsOption?.(), weatherTracks:weatherTracksOption?.(),
          ...skyOptions?.(), ...cameraOptions?.(), composite:compositeOption?.(),
          atmosphere:opt.atmosphere==='off'?false:undefined, atmosphereEmitters:atmosphereEmittersOption?.(),
          atmosphereDepthBands:depthBandsOption?.(),
          coverageAware:opt['coverage-aware']===undefined?undefined:opt['coverage-aware']!=='off',
          lookMasks:opt['look-masks']==='off'?false:undefined,
          colorStack:require('./color-stack.js').override(opt['color-stack']),t:run.view().time,
          ...diagnostics?.settings,...shotRender});
        fs.mkdirSync(path.dirname(output),{recursive:true});
        require('./png.js').write(output,image.w,image.h,image.rgb);
        diagnostics?.capture(image,1);
        diagnostics?.write(output,{times:[run.view().time]});
        if(event)write(beatReport,{format:'ink-studio/beat-render',version:1,beatId:opt.beat,
          tick,time:run.view().time,event,file:path.basename(output),width:image.w,height:image.h});
        shot?.finish(output,{suffixes});
        break;
      }
      default: throw Error('Use sim model|run|resume|fork|reset|replay|verify|fixture|scrub|take|diff|sweep|render|plan|dependencies|regions|regions-apply');
    }
  }
  function applyEdits(input, edits, { dryRun = false } = {}) {
    const isWorld = Boolean(input.world), retained = input.document?.format === 'ink-studio/authoring';
    const spec = isWorld || retained ? input.world ?? input.document : document(input.document).world;
    const validate = isWorld ? R.validate : retained ? kit.KIT.authoring.data.documentView :
      value => dataScene(input.legacy,value,{installedPacks:true});
    const before = validate(spec);
    const source = isWorld ? before : kit.KIT.procedural.data.freeze(W.data.copy(spec));
    let after;
    const result = W.apply(source,edits,{validate:value=>{after=validate(value);}});
    const looks = require('./look-edits.js');
    if (retained || !looks.touches(source,result.world,result.paths,W.data)) return result;
    function inspect(value) {
      const query = isWorld ? R.create(value,{validated:true}).query() : W.query.fromScene(value.build(value.seed));
      return query.inspectLook({renderer:opt.renderer,definitions:dryRun});
    }
    const report = require('./look.js').assertValid(inspect(after));
    return dryRun ? {...result,lookBindings:looks.impact(inspect(before),report,W.data.equal)} : result;
  }
  function syncPrefab(releaseFile, files) {
    ensure(files.length && (opt['dry-run'] || typeof opt.out === 'string'),
      'Use scene sync-prefab RELEASE SCENE ... with --dry-run or --out NEW_DIRECTORY');
    const source = files.map(file => load(file));
    ensure(source.every(input => input.world), 'Prefab synchronization needs world or checkpoint files');
    const result = W.syncPrefab(source, read(releaseFile));
    if (opt['dry-run'] || !result.report.ok) {
      process.stdout.write(JSON.stringify(result.report, null, opt.json ? 0 : 2) + '\n');
      if (!result.report.ok) process.exitCode = 2;
      return;
    }
    const names = files.map(file => path.basename(file).replace(/\.(js|cjs|json)$/i, '') + '.json');
    ensure(new Set(names).size === names.length, 'Scene basenames must be distinct for batch output');
    const destination = path.resolve(opt.out);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    const staged = fs.mkdtempSync(path.join(path.dirname(destination), '.ink-prefabs-'));
    let reserved = false;
    try {
      result.scenes.forEach(({world, checkpoint}, i) => write(path.join(staged, names[i]), checkpoint ?? world));
      fs.mkdirSync(destination);
      reserved = true;
      fs.renameSync(staged, destination);
      reserved = false;
    } finally {
      fs.rmSync(staged, { recursive: true, force: true });
      if (reserved) {
        try { fs.rmdirSync(destination); } catch (error) {
          if (error.code !== 'ENOTEMPTY') throw error;
        }
      }
    }
    process.stdout.write(JSON.stringify(result.report, null, opt.json ? 0 : 2) + '\n');
  }
  function scene([mode,file,reference,...additional]) {
    if (mode === 'sync-prefab') return syncPrefab(file, reference === undefined ? [] : [reference, ...additional]);
    const input=load(file);
    if(mode==='upgrade'){
      ensure(input.world&&typeof opt.to==='string','Prefab upgrades need a world or checkpoint and --to PREFAB');
      ensure(opt.migration===undefined||typeof opt.migration==='string','Use --migration FILE for the mappings');
      const dryRun=Boolean(opt['dry-run']);
      if(dryRun&&typeof opt.out==='string')
        ensure(![file,opt.migration].some(source=>typeof source==='string'&&path.resolve(source)===path.resolve(opt.out)),
          'The dry-run report needs a separate output path');
      const result=W.upgradePrefab(input.world,reference,opt.to,{
        checkpoint:input.checkpoint,migration:opt.migration===undefined?{}:read(opt.migration)
      });
      if(dryRun)respond(result.report);
      else if(result.report.ok)respond(result.checkpoint??result.world);
      else process.stdout.write(JSON.stringify(result.report,null,opt.json?0:2)+'\n');
      if(!result.report.ok)process.exitCode=2;
      return;
    }
    if (mode==='apply'){
      ensure(input.document || input.world && !input.checkpoint,'Expected a world manifest or JSON scene');
      const dryRun = Boolean(opt['dry-run']);
      if (dryRun && typeof opt.out === 'string')
        ensure(![file,reference].some(input=>typeof input==='string'&&path.resolve(input)===path.resolve(opt.out)),
          'The dry-run report needs a separate output path');
      const { world, paths, lookBindings } = applyEdits(input,read(reference),{dryRun});
      respond(dryRun?{changed:paths,...(lookBindings&&{lookBindings})}:world);
      return;
    }
    if(mode==='promote'){
      ensure(input.checkpoint&&typeof reference==='string','Promote needs a run or checkpoint and a trace name');
      const options=args(), trace=runtime(input).query().trace(reference,target(opt),options);
      ensure(trace.status==='ok',trace.reason??'Trace failed');
      const result=W.history.trail(input.world,opt.as,trace.value,options);
      R.validate(result.world);
      respond(opt['dry-run']?{changed:result.paths}:result.world);
      return;
    }
    ensure(input.world && !input.checkpoint,'Expected a world manifest');
    const world=R.validate(input.world);
    let result;
    if (mode==='capture') result=W.capture(world,reference,opt.as);
    else if (mode==='stamp') result=W.stamp(world,reference,opt.as,opt.args?args():{});
    else if (mode==='remix') result=W.remix(world,reference,opt.as,opt.edits?read(opt.edits):[]);
    else if (mode==='history') result=W.history.generate(world,read(reference));
    else throw Error('Use scene apply|stamp|remix|capture|upgrade|sync-prefab|history|promote');
    R.validate(result.world);
    respond(opt['dry-run']?{changed:result.paths,...(result.events?{events:result.events}:{})}:result.world);
  }
  function inspectData(file, name) {
    const input = load(file);
    const api = kit.KIT.dataInputs;
    const data = input.world ? api.prepare(input.world.dataInputs) : input.document
      ? api.prepare(require('./data-inputs.js').embed(api, input.document.dataInputs, file))
      : build(input.legacy).dataInputs;
    ensure(data?.describe().length, 'This file has no typed data inputs');
    ensure(name || opt.sample === undefined && !opt.rows, 'Select a dataset before requesting rows or a sample');
    if (name === undefined) return respond({ datasets: data.describe() });
    const dataset = data.get(name), time = Number(opt.t ?? 0);
    ensure(opt.t !== true && Number.isFinite(time), 'Data sample time must be finite seconds');
    return respond({ ...dataset.description,
      ...(opt.rows && { rows: dataset.rows, ...(dataset.features && { features: dataset.features }) }),
      ...(opt.sample !== undefined && { sample: dataset.sample(parse(opt.sample), time) }) });
  }
  function execute(command,pos) {
    const [file,name] = pos;
    switch (command) {
      case 'inspect': {
        const query=view(file), where=opt.where?parse(opt.where):undefined;
        if (opt.select !== undefined || opt.targets) {
          ensure(opt.near===undefined && opt.where===undefined,'Use --select by itself');
          respond({targets:query.select(opt.select===undefined?undefined:target(opt))});
          break;
        }
        respond(opt.near?query.spatial({point:numbers(opt.near),radius:Number(opt.radius),where}):query.inspect({where}));
        break;
      }
      case 'probe': {
        ensure(typeof opt.field==='string'||opt.select!==undefined||opt.at!==undefined||opt.entity!==undefined,
          'Use --field to select a query');
        const field=opt.field??(opt.at!==undefined||opt.entity!==undefined?'look/sample':'look/output');
        if(opt.spec!==undefined){
          ensure(field==='world/spatial-batch'&&typeof opt.spec==='string'&&opt.args===undefined&&
            opt.at===undefined&&opt.entity===undefined&&opt.select===undefined&&opt.socket===undefined,
          'Use --field world/spatial-batch --spec file.json with origins in the spec');
          respond(view(file).probe(field,{},read(opt.spec)));
          break;
        }
        if (field === 'look/sample') {
          ensure(opt.socket===undefined && !(opt.select!==undefined && opt.entity!==undefined),
            'Use one render selector with --select or --entity');
          ensure(opt.at===undefined||typeof opt.at==='string'&&opt.at.split(',').every(value=>value.trim()),
            '--at needs three finite comma-separated coordinates');
          const selector=opt.select!==undefined?parse(opt.select):opt.entity!==undefined?{entity:opt.entity}:undefined;
          const options={...args(),...(opt.at!==undefined&&{at:numbers(opt.at)}),
            ...(opt.radius!==undefined&&{radius:opt.radius===true?NaN:Number(opt.radius)})};
          respond(view(file).probe(field,selector,options));
          break;
        }
        const site=['look/output','look/provenance'].includes(field)&&opt.select===undefined&&opt.at===undefined&&opt.entity===undefined?undefined:target(opt);
        respond(view(file).probe(field,site,sampleArgs()));
        break;
      }
      case 'trace':
        ensure(typeof name==='string','Supply a named trace');
        if(opt.beat!==undefined)ensure(name==='world/cause'&&typeof opt.beat==='string'&&opt.args===undefined,
          'Use --beat ID with world/cause by itself');
        respond(view(file).trace(name,target(opt),opt.beat===undefined?args():{beatId:opt.beat}));
        break;
      case 'field': {
        ensure(typeof name==='string'&&typeof opt.spec==='string','Provide a field and --spec file.json');
        const spec=read(opt.spec), sample=sampleArgs();
        if (spec.ticks) {
          const run=runtime(load(file));
          schedule(run);
          ensure(Array.isArray(spec.ticks)&&spec.ticks.length<=10000,'Invalid sample ticks');
          const ticks=spec.ticks.slice().sort((a,b)=>a-b), metadata=fieldMetadata(run.query(),name);
          if (spec.spatial) {
            const samples=[], limit=100000;
            let count=0;
            for(const tick of ticks){
              run.advance(tick);
              const frame=run.query().export(name,spec.spatial,sample);
              count+=frame.samples.length;
              ensure(count<=limit,'Time-series spatial sample budget exceeded');
              samples.push(frame);
            }
            respond({field:name,...metadata,series:samples});
          } else respond({field:name,...metadata,series:ticks.map(tick=>{
            run.advance(tick);
            return {tick,time:run.view().time,...run.query().probe(name,spec.at??target(opt),sample)};
          })});
        } else respond(view(file).export(name,spec,sample));
        break;
      }
      case 'data-inputs': return inspectData(file,name);
      case 'scene': scene(pos); break;
      case 'sim': return sim(pos);
      default: throw Error('Unknown world command');
    }
  }
  function validate(file) {
    if (opt.select !== undefined) {
      const query=view(file), selector=target(opt), targets=query.select(selector);
      ensure(targets.length>0,'No render target matches '+JSON.stringify(selector));
      require('./look.js').assertValid(query.inspectLook({renderer:opt.renderer}));
      respond({valid:true,selector,targets});
      return true;
    }
    if(opt.world){
      const input=load(opt.world);
      ensure(input.world||input.document,'Provide a scene, world or checkpoint with --world');
      const edits=read(file);
      if(opt.kind==='edits') applyEdits(input,edits);
      else if(opt.kind==='actions') runtime(input).schedule(edits);
      else throw Error('Validation with --world needs --kind edits or actions');
      respond({valid:true,kind:opt.kind});
      return true;
    }
    if (!/\.json$/i.test(file??'')) return false;
    const { value:raw }=readCheckpointFile(file);
    if (raw.format==='ink-studio/authoring') {
      kit.KIT.authoring.data.documentView(raw);
      respond({valid:true,format:raw.format});
      return true;
    }
    if (raw.format!==W.format && raw.format!==W.models.format && raw.format!==R.checkpointFormat && raw.format!==R.runFormat) return false;
    const run = raw.format===R.runFormat ? R.replay(raw) :
      raw.format===R.checkpointFormat ? R.create(raw.world,{checkpoint:raw}) : undefined;
    const world = run?.view().world ?? R.validate(document(raw,file).world);
    const visual = world.visual;
    if (opt.renderer || visual?.look || visual?.terrainSurface || visual?.terrainLookAsset ||
        Object.values(world.entities).some(entity=>entity.lookAsset || entity.visual?.lookAsset || entity.visual?.surface)) {
      const query = opt.actions || opt.ticks !== undefined || opt.steps !== undefined || opt.t !== undefined ?
        view(file) : (run ?? R.create(world,{validated:true})).query();
      const report = require('./look.js').assertValid(query.inspectLook({renderer:opt.renderer}));
      if (opt.json) { respond({format:raw.format,...report}); return true; }
    }
    respond({valid:true,format:raw.format});
    return true;
  }
  return {execute,validate,inspectLook,lookSnapshot,environmentSnapshot,inspectTimeline,inspectCameraRig,visualSweep};
};
