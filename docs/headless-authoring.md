# Headless procedural authoring

These APIs are available through `KIT.procedural` in Node and the browser bundle. Graph specifications are JSON data. Register executable operations in host code and share their typed inputs and outputs with the specification.

For image review and export, pass the finished world to Node's CPU `render()`. For interactive review, pass the world and authoring toolkit to the [WebGL canvas renderer](browser-renderer.md).

## Edit generated parts from the CLI

From the checkout, inspect the [editable passage](../examples/editable-passage.js)
and try its [edit batch](../examples/editable-passage.edits.json).

```sh
node cli/ink-studio.js authoring inspect examples/editable-passage.js --part '@/wall/parts/doorway'
node cli/ink-studio.js authoring preview examples/editable-passage.js examples/editable-passage.edits.json --image passage-preview.png
node cli/ink-studio.js authoring apply examples/editable-passage.js examples/editable-passage.edits.json --out passage.json
node cli/ink-studio.js render examples/editable-passage.js --authoring passage.json --out passage.png
```

`inspect` returns JSON with the current revision and entity records. Generated
records include the owner, rule, and key. A scene with a spatial context also
reports registered bounds and surfaces and resolves any authored anchor into a
world-space frame. Omit `--part` to list the whole scene.

Edit files contain an `operations` array and can pin the base by copying the
`revision` from `inspect`. Use these operations.

| Operation | Fields | Effect |
| --- | --- | --- |
| `update` | `id`, `patch` | Merge `parameters`, `anchor`, `parent`, or `styleRef` into the part. Generated edits become retained overrides. |
| `suppress` | Generated part `id` | Hide the part and suppress its slot on regeneration. |
| `allow` | Owner `id`, `rule`, `key` | Clear suppression so the rule can emit the part again. |

The batch reconciles its generation rules after staging all operations.
Both commands return added, removed and updated IDs, changed part records,
and checks from the scene's realization. The passage example rebuilds the
splats and colliders from the same geometry and checks whether a character
can still walk through the doorway and up the stairs. A failed scene check
returns exit code 2 and leaves the snapshot and image unwritten. Bad input
or a stale revision returns exit code 1.

Pass `--authoring passage.json` to inspect or edit a saved snapshot. Each
`apply` takes a new output path, so the previous snapshot remains available
for rollback. The output uses the existing retained-document format.
Preview can save a PNG to a new path with `--image`.

### Enable the CLI for a scene

Add `authoring(seed, {snapshot, controls})` to a JavaScript scene descriptor.
Return a retained `document`, an optional authoring `context` bound to it,
and `realize(snapshot)`. Initialize the default document when no snapshot is
supplied. The CLI passes any `--params` JSON as `controls` and uses the saved
seed when loading a snapshot.

The CLI reconciles the context, stages edits in one document transaction,
and calls `realize` with the immutable candidate. Return `{world, checks}`
or a promise for that result. A check contains `id`, Boolean `pass`, and
optionally a message and JSON evidence. Every check must pass before the
CLI writes an output. Successful realization supplies a packed render world.
A rejected realization can omit the world. Use the same realization in the
scene's normal `build` hook to render the saved snapshot.

## Fixed-size image framing

`KIT.captureFrame.fixed(viewWidth, viewHeight, options)` returns the centred
crop, exact output size, art raster dimensions and a lens multiplier. `aspect`
accepts `view`, `wide`, `square`, `portrait` and custom ratios from .25 through
4. `edge` is the longest PNG side in pixels. `scale` controls whole art-pixel
blocks from 1 to 8. A crop changes the lens around the same camera target.

```js
const studio = require('@shapeshift-labs/ink-studio');
const { captureFrame } = studio.load().KIT;
const frame = captureFrame.fixed(480, 360, { aspect: 'wide', edge: 1920, scale: 4 });
const art = studio.render(world, { w: frame.renderWidth, h: frame.renderHeight,
  px: 1, colored: true, lensScale: frame.lensScale });
const rgb = captureFrame.pixels(art.rgb, frame, { channels: 3 });
```

`pixels` expands each art pixel by an integer factor and trims any fractional
block at the output border. Use `flipY: true` for a bottom-up framebuffer
readback. The software renderer's `lensScale` also works independently with
either perspective or orthographic cameras.

## Graphs and reusable groups

```js
const graph = K.procedural.graph.create({
  inputs: { offset: { type: 'number', default: 2 } },
  nodes: {
    width: {
      op: 'add',
      inputs: {
        a: { input: 'offset' },
        b: { keys: [{ time: 0, value: 0 }, { time: 2, value: 1 }] }
      }
    }
  },
  outputs: { width: { node: 'width' } }
}, {
  operations: {
    add: {
      inputs: { a: 'number', b: 'number' },
      outputs: { value: 'number' },
      run: ({ a, b }) => ({ value: a + b })
    }
  }
});
const frame = graph.evaluate({ offset: 3 }, { time: 1, seed: 7 });
frame.outputs.width;
frame.preview('width');
frame.status.width;
```

Connections read an exposed `input`, a `node` and optional `port`, a keyframe track, or a literal `value`. Types include scalars, vectors, geometry, fields, points and raster images. A node's inputs, seed and optional clock control its cache. Returned preview handles see the outputs of their own run. Wrap a graph using `graph.group(spec, { operations, groups, outputs })` and register it as an operation in another graph. Each group instance owns its cache. Preview an inner node with a path such as `frame.preview('groupName/innerNode')`. Use `clear()` after changing resources in place. Built-in operations include `meshPaths`, `attributeTransfer`, `densityMesh`, `densityPoints`, `materialSample`, `rasterLayer`, and `tiles`.

`graph.repeat(value, count, step, { seed })` iterates a value. `graph.each(items, fn, { seed })` gives each item a reproducible seed based on its ID. `graph.simulation({ initial, step, dt, checkpoint, cache, maxSteps })` advances states using fixed timesteps. Sample with `simulation.sample(time, { inputs, version })` to retrieve an exact fixed-step state, the number of steps replayed, and the cached checkpoints. Bump the version when the simulation inputs change.

## Run a graph project from the CLI

The [headless graph project](../examples/headless-graph.json) uses a named
parameter, an animated link, and a [reusable group](../examples/headless-graph-group.json).

```sh
ink-studio graph validate examples/headless-graph.json
ink-studio graph plan examples/headless-graph.json
ink-studio graph inspect examples/headless-graph.json --node gain/scale --at 0.5
ink-studio graph run examples/headless-graph.json --at 0.5 --out graph-out
ink-studio graph batch examples/headless-graph.json cases.json --out graph-batch
ink-studio graph session examples/headless-graph.json --protocol ndjson
```

Use `"format": "ink-studio/graph-project"` and `"version": 1` with the same
`inputs`, `nodes`, and `outputs` as a library graph. Set input defaults on the
typed ports and pass overrides as a JSON object with `--inputs values.json`.
Optional project `time` and `seed` default to zero. Set `--at` for seconds and
`--seed` for a specific integer seed.

The `groups` map registers each named group as an operation. A group value is
an inline graph or a file path relative to the project. Group files use
`"format": "ink-studio/graph-group"` and `"version": 1` with the graph fields.
Groups can use other groups registered in the same project. Each instance
owns its own evaluator and cache. Validation checks typed links, missing
ports, asset references with literal names, and dependency and group cycles
without running nodes. Planning reports the evaluation order, source links
and inferred output types. Add `--inputs` to validate and show resolved
parameter values.

`inspect` accepts `--output NAME` or `--node PATH` with optional `--port NAME`
(defaults to `value`). Use slashes to address a node inside group instances.
The JSON report describes the sampled value. With `--out DIRECTORY`, a
serializable preview is written as PNG or JSON alongside the report.

In addition to the stock procedural graph operations, the runner registers
`add`, `multiply`, and `lessThan` with numeric `a` and `b` inputs, `time`, seeded `random`,
and `pngAsset` and `jsonAsset`. An asset operation reads a `name` from the
project's `assets` map. For example `"sprite": {"format":"png","file":"sprite.png"}`
declares a PNG asset called `sprite`. Assets are loaded relative to the
project and held as a snapshot for the life of the session. The plan and runs
share a hash of the project, resolved group definitions, and asset bytes.
Host operation implementations are supplied separately.

Use `{"format":"indexed-png","file":"sprite.png"}` with
`indexedPngAsset` to keep the PNG's original palette slot numbers,
including duplicate swatches. The node returns the one-channel slot
raster as `value`, the ordered swatches as `palette`, and per-pixel
opacity bytes as `alpha`.

### Outputs and CI

Declare `exports` as a map of artifact names to `{ "output": "name", "format": "json" }`,
`"png"` for RGB8 or RGBA8 image outputs, or `"atlas"` for an Ink sprite
atlas bundle. With `--out`, runs write those
artifacts and `report.json`. The stdout report includes artifact paths,
SHA-256 hashes and cache hits and misses for every executed node, including
group paths. Cache statuses describe the current evaluation. Unchanged
artifacts have the same hash across cold and warm runs.

