# Pose-space corrective sculpts

At a bent pose, push selected splats back into shape with a radial brush. A correction blends in as the named puppet joints approach the captured rotations and goes to zero outside their activation range. The same bone transforms drive WebGL, headless renders, and sprite baking. Each stroke moves splat centers and reshapes their footprints, so lighting and relighting maps follow the repaired surface.

## Capture a correction

Use a seekable scene with a skinned `K.puppet`. Find the time and object ID you want to repair. The [Switchyard Signaler](../examples/pose-correctives/switchyard-signaler.js) captures a raised sleeve at 1.1 seconds.

Save this editable plan as `sculpt.json`.

```json
{
  "id": "Raised sleeve",
  "drivers": [
    { "part": "upper", "radius": 54 },
    { "part": "fore", "radius": 86 }
  ],
  "select": { "object": "working-shoulder" },
  "strokes": [
    { "at": [0.565, 1.519, 0.162], "radius": 0.49, "move": [-0.121, 0.172, 0.043] },
    { "at": [0.600, 1.355, -0.038], "radius": 0.37, "move": [-0.035, -0.083, 0.073] }
  ]
}
```

The brush center `at`, radius, and displacement `move` use world units in the captured pose. The optional selector restricts the brush to a named object or material. Each driver radius is in degrees around the part's captured local rotation. Multiple drivers must agree for the correction to reach full weight. Overlapping corrections share a total weight of at most one on each affected splat.

```sh
node cli/ink-studio.js pose-correctives capture examples/pose-correctives/switchyard-signaler.js \
  --t 1.1 --pose-correctives off --plan sculpt.json --out correction.json
```

Edit the brush plan and recapture to revise the sculpt. Capture saves the original plan alongside the resolved bone-local offsets. A correction asset belongs to the baked rest geometry and skin bindings it was captured from. Recapture after rebaking geometry or editing the bindings.

## Apply and review

Pass a correction JSON file or an array of corrections to `--pose-correctives` on `render`, `clip`, or `atlas`. Use `--pose-correctives off` for the base rig.

```sh
node cli/ink-studio.js pose-correctives review examples/pose-correctives/switchyard-signaler.js \
  --pose-correctives correction.json --from 0 --to 2.4 --fps 10 --w 140 --h 112 --raw --out review
```

Open `review/index.html` to play or scrub the original rig, the corrected rig, and actual tiles from the sprite atlas. **Show sculpt changes** marks where the correction affected the image. The review also writes animated PNGs, weight and pixel measurements, and the atlas with depth, normal, emission, and silhouette maps.

For a scene authored in JavaScript, update the puppet to the reference pose, call `puppet.correctives.capture(plan)`, and install it with `puppet.correctives.set([asset])`. Use `puppet.correctives.assets()` to export the installed layers and `puppet.correctives.state()` to read their current weights. A scene tool can access the same editor through `KIT.poseCorrectives.forWorld(world)`.

Use the same named local rotations to
[drive retained mesh shape keys](mesh-topology.md#drive-a-mesh-shape-key-from-a-named-pose).
A mesh key can reuse a captured splat corrective's drivers.
