# SDF Shape Splatter

`image.shapeSplatter` places signed shapes on a material surface and bakes a top-down heightfield. It uses the uppermost visible surface to keep the height, normal, instance ID, shape ID and local UVs aligned. It supports the requested map-driven placement and projection workflow of Shape Splatter v2. [Adobe Shape Splatter v2 reference](https://experienceleague.adobe.com/en/docs/substance-3d-designer/using/substance-graphs/nodes-reference-for-substance-graphs/node-library/texture-generators/patterns/shape-splatter-v2)

## Shape sources

- `shapes` accepts signed 2D definitions from the [Editable Shape Library](material-shape-library.md). The renderer extrudes their signed footprint in local Y, with adjustable thickness and edge rounding. XY in a planar definition maps to X/Z on the material.
- `volumes` accepts bounded 3D SDFs from Ink's field graph. Build them with `sdf.shape`, `sdf.combine` and `sdf.transform`, or use `sdf.bound` to attach a box to a custom distance field. Collect fields into an array with `data.record` and `data.collect`.
- The two libraries can be mixed in one bake, in order with 2D shapes first. Each placement chooses a shape using the stable `shape` seed stream. The combined library supports up to 32 sources. An empty library uses a disc.
- Volumes use X-right, Y-up and Z-down the image. A volume is centered on its bounds and normalized by its longest dimension before placement. A planar source is clipped to its unit-square footprint and uses `extrusion` as its thickness.

## Placement and controls

| Control | Behavior |
| --- | --- |
| `columns`, `rows`, `jitter` | Stratified candidates on a stable 8×6 grid by default. Jitter moves them within their cells. Max 4,096 candidates. |
| `background` | Optional typed height image. It supplies the terrain height, the slope to follow, and a surface that can occlude buried shapes. Without it the floor is flat at zero. |
| `density` map | Unitless R mask or data image. Its value multiplies `options.density` to determine each candidate's seeded retention probability. |
| `mask`, `clip` | Unitless R images. Mask gates the candidate at its anchor. Clip gates projected samples and can cut through existing shapes. Both thresholds default to .5. |
| `scale`, `scaleJitter` | A uniform size or an XYZ size in height units, with independent fractional jitter on each axis. |
| `rotation`, `rotationJitter` | Degrees about local X, Y and Z, applied in that order before slope alignment. Jitter is independent by axis. |
| `slopeAlignment` | 0 keeps the unaligned orientation, 1 fully follows the background normal. Rotation and slope alignment act around the local base anchor. |
| `heightOffset`, `heightJitter` | Move the base vertically relative to the terrain height, in the same units as the background. |
| `span`, `crop`, `wrap` | Set the physical X/Z span, the normalized crop bounds and independent repeat axes. Background sampling follows repeat addressing on those axes and clamps on open axes. Crops share the same placements. |
| `extrusion`, `rounding` | Default .25 local units thick, with rounding of .035 or half the thickness, whichever is smaller. These controls apply to planar sources. |
| `uv` | Choose planar, cylindrical or spherical projection. Apply rotation about the UV center, then independent scale and offset. Addressing can be raw, wrapped or clamped. |
| `seed`, `seeds` | Lock the root seed or independently override `layout`, `density`, `shape`, `scale`, `rotation`, and `height`. |
| `samples`, `steps`, `epsilon`, `safety` | Bake with 1, 2 or 4 samples per axis and a bounded number of SDF trace steps. Reduce epsilon or increase steps to resolve finer signed features. Defaults are 1 sample per axis and 64 steps. |
| `time` | Optional seconds socket for time-varying signed fields. Use an `anim.clock` link for timeline playback. |

`span` and heights use the same unit. Units inherit from the background when connected and default to `shape-units` otherwise. When using millimeters, the output records the corresponding per-texel pitch. Optional map filtering defaults to each input image's setting and can be overridden with `options.mapFilter`.

## Aligned outputs

- `value` is the baked height, including the uncovered background. `normal` is a signed tangent normal with OpenGL or DirectX Y orientation. It uses the transformed SDF gradient on shapes and the height derivative on the background.
- `instanceId` and `shapeId` identify the winner. Both are one-based, with zero for background. Equal-height hits keep the lower instance ID.
- `uv` gives the winning local RG coordinates. Background UVs are zero.
- `coverage` is the fraction of subpixel samples that see a shape. When the pixel center misses and a subpixel hits, its closest covered subpixel supplies the aligned surface attributes.
- `layout` reports positions, scales, rotations, slope normals, rejected candidates, resolved seed streams and height-grid spacing.

The bake stores one visible surface per texel. It supports up to one million texels and enforces a trace budget based on overlaps, subpixel samples and the requested step limit. Bounded volumes need a finite signed distance field with an accurate containing box. Use `KIT.procedural.graphImages.shapeSplatter(width, height, columns, rows, shapes, volumes, maps, options, seed, time)` for direct baking.

## Silt & Stone demo

```sh
node examples/material-shape-splatter/demo.cjs /tmp/ink-silt-and-stone
ink-studio graph run /tmp/ink-silt-and-stone/silt-and-stone.material.json --out /tmp/ink-silt-replay
```

Open `index.html) to scatter rounded stones and planar relief shapes along a riverbed. Try 2D only or 3D only, change slope alignment or height offset, and switch among height, normals, IDs, UVs and coverage.
