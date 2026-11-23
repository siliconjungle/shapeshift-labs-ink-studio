# Music production

[Dance drop studies](music-drop-studies.md) ships editable drum & bass, dubstep and rave sessions with in-context drum auditions and measured kick–bass timing.

Use a phrase arrangement as the shared score and scene cue source. A production
adds instrument patches, performed note timing, voicing, mixing, and playback
rules. The [Relay Glass cue](../examples/music-production/relay-glass.json)
includes a playable kit, an authored hook, a bass line, a polyphonic pad,
and an eight-bar arc. Its recorded drum assets are credited with their source
and license in the [sample directory](../examples/music-production/samples/CREDITS.md).
Use [recorded gesture orchestration](timbre-composition.md) to place a recording’s
contour, accents and tail in different instruments.
Use [theme development](music-themes.md) to carry a motif between roles
and make adaptive returns depend on what has already played.
Use a [cue map](music-cue-map.md) to shape density, register, chord pace,
silence, and room across the whole production.
Use [note clips and voice-leading search](music-voice-leading.md) to
try independent inner lines around a locked melody and bass.
Use [patch gestures](music-gestures.md) to rehearse different performances
of the written notes.
Use [arrangement search with locks](music-locked-arrangement.md) to replace
a passage while keeping selected lines and the rest of the render fixed.
Start with [whole-piece composition](music-whole-piece.md) to generate
competing full-length scores around a shared hook from an empty brief.
Load the [stock performance instruments](music-playable-instruments.md)
for a breath-and-resonance flute, prepared metal, and electric bass.
Use [modular instruments](music-instrument-graphs.md) to combine samples,
oscillators, resonators, filters and feedback in a per-note signal graph.
Use [instrument performance maps](music-instrument-performance.md) for
compensated attacks, interval-aware joins, key-up samples and independent
rhythm and microtiming auditions.

The [sample instrument builder](sample-instrument-builder.md) creates a
portable sampler patch and its WAV assets from a bank of recorded gestures.

Run the [production benchmark](production-benchmark.md) to compare a full cue,
a dialogue recut, and three routes through a playable adaptive score.

## Instruments and performance

A production is a JSON record with an `arrangement`, a `patches` table, and a
`tracks` table keyed by arrangement part. The optional `seed` is used for
reproducible synthesis. Explicit pitches in motif events use MIDI note numbers.
Degree-based events still follow the part's pitch mapping.

| Patch type | Settings |
| --- | --- |
| `analog` | Harmonic body, color, detuned width in cents, grain, drive, and an attack/decay/sustain/release envelope |
| `fm` | The same envelope and texture controls, plus modulator ratio, index, and index decay |
| `subtractive` | Band-limited saw and pulse, a sine sub, pulse-width LFO, and a resonant low-pass with note-local envelope and key follow |
| `keys` | Tine and strike synthesis with velocity-dependent bite, dust, wear, and an amplitude envelope |
| `drum` | Kick, snare, hat, rim, metal, or brush synthesis with pitch, decay, and transient controls |
| `sample` | Ordered zones with list of asset names, optional root pitch and key range, velocity interval, named articulation, gain in dB, tuning in cents, one-shot playback or a gated loop |

See [subtractive synth voices](subtractive-synth.md) for the oscillator,
filter, and articulation controls and an audible workshop.

Pass WAV assets by name in the CLI recipe's `assets` record. Graph and JavaScript
callers pass decoded audio buffers. Exact articulations take precedence over a
general matching zone. Multiple samples in a zone round-robin in event order,
with optional per-sample gain offsets in `levels`.
Tracks with the same `choke` name cut one another's tails with a short fade.

A motif event can carry `play` with `delay` and `glide` in seconds, `bend`
and `vibrato` in cents, sample `offset` in seconds, and optional
`gate` multiplier, `brightness`, `articulation`, and `retrigger` count.
Pitch glide and vibrato act on the synth patches. Brightness changes synth or
drum timbre, and sampler articulation selects a zone. A track's optional
`groove` has a beat subdivision `step`, repeating seconds offsets
`timing`, a constant seconds `offset`, and repeating `accents` multipliers.
Tempo-map swing stays on the common musical clock.
Synth and drum patches can also define named `articulations` with partial
patch settings, such as a different envelope or amount of pitch sweep.

A pad track can add `pad: {voices, low, high, anchor, spread, tie, rhythm}`.
The anchor is a preferred top note. The renderer chooses a close voicing in
range. Common tones can tie across a change with `tie`. A rhythmic pad
declares `{every, length, offset, velocity}` in beats, and `spread` staggers
the voices in seconds. `pad.sections` overrides settings by arrangement
section, including its optional `brightness` to change timbre at an arrival.
A pad only plays where its score part has active material.

Tracks have `gain` in dB, `pan`, `highpass` and `lowpass` in Hz, and a
`send` to the shared `room`. A track can duck from another track's attacks
using `{from, depth, release}`. The room has gain, size, decay, and damping.
Rendering can return stems, including the room return. The stem name
`room` is reserved. Filters and room history render on the absolute sample
grid. Individual note releases can extend past a render cut with `tail`.

