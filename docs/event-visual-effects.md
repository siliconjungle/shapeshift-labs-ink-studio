# Event-driven visual effects

A visual effects plan adapts committed events into timed Ink renderer and patch inputs. The source location, value, original timecode and shared beat ID stay with each cue. A render samples the track without scheduling commands or changing the checkpoint.

## Render a recorded impact

From the repository root, project an effects sheet and render a recorded tick.

```sh
node cli/ink-studio.js sim run examples/event-visual-effects/spillway.world.json --ticks 112 --record spillway.run.json
node cli/ink-studio.js story effects spillway.run.json examples/event-visual-effects/spillway.effects-plan.json --out spillway.effects.json
node cli/ink-studio.js sim render spillway.run.json --ticks 37 --event-effects spillway.effects.json --colored --out east-impact.png
```

The renderer writes `east-impact-effects.json` beside the image. It lists active effects, mapped amounts, source points, beat IDs and the sample count of each projected mark. A mark with zero samples missed the retained solid geometry or its target filter. `sim render --beat ID --event-effects SHEET` renders the exact native event tick. `--recipe` records the effects sheet as an input and includes the sidecar in a reproducible shot.

A native run is replayed and verified even when retained history is disabled. A checkpoint, fixture, recorded story run bundle or portable event log can also supply committed events. These sources contribute the evidence they contain. A bundle with a native recording uses verified replay.

## Author a plan

Use `ink-studio/event-visual-effects-plan` version 1. Each named rule follows the existing presentation cue syntax. Use `on.kind` and optional `system`, `branch`, `story`, `stage` or `where` filters. `cue.bindings` maps a pointer in `cue.detail` to a pointer in the committed envelope.

```json
{
  "format": "ink-studio/event-visual-effects-plan",
  "version": 1,
  "id": "spillway",
  "rules": {
    "warm-light": {
      "on": { "kind": "spillway-impact" },
      "cue": {
        "kind": "light",
        "detail": { "value": 0, "range": [0, 1], "offset": [0, 0.8, 0],
          "duration": 0.8, "release": 0.4, "radius": 2, "intensity": 18, "color": "#ffffff" },
        "bindings": { "/value": "/payload/load", "/color": "/payload/color" }
      }
    }
  }
}
```

Omit `detail.point` to use a recorded XYZ point. The resolver checks contact and impact records, the event payload, `at`, and fact, custody or visit locations. Native replay can also resolve `{ "entity": "gate", "socket": "hinge" }` from the world at the commit tick. An imported log needs recorded XYZ or an explicit `/point` binding. A matching event with missing location fails projection. Contact and mark cues use a recorded normal and heading when available. Supply explicit bindings when an event stores them elsewhere.

`offset` is a world-space XYZ offset from the recorded point. `value` defaults to 1. `range` defaults to `[0, 1]` and maps the value linearly into a clamped 0–1 amount. `cue.delay`, `detail.duration`, `attack` and `release` are in seconds. Effects start on the exact commit time plus delay and end at the exclusive duration boundary. Attack and release multiply the mapped amount. A separately recorded event timecode remains on the source reference.

| Kind | Ink consumer | Main controls |
| --- | --- | --- |
| `light` | Downward-facing area light with fog scattering | `color`, `radius`, `intensity` |
| `fog` | Bounded ellipsoidal volume | `color`, `radius`, `height`, `density` |
| `particles` | Deterministic radial splat burst | `color`, `radius` of a splat, `count`, `speed` |
| `contact` | Directional splash and expanding contact ring on the measured plane | `color`, splat `radius`, `count`, `speed`, `normal`, `heading` |
| `mark` | Surface paint projected onto the rendered solid geometry | `pattern` (`scuff`, `soot`, `tide-line`, `repair`), `color`, `length`, `width`, `reach`, `normal`, `heading`, optional target `select` |
| `shader` | Typed world XYZ and amount on a patch | Optional `cue.target` to name a shader channel |
| `palette` | Set an effect-pass ramp while the event is active | `channel` (`fog`, `clouds`, `sky`, `emission`, `shadow`, `bounce`), `colors`, `threshold`, `geometry` |

Particle and mark colors resolve against the scene palette. The contact cue provides a visual response. To produce physical wear, use the simulation's contact system. The mark cue needs solid SDF geometry in the current render, so it is best suited to static surfaces. Palette ramps apply to an effect pass across the frame. The newest active cue for each pass takes precedence, with the mapped amount controlling its coverage threshold. Authored lights, fog, paint and unclaimed palette passes remain available. The renderer bounds simultaneous effects to its area-light limit, 16 projected marks, and 24 positive cues per fog or burst kind.

## Wire a shader patch

Use the `scene.eventEffects` graph node with a sheet. It samples at the graph or take clock and publishes `active`, the complete frame `value`, and a named shader's `amount`, `position` and `shader` record. `channel` defaults to `main`. Supply `branch` when watching a particular branch. An empty channel supplies amount 0, position `[0, 0, 0]` and an empty shader record. World rendering uses the simulation branch lineage and the current committed tick.

Connect `amount` and `position` to `patch.shader`. Its first uniform vector is seconds, amount, width and height. An optional second vector supplies world XYZ. The shader author controls the mapping into the shader's image coordinates. The [spillway shader](../examples/event-visual-effects/spillway.wgsl) maps world XZ to the canvas, then moves its center and adjusts the radius from the same event sheet as the 3D render.

Run both demos with an installed Node WebGPU binding and a GPU adapter. Omit the module path to generate the world renders and patch source.

```sh
node examples/event-visual-effects/demo.cjs /tmp/spillway-review /absolute/path/to/node_modules/webgpu/index.js
```

For marks that should last until world state changes, use [persistent visual consequences](visual-consequences.md).

See [presentation cues](story-documents.md#project-presentation-cues), [surface marks from events](caused-marks.md), [geometry-shaped atmosphere](geometry-shaped-atmosphere.md), [contact effects](contact-effects.md) and [CLI patch tooling](patch-tooling.md).
