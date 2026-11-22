# Interactive story installations

A patch show can map tracking, MIDI, and OSC signals to named world interventions. A mapping chooses a grant from the live world's access policy. The policy sets the native command and its arguments. For a story choice, the grant typically uses `world/story-choose` with the story, stage, visit, branch, and reason.

Run the world with an access policy that grants those interventions to the show's principal. Use `--record` to capture the run. Add the issued URL and scoped credential to the show's `liveWorld` settings.

```sh
ink-studio sim live harbor.world.json --policy harbor.access.json --ticks 240 --record harbor.run.json
ink-studio patch show show.json --record-interventions harbor.ndjson --report show.report.json
```

## Bind inputs in the cue file

Add the `installation` section to your version 1 [patch show](patch-tooling.md#run-a-patch-as-a-show). Use any combination of these bindings.

```json
{
  "midi": { "channel": 2 },
  "osc": { "port": 9102 },
  "installation": {
    "tracking": {
      "output": "regions",
      "size": [640, 360],
      "dwellFrames": 4,
      "minConfidence": 0.65,
      "zones": {
        "signal": { "rect": [0.6, 0.2, 0.3, 0.55], "grant": "release-lantern" }
      }
    },
    "midi": {
      "notes": { "60": "hold-lantern" },
      "programs": { "3": "release-lantern" }
    },
    "osc": {
      "address": "/harbor/choice",
      "choices": { "release": "release-lantern", "hold": "hold-lantern" }
    }
  }
}
```

| Source | Trigger and recording |
| --- | --- |
| Tracking | Publish a named `array<record>` output such as `patch.track:value` or `patch.smoothTracks:value`. Each visible track supplies a positive integer `id`, pixel `center`, and `confidence` from zero to one. `size` defaults to the show's video dimensions. Zones use normalized top-left X/Y/width/height. A zone fires after the same eligible track occupies it for consecutive successful frames with fresh video, when a video source is present. Defaults are three frames and 0.5 confidence. A fresh observation of an empty zone rearms it. The journal records the zone, track ID, center, confidence, and dwell count. |
| MIDI | The attached projector bridges MIDI from the named input or the first connected device on the configured show MIDI channel. Positive-velocity Note On fires once per hold. Note Off or zero velocity rearms the note. Program Change fires for each mapped message. The journal records the MIDI bytes. |
| OSC | Send one string argument to the exact installation address using the show's OSC receiver. Each mapped string selects a grant. The installation address is separate from the preset address. The journal records the address and choice string. The show uses loopback by default. |

The cue file can be used for read-only playback with no journal flag. With `--record-interventions`, each mapped signal observed after the first rendered frame generates a `world-intervention` pulse and a unique request ID. Ink writes and flushes the proposal, including the last rendered world cursor, before submission. The live service validates the credential, grant, and cursor and schedules the normal command. Native story rules still decide whether the current stage accepts it.

Use `--rehearse` to journal live device signals as previews. You can combine device bindings with a local operator on `--intervention-input -` if video uses a separate source. When `--intervention-input` names a recording file, live device choices are inactive and only that file supplies proposals.

## Replay a recorded branch

```sh
ink-studio patch choices harbor.ndjson harbor.run.json --out replay.json --track choices.input.json
ink-studio beat <beat-id> replay.json
ink-studio patch show show.json --rehearse --intervention-input choices.input.json --record-interventions rehearsal.ndjson
```

`patch choices` runs a deterministic native replay without the camera, controller, or live server. It matches each scheduled input receipt to the original native command ID and tick, then finds the committed branch or native rejection caused by that command. Results carry the original show frame, device evidence, chosen branch, and beat links to the decision and its ending if it closed the story. A scheduling receipt alone does not establish that the branch committed. The report flags missing commands, pending ticks, and unconfirmed receipts. With `--track`, a verified export contains one portable input pulse per committed command.

## Try the harbor demo

```sh
node scripts/build.js node
node examples/story-installation/demo.cjs ./harbor-installation
```

The demo uses a tracking clip, a simulated MIDI sender through the projector connection, and a local OSC message against three runs of the same story. Tracking and OSC light the lantern. MIDI holds it in reserve. Each run includes its journal, native recording, verified branch report, and replayable input track.

[World access and intervention permissions](world-access.md) · [Recorded operator inputs](story-integration-inputs.md) · [Story presentation packs](story-presentation-pack.md)
