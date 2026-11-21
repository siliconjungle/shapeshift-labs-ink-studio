# Phrase composer

Use Ink's phrase tools to develop a motif, arrange parts, audition alternatives,
and carry an idea from one take into another. `KIT.music.composer` is available
in Node and the browser. Its graph operations appear in `ink-studio graph nodes`.
Use [music production](music-production.md) when a cue needs a sampler,
arranged groove, polyphonic accompaniment, mixing, or adaptive playback.

## Motifs and variation

A motif has a length in beats and an ordered list of events. Each event
declares `beat`, `duration`, optional `degree` and `velocity`, and an optional
stable `id`. Degrees start at one for the anchor pitch and can extend above
or below the octave. Leave gaps between notes for rests. The same motif can
play a melody, trigger percussion, or shape a light or camera sweep.

Use `music.makeMotif` to generate from a beat grid, allowed scale degrees,
count, gate, optional first and last degree, and seed. Use `music.motif` to
validate a hand-authored motif or vary one with ordered operations.

`music.makePhrase` (`composer.makePhrase`) creates an editable two- or
four-bar melody. Four-bar phrases quote the opening gesture, change the
density between bars, and end on a longer landing. Choose a `lyrical` or
`syncopated` shape, and optionally set `beatsPerBar`, `degrees`, `start`
and `end` degrees, and a reproducible `seed`.

| Operation | Effect |
| --- | --- |
| `repeat` with `count` | Extend the motif, retaining the first repeat's note IDs. |
| `accentShift` with `steps` | Rotate velocities among the notes while keeping their timing and pitches. |
| `answer` with optional `shift` | Reflect the contour around its opening degree, then move it by the given degrees. |
| `transpose` with `degrees` | Move the degrees together with the original timing. |
| `thin` with `keep` | Remove notes by seeded probability, retaining the first event. |
| `syncopate` with `amount` and `chance` | Move selected onsets within their available gaps. |
| `reverse` | Reverse the note intervals across the motif's length. |

Graph motif outputs include the editable notes and traits such as contour,
density, accents, and offbeat positions. The functions
`composer.motif.generate`, `vary`, and `inspect` provide the same API in JavaScript.

## Arrange by role

Pass `music.arrange` a definition with a shared `score` template, a named
`motifs` table, named `parts`, ordered `sections`, an optional `seed`, and
optional `pins`. The template is a [procedural score](procedural-score.md).
The composer fills `voices` and `duration`. You can still declare a tempo
map, key, tunings, named harmonies, chord events, and score bindings.

Parts use `bass`, `percussion`, `pad`, `lead`, or `visual` roles. They can
override native voice settings under `voice`, including `instrument` for
`kick`, `snare`, or `hat`. The built-in kit synthesizes hits from the note
schedule. A `visual` role defaults to zero audio gain and still has phase,
waveform, and envelope outputs. A part can set its own register and mode.
Set `pitch: "key"` for degrees anchored to the score's key. The default
`"chord"` follows the active chord root, including later world requests.

Set a part's `material` to a motif name, to
`{motif, operations, seed}` for a transformed motif, or to
`{sustain: true}` to play the harmony's note assigned to that voice.
A section names an `id` and a bar count. Use `harmony` for an opening chord
and `parts` to update specific materials. An omitted part carries on
through the boundary with the existing motif position. A `null` entry
takes that part out. An explicit entry starts new material at the
section's downbeat.

The output includes the native score and timed `cues` with part, source
motif, event ID, note timing, degree, and velocity. Use the score through
`music.score`, `music.scoreAudio`, a world score system, or a soundtrack.
Use cues or voice bindings to animate the related scene. Native score
voices can also declare a finite `sequence` directly, with ordered
`beat`, `duration`, optional `level`, and either a `midi` pitch or chord
root `offset`. A sequence item without pitch fields holds the harmony's
assigned note.

## Pin, revise, and take inspiration

Use `music.revise` with an arrangement and `options: {edits, pin, unpin}`.
Pins use `part:<id>` or `binding:<id>` and persist in the next arrangement.
A directly bound voice is also protected by its pinned binding. A part
edit can replace its material, run operations with a seed, or specialize
one section by naming `section`. Section overrides carry forward until
that part receives another override. Use `scope: "section"` to play an edit
only during that section. The inherited material resumes at its original
motif position afterward. Notes that straddle an override may be clipped
at the boundary. In a raw definition, use the section's `localParts` table
for these temporary overrides. A binding edit uses
`{binding, value}`. A harmony edit uses `{harmony, voicing}` or
`{harmony, notes}` and can set `inversion`. Edits that would change a
pinned sustained part's note assignments are rejected.

## Diagnose and propose changes

`music.analyzeArrangement` (`composer.analyze`) reports repeated bars by
relative scale degrees and beat positions, as well as narrow velocity and
gate ranges. Per-section part metrics include onset count, note occupancy,
and the longest rest. Results use one-based bar numbers. Set
`options.audio: {start, end, sampleRate}` to measure the rendered mix and
each voice's RMS and peak by bar over a window of up to thirty seconds.
Score metrics describe the written material. Audio metrics describe the
rendered mix, including its envelopes and levels.

`music.suggest` (`composer.suggest`) returns `proposals`, `blocked`, and
`variants`. Each proposal cites a finding, identifies a part and bar
range, and shows measured differences after applying the edit. Lead
proposals quote or answer a repeated hook. Percussion and bass proposals
can open space for a fill or a pickup, and articulation proposals can
retain pitches and timing while shaping accents and note lengths.
Options include `part`, `section`, `seed`, `limit` (1–8), and a list of
existing pins to explicitly `unpin`. A proposal blocked by a part or
binding pin identifies the pin. When `variants` contains alternatives,
feed it into `music.audition`, or pass a chosen variant as the edit
document to `music revise`. These are arrangement heuristics suitable for
audition. Replacement sections follow the motif limit of 256 beats and
512 events.

```sh
ink-studio music analyze examples/lock-signal-audition.json --out findings.json
ink-studio music suggest examples/lock-signal-audition.json --out suggestions.json
```

## Audition takes

`music.audition` evaluates each named edit list against the same baseline.
Pass a common start/end window and sample rate. It returns takes with
their portable arrangements, edits, timing, note-count differences,
and optional stereo audio. `music.reference` takes an arrangement, a
section, and a part. Its result pairs the editable motif with musical
traits and timed cues. Pass that record to `music.revise` as
`{part, section, adopt: reference}` to carry its motif into another role
or arrangement. The equivalent CLI takes an edits document in
`ink-studio music revise plan.json edits.json --out revised.json`.

The [Lock Signal recipe](../examples/lock-signal-audition.json) pins the
bass, lead, palette, and camera. Its three versions vary percussion
through an eight-bar lock sequence.

```sh
ink-studio music audition examples/lock-signal-audition.json --out audition
ink-studio music reference audition/audition-…/after-hours/arrangement.json \
  --part hat --section jam --out hat-idea.json
```

Each take has an MP4, stereo WAV, a review still, and its editable
arrangement and report. FFmpeg is used to encode the MP4. Use
`--frames-only` for WAV, still, and the editable documents without FFmpeg.
The default picture visualizes actual voice levels and cue positions.
An audition recipe can supply `picture: {project, output, scoreInput,
cuesInput, inputs}` to render a native RGBA or render-frame graph branch
instead. `project` is relative to the recipe and the score input defaults to
`score`. This lets an AI audition an authored scene with the same music
and picture window across all candidates.
