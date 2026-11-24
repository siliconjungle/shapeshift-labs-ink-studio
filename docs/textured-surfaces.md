# Textured surfaces

SDF sculpting and Gaussian splats remain the default authoring and rendering path. A scene may opt into a textured patch for ground, paving, a façade, or a curved channel. It may also use textured surfaces for its entire visible geometry. Opaque and transparent cutout pixels share the same atlas batch and depth-test with splats.

`TexturedSurface` and `SpriteSurface` are available from `studio.load()` and the plain-script bundle.

```js
const terrain = TexturedSurface.heightfield({
  bounds: [-8, 8, -6, 6],
  segments: [64, 48],
  height: (x, z) => 0.4 * Math.sin(x * 0.3) * Math.cos(z * 0.4)
});
const atlas = SpriteSurface.make(1024);
atlas.mesh(terrain, 256, 192, (x, y) =>
  (x + y) % 9 === 0 ? 0x74924d : 0x486638);

// Both attachments and an optional solid foundation use the drawn triangles.
const rootY = terrain.height(2, 3);
S.ground(grassMaterial, { rad: 8, h: terrain.height, res: 0.2 });
const world = B.finish({ spriteSurfaces: atlas.finish() });
```

`heightfield` accepts increasing `[minX,maxX,minZ,maxZ]` bounds and a height function or a row-major grid of `(columns+1)*(rows+1)` heights. Array rows start at `maxZ`, matching image rows. Heights are baked once. `height(x,z)` uses triangle interpolation and clamps queries at the bounds. `sample(u,v)` returns `{point,normal}` on the same triangles. Its coordinates and the image UVs range from zero to one. UV `(0,0)` is the upper-left image corner, at `[minX,height,maxZ]` for heightfields.

Use the same sampler when an SDF foundation needs to agree with the texture. A visible patch alone supplies rendering geometry. The sculptor continues to own authored solid volume, carving, support and fracture behavior.

## Path profiles

```js
const channel = TexturedSurface.sweep({
  path: K.anim.path(points, { steps: 24 }),
  segments: 120,
  profile: [[-0.5,0.15],[-0.35,0],[0.35,0],[0.5,0.15]]
});
atlas.mesh(channel, 64, 512, paintChannel);
const attachment = channel.sample(0.5, 0.4);
```

Profiles are `[sideOffset,heightOffset]` pairs. U follows profile edges and V follows arc length along the path. The default frame uses `up: [0,1,0]`. A vertical tangent needs a custom `frame(distance)` that supplies `{p,tan,right,up}`. This permits banking and inverted paths. `closed: true` joins the final station to the first exactly. Samples interpolate the tessellated triangles, including between stations.

For an arbitrary façade, skirt, or parameterized patch use `TexturedSurface.grid({segments:[columns,rows], point:(u,v)=>[x,y,z]})`. For an existing mesh call `atlas.mesh({points,uvs,triangles}, width, height, paint)`. Points are flat XYZ coordinates, UVs are flat normalized pairs, and triangles contain vertex indices. `atlas.face(...)` continues to work with the same layout.

## Rendering and limits

The native WebGL renderer and software renderer read `world.spriteSurfaces`. Set `spriteSurfaces: false` in render options to bypass the optional surfaces. A custom browser host may use `createSurfacePipeline` from the WebGL entry point with a depth attachment shared with the splat pass. The Rebirth host uses the same atlas representation.

Paint returns a 24-bit RGB integer or `undefined` for a transparent cutout. Sampling uses nearest texels by default. Fractional alpha is reserved for splats and the existing sprite-atlas effects. Texture RGB supplies the surface's base color. It can include baked shading or respond to scene emitters. The software renderer's resolved-frame looks also affect the result. Material-selector channels continue to use SDF splats.

Grids default to a 200,000-triangle budget. Raise `maxTriangles` explicitly up to 2,000,000. The atlas has its existing configurable width and maximum height. Invalid geometry or paint leaves the atlas allocation unchanged.

