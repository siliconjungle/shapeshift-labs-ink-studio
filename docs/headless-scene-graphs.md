# Headless image and scene graphs

Use one graph project to sample a solver, process image maps, build geometry,
render in software, and send the resulting textures back to image nodes. The
ports can cross reusable graph groups without encoding intermediate files.

## Build a scene from graph outputs

A `sim.run.grid` output can drive both `sim.fieldRaster` and `sim.fieldMesh`.
Field meshes include top-left UVs in the selected slice's row order. For a
read-only 2D raster or an unstrided Z slice, set
`sim.fieldRaster.options.share: true` to reuse the field's float64 storage.
The raster report indicates whether it borrowed the storage. Strided
slices and separate components of interleaved data use a dense buffer.

Declare the raster with `image.declare`, apply a ramp or other image
operation, and use `material.pack` to publish its maps. Pass the resulting
`materialChannels` and a UV-mapped triangle `mesh` to `scene.materialMesh`.
This returns a native `sceneMesh` handle and a binding report. Collect
handles into `scene.world.meshes`, alongside any splat objects in
`scene.world.objects`. Then connect the world to `scene.render`.
`data.record` and `data.collect` can assemble a list from individual nodes.
When there is no authored scene palette, the world samples common opaque
mesh colors to seed its palette. Set `scene.world.options.palette`
to choose the scene's swatches explicitly.

A binding needs a typed `baseColor` map. It can also use typed `normal`,
`roughness`, `metalness`, `emission`, and `opacity` maps. Use matching
dimensions, clamped addresses, and UV set 0. The native carrier applies
one material to that mesh. Pass separately bound meshes to the world
when parts have different materials. Normal maps use tangent space.
Unitless roughness, metalness and opacity values use the [0,1] range.
Opacity multiplies base-color coverage before the native alpha cutoff.

The binding passes compatible sample arrays to the mesh carrier by
reference. RGB expansion, precision or color-space conversion, and
alpha combination can allocate new arrays. The carrier builds its
own drawable atlas. The binding report lists each adapted channel,
its working byte count, and whether it shared its input samples.
Other maps, such as height and authored masks, remain available to
other graph branches and appear under `graphOnly` in that report.

## Capture and reuse textures

- `scene.colorTexture` returns the final `color` frame or a named
  `graph:<id>` image as a straight sRGB image.
- `scene.maskTexture` returns native `coverage` or `surfaceCoverage`,
  or a named `graph:<id>` mask. Request the native channel on
  `scene.render.channels` and named screen passes on
  `scene.render.renderGraphCapture`.
- Both ports borrow the renderer's existing samples. Treat their sample
  buffers as read-only and use an image operation to make edits.
- Use `image.toRaster` for a legacy render-graph slot. Mask range is in
  the underlying sample units, such as [0,255] for captured byte masks or
  [0,1] for normalized float coverage.

## Evaluate and inspect

```sh
node examples/thermal-survey-graph.cjs thermal-survey
ink-studio graph evaluate thermal-survey/thermal-survey.graph.json \
  --capture rendered,original,pigment,maskPreview,terrain/binding:report --out thermal-review
```

Choose captures by node path and optional port, including inside groups.
Byte color and grayscale textures with compatible contracts write PNGs
with the contract in the receipt. Other typed textures write their
exact numeric samples and descriptor as JSON. Native scene mesh
captures record bounds, topology counts, and material IDs.

The receipt records node compute time, cache status, invalidation inputs,
software renderer counters, and published sample storage. The backing
byte count counts each visible underlying buffer once. The linked byte
count describes all observed graph links and the portion that shares
backing storage with its producer. These counters cover the sample views
visible at port boundaries. Native atlas memory, renderer scratch memory,
and artifact encoding have separate costs.

The `graph session` NDJSON protocol also accepts `{"op":"evaluate","capture":["rendered"]}`.
Repeat a request in a session to measure cached evaluation or change an
input or time to see dependent nodes run again. Capture requests need an
output directory and preserve requested intermediates whether or not they
are exposed as named project outputs. Failed project assertions set exit
status 2 in the CLI or request code 2 in a session.
