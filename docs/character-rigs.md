# Headless character rigs

Build a skeleton from reusable components, solve several contacts and
directions together, and use one pose on the character's meshes, splats
and depth proxies. Rig plans, bindings, IK requests and poses are JSON.
Use [layered character motion](character-motion.md) to mix clips,
retarget contacts, and record edited controls back to curves.

```sh
ink-studio character-rig templates
ink-studio character-rig assemble rig-plan.json --out rig.json
ink-studio character-rig solve rig.json targets.json --out pose.json --require-solved
ink-studio character-rig inspect rig.json --pose pose.json
ink-studio character-rig bind rig.json bind-plan.json --out binding.json
ink-studio character-rig preview rig.json binding.json pose.json --view view.json --out preview
```

The [headless skinned crowd bake](skinned-crowd.md) reuses these bindings across agents and adds optional muscle-driven skin deformation.

## Place and assemble components

The built-in `torso`, `arm` and `leg` templates have neutral rest
poses and authored limits. Define a local template under `templates`
with a list of `joints`. Each joint has an `id`, a rest `at` point,
an optional local `parent`, and a `limit`. A template has one root.

A component instance prefixes its joints with the component ID.
Attach a component to another joint with `attach`. Supply an
`offset` in rig coordinates, uniform `scale`, or `mirror: "x"`
on an instance. `joints` replaces selected template-local positions
before mirroring and scaling. Use `placements` at the plan level to
author absolute rig-space positions. An attachment follows the
resulting position of its parent joint. Input order can differ from
parent order.

```json
{
  "format": "ink-studio/character-rig-plan",
  "version": 1,
  "id": "surveyor",
  "components": [
    {"id": "body", "template": "torso", "offset": [0, 1.13, 0]},
    {"id": "arm-r", "template": "arm", "attach": "body.chest", "offset": [0.4, 0.08, 0]},
    {"id": "arm-l", "template": "arm", "attach": "body.chest", "offset": [-0.4, 0.08, 0], "mirror": "x"}
  ]
}
```

Joint `limit` types are `fixed`, `hinge` and `ball`. A hinge has
a nonzero local `axis` and an `angle: [min,max]` interval. A ball
uses three rotation intervals in `angles`, in intrinsic X, Y, Z
order. Intervals are in degrees and include zero so the rest pose
is valid. An instance's `limits` record can replace selected joint
limits before mirroring. Child bone lengths come from the assembled
positions. Instances can attach at a coincident socket.

## Solve and inspect pose constraints

A version 1 `ink-studio/character-ik` request has a list of up to
16 `targets`. A position target names an `id`, a `joint`, and an
`at` point in rig space. An optional `offset` locates a rest-space
marker relative to the joint, such as the sole below an ankle pivot.
A direction target supplies `direction: {"local":[0,1,0],"at":[0,1,0]}`
for the axis before pose and the desired posed direction. Combine
position and direction to plant a sole and keep it level. A separate
low-weight position target on a knee or elbow can guide its bend.

Set `weight` and `tolerance` on a position target. Direction settings
have their own weight and tolerance, with tolerance in degrees.
The solver considers all targets together. It adjusts the permitted
joint angles and optional root translation. `root: {"min":[-0.2,-0.2,-0.2],"max":[0.2,0.2,0.2]}`
sets its travel bounds, which include zero. Root translation defaults
to fixed. `initial: {"angles": {...}, "root":[0,0,0]}` can seed from
a nearby pose. Supply one angle for a hinge or three for a ball.

A pose receipt shows actual target positions and axes, residuals,
per-joint limits, angles at their limits, root translation, and
bone-length drift. Targets are weighted goals. When they conflict or
sit outside the available reach, Ink saves its best evaluated pose
with unmet targets flagged. `--require-solved` returns exit status 2
after writing that diagnostic pose. Use `inspect --pose` to reopen
it and see the rig and pose together.

## Bind the rest assets once

A version 1 `ink-studio/character-bind-plan` has a `carriers` list.
Each carrier has a unique `id`, `type`, and relative `file`.

| Carrier | Rest asset | Binding |
| --- | --- | --- |
| `mesh` | Native retained mesh topology or indexed triangle JSON | Retained skin weights, explicit named weights, automatic weights, or a rigid joint |
| `splats` | Version 1 `ink-studio/character-splats` JSON | Explicit named weights, automatic weights, or a rigid joint |
| `proxy` | Native retained mesh topology or indexed triangle JSON | Explicit named weights, automatic weights, or a rigid joint |

The splat asset's `splats` list contains `at`, `normal`, `radius`,
`thickness`, and `color`, with optional `opacity` and `material`.
The indexed mesh form accepts `points` and triangle `faces`, with
optional UVs, normals and material slots. Name retained mesh
material colors with `materials: [{"id":"enamel","color":"#378893"}]`
on the carrier. Supply an optional `scene.palette` and
`scene.proxyTolerance` in the binding plan.

A rigid bind supplies `joint`. For automatic weighting, use
`weights: "auto"` and optionally restrict the pool with `joints`.
`influences` and `falloff` tune the proximity weighting to joint
segments. For explicit weights, supply an array with one named
weight record per carrier point. For retained meshes that means
the rendered vertices, which may split at corners. To keep authored
vertex weights through such splits, use `weights: "native"` on a
retained mesh. Ink selects native weights by default when a skin
exists and the carrier has no other weight controls. Meshes and
proxies allow four influences per point. Splats use Ink's two-bone
deformation.

The binding records the rig revision, rest asset hashes and normalized
weights. Reuse it across poses. The native preview poses rest assets
from those same matrices and writes a PNG, posed carrier geometry,
and a receipt with movement and depth proxy evidence. The posed
splat data includes the six packed covariance terms. The published
revision is linked from `latest.json`. Set camera, dimensions, or
`proxies: false` through the optional view document.

## Demo

```sh
node examples/cinder-surveyor-rig.cjs cinder-surveyor
```

Cinder Surveyor assembles mirrored arms and legs around a torso.
Both boots stay planted while the right hand reaches, the left hand
braces, and the head aims. The comparison shows a native render
and the solved skeleton. The same chest transform moves the enamel
mesh attachment, its splat pigment, and its depth proxy.