To share an updateable texture region among faces, call `atlas.reserve(width, height)`
and attach it with `atlas.faceRegion(origin, right, up, region)` or
`atlas.meshRegion(surface, region)`. After `finish()`, `SpriteSurface.update`
writes a matching top-down RGBA raster into the region and marks those pixels
dirty. [Camera feeds on textured panels](camera-atlas.md#route-a-feed-to-the-world)

Set `castsShadow: true` on a planar face or face region to use its painted
alpha to block local light. [Shadows from painted cutouts](painted-cutout-shadows.md)

Run `ink-studio render examples/textured-surfaces.js` for a mixed example. Its `build(seed,{textured:false})` also exercises the SDF and splat rendering path.

## Background tile normals

Pack a normal map alongside a tile's color, then place the same region
wherever the tile repeats. The demo uses this for masonry, paving, a
metal hatch and copper pipes. [Signal Vault demo](../examples/background-tile-normals/index.html)

```js
const brick = atlas.reserve(16, 16, paintBrick, {
  normal(x, y) {
    const dx = brickHeight(x + 1, y) - brickHeight(x - 1, y);
    const dy = brickHeight(x, y + 1) - brickHeight(x, y - 1);
    return [-dx, dy, 1];
  }
});
atlas.faceRegion([-2, 0, 0], [2, 0, 0], [0, 2, 0], brick);
atlas.faceRegion([0, 0, 0], [2, 0, 0], [0, 2, 0], brick);
```

The callback supplies a tangent-space vector. Positive X points right in
the texture, positive Y points up, and positive Z points away from the
surface toward the viewer. Return `undefined` to use the geometric normal.
Alternatively, pass a matching top-down `Uint8Array` or `Uint8ClampedArray`
RGBA normal map, using raw texture bytes. Flat is `[128,128,255,255]`.
Alpha below 128 uses the geometric normal. The normals use the tile's
nearest-texel lookup and follow rotated or mirrored UVs. If you edit
`atlas.normalPixels` in place after packing, call
`SpriteSurface.markDirty(atlas, region)` to upload the changed texels.

The software and WebGL renderers use the normals for live scene emitters.
Pass `surfaceNormals: false` in render options to compare flat shading.
Normal maps affect receiver shading. Color, coverage, depth and
shadow-casting geometry come from the same original tile. Degenerate UVs
use the geometric normal. On WebGL, a mapped atlas evaluates its lights
at visible fragments to retain relief as the light moves.

[Local projection for selected props](multiprojection.md) can give a named mesh chart its own viewpoint while keeping its pins and scene depth on the master camera.

## PS1-style material projection

Set `projection` on `face`, `mesh`, `faceRegion`, or `meshRegion`.
Each surface can choose its own settings, including when several share
the same atlas region. Procedural graphs use `warp.surface.options.projection`.

```js
atlas.faceRegion(origin, right, up, paintedRamp, {
  id: 'loading-ramp',
  projection: { mapping: 'affine', vertexSnap: 2, subdivisions: 4 }
});
```

| Setting | Behavior |
| --- | --- |
| `mapping` | Defaults to `'perspective'`. Set `'affine'` to interpolate texture coordinates in screen space. Long, tilted triangles show the strongest texture swim. |
| `vertexSnap` | Defaults to `0`. Set a spacing from `.25` to `16` native art pixels to snap projected vertices to a grid measured from the top-left of the view. It works with either mapping. |
| `subdivisions` | Defaults to `1`. Give each triangle `n` segments per edge, from 1 to 16, to emit `n²` triangles. Smaller triangles reduce affine swim. Ink interpolates positions and UVs on the original triangle and caps a subdivided atlas at two million triangles. |

Both renderers retain perspective-correct depth and world attributes.
Vertex snapping moves the rasterized outline. Shared vertices on the same
grid stay aligned. Where two surfaces meet, mismatched snap spacing or
subdivision can expose a seam. Transparent pixels, palette filtering, and
UV slip work with either mapping. Painted shadow casters use the authored
planar face in world space.

Custom WebGL hosts can pass `projectionPlan: SpriteSurface.projectionPlan`
to `createSurfacePipeline`.

[Relay Nine](../examples/material-projection.js) runs a matched camera
move over a painted loading ramp in four modes. Compare perspective with
affine to see the texture warp, then add a three-pixel snap and four
subdivisions per edge. The railings and gate keep their perspective mapping.

```sh
node examples/material-projection.js relay-review
node cli/ink-studio.js clip examples/material-projection.js --w 176 --h 112 \
  --px 1 --raw --from 0 --to 3.5 --fps 12 --params '{"mode":"snap"}' --out relay-nine.apng
```

Use `perspective`, `affine`, `snap`, or `subdivided` as the scene's
`mode` control.

## Palette-preserving minification

Pass a `sampling` rule to `face`, `mesh`, `faceRegion`, or
`meshRegion`. The rule applies to both the headless and WebGL renderers.
Procedural graphs can set the same rule in `warp.surface.options.sampling`.

```js
atlas.mesh(terrain, 256, 192, paint, {
  id: 'panel',
  sampling: {
    palette: ['#6e7480', '#364456', '#a6a4a5', '#ff9957'],
    protect: ['#ff9957'],
    protectCoverage: .12
  }
});
```

When a projected art pixel covers multiple texels, the filter uses the
UV gradients of the selected projection to integrate that footprint. Aligned
footprints use exact fractional texel areas. Oblique footprints use
four strips along the longer screen derivative. The resolved RGB is one
authored swatch. A magnified surface keeps its original nearest texels.
Coverage and color both use the face's own atlas region, including after
a UV slip or a marked pixel update.

| Setting | Behavior |
| --- | --- |
| `palette` | Up to 32 RGB24 integers or six-digit hex swatches in priority order. Omit to infer an ascending RGB24 palette from occupied texels. Use an explicit palette for regions with more than 32 colors. |
| `protect` | Up to four swatches that may win based on their footprint coverage. In an explicit palette, each protected swatch must appear in the palette. |
| `protectCoverage` | Minimum fraction of the occupied footprint for a protected swatch to win. Defaults to .10. The largest qualifying swatch wins, with earlier entries breaking ties. |
| `alphaCoverage` | Minimum occupied fraction needed to draw a cutout pixel. Defaults to .5. Source texels with alpha at least 128 count as occupied. |
| `tieTolerance` | How close the squared display-RGB distances can be before the earlier palette entry wins. Defaults to .004. |

Use `sampling: true` for an inferred palette with default settings.
Set `paletteSampling: false` on a render frame or
`--palette-sampling off` in the CLI to compare with nearest sampling.
One atlas can use up to 1,048,576 prefix-table positions across the
distinct sampled regions, including their one-texel borders. The
prefix tables are reused until the atlas pixels or UV mapping change.
Lighting, fog, and frame grading still operate on the sampled color.

Custom WebGL hosts can pass `SpriteSurface.samplingPlan` and
`SpriteSurface.samplingGLSL` as the `samplingPlan` and `samplingGLSL`
options of `createSurfacePipeline`.

Run `node examples/palette-resampling.cjs signal-weave.html` to compare
a shallow-angle pan and a camera pullback.

## UV and atlas slip

Give faces or meshes an optional final `{ id }` argument when adding them
to a builder. On the finished atlas, use `SpriteSurface.uvSlip` to change
which texels any of those faces sample.

```js
const pack = SpriteSurface.make(160);
const navigation = pack.reserve(80, 30, paintNavigation);
const alarm = pack.reserve(80, 30, paintAlarm);
pack.faceRegion([-1, 0, 0], [2, 0, 0], [0, 1, 0], navigation, { id: 'screen' });
const atlas = pack.finish();

SpriteSurface.uvSlip(atlas, [{ face: 'screen', to: alarm, flipU: true }]);
SpriteSurface.uvSlip(atlas, [{ face: 'screen', cells: [1, 0] }]);
SpriteSurface.uvSlip(atlas, []);
```

- `to` accepts a reserved region or a top-down atlas rectangle
  `{ x, y, width, height }`, including cropped or differently sized regions.
  `cells: [columns, rows]` shifts the source rectangle by integer multiples
  of its width and height. Use either `to` or `cells`. Omit both for an
  in-place flip. `flipU` and `flipV` reflect the local horizontal and
  vertical coordinates and can be combined.
- For an existing atlas or an individual triangle, specify
  `{ first, count, from }` in place of `face`. The two indices count
  vertices, in multiples of three. `from` names the authored atlas rectangle.
  With a one-texel source axis, the corresponding sample stays at the
  destination midpoint along that axis.
- Each call replaces the active edits. Use nonoverlapping ranges and
  in-bounds rectangles. An empty list restores the authored mapping.
  Apply a list from a scene update to animate the effect at exact frame times.

CPU and WebGL apply the same sampling rules at draw time. Positions,
the atlas image, and its update and geometry revisions are preserved.
Samples stay inside their destination region, and transparent texels
reveal the geometry behind them through the normal cutout rules. Edits
also sample any subsequent pixel updates in that destination, including
live camera feeds.

[Atlas Address Fault](../examples/uv-atlas-slip.js) compares identical
receivers while one reads an adjacent cell, mirrors its middle screen,
and reads a crop from another part of the atlas.

```sh
node cli/ink-studio.js clip examples/uv-atlas-slip.js --w 424 --h 218 \
  --to 5.333333333333333 --fps 12 --out atlas-address-fault.png
```

## Inspect the underlying surface

Set `objectId` and `materialId` on a face or mesh to label its visible art
pixels. The existing face `id` also serves as the default object label.
On a deforming mesh you can supply `restPoints` alongside `points` to
retain original XYZ. `points` still provide current vertex positions.
[Shared opaque surfaces](art-passes.md#shared-opaque-surfaces) exposes these
labels, geometric and painted normals, original UVs, depth, and motion.

## Indexed scene meshes

Use `SceneMeshes.create` from `ink.load()` (or `KIT.sceneMeshes` in a
browser) for indexed geometry with image materials. Attach the returned
mesh to `world.meshes`. Both the software and native WebGL 2 renderers
draw the triangles into the same scene as splats, curve strands, and
sprite surfaces.

```js
const { SceneMeshes, makeBuilder } = ink.load();
const panel = SceneMeshes.create({
  id: 'signal-panel',
  positions: new Float32Array([-1,1,0, 1,1,0, -1,-1,0, 1,-1,0]),
  uvs: new Float32Array([0,0, 1,0, 0,1, 1,1]),
  indices: new Uint16Array([0,1,2, 2,1,3]),
  materials: [{ id: 'painted-metal', texture: { width, height, pixels } }]
});
const world = makeBuilder(12, [0x172339, 0xe6b296, 0x66afa0]).finish({
  meshes: [panel],
  cam: { target: [0,0,0], dist: 4, yaw: 0, pitch: 0 }
});

// In a stage update, submit one posed XYZ triple per original vertex.
SceneMeshes.pose(panel, movedPositions);
```

`positions` are world-space XYZ triples and `uvs` are normalized pairs.
UV (0,0) addresses the upper-left texel center. Split vertices at UV
seams. `indices` contains one triple per triangle. For multiple materials,
provide one zero-based `faceMaterials` index per authored triangle.
Material IDs label the visible faces in the art passes. Use unique
object IDs within a scene.

A material supports an RGB24 `color` tint, an optional top-down RGBA8
`texture`, and an optional matching tangent-space RGBA8 `normal` map.
`alphaCutoff` defaults to 0.5 and turns texture alpha into solid
coverage or a cutout. `sampling` accepts the palette-preserving
minification rule above. The resulting colors go through local scene
emitters, fog, and the scene’s palette resolve. Use `raw: true` for the
unquantized scene color. For indexed pigment, cutout coverage, and filtered
normal, roughness, and emission maps, use
[semantic texture mipmaps](semantic-texture-mipmaps.md).

Each mesh retains its initial positions for rest-space and motion output.
Pose it without changing index order and call `SceneMeshes.pose` again
when its vertices move. Ink prepares an atlas and shared triangle draw
buffers once per mesh and updates vertex positions on a pose. Triangles
are double-sided. These materials support opaque and cutout rendering.
The per-mesh limits are 250,000 triangles, 64 materials, and a 2048 ×
2048 texture atlas. The scene can contain up to 32 meshes, 500,000
triangles, and 16 million allocated atlas texels.

### Inspecting a mesh

The headless `opaque-surface` pass includes the visible mesh ID,
material, UV, coverage, depth, motion, and geometric and shading normals.
Use `ink.pickSurface(frame.passes, x, y)` or `surface-pixel` to inspect
the depth-winning art pixel, including when a splat or SDF occludes it.

```sh
ink-studio passes examples/native-textured-mesh.js --channels opaque-surface \
  --w 240 --h 148 --px 1 --px1 --previous .35 --t .62 --out receiver-passes
ink-studio surface-pixel examples/native-textured-mesh.js --at 119,62 \
  --w 240 --h 148 --px 1 --t .62
```

Browser `renderer.pick(world, ray, frame)` and the toolkit’s
`KIT.procedural.contributions.create(world).ray(ray)` also report mesh
hits. A hit carries the authored triangle index, UV, position, normal,
and object and material labels. Ray picking tests the base cutout texels
of the posed triangles. Use art-pixel inspection for the exact result of
screen-space minification or a headless SDF assist. Set `meshes: false`
on a frame or use `--meshes off` for a render comparison.

## Depth-only proxies for splats

Use `SceneMeshes.depthProxy({ id, positions, indices })` to fit an
indexed shell to the intended surface of a splat asset. Put the mesh
in `splatDepthProxies` on the scene.

```js
const shell = SceneMeshes.depthProxy({ id: 'shell', positions, indices });
const world = builder.finish({
  splatDepthProxies: { meshes: [shell], tolerance: .055 }
});
```

The headless and WebGL 2 renderers rasterize the nearest proxy triangle
at each pixel. A splat fragment survives when its depth is in front of
the shell or within the tolerance behind it. Tolerance is a distance
along the camera axis in scene units. It defaults to .03. The rule
uses the renderer's splat center depth for ordinary splats and their
fragment depth where a retained footprint or clipped surface supplies
one. Triangles are double-sided. The nearest shell applies to every
splat at that pixel. Place a shell where it represents an opaque
occluder for the rest of the scene. In WebGL, an active proxy uses
the standard splat sort.

A proxy writes only the depth limit. The surviving splats supply
the final color, visible depth, and surface IDs. Mesh and sprite
draws retain their own depth tests. Use `SceneMeshes.pose` for a moving
shell. Set `splatDepthProxies: false` on a frame to bypass the limit,
or set `splatProxyTolerance` to override the scene value.

```sh
ink-studio passes examples/depth-mesh-proxies.js --channels depth-proxy \
  --w 210 --h 144 --px 1 --px1 --t .22 --out malachite-proxy
ink-studio passes examples/depth-mesh-proxies.js --channels depth-proxy \
  --w 210 --h 144 --px 1 --px1 --t .22 --splat-depth-proxies off --out malachite-reference
```

Read the rejection heat map next to the regular color and depth passes.
Use `--splat-proxy-tolerance 0` to inspect a tight fit.
[Depth proxy diagnostics](art-passes.md#depth-proxy-diagnostics)
