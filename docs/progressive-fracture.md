# Progressive fracture

A fracture plan cuts a convex host into closed cells, assigns material laws
to their shared faces, and transfers released groups into Ink's swept rigid
mechanics. The headless commands use the same world system as a compiled
scene, recording, or solver network.

```sh
ink-studio fracture prepare examples/progressive-fracture/stormglass-span.json --out preparation.json
ink-studio fracture compile examples/progressive-fracture/stormglass-span.json --out fracture.world.json
ink-studio fracture run examples/progressive-fracture/stormglass-span.json --out stormglass
ink-studio sim verify stormglass/fracture.run.json
ink-studio sim render stormglass/checkpoints/56.json --colored --out fracture.png
```

Omit `--out` to print JSON. A run directory contains the preparation, compiled
world, native recording, sampled `report.json`, and requested native
checkpoints. Use the recording alone to replay from the beginning, or resume a
checkpoint with `ink-studio sim resume checkpoint.json --ticks 32`. Checkpoints
carry the source plan, surviving islands, material history, and pending
commands.

## Prepare cells and seams

A version 1 `ink-studio/fracture-plan` specifies an `id`, `host`, and a
`materials` table. Use a native `box` or closed `convex` collider as the host.
There are two ways to author sites. Combine two to twelve generated and
explicit sites in one plan.

| Entry | Fields |
| --- | --- |
| `sites[]` | `id`, an interior `point`, `material`, optional `weight`, `group`, and `anchored`. Positive weights grow the power cell. |
| `guides[]` | `id`, seam point `at`, `normal`, `span`, and two `sides`. Each side names an `id`, `material`, and optional `group` and `anchored`. The mirrored sites place the shared face on the guide plane. |
| `groups` | Named groups with an optional `parent`. The preparation retains nested groups, member IDs and inclusive masses. |
| `seams` | Per-face overrides keyed by the two lexically sorted site IDs, separated by `/`. |
| `stretch`, `rotation` | Optional power-cell anisotropy and Euler XYZ rotations in radians. Guides keep their authored planes under the transformed metric. |

A guide or seam override can assign a bond `material`, a `strength` multiplier,
and a `bendAxis` tangent to the face. An override takes precedence over its
guide. An unassigned seam uses the endpoint material with the lower tensile
strength. Positive bend rotates the B side around the stored axis when the A
side is held. A guide is rejected if its sites fail to share a face at the
authored point.

The report retains each cell's convex hull, center of mass, volume, inertia,
material, group, and anchor flag. Each shared face supplies a stable
constraint ID, area, normal and pivot. Exact closed-hull volume is checked
against the host. Cells must fit the native 24-vertex, 32-face convex body
limits.

## Run progressive failure

Each material has a `law`, a `density`, and per-area `tensile`, `shear`, and
`flexural` strengths. The normalized load for each channel divides the
authored effort by that strength, the exact shared face area, and the seam
`strength` multiplier. Positive tension contributes to damage. The magnitude
of shear or bend can also contribute. The largest active ratio accumulates
damage above the material's `yield` at the configured `damageRate`. At damage
one, the constraint separates permanently.

| Law | Behavior |
| --- | --- |
| `brittle` | Retains the joint pose as damage accumulates and emits `fracture-crack` at failure. |
| `ductile` | Bends around the face pivot. `elastic` controls the recoverable angle. Load beyond yield accumulates signed `plasticRate` curvature, capped by `maxBend` in radians. Emits `fracture-yield` and can later emit `fracture-break`. |
| `fibrous` | Positive tension stretches the seam along its normal. `maxStretch` caps elongation as a fraction of the rest centroid distance. The same elastic and plastic controls determine recoverable and retained stretch. Emits `fracture-tear` at failure. |

The optional `simulation` section takes `dt`, `ticks`, `sampleEvery`, and a
list of `checkpoints` at exact ticks. `loads` are
`{tick, bond, tension, shear, bend}` rows. Each row replaces the seam's held
load. Omitted components are zero, so a row with just the tick and bond
unloads that seam. `settings` exposes `ground`, `gravity`, `drag`,
`contactIterations`, `motionRate`, and relative collision `skin`. The
optional native `visual` record can use `fields.bodies: "failure/bodies"`.

In a composed world or solver network, use the `material-failure` operator with
the fracture plan in `config.plan`. Supply the `load` action or send the same
load records through the `loads` event input. The `failure` event output emits
yield, crack, tear, break and handoff records. Probe `pieces`, `constraints`,
`islands`, `contacts` and `contact-limited` to inspect the result. Cell IDs remain available
as native poses across release and subsequent splits.

Supported islands use an anchor-rooted tree for visible flex. Additional
seams in a cycle contribute to connectivity and accumulate their own damage.
When support is lost, the detached cells become a rigid compound at their
current pose. The release fits one rigid velocity from the cells' mass and
momentum. Further splits of a moving compound inherit its angular velocity and
sample its velocity at each child center. Intact seams inside a free compound
retain their local pose while their damage can still advance. Handoff events
report pose and momentum errors, member IDs, and parent lineage. The load model
uses authored efforts and exact contact faces with a bounded piece count.

## Stormglass Span

Run `node examples/progressive-fracture/demo.cjs stormglass` to render a fixed
camera comparison sheet and a loop. The scene shows permanent copper bend, a
crack through a glazed score, and a woven seam tearing after the first piece
is already falling. The demo verifies the native recording and compares
inspected poses, constraints, and contacts after restarting from four saved
checkpoints.
