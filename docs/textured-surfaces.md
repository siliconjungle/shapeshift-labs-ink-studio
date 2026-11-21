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

Paint returns a 24-bit RGB integer or `undefined` for a transparent cutout. Sampling uses nearest texels by default. Fractional alpha is reserved for splats and the existing sprite-atlas effects. Texture RGB is authored surface color, so bake surface shading into the paint when desired. The software renderer's resolved-frame looks also affect the result. Surface color is baked. Material-selector and live-relighting channels continue to use SDF splats.

Grids default to a 200,000-triangle budget. Raise `maxTriangles` explicitly up to 2,000,000. The atlas has its existing configurable width and maximum height. Invalid geometry or paint leaves the atlas allocation unchanged.

To share an updateable texture region among faces, call `atlas.reserve(width, height)`
and attach it with `atlas.faceRegion(origin, right, up, region)` or
`atlas.meshRegion(surface, region)`. After `finish()`, `SpriteSurface.update`
writes a matching top-down RGBA raster into the region and marks those pixels
dirty. [Camera feeds on textured panels](camera-atlas.md#route-a-feed-to-the-world)

Run `ink-studio render examples/textured-surfaces.js` for a mixed example. Its `build(seed,{textured:false})` also exercises the SDF and splat rendering path.

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
perspective-correct UV gradients to integrate that footprint. Aligned
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
