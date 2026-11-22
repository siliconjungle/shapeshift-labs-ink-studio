# Actor performance adapters

Use a recorded story to drive cast visibility, sprite poses, prop sockets, and
lettering. The adapter projects committed events into the same presentation
cue track Ink already uses. Its outputs are presentation data.

```sh
ink-studio story performance tide.run.json performance-plan.json --out performance
```

Native recordings replay and verify their committed ticks, including runs
with history retention disabled. A simulation fixture, event log, portable
story run bundle, existing presentation cue sheet, or timeline containing a
cue sheet can also supply the cues.

## Author a cast and cue plan

The version 1 plan contains `cast`, optional `props`, and a `rules` map using
the usual presentation cue selectors and JSON Pointer bindings. Each cast
slot names a scene node, a display label, and a native story role or explicit
actor identity. Native replay resolves roles from the recording's initial
cast. Supply `actor` for an event-only source that lacks role bindings. A
cast cue can update the identity or visibility later in the performance.

```json
{
  "format": "ink-studio/actor-performance-plan",
  "version": 1,
  "id": "harbor-watch",
  "cast": {
    "pilot": {
      "role": { "story": "harbor-watch/dispatch", "role": "pilot" },
      "node": "pilot",
      "label": "Pilot",
      "sockets": { "hand": "grip" },
      "gestures": {
        "signal": {
          "duration": 0.5,
          "tracks": {
            "arm": [
              { "time": 0, "angle": 0 },
              { "time": 0.2, "angle": -0.9 },
              { "time": 0.5, "angle": 0 }
            ]
          }
        }
      }
    }
  },
  "props": {
    "chart": { "node": "chart", "home": "stand" }
  },
  "rules": {
    "signal": {
      "on": { "kind": "tide-warning" },
      "cue": { "kind": "gesture", "target": "pilot", "detail": { "clip": "signal" } }
    }
  }
}
```

| Cue kind | Target and detail |
| --- | --- |
| `cast` | Cast slot. Set `visible`, `actor`, or both. |
| `gesture` | Cast slot. Select a named clip from `gestures`. Optional `duration` retimes its local keys. |
| `expression` | Cast slot. Select a named clip from `expressions`, with the same key and duration format. |
| `dialogue` | Cast slot. Supply `text` and `duration`. Bind `/text` to a committed transcript field to carry authored lines through the adapter. |
| `prop` | Prop slot. Set `actor` to a cast slot and `socket` to one of its aliases. Set `actor: null` to return to the prop's authored `home`. Optional `visible` and `transform` control the prop locally. |

Gesture and expression clips use the same bone keys as `rig.pose`.
Disjoint bones play together. When cues overlap on the same bone, the most
recent active cue supplies that bone's pose. A timed cue is active from its
start up to its end. Cast changes and prop ownership remain in effect until
a later cue changes them.

A cast slot can carry versioned `rig` and `voice` references. A prop can carry a
`scene` reference, and a dialogue cue can override its speaker's voice through
`assets.voice`. Use `--asset-registry catalog.json` or a bundle with pinned
assets. The export verifies the asset kind and SHA-256 and passes the pinned
references to consumers.

## Connect rigging and lettering

Load `performance.json` through `jsonAsset` and feed it to
`scene.actorPerformance`. Select a cast slot with its `actor` input. Connect
`pose` to `rig.skinSprite.pose` and `caption` to `draw.text.text`. The
`cast`, `props`, and `lettering` ports expose the individual states for a
host to style or place. The adapter follows the graph clock or exact take
frame and supports seeking in either direction.

Use `KIT.world.actorPerformance.open(sheet).sample(time)` in a custom host.
The `scene(definition, sample)` helper creates a native scene graph with the
sampled cast visibility and prop parent/socket references. Use the host rig
to place those named sockets. The demo takes each grip position directly
from the skinned sprite's hand joint.

The export includes an editable `timeline.json`, exact timed lines in
`lettering.json`, and `captions.vtt` for subtitle and lettering editors.
WebVTT timestamps are written at millisecond precision, and the JSON keeps
the exact onset and end. The source tick, original event timecode, and beat
ID stay with each timed line. [WebVTT specification](https://www.w3.org/TR/webvtt1/)

Edit a cue's `time` and its matching `timecode` or remove `timecode` to
use the edited seconds. Pass the cue sheet or exported timeline back to
`story performance` with a plan that includes explicit actor identities to
render revised lettering separately from the original simulation.

## Run the demos

```sh
node scripts/build.js node
node examples/actor-performance/demo.cjs ./tide-signal-demo
```

The Tide Signal demo resolves the pilot and keeper from a native recording,
drives their sprite rigs and captions, and moves the chart from the stand
to the pilot, then to the keeper, then home. The second demo moves the
keeper's line to 1.12 seconds from a portable cue sheet and retains the
original tick 8 story choice.

[Presentation cues](story-documents.md#project-presentation-cues) · [Sprite rigging](headless-authoring.md#2d-skeletal-sprites) · [Live scene hierarchy](live-scene-hierarchy.md)
