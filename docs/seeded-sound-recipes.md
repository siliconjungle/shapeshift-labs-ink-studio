# Seeded sound recipes

Generate short effects for feedback, objects, and world actions. Each
version 1 recipe carries its family, seed, and render settings. A saved
recipe can rebuild the same PCM and WAV on the same engine version.

```json
{
  "format": "ink-studio/sound-recipe",
  "version": 1,
  "id": "relay-confirm",
  "family": "confirm",
  "seed": 21704,
  "render": { "sampleRate": 48000, "duration": 0.26, "peak": 0.72, "encoding": "pcm24" }
}
```

```sh
ink-studio music sound render confirm.sound.json --out confirm
ink-studio music sound render confirm/recipe.sound.json --out rebuilt
```

The command writes `sound.wav`, `recipe.sound.json` with every default
resolved, and `report.json` with the sample count, levels, and SHA-256 of
the WAV. The ID labels the asset. The family and seed determine the
voice and its variation.

| Family | Sound |
| --- | --- |
| `confirm` | A short two-tone acknowledgment. |
| `warning` | Two repeating pulses followed by a lower tone. |
| `pickup` | A bright, ascending set of notes. |
| `impact` | A low falling strike with a short noise tail. |
| `jump` | A rising glide with a small onset of filtered noise. |
| `charge` | A rising tone with accelerating pulses and a bright finish. |

Use a safe integer seed. Default WAV settings are mono PCM24 at
48 kHz with a peak of 0.75 and a duration chosen by the family.
The renderer accepts 8–96 kHz, a duration from 0.04 to 4 seconds,
a peak from 0.01 to 1 in linear amplitude, and one of `pcm16`,
`pcm24`, or `float32`. Duration rounds to the nearest sample.

## Generate a family of variations

```sh
ink-studio music sound mutate jump.sound.json --out jumps
ink-studio music sound mutate jump.sound.json jump-variations.json --out jumps
```

The first command makes eight variations around the source settings.
Give the second command a settings file to select the seed, count,
locks, and authored ranges.

```json
{
  "format": "ink-studio/sound-mutation",
  "version": 1,
  "seed": 6305,
  "count": 4,
  "locks": ["pitchContour", "attack"],
  "bounds": {
    "duration": [0.24, 0.53],
    "brightness": [0.35, 1.85],
    "noise": [0.05, 1.95]
  }
}
```

Each bound is an inclusive pair of absolute values. When you supply
`bounds`, omitted controls keep their source values. The generator
accepts 1–32 variations and defaults to the seed in the source recipe.
It keeps the synthesis seed, sample rate, and WAV encoding for every
variation. Use the mutation seed to redraw the controls. Changing
the count keeps existing draws in the same order.

| Control | Range | Meaning |
| --- | --- | --- |
| `pitchSemitones` | −9 to 9 | Shift every pitched layer by the same interval. |
| `sweep` | 0.5 to 1.4 | Scale each glide's start-to-end pitch interval. |
| `duration` | 0.04 to 4 seconds | Stretch or shrink the cue and its layer placements. |
| `attack` | 0.25 to 3 | Scale the source's per-layer attack ramps. |
| `brightness` | 0.25 to 2 | Change upper harmonics. |
| `noise` | 0 to 2 | Set the relative level of noise layers where present. |
| `decay` | 0.45 to 2.5 | Shape how quickly layers fade. |
| `peak` | 0.01 to 1 | Set the final peak amplitude. |

`pitchContour` locks all pitch shifts and glides over each layer's
normalized time. `duration` locks the total play time. `attack`
locks each layer's gain ramp in samples, even if the cue's duration
changes. Cues must be long enough to fit their attacks. A bound on
a locked control must include its source value.

The batch's `manifest.json` records the source, resolved settings,
WAV hashes, and paths to the standalone recipes. Each saved recipe
includes the resulting shape, including the reference duration used
to compute attacks. Its render report lists the per-layer attack
lengths in samples. Use `music sound render` to rebuild any variant
or pass the recipe directly to an audio asset table. Regenerating
in the same directory updates the manifest and keeps earlier
variant paths usable.

`audio.mutateSoundRecipe` exposes the recipe array on `value` and
the repeatable batch plan on `plan`. It accepts the same settings as
`KIT.procedural.mediaGraph.soundRecipe.mutate(recipe, settings)`.

## Use the same sound in Ink

- **Graphs.** Connect a recipe record to `audio.renderSoundRecipe`.
  The node exposes `value` as an ordinary audio buffer, plus the
  resolved `recipe` and `report`. An asset with
  `{"format":"sound-recipe","file":"confirm/recipe.sound.json"}`
  can feed `audioAsset` directly. A locked registry can pin the file
  as a versioned `sound` asset. A patch can also read a recipe through
  its usual audio input.
- **Music, editing, and live sessions.** Refer to the `.sound.json`
  path in a named asset table wherever the mixer, racks, editorial
  sessions, music production, or live score uses loaded PCM. An
  editable Ink session travels with the recipe during a DAW handoff.
  Groove editing, rehearsal, atmosphere, and critique use the same
  production assets.
  REAPER editorial handoff keeps the recipe in the Ink project and
  prints WAV media for the workstation. Use the exported WAV for
  paged live streams.
- **Samples and pads.** Use the path as an input to the instrument
  builder or sample kit. Sample catalog capture accepts it as a
  `file` input and stores the resolved recipe in the sample provenance.
- **World cues.** Put the recipe path in a scene soundtrack's
  `assets` table. The usual spatial cue binds that named asset to a
  committed event. A recorded story mix keeps its onset, position,
  and beat ID.

Node and browser hosts can call
`KIT.procedural.mediaGraph.soundRecipe.render(recipe)` and pass the
result's `value` to existing PCM consumers. A graph's seed is independent
of the explicit seed stored in the sound recipe.

## Hear the Relay Dispatch demo

```sh
node scripts/build.js node
node examples/seeded-sounds/demo.cjs ./relay-sounds
```

The reel plays all six families in order at approximately 0.15, 1.15,
2.15, 3.15, 4.15, and 5.15 seconds. The demo also rebuilds the impact
WAV byte for byte, verifies the graph print, captures a catalog sample,
and renders a spatial mix from a recorded world run.

Run the variations demo to hear the original jump followed by four
variants with locked pitch and attack, then the original charge
followed by four variants with pitch, attack, and duration locked.

```sh
node examples/seeded-sounds/variations.cjs ./sound-variations
```

[Ink mixer](audio-mixer.md) · [Sample catalog and editing](sample-capture.md) · [Story audio](adaptive-story-audio.md)
