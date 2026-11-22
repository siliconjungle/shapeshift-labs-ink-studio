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

[Ink mixer](audio-mixer.md) · [Sample catalog and editing](sample-capture.md) · [Story audio](adaptive-story-audio.md)
