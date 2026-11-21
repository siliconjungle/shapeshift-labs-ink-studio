/* A seekable score for both musical synthesis and procedural scene controls. */
(function (P) {
  const T = P.takeTime, H = P.musicHarmony;
  const waveforms = ['sine','triangle','saw','pulse'];
  const clamp = value => Math.min(1, Math.max(0,value));
  const unitPhase = value => value - Math.floor(value);
  const mix = (a,b,u) => a+(b-a)*u;
  const smooth = u => u*u*(3-2*u);
  const finite = (v,lo,hi) => Number.isFinite(v) && v >= lo && v <= hi;
  const isRecord = row => row !== null && typeof row === 'object' &&
    [Object.prototype,null].includes(Object.getPrototypeOf(row));
  const only = (row,keys) => isRecord(row) && Object.keys(row).every(key => keys.includes(key));
  const id = value => typeof value === 'string' && /^[a-z][a-z0-9_-]{0,47}$/i.test(value) &&
    !['constructor','prototype','__proto__'].includes(value);
  const require = (condition,message) => { if (!condition) throw new RangeError(message); };
  const real = value => T.seconds(T.read(value));
  const pair = value => Array.isArray(value) && value.length === 2 && Array.from(value).every(Number.isFinite);
  const wrap = phase => unitPhase(phase);
  const TAU = Math.PI * 2;
  function waveform(type, phase, duty) {
    const at = wrap(phase);
    switch (type) {
      case 'sine': return Math.sin(TAU*at);
      case 'triangle': return 1-4*Math.abs(at-.5);
      case 'saw': return at*2-1;
      case 'pulse': return at < duty ? 1 : -1;
    }
  }

  function rhythm(raw) {
    if (raw === undefined) return null;
    require(only(raw,['length','hits']) && Array.isArray(raw.hits) && raw.hits.length > 0 && raw.hits.length <= 128,
      'A rhythm needs a length and a bounded hit list');
    const length = real(raw.length);
    require(finite(length,.0625,256),'A rhythm length must be .0625 to 256 beats');
    const hits = Array.from(raw.hits,hit => {
      require(only(hit,['beat','duration','level']),'Invalid score hit');
      const beat = real(hit.beat), duration = real(hit.duration), level = hit.level ?? 1;
      require(finite(beat,0,length) && finite(duration,1e-5,length) && beat+duration <= length+1e-10 &&
        finite(level,0,1),'Score hits must fit inside their rhythm');
      return { beat, end: Math.min(length,beat+duration), level };
    }).sort((a,b) => a.beat-b.beat);
    require(hits.every((hit,i) => i === 0 || hit.beat >= hits[i-1].end-1e-10),'Score hits in a voice cannot overlap');
    return { length,hits };
  }

  function voice(raw) {
    require(only(raw,['id','waveform','phase','duty','gain','pan','attack','release','glide','cents','motion','rhythm','partials',
      'sequence','instrument']) &&
      id(raw.id),'A score voice needs a safe ID and named settings');
    const { id: name, waveform: shape = 'sine', phase = 0, duty = .5, gain = .16, pan = 0,
      attack = .025, release = .14, glide = .045, cents = 0, motion = {}, partials = [], instrument = 'tone' } = raw;
    require(waveforms.includes(shape) && finite(phase,-1e6,1e6) && finite(duty,.02,.98) &&
      finite(gain,0,1) && finite(pan,-1,1) && [attack,release,glide].every(v => finite(v,.001,30)) &&
      finite(cents,-1200,1200) && ['tone','kick','snare','hat'].includes(instrument),'Invalid score voice oscillator or envelope');
    require(only(motion,['cyclesPerBar','follow','amplitude']),'Invalid score motion settings');
    const { cyclesPerBar: rate = 1, follow = 'chord', amplitude = 1 } = motion;
    const cyclesPerBar = real(rate);
    require(finite(cyclesPerBar,-256,256) && ['chord','fixed'].includes(follow) && finite(amplitude,0,16),
      'Invalid score motion rate, phase following, or amplitude');
    require(Array.isArray(partials) && partials.length <= 8,'A score voice allows eight extra partials');
    const harmonics = Array.from(partials,part => {
      require(Array.isArray(part) && part.length === 2 && Number.isSafeInteger(part[0]) && finite(part[0],2,32) &&
        finite(part[1],0,1),'A partial needs an integer harmonic and a gain');
      return part.slice();
    });
    const spectrum = new Map();
    for (let n = 1; n <= 6; n++) {
      const weight = shape === 'sine' ? Number(n === 1) : shape === 'triangle' ? (n % 2)/n**2 :
        shape === 'saw' ? 1/n : Math.abs(Math.sin(Math.PI*n*duty))/n;
      if (weight > 1e-6) spectrum.set(n,weight);
    }
    for (const [n,weight] of harmonics) spectrum.set(n,(spectrum.get(n) ?? 0)+weight);
    require(raw.rhythm === undefined || raw.sequence === undefined,'Choose a score rhythm or note sequence');
    return { id: name, shape, phase: wrap(phase), duty, gain, pan, attack, release, glide, instrument,
      cents, cyclesPerBar, follow, amplitude, rhythm: rhythm(raw.rhythm), sequence: noteSequence(raw.sequence),
      harmonics, spectrum:[...spectrum] };
  }

  function noteSequence(raw) {
    if (raw === undefined) return null;
    require(Array.isArray(raw) && raw.length <= 4096,'Score sequences allow up to 4096 notes per voice');
    let last = 0;
    return Array.from(raw,row => {
      require(only(row,['beat','duration','midi','offset','level']) && !(row.midi !== undefined && row.offset !== undefined),
        'A sequence note needs beat, duration, and at most one of MIDI pitch or chord offset');
      const beat = real(row.beat), duration = real(row.duration), level = row.level ?? 1;
      require(finite(beat,0,1e6) && finite(duration,1e-5,1e6) && beat >= last-1e-9 &&
        finite(level,0,1) && (row.offset === undefined || Number.isSafeInteger(row.offset) && finite(row.offset,-127,127)),
        'Score sequence notes must be nonoverlapping, increasing, and bounded');
      last = beat+duration;
      return { beat,end:last,level,midi:row.midi === undefined ? undefined : H.midi(row.midi),offset:row.offset };
    });
  }

  function musicalKey(raw) {
    require(only(raw,['root','mode']),'A score key needs a root and optional mode');
    return { root:H.midi(raw.root), mode:H.scaleSteps(raw.mode) };
  }
  function harmony(raw, voices, defaultTuning, key) {
    require(only(raw,['root','quality','inversion','notes','voicing','leading','tuning','ratios','fade','key','degree','size']),
      'Invalid score harmony');
    const { root, quality: named, inversion = 0, notes, voicing, leading = voicing === undefined,
      tuning = defaultTuning, ratios = {}, fade = .35 } = raw;
    require((notes === undefined || voicing === undefined) && typeof leading === 'boolean' &&
      ['equal','just'].includes(tuning) && finite(fade,0,30) && isRecord(ratios),'Invalid score voicing, tuning or fade');
    const scale = raw.key === undefined ? key : musicalKey(raw.key);
    require(raw.degree !== undefined ? scale && root === undefined && named === undefined :
      raw.key === undefined && raw.size === undefined, 'Scale harmonies need a key and degree');
    const derived = raw.degree === undefined ? null : H.scaleChord(scale.root,scale.mode,raw.degree,raw.size,inversion);
    const start = derived?.root ?? H.midi(root), quality = derived?.quality ?? named ?? 'major';
    const defaults = derived?.notes ?? H.chord(notes !== undefined || voicing !== undefined ? 60 : start,quality,inversion);
    let pitches;
    if (voicing !== undefined) {
      require(isRecord(voicing) && Object.keys(voicing).every(key => voices.some(v => v.id === key)),
        'Voicing keys must name declared score voices');
      pitches = voices.map(v => Object.hasOwn(voicing,v.id) ? voicing[v.id] : null);
    } else if (notes !== undefined) {
      require(Array.isArray(notes) && notes.length <= voices.length,'Too many explicit notes for the voice bank');
      pitches = Array.from(notes);
    } else {
      require(defaults.length <= voices.length,'The chord needs more voices or an explicit voicing');
      pitches = defaults;
    }
    while (pitches.length < voices.length) pitches.push(null);
    const custom = new Map();
    for (const [key,value] of Object.entries(ratios)) {
      const interval = Number(key), amount = real(value);
      require(/^(?:[0-9]|1[01])$/.test(key) && finite(amount,.5,2.5),'Custom tuning ratios need pitch offsets 0–11 and positive ratios');
      custom.set(interval,amount);
    }
    function pitchRatio(pitch) {
      const n = pitch - start, pc = (n%12+12)%12;
      return custom.has(pc) ? custom.get(pc)*2**Math.floor(n/12) : H.ratio(n,tuning,quality);
    }
    return { root: start, tuning, quality, leading, fade, pitchRatio,
      ...(derived && {degree:raw.degree, key:H.pitchName(scale.root)}),
      notes: pitches.map(pitch => pitch === null ? null : H.midi(pitch)) };
  }

  function compileBindings(definition, voices, tracks) {
    require(isRecord(definition) && Object.keys(definition).length <= 128,'Expected a bounded score binding record');
    const global = ['beat','roughness','ratioFit','fifthDistance'];
    const metrics = { signal: [-1,1], phase: [0,1], level: [0,1], rate: [0,1], frequency: [0,1],
      beat: [0,1], roughness:[0,1], ratioFit:[0,1], fifthDistance:[0,6] };
    const color = text => {
      const rgba = DrawingPrimitives.color(text);
      return { source: text.toLowerCase(), lab: ColorSpace.toOKLab(rgba.slice(0,3).map(v => v/255)), alpha: rgba[3] };
    };
    const hex = n => Math.round(n).toString(16).padStart(2,'0');
    const interpolate = (a,b,t) => t <= 0 ? a : t >= 1 ? b :
      { lab:a.lab.map((value,i) => mix(value,b.lab[i],t)), alpha:mix(a.alpha,b.alpha,t) };
    function encode(tint) {
      if (tint.source) return tint.source;
      const rgb = ColorSpace.fromOKLab(tint.lab);
      return '#'+rgb.map(value => hex(value*255)).join('')+(tint.alpha < 255 ? hex(tint.alpha) : '');
    }
    return Object.entries(definition).map(([name,raw]) => {
      require(id(name) && only(raw,['voice','from','domain','range','colors','fallback','scale','rounding','pair']),
        'Invalid score parameter binding');
      const { from = 'signal', voice: key, domain = metrics[from], range, colors, fallback, scale, rounding,
        pair: focus } = raw;
      require(global.includes(from) ? key === undefined : voices.some(v => v.id === key),'Binding must name a score voice');
      require(focus === undefined || ['roughness','ratioFit'].includes(from) && Array.isArray(focus) &&
        focus.length === 2 && focus[0] !== focus[1] && Array.from(focus).every(name=>voices.some(voice=>voice.id===name)),
        'A pair binding needs two different score voices and roughness or ratio fit');
      if (from === 'pitch') {
        require(isRecord(colors) && Object.keys(colors).length <= 12 && domain === undefined && range === undefined &&
          scale === undefined && rounding === undefined,
          'Pitch color bindings need a pitch-class color map');
        const palette = new Map();
        for (const [label,tint] of Object.entries(colors)) {
          const pc = H.pitchClass(label);
          require(!palette.has(pc),'Duplicate enharmonic pitch-color entry');
          palette.set(pc,color(tint));
        }
        const rest = color(fallback ?? '#000000');
        const pick = note => note === null ? rest : (palette.get(H.pitchClass(note)) ?? rest);
        const knots = [{ time: 0, fade: 0, from: rest, to: rest }];
        function at(knot,time) {
          const t = knot.fade ? smooth(clamp((time-knot.time)/knot.fade)) : 1;
          return interpolate(knot.from,knot.to,t);
        }
        for (const segment of tracks[voices.findIndex(v => v.id === key)]) {
          const prior = knots.at(-1), to = pick(segment.midi);
          if (to !== prior.to) knots.push({ time: segment.time, fade: segment.fade, from: at(prior,segment.time), to });
        }
        return [name, ({time}) => encode(at(knots[Math.max(0,floorIndex(knots,time))],time))];
      }
      require(Object.hasOwn(metrics,from) && pair(domain) && domain[0] !== domain[1] &&
        Number.isFinite(domain[1]-domain[0]) && fallback === undefined && (scale !== undefined || rounding === undefined) &&
        (colors === undefined ? pair(range) && Number.isFinite(range[1]-range[0]) : range === undefined),
        'A score control needs a metric, domain, and numeric range or color ramp');
      const snap = scale === undefined ? clamp : H.mapScale(scale,rounding);
      const [lower,upper] = range ?? [];
      const [start,end] = domain, pairIds = focus?.slice();
      let output = t => mix(lower,upper,t);
      if (colors !== undefined) {
        require(Array.isArray(colors) && colors.length >= 2 && colors.length <= 24 &&
          Array.from(colors).every((row,i) => Array.isArray(row) && row.length === 2 && finite(row[0],0,1) &&
            (!i || row[0] > colors[i-1][0])) && colors[0][0] === 0 && colors.at(-1)[0] === 1,
          'A color ramp needs increasing stops from 0 through 1');
        const stops = colors.map(([position,tint]) => ({ position,tint:color(tint) }));
        output = t => {
          const index = floorIndex(stops,t,'position'), a = stops[index], b = stops[index+1];
          return encode(b ? interpolate(a.tint,b.tint,(t-a.position)/(b.position-a.position)) : a.tint);
        };
      }
      return [name,frame => {
        const pairSignal = pairIds && frame.analysis.pairs.find(row => pairIds.every(id => row.voices.includes(id)));
        const value = pairIds ? pairSignal?.[from] ?? 0 : from === 'beat' ? frame.beat :
          global.includes(from) ? frame.analysis[from] : frame.voices[key][from];
        return output(snap((value-start)/(end-start)));
      }];
    });
  }

  function atTime(clock, raw) {
    const point = P.musicTiming.isPosition(raw) ? clock.resolve(raw) : T.read(raw);
    return T.seconds(point);
  }
  function floorIndex(rows, value, key = 'time') {
    let low = 0, high = rows.length;
    while (low < high) {
      const i = (low+high) >>> 1;
      if (rows[i][key] <= value) low = i+1;
      else high = i;
    }
    return low-1;
  }
  function ramp(a,b,t,length) {
    return a === b ? b : mix(a,b,clamp(t/length));
  }
  function turns(a,b,t,length) {
    if (a === b || length === 0) return b*t;
    const part = Math.min(t,length);
    return a*part + (b-a)*part*part/(2*length) + b*(t-part);
  }
  function voiceAt(segment, time, output = {}) {
    const elapsed = Math.max(0,time-segment.time);
    output.frequency = ramp(segment.fromHz,segment.hz,elapsed,segment.glide);
    output.phase = wrap(segment.audioPhase+turns(segment.fromHz,segment.hz,elapsed,segment.glide));
    output.level = ramp(segment.fromLevel,segment.level,elapsed,segment.envelope);
    return output;
  }

  function hitWindow(voice, clock, startBeat, endBeat, level) {
    const start = clock.timeAt({ beat: startBeat }), end = clock.timeAt({ beat: endBeat });
    const half = (end-start)/2;
    return { start,end,level, attack: Math.min(half,voice.attack), release: Math.min(half,voice.release) };
  }
  function hitLevel(hit,time) {
    return hit.level * clamp(Math.min((time-hit.start)/hit.attack,(hit.end-time)/hit.release));
  }

  function analyze(frame, voices) {
    const active = voices.filter(v => v.gain > 0 && v.instrument === 'tone' && frame.voices[v.id].level > 1e-5 &&
      frame.voices[v.id].frequency > 0);
    const spectra = active.map(v => {
      const { frequency,level } = frame.voices[v.id];
      return v.spectrum.map(([order,amp]) => [order*frequency,amp*level*v.gain]).filter(([hz]) => hz <= 20000);
    });
    const pairs = [];
    for (let a = 0; a < active.length; a++) for (let b = a+1; b < active.length; b++) {
      const aId = active[a].id, bId = active[b].id, x = frame.voices[aId], y = frame.voices[bId];
      const motion = Math.min(Math.abs(x.rate),Math.abs(y.rate)) >= 1e-6 ?
        H.interval(Math.abs(x.rate),Math.abs(y.rate)) : null;
      const interval = H.interval(x.frequency,y.frequency);
      pairs.push({ voices:[aId,bId], ...interval, ratioFit:clamp(1-Math.abs(interval.cents)/30),
        roughness:H.roughness([spectra[a],spectra[b]]), motionPeriodBars:motion?.period ?? null });
    }
    return { roughness:H.roughness(spectra), fifthDistance:frame.chord?.travel.distance ?? 0,
      ratioFit: pairs.length ? pairs.reduce((sum,row) => sum+row.ratioFit,0)/pairs.length : 0, pairs };
  }

  function compile(definition, { requests = [] } = {}) {
    require(only(definition,['tempoMap','voices','harmonies','changes','duration','tuning','referenceHz',
      'retainPitch','retainMotion','bindings','endFade','key']),
      'Expected a procedural score');
    const { tempoMap = {}, duration, voices: bank, harmonies, changes, tuning = 'equal', referenceHz = 440,
      retainPitch = true, retainMotion = true, bindings = {}, endFade = .09 } = definition;
    const clock = P.musicTiming.compile(tempoMap), beatsPerBar = tempoMap.beatsPerBar ?? 4,
      barsPerPhrase = tempoMap.barsPerPhrase ?? 4;
    const end = atTime(clock,duration);
    require(finite(end,1e-5,3600) && finite(referenceHz,100,1000) && finite(endFade,0,30) &&
      typeof retainPitch === 'boolean' && typeof retainMotion === 'boolean' &&
      ['equal','just'].includes(tuning),'Invalid score duration, tuning, or end fade');
    require(Array.isArray(bank) && bank.length > 0 && bank.length <= 8,'A score needs one to eight voices');
    const voices = Array.from(bank,voice);
    require(new Set(voices.map(v => v.id)).size === voices.length,'Duplicate score voice ID');
    require(isRecord(harmonies) && Object.keys(harmonies).length <= 256 && Object.keys(harmonies).every(id),
      'Expected a bounded named harmony table');
    const key = definition.key === undefined ? undefined : musicalKey(definition.key);
    const chords = new Map(Object.entries(harmonies).map(([name,raw]) => [name,harmony(raw,voices,tuning,key)]));
    require(chords.size > 0,'A score needs at least one harmony');
    require(Array.isArray(changes) && changes.length <= 1024 && Array.isArray(requests) && requests.length <= 1024,
      'Score changes and requests must be bounded arrays');
    const grids = { 'half-beat': .5, beat: 1, 'half-bar': beatsPerBar/2, bar: beatsPerBar, phrase: beatsPerBar*barsPerPhrase };
    function schedule(raw) {
      require(only(raw,['time','harmony','quantize']) && chords.has(raw.harmony),'Unknown or invalid score harmony request');
      const { harmony: name, quantize = 'bar' } = raw, source = atTime(clock,raw.time);
      require(finite(source,0,3600) && (quantize === 'none' || Object.hasOwn(grids,quantize)), 'Invalid score request timing');
      const beat = (P.musicTiming.isPosition(raw.time) ? clock.forPosition(raw.time) : clock.sample(raw.time)).beat;
      if (quantize === 'none') return { harmony: name, time: source, beat };
      const grid = grids[quantize];
      const boundary = Math.max(0,(Math.floor((beat+1e-9)/grid)+1)*grid);
      return { harmony: name, time: clock.timeAt({ beat: boundary }), beat: boundary };
    }
    const rows = Array.from(changes,(change,index) => {
      require(only(change,['id','time','harmony']) && chords.has(change.harmony) &&
        (change.id === undefined || id(change.id)), 'Invalid authored chord event');
      const when = atTime(clock,change.time);
      require(finite(when,0,end) && when < end,'Authored chords must start before the score end');
      return { id: change.id ?? 'chord-'+index, harmony: change.harmony,
        time: when, beat: (P.musicTiming.isPosition(change.time) ? clock.forPosition(change.time) : clock.sample(change.time)).beat };
    });
    require(new Set(rows.map(row => row.id)).size === rows.length && new Set(rows.map(row => row.time)).size === rows.length,
      'Duplicate chord event ID or time');
    for (const [i,request] of Array.from(requests).entries()) {
      const row = schedule(request);
      if (row.time < end) rows.push({ id: 'request:'+i, ...row });
    }
    const ordered = [...new Map(rows.map(row => [row.time,row])).values()].sort((a,b) => a.time-b.time);
    const initialTrack = v => [{
      time: 0, beat: clock.sample(0).beat, midi: null, fromMidi: null,
      fromHz: 0, hz: 0, fromLevel: 0, level: 0, glide: v.glide, envelope: v.release,
      audioPhase: v.phase, motionPhase: v.phase, rate: v.cyclesPerBar, fade: 0, onset: 0
    }];
    const tracks = voices.map(initialTrack);
    const hzOf = pitch => referenceHz*2**((pitch-69)/12);
    function advanceVoice(track,v,row,form,midi,targetLevel = 1,restart = false) {
      const previous = track.at(-1), same = midi === previous.midi, sample = voiceAt(previous,row.time);
      const pitchRatio = note => form ? form.pitchRatio(note) : H.ratio(note-69,tuning);
      const desired = midi === null ? previous.hz : (form ? hzOf(form.root) : referenceHz)*pitchRatio(midi)*2**(v.cents/1200);
      const hz = same && retainPitch && midi !== null ? previous.hz : desired;
      const targetRate = v.follow === 'chord' && midi !== null ? v.cyclesPerBar*pitchRatio(midi)*2**(v.cents/1200) :
        v.cyclesPerBar;
      const rate = midi === null || same && retainMotion ? previous.rate : targetRate;
      const silent = sample.frequency === 0 || sample.level === 0;
      const level = midi === null ? 0 : targetLevel, elapsed = row.time-previous.time;
      const hit = midi !== null && (restart || previous.midi === null);
      track.push({
        time: row.time, beat: row.beat, midi, fromMidi: same ? midi : previous.midi,
        fromHz: silent ? hz : sample.frequency, hz, audioPhase: sample.phase,
        glide: hz === previous.hz ? Math.max(.001,previous.glide-elapsed) : v.glide,
        fromLevel: hit && v.instrument !== 'tone' ? 0 : sample.level, level,
        envelope: level === previous.level && !hit ? Math.max(.001,previous.envelope-elapsed) : midi === null ? v.release : v.attack,
        motionPhase: wrap(previous.motionPhase + previous.rate*(row.beat-previous.beat)/beatsPerBar),
        rate, fade: same ? 0 : form?.fade ?? 0, onset: hit ? row.time : previous.onset
      });
      return { id:v.id,midi,note:midi === null ? null : H.pitchName(midi),hz:midi === null ? 0 : hz,
        retained:same && midi !== null,rate };
    }
    let started = false;
    const events = ordered.map((row,index) => {
      const form = chords.get(row.harmony);
      const prior = tracks.map(track => track.at(-1));
      const next = started && form.leading ? H.lead(prior.map(v => v.midi),form.notes) : form.notes;
      started = true;
      const assignments = next.map((midi,i) => advanceVoice(tracks[i],voices[i],row,form,midi));
      const priorEvent = ordered[index-1];
      const travel = priorEvent ? H.fifths(chords.get(priorEvent.harmony).root,form.root) : H.fifths(form.root,form.root);
      return { ...row, root: H.pitchName(form.root), quality: form.quality, tuning: form.tuning, travel, voices: assignments,
        ...(form.key !== undefined && { key:form.key, degree:form.degree }) };
    });
    for (const [i,v] of voices.entries()) {
      if (!v.sequence) continue;
      const timeline = events.map(({beat,time}) => ({beat,time}));
      for (const note of v.sequence) for (const beat of [note.beat,note.end]) {
        const time = clock.timeAt({beat});
        if (time >= 0 && time < end) timeline.push({time,beat});
      }
      const performance = initialTrack(v);
      let previousTime = -Infinity, active;
      for (const row of timeline.sort((a,b) => a.time-b.time)) {
        if (row.time-previousTime < 1e-9) continue;
        previousTime = row.time;
        const harmony = events[floorIndex(events,row.time+1e-9)];
        const form = harmony && chords.get(harmony.harmony);
        const note = v.sequence[floorIndex(v.sequence,row.beat+1e-9,'beat')];
        const hold = note && row.beat < note.end-1e-9 ? note : null;
        const pitch = hold ? hold.midi ?? (hold.offset === undefined ? harmony?.voices[i].midi :
          (form?.root ?? key?.root ?? 60)+hold.offset) : null;
        if (pitch != null) H.midi(pitch);
        advanceVoice(performance,v,row,form,pitch ?? null,hold?.level,hold !== active);
        active = hold;
      }
      tracks[i] = performance;
    }
    const routes = compileBindings(bindings,voices,tracks);

    const fadeEnd = time => time < 0 || time >= end ? 0 : endFade === 0 ? 1 : clamp((end-time)/endFade);
    function visualHit(v,time,beat) {
      if (!v.rhythm) return 1;
      if (beat < 0) return 0;
      const { length,hits } = v.rhythm, base = Math.floor(beat/length)*length, local = beat-base;
      const hit = hits[floorIndex(hits,local,'beat')];
      return hit && local < hit.end ? hitLevel(hitWindow(v,clock,base+hit.beat,base+hit.end,hit.level),time) : 0;
    }
    function sampleTiming(timing) {
      const { time,beat } = timing;
      const event = events[floorIndex(events,time)] ?? null;
      const frame = { ...timing, chord: event, voices: Object.fromEntries(voices.map((v,i) => {
        const segment = tracks[i][Math.max(0,floorIndex(tracks[i],time))], state = voiceAt(segment,time);
        const phase = wrap(segment.motionPhase+segment.rate*(beat-segment.beat)/beatsPerBar);
        const level = state.level*fadeEnd(time)*visualHit(v,time,beat);
        return [v.id,{ midi: segment.midi, fromMidi: segment.fromMidi,
          note: segment.midi === null ? null : H.pitchName(segment.midi), frequency: state.frequency,
          audioPhase: state.phase, phase, rate: segment.rate, level,
          signal: waveform(v.shape,phase,v.duty)*level*v.amplitude,
          transition: segment.fade ? smooth(clamp((time-segment.time)/segment.fade)) : 1 }];
      })) };
      frame.analysis = analyze(frame,voices);
      return { ...frame, bindings: Object.fromEntries(routes.map(([name,apply]) => [name,apply(frame)])) };
    }

    function windows(voice,start,stop) {
      if (!voice.rhythm) return null;
      const low = Math.max(0,clock.sample(start).beat), high = clock.sample(stop).beat;
      const { length,hits } = voice.rhythm;
      const first = Math.floor(low/length), last = Math.floor(high/length);
      require((last-first+1)*hits.length <= 32768,'Audio rhythm exceeds its event budget');
      const result = [];
      for (let i = first; i <= last; i++) for (const hit of hits) {
        const window = hitWindow(voice,clock,i*length+hit.beat,i*length+hit.end,hit.level);
        if (window.end > start && window.start < stop) result.push(window);
      }
      return result;
    }
    return Object.freeze({
      duration: end, events: P.data.freeze(events), sample: time => sampleTiming(clock.sample(time)), schedule,
      frame(take) { return sampleTiming(clock.forTake(take)); },
      audio(options) { return P.musicScoreSynth.render({ voices,tracks,end,fadeEnd,voiceAt,windows,hitLevel },options); }
    });
  }
  P.musicScore = Object.freeze({ compile, waveform, harmony: H });
})(KIT.procedural);
