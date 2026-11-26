# Nonlinear solids and grain contact

The headless material lab brings tetrahedral soft bodies, loose grains,
constraints, and material pairs into the same native solver. Use it for
deformation tests, matched material comparisons, and reusable world stages.

```sh
ink-studio material-lab presets
ink-studio material-lab compile study.json --out materials.world.json
ink-studio material-lab run study.json --out material-study
ink-studio sim verify material-study/materials.run.json
ink-studio probe material-study/checkpoints/36.json --field lab/strain
```

The run directory contains `preparation.json`, the compiled world, a native
recording, sampled `report.json`, and the requested checkpoints. Omit `--out`
to print JSON.

## Author a study

A version 1 `ink-studio/material-lab-plan` has an `id`, a `config` object, and
optional `run` settings. A minimal drop is:

```json
{
  "format": "ink-studio/material-lab-plan",
  "version": 1,
  "id": "grain-drop",
  "config": {
    "grains": { "bead": { "at": [0, 1, 0], "radius": 0.08, "material": "glass" } },
    "surfaces": { "floor": { "material": "felt", "shape": { "kind": "plane", "normal": [0, 1, 0] } } }
  },
  "run": { "ticks": 75, "every": 5, "checkpoints": [30, 60] }
}
```

| Configuration | Authoring fields |
| --- | --- |
| `points` | Named soft nodes with `at`, `material`, optional `mass`, `radius`, `velocity`, `pin` and `group`. Set radius zero to make a point purely structural. |
| `cells` | Named tetrahedra with four distinct `nodes`, a `material`, and optional `group`. Neighboring cells share node IDs. A body can contain cells with different materials. |
| `blocks` | Generated tetrahedral solids with `at`, `size`, XYZ `divisions`, `material`, optional `pinBase`, `radius`, and `velocity`. |
| `grains` | Loose spheres with the same point fields. Their default mass is density times sphere volume. |
| `surfaces` | Named `shape` and `material` with optional translation `at`. Shapes are native boxes, spheres, convex hulls, and one-sided planes. A plane takes a `normal`, optional `offset`, and optional tangent half extents `half: [u, v]` with a tangent direction `u`. |
| `constraints` | Rows with `points` and a `preset` or explicit `kind`. Override `target`, `compliance`, and tendon `contraction` or initial `activation`. Angles use radians. |
| `materials` | Named overrides based on a native `preset`, with density, elastic coefficients, contact coefficients, and optional display color. |
| `pairs` | Optional contact overrides under lexically sorted keys such as `felt/grit`. |

The built-in solids include silicone, foam, elastomer, and felt. Glass,
polished material, stone, and grit provide hard and granular responses.
Distance, spring, cable, spacer, hinge, and tendon presets cover fixed or
elastic distances, one-sided distance limits, angular constraints, and
driven fibers. Rest distances and angles come from the authored positions
when a target is absent.

The tetrahedral solver projects finite strain at the current deformation
gradient. Separate stretch, shear, and volume compliances let a fold,
twist, or compression response vary by material. Strain stiffening
decreases compliance at large deformation. Tetra volume determines the
default mass supplied to each corner. A lower volume bound acts as an
inversion barrier. Inspect the signed volume, ratio, and inversion count
under `lab/strain` to check a pose at the selected compute settings.

## Run and measure contacts

Set `run.dt`, `ticks`, `every`, `checkpoints`, or `maxTotalWork` to control a
study. Commands are `{tick, action, args}`. The supported actions are
`anchor` with `{point, at}`, `move-surface` with `{surface, at}`, `drive` with
`{constraint, activation}`, and `impulse` with `{point, impulse}`. Anchors
and surfaces interpolate between committed positions across substeps.
Use the native `material-lab` system with the same configuration in
solver networks and composed worlds.

Loose grains and soft nodes collide through their authored spherical radii.
Nodes in the same nonempty group share structure and skip mutual contact.
Surfaces are kinematic. Use one-sided planes for motorized stops and
platens. Contacts sample the positions at bounded substeps, so run
smaller steps when fast spheres or thin convex surfaces need finer
collision resolution. Grain mechanics tracks translation, with Coulomb
slip at contact.

Material pairs use geometric-mean static and dynamic friction, the lower
restitution, and additive contact compliance. Override
`staticFriction`, `dynamicFriction`, `restitution`, or `compliance` per pair.
The solver accumulates impulse applications for each participant pair
within a substep. A contact sample records the impulse on the named source,
its interval-average force, normal, incoming and outgoing tangential speed,
and penetration. Geometric overlap correction stays separate from the
velocity impulse.

Read the timestamped `contact-samples` event output or probe `lab/contacts`.
`lab/contact-report` supplies per-pair totals and counts. The CLI aggregates
them across all ticks, including ticks between saved frames. The detailed
sample cap limits the raw rows per tick. Pair totals include the rows
beyond the cap, with an explicit omitted count. Probe `lab/points` or
`lab/grains` for named positions and velocities.

The solver caps total points, tetrahedra, constraints, and surfaces.
`settings.substeps`, `passes`, and `contactPasses` control the number of
projections. `maxWork` bounds counted strain, constraint, spatial hash,
contact candidate, and surface evaluation operations per tick. A tick
over budget rolls back. `maxTotalWork` caps the CLI run across ticks.
`speedLimit` caps solved particle speeds and rejects over-speed
kinematic moves. Inspect `lab/work` for the operation breakdown and
`lab/contact-report` for the speed cap count.

## Bellows & Beads

Run `node examples/material-lab/demo.cjs material-study` to generate a
comparison sheet and animation from the native trace. The same platen
motion compresses two elastic bodies. Matched grain drops on felt and
polished lanes show measured differences in slip. The demo verifies the
recording and checks positions, strain, contacts and work after four
checkpoint continuations.
