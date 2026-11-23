# Adaptive story audio

The score can build as danger or scarcity stays high. A discrete world beat can trigger a motif or a foley cue. A moving emitter can carry the sound with it while its tail plays.

Print a soundtrack directly from a native world recording or a run bundle containing that recording.

```sh
ink-studio story audio crossing.run.json soundtrack.json --out mix
ink-studio story audio crossing.run.json soundtrack.json --from 5 --to 147/20 --out detail
```

The command verifies native replay and writes aligned stereo WAVs plus `report.json`. It works when general event history was disabled. The default window spans the recording. Explicit windows use seconds or an exact ratio. A crop replays the available lead-in so pressure and tails are in progress at its start. A fork that begins at a checkpoint has access to that checkpoint’s score state and subsequent events. Earlier one-shots and mixer tails are outside that recorded window. Authored production timelines still start at tick zero.

The report records section entries, sampled layer gains, cue onset and arrival samples, heard position, and the final sampled position of a following cue. Cue rows carry the committed beat ID and original timecode. `ink-studio beat ID mix/report.json` finds the associated stem and sample metadata. Soundtrack assets use the existing [scene audio format](scene-audio.md), including WAV files, pinned assets, graphs and editorial sessions. The recording supplies the soundtrack world.

## Inspect playback by beat

`story audio` writes `playback.json` with one receipt per routed story cue
or stinger, including separate compound and velocity layers. The receipt
keeps the committed beat ID, the chosen asset and variant, the rendered bus,
and the source selector and position. Following cues also report the source
position when playback begins.

| Field | Meaning |
| --- | --- |
| `requestedSample` | The original cue onset on the absolute scene sample clock. |
| `plannedSample` | The requested sample plus any authored layer delay and acoustic propagation. |
| `observedSample` | The simulation tick at which the renderer received the cue, expressed on the same sample clock. Offline replay can reconstruct an onset earlier in that tick. |
| `actualSample` | The first mixer sample with admitted playback, or `null` when the cue never enters its bus. An admitted sample can still carry source silence or an authored attack. |
| `lateBySamples` | The difference between actual and planned onset, or `null` when playback never begins. |
| `fileSample` | The onset offset inside the exported WAV when that onset falls inside the print window. |

`outcome` records played, late, dropped, muted, or outside-window. A dropped
receipt can include a voice or group limit, reserved capacity, or an authored
stinger hold. A played cue can also record a later `stolenAt` sample. The
existing `receipts.json` preserves sound choices for replay. Use
`--receipts` with that file to reproduce the chosen sounds and regenerate
their playback receipts.

```sh
ink-studio beat ink:beat:switchyard/main/30.0 mix/playback.json
node examples/audio-playback-receipts/demo.cjs ./switchyard
```

In **Switchyard**, the cart is requested at 1.50 s and enters the Foley bus
at 2.25 s when it comes into range. The same playhead continues from the
original request. At 3.60 s, two of three basket impacts lose their slot.
The receipt for each request keeps its beat link and outcome. Story
editorial uses the actual samples for its playback markers.

## Drive a layer from sustained pressure

Use a named parameter on the world’s `adaptive-music` system. This parameter reads the committed danger allocation in the incident scheduler.

```json
{
  "pressure": {
    "field": "world/incident-pressure",
    "path": "/dimensions/danger/used",
    "range": [0, 2],
    "attack": 1.04,
    "release": 1.35
  }
}
```

The score can switch sections using its normal threshold and beat or bar quantization. In the soundtrack, bind a named loop layer and multiply its authored level by a continuous control.

```json
{
  "system": "score",
  "layers": { "watch-bed": { "pulse": "pulse" }, "search-bed": { "pulse": "pulse" } },
  "layerControls": {
    "pulse": { "path": "/parameters/pressure", "range": [0.03, 0.95] }
  }
}
```

`layerControls` applies to the named layer wherever it is bound to a resource-based section. It reads the score’s smoothed level once per simulation tick and interpolates gain on the audio sample grid. The input `range` maps to zero through one. An unavailable sample uses `fallback`, which defaults to zero. Give the controlled layer a positive level in the score section. Resource-based loop scores can use these controls alongside their section crossfades. [Adaptive music](adaptive-music.md)

## Attach discrete cues

Match a direct world event with `spatial.bindings`, or use an event action to request a quantized `score/cue`. For a score cue, put its resource ID in `spatial.cues`. A direct binding can address a fixed point, an entity or a socket. A typed world fact can supply its location as `fact.at`.

```json
{
  "cues": {
    "ferry-rope": { "asset": "rope", "bus": "foley", "follow": true }
  },
  "bindings": {
    "haul": { "on": { "kind": "haul-line" }, "cue": "ferry-rope" }
  }
}
```

With `post: {}`, route each cue to `foley`, `effects`, `ambience`, `music`, or `dialogue` using `bus`. Existing spatial cues with fixed points use that point for the whole sound. On the offline mix, a cue with `follow: true` and an entity/socket selector updates its panning, distance and occlusion as the source moves. A missing source mutes the tail while it is unavailable. Propagation delay is set at dispatch. [Spatial audio](spatial-audio.md)

## Run the demos

```sh
node examples/adaptive-story-audio/demo.cjs /tmp/crossing-watch-review
```

In **Crossing Watch**, the incident holds danger from the rescue call to docking. Listen for the pulse growing inside the first section, the score change on the bar at 4 seconds, a ferry motif on the beat at 5 seconds, and the return to the watch at 10 seconds.

**Source Sweep** isolates the 5–7.35 second window. Listen to the Foley stem in stereo as a single rope cue follows the same ferry socket from left to right. Its location and originating beat are recorded in the report.

## Audition a recorded world cue

Open a local looping player from a committed beat in a native recording
or run bundle. Find a beat in the soundtrack report or the committed
event log.

```sh
ink-studio story audition workshop.run.json workshop.audio.json \
  --beat ink:beat:audition-workshop/main/16.0 --from .35 --to 2.05
```

Open the loopback URL printed by Ink and press **Play loop**. The default
loop starts a quarter second before the cue and ends 1.5 seconds after
it, within the recording's coverage. Supply `--from` and `--to` to
include more of the interaction. The loop accepts up to 12 seconds.
Use `--receipts` to start from saved sound choices instead of generating
them again.

Choose a routed binding or the entire beat. The family menu uses the
soundtrack's named families and evaluates takes against the recorded
interaction, including its context and velocity measurement. A swap
uses the original cue's position, acoustic path, and bus. The new take
supplies its asset, gain, and pitch. Gain in dB and high-pass or low-pass
cutoffs affect the selected cue. Blank filter fields use the scene's
settings. The scene still applies its own acoustic occlusion.

The complete soundtrack renders for each change, including the beds,
other world cues, music, and post. The player keeps looping the current
mix while the new one renders. A finished revision enters at a loop
boundary. The player adds a 4 ms fade at each loop edge. Select
**Original mix** to restore the authored sound. Audition edits live in
the player session.

The demo replays one wrench impact with its original wood family, a
metal family, a quieter level, and a low-pass filter. Listen for the
room tone, relay, and second impact across all four passes.

```sh
node examples/world-cue-audition/demo.cjs /tmp/world-cue-audition
```
