/* Sample authored shutter times without advancing render histories on subframes. */
const { performance } = require('node:perf_hooks');
const Exposure = require('../src/programmable-exposure.js');
const RenderContract = require('../src/render-contract.js');
const TargetSelectors = require('../src/target-selectors.js');
const FrameComposite = require('../src/frame-composite.js');
const { pose } = require('./diarama-pose.js');

const rows = Symbol('shutter row poses');
const passImages = Symbol('integrated shutter passes');
const stride = 16;
const frameLimit = 128;

function timeOptions(options, center, time) {
  const clocks = ['cameraTime', 'skyTime', 'interfaceTime', 'simulationTime'].flatMap(name =>
    options[name] === undefined ? [] : [[name, Math.max(0, options[name] + time - center)]]);
  return { ...options, ...Object.fromEntries(clocks), time, t: time };
}

function subframe(options, source, center) {
  const artHistory = options.artHistory && {
    previous: (time, w, h) => options.artHistory.previous(Math.min(center, time), w, h, source),
    push() {}, clear() {}
  };
  return { ...options, artHistory, renderHistory: undefined, afterimageHistory: undefined,
    volumeHistory: undefined, transparencyHistory: undefined, lookInputSession: undefined,
    passes: false, fragmentProbe: undefined, shotFrame: undefined, cameraFrame: undefined,
    pick: undefined, lookAudit: false, captureMotion: false, captureColorStages: false, captureQuantization: false,
    palettePixel: undefined, paletteUsageSelection: undefined, renderStats: false, scalePreviewFrame: undefined };
}

function readWorlds(source, options, kit, run) {
  const factory = options.shutterWorld;
  if (factory !== undefined && typeof factory !== 'function') throw new TypeError('shutterWorld must sample a world by time');
  if (source.anim?.stateful && !factory) throw new RangeError('Stateful exposure requires a shutterWorld(time) sampler');
  const animated = !factory && typeof source.anim?.update === 'function';
  const keys = ['data', 'rest', 'posedBuf', 'clock', 'clothClock'];
  const saved = animated && keys.map(key => [key, Object.hasOwn(source, key), source[key], source[key]?.slice?.()]);
  const direction = animated && source.anim.motionDirection, hadDirection = animated && Object.hasOwn(source.anim, 'motionDirection');
  let sampled = false;
  function at(time) {
    if (factory) {
      const world = factory(time);
      if (!world || !Number.isSafeInteger(world.count) || world.count < 0 || !world.data || world.data.length < world.count * stride)
        throw new TypeError('shutterWorld must return a sampled, renderable world');
      return world;
    }
    if (animated) {
      sampled = true;
      pose(source, time, { kit, artDirection: options.artDirection });
    }
    return source;
  }
  try {
    return run(at);
  } finally {
    if (sampled) {
      try {
        pose(source, saved.find(([key]) => key === 'clock')[2] ?? 0, { kit, artDirection: options.artDirection });
      } finally {
        for (const [key, present, value, copy] of saved) {
          if (copy && value?.set) value.set(copy);
          if (present) source[key] = value;
          else delete source[key];
        }
        if (hadDirection) source.anim.motionDirection = direction;
        else delete source.anim.motionDirection;
      }
    }
  }
}

function targetRows(world, targets) {
  if (!targets.length) return null;
  const index = TargetSelectors.index(world), resolved = new Map(), bound = new Uint8Array(world.count);
  function match(target) {
    for (let i = targets.length - 1; i >= 0; i--)
      if (TargetSelectors.matches(targets[i].select, target)) return i + 1;
    return 0;
  }
  const active = new Set();
  for (let i = 0; i < bound.length; i++) {
    const target = index.row(i);
    if (!resolved.has(target)) resolved.set(target, match(target));
    const slot = bound[i] = resolved.get(target);
    if (slot) active.add(slot);
  }
  return { bound, active, atlasSlot: placement => match({
    object: placement.objectId, entity: placement.objectId, material: placement.materialId
  }) };
}

function snapshot(world) {
  const { anim, data, rest } = world;
  const rig = anim?.rig;
  return { ...world, data: data.slice(0, world.count * stride), rest: rest?.slice?.(),
    anim: anim && { ...anim, base: anim.base?.slice?.(), bones: anim.bones?.slice?.(),
      rig: rig && { ...rig, M: rig.M?.slice?.(), bid: rig.bid?.slice?.(), free: rig.free?.slice?.() } } };
}

function combine(read, source, times, groups, options, center) {
  const baseTime = times[0];
  if (!groups || times.every(time => time === baseTime)) return read(baseTime);
  const needed = new Set([...groups.active].map(slot => times[slot]).filter(time => time !== baseTime));
  if (source.count * stride * 4 * Math.max(1, needed.size * 2) > 96e6)
    throw new RangeError('Selected shutter poses exceed the 96 MB sample budget');
  const poses = new Map();
  for (const time of needed) poses.set(time, snapshot(read(time)));
  const world = read(baseTime);
  if (source.count !== world.count || [...poses.values()].some(pose => pose.count !== world.count))
    throw new RangeError('Target shutters need stable splat slots across sampled worlds');
  const data = needed.size ? world.data.slice(0, world.count * stride) : world.data;
  const clocks = times.map(time => RenderContract.clock(world, timeOptions(options, center, time)));
  for (let i = 0; i < groups.bound.length; i++) {
    const frame = poses.get(times[groups.bound[i]]);
    if (frame) {
      const start = i * stride;
      data.set(frame.data.subarray(start, start + stride), start);
    }
  }
  const scene = { ...world, data };
  scene[rows] = {
    clock: i => i < groups.bound.length ? clocks[groups.bound[i]] : undefined,
    pose: i => poses.get(times[groups.bound[i]]),
    atlasTime: placement => clocks[groups.atlasSlot(placement)].scene
  };
  return scene;
}

