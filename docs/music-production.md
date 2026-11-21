# Music production

Use a phrase arrangement as the shared score and scene cue source. A production
adds instrument patches, performed note timing, voicing, mixing, and playback
rules. The [Relay Glass cue](../examples/music-production/relay-glass.json)
includes a playable kit, an authored hook, a bass line, a polyphonic pad,
and an eight-bar arc. Its recorded drum assets are credited with their source
and license in the [sample directory](../examples/music-production/samples/CREDITS.md).
Use [theme development](music-themes.md) to carry a motif between roles
and make adaptive returns depend on what has already played.
Use [patch gestures](music-gestures.md) to rehearse different performances
of the written notes.

## Instruments and performance

A production is a JSON record with an `arrangement`, a `patches` table, and a
`tracks` table keyed by arrangement part. The optional `seed` is used for
reproducible synthesis. Explicit pitches in motif events use MIDI note numbers.
Degree-based events still follow the part's pitch mapping.

| Patch type | Settings |
| --- | --- |
| `analog` | Harmonic body, color, detuned width in cents, grain, drive, and an attack/decay/sustain/release envelope |
| `fm` | The same envelope and texture controls, plus modulator ratio, index, and index decay |
| `keys` | Tine and strike synthesis with velocity-dependent bite, dust, wear, and an amplitude envelope |
| `drum` | Kick, snare, hat, rim, metal, or brush synthesis with pitch, decay, and transient controls |
| `sample` | Ordered zones with list of asset names, optional root pitch and key range, velocity interval, named articulation, gain in dB, tuning in cents, one-shot playback or a gated loop |

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

## Assemble adaptive transitions

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
