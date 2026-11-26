# Headless terrain sets

Build a terrain set from overlapping height tiles and one retained recipe.
Ink stitches shared samples before erosion, resolves biome masks on the
stitched grid, and writes terrain, route fragments and placements into
independent chunks. [Alder Crossing](../examples/alder-crossing.cjs) shows a
road diversion, relocated frontage, and a landmark replacement through
three streamed windows.

```sh
node examples/alder-crossing.cjs alder-crossing
node cli/ink-studio.js terrain-set inspect alder-crossing/terrain.json
node cli/ink-studio.js terrain-set edit alder-crossing/terrain.json alder-crossing/revision.json \
  --out terrain-edited.json --report edit-report.json
node cli/ink-studio.js terrain-set bake terrain-edited.json --out terrain-build
node cli/ink-studio.js terrain-set stream terrain-build/manifest.json alder-crossing/views.json --out residency.json
```

## Grid and stitch recipes

A version 1 `ink-studio/terrain-set` JSON document has an `id` and
optional integer `seed`. The required `grid` has an XZ `origin`, world
`cell` spacing, `tileCells` per side and a two-component `size` in tiles.
Supply every address in that rectangle in `tiles`. A tile contains its
zero-based XZ address `at` and `(tileCells + 1)²` heights as one array, with
X fastest. Adjacent tiles independently supply the same shared border
samples.

The default stitch mode, `average`, averages duplicate samples once on
the shared lattice. Set `stitch.mode` to `strict` to reject mismatches
larger than `stitch.tolerance`. Strict mode also averages values within
tolerance. The build reports the number of shared and mismatched vertices
and the largest original delta. Shared normals are calculated after
terrain modifications, so both sides export the same edge positions and
normals.

Optional `erosion` uses Ink's watershed and stream-power incision on
the stitched grid. Set `strength`, `steps`, `maxDepth`, or `minArea`.
Set `protect` to a painted mask to skip incision where coverage is at
least one half. Erosion subtracts the incision depth from the stitched
heights. River-bed cuts are applied afterwards.

## Masks and biomes

Each named `masks` row has an `id` and a `source`. For `paint`, use Ink
swept strokes with XZ `points`, a width or radii, optional feather
`softness`, and the native add and erase operations. Painted masks
sample the shared lattice and interpolate between its vertices.

Derived masks use `height`, `slope` (rise/run), `moisture`, `incision`,
or `route` distance. Specify a `range` of full coverage and an optional
`feather` outside it. A route mask also names a `route` ID. Moisture
combines watershed wetness and proximity to the authored river.
`biomes` names a `fallback` biome and optional `regions`, each with an
`id`, `mask` and optional `weight` in [0, 1]. Ink's biome selector
resolves overlap and exports the winning biome ID at each terrain vertex.

## Roads, rivers and frontage

A route has an `id`, a `kind`, full `width`, and ordered `points`.
Each point has a stable `id` and XZ `at` position.

- `road` drapes a corridor on the terrain. The baked road coverage fades
  where it meets water coverage.
- `river` takes optional `depth`, downhill `grade` and starting
  `waterHeight`. Its water profile follows the lower of local terrain and
  the previous level minus the grade. The bed blends toward that profile
  minus the depth. Where routes of one kind overlap, the nearest centerline
  supplies the corridor.
- `buildings` places a `prototypeId` at fixed `spacing` along each span,
  with optional `setback` and `side` (`left`, `right`, or `both`). The
  footprint anchors sample terrain height and export route tangent yaw.
  Stations are keyed by the neighboring control IDs, so changing an
  unrelated span does not renumber them.

Route fragments carry their named span and the interval `t` on the
original span. They are clipped in XZ to each tile. Ground routes export
terrain heights at fragment endpoints. River fragments preserve their
linear water profile. Treat the coverage and centerline as the authoring
outputs for crossings, surfaces, or downstream mesh generation.

An edit request supplies an `operations` array and optional source
`revision` from `inspect`. Use `move-point`, `insert-point` (with
`after`), or `remove-point` with `route` and `point`. Use `set-route`
or `set-mask` with the complete replacement record. An edit validates
the full result before writing the new recipe.

## Scatter, variations and levels of detail

`scatter` entries supply an `id`, `prototypeId`, and base `density`
in [0, 1]. Optional `mask` multiplies density, `biomes` restricts eligible
habitat and `clearance` adds separation from the road or river.
`options` accepts Ink population controls such as spacing, jitter, slots,
seed, and exclusion distance. IDs come from the world lattice, so loading
a different set of tiles cannot move a surviving placement. Keep the
spacing and seed fixed to retain that identity while changing density.

A prototype has named weighted `variants`. Each variant lists `lods`
with ascending `distance` thresholds starting at zero and the `asset`
ID at each threshold. Placement picks the variant from its stable seed.
Streaming selects the level by ground distance to the viewer while
keeping the chosen variant and transform. Asset IDs reference the
consumer's geometry, sprite or splat definitions.

Use `set-replacement` with an instance `id` and a different
`prototypeId` to swap the asset while keeping position, yaw and scale.
Set `prototypeId` to null to suppress the instance. Use
`clear-replacement` to restore the original choice. The bake reports
unmatched overrides for candidate IDs currently absent from the layout.

## Streaming manifests

`bake` writes a `manifest.json`, a build report, and content-addressed
`tiles/*.json`. Each chunk contains its grid address, heights, normals,
named masks, biome IDs, corridors and placements. The manifest names the
exact byte count and digest for each tile. Re-baking identical tile data
keeps its digest, even when another tile changes.

A stream request sets `budgetBytes`, optional `concurrency`, and an
ordered array of viewer records with an `id`, XZ `at`, and optional tile
`radius`. Ink loads and verifies only admitted tiles. It reports loaded,
retained, evicted and deferred tiles for each view, with the chosen asset
and LOD for each resident instance. The byte budget accounts for encoded
tile payloads. All views in a request share one residency cache. The
compiled grid is limited to 256 tiles and 120,000 unique height samples.

The SDK exposes recipe, bake and selection functions through
`KIT.procedural.terrainSet`. Use `KIT.procedural.terrainSet.mesh(tile)`
to turn an exported tile into indexed geometry. Use
`KIT.procedural.terrainSet.lod(instance, viewerXZ)` to select a
resident asset at a particular viewpoint.
