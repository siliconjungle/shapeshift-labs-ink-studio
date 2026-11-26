# Thickness bakes

Enable `thickness` in a [bake job preset](bake-jobs.md). Its overrides control the physical search, ray direction and encoding. Every thickness output includes a same-size PNG8 validity file. Open the baked result's **Download paired validity** link to keep the two files together.

```json
{
  "format": "ink-studio/bake-preset",
  "version": 1,
  "label": "Physical thickness",
  "defaults": {"size": 256, "padding": 3},
  "maps": [
    {"id": "thickness", "overrides": {
      "encoding": "exr",
      "thicknessRange": 1.25,
      "thicknessScale": 0.5,
      "thicknessDirection": "axis",
      "thicknessAxis": [0, 0, 1]
    }},
    {"id": "thickness-valid"}
  ]
}
```

## Measure a closed shell

Ink begins on the receiving surface and measures distance along a unit inward ray. It uses the first positive boundary hit. A valid hit must exit the same closed shell in the same part. An earlier hit on another shell or another part makes the sample unknown. Coincident boundaries from different shells or parts, or coincident hits with conflicting exit orientation, also produce unknown samples.

Select the direction in the map overrides:

- `geometric` uses the inward face normal. It is the default.
- `shading` uses the interpolated receiver vertex normal, oriented inward against the geometric face. Vertex normals can change the measurement angle.
- `axis` uses a fixed normalized `thicknessAxis`. Ink chooses the inward sign for each face. Grazing directions produce unknown samples.

Use `thicknessRange` for the maximum distance from the surface, including the endpoint. The default is the mesh bounds diagonal. An exit within `rayBias` is unknown. The ray stops at that boundary, so an excessive bias cannot turn a thin wall into a farther, thicker measurement. Ordinary bake-job targets measure in mesh-local units. Scene-placed targets, including the explicit self-bake mode, use scene units. Axes use the same space as the geometry.

## Identify physical parts and diagnose geometry

The whole receiving mesh participates, including submeshes whose UV charts are outside the job selection. Ink welds coincident vertices within the same thickness part. This lets a shell span UV seams and material slots. Label primitive groups using a target's optional `thicknessParts` map, or open **Thickness part labels** in the workstation:

```json
{
  "id": "housing",
  "mesh": "Valve housing",
  "submeshes": [0, 1],
  "thicknessParts": {"0": "housing", "1": "housing", "2": "liner"}
}
```

Unlabeled submeshes share a default part. A strict shell needs paired edges, a single vertex fan per welded corner, consistent winding and nonzero enclosed volume. A consistently reversed shell is oriented as a unit. The report separates open shells, non-manifold connectivity, inconsistent winding, zero volume, misses, grazing and biased rays, shell or part mismatches, coincident exits and wrong-facing hits. Use `coverage` to distinguish receiver texels from empty space.

## Encode and retain validity

- `png8` preserves the usual unitless thickness mask and remains the default.
- `png16` stores normalized thickness. Samples divide by `thicknessScale` and saturate at 1. The bitmap refresh records the physical range so the graph can read back a length.
- `exr` stores a raw float32 Y plane in physical units. `thicknessScale` sets the PNG preview range. It can clip the preview while the EXR retains the length.

The paired validity file is white for a known measurement and black for an unknown sample. Unknown thickness stores zero in all encodings. The report gives valid, unknown and clipped counts, physical extrema and the rejection breakdown. Optional `thickness-valid` also publishes validity as a regular bake map for a material graph binding. It inherits the enabled thickness map's sampling, size and padding options and accepts its own overrides. The automatic companion always matches the primary thickness output.

The [registered geometry masks](registered-material-bake.md) use the same first-exit and shell checks and publish their existing pair of masks.

## Halcyon Gauge demo

```sh
node examples/bake-thickness/demo.cjs halcyon-gauge
ink-studio bake-job serve halcyon-gauge/halcyon.bake.json --out halcyon-gauge/normal
```

Open `halcyon-gauge/index.html` to compare inward normal, oblique, short-range and PNG16 bakes. The paired validity atlas distinguishes the calibrated plates from open, non-manifold and ambiguous geometry. `reference.json` records the known inward-normal measurements and the deliberately invalid center samples.
