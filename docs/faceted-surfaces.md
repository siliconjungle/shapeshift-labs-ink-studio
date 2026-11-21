# Faceted surface reconstruction

`K.facets` optionally reconstructs a signed-distance field into connected flat patches. These are actual planes with constant geometric normals, not a colour filter over a smooth surface. `draw` emits one native triangular splat per face using an exact silhouette and retained plane depth. The SDF/splat core remains unchanged: opt into facets for selected rocks, architecture or machine parts, or use them throughout a scene.

Open [A Study in Planes](../examples/faceted-surfaces.html) for Amethyst Quarry and Copperworks. Compare smooth rocks/walls with faceted versions, change facet size and colour grouping, turn the sampling grain, orbit freely and watch the rigged flywheel. The façades combine native planes with crisp pixel-art atlas decals.

```js
const shape = S.box([0,1,0], [.8,1,.6], material, { hold:true, rd:.12 });
const plan = K.facets.fromSdf(shape, {
  bounds: {min:[-1,-.2,-.8], max:[1,2.2,.8]},
  size: [.24,.4,.24],
  orientation: [.1,.3,0],
  method: 'dualContour'
});
const batch = K.facets.draw(B, plan, {
  object: 'machine-housing', material: 'painted-steel',
  palette: ['#365b70','#63868b','#c9bb99'],
  grouping: 'normal', normalAngle: .4,
  shadeSteps: 6, variation: .04
});
const world = B.finish(settings);
// batch.ids can join existing native GPU bone rigs.
```

`fromSdf` accepts a function `(x,y,z)=>distance` or a held sculpt primitive with `.sd`. Use `S.sdf` for a whole native CSG sculpt. Keep its bounds tight and enclosing the complete surface. A function's authored field is not modified. Retain it for collisions or other simulations; a coarse visual reconstruction can differ from that field near corners and thin features.

## Geometry and work controls

| Option | Default | Meaning |
| --- | --- | --- |
| `size` | `.3` | World-space grid pitch: one number or XYZ triple. Smaller values make more, smaller facets. Anisotropic sizes support tall façade strips or stretched stone grain. Aspect ratio is limited to 32. |
| `orientation` | `[0,0,0]` | XYZ Euler angles in radians; rotation is `Rz*Ry*Rx`. Rotates the extraction lattice rather than the object. |
| `origin` | Bounds centre | World point anchoring the lattice. Changing it shifts grid phase. |
| `method` | `dualContour` | Existing Hermite/QEF extraction for sharp corners. `surfaceNets` uses average crossings for softer crystalline shapes. Both share indexed vertices and derive flat triangle normals. |
| `iso`, `refine` | `0`, `2` | SDF level and edge-root refinements (0–8). |
| `normal` | Numerical gradient | Optional world-space unit/nonzero normal callback, transformed correctly into the oriented anisotropic lattice. |
| `maxCells` | `150000` | Maximum 3D grid cells; up to 1,000,000. |
| `maxSamples` | `2000000` | Maximum field samples including edge and gradient work; up to 14,000,000. |
| `maxFacets` | `50000` | Maximum triangles; up to 500,000. |
| `maxVertices` | `100000` | Maximum shared vertices; up to 1,000,000. |

The oriented domain encloses the supplied world bounds and rounds outward to grid stations. These bounds limit extraction, not a clipping/capping operation. Surfaces reaching the grid boundary remain open. Geometry smaller than the lattice can be missed; use a finer `size` for thin trim, tubes and holes. Facet sizes are controlled by lattice pitch, not equal-area remeshing. Existing dual-contour topology limitations at singular/nonmanifold SDF intersections still apply.

Plans are immutable serializable data with `format:'ink-studio/faceted-surface'`, `version:1`, shared `vertices`, `facets`, `bounds` and `stats`. Each facet has stable `id`, vertex `indices`, flat `normal`, `center` and `area`. IDs survive JSON round trips and removal of zero-area faces. Statistics report extraction cells, samples, active cells, vertices and facet counts. Budgets throw explicitly rather than silently reducing quality.

`fromMesh(source, options)` adopts existing triangle topology. It accepts `{points,faces}`, native `{pos,tri}` or procedural triangle streams with `{positions}`. It flattens shading without resampling or decimating the mesh. `toMesh(plan, appearance)` exports an indexed native mesh with face colours, suitable for the existing mesh tooling. Mesh export uses unlit group colours.

## Colour grouping and rendering

`appearance(plan, options)` exposes face colours and group keys before drawing. Colour decisions are deterministic and do not consume a builder's random stream.

| Option | Default / meaning |
| --- | --- |
| `palette` | Three stone swatches; RGB-byte triples or `#RRGGBB`, up to 256 colours. |
| `grouping` | `'normal'`: quantized rest normals share a colour. `'spatial'`: nearby centres share a cell key. `'facet'`: independent face keys. A pure callback may return a string/finite number. |
| `normalAngle` | `.35` radians; normal-component bin width is `sin(normalAngle)`. This is a colour grouping control, not a change to geometric normals. |
| `groupSize` | `.6` world units for spatial groups. |
| `color` | Optional fixed RGB/hex or callback receiving the facet and group key; overrides palette assignment. |
| `seed`, `variation` | `1`, `.06`; independent group colour and brightness variation. |
| `light`, `ambient` | `[-.5,.8,.45]`, `.3`; baked flat lighting. |
| `shadeSteps` | `6`; quantized diffuse levels, 1–64. |
| `emissive` | `false`; bypass baked directional shading and mark carriers emissive. |
| `opacity` | `1`, maximum 4; native coverage value. |
| `object`, `material` | `'facets'`, `'faceted-surface'`; normal provenance/selectors. Each face also has a surface target ID. |
| `animation`, `finish` | Existing native animation tags and surface-finish descriptors. |

`draw` validates the plan and all colour callbacks before emitting geometry. It returns `{first,end,ids,facets}`, with one range per face. Albedo is retained separately from lit RGB for the existing render-stage looks. Flat patches participate in native depth tests and supported normal/lighting controls in software and WebGL. Camera rotation reuses the same patches; no extraction happens per frame. GPU bones carry the retained footprint frames, as the flywheel demonstrates. Rendering costs depend on screen coverage as well as face count.

`K.surfacePatches.triangle(B, [a,b,c], options)` is the shared low-level emitter used by both facets and existing mosaics. Supply RGB-byte `color`, optional unit `normal`, `opacity`, native `animation`, normalized RGB/hex `albedo`, `finish`, `optical` and provenance. One cached triangular footprint is reused across all faces rather than creating a silhouette atlas entry per facet.

## Graph and CLI

The `sdf.facets` graph node accepts a `field` and serializable `options` (including time and bounds), returning `value` (the plan) and `mesh` (indexed face-colour geometry). `options.appearance` controls exported colours. A `scene.object` with `options.facets:true` uses native exact patches when `scene.world` bakes it; other objects retain the original sampled-SDF path. Use a facets-options record instead of `true` to override grouping or appearance. This path avoids rebuilding an intermediate mesh SDF just to draw its planes.

```sh
node cli/ink-studio.js graph run examples/faceted-surfaces.json --out /tmp/faceted-study
```

The supplied graph exports a rendered PNG and its editable faceted plan. Node catalog metadata exposes the extraction controls. No new dependencies are required.
