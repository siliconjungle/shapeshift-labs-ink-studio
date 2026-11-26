# Capture sparse scene poses

Capture a pose from current control edits. Ink samples the base timeline at the capture time and saves just the properties whose values differ. The pose sequence remains editable JSON.

A control edit file uses native timeline targets.

```json
{
  "changes": [
    { "target": "/poses/shutter/rotation", "value": [0, 0, -0.32] },
    { "target": "/effects/0/strength", "value": 1.4 },
    { "target": "/camera/yaw", "value": -0.2 }
  ]
}
```

A second JSON scene with the same scene ID also works. Ink reads edited camera and effect properties and sampled timeline changes. Use a control edit file for new offsets on a named rig part. The supported properties use [the scene timeline's channel names and units](scene-timeline.md#dioramas).

```sh
ink-studio scene-pose capture stage.json edits.json --id flap --at .125 --duration 2 --hold .25 --blend smooth --out first.json
ink-studio scene-pose capture stage.json later.json --sequence first.json --at .75 --out two-poses.json
ink-studio scene-pose capture stage.json empty.json --sequence two-poses.json --at 1 --out poses.json
ink-studio scene-pose apply stage.json poses.json --out posed.json
ink-studio clip posed.json --from 0 --to 2 --fps 12 --out playback.png
```

Use `{"changes":[]}` for an intentional blank pose. An unchanged scene or control packet can also produce a blank pose. A blank pose leaves the underlying scene in control until the next key. Use `--sequence` to append a key or replace the key at the same time.

## Holds and blending

The pose's `hold` delays the transition by that many seconds. Its `blend` sets the curve after the hold. Use `step` for a cut, or one of the native timeline easings such as `linear`, `smooth`, or `in-out-sine`.

Only properties keyed on both adjacent poses interpolate across the interval. An outgoing-only property holds until the next key starts and then returns to the underlying scene. An incoming-only property activates at its own key. Discrete values, such as camera projection, change at the key. Angular and positive channels use their native shortest-angle and geometric interpolation.

The sequence's duration sets its exclusive end. Apply writes native timeline overlays beside the source scene so relative assets keep working. Existing tracks and cues remain editable, including cues on the exact boundary where a pose releases.

Run the [Relay Shutter demo](../examples/scene-poses-demo.cjs) with `node examples/scene-poses-demo.cjs /tmp/ink-scene-poses`. The study shows a held pose, an eased move, a blank interval that exposes the underlying lamp track, and a separate stepped move.
