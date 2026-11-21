/* Headless typed ports shared by WAV assets, native audio analysis and event replay. */
(function (P) {
  const A = P.mediaGraph;
  const options = { type: 'record', default: {} };
  function mediaTime(time, take, settings) {
    const local = ['time', 'frame', 'fps', 'origin'].some(key => Object.hasOwn(settings, key));
    return { time, ...(!local && take !== undefined && { take }), ...settings };
  }
  const media = (outputs, sample) => ({ inputs: { source: 'audio', options }, outputs, time: true,
    run({ source, options }, { time, take }) { return sample(source, mediaTime(time, take, options)); }
  });
  const scoreRequests = { type: 'array<record>', default: [] };
  A.operations = Object.freeze({
    'audio.buffer': {
      inputs: { sampleRate: 'number', channels: 'number', samples: 'array<number>' }, outputs: { value: 'audio' },
      run(input) { return { value: A.audio(input) }; }
    },
    'audio.window': media({ value: 'audio', report: 'record' }, A.audioWindow),
    'audio.analyze': media({ value: 'record', rms: 'number', peak: 'number' }, A.analyze),
    'audio.fft': media({ value: 'record', spectrum: 'raster', bands: 'record' }, A.fft),
    'audio.series': {
      inputs: { source: 'audio', options }, outputs: { value: 'array<record>' },
      run({ source, options }) { return { value: A.series(source, options) }; }
    },
    'audio.stemControls': {
      description: 'Drive named controls and replayable triggers from independent audio stems.',
      inputs: { stems: 'record', settings: options, options },
      outputs: { value: 'record', events: 'array<record>', recording: 'record', report: 'record' },
      time: true,
      instantiate() {
        let controls, sources, configuration, rate;
        const run = ({ stems, settings, options }, { time, take }) => {
          if (stems !== sources || settings !== configuration || options.rate !== rate) {
            controls = A.stemControls(stems, settings, options);
            [sources, configuration, rate] = [stems, settings, options.rate];
          }
          return controls.sample(mediaTime(time, take, options));
        };
        run.clear = () => { controls = sources = configuration = rate = undefined; };
        return run;
      }
    },
    'audio.detectTransients': {
      description: 'Detect percussive attacks and write sample-aligned named cues.',
      inputs: { source: 'audio', options }, outputs: { value: 'record', events: 'array<record>', report: 'record' },
      run({ source, options }) { return A.detectTransients(source, options); }
    },
    'audio.editEvents': {
      description: 'Apply cue edits by ID and expose the musical event track, timeline, and replay pulses.',
      inputs: { source: 'record', edits: { type: 'array<record>', default: [] }, options },
      outputs: { value: 'record', events: 'array<record>', timeline: 'record', recording: 'record' },
      run({ source, edits, options }) { return A.editMusicalEvents(source, edits, options); }
    },
    'music.clock': {
      description: 'Sample the beat, bar and phrase on an authored tempo and swing map.',
      inputs: { map: options, options }, outputs: { value: 'record', beat: 'number', bar: 'number', phrase: 'number' },
      time: true,
      instantiate() {
        let clock, previous;
        return ({ map, options }, { time, take }) => {
          if (map !== previous) {
            clock = P.musicTiming.compile(map);
            previous = map;
          }
          const value = take && options.time === undefined ? clock.forTake(take) : clock.sample(options.time ?? time);
          return { value, beat: value.beat, bar: value.bar, phrase: value.phrase };
        };
      }
    },
    'music.resolve': {
      description: 'Convert musical addresses on keyframes, markers or edits to seconds.',
      inputs: { map: options, items: 'array<record>' }, outputs: { value: 'array<record>' },
      run({ map, items }) { return { value: P.musicTiming.resolveItems(P.musicTiming.compile(map), items) }; }
    },
    'music.score': {
      description: 'Read a procedural score at a take boundary and expose its voices, harmony, and scene bindings.',
      inputs: { score: 'record', requests: scoreRequests, options },
      outputs: { value: 'record', bindings: 'record', voices: 'record', events: 'array<record>', analysis:'record', beat: 'number' },
      time: true,
      instantiate() {
        let prior, updates, program;
        return ({ score, requests, options }, { time, take }) => {
          if (score !== prior || requests !== updates) {
            program = P.musicScore.compile(score,{requests});
            prior = score;
            updates = requests;
          }
          const value = take && options.time === undefined ? program.frame(take) : program.sample(options.time ?? time);
          return { value, bindings: value.bindings, voices: value.voices, events: program.events,
            analysis: value.analysis, beat: value.beat };
        };
      }
    },
    'music.scoreAudio': {
      description: 'Synthesize sample-aligned stereo audio and optional voice stems from the procedural score.',
      inputs: { score: 'record', requests: scoreRequests, options },
      outputs: { value: 'audio', stems: 'record', report: 'record' },
      run({ score, requests, options }) { return P.musicScore.compile(score,{requests}).audio(options); }
    },
    'music.motif': {
      description: 'Validate a motif and apply repeat, accent shifts, answers and seeded rhythmic variation.',
      inputs: { source:'record', operations:scoreRequests, options },
      outputs: { value:'record', traits:'record' },
      run({source,operations,options}) {
        const value=P.musicComposer.motif.vary(source,operations,options.seed);
        return {value,traits:P.musicComposer.motif.inspect(value)};
      }
    },
    'music.makeMotif': {
      description: 'Generate a seeded motif from allowed scale degrees, cadence notes, density, and a beat grid.',
      inputs: { options }, outputs: { value:'record', traits:'record' },
      run({options}) {
        const value=P.musicComposer.motif.generate(options);
        return {value,traits:P.musicComposer.motif.inspect(value)};
      }
    },
    'music.makePhrase': {
      description: 'Generate a seeded melodic call, answer and cadence with deliberate gaps and articulation.',
      inputs: { options }, outputs: { value:'record', traits:'record' },
      run({options}) {
        const value=P.musicComposer.makePhrase(options);
        return {value,traits:P.musicComposer.motif.inspect(value)};
      }
    },
    'music.analyzeArrangement': {
      description: 'Measure bar repetition, articulation, gaps, and optional rendered mix and stem dynamics.',
      inputs: { source:'record', options }, outputs: { value:'record', findings:'array<record>' },
      run({source,options}) {
        const value=P.musicComposer.analyze(source,options);
        return {value,findings:value.findings};
      }
    },
    'music.suggest': {
      description: 'Propose editable calls, answers, fills and accents with measured changes and pin awareness.',
      inputs: { source:'record', options },
      outputs: { value:'record', variants:'array<record>', proposals:'array<record>' },
      run({source,options}) {
        const value=P.musicComposer.suggest(source,options);
        return {value,variants:value.variants,proposals:value.proposals};
      }
    },
    'music.arrange': {
      description: 'Build a native score and scene cues from roles, motifs and inheriting sections.',
      inputs: { source:'record' }, outputs: { value:'record', score:'record', cues:'array<record>', report:'record' },
      run({source}) {
        const value=P.musicComposer.compose(source);
        return {value,score:value.score,cues:value.cues,report:value.report};
      }
    },
    'music.revise': {
      description: 'Carry an audition idea into a new arrangement and enforce pinned parts or score bindings.',
      inputs: { source:'record', options }, outputs: { value:'record', score:'record', report:'array<record>' },
      run({source,options}) {
        const {value,report}=P.musicComposer.revise(source,options);
        return {value,score:value.score,report};
      }
    },
    'music.reference': {
      description: 'Recover the editable motif, traits, and timed cues from one part of an auditioned arrangement.',
      inputs: { source:'record', part:'string', section:'string' }, outputs: { value:'record', motif:'record', traits:'record' },
      run({source,part,section}) {
        const value=P.musicComposer.reference(source,{part,section});
        return {value,motif:value.motif,traits:value.traits};
      }
    },
    'music.audition': {
      description: 'Render comparable revisions of an arrangement with reports, source scores, and optional stereo audio.',
      inputs: { source:'record', variants:'array<record>', options },
      outputs: { value:'array<record>', audio:'record', report:'record' },
      run({source,variants,options}) {
        const {takes,report}=P.musicComposer.audition(source,variants,options);
        const audio=Object.fromEntries(takes.filter(take=>take.audio).map(take=>[take.id,take.audio]));
        return {value:takes.map(({audio,...rest})=>rest),audio,report};
      }
    },
    'music.renderProduction': {
      description: 'Render an editable score through sampler and synth patches, groove, track processing and a shared room.',
      inputs:{source:'record',assets:options,options},
      outputs:{value:'audio',stems:'record',report:'record'},
      run({source,assets,options}) {return P.musicProduction.render(source,assets,options);}
    },
    'music.inspectProduction': {
      description: 'Expose performed note times, pitches, articulations and gates for scene bindings.',
      inputs:{source:'record',assets:options},outputs:{value:'record',events:'record'},
      run({source,assets}) {
        const value=P.musicProduction.inspect(source,assets);
        return {value,events:value.events};
      }
    },
    'music.analyzeProduction': {
      description: 'Measure performed accent overlaps, orchestration and harmonic transitions across parts.',
      inputs:{source:'record',assets:options,options},outputs:{value:'record'},
      run({source,assets,options}) {return {value:P.musicProduction.analyze(source,assets,options)};}
    },
    'music.suggestProduction': {
      description: 'Propose coordinated and editable lead, groove or pad alternatives conditioned on the arrangement.',
      inputs:{source:'record',assets:options,options},outputs:{value:'record',variants:'array<record>'},
      run({source,assets,options}) {
        const value=P.musicProduction.suggest(source,options,assets);
        return {value,variants:value.variants.map(row=>row.revision)};
      }
    },
    'music.reviseProduction': {
      description: 'Apply note, instrumentation, mixing and harmony edits with pin checks.',
      inputs:{source:'record',revision:options,assets:options},outputs:{value:'record'},
      run({source,revision,assets}) {return {value:P.musicProduction.revise(source,revision,assets)};}
    },
    'music.auditionProduction': {
      description: 'Render comparable production alternatives with matched loudness and soloable stems.',
      inputs:{source:'record',variants:'array<record>',assets:options,options},
      outputs:{value:'array<record>',audio:'record',stems:'record',report:'record'},
      run({source,variants,assets,options}) {
        const result=P.musicProduction.audition(source,variants,assets,options);
        return {value:result.takes.map(({id,production,report})=>({id,production,report})),
          audio:Object.fromEntries(result.takes.map(take=>[take.id,take.value])),
          stems:Object.fromEntries(result.takes.map(take=>[take.id,take.stems])),report:result.report};
      }
    },
    'music.planPerformances': {
      description: 'Prepare patch-gesture alternatives that retain the score for audition.',
      inputs:{source:'record',takes:'array<record>',assets:options},
      outputs:{value:'record',variants:'array<record>',report:'record'},
      run({source,takes,assets}) {
        const value=P.musicProduction.planPerformances(source,takes,assets);
        return {value,variants:value.variants,report:value.report};
      }
    },
    'music.developThemes': {
      description: 'Place related theme fragments, developments and statements across a production and report their performed events.',
      inputs:{source:'record',plan:'record',assets:options},
      outputs:{value:'record',themeMap:'record',report:'record'},
      run({source,plan,assets}) {
        const {production,themeMap,report}=P.musicProduction.developThemes(source,plan,assets);
        return {value:production,themeMap,report};
      }
    },
    'music.renderTransitions': {
      description: 'Render timed adaptive music intents with entry and exit markers, layered cues, bridges and stingers.',
      inputs:{sources:'record',timeline:'record',intents:scoreRequests,assets:options,options},
      outputs:{value:'audio',stems:'record',report:'record'},
      run({sources,timeline,intents,assets,options}) {
        return P.musicProduction.renderTimeline(sources,timeline,intents,assets,options);
      }
    },
    'music.fifths': {
      description: 'Find the shortest circle-of-fifths route between two pitch classes.',
      inputs: { from: 'string', to: 'string' }, outputs: { value: 'record', path: 'array<string>', distance: 'number' },
      run({ from, to }) {
        const value = P.musicHarmony.fifths(from,to);
        return { value, path: value.path, distance: value.distance };
      }
    },
    'music.scale': {
      description: 'List the notes and semitone steps for a scale or authored mode.',
      inputs: { root: 'any', options }, outputs: { value:'record', notes:'array<number>', steps:'array<number>' },
      run({ root,options }) {
        const value = P.musicHarmony.scale(root,options.mode);
        return { value,notes:value.notes,steps:value.steps };
      }
    },
    'music.scaleChord': {
      description: 'Stack scale thirds at a degree to generate a chord and its voicing.',
      inputs: { root:'any', degree:'number', options }, outputs: { value:'record', notes:'array<number>', root:'number' },
      run({ root,degree,options }) {
        const value = P.musicHarmony.scaleChord(root,options.mode,degree,options.size,options.inversion);
        return { value,notes:value.notes,root:value.root };
      }
    },
    'music.scaleMap': {
      description: 'Snap a normalized scene parameter to the semitone positions of a scale.',
      inputs: { value:'number', options }, outputs: { value:'number' },
      run({ value,options }) { return { value:P.musicHarmony.mapScale(options.mode,options.rounding)(value) }; }
    },
    'music.quantizePitch': {
      description: 'Snap a fractional MIDI pitch into the selected scale while respecting the note range.',
      inputs: { value:'number', root:'any', options }, outputs: { value:'number' },
      run({value,root,options}) { return { value:P.musicHarmony.quantizePitch(value,root,options.mode,options.rounding) }; }
    },
    'music.interval': {
      description: 'Measure a frequency pair against simple ratios and report its phase return and partial beat.',
      inputs: { a:'number', b:'number', options }, outputs: { value:'record', cents:'number', partialBeat:'number', aligned:'boolean' },
      run({a,b,options}) {
        const value = P.musicHarmony.interval(a,b,options);
        return { value,cents:value.cents,partialBeat:value.partialBeat,aligned:value.aligned };
      }
    },
    'music.roughness': {
      description: 'Estimate normalized sensory roughness between weighted partial spectra.',
      inputs: { spectra:'array' }, outputs: { value:'number' },
      run({spectra}) { return {value:P.musicHarmony.roughness(spectra)}; }
    },
    'input.recording': {
      inputs: { initial: options, events: 'array<record>' }, outputs: { value: 'record' },
      run(inputs) { return { value: A.recording(inputs) }; }
    },
    'input.editRecording': {
      description: 'Move, change, delete, or insert timestamped samples in a portable input recording.',
      inputs: { source: 'record', edits: { type: 'array<record>', default: [] } },
      outputs: { value: 'record', events: 'array<record>' },
      run({ source, edits }) {
        const value = A.editRecording(source, edits);
        return { value, events: value.events };
      }
    },
    'input.replay': {
      inputs: { source: 'record', options }, outputs: { value: 'record', events: 'array<record>', pulses: 'array<record>', report: 'record' },
      time: true, instantiate() {
        let prior, replay;
        return ({ source, options }, { time, take }) => {
          if (source !== prior) {
            replay = A.inputReplay(source);
            prior = source;
          }
          return replay.sample(mediaTime(time, take, options));
        };
      }
    },
    'input.actions': {
      inputs: { state: 'record', contexts: 'record', context: 'string' }, outputs: { value: 'record' },
      run({ state, contexts, context }) { return { value: A.actions(state, contexts, context) }; }
    }
  });
  delete P.mediaGraphSupport;
})(KIT.procedural);
