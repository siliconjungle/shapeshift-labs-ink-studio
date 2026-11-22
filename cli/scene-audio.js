/* Resolve authored soundtrack assets and collect voices before rendering WAV stems. */
const fs = require('node:fs');
const path = require('node:path');
const WAV = require('./wav.js');
const { mix } = require('./scene-audio-mix.js');
const { createScenePost, buses, legacy } = require('./scene-audio-post.js');
const { readEditorialProject } = require('./music-editorial.js');
const { readGraphProject } = require('./graph-project.js');
const { readAudioPrint } = require('./audio-print.js');
const { embed } = require('./data-inputs.js');
const Assets = require('./asset-references.js');

const format = 'ink-studio/scene-audio';
const record = value => value && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const fields = (value, keys) => record(value) && Object.keys(value).every(key => keys.includes(key));
const finite = (n, min, max) => Number.isFinite(n) && n >= min && n <= max;
const token = value => typeof value === 'string' && value.trim() && value.length <= 512;
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));

function createSceneAudio(definition, { kit = require('../index.js').load(), resolveAsset, runtime } = {}) {
  if (!fields(definition, ['format', 'version', 'sampleRate', 'gain', 'tracks', 'spatial', 'listener', 'music', 'proceduralScore', 'post']) ||
      definition.format !== format || definition.version !== 1 || typeof resolveAsset !== 'function')
    throw new TypeError('Expected a version 1 scene soundtrack and audio resolver');
  const { KIT: K } = kit, T = K.procedural.takeTime;
  const { sampleRate = 48000, gain = 1, tracks = [], spatial, listener = [0, 0, 0], music, proceduralScore, post: postConfig } = definition;
  if (!Number.isSafeInteger(sampleRate) || !finite(sampleRate, 8000, 192000) || !finite(gain, 0, 16) ||
      !Array.isArray(tracks) || tracks.length > 4096)
    throw new RangeError('Invalid scene soundtrack rate, gain, or track count');
  const post = postConfig===undefined ? null : createScenePost(K.procedural,postConfig,sampleRate);
  const rate = [BigInt(sampleRate), 1n];
  const sampleOf = point => T.index(T.roundDown(T.mul(point, rate)));
  const stamp = value => sampleOf(T.read(value));
  const mixer = spatial === undefined ? null : K.world.spatialAudio.create(spatial);
  const clock = K.timeDomains.take({ sampleRate });
  const bed = Array.from(tracks, row => {
    if (!fields(row, ['asset','time','duration','offset','rate','gain','loop','bus']) || !token(row.asset) ||
        row.bus!==undefined && (!post || !buses.includes(row.bus)) ||
        !finite(row.offset ?? 0, 0, 1e9) || !finite(row.rate ?? 1, .001, 64) || !finite(row.gain ?? 1, 0, 16) ||
        row.loop !== undefined && typeof row.loop !== 'boolean')
      throw new TypeError('Invalid soundtrack placement');
    const time = T.read(row.time ?? 0), duration = row.duration === undefined ? undefined : T.read(row.duration);
    if (T.seconds(time) < 0 || duration && !(T.seconds(duration) > 0))
      throw new RangeError('Soundtrack placements need nonnegative start times and positive durations');
    const { asset, offset, rate, gain, loop, bus } = row;
    return { bus, stem: 'tracks', asset, offset, rate, gain, loop, first: sampleOf(time),
      ...(duration && { end: sampleOf(T.add(time, duration)) }) };
  });
  if (music !== undefined && (!fields(music, ['system','gain','fade','layers','production']) || !token(music.system) ||
      !finite(music.gain ?? 1, 0, 16) || !finite(music.fade ?? .03, 0, 5) ||
      !record(music.layers ?? {}) || Object.values(music.layers ?? {}).some(row =>
        !record(row) || !Object.values(row).every(token))))
    throw new TypeError('Invalid soundtrack music binding');
  const production=music?.production;
  if (production!==undefined && (!fields(production,['sources','timeline','assets','world']) ||
      !record(production.sources) || !record(production.timeline) ||
      !finite(production.timeline.end,.001,300) ||
      production.world!==undefined && !fields(production.world,['rhythms','space']) ||
      !record(production.assets ?? {}) || !Object.values(production.assets ?? {}).every(token)))
    throw new TypeError('An adaptive production needs named sources, an authored timeline, and optional sample assets');
  const captureWorld=production?.world===undefined ? null : K.procedural.musicWorldScore.captureSettings(production.world);
  if (proceduralScore !== undefined && (!fields(proceduralScore,['system','score','gain']) ||
      (proceduralScore.system === undefined) === (proceduralScore.score === undefined) ||
      proceduralScore.system !== undefined && !token(proceduralScore.system) ||
      !finite(proceduralScore.gain ?? 1,0,1)))
    throw new TypeError('A procedural soundtrack needs one inline score or world score system');
  const inline = proceduralScore?.score === undefined ? null : K.music.score.compile(proceduralScore.score);
  const scoreSystem = proceduralScore?.system, synthAsset = Symbol('procedural score'), productionAsset=Symbol('music production');

  function render(sequence, { timeline, runtime: sceneRuntime } = {}, selection, delivery=false) {
    const start = sampleOf(sequence.startPoint), end = sampleOf(sequence.endPoint);
    const postSelected=post && (!selection || selection.kind==='stem' && !legacy.includes(selection.name));
    const mixStart=postSelected ? 0 : start;
    const musicSelected = postSelected || !selection || selection.kind==='stem' && ['mix','music'].includes(selection.name);
    const factory = runtime ?? sceneRuntime;
    const run = mixer || music || scoreSystem || !timeline ? factory?.() : undefined;
    if (music && !run) throw new Error('Adaptive music export needs a native sound world with its score system');
    if (scoreSystem && run?.view().world.systems[scoreSystem]?.kind !== 'procedural-score')
      throw new Error('Procedural score export needs the named procedural-score system');
    timeline ??= run?.timeline;
    const voices = bed.map(voice => ({ ...voice }));
    const cues = timeline?.audioSchedule(clock) ?? [];
    const looping = new Map(), resolved = new Map(), positional = [];
    let next = 0, score = [], knots = 0, generated, produced, entry, worldReport;
    const productionIntents=[], worldEvents=[];
    const cueLimit=musicSelected && captureWorld ?
      Math.max(end,Math.ceil((production.timeline.end+captureWorld.lookAhead)*sampleRate)) : end;
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
    function capture(cue, row, level = 1) {
      if (!musicSelected) return;
      const rule=captureWorld?.cues.get(cue), time=row.first/sampleRate;
      if (!rule || level<=0 || time-rule.attack>=production.timeline.end) return;
      if (worldEvents.length>=8192) throw new RangeError('World score exceeds its cue budget');
      let duration;
      if (rule.duration) {
        const source=resolve(row.asset);
        const available=(source.samples.length/source.channels/source.sampleRate-(row.offset ?? 0))/(row.rate ?? 1);
        duration=Math.max(0,Math.min(available,row.end===undefined ? Infinity : (row.end-row.first)/sampleRate));
        if (!duration) return;
      }
      worldEvents.push({cue,time:{numerator:row.first,denominator:sampleRate},strength:Math.min(1,level),
        ...(duration!==undefined && {duration})});
    }
    function shot(voice, ear, sample, stem) {
      const time = sample + Math.round(voice.delay * sampleRate);
      if (voice.gain<=0) return;
      const row={stem,asset:voice.asset,cue:voice.cue,first:time,offset:voice.offset,rate:voice.rate};
      if (stem!=='music') capture(voice.cue,row,voice.gain);
      if (time<end) push({...row,points:[point(voice,ear,time,true)]});
    }
    function cueFrame(query, sample, nextSample, ear) {
      while (next < cues.length && cues[next].firstSample < nextSample && cues[next].firstSample < cueLimit) {
        const row = cues[next++], { cue, firstSample: first, endSample } = row;
        const configured = mixer?.cue({ query, listener, cue, gain: row.gain, pitch: row.rate });
        if (!configured) {
          const voice={stem:'timeline',asset:cue,first,end:endSample,offset:row.offset,gain:row.gain,rate:row.rate};
          capture(cue,voice,row.gain);
          if (first<end) push(voice);
        } else if (endSample === undefined) {
          shot({ ...configured, offset: row.offset }, ear, first, 'timeline');
        } else {
          const delay = Math.round(configured.delay * sampleRate);
          const voice={stem:'timeline',asset:configured.asset,first:first+delay,end:endSample+delay,
            offset:row.offset,rate:configured.rate,points:[]};
          capture(cue,voice,configured.gain);
          if (voice.first<end) {
            push(voice);
            positional.push({cue,gain:row.gain,pitch:row.rate,voice});
          }
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
            track = push({ stem: 'spatial', asset: voice.asset,
              ...(voice.id.startsWith('emitter:') && {emitter:voice.id.slice('emitter:'.length)}),
              first: sample, end: Number.MAX_SAFE_INTEGER,
              loop: true, offset: voice.offset, rate: voice.rate, points: [] });
            looping.set(voice.id, track);
          }
          append(track.points, point(voice, state.listener, sample));
        }
      }
      for (const voice of state?.cues ?? [])
        shot(voice,state.listener,voice.onset===undefined ? sample : stamp(voice.onset),'spatial');
      for (const event of events) if (musicSelected && music && event.system === music.system) {
        const onset = K.world.timedEvents.timeOf(event) ?? event.time ?? time;
        if (production && (event.kind==='music-transition' || event.kind==='music-cue')) {
          if (onset<production.timeline.end) productionIntents.push({...event,time:onset});
          continue;
        }
        const at = onset === time ? sample : stamp(onset);
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
      const scoreEnd=musicSelected && production && production.timeline.end+(captureWorld?.lookAhead ?? 0);
      const replayEnd=scoreEnd>T.seconds(sequence.endPoint) ? T.read(scoreEnd) : sequence.endPoint;
      const limit = -T.index(T.roundDown(T.div(T.sub(T.read(0), replayEnd), period)));
      if (initial.tick !== 0 || limit > 120000) throw new RangeError('Sound world needs tick zero and a bounded replay range');
      if (musicSelected && music) {
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
    const live = musicSelected && scoreSystem && run.query().probe(scoreSystem+'/schedule');
    if (live && live.status !== 'ok') throw new Error('Procedural score schedule is unavailable');
    const program = live ? K.music.score.compile(live.value.score,{requests:live.value.requests}) : inline;
    if (musicSelected && program) {
      if (end <= mixStart || (end-mixStart)*2 > WAV.maxSamples)
        throw new RangeError('Scene soundtrack exceeds its WAV sample budget');
      generated = program.audio({ sampleRate, start: {numerator:mixStart,denominator:sampleRate},
        end: {numerator:end,denominator:sampleRate}, gain: proceduralScore.gain ?? 1 }).value;
      push({ stem: 'music', asset: synthAsset, first: mixStart, end });
    }
    if (musicSelected && production) {
      const {timeline,sources}=production;
      const initial=timeline.segments?.[timeline.entry];
      if (entry.section!==timeline.entry || !initial)
        throw new RangeError('Production entry must match the adaptive music state');
      const stop=Math.min(end,stamp(timeline.end));
      if (stop>mixStart) {
        const sourcesByName=Object.fromEntries(Object.entries(production.assets ?? {}).map(([key,asset])=>[key,resolve(asset)]));
        const liveLayers=Object.fromEntries(Object.entries(entry.layers ?? {}).filter(([name])=>
          Object.hasOwn(sources[initial.source]?.tracks ?? {},name)));
        const liveTimeline={...timeline,segments:{...timeline.segments,
          [timeline.entry]:{...initial,layers:{...initial.layers,...liveLayers}}}};
        const result=K.music.production.renderTimeline(sources,liveTimeline,productionIntents,sourcesByName,
          {sampleRate,start:{numerator:mixStart,denominator:sampleRate},end:{numerator:stop,denominator:sampleRate},
            ...(captureWorld && {world:{...production.world,events:worldEvents}})});
        produced=result.value;
        worldReport=result.report.world;
        push({stem:'music',asset:productionAsset,first:mixStart,end:stop,gain:music.gain});
      }
    }
    const active=voices.filter(row => row.first < end && (postSelected || !selection ||
      (selection.kind==='stem' ? selection.name==='mix' || row.stem===selection.name :
        row.stem==='spatial' && row[selection.by]===selection.name)));
    if (delivery) return post.prepare(active,resolve,{start,end,gain},true);
    const result=postSelected ? post.render(active,resolve,{start,end,gain},selection) :
      mix(active,resolve,{start,end,sampleRate,gain,capture:selection!==undefined});
    if (selection?.kind==='world' && !result.report.stems.spatial.voices)
      throw new RangeError('No audible world source in the selected capture range');
    if (worldReport) result.report.worldScore=worldReport;
    return result;
  }
  return Object.freeze({
    sampleRate,
    tempoMap: postConfig?.map,
    render: (sequence, options) => render(sequence, options),
    prepareDelivery(sequence, options) {
      if (!post) throw new TypeError('Scene delivery needs post routing to the named roles');
      return render(sequence,options,undefined,true);
    },
    capture(sequence, {source, ...options} = {}) {
      if (!fields(source,['kind','name','by']) || !token(source.name) ||
          !(source.kind==='stem' ? ['mix','music',...legacy,...(post ? buses : [])].includes(source.name) &&
              source.by===undefined : source.kind==='world' && ['emitter','cue'].includes(source.by)))
        throw new TypeError('Select a soundtrack stem, named world emitter, or world cue');
      return render(sequence,options,source);
    }
  });
}

function readSceneAudio(file, { kit = require('../index.js').load(), ...graphOptions } = {}) {
  const source = path.resolve(file), folder = path.dirname(source);
  const { assets = undefined, world, assetRegistry, ...definition } = read(source);
  const api = kit.KIT.authoring.assetReferences, select = Assets.scope(api, source, assetRegistry);
  const assetsByName = assets === undefined && (definition.proceduralScore!==undefined || definition.music?.production) ? {} : assets;
  if (!record(assetsByName) || Object.keys(assetsByName).length > 1024 || !Object.keys(assetsByName).every(token))
    throw new TypeError('Soundtrack needs named audio assets');
  const assetCache = new Map(), graphs = new Map(), prints=new Map(), editorials=new Map();
  const T=kit.KIT.procedural.takeTime;
  let soundWorld, totalSamples = 0;
  if (world !== undefined) {
    if (!token(world)) throw new TypeError('Sound world must be a file path');
    const worldFile = path.resolve(folder, world);
    soundWorld = require('./simulation-model-files.js').embedModels(read(worldFile), worldFile);
    soundWorld = Assets.visual(api, soundWorld, 'world', worldFile);
    if (soundWorld.dataInputs !== undefined)
      soundWorld.dataInputs = embed(kit.KIT.dataInputs, soundWorld.dataInputs, worldFile);
  }
  function printAsset(spec) {
    if (!fields(spec,['print','take']) || !token(spec.print)) throw new TypeError('Invalid soundtrack print reference');
    const file=path.resolve(folder,spec.print);
    if (!prints.has(file)) prints.set(file,readAudioPrint(file,kit));
    return prints.get(file);
  }
  function place(row) {
    if (!record(row) || !['frame','fps','marker'].some(key=>Object.hasOwn(row,key))) return row;
    const {frame,fps,marker,...track}=row;
    if (fps!==undefined && frame===undefined || frame!==undefined &&
        (track.time!==undefined || !Number.isSafeInteger(frame) || frame<0 || fps===undefined))
      throw new TypeError('Place a soundtrack track with time or a frame and fps');
    let time=T.read(track.time ?? 0);
    if (frame!==undefined) {
      const rate=T.read(fps);
      if (!finite(T.seconds(rate),1,1000)) throw new RangeError('Invalid soundtrack picture rate');
      time=T.div(T.read(frame),rate);
    }
    if (marker!==undefined) {
      const spec=Object.hasOwn(assetsByName,track.asset) ? assetsByName[track.asset] : undefined;
      const entry=printAsset(spec).entry(spec.take), mark=entry.print.markers.find(row=>row.id===marker);
      const rate=track.rate ?? 1, offset=track.offset ?? 0;
      if (!mark || !finite(rate,.001,64) || !finite(offset,0,mark.at/entry.sampleRate))
        throw new RangeError('Unknown print marker or a track offset beyond it');
      const markerTime=T.div(T.read(mark.at),T.read(entry.sampleRate));
      time=T.sub(time,T.div(T.sub(markerTime,T.read(offset)),T.read(rate)));
      if (T.seconds(time)<0) throw new RangeError('Print marker would place the track before picture start');
    }
    return {...track,time:{numerator:T.index(time[0]),denominator:T.index(time[1])}};
  }
  function resolveAsset(name) {
    if (assetCache.has(name)) return assetCache.get(name);
    const spec = Object.hasOwn(assetsByName, name) ? assetsByName[name] : undefined;
    let audio;
    if (typeof spec === 'string') audio = WAV.read(path.resolve(folder, spec));
    else if (api.isRef(spec)) audio = WAV.decode(select(spec, Assets.waveKinds).bytes);
    else if (record(spec) && Object.hasOwn(spec,'print')) audio=printAsset(spec).load(spec.take).value;
    else if (fields(spec,['editorial','track']) && token(spec.editorial) && (spec.track===undefined || token(spec.track))) {
      const file=path.resolve(folder,spec.editorial), P=kit.KIT.procedural;
      if (!editorials.has(file)) {
        const project=readEditorialProject(file,P);
        editorials.set(file,P.mediaGraph.audioEditorial.render(project.session,project.assets,{stems:true}));
      }
      const result=editorials.get(file);
      audio=spec.track===undefined ? result.value : Object.hasOwn(result.stems,spec.track) ? result.stems[spec.track] : undefined;
      if (!audio) throw new RangeError('Unknown editorial soundtrack track '+spec.track);
    }
    else if (fields(spec, ['graph','output','time','seed','inputs']) &&
        (token(spec.graph) || api.isRef(spec.graph)) && token(spec.output)) {
      const file = api.isRef(spec.graph) ? select(spec.graph, 'graph').filename : path.resolve(folder, spec.graph);
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
  const tracks=Array.isArray(definition.tracks) ? definition.tracks.map(place) : definition.tracks;
  return createSceneAudio({...definition,...(tracks!==undefined && {tracks})}, { kit, resolveAsset,
    ...(soundWorld && { runtime: () => kit.KIT.world.runtime.create(soundWorld) }) });
}

module.exports = { createSceneAudio, readSceneAudio };
