# Retained sculpt sweeps

Sweep a bounded brush through ordered poses to make a shaped solid or
carve an existing sculpt. The saved scene keeps the brush, authored
poses, pressure, and blend radius. Revise them without rebuilding the
source sculpt by hand.

```sh
ink-studio sculpt-sweep add base.json fin.json --out raised.json
ink-studio sculpt-sweep cut raised.json channel.json --target gauge --out carved.json
ink-studio sculpt-sweep inspect carved.json --target gauge --id channel
ink-studio sculpt-sweep update carved.json revise.json --target gauge --out revised.json
ink-studio render revised.json --ortho --px 1 --out revised.png
```

`add` creates a named solid. With `--target`, it adds a union modifier
to that solid. `cut` adds a subtractive modifier and retains the host
material on the cut. Targeted poses are in the host's rest coordinates,
before its scene transform or rig motion. On a standalone sweep they
are in the sweep's own rest coordinates.

Use [stroke snapping](sculpt-snaps.md) to follow a surface with a
whole sweep or attach the root of a free sweep.

Both operations take the same request. This custom three-point profile
makes a tapered groove. The profile lies in local XY and its depth
runs along local Z. The poses below rotate that Z axis along the path.

```json
{
  "id": "channel",
  "brush": { "kind": "profile", "points": [[-0.3, 0.2], [0, -0.3], [0.3, 0.2]], "depth": 0.3 },
  "poses": [
    { "point": [-1, 0.4, 0], "rotation": [0, 0.707107, 0, 0.707107], "pressure": 0.65 },
    { "point": [1, 0.4, 0.2], "rotation": [0, 0.707107, 0, 0.707107], "pressure": 1.2 }
  ],
  "blendRadius": 0.06,
  "res": 0.06
}
```

| Brush `kind` | Dimensions in local units |
| --- | --- |
| `wedge` | `half: [x,y,z]`. A right triangle occupies the XY half-box and is extruded along Z. |
| `box` | `half: [x,y,z]` and optional `round`, bounded by the smallest half-size. |
| `torus` | `major` and `minor` radii. The ring is centered on the local Y axis. |
| `profile` | `points`, an ordered XY polygon with 3–64 vertices, and `depth` along Z. |
| `sphere` | `radius`. |
| `capsule`, `cylinder` | `radius` and `length` along Y. Capsule length is the distance between the cap centers. |
| `mark-profile` | An inline [custom mark profile](mark-profiles.md) and optional second profile to mix along the stroke. |

One pose makes a dab. A sweep accepts up to 1024 poses.
Each pose takes an XYZ `point`, a quaternion `rotation` in `[x,y,z,w]`
order, and uniform `pressure` from 0 to 4. Defaults are identity
rotation and pressure 1. Between poses, position and pressure interpolate
linearly and rotation interpolates on the shortest quaternion arc.
Pressure zero tapers the brush to a point. Supply additional poses to
author a curved path or a rotation beyond 180 degrees.

Set `path: "ruled"` to evaluate a straight guide between distinct endpoints.
The optional [pressure response](painting-3d.md#dabs-pressure-and-ruled-strokes)
sets brush scale and opacity from the recorded pressure. Standalone shapes
can render translucently. For paint layered over a receiving solid, use
a retained 3D painting with a surface attachment.

Ink evaluates a bounded approximation from intermediate poses. The
optional `step` limits how far the brush moves between evaluations,
including changes in rotation and scale. The default uses the brush
size and pressure, up to .06 scene units. Use smaller steps for thin
profiles and finer bends. `blendRadius` rounds joins between neighboring
evaluations in scene units. `res` is the ordinary sculpt bake resolution
for a standalone sweep. A targeted modifier renders on the host's grid.

Inspect returns the authored sweep, its evaluated bounds, pose count,
and effective step. Update takes an `id` and any subset of `brush`,
`poses`, `step`, `blendRadius`, `path`, and `pressureResponse`. A new `poses` array replaces the
previous one. Use null to clear an optional control. Keep each revised
scene beside its source so relative assets still resolve.

The headless scene editor accepts `kind: 'sweep'` in `solids` and as a
join modifier's shape. Use `updateShape` on that solid or modifier
operand to retain ordinary scene history. For field queries,
`KIT.procedural.shapeSweeps.prepare({ brush, poses, step, blendRadius })`
returns `sd(x, y, z)`, `bounds`, `sampleCount`, and `step`.

```sh
node examples/sculpt-sweep-demo.cjs /tmp/ink-sweep-demo
```

The demo writes three rendered stages, the before-and-after sheet, and
the editable scenes and requests behind it.
