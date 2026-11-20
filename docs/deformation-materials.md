# Deformation-aware materials

Store ink, wear, and wetness in a surface's rest chart. Splat and model bakes sample those marks at the current surface resolution. The marks stay with the geometry as a rig poses it or a solver stretches it.

The stamp channels are RGB `paint`, `heat` in degrees Celsius, and unit-scale `grime`, `scar`, `wear`, and `wetness`. Wear fades painted coverage and softens the base color. Wetness darkens the look and lowers roughness in model bakes. A material can use ordered `set`, `clear`, and scalar `add` stamps with rectangular, bitmap, or stroke brushes. [Stamp schema](headless-worlds.md#surface-state-that-follows-geometry)

## Retained sculpts and rigs

Add `surfaceState.charts` to a JSON solid. Each entry uses its key as the chart's surface ID and supports the following fields.

| Field | Meaning |
| --- | --- |
| `origin` | XYZ position of the chart corner at UV `[0, 0]` before the solid's transform and rig pose |
| `u`, `v` | XYZ vectors spanning the full width and height of the rest chart |
| `depth` | Positive projection distance from the chart plane, defaulting to 0.035 scene units |
| `twoSided` | Enable projection on both sides of the chart, defaulting to false |
| `stamps` | Ordered surface stamps in normalized UV coordinates |

The front face points along `u × v`. Choose a depth that reaches the intended skin. When charts overlap, the nearest compatible chart supplies the state. Confine a mark within its chart using the stamp's brush.

The editor's `setSurfaceState(state, keys)` retains the charts in the scene and records the edit in undo history. Solid transforms, folds, and warps map samples back to their rest charts. Boolean cuts that inherit an operand's charts leave the newly exposed caps at the base material. Local brush rebuilds and model exports resample the same charts. Once baked, the splats carry their marked colors through posing and release or reattachment.

Procedural sculpts can compile the same projection with `KIT.procedural.surfaceState.projection(state)` and attach it to a material with `surfaceState.bind(material, locator, builder.P)`.

## Simulated bodies and cloth

Mechanics bodies use named face charts. `surface-stamp` addresses a body and local face UV. A reshaped body keeps its original chart, and fracture pieces keep only their exterior chart windows. Fresh interior faces start dry and unmarked.

Cloth shapes can define `surfaceState` with an optional `chart` ID and `stamps`. The rest grid supplies UVs from zero to one along the authored `u` and `v` axes. Use the deformables system's `surface-stamp` action with `shape` and `stamp` to add a mark at a tick. An action can initialize the chart on an existing cloth shape. Stamps stay on the surviving triangles and net links after tearing. Collected water darkens a marked sheet while retaining its ink and wear.

The deformables system's `surface-state` field reads a `shape` and rest `uv`, or a live `face` index and three barycentric `weights`. A torn face no longer exposes a surface sample. Checkpoints and replays preserve stamp edits alongside the simulation state.
