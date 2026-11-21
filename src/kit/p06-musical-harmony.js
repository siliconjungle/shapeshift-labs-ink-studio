/* Pitch classes, tuning, chord voicings, and the circle of fifths. */
(function (P) {
  const names = Object.freeze(['C','C#','D','Eb','E','F','F#','G','Ab','A','Bb','B']);
  const natural = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const shapes = Object.freeze({
    major: [0,4,7], minor: [0,3,7], diminished: [0,3,6], augmented: [0,4,8],
    sus2: [0,2,7], sus4: [0,5,7], major7: [0,4,7,11], minor7: [0,3,7,10],
    dominant7: [0,4,7,10], halfDiminished7: [0,3,6,10], diminished7: [0,3,6,9],
    fifth: [0,7], unison: [0]
  });
  const mod = (value, size = 12) => ((value % size) + size) % size;
  const modes = {
    major:[0,2,4,5,7,9,11], dorian:[0,2,3,5,7,9,10], phrygian:[0,1,3,5,7,8,10],
    lydian:[0,2,4,6,7,9,11], mixolydian:[0,2,4,5,7,9,10], minor:[0,2,3,5,7,8,10],
    locrian:[0,1,3,5,6,8,10], harmonicMinor:[0,2,3,5,7,8,11], melodicMinor:[0,2,3,5,7,9,11],
    majorPentatonic:[0,2,4,7,9], minorPentatonic:[0,3,5,7,10], wholeTone:[0,2,4,6,8,10],
    chromatic:Array.from({length:12},(_,i) => i)
  };
  modes.naturalMinor = modes.minor;
  const just = [1,16/15,9/8,6/5,5/4,4/3,45/32,3/2,8/5,5/3,9/5,15/8];
  const pitch = /^([A-Ga-g])([#b♯♭]?)(-?\d{1,2})?$/u;
  function parse(value) {
    const parts = typeof value === 'string' && pitch.exec(value);
    if (!parts) throw new TypeError('Expected a pitch name or MIDI number');
    const [, letter, accidental, octave] = parts;
    const semitone = natural[letter.toUpperCase()] + (accidental ? '#♯'.includes(accidental) ? 1 : -1 : 0);
    return { semitone, octave };
  }
  function midi(value) {
    if (typeof value === 'string') {
      const { semitone, octave } = parse(value);
      if (octave === undefined) throw new TypeError('Note names need an octave such as C4');
      value = (Number(octave) + 1)*12 + semitone;
    }
    if (!Number.isSafeInteger(value) || value < 0 || value > 127) throw new RangeError('MIDI pitch must be an integer from 0 to 127');
    return value;
  }
  function pitchClass(value) {
    return typeof value === 'string' ? mod(parse(value).semitone) : mod(midi(value));
  }
  const pitchName = value => names[mod(midi(value))] + (Math.floor(midi(value)/12)-1);
  const pitchClasses = Object.freeze(Array.from({ length: 12 }, (_, i) => names[mod(i*7)]));
  const fifthIndex = key => mod(pitchClass(key)*7);
  const fifthStep = key => pitchClasses[mod(key)];

  function fifths(from, to) {
    const start = fifthIndex(from), clockwise = mod(fifthIndex(to) - start);
    const steps = clockwise > 6 ? clockwise - 12 : clockwise;
    return { distance: Math.abs(steps), steps,
      path: Array.from({ length: Math.abs(steps)+1 }, (_, i) => fifthStep(start+i*Math.sign(steps))) };
  }

  function chord(root, quality = 'major', inversion = 0) {
    if (!Object.hasOwn(shapes, quality) || !Number.isSafeInteger(inversion) || inversion < 0 || inversion >= shapes[quality].length)
      throw new RangeError('Unknown chord quality or invalid inversion');
    const start = midi(root), offsets = shapes[quality];
    return offsets.map((_, i) => {
      const slot = i + inversion;
      return midi(start + offsets[slot % offsets.length] + (slot >= offsets.length ? 12 : 0));
    });
  }
  function scaleSteps(mode = 'major') {
    if (typeof mode === 'string' && Object.hasOwn(modes,mode)) return modes[mode].slice();
    if (!Array.isArray(mode) || mode.length < 1 || mode.length > 12 || mode[0] !== 0 ||
      !Array.from(mode).every((value,i) => Number.isSafeInteger(value) && value >= 0 && value < 12 && (!i || value > mode[i-1])))
      throw new RangeError('Use a named scale or increasing semitone offsets starting at zero');
    return mode.slice();
  }
  function scale(root, mode) {
    const base = midi(root), steps = scaleSteps(mode);
    return { root: base, steps, notes: steps.map(step => midi(base+step)) };
  }
  function scaleChord(root,mode,degree = 1,size = 3,inversion = 0) {
    const base = midi(root), steps = scaleSteps(mode);
    if (!Number.isSafeInteger(degree) || degree < 1 || degree > 64 || !Number.isSafeInteger(size) ||
      size < 1 || size > 8 || !Number.isSafeInteger(inversion) || inversion < 0 || inversion >= size)
      throw new RangeError('Scale chords need a one-based degree, bounded size, and valid inversion');
    const at = index => base + steps[index % steps.length] + 12*Math.floor(index / steps.length);
    const fundamental = at(degree-1);
    const notes = Array.from({length:size},(_,i) => at(degree-1+i*2));
    const quality = Object.keys(shapes).find(name => shapes[name].length === size &&
      shapes[name].every((step,i) => fundamental+step === notes[i])) ?? 'custom';
    const rotated = notes.slice(inversion);
    for (const note of notes.slice(0,inversion))
      rotated.push(note + Math.max(1,Math.floor((rotated.at(-1)-note)/12)+1)*12);
    return { root:midi(fundamental), notes:rotated.map(midi), quality };
  }
  function mapScale(mode, rounding = 'nearest') {
    const steps = [...scaleSteps(mode),12], allowed = ['nearest','floor','ceil'];
    if (!allowed.includes(rounding)) throw new RangeError('Scale rounding must be nearest, floor or ceil');
    return value => {
      if (!Number.isFinite(value)) throw new RangeError('Scale input must be finite');
      const at = Math.min(12,Math.max(0,value*12)), hi = steps.findIndex(step => step >= at);
      const lower = steps[Math.max(0,hi-1)], upper = steps[hi];
      const step = upper === at || rounding === 'ceil' ? upper :
        rounding === 'floor' || at-lower <= upper-at ? lower : upper;
      return step/12;
    };
  }
  function quantizePitch(value,root,mode,rounding) {
    if (!Number.isFinite(value) || value < 0 || value > 127) throw new RangeError('Pitch must be between MIDI 0 and 127');
    const base = midi(root), delta = value-base, octave = Math.floor(delta/12);
    const notes = scaleSteps(mode).flatMap(step => [-1,0,1].map(offset => base+step+12*(octave+offset)))
      .filter(note => note >= 0 && note <= 127).sort((a,b) => a-b);
    const upper = notes.find(note => note >= value) ?? notes.at(-1);
    const lower = notes.findLast(note => note <= value) ?? notes[0];
    if (rounding !== undefined && !['nearest','floor','ceil'].includes(rounding))
      throw new RangeError('Scale rounding must be nearest, floor or ceil');
    return rounding === 'ceil' ? upper : rounding === 'floor' || value-lower <= upper-value ? lower : upper;
  }

  function ratio(semitones, tuning, quality) {
    if (tuning === 'equal') return 2 ** (semitones / 12);
    const pc = mod(semitones);
    const relative = pc === 6 && ['diminished','diminished7','halfDiminished7'].includes(quality) ? 64/45 :
      pc === 8 && quality === 'augmented' ? 25/16 :
      pc === 10 && quality === 'dominant7' ? 7/4 :
      pc === 9 && quality === 'diminished7' ? 128/75 : just[pc];
    return relative * 2 ** Math.floor(semitones / 12);
  }

  // Preserve exact common pitches before minimizing movement across the remaining voices.
  function lead(previous, notes) {
    const size = notes.length, full = (1 << size) - 1, costs = new Float64Array(full+1).fill(Infinity);
    const choices = new Uint8Array(full+1);
    costs[full] = 0;
    const count = new Uint8Array(full+1);
    for (let mask = 1; mask <= full; mask++) count[mask] = count[mask >>> 1]+(mask & 1);
    for (let mask = full-1; mask >= 0; mask--) {
      const i = count[mask], from = previous[i];
      for (let j = 0; j < size; j++) {
        const bit = 1 << j;
        if (mask & bit) continue;
        const to = notes[j];
        const motion = from === to ? 0 : from === null || to === null ? 128 : Math.abs(from-to);
        const exact = from !== null && from === to ? -2048 : 0;
        const cost = costs[mask|bit] + exact + motion + Math.abs(i-j)*.001;
        if (cost < costs[mask]) {
          costs[mask] = cost;
          choices[mask] = j;
        }
      }
    }
    let mask = 0;
    return previous.map(() => {
      const j = choices[mask];
      mask |= 1 << j;
      return notes[j];
    });
  }

  P.musicHarmony = Object.freeze({ midi, pitchClass, pitchName, pitchClasses, fifths, chord, ratio, lead,
    scaleSteps, scale, scaleChord, mapScale, quantizePitch });
})(KIT.procedural);
