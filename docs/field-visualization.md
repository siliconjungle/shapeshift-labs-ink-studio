# Field and volume visualization

`KIT.fieldViews` extracts geometry from bounded scalar and vector fields. Render it as native Gaussian splats in the Node and WebGL renderers, or consume the sampled values, paths, triangles, and vectors directly.

## Field sources

- `source({ type, sample, bounds, units, components })` wraps a function of world-space `(x, y, z)`. The bounds give XYZ `min` and `max`. Types are `number`, `vec3`, and `vec2`. Two-component vectors can use `xy`, `xz` (default), or `yz` and are promoted to XYZ.
- `fromQuery(query, name, { bounds, args })` samples a typed spatial field from a world query. A bounded world-space XYZ field supplies its own box. Pass a world-space box for attached, unbounded, or lower-dimensional fields. Each query holds one simulation revision.
- `magnitude(vectorSource)` derives a scalar field with the same bounds and units.

Outside coordinates and missing samples give `null`. Slices leave those
cells empty, contours and isosurfaces leave gaps, streamlines stop at the
missing region, and glyphs omit missing and zero vectors.

[Fourier and standing-wave fields](spectral-fields.md) supply signed
displacement, phase, or energy. [Wave propagation](scalar-wave.md) supplies
retained pressure, pressure rate, or energy from a slice with obstacles.
[Boundary-driven potentials](boundary-potential-fields.md) supply scalar
solutions and downhill vectors from pinned, masked grids.

## Geometry

Where a method accepts `plane`, set `{ axis, at }` for an axis-aligned slice or `{ origin, u, v, size }` for an oblique slice. The origin is the first corner, the directions are perpendicular, and size gives both world-space extents. Scalar planes default to the center of the source along Y. Sample grids are ordered with the first axis varying fastest.

| Method | Controls and result |
| --- | --- |
| `slice(field, options)` | `plane` and two `counts` set the sampling lattice. Returns center-sampled `values`, the plane frame, and the observed range. |
| `contours(field, options)` | `plane`, one or more `levels`, `cell` spacing, and a shared `maxCells` budget. Returns world-space paths with their level and closed flag. |
| `isosurface(field, options)` | `level`, `inside` (`above` by default or `below`), `resolution`, `edgeRefinements`, `maxCells`, and `maxTriangles`. Returns a mesh with positions, normals, and sampling metadata. |
| `streamlines(field, options)` | World-space `seeds`, `direction`, integration `step` and `tolerance`, a shared `maxChecks`, and limits including `maxLength` and `maxSteps`. Returns paths with sampled magnitudes and termination statuses. Vectors are integrated at one field revision. |
| `glyphs(field, options)` | Explicit `points`, a volume grid with three `counts`, or a `plane` with two counts. `scale`, `normalize`, `minLength`, and `maxLength` control arrow length. Returns endpoints, original vectors, and magnitudes. |
| `lic(field, options)` | [Vector-field painting](vector-field-painting.md). Convolves texture along planar streamlines and returns aligned grain and projected speed. |

## Native rendering

Use `stamp(builder, geometry, { id, style, maxSplats })` with any Ink Studio builder. Each layer emits a selectable surface named `fieldView/<id>`. The returned report contains the splat range, source units, and value range.

In simulation manifests, configure `visual.fieldViews` as an array of layers. Each layer takes `id`, `kind` (one of the method names above), and `field` (the query name). Optional `bounds` and `args` control sampling. World-space XYZ fields use their native bounds by default, while other fields fall back to the visual region. Set `measure` to `magnitude` to use a vector field with a scalar visualization. Supply geometry controls in `options` and render controls in `style`. The standard `sim render` command builds these layers from the current simulation query.

Styles support a single hex `color` or a `ramp` of hex colors with an optional scalar `domain`. Use the same domain across revisions to keep colors comparable as values change. The ramp encodes scalar values, contour levels, or vector magnitude. Set `opacity` for layer blending, `width` for world-space strokes, `head` for glyph head length as a fraction of the arrow, and `light` and `ambient` for isosurface shading.
