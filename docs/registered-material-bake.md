# Registered material baking

Use `export-glb --bake-dir` to export material maps that share the mesh's
`TEXCOORD_0` layout and padding.

```sh
node cli/ink-studio.js export-glb examples/registered-material-bake.js \
  --out buoy.glb --texture-size 256 --bake-dir buoy-material
```

The registered path accepts opaque authored models, diorama model hooks
and OBJ meshes. It keeps an authored non-overlapping UV layout or generates
one when the model has no UVs. For authored atlases, use
[UV and seam inspection](mesh-uv.md) to review overlap and padding first.
An opaque PNG base texture or linear vertex pigment can be baked with the
source material.

Each mesh has a directory with these outputs:

| Map | Encoding |
| --- | --- |
| Pigment | sRGB base color, with alpha for painted opacity |
| Normal | RGB tangent-space normals encoded in linear bytes |
| Roughness | Linear grayscale for editing or import |
| Metallic-roughness | glTF packing with roughness in green and metallic in blue |
| Emission | sRGB with the linear intensity scale in the manifest and GLB |
| Opacity | Linear grayscale for a model with opacity painted on its rest chart |
| Coverage | Linear grayscale footprint before padding |
| Named masks | Linear grayscale weights with the same gutter as the material maps |

The GLB embeds the same pigment, normal, metallic-roughness and emission PNG
bytes. Painted translucency sets the glTF material to `BLEND`.
`material-bake.json` records UV and geometry hashes, texture hashes,
dimensions, padding, emissive strength, and paint coverage by camera. Mesh
indices follow export order, including attachments. Each mesh publishes
`mipmaps.levels`, with separate registered PNGs from half resolution through
1 × 1 for consumers that accept an authored chain.

