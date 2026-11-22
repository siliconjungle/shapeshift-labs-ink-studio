/* Drive a native world and a graph from the same take frame. */
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { readGraphProject } = require('./graph-project.js');
const { validateTake, readTakeWorld } = require('./take-document.js');
const { readCheckpoint } = require('./checkpoint-file.js');
const files = require('./asset-files.js');

const checkpointFormat = 'ink-studio/take-checkpoint';
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));

function createTake({ clock: definition = {}, world, graph, simulation } = {}, {
  kit = require('../index.js').load(), checkpoint, maxSeekTicks = 36000, evaluateGraph = true
} = {}) {
  if (!Number.isSafeInteger(maxSeekTicks) || maxSeekTicks < 1 || typeof evaluateGraph !== 'boolean' ||
      graph !== undefined && (typeof graph?.run !== 'function' || typeof graph?.plan !== 'function'))
    throw new TypeError('Expected a compiled take graph and a positive tick budget');
  const { KIT: K } = kit, W = K.world, runtime = W.runtime;
  const settings = K.procedural.data.freeze(K.procedural.data.clone(definition));
  const clock = K.timeDomains.take(settings);
  if (world !== undefined && !W.data.record(world)) throw new TypeError('Expected an Ink Studio world manifest');
  const manifest = world?.format === W.models.format ? W.models.compile(world) : world;
  const source = manifest === undefined ? undefined :
    W.manifest({ ...manifest, dt: manifest.dt ?? clock.dt, takeClock: settings });
  if (source && source.dt !== clock.dt) throw new RangeError('Take simulation rate must match the world timestep');
  if (simulation!==undefined&&!source) throw new TypeError('A simulation policy needs a take world');
  const policy = simulation===undefined ? undefined : K.procedural.data.freeze(K.procedural.data.clone(simulation));
  const transport = policy===undefined ? undefined : W.simulationTransport.compile(policy,clock,settings.cuts);
  const identity = createHash('sha256').update(JSON.stringify([settings, source, graph?.plan().projectHash,
    ...(policy===undefined?[]:[policy])])).digest('hex');
  const restore = saved => runtime.create(saved.world, { checkpoint: saved });
  const loopIn = policy?.loop?.state==='restore' ? policy.loop.from : undefined;
  let run, lastFrame, addressedFrame, position, loopStart;
  if (checkpoint !== undefined) {
    if (checkpoint?.format !== checkpointFormat || checkpoint.version !== 1 || checkpoint.identity !== identity ||
        Boolean(checkpoint.world) !== Boolean(source))
      throw new TypeError('Checkpoint does not match this take');
    const at = clock.at(checkpoint.frame);
    if (source) {
      const expected = transport?.locate(at,checkpoint.simulation?.iteration);
      if (checkpoint.world.tick !== (expected?.tick??at.tick) ||
          !W.data.equal(checkpoint.simulation,expected) ||
          !W.data.equal(checkpoint.world.world?.takeClock, settings) || checkpoint.world.world.dt !== source.dt)
        throw new RangeError('Take checkpoint does not match its simulation tick, position or rate');
      run = restore(checkpoint.world);
      addressedFrame=at.frame;
      position=expected;
      if (addressedFrame===loopIn) loopStart={originFrame:position.originFrame,checkpoint:run.checkpoint()};
    }
  } else if (source) run = runtime.create(source);
  const start = transport ? undefined : run?.checkpoint();

  function seek(index, { inputs, seed, iteration = 0 } = {}) {
    const frame = clock.at(index);
    if (!transport&&iteration!==0) throw new RangeError('Loop iteration needs a take simulation loop');
    const target=transport?.locate(frame,iteration), tick=target?.tick??frame.tick;
    let active = run;
    if (transport) {
      if ((position?.originFrame??0)!==target.originFrame || tick<run.view().tick) {
        active = loopStart?.originFrame===target.originFrame && loopStart.checkpoint.tick<=tick ?
          restore(loopStart.checkpoint) : runtime.create(source);
      }
    } else if (source && tick < run.view().tick) {
      active = start.tick <= tick ? restore(start) : runtime.create(source);
    }
    if (active && tick - active.view().tick > maxSeekTicks)
      throw new RangeError('Take seek exceeds the simulation tick budget');
    const result = evaluateGraph ? graph?.run({ take: frame, ...(inputs !== undefined && { inputs }), ...(seed !== undefined && { seed }) }) : undefined;
    const previous = active?.checkpoint();
    let view, timeline, model;
    try {
      view = active?.advance(tick);
      timeline = active?.timeline?.forTake(frame);
      if (view?.world.simulationModel) model = W.models.sample(active);
    } catch (error) {
      if (active === run && run.view().tick !== previous.tick) run = restore(previous);
      throw error;
    }
    const discontinuity = frame.cut || lastFrame === undefined || !(index === lastFrame || index === lastFrame + 1) ||
      target?.iteration!==position?.iteration;
    lastFrame = addressedFrame = index;
    run = active;
    position=target;
    if (index===loopIn && !loopStart) loopStart={originFrame:target.originFrame,checkpoint:run.checkpoint()};
    return { frame, timeline, world: view, events: target?.preRoll?[]:active?.events, query: active?.query(), graph: result,
      ...(target && {simulation:target}),...(model && {model}),
      render: { take: frame, resetRenderHistory: discontinuity } };
  }
  return Object.freeze({
    clock, seek,
    ...(transport && {next(options) {
      const next = addressedFrame===undefined ? {frame:0,iteration:0} : transport.next(addressedFrame,position?.iteration??0);
      return seek(next.frame,{...options,iteration:next.iteration});
    }}),
    checkpoint() {
      if (lastFrame === undefined) throw new Error('Sample a take frame before saving a checkpoint');
      return { format: checkpointFormat, version: 1, identity, frame: lastFrame, ...(run && { world: run.checkpoint() }),
        ...(position && {simulation:position}) };
    }
  });
}

