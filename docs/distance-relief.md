# Distance-dependent relief

Attach a relief chart to use displacement, mapped normals, and painted
shading at different screen sizes. Each view draws one tier. The mesh,
object, part and material IDs stay the same across the switch.

```js
const relief = K.procedural.lod.relief.create({
  id: 'stone-frieze',
  objectId: 'lockhouse',
  partId: 'seal',
  materialId: 'limestone',
  origin: [-1.8, 0.75, 0.6],
  right: [3.6, 0, 0],
  up: [0, 2.4, 0],
  texture: { width, height, pixels: pigment },
  heights,
  segments: [120, 80],
  featureSize: 0.22,
  normalPixels: 3.2,
  geometryPixels: 8.7,
  paintedSize: 48,
  light: [-0.53, 0.68, 0.51],
  ambient: 0.48
});

const world = B.finish({ reliefLOD: [relief], cam });
```

`origin` is the bottom-left of the receiving chart in world coordinates.
The perpendicular `right` and `up` vectors define its full edges. The pigment
takes up to 512 × 512 top-down RGBA8 texels. Optional `color` tints it and
defaults to white. A signed height in scene units at each texel recesses
or lifts the surface along the chart normal. The top row is the top edge
of the chart. Pigment alpha supplies the cutout mask.

- **Geometry** displaces the registered triangle grid and writes its real
  depth. A crack can break the profile when it reaches an edge. Use up to
  192 segments on each axis. An authored `geometry: { positions, uvs, indices }`
  can substitute a modeled near surface, including open cracks and side
  walls. Its positions are world-space XYZ and its UVs use the same chart.
- **Normal** uses a two-triangle carrier with normals derived from the
  height gradient. You can also supply a matching tangent-space RGBA8
  `normalMap` from a registered bake. An authored geometry and normal map
  can define the relief without a height raster. The normal tier responds
  to lighting and uses [semantic texture mipmaps](semantic-texture-mipmaps.md).
- **Painted** uses a two-triangle carrier with compact RGB shading and
  cutout coverage baked from the same pigment, normals and light. It uses
  no normal map. `paintedSize` caps the longest edge. Use
  `painted: { width, height, pixels }` for a hand-painted alternative.
  To compare paint on [object-local texels](texel-coverage.md), pass the
  output of `bakeObjectTexels` on the receiving carrier as `paintedTexels`.
  Ink uses its fixed color, UVs and clipped triangles for the painted tier.

Geometry and mapped normals respond to a live directional key. Fixed paint
retains its authored or baked shading.

The shared selector measures `featureSize` in **native art pixels** and
accounts for foreshortening. At least `normalPixels` makes the normal tier
eligible. At least `geometryPixels` makes geometry eligible. A projecting
edge can also qualify for geometry when the relief profile itself reaches
`geometryPixels` in a grazing view. The default thresholds are 0.75 and 3
pixels respectively. Offscreen and clipped subjects skip generation.

The selection is deterministic when scrubbing or seeking. Each tier is
built on demand and retained for reuse. Attach up to 16 distinct relief
plans. The active tiers count toward the ordinary native scene-mesh budgets.

## Inspect and compare

Pass `reliefLODFrame(rows)` in render options to collect the chosen tier,
measured feature and profile sizes, triangle count, and allocated normal
and material texels. `relief.inspect(view)` measures a view without building
the tier. Use `K.procedural.lod.preview.camera` to obtain a stand-alone view.

Force `geometry`, `normal`, or `painted` with the frame's `reliefLOD` option.
Use `false` to hide the relief or `'auto'` for screen-size selection. The CLI
accepts the equivalent `--relief-lod geometry|normal|painted|off|auto`.
Headless art passes and WebGL picking identify the active representation
and its actual depth. A normal map or painted carrier has plane depth.

Run `node examples/distance-relief.js <directory> --frames` to render the
Cataract lockhouse seal. The pullback visits all three tiers. Two fixed
grazing captures show the modeled fissure beside its normal-mapped version.

Use the [matched relief review](render-suite.md#compare-geometry-relief-and-texel-paint)
to compare all three tiers at the same poses and store approved camera ranges.
