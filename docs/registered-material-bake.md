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
indices follow export order, including attachments. Use
[semantic mipmaps](semantic-texture-mipmaps.md) to filter these maps on a
native scene mesh.

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
baseline. Keep the receiving mesh topology when making a new revision. The
rebake inherits the saved texture size unless the input specifies one:

```sh
node cli/ink-studio.js export-glb edited-scene.js \
  --out revision/model.glb --bake-dir revision \
  --rebake-from baseline/material-bake.json
```

The atlas keeps its exact UV coordinates, quad diagonals, chart IDs, and
gutter ownership. Changed positions, shading normals, vertex colors, and
material slots mark their affected charts automatically. Several charts can
depend on the same shared vertex or material. For sculpt work, an authored
receiving topology can be reused across edits through
`KIT.model.fromSculpt(sculpt, { topology })`. Topology or UV changes require a
fresh full bake, as does an emission edit that exceeds the saved intensity
scale.

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

Omit `--paint-views` to carry the saved approved pigment through a sculpt edit.
Ink stores it in UV space, so it follows the surface. To apply an updated
camera paint plan, supply the plan and select the receiving charts. Use
cameras captured against the current geometry for reprojection. Charts can
receive the same revised plan in separate passes. Each pass becomes a new
baseline. The JavaScript options are `rebakeFrom` and `chartEdits`.

Run `node examples/incremental-chart-rebake.js <new-directory>` for a
512-pixel atlas demo with a local dent, retained camera paint, and an atlas
view showing the updated chart beside the reused charts.
