# Instrument recording sessions

Map a whole performance session into a playable Ink patch. Use recordings,
procedural capture, or a mixture. The original takes and microphone clock
survive analysis, and the built patch plays through the normal score
renderer, timeline, and mix. No external tools or packages are required.

```sh
ink-studio music instrument analyze-session capture.json --out plan
ink-studio music instrument audition-session-takes plan/session.json compare-mics.json --out takes
ink-studio music instrument build-session plan/session.json --out build
ink-studio music instrument audition-session build/instrument.json --out coverage
```

## Address the recordings

Use one long WAV per perspective, or the existing sample asset references.
All perspectives must use the same sample rate. Mark a take's inclusive
start and exclusive end in samples on the shared clock. Each perspective
adds its own signed offset when reading those positions. Set the offset
from a slate or a known capture alignment. Leave the acoustic arrival
difference in the sources when you want to retain it.

```json
{
  "assets": {"close": "close.wav", "room": "room.wav"},
  "session": {
    "format": "ink-studio/instrument-session",
    "version": 1,
    "id": "braked-plate",
    "sampleRate": 24000,
    "perspectives": {"close": {"asset": "close"}, "room": {"asset": "room", "offsetSamples": 27}},
    "analyze": "close",
    "range": [48, 67],
    "registers": [55, 62],
    "dynamics": [{"id": "soft", "velocity": 0.28}, {"id": "firm", "velocity": 0.81}],
    "articulations": ["edge", "center"],
    "takes": [
      {"id": "edge-55-soft-1", "key": 55, "dynamic": "soft", "articulation": "edge",
       "fromSample": 0, "toSample": 28800, "releaseSample": 18000}
    ]
  }
}
```

Add more rows to capture register, force and playing position. Repeat the
same cell to preserve alternate strikes. Registers and dynamics increase
from low to high. The key and velocity split points fall between their
anchors, and the first articulation is the default for unmarked notes.
Use `audition-session-takes` with
`{"takes":[{"take":"edge-55-soft-1"},{"take":"edge-55-soft-1","perspective":"room"}]}`
to hear the same slice in two perspectives at a shared playback gain.

## Review and build

The analyzer proposes `onsetSample`, `attackEndSample`, a loop
`[start,end]` if the sustain supports it, and a candidate key-up range if
a sustained gesture falls into a decaying tail. It reports the original
sample addresses in each perspective, pitch confidence, body level and
brightness, clipping clues, and inferred releases. Inspect the written
`plan/session.json`, edit the positions against the originals, and pass
that recipe to the build. A `null` loop or release means omit it. Supply
`releaseSample` and optionally `releaseEndSample` to keep the actual
key-up gesture from the take. A supplied release takes precedence over
inference.

The default hybrid build chooses a representative take per populated
cell by comparing body level and brightness inside that cell. The
native fitter models its body from the held sound. The patch joins that
body to captured attacks and plays the cell's recorded key-up samples
at note-off. Register, dynamics and articulation choose independently
fitted cells, so a bright hard strike can have different modes and decay
from a quiet stroke. The captured attacks and key-ups rotate separately
inside their selected cells. Graph pressure, breath, damping and contact
controls remain editable.

| Build setting | Effect |
| --- | --- |
| `perspective` | Use the named perspective when extracting attacks, held audio, and key-ups. Defaults to `analyze`. Stereo captures retain stereo attack and release. |
| `body: "hybrid"` | Fit native spectral or resonant graph nodes and join the captured attack to the fitted body. |
| `body: "recorded"` | Use the representative recording for the body. A valid loop makes it sustain with a crossfade. |
| `fit: "modal"` | Prefer measured modes for ringing material. Falls back to the spectral fit when modal evidence is unavailable. Other settings are `"auto"` and `"spectral"`. |
| `fill: "none"` | Leave missing cells silent. The default `"nearest"` can borrow a nearby cell of the same articulation. |
| `alternates` | Keep one to three takes per populated cell. The source session retains all takes. |

Analysis supports up to 128 take windows and 96 coverage cells. An
individual native patch supports up to 16 populated cells at this
stage. The report shows which cells were recorded, have only one take,
use a donor, or are missing. Captured and playable take counts are separate.
Key-up and loop coverage have separate
flags. The bundled source assets are original slices with short edge
fades. The model report keeps the representative, alternates, partials
or modes, and acoustic evidence per cell.

## Play the result

The coverage command writes a WAV and an ordinary production recipe.
Its report gives start/end samples, peak, RMS, key-up RMS, and the
assigned cell for each probe. Each playback uses a common gain so
hard and soft dynamics remain audible. Use a settings file for an
edge key, longer hold, touch control, or velocity split.

```json
{
  "cases": [
    {"id": "long-soft", "key": 67, "velocity": 0.28, "articulation": "edge", "gate": 1.5},
    {"id": "firm-damped", "key": 55, "velocity": 0.81, "articulation": "center",
     "gate": 0.45, "play": {"damping": 0.65, "contact": 0.24}}
  ]
}
```

To use a build elsewhere, copy `instrument.patch` into the production's
patch table and resolve the baked assets relative to `instrument.json`.
JavaScript uses `KIT.procedural.mediaGraph.instrumentSession` with
`analyze(session, assets)`, `build(session, assets, options?)`,
`audition(instrument, assets, options?)`, and
`auditionTakes(session, assets, options)`. The graph equivalents are
`audio.analyzeInstrumentSession`, `audio.buildInstrumentSession`,
`audio.auditionInstrumentSession`, and `audio.auditionInstrumentSessionTakes`.

Run `node examples/instrument-session/demo.cjs output` for Paper Reed,
Braked Plate, and Copper String. The takes are procedurally generated
with aligned close and room perspectives. Braked Plate includes the
bundled [Versilian brake-drum recordings](../examples/music-production/samples/CREDITS.md).
The listening desk covers all three libraries, the looped room build,
and an editable trio made from the workshop patches.
