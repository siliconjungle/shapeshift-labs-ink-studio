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
  const sessionAssets = {type:'record',default:{}};
  A.operations = Object.freeze({
    'audio.buffer': {
      inputs: { sampleRate: 'number', channels: 'number', samples: 'array<number>' }, outputs: { value: 'audio' },
      run(input) { return { value: A.audio(input) }; }
    },
    'audio.captureSample': {
      description: 'Capture an exact sample range from a graph output and attach reusable library metadata.',
      inputs: { source:'audio', settings:'record' }, outputs: { value:'audio', entry:'record' },
      run({ source, settings }) { return A.sampleCatalog.capture(source, settings); }
    },
    'audio.print': {
      description: 'Crop an aligned dry, wet or paired print and emit catalog entries with source markers and provenance.',
      inputs:{sources:'record',settings:'record'},outputs:{audio:'record',entries:'record',report:'record'},
      run({sources,settings},{seed,time}) {return A.audioPrint.prepare(sources,settings,{seed,time});}
    },
    'audio.repairDialogue': {
      description: 'Repair clicks, hum, sibilance and localized spectral noise and audition the removed signal.',
      inputs:{source:'audio',options},outputs:{value:'audio',before:'audio',removed:'audio',report:'record'},
      run({source,options}) {return A.repairDialogue(source,options);}
    },
    'audio.renderMixer': {
      description: 'Render clips through compensated strips, sends, sidechains, and creative inserts such as convolution, granular playback, and freeze.',
      inputs:{source:'record',assets:'record'},outputs:{value:'audio',taps:'record',report:'record'},
      run({source,assets}) {return A.mixer.render(source,assets);}
    },
    'audio.renderRack': {
      description: 'Render a reusable routing rack from named audio inputs and a saved or automated macro state.',
      inputs:{source:'record',sources:'record',state:{type:'record',default:{}},options},
      outputs:{value:'audio',taps:'record',report:'record',state:'record'},
      run({source,sources,state,options}) {return A.audioRack.render(source,sources,state,options);}
    },
    'audio.auditionRack': {
      description: 'Print an aligned, loudness-matched bypass and effects rack with a recalled state.',
      inputs:{source:'record',sources:'record',state:{type:'record',default:{}},options},
      outputs:{value:'audio',bypass:'audio',report:'record',state:'record'},
      run({source,sources,state,options}) {return A.audioRack.audition(source,sources,state,options);}
    },
    'audio.meterMix': {
      description: 'Measure peak, reconstructed true peak, loudness, stereo correlation and mono fold loss.',
      inputs:{source:'audio',options},outputs:{value:'record'},
      run({source,options}) {return {value:A.mixerMonitor.meter(source,options)};}
    },
    'audio.monitorMix': {
      description: 'Audition in stereo, mono or through a small-speaker bandwidth and compare an optional focus stem.',
      inputs:{source:'audio',options,references:{type:'record',default:{}}},outputs:{value:'audio',report:'record'},
      run({source,options,references}) {
        if (Object.keys(references).some(key=>key!=='focus')) throw new RangeError('Unknown monitor reference');
        return A.mixerMonitor.preview(source,options,references.focus);
      }
    },
    'audio.searchSamples': {
      description: 'Filter sample metadata by material, articulation, pitch, duration, provenance and license.',
      inputs: { entries:'array<record>', options }, outputs: { value:'record', items:'array<record>' },
      run({ entries, options }) {
        const value = A.sampleCatalog.create(entries).search(options);
        return { value, items:value.items };
      }
    },
    'audio.proposeSampleSlices': {
      description: 'Detect transient markers and create a nondestructive sample project.',
      inputs: {source:'audio',options}, outputs: {value:'record'},
      run({source,options}) {return {value:A.sampleEdit.create(source,{detect:{},...options})};}
    },
    'audio.editSample': {
      description: 'Move source markers and assemble, trim, reverse, slip and crossfade sample clips.',
      inputs: {source:'record',edits:scoreRequests}, outputs: {value:'record'},
      run({source,edits}) {return {value:A.sampleEdit.edit(source,edits)};}
    },
    'audio.renderSampleEdit': {
      description: 'Render the edited timeline or a source slice with exact frame and join information.',
      inputs: {source:'audio',edit:'record',options}, outputs: {value:'audio',report:'record'},
      run({source,edit,options}) {return A.sampleEdit.render(source,edit,options);}
    },
    'audio.auditionSampleEdit': {
      description: 'Listen around a sample marker or compare a crossfade with its hard cut.',
      inputs: {source:'audio',edit:'record',options}, outputs: {value:'audio',alternatives:'record',report:'record'},
      run({source,edit,options}) {
        const {value,report,hardCut}=A.sampleEdit.audition(source,edit,options);
        return {value,report,alternatives:hardCut ? {hardCut} : {}};
      }
    },
    'audio.spotFoley': {
      description: 'Spot material and action recordings from committed world events, with paired close and distant takes in an editable session.',
      inputs:{source:'record',assets:'record'}, outputs:{value:'record',report:'record'},
      run({source,assets}) {return A.foley.plan(source,assets);}
    },
    'audio.inspectEditorial': {
      description: 'Resolve source sync markers, take ranges and exact picture, world or beat targets.',
      inputs:{source:'record',assets:'record'},outputs:{value:'record'},
      run({source,assets}) {return {value:A.audioEditorial.inspect(source,assets)};}
    },
    'audio.reviseEditorial': {
      description: 'Change source handles, head slips, tail duration, fades, spotting or a time-range comp without altering PCM.',
      inputs:{source:'record',assets:'record',edits:scoreRequests},outputs:{value:'record',report:'record'},
      run({source,assets,edits}) {return A.audioEditorial.revise(source,assets,edits);}
    },
    'audio.renderEditorial': {
      description: 'Print sync-anchored clips and optional stems onto the picture sample grid.',
      inputs:{source:'record',assets:'record',options},outputs:{value:'audio',stems:'record',report:'record'},
      run({source,assets,options}) {return A.audioEditorial.render(source,assets,options);}
    },
    'audio.reconformEditorial': {
      description: 'Compare two picture, world or tempo edits with aligned before and after audio and moved or missing sync points.',
      inputs:{source:'record',assets:'record',revision:'record'},
      outputs:{value:'audio',before:'audio',session:'record',report:'record'},
      run({source,assets,revision}) {return A.audioEditorial.reconform(source,assets,revision);}
    },
    'audio.describeGesture': {
      description:'Analyze a slice for pitch motion, tail texture, transient rate and other searchable acoustic descriptors.',
      inputs:{source:'audio'},outputs:{value:'record'},
      run({source}) {return {value:A.gestureBank.describe(source)};}
    },
    'audio.searchGestures': {
      description:'Rank a sliced corpus by weighted acoustic descriptor targets and authored filters.',
      inputs:{entries:'array<record>',options},outputs:{value:'record',items:'array<record>'},
      run({entries,options}) {
        const value=A.gestureBank.search(entries,options);
        return {value,items:value.items};
      }
    },
    'audio.auditionGestures': {
      description:'Build a sample-addressed listening reel with bounded level matching and peak protection.',
      inputs:{clips:'array<record>',options},outputs:{value:'audio',report:'record'},
      run({clips,options}) {return A.gestureBank.audition(clips,options);}
    },
    'audio.synthesizeGesture': {
      description:'Excite a breath resonator, grainy friction model or inharmonic metal modes and print aligned perspectives.',
      inputs:{options:{type:'record'}},outputs:{value:'audio',perspectives:'record',report:'record'},
      run({options},{seed}) {return A.synthesizeGesture({seed,...options});}
    },
    'audio.shapeInstrumentSample': {
      description:'Shape sample pitch, duration and formants independently while preserving its attack.',
      inputs:{source:'audio',options},outputs:{value:'audio',report:'record'},
      run({source,options}) {return A.shapeInstrumentSample(source,options);}
    },
    'audio.analyzeInstrumentSamples': {
      description:'Propose roots and identify voiced, noisy and transient regions in a take bank.',
      inputs:{assets:'record',options},outputs:{value:'record'},
      run({assets,options}) {return {value:A.sampleInstrument.analyze(assets,options)};}
    },
    'audio.auditionInstrumentRange': {
      description:'Render an aligned range test across named takes and transpositions.',
      inputs:{assets:'record',options},outputs:{value:'audio',report:'record'},
      run({assets,options}) {return A.sampleInstrument.audition(assets,options);}
    },
    'audio.buildSampleInstrument': {
      description:'Bake a labeled key map into a standard Ink sampler patch and playable assets.',
      inputs:{assets:'record',source:'record'},outputs:{value:'record',assets:'record',report:'record'},
      run({assets,source}) {return A.sampleInstrument.build(assets,source);}
    },
    'audio.fitInstrument': {
      description:'Fit editable oscillator, resonator and recorded-attack patches to one recording.',
      inputs:{source:'audio',options},outputs:{value:'record',assets:'record',reference:'audio',report:'record'},
      run({source,options}) {return A.instrumentFit.fit(source,options);}
    },
    'audio.auditionInstrumentFit': {
      description:'Compare fitted or edited instruments over pitch, velocity and gate with a source recording.',
      inputs:{fit:'record',assets:'record',reference:'audio',options},outputs:{value:'audio',report:'record'},
      run({fit,assets,reference,options}) {return A.instrumentFit.audition(fit,assets,options,reference);}
    },
    'music.buildPlayableSound': {
      description:'Build a source-derived bank of recorded, fitted and tail-handoff instrument patches.',
      inputs:{source:'audio',options},outputs:{value:'record',assets:'record',report:'record'},
      run({source,options},{seed}) {return A.playableSound.build(source,{seed,...options});}
    },
    'music.auditionPlayableSound': {
      description:'Play identical diagnostic phrases across builds, keys and dynamics with phase-specific comparisons.',
      inputs:{workshop:'record',assets:'record',options},outputs:{value:'audio',clips:'record',report:'record'},
      run({workshop,assets,options}) {return A.playableSound.audition(workshop,assets,options);}
    },
    'music.keepPlayableSound': {
      description:'Save key and velocity zones with native instruments and project a held source gesture into editable motifs.',
      inputs:{workshop:'record',assets:'record',selection:'record'},
      outputs:{value:'record',patch:'record',motif:'record',assets:'record',reference:'audio',report:'record'},
      run({workshop,assets,selection}) {
        const kept=A.playableSound.keep(workshop,assets,selection);
        return {...kept,patch:kept.value.patch,motif:kept.value.motif};
      }
    },
    'audio.warp': {
      description: 'Fit audio to tempo or sample and picture pins with beat, tonal, speech or varispeed processing.',
      inputs: {source:'audio',options}, outputs: {value:'audio',report:'record'},
      run({source,options}) {return A.warpAudio(source,options);}
    },
    'music.planSampleMotif': {
      description:'Plan raw, playable lead, rhythmic and stretched roles for a recording on one score window.',
      inputs:{source:'audio',score:'audio',options},outputs:{value:'record'},
      run({source,score,options}) {return {value:A.sampleMotif.plan(source,score,options)};}
    },
    'music.renderSampleMotif': {
      description:'Replay an editable sample motif role with a score, isolated stem and playable material.',
      inputs:{source:'audio',score:'audio',plan:'record',role:'string'},
      outputs:{value:'audio',stem:'audio',material:'audio',role:'record',report:'record'},
      run({source,score,plan,role}) {return A.sampleMotif.render(plan,source,score,role);}
    },
    'music.auditionSampleMotif': {
      description:'Hear different musical uses of one recording over the same bars with a shared playback gain.',
      inputs:{source:'audio',score:'audio',plan:'record',options},outputs:{value:'audio',report:'record'},
      run({source,score,plan,options}) {return A.sampleMotif.audition(plan,source,score,options);}
    },
    'music.extractTimbreGesture': {
      description:'Read the pitch contour, attacks, envelope and tail of a recording on its sample grid.',
      inputs:{source:'audio',options},outputs:{value:'record'},
      run({source,options}) {return {value:A.timbreComposition.extract(source,options)};}
    },
    'music.projectTimbreGesture': {
      description:'Project measured contour, attacks and tail to editable motifs with separate expression.',
      inputs:{source:'record',options},outputs:{value:'record'},
      run({source,options}) {return {value:A.timbreComposition.project(source,options)};}
    },
    'music.matchTimbreGesture': {
      description:'Rank materials by their evolving normalized level and brightness across three phases.',
      inputs:{source:'record',candidates:'array<record>',options},outputs:{value:'array<record>'},
      run({source,candidates,options}) {return {value:A.timbreComposition.compare(source,candidates,options)};}
    },
    'music.timbrePalette': {
      description:'Load a seeded coastal, prepared metal and breath, or broken-beat instrument bank.',
      inputs:{name:'string',options},outputs:{value:'record',patches:'record',assets:'record',room:'record'},
      run({name,options}) {
        const {patches,assets,room}=A.timbrePalettes.load(name,options);
        return {value:{id:name,patches,room},patches,assets,room};
      }
    },
    'music.planTimbreOrchestration': {
      description:'Assign a recording’s contour, attacks and tail to normal score takes with reusable materials.',
      inputs:{source:'audio',production:'record',settings:'record',assets:options},
      outputs:{value:'record',variants:'array<record>',assets:'record',report:'record'},
      run({source,production,settings,assets}) {
        const {assets:derived,...value}=A.timbreComposition.plan(source,production,settings,assets);
        return {value,variants:value.variants,assets:{...assets,...derived},report:value.report};
      }
    },
    'music.measureTimbreEvolution': {
      description:'Measure a recording’s shared pitch, level and broadband texture trajectories.',
      inputs:{source:'audio',options},outputs:{value:'record'},
      run({source,options}) {return {value:A.timbreEvolution.analyze(source,options)};}
    },
    'music.planTimbreEvolution': {
      description:'Crossfade a measured attack, body and decay across playable tracks with independent quality transfer.',
      inputs:{profile:'record',production:'record',settings:'record',assets:options},
      outputs:{value:'record',revision:'record',report:'record'},
      run({profile,production,settings,assets}) {return A.timbreEvolution.plan(profile,production,settings,assets);}
    },
    'music.inspectEditSession': {
      description:'Inspect the stable score, audio take and automation addresses in a music edit session.',
      inputs:{source:'record',assets:sessionAssets},outputs:{value:'record'},
      run({source,assets}) {return {value:A.musicSession.create(assets).inspect(source)};}
    },
    'music.editSession': {
      description:'Keep a lane range, pin a performance, or edit a named note, recording or automation knot.',
      inputs:{source:'record',assets:sessionAssets,edits:scoreRequests},outputs:{value:'record'},
      run({source,assets,edits}) {return {value:A.musicSession.create(assets).edit(source,edits)};}
    },
    'music.experimentEditSession': {
      description:'Scout a matrix of sound, phrase and cue edits through a shared session and hear diverse finalists in context.',
      inputs:{source:'record',brief:'record',assets:sessionAssets},outputs:{value:'record',clips:'record'},
      run({source,brief,assets},{host}) {return A.musicSession.create(assets,host).experiment(source,brief);}
    },
    'music.keepSessionExperiment': {
      description:'Recover the editable session for a heard experiment candidate and retain the listening decision.',
      inputs:{source:'record',report:'record',choice:'record',assets:sessionAssets},outputs:{value:'record',decision:'record'},
      run({source,report,choice,assets},{host}) {return A.musicSession.create(assets,host).keepExperiment(source,report,choice);}
    },
    'music.renderEditSession': {
      description:'Render a music comp or audition synchronous take switches and loop passes through one continuous desk.',
      inputs:{source:'record',assets:sessionAssets,options},outputs:{value:'audio',taps:'record',report:'record'},
      run({source,assets,options}) {
        if (Object.keys(options).some(key=>key!=='preview')) throw new RangeError('Unknown session render option');
        return A.musicSession.create(assets).render(source,options.preview);
      }
    },
    'music.handoffEditSession': {
      description:'Export the active comp, sample-addressed MIDI and desk routing with aligned source stems.',
      inputs:{source:'record',assets:sessionAssets},outputs:{value:'audio',stems:'record',taps:'record',plan:'record'},
      run({source,assets}) {return A.musicSession.create(assets).handoff(source);}
    },
    'music.atmosphereReference': {
      description:'Read the audio clock and performed note gates for a pinned atmosphere score.',
      inputs:{score:'audio',performance:'record'},outputs:{value:'record'},
      run({score,performance}) {return {value:A.atmosphere.reference(score,performance)};}
    },
    'music.planAtmosphere': {
      description:'Place crossfaded beds, calls in score gaps and recurring gestures with automatic perspective.',
      inputs:{source:'record',assets:'record',settings:'record'},outputs:{value:'record'},
      run({source,assets,settings}) {return {value:A.atmosphere.plan(source,assets,settings)};}
    },
    'music.renderAtmosphere': {
      description:'Render an editable atmosphere plan over pinned score audio and optionally export its role stems.',
      inputs:{source:'record',score:'audio',assets:'record',options},
      outputs:{value:'audio',atmosphere:'audio',stems:'record',report:'record'},
      run({source,score,assets,options}) {return A.atmosphere.render(source,score,assets,options);}
    },
    'music.auditionAtmosphere': {
      description:'Compare alternate atmosphere densities and gains against the same score with shared playback gain.',
      inputs:{source:'record',score:'audio',assets:'record',settings:'record',options:{type:'record'}},
      outputs:{value:'audio',report:'record'},
      run({source,score,assets,settings,options}) {return A.atmosphere.audition(source,score,assets,settings,options);}
    },
    'music.branchResamplingJam': {
      description:'Fork named playback treatments or expand a rack macro sweep over one pinned pad performance.',
      inputs:{source:'record',request:'record'},outputs:{value:'record',added:'array<record>'},
      run({source,request}) {return A.resamplingJam.branch(source,request);}
    },
    'music.renderResamplingJam': {
      description:'Render a pinned pad phrase through a playback branch and rack, retaining its dry tap and event clock.',
      inputs:{source:'record',assets:'record',options},outputs:{value:'audio',dry:'audio',report:'record'},
      run({source,assets,options}) {return A.resamplingJam.render(source,assets,options);}
    },
    'music.auditionResamplingJam': {
      description:'Compare the same sample range across jam branches in a level-matched reel.',
      inputs:{source:'record',assets:'record',options},outputs:{value:'audio',report:'record'},
      run({source,assets,options}) {return A.resamplingJam.audition(source,assets,options);}
    },
    'music.renderSampleKit': {
      description: 'Play a sample kit from timed pad or MIDI events with layers, articulation, inserts and return buses.',
      inputs:{source:'record',assets:'record',events:'array<record>',options},
      outputs:{value:'audio',stems:'record',report:'record'},
      run({source,assets,events,options}) {return A.sampleKit.render(source,assets,events,options);}
    },
    'music.routeSampleKit': {
      description: 'Route performed production tracks to kit pads or MIDI mappings while retaining their timing and velocity.',
      inputs:{tracks:'record',routes:'record'},outputs:{value:'array<record>'},
      run({tracks,routes}) {return {value:A.sampleKit.route(tracks,routes)};}
    },
    'music.programPads': {
      description: 'Resolve seeded conditional pad hits, rolls and fills into an editable performance.',
      inputs:{source:'record',options},
      outputs:{value:'record',events:'array<record>',options:'record',report:'record'},
      run({source,options}) {
        const result=A.padPattern.perform(source,options);
        return {...result,options:result.value.options};
      }
    },
    'music.composeSlices': {
      description: 'Compose recorded slice phrases with drifting loops, additive changes, cut-ups and pitched answers.',
      inputs:{source:'record'},outputs:{value:'record',events:'array<record>',options:'record',report:'record'},
      run({source}) {return A.sliceComposition.compose(source);}
    },
    'music.capturePadPerformance': {
      description: 'Capture timestamped pad pulses with velocity and hit controls as editable sample-kit events.',
      inputs:{source:'record',routes:'record',options},
      outputs:{value:'record',events:'array<record>',options:'record'},
      run({source,routes,options}) {
        const value=A.padPattern.capture(source,routes,options);
        return {value,...value};
      }
    },
    'music.editPadPerformance': {
      description: 'Change, move, insert or delete captured pad hits by stable event ID.',
      inputs:{source:'record',edits:scoreRequests},
      outputs:{value:'record',events:'array<record>',options:'record'},
      run({source,edits}) {
        const value=A.padPattern.edit(source,edits);
        return {value,...value};
      }
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
    'audio.extractGroove': {
      description: 'Measure audio attack timing, relative accents and audible lengths into groove lanes and an unfolded take.',
      inputs:{sources:'record',options},outputs:{value:'record',take:'record',report:'record'},
      run({sources,options}) {return A.extractGroove(sources,options);}
    },
    'music.fitGroove': {
      description: 'Fit measured or MIDI note timings, accents and lengths to a reference grid, preserving each pass in a take.',
      inputs:{events:'array<record>',options},outputs:{value:'record',take:'record',report:'record'},
      run({events,options}) {return P.performanceGroove.fit(events,options);}
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
    'music.applyGroove': {
      description: 'Apply cyclic grooves or recorded ensemble phrasing, with shared pulse, player offsets and reciprocal attacks.',
      inputs:{source:'record',mapping:'record',assets:options},outputs:{value:'record',report:'record'},
      run({source,mapping,assets}) {
        const {production,report}=P.musicProduction.mapGroove(source,mapping,assets);
        return {value:production,report};
      }
    },
    'music.cueMap': {
      description: 'Apply cue groups, landmarks, density, register, harmony, silence and room lanes to a production.',
      inputs:{source:'record',map:'record',assets:options},outputs:{value:'record',report:'record'},
      run({source,map,assets}) {
        const {production,report}=P.musicProduction.mapCue(source,map,assets);
        return {value:production,report};
      }
    },
    'music.noteClip': {
      description: 'Validate a polyphonic clip with named voices, editable pitches and ties.',
      inputs:{source:'record'},outputs:{value:'record'},
      run({source}) {return {value:P.musicNoteClips.clip(source)};}
    },
    'music.voiceLead': {
      description: 'Search distinct inner lines around a locked melody and bass, with editable dissonance and note constraints.',
      inputs:{source:'record',settings:'record',assets:options},
      outputs:{value:'record',variants:'array<record>',report:'record'},
      run({source,settings,assets}) {
        const value=P.musicProduction.voiceLead(source,settings,assets);
        return {value,...value};
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
    'music.planProducer': {
      description: 'Plan contrasting, editable orchestration and harmony takes around a musical goal.',
      inputs:{source:'record',brief:'record',assets:options},outputs:{value:'record'},
      run({source,brief,assets}) {return {value:P.musicProduction.planProducer(source,brief,assets)};}
    },
    'music.searchLockedArrangement': {
      description:'Search inside a score range with fixed tracks or protected regions and one winner per type of musical move.',
      inputs:{source:'record',brief:'record',assets:options},
      outputs:{value:'record',candidates:'array<record>',report:'record'},
      run({source,brief,assets}) {
        const value=P.musicProduction.searchLockedArrangement(source,brief,assets);
        return {value,candidates:value.candidates,report:value.report};
      }
    },
    'music.keepLockedArrangement': {
      description:'Keep a named arrangement take with its editable score, locks and reference context.',
      inputs:{search:'record',take:'string'},outputs:{value:'record'},
      run({search,take}) {return {value:P.musicProduction.keepLockedArrangement(search,take)};}
    },
    'music.renderLockedArrangement': {
      description:'Render a retained arrangement and preserve the original samples in every protected range.',
      inputs:{source:'record',assets:options,options},outputs:{value:'audio',stems:'record',report:'record'},
      run({source,assets,options}) {return P.musicProduction.renderLockedArrangement(source,assets,options);}
    },
    'music.composeWholePiece': {
      description:'Compose competing full-length forms, with scored hook appearances, pulse and endings, from a blank brief.',
      inputs:{brief:options},outputs:{value:'record',candidates:'array<record>',assets:'record',report:'record'},
      run({brief}) {
        const {value,assets}=P.musicProduction.composeWholePiece(brief);
        return {value,candidates:value.candidates,assets,report:value.report};
      }
    },
    'music.searchComposition': {
      description: 'Search contrasting cue, phrase and note revisions with harmonic constraints and one winner per kind.',
      inputs:{source:'record',brief:'record',assets:options},
      outputs:{value:'record',session:'record',winners:'array<record>',report:'record'},
      run({source,brief,assets}) {
        const value=P.musicProduction.searchComposition(source,brief,assets);
        return {value,session:value.session,winners:value.winners,report:value.report};
      }
    },
    'music.inspectInstrumentGraph': {
      description:'Validate a modular instrument and report its signal order, feedback and expression routing.',
      inputs:{patch:'record',assets:options},outputs:{value:'record'},
      run({patch,assets}) {return {value:P.musicProduction.inspectInstrumentGraph(patch,assets)};}
    },
    'music.instrumentLibrary': {
      description:'List stock performance instruments, their articulations, controls and pad addresses.',
      inputs:{},outputs:{value:'record'},
      run() {return {value:P.musicProduction.instrumentLibrary};}
    },
    'music.loadInstrumentPack': {
      description:'Load a seeded stock performance instrument with editable patches or a pad kit and its playable audio sources.',
      inputs:{name:'string',options},outputs:{value:'record',patches:'record',kit:'record',assets:'record'},
      run({name,options}) {
        const {id,guide,patches,kit,assets}=P.musicProduction.loadInstrumentPack(name,options);
        return {value:{id,guide,patches,kit},patches,kit,assets};
      }
    },
    'music.instrumentPresets': {
      description:'Get editable stock reed, electric tines and bass patches with contextual articulation maps.',
      inputs:{},outputs:{value:'record'},
      run() {return {value:P.musicProduction.instrumentPresets};}
    },
    'music.planPocket': {
      description:'Plan four takes that isolate written rhythm changes and linked microtiming.',
      inputs:{source:'record',brief:'record',assets:options},outputs:{value:'record',variants:'array<record>',report:'record'},
      run({source,brief,assets}) {
        const value=P.musicProduction.planPocket(source,brief,assets);
        return {value,...value};
      }
    },
    'music.reviewProducer': {
      description: 'Level-match producer takes in context and return aligned listening windows and instrument solos.',
      inputs:{source:'record',session:'record',assets:options,options},
      outputs:{value:'record',audio:'record',focus:'record',report:'record'},
      run({source,session,assets,options}) {
        const {takes,report}=P.musicProduction.reviewProducer(source,session,assets,options);
        return {value:report,report,audio:Object.fromEntries(takes.map(take=>[take.id,take.value])),
          focus:Object.fromEntries(takes.map(take=>[take.id,take.focus]))};
      }
    },
    'music.keepProducer': {
      description: 'Keep selected audition components and save their reusable revision and listening rationale.',
      inputs:{source:'record',session:'record',selection:'record',assets:options},
      outputs:{value:'record',reference:'record',revision:'record'},
      run({source,session,selection,assets}) {
        const {production,reference,revision}=P.musicProduction.keepProducer(source,session,selection,assets);
        return {value:production,reference,revision};
      }
    },
    'music.planCritique': {
      description:'Measure rendered evidence on the score grid and propose local hook and arrival edits.',
      inputs:{source:'record',brief:'record',assets:options},outputs:{value:'record'},
      run({source,brief,assets}) {return {value:P.musicProduction.critique.plan(source,brief,assets)};}
    },
    'music.blindCritique': {
      description:'Publish matched audio under neutral labels, with a separate reveal key and addressed evidence clips.',
      inputs:{source:'record',plan:'record',assets:options,options},
      outputs:{value:'record',audio:'record',evidence:'record',key:'record',token:'string'},
      run({source,plan,assets,options}) {
        const {test,audio,evidence,key}=P.musicProduction.critique.blind(source,plan,assets,options);
        return {value:test,audio,evidence,key,token:test.token};
      }
    },
    'music.keepCritique': {
      description:'Apply a blind listening decision and save its rationale, paired votes and editable revision.',
      inputs:{source:'record',key:'record',token:'string',selection:'record',assets:options},
      outputs:{value:'record',reference:'record',revision:'record'},
      run({source,key,token,selection,assets}) {
        const {production,reference,revision}=P.musicProduction.critique.keep(source,key,{...selection,token},assets);
        return {value:production,reference,revision};
      }
    },
    'music.planForegroundMix': {
      description:'Score foreground moments and propose contrasting mix, release, depth and arrangement moves.',
      inputs:{source:'record',settings:'record',assets:options},outputs:{value:'record',request:'record',report:'record'},
      run({source,settings,assets}) {
        const {production,request,report}=P.musicProduction.foregroundMix.plan(source,settings,assets);
        return {value:production,request,report};
      }
    },
    'music.auditionForegroundMix': {
      description:'Audition four types of foreground mix edits against the original across selected moments.',
      inputs:{source:'record',settings:'record',assets:options},
      outputs:{value:'record',production:'record',plan:'record',audio:'record',original:'audio',key:'record',token:'string'},
      run({source,settings,assets}) {
        const {comparison,production,report,request}=P.musicProduction.foregroundMix.audition(source,settings,assets);
        return {value:comparison.report,production,plan:{...report,request},audio:comparison.audio,
          original:comparison.audio.reference,key:comparison.key,token:comparison.key.token};
      }
    },
    'music.inspectCritiqueAudio': {
      description:'Probe actual production audio with context, solo and mono previews plus addressed issues and notes.',
      inputs:{source:'record',request:'record',assets:options},outputs:{value:'record',clip:'audio',audio:'record'},
      run({source,request,assets}) {
        const {report,audio}=P.musicProduction.critique.openAudio(source,assets).inspect(request);
        return {value:report,clip:audio[report.clips[0].id],audio};
      }
    },
    'music.compareCritiqueEdits': {
      description:'Render explicit local score and mix edits against the original with aligned audio and editable revisions.',
      inputs:{source:'record',request:'record',assets:options},
      outputs:{value:'record',original:'audio',candidate:'audio',audio:'record',key:'record',token:'string'},
      run({source,request,assets}) {
        const {report,audio,key}=P.musicProduction.critique.openAudio(source,assets).compare(request);
        return {value:report,original:audio.reference,candidate:audio[report.takes[1]?.id] ?? audio.reference,
          audio,key,token:key.token};
      }
    },
    'music.diagnoseCritiqueAudio': {
      description:'Audition controlled masking or groove edits in context with measured evidence, stems and addressed revisions.',
      inputs:{source:'record',request:'record',assets:options},
      outputs:{value:'record',original:'audio',audio:'record',key:'record',token:'string'},
      run({source,request,assets}) {
        const {report,audio,key}=P.musicProduction.critique.openAudio(source,assets).diagnose(request);
        return {value:report,original:audio.reference,audio,key,token:key.token};
      }
    },
    'music.packListenerCalibration': {
      description:'Create blind audio comparisons with swapped order and identical controls, plus a private answer key.',
      inputs:{clips:'record',settings:'record'},outputs:{value:'record',audio:'record',key:'record',token:'string'},
      run({clips,settings}) {
        const pack=P.musicProduction.critique.listener.pack(clips,settings);
        return {...pack,token:pack.value.token};
      }
    },
    'music.evaluateListenerCalibration': {
      description:'Score a listener by question, answer stability, identical controls, coverage and valid audio addresses.',
      inputs:{key:'record',token:'string',responses:'record',settings:options},outputs:{value:'record'},
      run({key,token,responses,settings}) {
        return {value:P.musicProduction.critique.listener.evaluate(key,{...responses,token},settings)};
      }
    },
    'music.applyCritiqueEdit': {
      description:'Apply one auditioned edit to its original production or session and retain an authored listening decision.',
      inputs:{source:'record',key:'record',token:'string',selection:'record',assets:options},
      outputs:{value:'record',revision:'record',reference:'record'},
      run({source,key,token,selection,assets}) {
        const {production,session,revision,reference}=P.musicProduction.critique.applyEdit(source,key,{...selection,token},assets);
        return {value:session ?? production,revision,reference};
      }
    },
    'music.rememberListeningPreference': {
      description:'Archive a kept blind result with its musical context, criterion-level votes and listening reason.',
      inputs:{reference:'record',memory:{type:'record',default:{format:'ink-studio/listening-preference-memory',version:1,entries:[]}}},
      outputs:{value:'record'},
      run({reference,memory}) {return {value:P.musicProduction.critique.rememberPreference(memory,reference)};}
    },
    'music.recallListeningPreferences': {
      description:'Recall context-matched blind evidence for available alternatives and a listening criterion.',
      inputs:{memory:'record',query:'record'},outputs:{value:'record'},
      run({memory,query}) {return {value:P.musicProduction.critique.recallPreferences(memory,query)};}
    },
    'music.tagListeningReference': {
      description:'Keep a sample-addressed reference clip and a description of what to listen for.',
      inputs:{source:'audio',settings:'record'},outputs:{value:'record',audio:'audio'},
      run({source,settings}) {
        const {reference,value}=P.musicProduction.critique.tagReference(source,settings);
        return {value:reference,audio:value};
      }
    },
    'music.findListeningReferences': {
      description:'Retrieve tagged listening excerpts and previous choices by musical intent.',
      inputs:{references:'array<record>',options},outputs:{value:'array<record>'},
      run({references,options}) {return {value:P.musicProduction.critique.findReferences(references,options)};}
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
      description: 'Render adaptive transitions with persistent performers, route-aware phrasing, and optional world cue rhythms and space.',
      inputs:{sources:'record',timeline:'record',intents:scoreRequests,assets:options,options,worldEvents:scoreRequests},
      outputs:{value:'audio',stems:'record',report:'record'},
      run({sources,timeline,intents,assets,options,worldEvents}) {
        if (worldEvents.length) options={...options,world:{...options.world,
          events:[...(options.world?.events ?? []),...worldEvents]}};
        return P.musicProduction.renderTimeline(sources,timeline,intents,assets,options);
      }
    },
    'music.captureScoreTrace': {
      description:'Replay timestamped adaptive score inputs into a reusable trace of requests, commits and cues.',
      inputs:{score:'record',updates:scoreRequests,settings:'record'},outputs:{value:'record'},
      run({score,updates,settings}) {return {value:P.musicProduction.rehearsal.captureScore(score,updates,settings)};}
    },
    'music.rehearseTransitions': {
      description:'Audit sound and score joins over identical world traces and return aligned, level-matched comparisons.',
      inputs:{sources:'record',timeline:'record',traces:'array<record>',variants:scoreRequests,assets:options,options},
      outputs:{value:'record',audio:'record'},
      run({sources,timeline,traces,variants,assets,options}) {
        const {report,audio}=P.musicProduction.rehearsal.run(sources,timeline,traces,variants,assets,options);
        return {value:report,audio};
      }
    },
    'music.reviseTransitions': {
      description:'Apply named segment, source, edge or stinger edits to an ordinary adaptive production timeline.',
      inputs:{sources:'record',timeline:'record',revision:'record',assets:options},
      outputs:{value:'record',sources:'record',timeline:'record'},
      run({sources,timeline,revision,assets}) {
        const value=P.musicProduction.rehearsal.revise(sources,timeline,revision,assets);
        return {value,...value};
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
