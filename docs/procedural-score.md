# Procedural audiovisual scores

Use the [phrase composer](phrase-composer.md) to build, revise, and audition
these scores from motifs and section roles.

Use one portable score to synthesize music and drive rendering or simulation.
`KIT.music.score.compile(score)` and `KIT.procedural.musicScore.compile(score)`
return the same program. A program supports independent sampling, exact take
frames, and stereo synthesis on an absolute sample grid.

```js
const score = {
  tempoMap: { tempo: 120, beatsPerBar: 4, barsPerPhrase: 2 },
  duration: { bar: 4 },
  key: { root: 'C4', mode: 'major' },
  tuning: 'just',
  voices: [
    { id: 'anchor', waveform: 'sine', motion: { cyclesPerBar: 2 } },
    { id: 'glass', waveform: 'triangle', motion: { cyclesPerBar: 2 } },
    { id: 'prism', waveform: 'sine', motion: { cyclesPerBar: 2 } }
  ],
  harmonies: {
    home: { degree: 1, fade: 0 },
    away: { degree: 6, notes: ['A4', 'C4', 'E4'] }
  },
  changes: [{ time: 0, harmony: 'home' }, { time: { bar: 2 }, harmony: 'away' }],
  bindings: {
    rotation: { voice: 'anchor', from: 'signal', range: [-.4, .4] },
    shutter: { voice: 'glass', from: 'phase', scale: 'majorPentatonic', range: [0, 2] },
    accent: { voice: 'prism', from: 'pitch', colors: { G: '#7ecbff', A: '#f7b568' } }
  }
};
const program = KIT.music.score.compile(score);
const frame = program.sample(4.25);      // seconds
const audio = program.audio({ sampleRate: 48000, stems: true });
```

`frame.bindings` contains the rotation, shutter position and color. The audio
uses the same chord events and voice identities. A graph can use `music.score`
at its current take frame and `music.scoreAudio` to supply an `audio` output
for WAV export. Use `data.get` to connect a named binding to an ordinary
numeric or color input.

## Scales, chords, and tunings

- A key uses a root such as `C4` or MIDI `60` and a mode. Modes include major,
  natural, harmonic and melodic minor, the diatonic modes, major and minor
  pentatonic, whole-tone and chromatic. A custom mode is an increasing array
  of integer semitone offsets starting at zero within one octave.
- Harmonies can declare `root` and `quality`, or choose `degree` in the
  score key or an overriding key. Degrees are one-based. Scale harmonies
  stack scale thirds and accept `size` for triads, seventh chords and
  extensions. Use `inversion` to move notes within the voicing.
- Optional `notes` specify the available MIDI pitches. Common notes stay
  on their voice IDs first, and remaining voices minimize semitone movement.
  Set `leading: false` to keep list order. A `voicing` record assigns
  named voices directly. Missing slots and explicit nulls are rests.
- `tuning` can be `equal` or `just` at score or harmony level.
  `referenceHz` is A4. Optional per-harmony `ratios` override the ratio
  assigned to a semitone offset in the octave. Ratios accept numbers or
  `{numerator, denominator}` records. `retainPitch` and `retainMotion`
  default to true, keeping the current pitch and visual rate for a common
  note. Set either to false to follow the new harmony's tuning or motion
  ratio while continuing phase.

`KIT.music.score.harmony` and the matching graph operations expose
`scale` / `music.scale`, `scaleChord` / `music.scaleChord`,
`quantizePitch` / `music.quantizePitch`, `mapScale` / `music.scaleMap`,
and `fifths` / `music.fifths`. A fifths route lists the shortest path
between pitch classes. Each chord event includes the route from the
preceding root.

## Voices and scene controls

Voices have a waveform, starting phase in cycles, gain, pan, and attack,
release and pitch-glide durations in seconds. Available waveforms are sine,
triangle, saw and pulse. Pulse has a `duty` control. Extra `partials` are
integer harmonic and amplitude pairs for the synth. `cents` detunes a voice
and its chord-relative motion.

`motion.cyclesPerBar` is the visual rate before multiplying by the pitch
ratio. `motion.follow: "fixed"` keeps the authored cycles per bar.
`motion.amplitude` scales the visual signal. The same oscillator shape is
sampled at audio rate in hertz and at visual rate in cycles per bar.

An optional `rhythm: {length, hits}` repeats in beats. Each hit declares
`beat`, `duration`, and optional `level`. The tempo map resolves onsets
and lengths including swing and tempo changes. Attack and release shape
both the visual level and audible note gate. `endFade` fades the score in
its final seconds.

Bind a voice's `signal`, `phase`, `level`, `rate`, or `frequency` to
a numeric `range` or to a `colors` ramp such as
`[[0,"#5566ba"],[1,"#ff9c62"]]`. `domain` sets the input endpoints.
Add `scale` and `rounding` to make the same ordered steps constrain
angles, camera positions, opacity, or color along a ramp. Pitch-class
`colors` bindings use a name-to-hex map and a `fallback` swatch.
Pitch transitions use the harmony's `fade` in seconds and preserve
colors attached to held notes, including when a subsequent cue
interrupts a fade.

### Alignment and roughness

`analysis.pairs` reports the nearest bounded integer ratio between
active voices, the signed tuning error in cents, the beat between the
matched partials, and an exact return period when aligned.
`motionPeriodBars` gives the analogous phase-return period for their
visual rates. `ratioFit` grades proximity to simple ratios. `roughness`
estimates beating between the voices' weighted partials using a normalized
[Sethares pair curve](https://sethares.engr.wisc.edu/papers/consance.html).
Use those values as independent scene controls. A binding can select
`pair: ['voice-a','voice-b']` or follow the whole mix. `fifthDistance`
is the step count from the previous root. Use `music.interval` and
`music.roughness` for standalone frequency pairs and partial spectra.

## World events and audio export

Add a world system with `kind: "procedural-score"` and
`config: {score}`. Its `change` action or `chords` event port takes
`{harmony, quantize}`. Requests from world events can use `none`,
`half-beat`, `beat`, `half-bar`, `bar` or `phrase`. Quantized requests
land on the next boundary, and the latest request at a shared boundary
chooses that chord. The `music-chord` event records its effective beat,
time and note assignments.

Wire numeric outputs such as `signal.anchor`, `phase.glass`,
`control.rotation`, or `roughness` to other world systems. The `controls`
record includes color bindings. Probe `score/state` for the sampled
frame and `score/schedule` for the portable score and recorded requests.
The latter can be recompiled by a graph or reused to synthesize just a
requested sample window.

A [scene soundtrack file](scene-audio.md) can declare
`"proceduralScore": {"system":"score"}` with a recorded/replayable world,
or `"proceduralScore": {"score": {…}}` with an inline score. Scene export
mixes the result into the music stem. Full and trimmed renders use
absolute sample boundaries.

## After the Fifth

The [audiovisual study](../examples/after-the-fifth.cjs) sends an authored
relay event to the score, holds common voices through the new chord,
quantizes the outer shutter with a pentatonic scale, and spreads the ray
fan using the roughness between two voices. The example generates every
picture and both channels of audio from the recorded schedule.

```sh
node examples/after-the-fifth.cjs after-the-fifth --frames
ffmpeg -framerate 24 -i after-the-fifth/frames/%04d.png \
  -i after-the-fifth/after-the-fifth.wav -c:v libx264 -crf 16 \
  -pix_fmt yuv420p -c:a aac -b:a 256k -movflags +faststart after-the-fifth.mp4
```
