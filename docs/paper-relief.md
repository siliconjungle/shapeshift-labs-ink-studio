# Layered cut paper and relief

`K.paper` builds optional cutout sheets with genuine holes, physical thickness, coloured cut edges and independent poses. The same geometry supplies native drawing, ray queries and a signed-distance field. Stack sheets into paper theatre, typography, maps, foliage or architectural relief.

Open [Between the Sheets](../examples/paper-relief.html) for The Quiet Orchard and Tidal Atlas. Orbit freely, separate the layers, and compare shadows and paper grain. Teal and honey stock are refined with matte cream edges. There are no new dependencies.

```js
const plan = K.paper.stack([
  { id:'backing', profile:[[-2,-1.5],[2,-1.5],[2,1.5],[-2,1.5]], color:'#294f65' },
  { id:'window', rings:[outerRing, innerHole], depth:.3, color:'#ecd5ac' },
  { id:'leaf', profile:leafOutline, depth:.55, rotation:[0,.15,0], color:'#74a69d' }
], { thickness:.04, gap:.15 });

const world = K.paper.world(plan, {
  camera:{target:[0,0,.3],dist:7,yaw:.2,pitch:.1},
  draw:{light:[-.5,.7,1],softness:.06,texel:.025}
});
```

`stack` accepts up to 128 layers by default. Each layer has a unique `id`, a single `profile` or a list of `rings`, RGB-byte/hex `color`, optional `backColor` and `edgeColor`, `depth`, `thickness`, XYZ `position` and XYZ `rotation` in radians. Depth translates along stack Z; position adds a translation, and rotation turns the sheet about its local origin. Geometry is authored in local XY.

Rings use the even/odd rule, supporting holes, nested islands and disjoint components. Winding is canonicalized so edge walls face out of the solid, including into holes. Concave caps reuse the library's constrained triangulation. Repeated closing vertices are removed. Invalid, crossing or degenerate profiles fail rather than being silently repaired. Shapes may overlap intentionally; layer spacing does not automatically prevent intersections when thickness is increased.

The default depth is `index*gap`, with `gap:.15` and `thickness:.035`. Plans are immutable, serializable data with `format:'ink-studio/paper-relief'`, `version:1`, `layers`, `limits` and `stats`. JSON plans are revalidated before use. Native plans reuse their compiled geometry. Triangle and predicate budgets cover the complete stack.

## Native geometry and front paint

```js
const batch = K.paper.draw(B, plan, { paint:'atlas' });
const world = B.finish({ ...settings, spriteSurfaces:batch.spriteSurfaces });
```

The default `paint:'atlas'` keeps backs and edge walls as native triangle splats. Front caps use the existing optional atlas-surface renderer for crisp paper grain and baked per-texel shadows. Cap triangles follow the exact cut profiles; texture paint is not used to fake holes. Native front caps are omitted in this mode to avoid coincident depth flicker. Include the returned `spriteSurfaces` when finishing a mixed scene, or use `world`, which does this automatically.

Use `paint:'native'` for a representation entirely in splats, including front caps. In that mode, shadows are sampled on adaptively subdivided front triangles; `shadowStep` controls their resolution. Small steps improve transitions and increase bake work/carrier count. Atlas paint produces finer shadows with substantially fewer carriers. SDF and splats remain the library's core; atlas front paint is an optional supplement, using existing depth-tested surfaces.

`draw` returns `{first,end,ids,layers,spriteSurfaces,stats}`. Native layer ranges carry ordinary object/material metadata and the sheet ID as a surface target. Atlas fronts have corresponding named face IDs. Existing native material looks and finishes apply to native rows; atlas front colour/lighting is baked. Resolved-frame grades affect the combined image. `world` accepts normal scene options, background and camera settings; its `draw` property supplies paper drawing controls.

Changing sheet poses or the light requires rebaking the static shadows. Camera movement does not. A hybrid sheet's front atlas geometry and native body are separate retained resources; moving only native bone rows does not move the front paint. Use existing geometry-update APIs for both resources, or rebuild the stack. Native-only sheets can use ordinary native rigs.

## Shadows and stock