function checkSchedule(plan, schedule) {
  const total = schedule.reduce((sum, band) => sum + band.entries.length, 0);
  plan.remaining ??= frameLimit;
  if (total > plan.remaining) throw new RangeError('Exposure exceeded the 128-subframe budget');
  plan.remaining -= total;
  return total;
}

function integrate(schedule, plan, sample, width, height, channels) {
  const work = schedule.reduce((sum, band) => sum + band.entries.length, 0) * width * height;
  plan.remainingPixels ??= 64e6;
  if (work > plan.remainingPixels) throw new RangeError('Exposure exceeded the 64-million sampled pixel budget');
  plan.remainingPixels -= work;
  const buffer = Exposure.accumulate(width, height, channels, plan);
  for (const { band, entries } of schedule) for (const entry of entries)
    buffer.add(sample(entry.times), band, entry.weight);
  return buffer.finish();
}

function scene(source, options, plan, draw, kit) {
  const start = options.renderStats ? performance.now() : 0;
  const center = options.t ?? source.lookSnapshot?.time ?? source.clock ?? 0;
  const groups = targetRows(source, plan.targets);
  const schedule = Exposure.schedule(plan, [plan.main, ...plan.targets.map(target => target.profile)], center);
  const count = checkSchedule(plan, schedule);
  const raster = kit.KIT.procedural.sceneGraph.rasterFrame;
  const held = schedule.every(band => band.entries.length === 1 && band.entries[0].times.every(time => time === center));
  if (held && source.anim?.stateful && !options.shutterWorld) {
    return { ...draw(source, timeOptions(options, center, center), true), shutter: { samples: 1, bands: plan.rolling.bands } };
  }
  return readWorlds(source, options, kit, read => {
    const nominal = draw(read(center), timeOptions(options, center, center), true);
    if (held)
      return { ...nominal, shutter: { samples: 1, bands: plan.rolling.bands } };
    const captured = raster(nominal), temporary = subframe(options, source, center);
    const image = integrate(schedule, plan, times => times.every(time => time === center) ? captured :
      raster(draw(combine(read, source, times, groups, options, center), timeOptions(temporary, center, times[0]), false)),
      nominal.w, nominal.h, 4);
    const rgb = new Uint8Array(nominal.w * nominal.h * 3), alpha = nominal.alpha && new Uint8Array(nominal.w * nominal.h);
    for (let p = 0; p < nominal.w * nominal.h; p++) {
      rgb.set(image.data.subarray(p * 4, p * 4 + 3), p * 3);
      if (alpha) alpha[p] = image.data[p * 4 + 3];
    }
    if (nominal.renderStats) nominal.renderStats.frameMs = performance.now() - start;
    return { ...nominal, rgb, ...(alpha && { alpha }),
      shutter: { samples: count, bands: plan.rolling.bands, ...(plan.targets.length && { targets: plan.targets.length }) } };
  });
}

function graphBranches(plan, graph, definition) {
  if (!plan?.passes.size) return [];
  const raw = typeof definition.snapshot === 'function' ? definition.snapshot() : definition;
  const nodes = new Map(graph.passes.map(node => [node.id, node]));
  const history = new Set(graph.historyPasses.map(node => node.id));
  const branches = [];
  for (const id of plan.passes.keys())
    if (!raw.passes.some(node => node.id === id)) throw new RangeError('Unknown shutter pass: ' + id);
  for (const { id, enabled } of graph.passes) {
    if (!enabled || !plan.passes.has(id)) continue;
    const profile = plan.passes.get(id);
    const needed = new Set();
    function visit(name) {
      if (name === 'scene' || needed.has(name)) return;
      if (history.has(name)) throw new RangeError('Shutter pass ' + id + ' depends on retained graph history');
      needed.add(name);
      for (const dep of nodes.get(name).dependencies) visit(dep);
    }
    visit(id);
    const kind = nodes.get(id).type === 'mask' ? 'mask' : 'image';
    const passes = raw.passes.filter(node => needed.has(node.id)).map(node => {
      const { input } = nodes.get(node.id);
      return input ? { ...node, input: needed.has(input) ? input : 'scene' } : node;
    });
    branches.push({ id, profile, kind, definition: { ...raw, passes, output: kind === 'mask' ? 'scene' : id } });
  }
  return branches;
}

function graphPasses(source, options, plan, branches, width, height, draw, kit) {
  if (!branches.length) return undefined;
  const center = options.t ?? source.lookSnapshot?.time ?? source.clock ?? 0;
  const outputs = new Map();
  const temporary = subframe(options, source, center);
  const groups = targetRows(source, plan.targets);
  readWorlds(source, options, kit, read => {
    for (const { id, profile, kind, definition } of branches) {
      const schedule = Exposure.schedule(plan, [profile, ...plan.targets.map(target => target.profile)], center);
      checkSchedule(plan, schedule);
      const channels = kind === 'mask' ? 1 : 4;
      const image = integrate(schedule, plan, times => {
        const settings = timeOptions(temporary, center, times[0]);
        return draw(combine(read, source, times, groups, options, center), {
          ...settings, [passImages]: outputs, renderGraph: definition, renderGraphCapture: [id]
        }).renderGraphPasses[id];
      }, width, height, channels);
      const data = channels === 1 ? image.data : FrameComposite.pixels({ w: width, h: height, rgba: image.data }).data;
      outputs.set(id, data);
    }
  });
  return outputs;
}

module.exports = { scene, graphBranches, graphPasses, rows, passImages };
