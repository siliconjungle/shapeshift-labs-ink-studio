# Scale-aware previews

`KIT.procedural.lod.preview` selects a bounded procedural asset at the level
the current camera can resolve. Begin with a recognizable coarse version.
Declare the smallest new feature and estimated generation work of each
finer level. Headless and WebGL renderers use the same selection against
the native art grid.

```js
const A = K.procedural.lod.preview;

const mosaic = A.tiling({
  id: 'mosaic',
  bounds: { min: [-2, -2, 0], max: [2, 2, 0] },
  basis: [[1, 0, 0], [0, 1, 0]],
  family: 'penrose', radius: 2, depth: 5,
  minPixels: 3, minWorldSize: .08, maxWork: 1600,
  build: layout => paintTiles(layout) // return a finished SpriteSurface atlas
});

const world = B.finish({ scalePreviews: [mosaic], cam });
```

## Set the budgets

- `minPixels` defaults to 2.5 native art pixels. A finer level becomes
  eligible once its smallest feature reaches that projected size.
  The coarse level stays available whenever the subject is visible.
- `minWorldSize` is a world-space feature floor. A large close-up
  still observes this floor.
- `maxWork` caps each asset's declared generation cost. Every budget
  must allow the coarse level. Use increasing `work` and decreasing
  `feature` for successive levels of a custom asset.
- `bounds` is a world-space XYZ box. A projected box outside the viewport
  or clip range skips generation. Without a chart basis, the projection
  uses the farthest visible bound to estimate the native pixels per
  world unit. For a planar asset, provide perpendicular world directions
  as `basis: [u,v]`. The smaller projected axis scale accounts for
  foreshortening.

A level is built on first use and cached. Selection depends on the sampled
camera and art dimensions, so direct seeks and animation return the same
level. A level switch replaces the preview representation. Give successive
levels a common silhouette or motif and use stable ancestor addresses for
colors or larger marks.

## Built-in sources

- `A.tiling(options)` selects Penrose or Ammann–Beenker subdivision
  depth. It estimates the thinnest tile span in world units and counts
  substitution pieces before making polygons. `maxPieces` caps the
  final unpaired pieces. `maxWork` uses total visited pieces.
  Pass `build(layout, level)` to convert the selected layout to an atlas.
  The default asset is the layout itself. Root addresses stay valid
  throughout the hierarchy.
- `A.menger(options)` selects the number of Menger folds. The first
  level already has the main axial openings. The scale of the smallest
  new passage determines screen eligibility. Work is the number of
  samples in a `(3 ** iterations)` cubic grid multiplied by the fold
  count. `build(form, level)` receives the signed field and its
  recommended `level.samplesPerAxis`. The default asset is the
  signed field.
- `A.create({ bounds, levels, ...budgets })` accepts any ordered set of
  representations. Each level has `{ id, feature, work, build }`.
  A renderer attachment uses `build(level)` to return a finished textured
  surface atlas. For stand-alone use, the asset can be a mesh, field,
  tile layout, or any other retained representation.

## Inspect the decision

```js
const view = A.camera(world, { w: 480, h: 320, pixelSize: 2, dist: 20 });
const report = mosaic.inspect(view);
const { asset } = mosaic.select(view);
```

`inspect` reports the projected width and height, pixels per world unit,
selected level, and the reasons the next level is limited. `select` also
returns the cached asset and returns `asset: null` for a culled box.
To observe the actual renderer decision, pass a `scalePreviewFrame(rows)`
callback in frame options. Headless supersampling uses the native art
dimensions. The WebGL renderer receives its art dimensions directly.

Attach up to eight named previews through `world.scalePreviews`. Ordinary
sprite surfaces and preview surfaces share depth with the scene.
Pass `scalePreviews: false` to omit their preview layer. The CLI option
is `--scale-previews off`.

[Fractal and Tiling at Three Scales](../examples/scale-aware-previews.js)
uses actual Penrose polygons and Menger geometry. Compare the same scene
at two orthographic camera distances.

```sh
node cli/ink-studio.js render examples/scale-aware-previews.js --w 420 --h 230 --px 1 --ortho --dist 58 --out far.png
node cli/ink-studio.js render examples/scale-aware-previews.js --w 420 --h 230 --px 1 --ortho --dist 7 --out near.png
```