Declare assertions on named outputs with `id`, `output`, `op` and `value`.
Use optional `path` to select record keys or array indices. Operators are
`eq` and `ne` for exact equality, `min` and `max` for inclusive numeric
limits, and `sha256` for a PNG or JSON byte hash. JSON exports sort object
keys and use UTF-8, two-space indentation and a trailing newline. Missing
paths fail. For example:

```json
{"id":"nativeWidth","output":"sprite","path":["width"],"op":"eq","value":32}
```

A batch file is an array of cases. Each case has a unique `id` and optional
`inputs`, `time` and `seed`. Cases run in order using one compiled graph.
`--inputs`, `--at` and `--seed` give defaults and each case can override
them. The CLI writes one report and artifact set per case under
`cases/<id>/` and an aggregate report at the output root. For example:

```json
[
  {"id":"default","time":0.5},
  {"id":"repeat","time":0.5},
  {"id":"regression","time":0.5,"inputs":{"base":1}}
]
```

Exit status is 0 on success, 2 when any assertion fails, and 1 for invalid
input or execution errors. Assertion failures still write the declared
artifacts and report.

Use [graph clips](graph-clips.md) to export a named raster or scene output at
an exact frame rate with warm-up and cuts.

### Persistent sessions

Send one JSON request per line. The response echoes the optional request
`id` and includes the per-request `code`. Use `run`, `inspect`, `plan`,
`clear` and `quit`. For example:

```json
{"id":1,"op":"run","inputs":{"base":5},"time":0.5,"seed":9}
{"id":2,"op":"inspect","node":"gain/scale","inputs":{"base":5},"time":0.5,"seed":9}
{"id":3,"op":"quit"}
```

Session requests use independent parameter overrides. A bad request returns
an error response and the session can answer later requests. `clear` resets
node and group caches. If the session has `--out`, each run or inspection
publishes into its own `request-N` directory.

Use `ink.readGraphProject(file)` or `ink.createGraphProject(spec, { baseDir,
operations })` in Node for the same validation, planning, inspection and
execution. `run` returns the native named outputs in addition to the report
and encoded artifacts. Operation implementations can be registered from the
host using `operations`, or from an `ink-studio.config.js` file using
`graphOperations`. Treat input and output values as immutable while an
evaluator caches them.

## Typed data and arrays

Declare these types on project inputs, group ports, or library operations.

| Port type | Value |
| --- | --- |
| `raster` | `{width, height, data, channels?}` with 1–4 interleaved channels of finite samples. Omit `channels` to infer it from the buffer length. PNG export requires RGB8 or RGBA8. |
| `field` | A callable field or an Ink handle with a `sample` method. Graph operations can produce fields such as the distance output of `meshPaths`. |
| `path` | At least two finite points of the same dimension (2D or 3D), or `{points, closed?}`. |
| `mesh` | 3D `points` and indexed polygon `faces`, or flat triangle buffers named `pos`/`tri`, `positions`/`indices`, or `points`/`triangles`. |
| `palette` | 1–256 swatches as packed RGB integers, six-digit hex strings, or RGB triples in `[0,1]`. Accepts a swatch array or `{palette}`. |
| `atlas` | An Ink sprite atlas with `metadata` and RGBA8 `images`, or its compiled handle. Use `atlas.compile` to make the handle in a graph. |
| `audio` | `{sampleRate, channels, samples}` with a positive integer rate and channel count and complete frames of normalized interleaved PCM samples in `[-1,1]`. |
| `record`, `array`, `array<T>` | A plain named record, an array of arbitrary values, or an array whose elements must satisfy port type `T`. Arrays can nest, as in `array<array<number>>`. |

Use a `data.typed` node with a top-level `type` and a `value` input to
validate a literal or a value from `jsonAsset` and expose a typed output.
Graph planning checks links between declared types. A link from `any` is
checked against the receiving port when evaluated. Node callers can supply
native typed buffers and compiled handles as input overrides. Their contents
must stay immutable while cached.

### Array operations

`array.map`, `array.filter`, `array.reduce`, and keyed `array.sort` take
`items` and name a reusable callback with the node's `group` field. The group
declares an `item` input and a `value` output. It can also declare a numeric
`index` for the zero-based index in the input array. Further group inputs
become ports on the array node. Each item gets a deterministic seed based
on its index and the node seed.

| Operation | Group output and result |
| --- | --- |
| `array.map` | Replace each item with the group's `value`. |
| `array.filter` | Keep items whose group returns `true`, in input order. |
| `array.reduce` | Pass `initial` to the group's `accumulator` input, then feed each returned `value` into the next call in input order. An empty array returns `initial`. |
| `array.sort` | Use finite numbers or strings as keys, in `asc` or `desc` order. Equal keys preserve input order in both directions. Omit `group` to sort an array of numbers or strings directly. |

`array.broadcast` takes an `arrays` record of named axes and an explicit
`mode`. Use `data.record` to assemble axes linked from other graph nodes.
The output has one record per row, keyed by axis name.

| Mode | Alignment |
| --- | --- |
| `zip` | Pair entries at the same index. All axes must have the same length. |
| `cycle` | Run to the longest length and wrap shorter axes. |
| `hold` | Run to the longest length and repeat the last entry of each shorter axis. |
| `cartesian` | Produce every combination. Axis names sort lexically and the last axis varies fastest. |
| `cartesianReverse` | Produce every combination with the first sorted axis varying fastest. |

An empty axis produces zero rows when the lengths are valid for the mode.
Set `limit` to cap the number of output rows. The same operation is available
as `KIT.procedural.graph.arrays.broadcast(arrays, { mode, limit })`.

### Cartesian parameter sweeps

`graph batch` also accepts a sweep object. Each axis contains a nonempty
array of values. Sweep any named graph parameter under `inputs` and
optionally `time` and `seed`. The batch uses sorted axis names
(`inputs.NAME`, `seed`, `time`) with the last axis varying fastest. It
assigns sequential case IDs with the given `idPrefix` and reports the axis
lengths and case count alongside the regular batch results. The default
limit is 256 cases.

```json
{"idPrefix":"signal","sweep":{"inputs":{"gain":[1,2,3],"threshold":[2,3]}}}
```

The [signal graph](../examples/headless-array-graph.json) maps, filters,
sorts, and reduces a typed numeric array. Run it for six combinations
using the [sweep definition](../examples/headless-array-sweep.json).

```sh
ink-studio graph batch examples/headless-array-graph.json examples/headless-array-sweep.json --out graph-sweep
```

## Standalone raster composition

The raster library lives at `ink.load().KIT.procedural.raster`. The same
operations are stock nodes in versioned graph projects. They work on
standalone canvases and imported PNGs. Canvas coordinates start at the
top left, with X right and Y down. Color composition uses straight-alpha
RGBA8 in and out. One-channel rasters can also carry signed or fractional
values, such as depths in scene units or normalized masks.

| Graph operation | Inputs and outputs |
| --- | --- |
| `raster.canvas` | Set `width`, `height` and an optional RGB or RGBA `color` in byte units. Defaults to transparent. |
| `raster.channel` | Extract a channel from `source`. Set `options.channel` to an index, `r`, `g`, `b`, `alpha` or `luma`. |
| `raster.channels` | Set `planes` to one to four aligned single-channel rasters or constants. At least one plane supplies the dimensions. |
| `raster.math` | Set `a`, `b` and `op`. `b` may be an aligned raster or a scalar. A single-channel `b` broadcasts across the channels of `a`. |
| `raster.mask` | Multiply `source` alpha by an aligned `mask`. Set `options.channel` (default `luma`), `scale` (default 255) and `invert`. |
| `raster.rgba` | Convert `source` to RGBA8 for display or PNG export. One and two channels represent gray and gray-alpha. |
| `raster.frame` | Composite the current time of an Ink layered raster `source`. Set optional `options.tag` and `layers`. |

Channel math offers `add`, `subtract`, `multiply`, `divide`, `min`, `max`,
`difference`, `power`, `greater`, `less` and `equal`. Comparisons produce
zero or one, so set mask `scale` to 1 when using them to gate coverage.
Math preserves numeric results and rejects nonfinite samples. Inspect
numeric channels with `graph inspect` or export them as JSON.

### Layers, depth, and height

Use `raster.blend` for a `background` and `foreground`. Its `options`
describe the foreground layer. Use `raster.stack`, `raster.depth` or
`raster.height` with explicit `width`, `height` and a `layers` array for
several layers. A layer has a `source` raster and optional integer `x` and
`y` offsets, `opacity` from 0 to 1, RGB `tint` multipliers from 0 to 1, a
local `mask` with `maskOptions`, and a blend `mode`.

