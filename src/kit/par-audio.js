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
    'input.recording': {
      inputs: { initial: options, events: 'array<record>' }, outputs: { value: 'record' },
      run(inputs) { return { value: A.recording(inputs) }; }
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
