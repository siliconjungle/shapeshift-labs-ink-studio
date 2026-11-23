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
| Pigment | sRGB base color without view lighting |
| Normal | RGB tangent-space normals encoded in linear bytes |
| Roughness | Linear grayscale for editing or import |
| Metallic-roughness | glTF packing with roughness in green and metallic in blue |
| Emission | sRGB with the linear intensity scale in the manifest and GLB |
| Coverage | Linear grayscale footprint before padding |
| Named masks | Linear grayscale weights with the same gutter as the material maps |

The GLB embeds the same pigment, normal, metallic-roughness and emission PNG
bytes. `material-bake.json` records UV and geometry hashes, texture hashes,
dimensions, padding, emissive strength, and paint coverage by camera. Mesh
indices follow export order, including attachments.

Author masks on a model material with `masks: { gasket: 1, label: .4 }`. A
procedural `sampleSurface(point, normal, faceIndex)` can return linear
`color`, a world-space `normal`, `roughness`, `metallic`, linear RGB
`emission`, and `masks` in the same material sample. Declare the names of
procedural masks in the model's `maskNames` array. Omitted weights are zero.
Diorama materials can set `normal` and `masks` under `model`.

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