Modes are `normal`, `multiply`, `screen`, `overlay`, `hardLight`,
`softLight`, `add`, `subtract`, `darken`, `lighten`, `difference` and
`exclusion`. The ordinary stack draws from back to front in array order.

- `raster.depth` accepts a scalar or an aligned one-channel `depth` per
  layer. Lower values are closer. It sorts covered samples per pixel and
  resolves ties in stack order. The `depth` output gives the closest
  contributing depth. Use the color output's alpha for coverage.
- `raster.height` compares a scalar or an aligned one-channel `height` per
  layer as it composites. Higher samples come forward. `options.bias`
  shifts the comparison and `softness` feathers the join in height units.
  The `height` output contains the visible, coverage-weighted height.

Create each layer record with `data.record` to link its image and maps.
Use another `data.record` to name those layers and `data.collect` with a
`source` record and `keys` array to assemble them in explicit order.

### Sprite transforms and packing

| Graph operation | Options |
| --- | --- |
| `raster.crop` | Set `x`, `y`, `width`, and `height` of an in-bounds rectangle. |
| `raster.resize` | Set `width` and `height`. Choose `nearest` (default) or `bilinear` for `filter`. Bilinear filters colors with premultiplied alpha by default. Set `premultiply: false` for independent numerical channels. |
| `raster.nineSlice` | Set `width`, `height`, and `insets: [left, top, right, bottom]`. Choose `stretch` or `repeat` for `fill`. Corners retain their original dimensions. |
| `raster.spriteStack` | Pass one raster or a bottom-to-top array as `source`. Set the repeat `count`, per-slice pixel `shift`, rotation `angle` in radians, first or last slice `anchor`, base `tint`, or `endOpacity`. Set `size` and optional `position` for a fixed canvas. Omit them to fit the full stack. |
| `raster.pack` | Set `sprites` and options such as `maxWidth`, `maxHeight`, transparent `padding`, edge `extrude`, and alpha `trim`. Outputs the color raster, native `atlas` and `metadata`. |

Crop, resize, and nine-slice accept an optional pixel `pivot: [x, y]` on
the source raster and map it into the result. Sprite stacks align slices
by pivot, falling back to their centers.

Atlas entries can be a raster or a record with `source`, `id`, optional
`pivot`, `unitsPerPixel`, and aligned `maps` such as `normal`, `emission`,
`silhouette`, and `depth`. For Ink RGB24 depth maps provide
`options.depthRange: [near, far]`. Packing keeps the original frame order
and records each source size, trim offset, atlas rectangle and adjusted
pivot. Export the node's `atlas` port with `format: "atlas"` to write
`artifacts/<name>/atlas.json` and its PNGs, ready for `readSpriteAtlas`.

Generate the [review example](../examples/raster-composition.cjs) to see
depth-sorted rings, height-blended moss, a masked beacon beam, a stamped
sprite stack, a nine-slice panel, and a packed sheet. The example writes the
input PNGs and graph project, runs the CLI, and makes a PNG review board.

```sh
node examples/raster-composition.cjs raster-composition-review
ink-studio graph run raster-composition-review/composition.json --out raster-composition-review/graph
```

## Drawing, layout, and regions

Use `draw.render` with `width`, `height`, and a `commands` array to
make a transparent standalone raster. Commands draw in order, in
top-left pixel coordinates. Set `edges: "hard"` for pixel coverage or
use the default `"smooth"` coverage. Hex colors accept RGB and RGBA.

| Command | Settings |
| --- | --- |
| `rect`, `ellipse` | Specify `rect: [x, y, width, height]`, `fill`, optional `stroke` and stroke `width`. Rectangles also accept a corner `radius`. |
| `polygon` | Set `points` for one contour or `rings` for several. Fill uses even-odd coverage, so a second contour can cut a hole. |
| `path` | Use 2D `points`, a linked typed path in `source`, or an SVG-style `d` string. Set `color` or `stroke` and `width`. For filled contours, set `fill` and close each contour. |
| `ribbon` | Follow a 2D path with a constant width or one width per path point. Set `fill`, optional `stroke` and `strokeWidth`, and a `miterLimit` for corners. |
| `text` | Set `text`, integer `at: [x,y]`, `color`, and optional bitmap typography settings. |
| `arrow`, `grid` | Use the screen-space settings from [Drawing primitives](drawing-primitives.md). |

`draw.path` turns one `d` contour into a typed `{points, closed}` path.
The path syntax supports absolute and relative `M L H V Q C A Z`.
Use `options.steps` to sample curves. `draw.render` can also fill
multiple closed contours from one `d` string. `draw.ribbon` accepts a
typed `source` and returns a polygon command ready to draw. Assemble
linked commands in explicit order with `data.record` and `data.collect`.

`draw.text` generates a standalone bitmap raster and `metrics` with
its width, height, line count and scale. It uses Ink's 6×8 glyphs,
with integer `scale`, `tracking`, and `leading`, optional `columns`
for character wrapping, and `align: "left" | "center" | "right"`.
Supply `customGlyphs` as a map from characters to rows of `#` and
spaces to draw symbols in the same grid.

### Relative boxes

`layout.boxes` takes the canvas `width`, `height`, and a `boxes` array.
Each entry has an `id` and optionally a `parent`, `size`, `offset`,
`anchor`, `pivot`, and `padding`. Parents use their content rectangle
as the coordinate system for children. Size and offset accept pixels
or percentage strings relative to the parent span. Anchor fractions
select a point in the parent and pivot fractions select a point in the
child. Padding uses a number or four left, top, right, bottom values.
The result is keyed by ID. Each box reports a pixel-rounded `rect`
and `content` rectangle.

```json
{"id":"legend","parent":"sheet","size":["45%",18],"anchor":[1,1],"pivot":[1,1],"offset":[-4,-3]}
```

Get a named box with `data.get`. Pass the box and a `source` raster to
`layout.place` to produce a layer for `raster.stack`. Set `options.fit`
to `contain`, `cover`, `stretch`, or `none`. Fractional `align` defaults
to the center. Placement uses `content` by default and clips overflow.
Set `area: "rect"` to use the outer box, or `clip: false` to allow spill.

### Flood fill and connected components

- `raster.floodFill` takes a `source` and `options.seed: [x,y]`. It
  replaces the connected region with `color` and returns a byte `mask`
  and `stats` with area and pixel bounds. Choose `connectivity` of 4 or 8.
  Set `tolerance` to the maximum byte difference from the seed in each
  RGBA channel.
- `raster.components` thresholds the selected `channel` into adjoining
  regions. The default selects alpha on alpha-bearing sources and luma
  otherwise. Choose `threshold`, `invert`, `minArea`, and 4- or 8-way
  `connectivity`. IDs follow the first covered pixel in row-major order.
  The result contains component records with IDs, areas, seeds, and
  bounding rectangles, plus a one-channel `labels` raster with zero
  for background.
- `raster.extractComponent` takes the original `source`, `labels`, and a
  component record. It crops to the component bounds and clears pixels
  outside that component. Use it in an `array.map` group to pass the
  isolated sprites to `raster.pack`.

The library provides the same operations under
`ink.load().KIT.procedural.drawing2d`. The [tide chart example](../examples/drawing-layout.cjs)
renders two chart sizes, fills shoreline and lagoon regions, draws the
route ribbon, and extracts three symbols to a native atlas.

```sh
node examples/drawing-layout.cjs drawing-layout-review
ink-studio graph run drawing-layout-review/tide-chart.json --out drawing-layout-review/graph
```

## Palette and colour on rasters

Use the stock palette and colour nodes with PNG assets, drawn canvases,
or any typed raster flowing through the graph. In Node, the same
operations live at `ink.load().KIT.procedural.rasterColor`.

### Resolve an image to swatches

