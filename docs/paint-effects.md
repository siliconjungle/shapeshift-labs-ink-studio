# Paint effects tracks

Put boil, flow, wave, evaporation, and throb clips on one clock. Select retained marks by painting placement and mark ID. The source strokes, masks, cues, and effect settings remain editable in the scene.

```json
{
  "format": "ink-studio/paint-effects-track",
  "version": 1,
  "id": "signal",
  "cues": { "begin": 0.125, "release": 0.75 },
  "clips": [
    {
      "id": "redraw",
      "kind": "boil",
      "painting": "details",
      "marks": ["stripe"],
      "range": ["begin", { "cue": "release", "offset": 0.25 }],
      "fade": [0.125, 0.125],
      "weight": 0.8,
      "mask": { "points": [[0, 0.35, 0.12]], "radius": 0.5, "feather": 0.4 },
      "effect": { "amplitude": 0.06, "seed": 43, "cadence": { "fps": 8, "holds": [2, 1] } }
    }
  ]
}
```

Each clip has an inclusive start and exclusive end. Use seconds, a cue name, or a cue with an offset in seconds. Cue names resolve from the scene timeline's markers and events, including paths such as `intro/start`, and the track's cue table. Fade lengths are seconds. The clip weight, fades, mask, and local erasers multiply. Use `after: "hold"` without a fade-out to keep the end pose. Released particles can continue aging after a held clip.

Masks and eraser paths use scene-rest XYZ coordinates. A mask limits where a clip can act. Erasers remove some or all of the clip's influence inside their brushed paths. The source paint remains underneath. Guides sample these masks before the effects move them. Pressure and brush footprints can extend beyond a guide mask. Leave room in depth for authored guides and the surfaces they snap onto.

| Kind | Effect settings and blend |
| --- | --- |
| `boil` | Use [boil settings](painting-boil.md). Blend the seeded redraw displacement and keep authored cadence holds. |
| `flow` | Use [flow settings](painting-flow.md) with a named map, embedded map, or `{"file":"flow.json"}`. Blend the speed per station. Seam and obstacle policies still apply. |
| `wave` | Use [wave settings](painting-wave.md) with `mode: "pigment"` or `"raised"`. Blend the rooted guide displacement. |
| `evaporate` | Use [evaporation settings](paint-evaporation.md). Capture color and emission at the clip start and schedule births in clip-local seconds. Blend particle and pigment opacity. Raised cuts open where release influence reaches one half. |
| `throb` | Use [throb drivers and channels](paint-throb.md). Blend each multiplier from its neutral value of one. Overlapping lanes multiply within their channel. |

Omit standalone format, placement, target, and mark IDs from each clip's `effect` object. Track flow clips run before wave guide deformation. Native surface snapping, volume and width pulsing, and redraw run on the resulting guides. Opacity, finish, and release are sampled on the native brush or surface. Multiple flow or wave clips of the same kind run in list order. Audio and file-backed flow maps are embedded when the plan is applied. Reapply an original plan to recapture particles or refresh imported data.

```sh
ink-studio paint-effects apply source.json track.json --out animated.json
ink-studio paint-effects erase animated.json redraw eraser.json --out revised.json
ink-studio paint-effects inspect revised.json --at .5 --point 0,.35,.12
ink-studio render revised.json --t .5 --out pose.png
ink-studio paint-effects sample revised.json --at .5 --out held.json
ink-studio paint-effects bake revised.json --fps 12 --frames 12 --ortho --raw --out frames --flipbook
```

An eraser file contains `id`, `points`, `radius`, and optional `feather`, `strength`, and `enabled`. Update an existing eraser by ID or set `enabled: false` to restore its contribution. A sampled scene keeps the track editable and holds its clock at the requested time. Set the normal render time too when reviewing other scene animation. The bake writes numbered PNGs and a timing manifest, plus an animated PNG with `--flipbook`. Ordinary `clip` also plays the shared track.

```sh
node examples/paint-effects-track-demo.cjs /tmp/ink-paint-effects
```

**Tide Loom** layers seeded redraw, field motion, and a rooted sway on one strand, pulses a relief stripe with a cue, and releases a painted light into particles. **Cinder Seal** swirls two arcs and releases color around a protected section of an emissive mark. Each study saves its editable scene, mask edits, timing report, and flipbook.