| Drawing option | Default | Meaning |
| --- | --- | --- |
| `light`, `ambient` | `[-.5,.7,1]`, `.58` | Flat matte stock lighting. |
| `shadowStrength` | `.38` | Darkening from foreground sheets; zero disables shadow work. |
| `softness`, `shadowSamples` | `.035`, `5` | Angular source spread and deterministic samples, 1–16. Penumbrae grow with layer separation. |
| `texel` | `.04` | World-space front-paint texel size. Nearest sampling keeps the printed look crisp. |
| `texture` | `true` | Set `false` for plain stock, or `{grain,fibers,scale,seed}`. Atlas grain is baked into paint; `scale` configures the native stock finish. |
| `paint` | `'atlas'` | Optional atlas fronts or fully `'native'` sheets. |
| `shadowStep` | `.18` | Native front-triangle shadow spacing, world units. |
| `object`, `material` | `'paper'`, `'paper-stock'` | Native labels for selection and material controls. |
| `maxMarks` | `80000` | Native triangle budget, maximum 500,000. |
| `maxPixels` | `1000000` | Total front-paint pixels, maximum 8,000,000. Individual maps are limited to 2,048 pixels per axis. |
| `maxShadowTests` | `16000000` | Native ray/edge tests or raster work; maximum 40,000,000 in `draw`. |

`K.paper.finish({grain,fibers,scale,seed})` returns an ordinary reusable surface-finish descriptor. Stock colors are bytes or `#RRGGBB`; back and edge colors default to darker versions of the front color.

`shadows(plan, options)` exposes baked masks independently: `{layers:[{id,width,height,bounds,coverage}],stats}`. Coverage is a top-down `Uint8Array`, 0–255, in each sheet's local XY bounds. Options include `light`, `softness`, `samples`, `texel`, `enabled`, `maxPixels` and `maxWork` (default 40 million, maximum 256 million). Disabled masks retain their shape but contain zero coverage and perform no shadow raster work.

The rasterizer projects the actual cap and edge-wall triangles, clips away geometry behind each receiving front plane, and unions coverage per light sample. Apertures remain open; a hidden rear sheet cannot eat into foreground visibility or shadow it. Native ray queries use the same caps and side walls. Shadow paint is baked once; there is no contour extraction, ray casting or texture generation per rendered frame.

## Fields, queries and tooling

`cut((x,y)=>signedDistance, {bounds,cell:.06,maxCells:120000,maxVertices:2048})` traces a bounded planar field into cutout rings. Negative regions become paper. It reuses existing marching contours and field masks. Empty fields return an empty ring list.

`relief((x,y)=>height, {bounds,levels,colors,gap:.14,cell:.06})` builds increasing threshold cutouts: each sheet contains the region where height is at least its level. Levels must be increasing, with at most 64. Its default 240,000-cell budget is shared across all levels; it fails before sampling when exceeded. Thin details smaller than the chosen cell or texel size need finer authoring resolution.

`raycast(plan, origin, direction, {exclude,minDistance,maxDistance,maxTests})` returns the nearest sheet, hit point, outward normal, distance and `front`, `back` or `edge` part. Exclude a layer ID or index. Rays through a hole continue to sheets behind it. `sdf(plan)` returns a world-space signed-distance function for the union of the actual extruded sheets. Zero-thickness cards have no negative interior.

The graph nodes `paper.stack`, `paper.relief` and `paper.world` expose the same plans and rendering. Graph relief reads a signed 3D field at a configurable Z `slice`, using negative distance as relief height. The [CLI example](../examples/paper-relief.json) writes an image and editable plan:

```sh
ink-studio graph run examples/paper-relief.json --out /tmp/paper-study
```

Stack defaults: 12,000 vertices total (maximum 60,000), 2,048 vertices and 64 rings per sheet, 60,000 geometric triangles (maximum 500,000), 16 million triangulation predicates (maximum 60 million) and 30,000 flips (maximum 200,000). Raise limits explicitly. A shadow bake validates its budgets before native emission, and failed draw preparation leaves the native builder untouched. These work counts are authoring limits, not frame-rate guarantees.