## Develop a cue

```sh
ink-studio music production render examples/music-production/relay-glass.json --out render
ink-studio music production analyze examples/music-production/relay-glass.json --out analysis.json
ink-studio music production suggest examples/music-production/relay-glass.json --out suggestions.json
ink-studio music production audition examples/music-production/relay-glass.json suggestions.json --out audition
```

The JavaScript API is `KIT.music.production`. The graph exposes
`music.renderProduction`, `music.inspectProduction`, `music.analyzeProduction`,
`music.suggestProduction`, `music.reviseProduction`,
`music.auditionProduction`, and `music.renderTransitions`.
`music.inspectProduction` returns performed note events with their audio
times and pitches so that visual tracks can follow the performed groove.

Analysis reports accent overlaps, active harmony, and pitched notes held
across a section boundary. Suggestions can target `lead`, `pocket`, or
`arrival` in a section. Lead answers use the performed drum and bass attacks
and destination chord. A pocket revision uses existing kick anchors, the next
root, and the lead's available gaps. Arrival proposals revoice and pulse the
pad. Pass named roles via `parts` when assembling different instruments.
You can audition the generated revisions, combine independent edits, or
provide your own changes to motifs, patches, mix, and harmony. Part and
scene binding pins protect the affected score parts, their instrumentation
and performance data. An explicit `unpin` releases a pin for a take.

Pass analysis options `audio: {start, end, sampleRate, kick, bass}` to measure
rendered stem levels and compare the bass and kick in the low end at each
kick attack. The track names are optional when the arrangement names a kick
or assigns it by instrument, and has a bass role. The reported decibel
difference compares stem energy in a short, band-limited window.

An audition compares the same named time range for each revision. It exports
stems, editable recipes, gated K-weighted loudness and estimated true peak.
A shared target is reduced if necessary to keep all takes under the chosen
peak ceiling. Use `options: {start, end, target, ceiling, sampleRate}` for
the comparison window and level. For revision documents, an array holds the
named revisions directly. A suggestion report includes the reference in the
comparison by default.

[Run a producer audition](music-producer.md) to compare contrasting musical
decisions, hear focused bars and stems in context, and keep individual
choices with a reusable listening rationale.

[Transfer groove from a performance](performance-groove.md) to borrow
timing, accents and note lengths from an audio break or MIDI take.

[Route and automate a mix](audio-mixer.md) using rendered stems, sample
clips, or audio from graph nodes. The mixer supplies groups, returns,
parallel inserts, and sidechain compression on the same sample grid.

## Assemble adaptive transitions

Use [persistent performers and adaptive phrases](music-persistent-performers.md)
to carry voices and their room through a scene change, and choose phrases from
the player's route and prior listening.

[Rehearse adaptive joins](music-adaptive-rehearsal.md) against recorded world
paths and audition edits at the same sample addresses.

[Run the score live](music-live-adaptive.md) with causal exits, persistent DSP,
streamed cues, and a sample-addressed explanation of each join.

Pass the `music-transition` and `music-cue` intents from Ink's
[adaptive music clock](adaptive-music.md) to `music.renderTransitions`.
The renderer takes a named production `sources` bank and a `timeline` with
`entry`, `end`, and `segments`. Segments name a source and optional trim
markers `start` and `end` in seconds or musical positions, looping, gain,
and layer levels. Transition rules identify `from` and `to`, with optional
`exit` and `entry` markers, `fadeIn`, source `tail`, bridge segment and
pickup time. Stingers map cue resource names to one-shot segments. The
transition report preserves the adaptive clock's time, beat, and rule.

Run the [Relay Glass transition recipe](../examples/music-production/relay-glass-timeline.json)
with `ink-studio music production timeline recipe.json --out playback`. A CLI
source can be a path to a production recipe. The optional `adaptive` block
runs a standalone score with timestamped updates. Scene exports also accept
`music.production: {sources, timeline, assets}` alongside the adaptive
`music.system`. There the sources are inline records and `assets` maps
instrument keys to named soundtrack assets. The score is replayed through
the end of the production timeline so that a trimmed take includes any
bridge scheduled just after its endpoint.

[Arrange scene sound with the score](music-world-score.md) to turn world
cues into percussion phrases and reserve space in the music for effects
or silence.

## Capture new samples

[Capture and catalog audio](sample-capture.md) to make new sample sources
from a recording, live bus, instrument, graph, or scene.

## Import a SoundFont patch

```sh
ink-studio music soundfont piano.sf2 preset.json --out piano
```

Set `id`, `bank`, `program`, `notes`, `velocities`, `hold` and
`release` in the preset JSON. `drum: true` samples the percussion channel
and maps one-shot sounds to their original MIDI keys. The optional
`--fluidsynth` accepts the path to the external FluidSynth executable. The
adapter writes WAV samples and an `instrument.json` manifest with portable
sampler zones. Add its `patches` and WAV paths to a production recipe. The
sampler plays the captured note and release, with a bounded sustain length
from the sampled preset.