function readTake(file, { kit = require('../index.js').load(), checkpoint, ...options } = {}) {
  const source = path.resolve(file), root = path.dirname(source), raw = read(source);
  if (raw?.format === 'ink-studio/project-bundle') {
    const bundles = require('./project-bundle.js'), project = bundles.readProjectBundle(source);
    if (project.metadata.kind !== 'take') throw new TypeError('Expected a project bundle with a take entry');
    const result = bundles.mountProject(project, entry => readTake(entry, { kit, checkpoint, ...options }));
    return { ...result, paths: [source] };
  }
  const spec = validateTake(raw), paths = new Set([source]);
  const world = readTakeWorld(source, spec, kit, file => paths.add(file));
  let graph;
  if (spec.graph !== undefined) {
    graph = readGraphProject(path.resolve(root, spec.graph), { kit, ...options });
    for (const file of graph.sourceFiles()) paths.add(file);
  }
  if (checkpoint === undefined && spec.checkpoint !== undefined) {
    const file = path.resolve(root, spec.checkpoint);
    paths.add(file);
    checkpoint = readCheckpoint(file, { onBlock: block => paths.add(block) });
  }
  return { take: createTake({ clock: spec.clock, world, graph, simulation: spec.simulation }, { kit, checkpoint }), paths: [...paths] };
}

function command(pos, opt, settings) {
  if(pos[0]==='map'&&pos.length===2)
    return require('./take-clock-map.js').command(pos[1],opt,settings);
  if(pos[0]==='render-av'&&pos.length===2)
    return require('./audiovisual-take.js').command(pos[1],opt,settings);
  const usage = 'Use take sample <take.json> --frame N [--iteration N --resume checkpoint.json --checkpoint file.json --out report.json]';
  if (pos.length !== 2 || pos[0] !== 'sample' ||
      Object.entries(opt).some(([key, value]) => !['frame', 'iteration', 'resume', 'checkpoint', 'out'].includes(key) ||
        typeof value !== 'string' || !value.trim()) || !/^\d+$/.test(opt.frame ?? '') ||
      opt.iteration!==undefined&&!/^\d+$/.test(opt.iteration)) throw new TypeError(usage);
  const dependencies = [];
  const checkpoint = opt.resume === undefined ? undefined :
    readCheckpoint(opt.resume, { onBlock: block => dependencies.push(block) });
  const { take, paths } = readTake(pos[1], { ...settings, checkpoint });
  if (opt.resume !== undefined) paths.push(path.resolve(opt.resume), ...dependencies);
  const destinations = [opt.checkpoint, opt.out].filter(Boolean).map(file => path.resolve(file));
  const existing = [...paths, ...destinations].map(file => fs.statSync(file, { throwIfNoEntry: false }));
  if (new Set(destinations).size !== destinations.length || destinations.some((file, i) =>
    paths.includes(file) || existing[paths.length + i] && existing.slice(0, paths.length + i).some(other =>
      other?.ino === existing[paths.length + i].ino && other.dev === existing[paths.length + i].dev)))
    throw new Error('Take outputs must use separate files from each other and their sources');
  const sample = take.seek(Number(opt.frame),{iteration:Number(opt.iteration??0)});
  const { frame, timeline, world, events, graph, model, simulation } = sample;
  const report = { format: 'ink-studio/take-frame', version: 1, frame, timeline,
    ...(world && { world: { tick: world.tick, time: simulation ? world.time : frame.simulationTime, events } }),
    ...(graph && { graph: graph.report }), ...(model && {model}), ...(simulation && {simulation}) };
  if (opt.checkpoint !== undefined) files.json(path.resolve(opt.checkpoint), take.checkpoint());
  if (opt.out !== undefined) files.json(path.resolve(opt.out), report);
  else process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  if (graph?.report.passed === false) process.exitCode = 2;
}

module.exports = { createTake, readTake, command };