Author masks on a model material with `masks: { gasket: 1, label: .4 }`. A
procedural `sampleSurface(point, normal, faceIndex)` can return linear
`color`, a world-space `normal`, `roughness`, `metallic`, linear RGB
`emission`, and `masks` in the same material sample. Declare the names of
procedural masks in the model's `maskNames` array. Omitted weights are zero.
Diorama materials can set `normal` and `masks` under `model`.
Use [material channel painting](pixel-art-authoring.md#paint-individual-material-channels)
to apply indexed pigment, roughness, emission, normal, opacity, or named
mask edits to a diorama solid before baking.

## Project approved paint from several views

Author a camera plan with named orbit views:

```json
{
  "format": "ink-studio/material-paint-cameras",
  "version": 1,
  "views": [
    { "id": "front", "mesh": 0, "width": 512, "height": 512, "camera": { "yaw": 0 } },
    { "id": "side", "mesh": 0, "width": 512, "height": 512, "camera": { "yaw": 1.571 } }
  ]
}
```

`yaw`, `pitch`, and `fov` are in radians. Capture defaults to an
orthographic view framed to the selected mesh. Use `ortho: false` for a
perspective view. Set `target` and `dist` to frame a particular part.

```sh
node cli/ink-studio.js export-glb examples/registered-material-bake.js \
  --out review/buoy.glb --texture-size 256 --bake-dir review \
  --capture-paint cameras.json
```

Use each `*-guide.png` as a reference and paint into the matching
transparent `*-paint.png`. The generated `paint-views/approved.json`
registers the cameras and geometry. Its list selects which views to use,
and the PNG alpha selects which pixels to project. Set a view's optional
`mask` to a matching grayscale PNG to approve a smaller region. White
allows paint. Paths are relative to the manifest. Capture exports use a
fresh destination to protect existing edited paint.

```sh
node cli/ink-studio.js export-glb examples/registered-material-bake.js \
  --out final/buoy.glb --texture-size 256 --bake-dir final \
  --paint-views review/paint-views/approved.json
```

The baker checks front-facing geometry and occlusion against the selected
mesh in its captured rest pose. It rejects paint samples from a different
depth at silhouette edges. Overlapping approved views blend in linear
light, favoring the face-on view. Use per-view `opacity` and `weight` for
art direction. Optional `minFacing` is a cosine in [0, 1), and `depthBias`
is in scene units. The coverage maps `projected-paint` and `paint-<view>`
show where the approved pigment landed. The other material channels
retain their original samples.

An external camera capture can use the same manifest format
`ink-studio/material-paint-views` version 1. Supply the view's ID,
mesh index, image dimensions and paint path, plus a renderer camera with
`view`, `tangent`, `aspect`, `ortho`, `clipNear`, and `clipFar`. Ink's
orthographic captures store the vertical world-space half-height in
`tangent`. Perspective captures store the tangent of half the vertical field
of view. The API takes these plans as paths or objects through
`studio.exportGlb(model, { out, bakeDir, capturePaint, paintViews })`.
Select either capture or paint for each export.

## Bake geometry masks

Add `--geometry-masks` to generate the surface masks during the same
registered UV pass as pigment and roughness.

```sh
node cli/ink-studio.js export-glb examples/geometry-mask-bake.js \
  --out spillway.glb --bake-dir spillway-maps --texture-size 256 --geometry-masks
```

The bake writes linear grayscale PNGs under `mesh-000` and registers them
as named masks in `material-bake.json`. They share `TEXCOORD_0`, the surface
coverage map, chart gutters, and the registered mip chain.

| Mask | Value |
| --- | --- |
| `slope` | Angular tilt from horizontal, normalized from 0° to 90° using a geometric face normal and the configured up axis. Flat floors and ceilings both start at 0. |
| `cavity` | Local occlusion. Nearby hits have more weight, falling linearly to zero at `cavityRadius`. |
| `exposure` | Fraction of outward rays that reach `exposureDistance` without a hit. Open surfaces are bright. |
| `thickness` | Distance along the inward normal to the first exit from the same closed shell, divided by `thicknessScale` and clamped at 1. |
| `thickness-valid` | 1 when the inward ray measured a valid exit. Open, non-manifold, and ambiguous shells or misses return 0. |

The geometry query uses the triangles of each rest mesh, including its
separate shells. Cavity and exposure reuse one set of deterministic,
cosine-weighted rays per covered texel. The baker treats triangles as
opaque geometry. Pigment, shading normals, lighting, and camera do not
enter these masks. Use `thickness-valid` before interpreting a zero value
as a measurement. On a filtered mip it stores the fraction with a valid
measurement, so divide the normalized thickness by that fraction when
estimating average thickness over valid samples.

Pass a JSON settings file after `--geometry-masks` or supply
`geometryMasks: { ... }` to `studio.exportGlb`.

```json
{
  "up": [0, 1, 0],
  "samples": 24,
  "cavityRadius": 0.7,
  "exposureDistance": 4.5,
  "thicknessScale": 1.75
}
```

Defaults use +Y, 16 samples, a cavity radius of 14% of the mesh bounds
diagonal, and one diagonal for exposure and thickness scale. Distances
are in scene units. `samples` accepts 4–64. Optional `rayBias` changes the
small surface offset used when starting a trace. The manifest records
the resolved distances and counts of measured, missing, and clipped
thickness texels. Choose fewer samples or a smaller texture when the
geometry exceeds the ray budget.

A chart rebake inherits the baseline settings. A geometry or settings
change refreshes the geometry masks across that mesh, since an edit can
change occlusion on another chart. Unchanged geometry can reuse the
saved masks. Use `--geometry-masks off` to drop the generated channels.

```sh
node examples/geometry-mask-bake.js /tmp/spillway-nine
```

Open `spillway-review.html` to compare the masks on the model, switch back
to its original material, or sample an exact texel of the UV atlas.

## Reproduce the demo

```sh
node examples/registered-material-bake.js kestrel-review
```

The Kestrel survey buoy uses three approved paint views and one
256 × 256 atlas. The turntable is rendered from the exported pigment and
normal maps. The bundle includes the GLB, all material channels, and the
editable capture guides.

## Rebake changed UV charts

Preserve the first registered bake's manifest, maps, and chart sidecars as a
baseline. The rebake inherits the saved texture size and requires the same
mesh names, mesh order, and padding:

```sh
node cli/ink-studio.js export-glb edited-scene.js \
  --out revision/model.glb --bake-dir revision \
  --rebake-from baseline/material-bake.json
```

When the layout is fixed, the atlas keeps its exact UV coordinates, quad
diagonals, chart IDs, and gutter ownership. Changed positions, shading
normals, vertex colors, and material slots mark their affected charts
automatically. The saved diorama
from `pixel-art edit` also carries rest-chart revisions. Adding, changing,
clearing, or undoing a stamp invalidates the receiving atlas charts, even
when the edit falls between face sample points. Ink checks the previous
and current projection bounds, including solid transforms. A chart
inside a nested or modified SDF recipe can require resampling its mesh
because of nonlinear coordinates. Several charts can depend on the same
shared vertex or material. For sculpt work, an authored
receiving topology can be reused across edits through
`KIT.model.fromSculpt(sculpt, { topology })`. An emission edit that exceeds the
saved intensity scale needs a fresh full bake.

Use `--chart-edits edits.json` to mark a change inside a procedural sampler
or to limit an updated `--paint-views` plan to selected charts. Bounds are in
rest-model coordinates and match either the previous or current chart bounds:

```json
{
  "format": "ink-studio/material-chart-edits",
  "version": 1,
  "edits": [
    { "mesh": 0, "charts": [12] },
    { "mesh": 1, "bounds": { "min": [-0.3, 0.2, 0], "max": [0.3, 0.7, 0.15] } }
  ]
}
```

The manifest lists each chart's ID, triangle indices, and bounds. Its
`chartReport` records updated and reused IDs and the number of material
texels sampled. A rebake combines the new samples with the previous atlas
and embeds the complete material PNGs into the GLB. Reused chart texels and
gutters keep their exact bytes.

In a fixed layout, each coarser texel keeps the chart chosen in the baseline.
Dominant surface coverage wins where footprints meet, with the chart ID
breaking ties. Pigment and emission filter in linear light, normal
variation raises roughness, and scalar channels filter independently
inside that chart. Small charts can disappear at levels where their
footprint shares a texel with a larger chart. A rebake filters only the
affected charts' owned mip texels and records `filteredTexels` per level.
Older baselines can be reused. The first run fills in their mip chain
and records diorama chart revisions for subsequent edits.

Omit `--paint-views` to carry the saved approved pigment through a sculpt edit.
Ink stores it in UV space, so it follows the surface. To apply an updated
camera paint plan, supply the plan and select the receiving charts. Use
cameras captured against the current geometry for reprojection. Charts can
receive the same revised plan in separate passes. Each pass becomes a new
baseline. The JavaScript options are `rebakeFrom` and `chartEdits`.

Run `node examples/incremental-chart-rebake.js <new-directory>` for a
512-pixel atlas demo with a local dent, retained camera paint, and an atlas
view showing the updated chart beside the reused charts.

### Rebake a topology or UV revision

Create the baseline from a retained mesh topology document carrying authored
UVs. Keep the stable vertex and face IDs on corresponding elements as you edit.
At export, Ink triangulates the authored polygons and identifies each triangle
by its face and vertex IDs. The JavaScript equivalent is
`KIT.model.fromTopology(document, { materials })` for a scene model hook, or
passing the document directly to `exportGlb`.

```sh
node cli/ink-studio.js export-glb baseline-topology.json \
  --out baseline/model.glb --bake-dir baseline --texture-size 512
node cli/ink-studio.js export-glb revised-topology.json \
  --out revision/model.glb --bake-dir revision \
  --rebake-from baseline/material-bake.json --rebake-report revision-report.json
```

Unchanged charts keep their atlas coordinates and owner IDs even if the mesh
arrays are reordered. Their map pixels and gutters stay byte-identical. A moved,
split, joined, or re-tessellated chart releases its old footprint and uses
the revised document's UV coordinates. Place revised charts in free atlas
space or in space released by other revised charts. A revised surface
overlapping another surface or a retained gutter reports a conflict before
export. A revised gutter can stop at an occupied texel. Only mip texels whose
owners or contributing samples changed are filtered again.

Saved camera paint follows matching triangles through their corner
correspondence. A re-tessellated face can also recover paint where its
rest-space surface still lies on an unambiguous part of the old face.
New regions use the current material sampler. The receipt lists retired
charts, removed faces, old and new UV bounds, released texels, truncated
gutters, and how many texels mapped, inherited paint, or lacked a safe
correspondence. It also counts previously painted texels whose surface
was removed or no longer has a reliable match. With the mesh unchanged,
a UV move recalculates geometry masks only on the affected charts. For a reshaped surface with unresolved paint, recapture
approved views against the new geometry and select the receiving charts.
The optional CLI report includes conflicts when a revision is blocked.

For a legacy atlas without stable IDs, first rebake the unchanged topology
and UV layout with stable IDs to record the correspondence. For a new
geometry revision, carry forward the resulting atlas and its sidecars.

```sh
node examples/incremental-chart-rebake.js morrow-review --topology
```

Open `morrow-review/comparison.png` to compare the relay at 1×. The demo
clips and moves the brass service plate, transfers its approved lettering,
and reuses the other charts. The revised material manifest includes its
chart and mip receipts.
