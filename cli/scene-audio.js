/* Resolve authored soundtrack assets and collect voices before rendering WAV stems. */
const fs = require('node:fs');
const path = require('node:path');
const WAV = require('./wav.js');
const { mix } = require('./scene-audio-mix.js');
const { readGraphProject } = require('./graph-project.js');
const { embed } = require('./data-inputs.js');

const format = 'ink-studio/scene-audio';
const record = value => value && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const fields = (value, keys) => record(value) && Object.keys(value).every(key => keys.includes(key));
const finite = (n, min, max) => Number.isFinite(n) && n >= min && n <= max;
const token = value => typeof value === 'string' && value.trim() && value.length <= 512;
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));

function createSceneAudio(definition, { kit = require('../index.js').load(), resolveAsset, runtime } = {}) {
  if (!fields(definition, ['format', 'version', 'sampleRate', 'gain', 'tracks', 'spatial', 'listener', 'music', 'proceduralScore']) ||
      definition.format !== format || definition.version !== 1 || typeof resolveAsset !== 'function')
    throw new TypeError('Expected a version 1 scene soundtrack and audio resolver');
  const { KIT: K } = kit, T = K.procedural.takeTime;
  const { sampleRate = 48000, gain = 1, tracks = [], spatial, listener = [0, 0, 0], music, proceduralScore } = definition;
  if (!Number.isSafeInteger(sampleRate) || !finite(sampleRate, 8000, 192000) || !finite(gain, 0, 16) ||
      !Array.isArray(tracks) || tracks.length > 4096)
    throw new RangeError('Invalid scene soundtrack rate, gain, or track count');
  const rate = [BigInt(sampleRate), 1n];
  const sampleOf = point => T.index(T.roundDown(T.mul(point, rate)));
  const stamp = value => sampleOf(T.read(value));
  const mixer = spatial === undefined ? null : K.world.spatialAudio.create(spatial);
  const clock = K.timeDomains.take({ sampleRate });
  const bed = Array.from(tracks, row => {
    if (!fields(row, ['asset','time','duration','offset','rate','gain','loop']) || !token(row.asset) ||
        !finite(row.offset ?? 0, 0, 1e9) || !finite(row.rate ?? 1, .001, 64) || !finite(row.gain ?? 1, 0, 16) ||
        row.loop !== undefined && typeof row.loop !== 'boolean')
      throw new TypeError('Invalid soundtrack placement');
    const time = T.read(row.time ?? 0), duration = row.duration === undefined ? undefined : T.read(row.duration);
    if (T.seconds(time) < 0 || duration && !(T.seconds(duration) > 0))
      throw new RangeError('Soundtrack placements need nonnegative start times and positive durations');
    const { asset, offset, rate, gain, loop } = row;
    return { stem: 'tracks', asset, offset, rate, gain, loop, first: sampleOf(time),
      ...(duration && { end: sampleOf(T.add(time, duration)) }) };
  });
  if (music !== undefined && (!fields(music, ['system','gain','fade','layers','production']) || !token(music.system) ||
      !finite(music.gain ?? 1, 0, 16) || !finite(music.fade ?? .03, 0, 5) ||
      !record(music.layers ?? {}) || Object.values(music.layers ?? {}).some(row =>
        !record(row) || !Object.values(row).every(token))))
    throw new TypeError('Invalid soundtrack music binding');
  const production=music?.production;
  if (production!==undefined && (!fields(production,['sources','timeline','assets']) ||
      !record(production.sources) || !record(production.timeline) ||
      !finite(production.timeline.end,.001,300) ||
      !record(production.assets ?? {}) || !Object.values(production.assets ?? {}).every(token)))
    throw new TypeError('An adaptive production needs named sources, an authored timeline, and optional sample assets');
  if (proceduralScore !== undefined && (!fields(proceduralScore,['system','score','gain']) ||
      (proceduralScore.system === undefined) === (proceduralScore.score === undefined) ||
      proceduralScore.system !== undefined && !token(proceduralScore.system) ||
      !finite(proceduralScore.gain ?? 1,0,1)))
    throw new TypeError('A procedural soundtrack needs one inline score or world score system');
  const inline = proceduralScore?.score === undefined ? null : K.music.score.compile(proceduralScore.score);
  const scoreSystem = proceduralScore?.system, synthAsset = Symbol('procedural score'), productionAsset=Symbol('music production');

  function render(sequence, { timeline, runtime: sceneRuntime } = {}) {
    const start = sampleOf(sequence.startPoint), end = sampleOf(sequence.endPoint);
    const factory = runtime ?? sceneRuntime;
    const run = mixer || music || scoreSystem || !timeline ? factory?.() : undefined;
    if (music && !run) throw new Error('Adaptive music export needs a native sound world with its score system');
    if (scoreSystem && run?.view().world.systems[scoreSystem]?.kind !== 'procedural-score')
      throw new Error('Procedural score export needs the named procedural-score system');
    timeline ??= run?.timeline;
    const voices = bed.map(voice => ({ ...voice }));
    const cues = timeline?.audioSchedule(clock) ?? [];
    const looping = new Map(), resolved = new Map(), positional = [];
    let next = 0, score = [], knots = 0, generated, produced, entry;
    const productionIntents=[];
    function resolve(name) {
      if (name === synthAsset) return generated;
      if (name === productionAsset) return produced;
      if (!resolved.has(name)) {
        const asset = resolveAsset(name);
        if (!asset) throw new RangeError('Missing soundtrack asset ' + name);
        resolved.set(name, K.procedural.mediaGraph.audio(asset));
      }
      return resolved.get(name);
    }
    function push(row) {
      if (voices.length >= 16384) throw new RangeError('Scene soundtrack exceeds its voice budget');
      voices.push(row);
      return row;
    }
    function point(voice, ear, sample, delayed = false) {
      const V = K.V;
      const right = ear && V.norm(V.cross(ear.forward, ear.up));
      const at = voice.apparentSource ?? voice.position;
      const pan = right && at ? Math.max(-1, Math.min(1, V.dot(V.norm(V.sub(at, ear.position)), right))) : undefined;
      return { sample, gain: voice.gain, pan, cutoff: voice.cutoff, delay: delayed ? 0 : voice.delay };
    }
    function append(target, row) {
      if (++knots > 200000) throw new RangeError('Scene soundtrack exceeds its spatial automation budget');
      if (target.at(-1)?.sample === row.sample) target.pop();
      target.push(row);
    }
    function shot(voice, ear, sample, stem) {
      const time = sample + Math.round(voice.delay * sampleRate);
      if (voice.gain > 0) push({ stem, asset: voice.asset, first: time, offset: voice.offset, rate: voice.rate,
        points: [point(voice, ear, time, true)] });
    }
    function cueFrame(query, sample, nextSample, ear) {
      while (next < cues.length && cues[next].firstSample < nextSample && cues[next].firstSample < end) {
        const row = cues[next++], { cue, firstSample: first, endSample } = row;
        const configured = mixer?.cue({ query, listener, cue, gain: row.gain, pitch: row.rate });
        if (!configured) {
          push({ stem: 'timeline', asset: cue, first, end: endSample, offset: row.offset,
            gain: row.gain, rate: row.rate });
        } else if (endSample === undefined) {
          shot({ ...configured, offset: row.offset }, ear, first, 'timeline');
        } else {
          const delay = Math.round(configured.delay * sampleRate);
          const voice = push({ stem: 'timeline', asset: configured.asset, first: first + delay, end: endSample + delay,
            offset: row.offset, rate: configured.rate, points: [] });
          positional.push({ cue, gain: row.gain, pitch: row.rate, voice });
        }
      }
      for (let i = positional.length - 1; i >= 0; i--) {
        const { voice, ...parameters } = positional[i];
        if (sample >= voice.end) positional.splice(i, 1);
        else append(voice.points, point(mixer.cue({ query, listener, ...parameters }), ear,
          Math.max(sample, voice.first), true));
      }
    }
    function section(row, at) {
      const fade = Math.round((music.fade ?? .03) * sampleRate), level = music.gain ?? 1;
      for (const voice of score) voice.end = at + fade;
      const layers = Object.entries(Object.hasOwn(music.layers ?? {}, row.resource) ? music.layers[row.resource] : {});
      score = [[row.resource, 1], ...layers.map(([name, asset]) => [asset, row.layers[name] ?? 0])]
        .filter(([, gain]) => gain > 0)
        .map(([asset, gain]) => push({ stem: 'music', asset, first: at, end: Number.MAX_SAFE_INTEGER,
          loop: true, gain: gain * level, fade }));
    }
    function observe(time, sample, nextSample, query, events = []) {
      const state = mixer?.frame({ query, listener, time, events });
      cueFrame(query, sample, nextSample, state?.listener);
      if (state) {
        for (const voice of state.active) {
          let track = looping.get(voice.id);
          if (!track) {
            track = push({ stem: 'spatial', asset: voice.asset, first: sample, end: Number.MAX_SAFE_INTEGER,
              loop: true, offset: voice.offset, rate: voice.rate, points: [] });
            looping.set(voice.id, track);
          }
          append(track.points, point(voice, state.listener, sample));
        }
        for (const voice of state.cues) shot(voice, state.listener, sample, 'spatial');
      }
      for (const event of events) if (music && event.system === music.system) {
        if (production && (event.kind==='music-transition' || event.kind==='music-cue')) {
          productionIntents.push({ ...event,time:event.time ?? time });
          continue;
        }
        const at = event.time === time ? sample : stamp(event.time ?? time);
        if (event.kind === 'music-transition') section(event, at);
        if (event.kind === 'music-cue') {
          const addressed = mixer?.cue({ query, listener, cue: event.resource, at: event.emitter, gain: music.gain });
          if (addressed) shot(addressed, state?.listener, at, 'music');
          else push({ stem: 'music', asset: event.resource, first: at, gain: music.gain });
        }
      }
    }
    if (run && (mixer || music || scoreSystem)) {
      const initial = run.view(), dt = initial.world.dt;
      const period = initial.world.takeClock?.simulationRate === undefined ? T.period(dt) :
        T.div(T.read(1), T.read(initial.world.takeClock.simulationRate));
      const at = tick => sampleOf(T.mul(T.read(tick), period));
      const replayEnd=production && production.timeline.end>T.seconds(sequence.endPoint) ?
        T.read(production.timeline.end) : sequence.endPoint;
      const limit = -T.index(T.roundDown(T.div(T.sub(T.read(0), replayEnd), period)));
      if (initial.tick !== 0 || limit > 120000) throw new RangeError('Sound world needs tick zero and a bounded replay range');
      if (music) {
        const state = run.query().probe(music.system + '/state');
        if (state.status !== 'ok') throw new Error('Unknown soundtrack score ' + music.system);
        if (production) entry=state.value;
        else section(state.value, 0);
      }
      observe(0, 0, at(1), run.query());
      run.advance(limit, { onTick(view, query) {
        observe(view.time, at(view.tick), at(view.tick + 1), query, run.events);
      } });
    } else observe(0, 0, end, run?.query());
    const live = scoreSystem && run.query().probe(scoreSystem+'/schedule');
    if (live && live.status !== 'ok') throw new Error('Procedural score schedule is unavailable');
    const program = live ? K.music.score.compile(live.value.score,{requests:live.value.requests}) : inline;
    if (program) {
      if (end <= start || (end-start)*2 > WAV.maxSamples)
        throw new RangeError('Scene soundtrack exceeds its WAV sample budget');
      generated = program.audio({ sampleRate, start: {numerator:start,denominator:sampleRate},
        end: {numerator:end,denominator:sampleRate}, gain: proceduralScore.gain ?? 1 }).value;
      push({ stem: 'music', asset: synthAsset, first: start, end });
    }
    if (production) {
      const {timeline,sources}=production;
      const initial=timeline.segments?.[timeline.entry];
      if (entry.section!==timeline.entry || !initial)
        throw new RangeError('Production entry must match the adaptive music state');
      const stop=Math.min(end,stamp(timeline.end));
      if (stop>start) {
        const sourcesByName=Object.fromEntries(Object.entries(production.assets ?? {}).map(([key,asset])=>[key,resolve(asset)]));
        const liveLayers=Object.fromEntries(Object.entries(entry.layers ?? {}).filter(([name])=>
          Object.hasOwn(sources[initial.source]?.tracks ?? {},name)));
        const liveTimeline={...timeline,segments:{...timeline.segments,
          [timeline.entry]:{...initial,layers:{...initial.layers,...liveLayers}}}};
        produced=K.music.production.renderTimeline(sources,liveTimeline,productionIntents,sourcesByName,
          {sampleRate,start:{numerator:start,denominator:sampleRate},end:{numerator:stop,denominator:sampleRate}}).value;
        push({stem:'music',asset:productionAsset,first:start,end:stop,gain:music.gain});
      }
    }
    return mix(voices.filter(row => row.first < end), resolve, { start, end, sampleRate, gain });
  }
  return Object.freeze({ render });
}

