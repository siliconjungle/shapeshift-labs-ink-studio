# Headless tissue and skinned crowds

Bake reusable indexed character skins over terrain. The bake keeps
clip transitions, planted contact receipts, a positional ragdoll
handoff, and an optional muscle-driven tissue solve. Sample an
individual frame for native posed geometry or render it from the CLI.

```sh
ink-studio skinned-crowd bake crew.json --out take.json --require-contacts
ink-studio skinned-crowd sample crew.json take.json --frame 48 --out posed.json
ink-studio skinned-crowd preview crew.json take.json --frame 48 --out preview.png
```

## Reuse a character template

A version 1 `ink-studio/skinned-crowd-plan` has an `id`, a
`templates` object, and an `actors` list. A template names its
relative assembled `rig`, `binding`, and `motion` files. Use
the same [character binding](character-rigs.md#bind-the-rest-assets-once)
and [clip catalog](character-motion.md) for every instance of that
template. The skin uses the binding's indexed mesh carriers.

An actor has a distinct `id`, a `template`, placement `at`,
and initial `clip`. `at` uses world X and Z and a Y offset over
the terrain. `velocity` moves that placement in world units per
second and `yaw` turns the character in degrees. The clip loops
unless `loop` is false. `phase` sets its starting time in seconds.
Add `transitions` in frame order. Each names its start `frame`,
destination `clip`, optional `phase` and `loop`, and a `blend`
duration in frames. Both clips continue to play during the blend.

```json
{
  "format": "ink-studio/skinned-crowd-plan",
  "version": 1,
  "id": "quarry-crew",
  "fps": 24,
  "frames": 72,
  "terrain": {"tile": "slope.json"},
  "budget": {"visible": 8, "skinned": 4, "tissue": 2, "triangles": 18000},
  "templates": {
    "porter": {
      "rig": "rig.json", "binding": "binding.json", "motion": "motion.json",
      "tissue": "lifting-arm.json",
      "rootAllowance": [0.25, 0.45, 0.25],
      "feet": [
        {"joint": "leg-left.foot", "offset": [0, -0.1, 0.08]},
        {"joint": "leg-right.foot", "offset": [0, -0.1, 0.08]}
      ]
    }
  },
  "actors": [
    {"id": "lead", "template": "porter", "at": [-1, 0, 0], "clip": "walk", "priority": 8,
     "transitions": [{"frame": 18, "clip": "lift", "blend": 8, "loop": false}]},
    {"id": "second", "template": "porter", "at": [1, 0, 0.6], "clip": "walk", "phase": 0.4,
     "velocity": [0.1, 0, 0], "ragdoll": {"frame": 44, "velocity": [0.8, 0.1, 0.2]}}
  ]
}
```

## Ground feet and hand off the moving pose

Set `terrain.plane` for a flat ground height, or name one relative
baked [terrain tile](terrain-sets.md). Contacts sample the same
triangulated heights drawn by the preview. Terrain outside a tile
uses the optional `outside` height, defaulting to zero.

A template's `feet` list names each sole joint and its local
`offset`. Clip contact windows choose which sole is planted.
When a plant begins, Ink captures the sole's world X and Z, then
keeps that anchor through the window and solves against its terrain
height. The dominant clip supplies contact windows during a blend.
A free foot receives a floor target when its sole passes below the
terrain. Use `always: true` for a sole that should stay anchored
through the entire clip. `weight`, `tolerance` and the template's
`rootAllowance` tune the whole-body solve. The take records actual
and target positions and errors. `--require-contacts` saves the bake
and returns status 2 if a contact exceeds its tolerance.

Set `ragdoll.frame` on an actor to hand off its current joint
matrices and velocities. The handoff frame keeps the animated pose
exactly. Subsequent frames use a linked positional body with
bone-length constraints, optional bend constraints, and floor contact on each
joint. `ragdoll.velocity` adds launch velocity to all joints or
only the named `ragdoll.joint`. Template ragdoll settings include
`gravity`, `damping`, `friction`, contact `radius`, `substeps`,
and bend compliance. The receipt records the handoff frame and
inherited and launch speeds, along with peak bone-length drift.

## Drive muscles, tissue and skin

A template's optional `tissue` file has format `ink-studio/tissue-model`,
version `1`, and its own `id`. Build the tissue lattice in the rig's
rest coordinates.

- `nodes` maps IDs to rest `at` points and named joint `weights`.
  A `pin` follows its skinned target exactly. Free nodes use `mass`
  and `follow` compliance to follow the skeleton with secondary motion.
- `cells` contains tetrahedra with four named nodes per cell. Shared
  edges use `edgeCompliance`. Each cell projects toward its signed
  rest volume using its own `compliance` or the model's
  `volumeCompliance`. Use `substeps`, `volumePasses`, `damping`
  and optional `gravity` to set the simulation.
- `muscles` names fibers between two nodes. `contraction` is the
  fraction of rest length removed at full activation. Set a constant
  `activation` from zero to one or a `driver` with a joint, zero-based
  control `axis`, and two degree endpoints in `range`. Use
  `compliance` to set the fiber's softness.
- A mesh vertex inside a rest tetrahedron retains its barycentric
  weights. Ink adds the interpolated tissue displacement to its
  ordinary skinned position. Use `skin.gain` and `skin.maxOffset`
  to control that transfer.

For a muscle example, place an anchored node at each end of the
region, arrange tissue nodes around the fiber, and bind the surface
inside those cells. Leave at least one fiber endpoint free for the
actuator to move. The bake reports activation, fiber length, signed
volume ratios, and inverted cells. The sample reports the largest
skin displacement on each visible mesh.

## Set visibility and replay budgets

Set `view.camera`, `view.w`, `view.h`, `background`, and `ground`
to define the registered headless shot. The camera culls projected
skeleton bounds, then ranks candidates by actor `priority`, depth,
and ID. Use `budget.visible`, `skinned`, `tissue`, `triangles`,
`texels`, and `distance` to bound work. `distance` is measured
from the camera target. Visible actors that fall outside the skin
budget use an articulated low-poly proxy. A template can set
`proxyRadius` and `proxyColor`. The `texels` budget counts
active skin atlases.

All actors keep their pose, contact, and ragdoll clocks as they move
between detail levels. A newly selected tissue solve starts from its
current skinned pose. The take records visibility, every actor's
matrices, and tissue offsets for the selected actors. Sampling a
saved frame checks the source plan and asset hashes, then rebuilds its
geometry directly.

## Demo

```sh
node examples/skinned-crowd/demo.cjs out/siltwatch-crew
```

Siltwatch Crew blends from a walk into a lift, shows an arm muscle
pulling while its tissue retains volume, and hands a moving porter
off to ragdoll on a sloped terrain tile. The contact sheet, animated
loop, posed meshes, and numerical receipts come from the same bake.
