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
  const occurrenceOf = event => K.world.timedEvents.timeOf(event) ??
    (['music-transition','music-cue'].includes(event.kind) ? event.time : undefined);
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
  if (music !== undefined && (!fields(music, ['system','gain','fade','layers','layerControls','production']) || !token(music.system) ||
      !finite(music.gain ?? 1, 0, 16) || !finite(music.fade ?? .03, 0, 5) ||
      !record(music.layers ?? {}) || Object.values(music.layers ?? {}).some(row =>
        !record(row) || !Object.values(row).every(token))))
    throw new TypeError('Invalid soundtrack music binding');
  const controls = music?.layerControls ?? {};
  if (!record(controls) || Object.keys(controls).length > 64 || music?.production && Object.keys(controls).length)
    throw new TypeError('Layer controls need named loops in a resource-based adaptive score');
  const layerControls = new Map(Object.entries(controls).map(([name, row]) => {
    if (!token(name) || !fields(row, ['path','range','fallback']) || row.path===undefined ||
        !Object.values(music.layers ?? {}).some(layers => Object.hasOwn(layers,name)))
      throw new TypeError('Layer control needs a score path and a named layer ' + name);
    const {range=[0,1], fallback=0}=row, select=K.world.data.selector(row.path);
    if (!Array.isArray(range) || range.length!==2 || !range.every(Number.isFinite) || range[1]<=range[0] ||
        !Number.isFinite(range[1]-range[0]) || !finite(fallback,0,1))
      throw new TypeError('Invalid gain range or fallback for layer ' + name);
    return [name,{select,range,fallback}];
  }));
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

  function render(sequence, { timeline, runtime: sceneRuntime, recordedThrough, trace = false } = {}, selection, delivery=false) {
    const start = sampleOf(sequence.startPoint), end = sampleOf(sequence.endPoint);
    const postSelected=post && (!selection || selection.kind==='stem' && !legacy.includes(selection.name));
    const mixStart=postSelected ? 0 : start;
    const musicSelected = postSelected || !selection || selection.kind==='stem' && ['mix','music'].includes(selection.name);
    const factory = runtime ?? sceneRuntime;
    const run = mixer || music || scoreSystem || !timeline || recordedThrough!==undefined ? factory?.() : undefined;
    if (music && !run) throw new Error('Adaptive music export needs a native sound world with its score system');
    if (scoreSystem && run?.view().world.systems[scoreSystem]?.kind !== 'procedural-score')
      throw new Error('Procedural score export needs the named procedural-score system');
    timeline ??= run?.timeline;
    const voices = bed.map(voice => ({ ...voice }));
    const cues = timeline?.audioSchedule(clock) ?? [];
    const looping = new Map(), resolved = new Map(), positional = [], following = [];
    const history = trace && { sections: [], cues: [], layers: [] };
    let next = 0, score = [], automated = [], knots = 0, generated, produced, entry, worldReport;
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
    function beat(event) {
      if (!event || !history) return;
      const {world,eventStream} = run.view(), W = K.world;
      const { id, tick, system, kind, branch, causes } = W.committedEvents.read(event,world.id,eventStream);
      const occurrence = occurrenceOf(event);
      const original = occurrence === undefined ? T.mul(T.read(tick),T.period(world.dt,world.takeClock?.simulationRate)) : T.read(occurrence);
      const source = { world:world.id, branch, id, tick, system, kind, timecode:T.pack(original) };
      return { ...source, beatId:W.inspectionLinks.identify(source), causes };
    }
    function shot(voice, ear, sample, stem, source) {
      const time = sample + Math.round(voice.delay * sampleRate);
      let report;
      if (history && source && time < end) {
        report = { source, cue:voice.cue, asset:voice.asset, stem, bus:voice.bus ?? (stem==='music' ? 'music' : 'effects'),
          onsetSample:sample, arrivalSample:time, status:voice.status, position:voice.position, gain:voice.gain };
        if (history.cues.length >= 16384) throw new RangeError('Story audio trace exceeds its cue budget');
        history.cues.push(report);
      }
      if (voice.gain<=0 && !voice.attachment) return;
      const row={stem,bus:voice.bus,asset:voice.asset,cue:voice.cue,first:time,offset:voice.offset,rate:voice.rate};
      if (stem!=='music') capture(voice.cue,row,voice.gain);
      if (time>=end) return;
      const p = point(voice,ear,time,true);
      if (voice.attachment) {
        const audio = resolve(voice.asset);
        const duration = Math.max(0, (audio.samples.length/audio.channels/audio.sampleRate-voice.offset)/voice.rate);
        row.end = time + Math.ceil(duration*sampleRate);
        following.push({ row, attachment:voice.attachment, report });
        if (report) report.attachment = voice.attachment.at;
      }
      push(Object.assign(row,{points:[p]}));
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
          const voice={stem:'timeline',bus:configured.bus,asset:configured.asset,first:first+delay,end:endSample+delay,
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
    function section(row, at, source, offset = 0) {
      const fade = Math.round((music.fade ?? .03) * sampleRate), level = music.gain ?? 1;
      for (const voice of score) voice.end = at + fade;
      automated = [];
      const layers = Object.entries(Object.hasOwn(music.layers ?? {}, row.resource) ? music.layers[row.resource] : {});
      score = [[null,row.resource,1], ...layers.map(([name,asset]) => [name,asset,row.layers[name] ?? 0])]
        .filter(([, , gain]) => gain > 0)
        .map(([name, asset, gain]) => {
          const control = layerControls.get(name);
          const voice = push({ stem:'music', asset, first:at, end:Number.MAX_SAFE_INTEGER, loop:true, offset, gain:gain*level,
            fade, ...(control && {points:[]}) });
          if (control) {
            const report = history && { resource:row.resource, layer:name, firstSample:at, peak:0, samples:[] };
            if (report) history.layers.push(report);
            automated.push({ voice, control, report });
          }
          return voice;
        });
      if (history) history.sections.push({ section:row.to ?? row.section, resource:row.resource, sample:at,
        ...(source && {source}) });
    }
    function updateLayers(query, sample) {
      if (!automated.length) return;
      const state = query.probe(music.system+'/state').value;
      for (const {voice,control,report} of automated) {
        const value = K.world.data.read(state,control.select), [lo,hi] = control.range;
        const gain = Number.isFinite(value) ? Math.min(1,Math.max(0,(value-lo)/(hi-lo))) : control.fallback;
        // A between-tick transition begins at its musical boundary with this tick's known level.
        if (!voice.points.length && voice.first<sample)
          append(voice.points,{sample:voice.first,gain,cutoff:22000,delay:0});
        append(voice.points,{sample,gain,cutoff:22000,delay:0});
        if (report) {
          report.peak = Math.max(report.peak,gain);
          report.lastGain = gain;
          if (!report.samples.length || sample-report.samples.at(-1).sample>=sampleRate/10) report.samples.push({sample,gain});
        }
      }
    }
    function updateFollowing(query, ear, sample) {
      for (let i=following.length-1;i>=0;i--) {
        const { row, attachment, report } = following[i];
        if (sample>=row.end) { following.splice(i,1); continue; }
        if (sample<=row.first) continue;
        const live = mixer.cue({query,listener,...attachment});
        const knot = point(live,ear,sample,true);
        knot.pan ??= row.points.at(-1).pan;
        append(row.points,knot);
        if (report) {
          report.lastPosition = live.position;
          report.lastStatus = live.status;
        }
      }
    }
    function observe(time, sample, nextSample, query, events = []) {
      const state = mixer?.frame({ query, listener, time, events, captureSources:trace });
      const byId = history && state?.cues.length ? new Map(events.map(event=>[event.id,event])) : null;
      cueFrame(query, sample, nextSample, state?.listener);
      if (state) {
        updateFollowing(query,state.listener,sample);
        for (const voice of state.active) {
          let track = looping.get(voice.id);
          if (!track) {
            track = push({ stem:'spatial', bus:voice.bus, asset:voice.asset,
              ...(voice.id.startsWith('emitter:') && {emitter:voice.id.slice('emitter:'.length)}),
              first:sample, end:Number.MAX_SAFE_INTEGER,
              loop:true, offset:voice.offset, rate:voice.rate, points:[] });
            looping.set(voice.id, track);
          }
          append(track.points, point(voice, state.listener, sample));
        }
      }
      for (const voice of state?.cues ?? [])
        shot(voice,state.listener,voice.onset===undefined ? sample : stamp(voice.onset),'spatial',
          beat(byId?.get(voice.sourceEvent)));
      for (const event of events) if (musicSelected && music && event.system === music.system) {
        const onset = K.world.timedEvents.timeOf(event) ?? event.time ?? time;
        const at = onset === time ? sample : stamp(onset);
        if (production && (event.kind==='music-transition' || event.kind==='music-cue')) {
          if (onset<production.timeline.end) {
            productionIntents.push({...event,time:onset});
            if (history && event.kind==='music-transition' && at<end)
              history.sections.push({section:event.to,resource:event.resource,sample:at,source:beat(event)});
          }
          continue;
        }
        if (event.kind === 'music-transition') section(event, at, beat(event));
        if (event.kind === 'music-cue') {
          const addressed = mixer?.cue({ query, listener, cue:event.resource, at:event.emitter, gain:music.gain });
          if (addressed) shot(addressed,state?.listener,at,'music',beat(event));
          else {
            push({stem:'music',asset:event.resource,first:at,gain:music.gain});
            if (history && at<end) history.cues.push({source:beat(event),cue:event.cue,asset:event.resource,stem:'music',bus:'music',
              onsetSample:at,arrivalSample:at,status:'unpositioned',position:null,gain:music.gain ?? 1});
          }
        }
      }
      updateLayers(query,sample);
    }
    if (run && (mixer || music || scoreSystem || recordedThrough!==undefined)) {
      const initial = run.view(), dt = initial.world.dt;
      const period = T.period(dt,initial.world.takeClock?.simulationRate);
      const at = tick => sampleOf(T.mul(T.read(tick), period));
      const scoreEnd=musicSelected && production && production.timeline.end+(captureWorld?.lookAhead ?? 0);
      const replayEnd=scoreEnd>T.seconds(sequence.endPoint) ? T.read(scoreEnd) : sequence.endPoint;
      const requested = -T.index(T.roundDown(T.div(T.sub(T.read(0), replayEnd), period)));
      const limit = recordedThrough===undefined ? requested : Math.min(requested,recordedThrough);
      const first = at(initial.tick);
      if ((initial.tick !== 0 && (recordedThrough===undefined || production)) || start < first || limit-initial.tick > 120000)
        throw new RangeError('Sound world needs a bounded replay window inside the source; production timelines start at tick zero');
      if (musicSelected && music) {
        const state = run.query().probe(music.system + '/state');
        if (state.status !== 'ok') throw new Error('Unknown soundtrack score ' + music.system);
        if (production) {
          entry=state.value;
          if (history) history.sections.push({section:entry.section,resource:entry.resource,sample:first});
        } else {
          const anchor = initial.states[music.system]?.clock?.anchorTime ?? initial.time;
          section(state.value,first,undefined,Math.max(0,initial.time-anchor));
        }
      }
      const originEvents = recordedThrough!==undefined && initial.tick>0 ?
        run.events.filter(event => {
          const onset = occurrenceOf(event);
          return event.kind!=='music-transition' && (onset===undefined || stamp(onset)>=first);
        }) : [];
      observe(initial.time,first,at(initial.tick+1),run.query(),originEvents);
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
    if (history) result.report.storyAudio=history;
    return result;
  }
  return Object.freeze({
    sampleRate,
    asset(name) {
      const audio = resolveAsset(name);
      if (!audio) throw new RangeError('Missing soundtrack asset ' + name);
      return K.procedural.mediaGraph.audio(audio);
    },
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

function readSceneAudio(file, { kit = require('../index.js').load(), onFile = () => {}, recordedOnly = false, additions, ...graphOptions } = {}) {
  const source = path.resolve(file), folder = path.dirname(source);
  const { assets = undefined, world, assetRegistry, ...definition } = read(source);
  onFile(source);
  if (recordedOnly && world!==undefined) throw new TypeError('The recorded run supplies the story soundtrack world');
  const api = kit.KIT.authoring.assetReferences, select = Assets.scope(api, source, assetRegistry, {onFile});
  const assetsByName = assets === undefined && (additions || definition.proceduralScore!==undefined || definition.music?.production) ? {} : assets;
  if (!record(assetsByName) || Object.keys(assetsByName).length > 1024 || !Object.keys(assetsByName).every(token))
    throw new TypeError('Soundtrack needs named audio assets');
  const assetCache = new Map(), graphs = new Map(), prints=new Map(), editorials=new Map();
  const T=kit.KIT.procedural.takeTime;
  let soundWorld, totalSamples = 0;
  if (world !== undefined) {
    if (!token(world)) throw new TypeError('Sound world must be a file path');
    const worldFile = path.resolve(folder, world);
    onFile(worldFile);
    soundWorld = require('./simulation-model-files.js').embedModels(read(worldFile), worldFile, onFile);
    soundWorld = Assets.visual(api, soundWorld, 'world', worldFile, onFile);
    if (soundWorld.dataInputs !== undefined)
      soundWorld.dataInputs = embed(kit.KIT.dataInputs, soundWorld.dataInputs, worldFile);
  }
  function printAsset(spec) {
    if (!fields(spec,['print','take']) || !token(spec.print)) throw new TypeError('Invalid soundtrack print reference');
    const file=path.resolve(folder,spec.print);
    onFile(file);
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
    if (additions?.assets.has(name)) {
      if (Object.hasOwn(assetsByName,name)) throw new TypeError('Soundtrack asset name collides with a handoff asset: '+name);
      return additions.assets.get(name);
    }
    if (assetCache.has(name)) return assetCache.get(name);
    const spec = Object.hasOwn(assetsByName, name) ? assetsByName[name] : undefined;
    let audio;
    if (typeof spec === 'string') {
      const file = path.resolve(folder,spec);
      audio = WAV.read(file);
      onFile(file);
    }
    else if (api.isRef(spec)) audio = WAV.decode(select(spec, Assets.waveKinds).bytes);
    else if (record(spec) && Object.hasOwn(spec,'print')) {
      const print = printAsset(spec), entry = print.entry(spec.take);
      audio = print.load(spec.take).value;
      onFile(path.resolve(folder,path.dirname(spec.print),entry.print.take+'.wav'));
    }
    else if (fields(spec,['editorial','track']) && token(spec.editorial) && (spec.track===undefined || token(spec.track))) {
      const file=path.resolve(folder,spec.editorial), P=kit.KIT.procedural;
      if (!editorials.has(file)) {
        const project=readEditorialProject(file,P);
        onFile(file);
        for (const wav of Object.values(project.paths)) onFile(path.resolve(path.dirname(file),wav));
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
      const graph = graphs.get(file), { outputs, report } = graph.run({ time: spec.time, seed: spec.seed, inputs: spec.inputs });
      for (const input of graph.sourceFiles()) onFile(input);
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
  let tracks=Array.isArray(definition.tracks) ? definition.tracks.map(place) : definition.tracks;
  if (additions) {
    if (tracks!==undefined && !Array.isArray(tracks)) throw new TypeError('Soundtrack tracks need an array');
    tracks=[...(tracks??[]),...additions.tracks];
    definition.post ??= {};
  }
  return createSceneAudio({...definition,...(tracks!==undefined && {tracks})}, { kit, resolveAsset,
    ...(soundWorld && { runtime: () => kit.KIT.world.runtime.create(soundWorld) }) });
}

module.exports = { createSceneAudio, readSceneAudio };