function readSceneAudio(file, { kit = require('../index.js').load(), ...graphOptions } = {}) {
  const source = path.resolve(file), folder = path.dirname(source);
  const { assets = undefined, world, ...definition } = read(source);
  const assetsByName = assets === undefined && (definition.proceduralScore!==undefined || definition.music?.production) ? {} : assets;
  if (!record(assetsByName) || Object.keys(assetsByName).length > 1024 || !Object.keys(assetsByName).every(token))
    throw new TypeError('Soundtrack needs named audio assets');
  const assetCache = new Map(), graphs = new Map();
  let soundWorld, totalSamples = 0;
  if (world !== undefined) {
    if (!token(world)) throw new TypeError('Sound world must be a file path');
    const worldFile = path.resolve(folder, world);
    soundWorld = read(worldFile);
    if (soundWorld.dataInputs !== undefined)
      soundWorld.dataInputs = embed(kit.KIT.dataInputs, soundWorld.dataInputs, worldFile);
  }
  function resolveAsset(name) {
    if (assetCache.has(name)) return assetCache.get(name);
    const spec = Object.hasOwn(assetsByName, name) ? assetsByName[name] : undefined;
    let audio;
    if (typeof spec === 'string') audio = WAV.read(path.resolve(folder, spec));
    else if (fields(spec, ['graph','output','time','seed','inputs']) && token(spec.graph) && token(spec.output)) {
      const file = path.resolve(folder, spec.graph);
      if (!graphs.has(file)) graphs.set(file, readGraphProject(file, { kit, ...graphOptions }));
      const { outputs, report } = graphs.get(file).run({ time: spec.time, seed: spec.seed, inputs: spec.inputs });
      if (!report.passed) throw new Error('Soundtrack graph assertions failed for ' + name);
      if (!Object.hasOwn(outputs, spec.output)) throw new Error('Unknown soundtrack graph output ' + spec.output);
      audio = kit.KIT.procedural.mediaGraph.audio(outputs[spec.output]);
    } else if (spec !== undefined) throw new TypeError('Invalid soundtrack asset ' + name);
    if (audio) {
      totalSamples += audio.samples.length;
      if (totalSamples > WAV.maxSamples) throw new RangeError('Soundtrack assets exceed the audio sample budget');
      assetCache.set(name, audio);
    }
    return audio;
  }
  return createSceneAudio(definition, { kit, resolveAsset,
    ...(soundWorld && { runtime: () => kit.KIT.world.runtime.create(soundWorld) }) });
}

module.exports = { createSceneAudio, readSceneAudio };
