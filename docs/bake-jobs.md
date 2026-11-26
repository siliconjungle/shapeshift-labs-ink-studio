# Bake jobs and presets

Bake selected glTF surfaces into individual UV tiles. A job records which surfaces to use and which material resources receive the result. A named preset records the map order, enabled maps, default settings and individual map overrides. Reuse a preset across models or give a particular map a different resolution without changing the other outputs.

```sh
ink-studio bake-job inspect chart.bake.json
ink-studio bake-job run chart.bake.json --out chart-review
ink-studio bake-job preset chart.bake.json --out enamel.preset.json
ink-studio bake-job serve chart.bake.json --out chart-review --port 0
```

Add `--preset enamel.preset.json` to use a different preset. The browser workstation opens at the loopback URL printed by `serve`. Select the mesh, primitive, material slot, UV set and tiles in each target. Enable maps, change their order with the arrow buttons, and open the override controls next to the resolution. Load or save the preset as JSON. Start a bake and follow each map and tile as it completes. The command-line runner emits progress to stderr with the completed result on stdout. Cancel in the workstation or interrupt the CLI with Ctrl+C.

## Define the targets

```json
{
  "format": "ink-studio/bake-job",
  "version": 1,
  "label": "Painted chart",
  "source": "chart.glb",
  "preset": "enamel.preset.json",
  "targets": [
    {"id": "chart", "mesh": "Signal chart", "submeshes": [0], "slots": ["Glaze"],
     "uvSet": 1, "tiles": [1001, 1002]}
  ],
  "refresh": {
    "material": "author.material.json",
    "bindings": [
      {"target": "chart", "map": "pigment", "resource": "chart-color", "storage": "linked"},
      {"target": "chart", "map": "normal", "resource": "chart-normal", "storage": "embedded"}
    ]
  }
}
```

Use a zero-based mesh index or a unique exact name. Select primitives by zero-based `submeshes` indices and material slots by name. When both filters are present, a primitive must match both. The default is every primitive, UV set zero and tile 1001. Tiles can also be signed `[u,v]` pairs. Triangles crossing a tile boundary are clipped there, with their original surface coordinates retained for texture lookup. Geometry probes use the full mesh in mesh-local space so unselected slots on that mesh can still affect cavity, exposure and thickness.

Use static triangulated GLB or glTF with PNG source textures. Scene files in other formats can be converted through [scene resources](scene-resources.md). Give the surfaces non-overlapping bake UVs. Skinning, animation, and scene instance transforms are outside this bake. A job supports at most 24 targets, 32 tiles per target, 192 enabled map and tile combinations, and 12 million total output texels. Geometry masks carry their own ray budget.

## Set the map order and overrides

```json
{
  "format": "ink-studio/bake-preset",
  "version": 1,
  "label": "Enamel maps",
  "defaults": {"size": 192, "padding": 3},
  "maps": [
    {"id": "pigment"},
    {"id": "normal", "overrides": {"size": 128, "orientation": "directx"}},
    {"id": "cavity", "overrides": {"samples": 12, "cavityRadius": 0.3}},
    {"id": "coverage", "enabled": false}
  ]
}
```

Base maps include `pigment`, `normal`, `roughness`, `metalness`, `emission`, `opacity`, `coverage`, `slope`, `cavity`, and `exposure`. See the guides below for additional maps. All maps accept square `size` from 8 to 1024 and `padding` from 0 to 32 pixels, strictly below half the size. Normal accepts `opengl` or `directx` tangent orientation. Slope takes an `up` vector. Cavity and exposure take `samples` from 4 to 64 and the corresponding `cavityRadius` or `exposureDistance` in mesh units. Thickness takes `thicknessScale`. Probe maps accept a `rayBias`. Job-wide geometry settings can be provided in preset defaults. Relative filenames in a job resolve from the job file.

## Review and refresh

A completed bake writes the map files, the report, a portable browser review, and the refreshed material graph when a refresh was configured. Every run gets a revision folder. Use the output directory's `latest.json` to locate the latest successful revision. An incomplete, failed or cancelled bake leaves the prior revision available.

A linked resource points to the new revision's image files. An embedded member stores the new image bytes with an origin path for later reimport. Existing resource IDs and unwritten tiles carry forward. Tiles in one resource share extent, precision and interpretation. If an override changes that contract, include every tile of that resource in the bake. The seed material is kept as authored.

```sh
node examples/bake-jobs/demo.cjs brineglass-demo
ink-studio bake-job serve brineglass-demo/brineglass.bake.json --out brineglass-demo/review
```

Brineglass Signal bakes two enamel designs from UV0 onto two tiles in UV1 and includes a separate fitting. Inspect the pigment, tangent normals, surface roughness, coverage and cavity. The completed review opens from the revision's `index.html`. The local workstation also runs jobs and cancels active bakes.

## Project high detail onto a receiver

See [projection controls](bake-projection.md) for high and low source selection, self-bake, distance units, cage meshes, ray direction, name matching, backfaces and UV skew. Projection-enabled targets use scene placements. Regular direct bakes retain their mesh-local behavior.

## Deliver normals and signed height

See [normal and height bakes](bake-normal-height.md) for tangent and world vectors, DirectX or OpenGL orientation, shared signed relief ranges and PNG or OpenEXR encodings.

## Bake visibility and directions

See [occlusion bakes](bake-occlusion.md) for ambient, contact and directional AO, scene ray controls, self-occlusion policies, bent normals and blocker directions.

## Measure thickness

See [thickness bakes](bake-thickness.md) for search range, inward ray directions, strict shell and part checks, float and 16-bit outputs, and paired validity.

## Bake convex and concave curvature

See [curvature bakes](bake-curvature.md) for mesh and normal-input curvature, edge policies, scale, normalized maps, and signed float output. Use the cavity map independently for short-range occlusion.