`palette.resolve` takes a `source` raster and an Ink palette `policy`. The
policy uses the same `palette`, `reserved`, `match`, and `dither` definitions
as [scene palette constraints](pixel-look.md#target-palettes-and-dithering). Use up
to 48 swatches including reserved accents. Link a palette into
`options.palette` to use named roles or indexed swatch references.
`palette.recipe` compiles the same definitions as `KIT.palette.recipe` and
returns the packed swatches and roles together.

| `options.method` | Resolve |
| --- | --- |
| `solid` | Use the nearest enabled swatch under the policy's match metric. |
| `ordered` (default) | Use the authored Bayer, checker, or blue-noise settings. `phase: [x,y]` offsets the pattern in raster pixels. |
| `diffusion` | Use Floyd–Steinberg error diffusion, with alternating scan directions by default. Set `serpentine: false` for a fixed direction and `strength` in 0–1 to control how much error travels. |

Ordered and diffusion modes respect the approved pairs and their lightness
ranges. An exact reserved input swatch stays intact and does not relay
diffusion error. Resolve keeps source alpha. The `palette` output lists
the resolved swatches and `indices` carries their zero-based slots as a
one-channel raster, with -1 for transparent or unselected pixels.

Set `options.mask` to an aligned raster to select where the operation
applies. Read `maskChannel` (default luma) using `maskScale` (default 255).
Palette resolve selects pixels at or above `maskThreshold` (default .5).
The other colour transfers use fractional mask coverage.

### Apply a look, map a gradient, or edit colours

| Operation | Inputs and options |
| --- | --- |
| `color.look` | Pass a versioned asset `pack` or bundle and a `binding` like `{"asset":"workshop/stone","revision":1}`. The node applies the look's stack, lighting ramp, and palette in that order where present. `metadata` identifies the bound revision and its components. |
| `color.gradient` | Pass a `ramp` as named role, colour list, explicit stops, palette path, or Ink spectrum, primary, or grayscale definition. The node samples OKLab `lightness` by default. Choose `options.channel` and `range` to drive it from another channel. |
| `color.stack` | Apply an Ink `stack` of channel mixes, curves, LUTs, exposure, hue, saturation, contrast, or indexed palette remaps. Indexed remaps use exact input swatches when present and choose the nearest supplied swatch for other colours. |
| `color.channels` | Set `options.order` to three or four selectors. Use `r`, `g`, `b`, `alpha`, `luma`, a byte constant, or a selector such as `{"channel":"g","gain":-1,"bias":255}`. Three selectors keep the source alpha. |
| `color.key` | Remove a colour with `options.color`, `metric`, `tolerance`, and `softness`. Set `mode: "channel"` with a `channel` and `range` for a channel key. Use `invert` to keep the selected region. The `matte` output contains the resulting alpha bytes. |
| `color.replace` | Pass `rules` with `from`, `to`, optional `tolerance`, `softness`, `amount`, and `preserveLightness`. The first matching rule uses the original pixel, so replacements do not cascade. |

For colour keys and replacements, `metric` can be `rgb`, `perceptual`
(OKLab), or `chroma` (the OKLab chroma plane). Distance and softness use
normalized colour units. Gradient and channel key settings use the
authored sample range. OKLab lightness is in 0–1 and ordinary RGB channels
are in 0–255. A numeric channel index can read a signed or fractional
channel directly.

With `color.look`, `options.channel` and `range` control the lighting
ramp input. Positive binding strength keeps palette output discrete, and
rule weight multiplies the mask coverage used for palette selection. Use
a false binding to bypass the look. The look protects exact reserved accents before its first
colour transform. Import packs through `jsonAsset` and PNGs through
`pngAsset`. The graph clock drives animated ramps and look time drivers.
Standalone ordered patterns use raster coordinates. Supply a raster mask
when applying a scene-masked look to an image. Scene dither regions use
the base pattern settings in a standalone graph.

Run the [Salt Sky Observatory example](../examples/raster-palette.cjs) to
compare solid, ordered, and diffusion resolves, apply a saved look, and
key and recolour the lantern. The demo writes the source PNGs, versioned
look pack, graph project, and native outputs.

```sh
node examples/raster-palette.cjs raster-palette-review
ink-studio graph run raster-palette-review/raster-palette.json --out raster-palette-review/graph
```

## Pixel effects and raster analysis

These graph nodes take a typed `source` raster. The library exposes the
same operations under `ink.load().KIT.procedural.pixelEffects`. Colour
effects return straight-alpha RGBA8 at the source dimensions. Tile
scrambling preserves the source channel count and sample values. Bitplane
effects also expose the edited palette indices. Add
transparent canvas margin before an effect when its coverage needs room
outside the original image.

| Operation | Options and additional outputs |
| --- | --- |
| `fx.kernelBlur` | Use a Gaussian or box `kind`, integer `radius` from 0 to 64, and optional Gaussian `sigma`. Supply a custom odd-size `kernel` array of nonnegative weights for an authored filter. Weights normalize to one. |
| `fx.pathBlur` | Link a 2D `path`. It samples the path at equal arc-length intervals. Set `samples`, `anchor: "start" \| "center" \| "end"`, `falloff: "uniform" \| "start" \| "end"`, and `filter: "linear" \| "nearest"`. Path coordinates are pixel displacements relative to the anchor. |
| `fx.outline` | Set `outer`, `inner`, and `feather` in pixels, plus `color` and `innerColor`. The `outer` and `inner` outputs are separate byte masks. |
| `fx.bevel` | Set `width`, 2D light `direction`, `strength` from 0 to 1, and `highlight` and `shadow` colours. The `height` output is a one-channel relief map in 0–1. |
| `fx.glow` | Blur a selected `channel` above `threshold` using `radius`, `sigma`, `strength` and `color`. Set `placement: "behind"` for a sprite halo or `"over"` with `mode: "screen" \| "add" \| "normal"` for an opaque image. Exports the separate `glow` raster and byte `mask`. |
| `fx.erode` | Recede from exposed edges by a Euclidean `radius` in pixels. Returns the edited raster and its surviving byte `mask`. |
| `fx.repair` | Use `method: "close"` and a Euclidean `radius` for holes and narrow gaps, or `"bridge"` and `maxGap` for breaks along rows, columns or diagonals. New pixels take the nearest selected source colour or an explicit `color`. Inspect them in the separate `added` mask. |
| `fx.pixelSort` | Sort contiguous eligible pixels along a horizontal, vertical, diagonal, or antidiagonal `axis`. Choose a `key`, optional inclusive `range`, `order`, and `minLength`. An aligned raster `mask` can limit sorting further. |
| `fx.tileScramble` | Copy, omit, or swap whole tiles on a fixed grid. Set `tileSize`, `mode`, `amount`, `seed`, `rate`, and an optional `mask`. The `addresses` output shows where each destination tile reads from. |
| `fx.tileBleed` | Replace selected whole tiles with tiles from a separate `bank` raster. Set `tileSize`, `amount`, `seed`, `rate`, and optional `mask` and `bankMask`. The `addresses` output identifies donor tiles. |
| `fx.tileStrideSlip` | Read successive tile rows using an authored `stride`, `offset`, and `wrapAt`. The `addresses` output shows where each whole tile reads from. |
| `fx.bitplane` | Flip a bit, clear a bit, or borrow a bit from an aligned `bank` of palette indices. Connect a one-channel `source` and its ordered `palette`. Outputs RGBA `value` and edited `indices`. |

Both blurs filter premultiplied colour and alpha with `edge` set to
`clamp`, `transparent`, or `wrap`. Kernel blur defaults to clamped edges.
Path blur defaults to transparent edges.

Outline, bevel, erosion, repair, and analysis take an optional
`channel`, `threshold` (default 128) and `invert`. They select visible
pixels from alpha for alpha-bearing rasters or luma otherwise. Choose a
named channel or a numeric index to drive the shape with a different
plane. Glow defaults to alpha and threshold 1. Use luma and a higher
threshold to isolate highlights on an opaque image.

Pixel sort supports channel names or indices, `hue`, `saturation`, and
OKLab `lightness`. Hue, saturation, and lightness use 0–1. Other keys use
the source channel's units. Transparent or excluded pixels break runs.
Equal keys retain input order, and each pixel carries its colour and alpha.
Mask eligibility uses `maskChannel` (default luma) and `maskThreshold`
(default 128).

### Scramble tile addresses

`tileScramble(source, options)` supports either color rasters or numeric
planes, such as a rasterized tile grid or palette indices. It reads the
original tile at integer coordinates and copies all channels, including
alpha, without resampling. The grid starts at the source's top-left pixel.
Incomplete tiles at the right and bottom keep their original pixels.

```js
const { value, addresses } = KIT.procedural.pixelEffects.tileScramble(sprite, {
  tileSize: [8, 8], mode: 'repeat', amount: .4, seed: 12, rate: 6, time
});
```

- `tileSize` defaults to `[8, 8]` native pixels. Set `amount` between zero
  and one (default `.25`). The operator rounds to a whole number of tiles.
- `mode: "swap"` (default) exchanges pairs and rounds the affected count
  down to an even number. `"repeat"` copies from unchanged eligible
  tiles with replacement, leaving at least one tile to read from.
  `"omit"` fills selected tiles with zeros, including alpha when present.
- An aligned `mask` restricts both source and destination tiles. Every
  pixel within a tile must meet or exceed `maskThreshold` (default 128)
  on `maskChannel` (default `"luma"`). In graphs, use `data.record` to
  link a raster mask into `options`.
- `rate` is the number of address updates per second. The default zero
  holds one mapping. At a positive rate the same `seed` and
  `floor(time * rate)` produce the same map, including on direct seeks.
  Direct calls default to seed 1 and time 0. The `fx.tileScramble` node
  inherits the graph clock and node seed unless overridden in `options`.
- `value` keeps the source dimensions and pivot. `addresses` is a
  one-channel raster with one sample per grid cell. A sample is the
  zero-based, row-major source tile index, or `-1` for an omitted tile.

For a [camera atlas](camera-atlas.md), convert `atlas.read(id)` from
`{ w, h, rgba }` to `{ width: w, height: h, channels: 4, data: rgba }`,
then send `value` to a raster layer or sprite surface. The
[tile address study](../examples/tile-address-scrambling.cjs) renders the
same effect on original sprite art and a moving camera feed.

### Bleed tiles from a separate bank

```js
const { value, addresses } = KIT.procedural.pixelEffects.tileBleed(sign, glyphSheet, {
  tileSize: [8, 8], amount: .35, mask: signArea, seed: 12, rate: 4, time
});
```

Use any raster as the separate bank, including a sprite sheet, a font
render, or a camera capture. Both inputs use the same tile size and
channel count. The source and bank can have different dimensions. Each
grid starts at its own top-left pixel. Incomplete source cells stay
intact and incomplete donor cells are excluded. Use `raster.rgba` to
normalize inputs with different color channel counts.

`amount`, `mask`, `maskChannel`, `maskThreshold`, `seed`, and `rate`
have the same meaning as in tile scrambling. An optional `bankMask`
restricts donor tiles independently with `bankMaskChannel` (default
`"luma"`) and `bankMaskThreshold` (default 128). If there are no eligible
donor tiles, the source is kept. Each affected tile reads from a seeded
donor address, which can repeat. The current bank pixels are copied
with all channels, including alpha. A changing camera feed can move
inside a tile even while the mapping holds.

`addresses` is a one-channel raster in the destination grid. Each sample
gives the zero-based, row-major tile index in the bank grid, whose column
count is rounded up. A value of `-1` marks an unchanged destination cell.
In a graph, connect the `source` and `bank` raster sockets. The node uses
the graph time and seed unless overridden in `options`.

The [cross-bank tile study](../examples/cross-bank-tile-bleed.cjs) shows
independent banks made from sprite art and an animated camera atlas.

### Slip tile row addresses

```js
const { value, addresses } = KIT.procedural.pixelEffects.tileStrideSlip(art, {
  tileSize: [8, 8], stride: 19, wrapAt: 96
});
```

The effect lays the source's complete tiles into a row-major read buffer.
A destination tile at column `x`, row `y` reads from
`offset + y * stride + x`, with all controls measured in whole tiles.

- The default `stride` is the number of full tiles in one source row.
  Add one to shift each successive row's read by one more tile. A stride
  of zero repeats one row and a negative stride reads rows in reverse.
- The default `offset` is zero. `wrapAt` defaults to the number of full
  source tiles and can be lowered to repeat the buffer early.
- At negative addresses or addresses at or beyond `wrapAt`,
  `boundary: "wrap"` (default) takes the positive remainder,
  `"keep"` keeps the destination, and `"omit"` fills it with zeros.
- An optional `mask` restricts writes using `maskChannel` (default
  `"luma"`) and `maskThreshold` (default 128). Reads can reach any complete
  source tile. Partial edge tiles stay intact and are excluded from reads.
- `value` preserves source dimensions, pivot, channels and copied samples.
  As with tile scrambling, `addresses` reports source indices on the
  destination grid, including any partial edge cells. A sample of
  `-1` means the tile was cleared.

For `fx.tileStrideSlip`, connect controls through `data.record`. Set
`ease: "step"` on integer control keyframes so a stride or wrap point
changes on a chosen frame. The
[tile stride study](../examples/tile-stride-slip.cjs) compares both controls
and shows the actual source address of each sampled row start.

### Corrupt a palette bitplane

```js
const { value, indices } = KIT.procedural.pixelEffects.bitplane(spriteIndices, palette, {
  mode: 'borrow', bit: 1, bank: donorIndices, bankBit: 0, mask: damagedArea
});
```

- Slots use the supplied palette order, from zero through the last
  swatch. A `-1` sentinel stays transparent. Both `bit` and `bankBit`
  range from 0 (least significant) to 7. The default mode is `"flip"` on
  bit zero. `"clear"` forces the selected bit to zero. `"borrow"` copies
  `bankBit` (default `bit`) from the matching pixel in the aligned,
  one-channel bank. A donor sample of `-1` keeps the source bit.
- The optional aligned `mask` uses `maskChannel` (default `"luma"`) and
  `maskThreshold` (default 128) for a binary selection. A bit change that
  references a slot outside the supplied palette keeps the original slot.
- Supply an aligned, one-channel `alpha` raster of bytes to carry source
  opacity through the effect. Fully transparent samples are excluded
  from corruption. The RGBA output uses exact swatches and the original
  pixel grid.
- In a graph, link `palette.resolve.indices` and `palette.resolve.palette`
  into `fx.bitplane` to start from RGB art, or use `indexedPngAsset` for
  existing indexed art. Link its `alpha` output into `options` through
  `data.record` to preserve partial transparency. Use the node's `bank`
  socket for borrowing.

The [bitplane study](../examples/bitplane-corruption.cjs) compares all three
modes on the same four-color sprite.

### Trace paths and points

`fx.analyze` returns `paths` as `array<path>`, `points` as
`array<vec2>`, a byte `mask`, and `regions` containing each selected
component's bounds, area, seed and centroid. Use `minArea` to omit small
components and `connectivity: 4` or `8` to define adjacency.

- Tracing follows the selected silhouette and its holes, including
  shapes that meet the canvas edge. Coordinates use the top-left pixel
  grid. Turn tracing off with `paths: false` when only points are needed.
  Tracing uses Ink's marching-squares budget of 500,000 cells including
  the border.
- Set `pointMode` to `centroids` (default), `boundary`, `pixels`, or
  `none`. Centroids and pixel samples use pixel centres. Boundary points
  follow the traced paths. Use `stride` to thin boundary or pixel
  samples and `limit` to bound point output.

The [Prism Moth example](../examples/pixel-effects.cjs) writes a complete
graph, native PNGs, and extracted paths and points. The preview redraws
the traced paths and marks the component centroids.

```sh
node examples/pixel-effects.cjs pixel-effects-review
ink-studio graph run pixel-effects-review/pixel-effects.json --out pixel-effects-review/graph
```

## Raster warps and 3D projection

The graph operations are also available under
`ink.load().KIT.procedural.rasterWarp`. Rasters and UVs use top-left
coordinates. A UV field is a numeric raster with two channels for U and
V, and an optional 0–1 coverage channel. U and V span the image edges
from zero to one. Each output pixel reads its source coordinate from
the field. Build custom fields by joining numeric planes with
`raster.channels`.

`warp.field` makes an affine inverse field from `width`, `height`, and
an optional two-row matrix. `warp.sample` applies any field to a
`source` raster. Set `options.filter` to `nearest` for exact texels or
`linear` for premultiplied-alpha interpolation. Address outside the
source with `edge: "clamp" | "transparent" | "wrap" | "mirror"`. Override
either axis with `edgeU` or `edgeV`.

| Node | Authoring |
| --- | --- |
| `warp.mesh` | Set `control.from` and `control.to` to corresponding normalized 2D landmarks. Supply `triangles` as triples of indices or a flat index buffer. Each destination triangle pulls pixels from its source triangle. Later triangles win overlaps. Uncovered pixels are transparent. |
| `warp.grid` | Set `control.columns`, `rows`, and row-major `points` for the destination lattice. The source is a regular grid. |
| `warp.polar` | Set `mode: "fromPolar"` to wrap a strip into a disc or annulus. Set `"toPolar"` to unwrap one. Strip X is angle and strip Y is radius. Set `center`, `radii` as fractions of the shorter disc dimension, `angle` in turns, and `clockwise`. |
| `warp.displace` | Supply a numeric `map` of one channel or an X/Y pair. Subtract `center` and multiply by the two `scale` values in `pixels` or `normalized` units. A positive displacement moves the image toward positive coordinates. |
| `warp.refract` | Supply a height raster in `map`. Choose its `channel`, `heightScale`, refractive `index`, and ray `depth` in pixels. Local height gradients bend the sampling ray. |
| `warp.morph` | Supply rasters `a` and `b` and a mesh `control` with landmarks for both. `amount` moves the landmarks and blends the aligned images. Use a named parameter or keyframed value to animate it. |

Mesh, grid, polar, displacement, and refraction nodes expose their
`field` alongside the rendered `value`. Reuse the field on another
raster, or export it as JSON. For mesh, grid, polar, and morph set
`options.width` and `height` to change output dimensions. Displacement
and refraction use the map's dimensions.

### Per-pixel time

`warp.timeRemap` samples an array of same-sized rasters at a separate
time for each pixel. Use `warp.frames` to read a named `tag` from an Ink
layered raster, optionally selecting `layers`. Its other outputs include
`fps`, the sample `times`, and whether the tag loops.

Set the remap's `options.fps` for evenly spaced frames or supply
increasing `times` that start at zero. The `map` selects a time in
seconds using `channel`, `scale`, and `bias`. `mode: "offset"` adds that
value to the graph clock. `mode: "absolute"` uses the value directly.
Choose `interpolation: "step" | "nearest" | "linear"` and
`playback: "hold" | "loop" | "pingpong"`. Looping can use an explicit
`duration` after the last frame, with a final interval back to the
first frame.

### Project on 3D surfaces

- `warp.surface` turns the raster into a native `SpriteSurface` batch
  using a triangle `mesh` with normalized UVs. Supply XYZ vertices, UV
  pairs and triangle indices. `options.alphaThreshold` controls the
  binary cutout. The Node graph output can go straight into
  `B.finish({spriteSurfaces: output})`. The mesh depth-tests with
  geometry and splats in the existing renderers.
- `warp.project` produces a projected raster material layer. Set
  `options.projection` to Ink's `plane`, `cylinder`, or `ribbon`
  projection and choose `space: "rest" | "world"`, `scale`, `wrap`,
  `strength`, and `stage: "material" | "lit"`. Export the layer as JSON
  or pass the native graph output to `KIT.surface.material`.

The [Ashlight Survey example](../examples/raster-warps.cjs) generates
the graph outputs, renders the same art on a curved mesh and a
projected splat cylinder, and saves a looping animated PNG.

```sh
node examples/raster-warps.cjs raster-warps-review
ink-studio graph run raster-warps-review/raster-warps.json --out raster-warps-review/graph
```

## Procedural generation and recipes

The stock graph runner includes 15 `proc.*` operations. The same generators
are available in the library as `KIT.procedural.generator`. Build reusable
graph groups around these nodes to expose the settings a scene or shot needs.
The graph seed is mixed with each node ID. Set `options.seed` on a seeded node
to reuse the same result under different node names. Animated sampling uses
the graph clock in seconds. Set `options.time` to hold a specific sample.

| Graph operation | Inputs and outputs |
| --- | --- |
| `proc.noise` | Compile a native [field expression](procedural.md#composable-procedural-fields) in `definition`. The `value` field works with simplex, periodic and time-loop noise, fractal stacks, masks and domain warps. |
| `proc.pattern` | Produce a 0–1 field. Set `kind` to `checker`, `stripes`, `dots`, `rings`, `brick` or `chevrons`. Set `size` in world units, `axes` to `xy`, `xz` or `yz`, `angle` in radians, `offset` and `velocity` as pairs, and `fill` as a fraction. |
| `proc.sample` | Rasterize a scalar `source` field at pixel centers across `origin` plus the plane vectors `u` and `v`. The one-channel raster retains signed and fractional values. Feed it to `color.gradient` with `channel: 0` and an explicit `range` to make artwork. |
| `proc.repeat` | Repeat a raster at an explicit output size with pixel `offset` and two-axis `scale`. Channel counts and numeric values are retained. |
| `proc.tiles` | Lay out weighted `definitions` with north, east, south and west sockets. `mode: "solve"` accepts `pins`, `ports`, `boundary` and `wrap`. `mode: "wang"` uses `labels` and a world-cell `origin` for independently generated chunks. Returns a layout with a status and, on success, row-major IDs. |
| `proc.tileImage` | Paint a successful `layout` with an `images` record keyed by tile ID. Each tile uses the same pixel dimensions. Masked cells stay transparent. |
| `proc.scatter` | Scatter points in 2D or 3D `bounds` at a minimum `radius`. Use a scalar field or raster `mask` and an exclusive `threshold`. A raster spans XY for planar scatter or XZ for spatial scatter. The default mask channel is alpha for RGBA and channel zero otherwise. Outputs include points, stable sample records and a work report. |
| `proc.path` | Make a typed path from planar or spatial `points`. Choose `mode: "linear"` or `"spline"`, interpolation `steps`, optional `closed`, and an optional count of equal-distance `samples`. Raw `points` and arc `length` have their own ports. |
| `proc.reaction` | Sample Ink’s Gray–Scott grid at an integer `steps` input. Set `width`, `height`, `feed`, `kill`, `wrap`, a same-size `mask`, or authored row-major `spots`. Returns V as `value`, U as `u` and update counts as `report`. Use step easing when keying the integer step count. |
| `proc.rain` | Rasterize `rain` or `snow` with configurable count, speed, wind, mark length, opacity and an optional raster mask. The `particles` port returns positions, tails and opacity in pixel space. |
| `proc.sparks` | Sample seeded births with a timed start/end, rate, lifetime, launch angle, spread, speed, gravity and trail length. Returns the transparent sprite layer and pixel-space particles. |
| `proc.plume` | Use Ink’s native `smoke`, `steam`, `spray` or `fog` emitter from an authored socket pose or socket track. Adjust its motion, life, style and volume or splat representation. Returns a flat XY preview and a serializable `recipe` for `look.atmosphereEmitters`. |
| `proc.tree` | Generate a `pine`, `broadleaf` or `bare` tree with adjustable levels, size and colour. Returns an XY raster, spatial `branches` with `pts`, `r0` and `r1` for sculpted tubes, and 3D `leaves` points. |
| `proc.cable` | Build a catenary from XYZ `start` and `end`, with `sag`, `gravity` and a segment count. Returns an XY raster, equal-arc samples on the spatial `path` port, and `length`. |
| `proc.parallax` | Composite raster `layers` at independent camera `factor` values with pixel `offset`, timed `velocity`, repeat axes, filter and opacity. Animate `options.camera` with a vector track to preview a pan. |
| `proc.horizon` | Package raster band sources as native 3D `look.horizonBands` with explicit radii, height ranges, azimuth, repeats and camera bounds. |

Use `data.record` to insert a connected field or raster into an options
record, and `data.collect` to wire named records into a layer array. Tree,
cable and plume previews use a pixel `origin` and `pixelsPerUnit` for the XY
projection. Art from any raster output can also go into `warp.surface` or
`warp.project` for use on 3D surfaces.

The Storm Relay example emits the editable graph, its rendered shot and
generator swatches, native horizon and emitter data, branch and cable
geometry, a matching 3D render, and an animated PNG.

```sh
node examples/procedural-generation.cjs procedural-review
ink-studio graph run procedural-review/storm-relay.json --at 1.22 --out procedural-review/graph
```

Use a [take clock](take-clock.md) to sample a graph, world, timeline, and
recorded media against one rational picture frame.

## Audio and automation

See [Audio, recorded inputs and host adapters](graph-media.md) for native
WAV assets, frame-aligned analysis, FFT channels, input recordings,
capture, codecs and the Pixel Composer preview bridge.

## Animation and raster simulation

`KIT.procedural.animationGraph` provides the same time mapping as the
headless graph. Angles use radians and clocks use seconds. A delay holds
the first playback sample until the local clock starts. Use the `active`
port to hide a layer during that hold.

| Operation | Inputs and outputs |
| --- | --- |
| `anim.keyframes` | Sample named `channels` from `keys`. A key has `time`, a named `value` for each channel, and optional `ease`. Uses Ink’s scalar, vector, angle, positive, quaternion and orientation interpolation. Returns the channel record and track duration. |
| `anim.clock` | Map the project clock to `options.range`, with `delay`, `rate`, `reverse` and `mode` of `hold`, `loop` or `pingpong`. Returns mapped time, progress, playback direction and activity. |
| `anim.stagger` | Sample several clocks with `count`, `options.interval` and `offset`. `reverseOrder` switches which item starts first. Returns mapped times and per-item clock records. |
| `anim.frame` | Select from raster `frames` with `fps` and a half-open interval from `first` to `end` in frame indices. Accepts the same delay, rate, reverse and looping controls. |
| `anim.retime` | Sample a reusable graph named by `group` at the time mapped by its `timing` input. The group retains its inputs and outputs and owns its independent simulation caches. Pass `timing.time` to feed an explicit time, such as an item from `anim.stagger`. |
| `anim.feedback` | Evolve an input array of raster `frames` at a fixed simulation `dt`. Set source `fps` and playback `mode`, signal `halfLife`, `gain`, optional `threshold`, `warp`, `filter`, and timed reset `cuts`. Returns an isolated RGBA signal to composite using existing raster nodes. |

### Planar simulation recipes

`sim.define` takes `kind`, solver `settings`, and a `clock` with optional
`seed`, fixed `dt` and `maxTicks`. `sim.run` samples that recipe on the graph
clock. Set `options.time` to sample a specific time, `every` for the
checkpoint interval in ticks and `cache` for the count of retained intermediate
checkpoints. Raster coordinates start at the upper left. Positive Y is down.
Cloth and strands also accept Z and a two-axis `projection` offset per Z unit.

| Kind | Main settings |
| --- | --- |
| `particles` | Seeded `emitters` with positions, rates, start/end, size, velocity, spread, lifetime ranges, trails and colors. The particle step applies gravity, damping and obstacle bounce. |
| `cloth` | Native XPBD rectangular grid defined by `at`, `u`, `v`, `columns` and `rows`. Pin an edge or specify indices and keyed pin positions. Set wind, stretch, shear, bend and optional tear ratio. |
| `strand` | Multiple point chains using Ink’s XPBD rope constraints. Roots are pinned by default. Explicit `pins` replace the default attachment set. A pin can be an index or `{index, at}` or `{index, keys}` attaching a vector keyframe track. Set bend, gravity, wind, drag and raster stroke width. |
| `smoke` | Native staggered-grid flow with `emitters` that inject density and velocity over a radius and time range. Controls cover buoyancy, wind, viscosity, diffusion, dissipation and pressure iterations. Density maps to a palette and opacity. |
| `grain` | A falling-cell material solver with seeded emitters, diagonal settling, optional initial rectangular fills and a grain palette. |
| `rigid` | Ink’s native rigid-body mechanics rasterized from an XY camera. Author boxes, fixed colliders, gravity, floor and tick-indexed `impulses`. A body specifies `id`, pixel `at`, pixel `size` and optional `velocity`, `spin`, `mass` and `fixed`. |
| `flip` | Planar free-surface liquid with raster `fill` regions, gravity, particle density, pressure iterations and optional baffles. `flip: 0` gathers PIC velocities, `flip: 1` applies FLIP velocity increments, and intermediate values blend the two. |
| `feedback` | The equivalent recipe for `anim.feedback`, with the input frame array in `settings.frames`. |

Particles, smoke, grain and liquid accept `walls` as
`[x, y, width, height]` rectangles or an aligned raster `mask`. Solid pixels
are selected by `maskChannel` and `maskThreshold` (alpha at least 128 by
default). Cloth and strands accept spherical 3D colliders by `at` and `r`.
Settings are captured in each recipe. Changes to a recipe start a new solve.

Every workflow returns transparent RGBA `value`, a numeric `field`,
`points`, `report` and a portable `checkpoint`. The field reports smoke or
liquid density, grain occupancy, or alpha coverage for the other workflows.
Point records expose positions and available velocities or pin state. The
report records the sampled tick, checkpoint used, and replayed steps. The
liquid report also includes divergence before and after pressure projection.

### Replay from a saved checkpoint

Export `sim.run.checkpoint` as JSON, then connect it to another
`sim.run.checkpoint` input through a `jsonAsset`. With no explicit recipe,
the receiving node reads it from the checkpoint. Rewinding before the
imported tick rebuilds from the recipe origin. A recipe and checkpoint can
also be used with the shared block store in Node.

```js
const ink = require('@shapeshift-labs/ink-studio')
const { rasterSimulation } = ink.load().KIT.procedural
const recipe = rasterSimulation.define('grain', { width: 96, height: 64 }, { seed: 17 })
const first = rasterSimulation.session(recipe)
const { checkpoint } = first.seek(0.75)
const branch = rasterSimulation.session(undefined, { checkpoint })
const frame = branch.seek(1.25)
```

The Tideworks review renders all eight workflows. A second CLI run restores
three checkpoints and verifies that their PNGs match the original graph
byte for byte.

```sh
node examples/raster-simulations.cjs tideworks-review
ink-studio graph run tideworks-review/resume-tideworks.json --out tideworks-review/branch
```

## 3D scenes, signed fields and sprite rigs

These operations run in the CLI graph and the Node library. The geometry,
lighting descriptors, signed-field renderer and sprite tools are also
available as `KIT.procedural.sceneGraph`. The Node splat renderer and pass
adapter are available as `ink.renderGraphScene(world, settings)` and
`ink.graphRenderPass(frame, channel, settings)`. To use these two operations
in a low-level `KIT.procedural.graph.create` graph, pass
`{ operations: ink.graph3DOperations() }`. Graph projects supply them automatically.

### Meshes and image-defined solids

| Operation | Interfaces |
| --- | --- |
| `geo.mesh` | Normalize an indexed triangle mesh from `source`. Accepts Ink’s `pos` and `tri` buffers or `points` and triangular `faces`, with optional vertex colors, face materials, UVs and normals. |
| `geo.box`, `geo.tube` | Build a native closed solid. Boxes use `center` and `half`. Tubes use XYZ `start` and `end` with `radius` and 3–32 `sides`. |
| `geo.triangulate` | Triangulate planar `rings` at `options.z`. The first ring is the outline and subsequent rings are holes. |
| `geo.transform`, `geo.merge` | Apply XYZ `position`, radians `rotation`, and scalar or XYZ `scale`, or combine an array of indexed meshes. Mirroring reverses winding. |
| `geo.clip` | Crop a mesh with face materials to `dot(normal, point) <= offset` for each plane. Set `options.cap` to close a convex shell. UVs and normals remain available on the clipped triangles. |
| `geo.extrudeImage` | Expand an XY raster mask along Z. Set `pixelSize`, `depth`, `center`, `channel`, `alphaThreshold` and optional `edgeColor`. Holes pass through the part. The main mesh retains per-cell colors on the caps. The `front` port is a UV-mapped front cap for `warp.surface`. |
| `geo.sliceStack` | Build the exterior of a stack of aligned raster `slices` in list order. Set world `axis`, `spacing`, `center`, `pixelSize` and mask controls. Neighboring occupied cells share their boundary and omit their internal faces. |

`pixelSize` can be a world step or an XY pair. Raster tops point toward
local +Y, and later slices advance along the selected positive world axis.
XY maps to world XY for a Z stack, to −ZY for an X stack, and to X−Z for a Y
stack. The extrusion and slice operations return bounds and triangle counts
as separate ports. Feed mesh results to other graph operators such as
`meshPaths`, export them as JSON, or add them to a scene.

### Signed fields and render passes

| Operation | Interfaces |
| --- | --- |
| `sdf.shape` | Create a bounded negative-inside sphere, rounded `box`, `torus` or `capsule` with optional XYZ `center` and `rotation`. Torus and capsule axes point along Y before rotation. |
| `sdf.bound`, `sdf.transform`, `sdf.combine` | Bound a scalar field, apply an affine transform with conservative distance scaling, or combine bounded fields by `union`, `intersection` or `subtract`. Subtraction removes later fields from the first. |
| `sdf.mesh`, `sdf.slices` | Polygonize a zero surface with Ink’s native implicit mesher, or sample aligned slices at an optional `level`. Connect both the slices and the `layout` port to `geo.sliceStack` to preserve alignment. |
| `sdf.render` | Raymarch the signed field directly from a camera. Set image dimensions, tint, `shades`, `steps`, `epsilon` and optional shadows. For a custom distance estimate, lower `stepScale` to advance more conservatively. The frame supplies coverage, depth, normals, XYZ positions and IDs. Shaped lights use their centers in this renderer. |
| `scene.camera`, `scene.cameraTrack` | Resolve orbit and lens settings, or sample a native camera rig with its shots, rails, framing and transitions. Projection can be perspective or orthographic. |
| `scene.light` | Author one directional `sun` and local `point`, `rectangle`, `disk` or `line` resources. The CPU scene renderer uses native shadow maps and shaped emitters. Points use compact omnidirectional emitters. |
| `scene.object` | Wrap a mesh with object and material IDs, sampling `resolution`, distance-grid `cells`, optional thickness, color override and emission. |
| `scene.world`, `scene.diorama` | Bake mesh objects into a native splat world, or load an authored diorama definition with graph parameters. Pass camera, lights, palette, look or a native textured surface batch through the world’s options. |
| `scene.render` | Render a native world using optional camera and light overrides. Choose `options.width`, `height` and transparency. Captures a selected array of [art pass names](art-passes.md), including the `environment` shortcut. |
| `scene.pass` | Extract one pass from either renderer. `value` is an RGBA preview. `data` preserves numeric channels. `valid` identifies available depth or position samples, and `report` contains ranges and available ID labels. |

Graph exports require finite JSON numbers. The depth `data` port replaces
empty pixels with `options.emptyDepth` (default `1e9`), and the `valid` port
marks those pixels with zero. Use the renderer’s `frame.passes` in Node to
read the original buffers. To request motion, use a prior
`scene.render` with `captureMotion: true` in its options and connect its
`motionReference` to the next render’s `options.motionFrom`.

### 2D skeletal sprites

Bind a `source` raster with `rig.bindSprite`. Bones use named `id`, optional
`parent`, and absolute rest-space `pivot` and `tip` in top-down pixels.
Use the built-in grid or supply a triangular mesh in the same pixel
coordinates. Supply named `weights` per vertex or use nearest-segment
weights with up to four influences. The bind is editable JSON.

Use `rig.pose` to sample per-bone key arrays on the project clock. Each key
has `time` and optional `angle` (radians, clockwise), `translate` (pixels),
`scale`, and `ease`. Transforms inherit motion from parents.
`rig.skinSprite` deforms the mesh and samples the original sprite through
Ink’s inverse raster warp. It returns the posed image, UV field, deformed
vertices and joint positions. Set the crop and filter in its options.
The native warp resolves overlapping triangles in index order.

The Relay Foundry example uses two kinds of mesh extraction in one lit
scene, shows the direct signed-field render, exports render passes and
animates an independently skinned sprite.

```sh
node examples/graph-3d-rig.cjs graph-3d-review
ink-studio graph run graph-3d-review/relay-foundry.json --at 1.13 --out graph-3d-review/graph
```

## Geometry and attributes

`geometry.meshPaths(mesh, { sources, edgeCost, maxCost })` supports native and imported indexed meshes. It returns per-vertex distances and predecessors, plus `path(vertex)`, `curves(vertices)` and a sampled `distanceAt(point)` field. The cost function receives positions, vertex IDs, length and adjacent faces. Return infinity to block an edge.

`attributes.mesh(mesh, { vertex, face })` builds a nearest-surface sampler. Use `{ type: 'number' | 'vec2' | 'vec3' | 'label', values }` per channel. Numeric values interpolate across triangles. Labels and stable IDs are assigned from the dominant vertex or authored face. `attributes.sdf(field, callback)` projects a point onto a signed field. `attributes.carrier(carrier, callback)` samples a named surface chart. Use `attributes.transfer(sampler, domain, entities)` for points, faces, vertices, curve control points or instances. Use `attributes.paths` to retain curve IDs and per-control-point attributes, `attributes.nearest` to sample another captured table, and `attributes.splats(world, sampler)` to generate a table indexed by splat slot.

## Materials, artwork and animation signals

`graph.material({ height, wetness, ink, palette })` returns coordinated sample functions for height, normal, wetness, ink and palette roles. Connect individual outputs to masks, finishes or layered materials. `graph.tiles({ bounds, cell, mask, vector, scale, seed })` uses stable tile IDs and per-tile sampling to vary density, alignment and size.

`graph.raster({ width, height, layers, tags, fps })` takes named layers with RGBA frame arrays. Tags define half-open frame ranges, loop behavior and rate. Use `layer(name, time, tag)` for one image, or `composite(time, { tag, layers })` to composite selected layers in order. The payload is independent of the tool used to paint the source frames. In Node, `studio.readRasterAsset(file)` also accepts the same manifest with relative PNG paths as frame entries.

`KIT.anim.stateGraph.create(spec).instantiate()` runs keyframed states. Declare named inputs and triggers, timeline keys and optional cues per state, and ordered transition rules. A rule can check a trigger, minimum state age and input comparisons, with an optional blend. Advance on a monotonically increasing clock, calling `trigger(name)` and `advance(time, inputChanges)`. A returned sample includes the active state, mixed channels, cues and the transition taken. The host can bind those channels and cues to any effect or scene property.

Try `ink-studio sheet examples/graph-study.js --from 0 --to 2.6 --n 4 --ortho` for a layered signal animation that drives a cached growth effect across field-aligned tiles.

## Incremental authoring context

`ctx.collection` can match exact scalar values in `parameters` alongside
type and relationship filters. For a fact computed from multiple records,
`ctx.watch(select)` tracks a pure selector against the immutable document
view. Descriptors and rules rerun when the result changes by `Object.is`.
Use a scalar or stable immutable reference for the result. Spatial queries
made by a rule retain their type, tag and exclusion filters when deciding
whether a change affects it.

## Flooded Shrine

`procedural.floodedShrine.create({ seed, controls, snapshot })` owns a retained authoring document with an entrance, a hero silhouette and generated parts. Use `pin`, `setControls` and `regenerate` to steer the layout. Work with generated parts via the document's ordinary update, suppress, promote and undo APIs. The waterline, age, vegetation and path clearance can change while pinned anchors and authored overrides persist.

```sh
ink-studio render examples/flooded-shrine.js --ortho --params '{"waterline":0.3,"age":0.65,"vegetation":0.8,"clearance":1.3}'
ink-studio variants examples/flooded-shrine.js --seeds 6,19,27,30,47,71 --group openness --motion
```

The variant sheet is sorted by silhouette, openness or wear. The JSON sidecar includes art-resolution crisp and lint measures, and short-orbit shimmer when `--motion` is supplied. Existing snapshots can be used with `--authoring file.json`.

## GLB cutouts and UV surface stamps

`await studio.readAsset(file, {size: 3})` reads a portable GLB asset on Node, with the bundled PNG decoder. Supply `decodeImage` for embedded JPEGs. Embedded images retain RGB and optional alpha up to 128 pixels per edge, within the existing 16,384-texel budget.

The texture sampler exposes `opacityAt(face, u, v)` and `opacityAtPoint(face, x, y, z)`. Material samples also include `opacity`. glTF `OPAQUE` ignores alpha, `MASK` applies `alphaCutoff`, and `BLEND` multiplies texture, base-color factor and vertex alpha. Older RGB recipes remain opaque. Thumbnails composite visible layers in depth order.

`KIT.authoring.assetSurfaces.splat(builder, asset, options)` emits planar surface stamps carrying a UV shader. Atlas color, normal, roughness, emission and coverage are sampled at each art pixel. Texture detail therefore survives coarse splat spacing. The stamps retain underlying geometry behind cutouts and can be added to an existing scene.

`assetSurfaces.world(asset, options)` wraps the same path in a standalone world. Options include `size`, `at`, `turn`, `up`, `res`, `maxSplats`, `light`, `ambient`, `palette`, `hues`, `shades` and `cam`. Splats use the renderer's usual translucent blending. Save the portable asset or scene factory to preserve UV shaders, whose functions cannot be retained in a plain JSON world dump.

`assetSurfaces.field(asset, {size, cells, thick, alphaCutoff})` excludes invisible triangle patches before distance-field conversion. Visibility is sampled at twice the atlas texel density, with bounded triangle work. Fractional opacity is classified at the supplied cutoff (default 0.5). The result is a geometric signed field, so its resolution and shell thickness determine the smallest retained opening. Supply `thick` when converting open clothing or overlay surfaces.

The headless CLI automatically uses UV stamps for GLBs that fit the portable asset budgets. Use `--uv` to require that path and report unsupported imports, or `--uv off` to select the existing geometry importer.

```sh
ink-studio render character.glb --uv --res .06 --ortho --out character.png
```

### Textured SDF reconstruction

Pass `geometry: 'sdf'` to `assetSurfaces.world` or `assetSurfaces.splat` for the complete mesh → alpha-aware SDF → reconstructed surface → UV/material transfer → splat pipeline. The default remains `geometry: 'mesh'`.

The alpha field retains the original face that owns each visible patch. The reconstructed splats use that ownership to sample the original atlas at each rendered pixel, while their positions and normals come from the reconstructed surface. This preserves the source color, alpha, roughness, normal and emission channels through remeshing. Small cutouts and closely spaced layers remain limited by field resolution and shell thickness.

```js
const surfaces = studio.load().KIT.authoring.assetSurfaces;
const asset = await studio.readAsset('character.glb', {size: 3});
const world = surfaces.world(asset, {
  geometry: 'sdf', size: 6, cells: 112, thick: .065, res: .045
});
```

`cells` controls field resolution, `resolution` optionally controls reconstruction spacing, and `res` controls splat spacing. `world.sdf` records field dimensions, spacing, source triangle count and reconstructed triangle count for inspection. An optional `field` can supply a modified asset field, retaining its `sourceFace` lookup. This supports SDF carving before textured splat baking. A plain distance grid without source-face ownership needs that attribution restored before UV transfer.

```sh
ink-studio render character.glb --uv --geometry sdf --cells 112 --thick .065 --res .045 --ortho --out character-sdf.png
```


### Background transaction resolution

After collecting a draft with `document.begin(label)`, a caller can use
`await document.scheduleCommit(resolveDraft)` to resolve it in a worker.
The callback receives a frozen draft and returns the complete resolved document
snapshot. Configure the worker with the same generation rules and commit hooks
as the owning document. The result records one undo step and one autosave
revision. The document exposes the draft for rendering during resolution.

A new write, undo, or explicit commit settles the pending transaction using
the local hooks. Cancellation discards the draft, and late replies are ignored.
A failed resolver falls back to local hooks and ordinary rollback behavior.

### Immutable document patches

Use `A.data.documentView(snapshot)` to validate and freeze a worker's initial
snapshot. `A.data.patchDocumentView(view, {metadata, upserts, removed})` applies
later revisions to that view. `metadata` replaces supplied top-level JSON
values, `upserts` maps entity IDs to complete records, and `removed` lists
entity IDs to delete. The result validates references across the change and
shares unchanged entity and style records with the previous view. This lets
workers retain compiled geometry and material caches between messages.
