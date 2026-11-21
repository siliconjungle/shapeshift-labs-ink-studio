# Scene soundtrack exports

Add `--audio soundtrack.json` to `export-scene` to write a stereo mix and
aligned 24-bit PCM WAV stems for timeline cues, spatial effects, adaptive
music, and authored tracks. All stems have the same sample rate and length.
`export.json` names each file and records its absolute sample window, voice
count, peak, and the shared headroom applied to the mix and stems.

```sh
ink-studio export-scene take.json --audio soundtrack.json \
  --from 0 --to 4.004 --fps 24000/1001 --out review
```

The scene source can be a diorama, a native world manifest, or a version 1
take with a native world. A take supplies the default picture rate and
its authored cuts. An explicit `--fps` selects the picture rate. The audio
window runs from the first picture frame through the final frame's duration.
The picture range's requested endpoint remains exclusive. Retimed authored
audio in an exact timeline keeps its rational onset, trimmed source offset,
and playback rate. Sound world events use their committed simulation tick.
Adaptive cues use the score's authored musical onset, including cues
delivered between picture frames.

Feed the aligned WAV files into [per-stem control signals](graph-media.md#per-stem-control-signals) to drive visuals from independent envelopes, bands, and triggers.

## Soundtrack file

All file paths are relative to the soundtrack document.

```json
{
  "format": "ink-studio/scene-audio",
  "version": 1,
  "sampleRate": 48000,
  "gain": 0.9,
  "assets": {
    "footstep": "footstep.wav",
    "bell": "bell.wav",
    "harbor/calm": "calm.wav",
    "harbor/storm": "storm.wav",
    "harbor/pulse": "pulse.wav",
    "harbor/arrival": "arrival.wav",
    "wind": { "graph": "synth.json", "output": "sound" }
  },
  "tracks": [{ "asset": "wind", "time": 0, "duration": 6, "loop": true, "gain": 0.25 }],
  "listener": { "at": [0, 1.5, 0], "forward": [0, 0, -1] },
  "spatial": {
    "cues": {
      "step": { "asset": "footstep" },
      "bell": { "asset": "bell", "at": { "entity": "beacon", "socket": "bell" } }
    }
  },
  "music": {
    "system": "score",
    "gain": 0.75,
    "fade": 0.05,
    "layers": { "harbor/storm": { "pulse": "harbor/pulse" } }
  }
}
```

- **Timeline.** Cue names refer to asset IDs or to named spatial cue
  definitions. Clips honor their duration, source offset, gain, and retiming.
  One-shot cues play the rest of the source from the authored offset.
- **Spatial.** Uses the existing [spatial audio](spatial-audio.md) configuration
  for emitters, event bindings, materials, occlusion and propagation. With a
  world, the listener and emitter geometry are resolved at simulation ticks.
  Loops interpolate gain, panning and obstruction between ticks. One-shots
  use their dispatch snapshot. The offline stereo mix uses equal-power pan,
  the spatial mix gain, its occlusion cutoff, and any enabled travel delay.
- **Music.** Select an existing [adaptive music](adaptive-music.md) system by
  its world ID. The active section's resource plays as a loop. A named layer
  maps a section's authored layer level to an additional loop. The section
  `fade` sets transition fades in seconds. Cue intents play the resource
  as a one-shot. A cue resource also defined as a spatial cue can use the
  intent's emitter.
- **Tracks.** Place a WAV or a named `audio` port from a graph. A graph asset
  can set `time`, `seed`, and `inputs`. Tracks accept `time`, `duration`,
  source `offset`, `gain`, playback `rate`, and `loop`. A looping track
  with no duration continues through the exported range.

Set optional `world` to a native world file to accompany a diorama with a
sound simulation. It supplies committed spatial and score state while the
diorama supplies picture and timeline. Native scene exports use their own
world by default. Assets can have different sample rates. The offline mixer
linearly resamples them onto the soundtrack's stereo grid.

## Optional video adapter

Pass `--mux` with a registered codec. Ink writes the review video into the
same take directory as the stems.

```sh
ink-studio export-scene take.json --audio soundtrack.json \
  --mux review --adapters host.cjs --out review
```

Under the existing `codecs` registry, add
`review: { mux({ frames, fps, width, height, audio, sampleRate, options }) } `.
The synchronous callback receives PNG byte buffers in picture order,
the exact `fps` ratio as `{ numerator, denominator }`, and the mix as WAV
bytes. Return `{ extension, bytes }`. The host chooses and supplies the
codec implementation. [Host adapters](graph-media.md#optional-host-adapters)

Node callers can load a plan with `ink.readSceneAudio(file)`, or call
`ink.createSceneAudio(config, { resolveAsset, runtime })` with normalized
audio buffers and an optional fresh-runtime factory. Pass the plan as the
`audio` option to `ink.exportScene`. A capture can return `timeline` and
`runtime` in addition to its existing image callback. Use `mux` as the
optional adapter callback.
