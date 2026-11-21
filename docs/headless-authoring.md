# Headless procedural authoring

These APIs are available through `KIT.procedural` in Node and the browser bundle. Graph specifications are JSON data. Register executable operations in host code and share their typed inputs and outputs with the specification.

For image review and export, pass the finished world to Node's CPU `render()`. For interactive review, pass the world and authoring toolkit to the [WebGL canvas renderer](browser-renderer.md).

## Start from an editable recipe

The [starter recipes](../examples/starter-recipes/README.md) ship five small
projects for a relightable sprite, an audio-driven sign, a weathered tile
set, a looping spell, and a layered 3D vista. Copy a recipe folder, run
its graph, and edit its named inputs or nodes. Each recipe includes a
take clock and can be archived with the existing project bundler.

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

The `groups` map registers each named group as an operation. A group can be
inline or use a [shared group file](#reference-a-shared-group). Each instance
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

### Reference a shared group

Put a reusable graph in its own file. Its `inputs` declare named sockets and
their types and defaults. Its `outputs` declare the named result sockets.
`version` identifies the file format. `revision` identifies the authored
group revision and defaults to 1 when omitted.

```json
{
  "format": "ink-studio/graph-group",
  "version": 1,
  "revision": 3,
  "inputs": { "level": { "type": "number", "default": 2 } },
  "nodes": {
    "scaled": { "op": "multiply", "inputs": { "a": { "input": "level" }, "b": 5 } }
  },
  "outputs": { "brightness": { "node": "scaled" } }
}
```

Register the file under a local operation name in the graph project.

```json
{
  "format": "ink-studio/graph-project",
  "version": 1,
  "groups": { "Gain": { "file": "../shared/gain.json", "revision": 3 } },
  "nodes": { "lamp": { "op": "Gain", "inputs": { "level": 3 } } },
  "outputs": { "brightness": { "node": "lamp", "port": "brightness" } }
}
```

Use a path string or `{ "file": "../shared/gain.json" }` to follow the file
on each project load. Set `revision` to require that exact authored revision.
Add `sha256` to require the exact file bytes. A mismatch identifies the
group and the expected and actual values. Existing projects and sessions
keep their loaded snapshot until reopened.

A group can declare its own `groups` map to use private dependencies and
travel between projects. Resolve each path relative to the file that declares
it. A group that omits the map can call siblings in its registering scope,
including existing project-level siblings. A group with its own map looks up
group names there. Pin nested references individually when you need to fix
their revisions or bytes.

```sh
ink-studio graph dependencies shots/market.json
ink-studio graph impact shared/gain.json --root .
```

`graph dependencies` lists direct and nested aliases, files, revisions,
SHA-256 hashes and pins. `graph plan` includes the same list and the named
group sockets. `graph impact` scans graph project JSON files under the chosen
directory and reports which projects use the group directly or through a
dependency. For a new revision, `updates` follows the live file and
`requires-reference-update` has a revision or byte pin to update.
`declared-only` identifies an unused reference. The report also includes
existing pin mismatches and projects whose references could not be read.
The scan skips hidden directories, `node_modules`, and embedded groups inside
packed takes. Use the report's hash to set a byte pin.

In Node, use `readGraphProject(file).dependencies()` and
`findGraphGroupUsers(file, { root })`. [Packing a take](project-bundles.md#bundle-a-whole-take)
keeps the exact group files, including nested references.

### Explain changes between graphs

```sh
ink-studio graph diff previous/project.json next/project.json
```

The report compares nodes by ID and follows changes to their input bindings,
output ports, named parameters, and keyframes. It includes asset hashes,
nested group edits, and changes to named outputs. Each affected output lists
JSON Pointer paths back to the changes that can reach it. A change inside
a group follows the affected group output, so an unrelated port can remain
outside the report.

To compare an in-place edit, save the old graph's bindings and asset hashes
before changing its files. A snapshot can also capture input overrides and
a specific seed or sample time.

```sh
ink-studio graph snapshot project.json --seed 11 > before.json
# Edit the project, source image, or a referenced group, then compare.
ink-studio graph snapshot project.json --seed 12 --inputs new-look.json > after.json
ink-studio graph diff before.json after.json --json
```

Both sides of `graph diff` can be graph projects, packed takes with graphs,
or saved snapshots. In Node, use `diffGraphs(before, after)` with projects
from `readGraphProject` or snapshots from `project.snapshot({ inputs, seed, time })`.

The report traces potential changes through the compiled graph without
rendering. A seed change follows operations that consume the graph seed.
Camera and palette edits follow the ports that use them. An asset reader
whose filename is chosen at runtime can depend on any changed asset.
For a built-in or host operation, its inputs can affect each of its outputs.
A host operation can declare `seed: false` when it ignores the seed.

### Discover registered nodes

```sh
ink-studio graph nodes
ink-studio graph nodes --json
ink-studio graph describe raster.resize
ink-studio graph describe array.map --json
ink-studio graph describe raster.resize --example > resize.json
ink-studio graph run resize.json
```

The catalog lists the same toolkit, headless, and configured host
operations that the runner resolves. `graph describe` reports named
inputs and outputs, required inputs, defaults, units, constraints, and
a runnable example. Its versioned JSON records also include the clock
dependency and operation origin. A null unit means the port has no named
unit in the registry or catalog. Structured properties document common
settings inside the `options` records, and each operation enforces its
full settings rules when evaluated.

Dynamic nodes show a representative signature resolved by the compiler.
For example, an `array.map` group supplies the item type, result type,
and any extra inputs. The description identifies which field controls
specialization. Catalog discovery plans the example as needed and leaves
operation execution and instantiation to the runner.

`--example` prints the versioned project by itself. Asset examples point
to the small fixtures shipped with Ink. Operations that require JavaScript
handles, such as `materialSample`, print a runnable Node script instead.

```sh
ink-studio graph describe materialSample --example > sample-material.cjs
node sample-material.cjs
```

Use `ink.listGraphNodes({ operations })` and
`ink.describeGraphNode(op, { operations })` for the same JSON structures
in Node. A custom operation in `graphOperations` can attach a
`description`, `constraints` (an array of strings), and an `example` with
`{ kind: 'graph', project }` or `{ kind: 'node', source }`. A socket
definition can also include a `unit`, a `description`, a `constraints`
object, or named `properties`. These fields document the host operation's
own validation. A host operation without an example still shows its
declared ports.

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

### Resume a batch and stream progress

```sh
ink-studio graph batch project.json cases.json --out review --resume --progress ndjson
```

Use the same command to start a resumable batch or continue it. Each case
evaluates independently. After publishing its artifacts and report, the
runner saves a receipt under `cases/<id>/receipt.json` with the case key
and report SHA-256. Resume verifies the report and each artifact's size and
SHA-256 before reusing a successful case. It retries unfinished cases,
assertion failures, and execution errors. Damaged or missing artifacts are
rebuilt or restored from a matching artifact cache entry.

Case keys cover the compiled graph, assets, operation and runner versions,
and the case's resolved inputs, time, and seed. Changing a case reruns that
case. A new graph, asset, or runner revision can invalidate earlier
receipts. Give a host operation a new `cacheVersion` when its external
dependencies change. A resumable batch can also use `--cache` for completed
case artifacts. Failed cases still evaluate again on resume.

`--progress ndjson` writes `batch-started`, `case-started`,
`case-finished`, and `batch-finished` records to standard output. Each
record carries an attempt ID and a sequence number. Case results report
`completed`, `reused`, `failed`, or `error`, with artifact hashes when
available. The final record includes the aggregate report and exit code.
With `--out`, the same records are appended to `progress.ndjson`, even
when standard output carries only the final report.

You can start with `--progress ndjson --out review` and add `--resume`
on the next invocation. A resumable batch allows one live writer per
output directory. Its aggregate `report.json` is published when that
attempt finishes. Case-level execution errors leave other cases runnable
and return exit code 1. Assertion-only failures return exit code 2.

Use [graph clips](graph-clips.md) to export a named raster or scene output at
an exact frame rate with warm-up and cuts.

See [connecting procedural rasters](render-graph.md#connect-procedural-rasters)
for binding graph outputs to the renderer and reading image, mask, and native
scene passes back into procedural nodes.

### Reuse artifacts across CLI processes

```sh
ink-studio graph run project.json --cache .ink-cache --out review-a
ink-studio graph run project.json --cache .ink-cache --out review-b
```

Pass the same `--cache` directory to reuse a completed `run`, `inspect`,
`batch`, or `clip` invocation. Each entry holds its report and encoded
artifacts. A hit publishes those artifacts into the requested output
directory and preserves assertion results and exit status. A cached clip
replays the whole sequence, including its warm-up and cuts.

The SHA-256 request key covers the graph and group definitions, source
asset hashes, input overrides, seed, time, command settings, and operation
implementations. Built-in operations and encoders use the loaded toolkit
and runner build fingerprints. Custom operations opt in with a
`cacheVersion` string or positive integer on their registration. Use it
for deterministic operations whose inputs account for everything they read,
and bump it when their implementation or dependencies change. Projects
using unversioned custom operations, hosted codecs, or a custom toolkit
build execute normally and report a cache bypass.

The directory owns an `ink-graph-artifacts-v1` subdirectory, with a default
budget of 256 MiB and 128 entries. Override the limits with
`--cache-bytes N` and `--cache-entries N`. The cache evicts least recently
used entries, publishes complete entries atomically, and verifies checksums
before replay. Results larger than the configured byte budget or the
256 MiB per-entry limit are still exported normally.

The report adds `artifactCache.status` (`hit`, `miss`, or `bypass`).
On a hit, the `cache` counters describe the original graph evaluation.
Persistent sessions continue to serve their own in-process evaluator cache.

### Schedule independent raster branches

```sh
ink-studio graph run project.json --workers 2 --out review
ink-studio graph run project.json --workers 1 --out serial-review
```

`--workers` is available for `run`, `inspect`, `batch`, `clip`, and
`session`. Choose 1–8. A count of 1 measures the serial baseline. Workers
start when a ready set contains at least two eligible uncached blur jobs.
The current kernels are `fx.pathBlur` and `fx.kernelBlur`. Their work
threshold is 12 million estimated sample taps on a cold pool and 5 million
on a warm pool. Jobs with inputs above the 16 MiB payload budget run locally.

The coordinator keeps the graph's inputs and cached values. Workers receive
copies of their inputs and transfer back the buffers they produce. Named
outputs, artifacts, and batch cases retain their declared order. Host
operations and stateful nodes run in the coordinator in dependency order.
An unavailable worker falls back to serial execution of the affected pure
block. Reusable groups can use the same pool.

The report's `workers` record counts jobs, peak concurrency, estimated
input payload bytes, transferred output buffer bytes, and fallbacks.
`postMs` measures the coordinator's message submission time.
`waitMs` measures time blocked while collecting results.
`computeMs` sums kernel time across workers. A clip reports totals across
its frames. Node callers can pass `createGraphWorkers(2)` as the project's
`workerPool` and close the pool when finished.

Run `node scripts/benchmark-graph-workers.js` after building to compare
cold and warm wall times on two independent branches. The benchmark checks
serial and parallel output hashes and measures raster round trips from
256 KiB through 16 MiB with both output-copy and output-transfer paths.

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

### Convert coordinates, time and colour explicitly

`graph validate` and `graph plan` identify incompatible typed links by
source and destination port and suggest a conversion when one is available.
The named types describe ordinary arrays, numbers and raster records.
Legacy `vec2`, `vec3`, `number`, and `raster` sockets can still carry these
values. Declare semantic types on graph inputs and group ports to keep the
unit checks across the graph. Raw literals use the destination's type.

| From and to | Graph operations |
| --- | --- |
| `pixels` and `uv` | `coord.pixelToUV`, `coord.uvToPixel` |
| `worldPosition` and projected `pixels` | `coord.project`, `coord.unproject` |
| `seconds` and `frames` | `time.toFrames`, `time.toSeconds` |
| Display RGB(A) byte levels and normalized sRGB | `color.fromRGB8`, `color.toRGB8` |
| Normalized display sRGB and linear sRGB | `color.toLinear`, `color.toDisplay` |
| RGB or RGBA rasters | `color.rasterToLinear`, `color.rasterToDisplay` |

Pixel and UV coordinates start at the top-left edge. The first pixel
center is `[0.5, 0.5]`. Divide by the viewport's full width and height
to obtain UV. Values can extend beyond the viewport for offscreen work.
`coord.project` returns the pixel point, UV, axial camera depth, and a
`visible` flag for viewport and clip-plane coverage. Unprojection
requires axial camera depth, measured along the forward axis.

Use `coord.renderGrid` on the `report` output of `scene.render` or
`sdf.render` to use the actual camera and native art grid. This includes
orthographic setback and any view offset captured by the renderer.
Use `coord.cameraGrid` for a standalone authored camera and viewport.

Give the time nodes an explicit frame rate. They accept a number or an
integer ratio such as `{"numerator":30000,"denominator":1001}`. Frames
are signed integer indices. Seconds-to-frames uses `floor` by default
and accepts `ceil`, `nearest` with ties toward +∞, and `exact` to reject
times between frames.

The colour nodes preserve straight alpha. For a linear raster, RGB
uses floating-point linear sRGB and alpha uses `[0,1]`. Convert it to
display RGB before PNG or clip export. Encoding clamps out-of-range RGB
by default and supports `outOfRange: "error"` to diagnose clipping.

Use `ink-studio graph describe coord.project` for a runnable example or
`KIT.procedural.conversions` for the same operations in the library.

### Legacy and shared port shapes

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

### Tracked drawing anchors

Connect `fx.regionObservations` to `draw.trackedAnchors.observations`
to attach screen-space drawing commands to persistent region IDs.
`fx.regionObservations` takes the same raster frames and segmentation
settings as [region tracking](#track-regions-across-frames), with
`options.fps` set to the source rate. Custom trackers can supply
`{time, regions: [{id, center: [x,y], bounds, confidence}]}` records at
increasing times in seconds. Bounds and confidence are optional. Omitted
confidence is treated as 1.

Each entry in `bindings` has its own `id`, a `track` ID, and local
`commands` and/or `masks` arrays. Draw around the local origin. The
anchor uses the tracked center, or a normalized `boundsAnchor: [u,v]`
within the region's pixel bounds. Add an `offset: [x,y]` in pixels as needed.

| Setting | Effect |
| --- | --- |
| `smoothing` | Position smoothing half-life in seconds. Set to zero for unsmoothed positions. |
| `lag` | Delay the anchor in seconds. |
| `hold` | Keep the last position for this many seconds after the first missed observation. |
| `minConfidence` | Treat observations below this threshold as missing. |

All four settings default to zero. Adjacent visible positions interpolate
between observations. During a gap the position holds still until expiry.
A track returning after expiry starts at its measured position.

Feed the node's `value` to `draw.render.commands`. Render `masks`
separately and pass the resulting raster as a layer's alpha mask in
`raster.stack`. The `anchors` output reports each binding's position,
last observation time and confidence, and its `tracked`, `held`, or
`hidden` status. Sampling uses the graph clock or `options.time`.
For direct use, call `drawing2d.trackedAnchors(observations, bindings).sample(time)`.

[Browser demo](../examples/tracked-drawing-anchors.cjs)

```sh
node examples/tracked-drawing-anchors.cjs tracked-drawing-anchors.html
```

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

Most of these graph nodes take a typed `source` raster. The library exposes the
same operations under `ink.load().KIT.procedural.pixelEffects`. Colour
effects return straight-alpha RGBA8 at the source dimensions. Tile remaps,
scanline remaps, and block substitution preserve the source channel count
and sample values. Bitplane effects also expose the edited palette indices. Add
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
| `fx.tvStatic` | Blend [seekable TV static](#broadcast-patterns-and-tv-static) into the source RGB. Keeps the source's dimensions, pivot, and alpha. |
| `fx.tileScramble` | Copy, omit, or swap whole tiles on a fixed grid. Set `tileSize`, `mode`, `amount`, `seed`, `rate`, and an optional `mask`. The `addresses` output shows where each destination tile reads from. |
| `fx.tileBleed` | Replace selected whole tiles with tiles from a separate `bank` raster. Set `tileSize`, `amount`, `seed`, `rate`, and optional `mask` and `bankMask`. The `addresses` output identifies donor tiles. |
| `fx.tileStrideSlip` | Read successive tile rows using an authored `stride`, `offset`, and `wrapAt`. The `addresses` output shows where each whole tile reads from. |
| `fx.scanlineRemap` | Repeat, skip, or blank whole rows with `options.edits`. The `addresses` output shows the source row for each destination row. |
| `fx.rasterSchedule` | [Write indexed palette slots, source offsets, and pixel sizes](#schedule-raster-register-writes) on authored output rows. |
| `fx.signalRecovery` | [Hold the last usable raster after a fault and relock](#recover-from-signal-loss). Outputs the raster, receiver status, and stage transition events. |
| `fx.blockSubstitute` | Replace rectangles with samples from the original `source` or the named rasters in `banks`. The `mask` output marks copied pixels. |
| `fx.bitplane` | Flip a bit, clear a bit, or borrow a bit from an aligned `bank` of palette indices. Connect a one-channel `source` and its ordered `palette`. Outputs RGBA `value` and edited `indices`. |
| `fx.paletteFault` | Swap pairs of palette slots, or force selected slots to a fixed one. Use `options.mask` to localize edits. Outputs RGBA `value` and edited `indices`. |
| `fx.trackRegions` | Track connected regions across a sequence of `frames`. Outputs persistent region records, ID `labels`, lineage `events`, source `frame`, and source `time`. |

Both blurs filter premultiplied colour and alpha with `edge` set to
`clamp`, `transparent`, or `wrap`. Kernel blur defaults to clamped edges.
Path blur defaults to transparent edges.

For kernel and path blur, set `options.tileSize` to a tile width or
`[width, height]` from 1 to 1024 pixels per axis. Rasters above 1,048,576
pixels use 256 × 256 tiles by default. Use `false` for a whole-raster
comparison within the original blur limits. Each tile reads the overlap
needed by the filter, using the same image-wide edge rules. Very wide,
sparse paths read only their sampled pixels. Atlas packing copies each
sprite and registered map into its destination plane without creating
full-size RGBA copies of the sources.

```sh
ink-studio graph plan project.json --memory
```

The memory report estimates raster backing buffers for one cold serial
evaluation, including source rasters, retained results, and filter scratch.
Each blur lists its tile count, four overlap widths, and working bytes.
PNG inputs are inspected without inflating their pixels. For an atlas with
`trim: true`, the report uses the configured atlas limits and marks the result
as an upper bound. When a node's memory or dimensions cannot be modeled,
`peakBytes` is null and `unresolved` identifies the node. `knownPeakBytes`
reports the modeled allocations. The estimate excludes JavaScript object
overhead, worker transfers, and export encoding. Native scene rendering
reports its known image allocations and marks its other costs unresolved.
Library callers can request `project.plan(inputs, {memory: true})` or use
`pixelEffects.planKernelBlur`, `pixelEffects.planPathBlur`, and `raster.planPack`
to size individual operations.

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

### Repeat, skip, and blank scanlines

```js
const { value, addresses } = KIT.procedural.pixelEffects.scanlineRemap(feed, {
  edits: [
    { mode: 'skip', start: 10, count: 2 },
    { mode: 'repeat', start: 24, count: 4, source: 23 },
    { mode: 'blank', start: 40 }
  ]
});
```

Each edit uses zero-based rows from the top of the raster. The default
`count` is one. Skip ranges remove source rows and compact what remains
upward. Any unfilled rows at the bottom are blank. Repeat and blank
then override destination rows in the listed order. Repeat reads a
single original source row, defaulting to the row above `start` or the
first row when starting at zero. Blank rows are all zeros. Ranges clip
at the frame edge, and a repeat from beyond the source produces a blank.

`value` preserves dimensions, pivot, channels, and copied pixel
samples. `addresses` is a one-channel raster, one sample wide, with
`-1` for a blank row. In graphs, pass edits through the
`fx.scanlineRemap` node's `options` input. Use
[render graph row edits](render-graph.md#repeat-skip-and-blank-rows)
to apply the same operations to a live scene.
The [scanline study](../examples/scanline-repeat-dropout.cjs) compares
each mode side by side.

### Schedule raster register writes

Use `fx.rasterSchedule` or `KIT.procedural.pixelEffects.rasterSchedule(source, options)`
to run the same [Copper-style schedules](render-graph.md#copper-style-raster-schedules)
on a standalone raster. Pass `options.schedule` with increasing output
rows. The input is a display raster unless `options.palette` supplies
RGB or RGBA swatches for an indexed raster. An optional second index
channel carries byte alpha. `options.width` and `options.height` set the
output grid and default to the input dimensions.

The graph supplies the clock unless `options.time` overrides it. In
JavaScript, a schedule callback can use that time and the output
dimensions to place register writes. The result is straight RGBA.

### Recover from signal loss

Use `fx.signalRecovery` to make a feed's response to dropout observable
and reusable. Connect a display raster to `source`, and report a missing
carrier with `available: false` or a null source. Feed a signal measure
from zero to one through `quality` when the carrier is present but
unreliable. An input below `loseBelow` counts toward loss. After a full
dropout, the stronger `lockAbove` threshold governs reacquisition.

| Stage | Receiver output |
| --- | --- |
| `locked` | The current usable raster. It replaces the saved image. |
| `losing` | The last usable image during the grace period before `lossFrames` misses. A usable observation can restore the lock immediately. |
| `holding` | The saved image while the carrier is absent, weak, or a relock attempt has failed. |
| `relocking` | The same saved image during `lockFrames` consecutive qualifying observations. After confirmation the output blends to the current feed over `blendSeconds`. Set that duration to zero for a hard switch. |

Set `options.trackId` and connect `fx.trackRegions.value` to `tracks`
to use a specific region as the lock target. Its confidence caps the
input quality. A missing ID makes the feed unavailable to the receiver,
even while other regions remain visible. Set the tracker's `maxMissed`
for the expected gap so the same ID can come back. The tracking and
recovery state remain independent.

```js
const receiver = KIT.procedural.signalRecovery.create({
  loseBelow: .4, lockAbove: .65, lossFrames: 2, lockFrames: 3, blendSeconds: .2
});
const { value, status, events } = receiver.sample(sourceOrNull, time, { available, quality, fallback });
```

A strong first observation starts locked. Without a saved image, the
receiver uses `fallback` if provided, transparent pixels on a known
grid, or null when it has no grid. A fallback must match the source
dimensions. An interrupted relock discards its progress and returns to
the saved image.

`status` reports the stage and when it began, consecutive miss and
confirmation counts, effective quality and availability, the retained
frame's `lastUsableTime`, and the live image's `mix` from zero to one.
On a stage change `events` contains the new stage as `type`, the
previous stage in `from`, and `time`. Use these to drive effects such
as scanline slips on loss or an authored cue on lock.

Repeated timestamps return the same observation without increasing
counts. A rewind, grid change, explicit `reset`, or `receiver.clear()`
starts fresh. Graph cuts also restart recovery. For a clip that begins
mid-outage, use graph clip warm-up to capture the last usable image.

Run `node examples/signal-recovery.cjs carrier-return.html` for a browser
demo of a hard dropout and a moving track that disappears and returns.

### Substitute blocks from a frame or feed

```js
const { value, mask } = KIT.procedural.pixelEffects.blockSubstitute(current, {
  banks: { replay: earlierFrame, alternate: otherFeed },
  blocks: [
    { rect: [24, 8, 20, 12], from: [4, 8] },
    { rect: [50, 30, 32, 16], bank: 'replay' },
    { rect: [84, 13, 15, 22], from: [0, 4], bank: 'alternate' }
  ]
});
```

Each `rect: [x, y, width, height]` is in destination pixels from the top
left. `from: [x, y]` is the source rectangle's top-left corner and defaults
to the destination origin. The source rectangle uses the same size.
Omit `bank` to read from the original input raster. Banks can have
different dimensions and must share the input's channel count.
The operation copies whole samples, including alpha, at integer coordinates.

Source and destination rectangles clip together at their image bounds.
Overlapping blocks apply in order and read from the original inputs.
An optional aligned `options.mask` restricts writes, using
`maskChannel` (default `"luma"`) and `maskThreshold` (default 128).
`value` preserves the input dimensions and pivot. The output `mask`
is 255 wherever a pixel was copied and zero elsewhere.

In a graph, link a `data.record` of named rasters to `banks` and put
rectangles in `options.blocks`. To get earlier frames, read the same
sequence with two `anim.frame` nodes and give the bank node a positive
`delay`. This makes the result seekable and keeps playback and export in
sync. In a live host, pass captured rasters such as camera atlas reads to
the same function, then send its result to a
[mixed-resolution layer](mixed-resolution.md#rasters-and-screen-effects).
The [block substitution study](../examples/block-substitution.cjs) shows
a neighboring rectangle, a delayed frame, and an alternate feed.

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

### Apply a local palette fault

```js
const { value, indices } = KIT.procedural.pixelEffects.paletteFault(spriteIndices, palette, {
  swaps: [[0, 3]],
  stuck: { from: [1, 2], to: 0 },
  mask: damagedArea
});
```

Each pair in `swaps` exchanges the two original slot numbers. A `stuck`
rule maps every listed `from` slot to `to`. Omit `from` to pin every
slot under the mask to the same color. Source slots can appear in only
one rule. Rules read the original index, so a stuck rule can land on a
swapped slot without triggering the swap.

Use the same one-channel indices, palette order, aligned `mask`,
`maskChannel`, `maskThreshold`, and optional byte `alpha` raster as for a
bitplane. Without a mask, the rules apply across the whole raster.
Unlisted slots and transparent pixels keep their indices. Duplicate
swatch colors retain their separate slot identities.

In a graph, connect `source` and `palette` from `indexedPngAsset` or
`palette.resolve`, and use `data.record` to pass the mask and alpha into
`options`. The [palette fault study](../examples/local-palette-fault.cjs)
compares a regional shade inversion with selected shades stuck on one slot.

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

### Track regions across frames

`pixelEffects.createRegionTracker(options)` creates a tracker for a stream of
same-size rasters. Call `tracker.update(source, timestamp)` with increasing
timestamps in seconds, at least one microsecond apart. Call `tracker.reset()`
when starting a new stream.

The result's `value` array contains visible regions ordered by persistent ID.
Each record contains `id`, `area`, pixel `bounds`, `center` in pixel
coordinates, `velocity` in pixels per second, closed `contours` including
holes, and a `confidence` score from zero to one. The numeric `labels`
raster stores persistent IDs, with zero for the background. A new track
starts with zero velocity and confidence of 0.5. Later scores reflect motion
prediction, area similarity, and bounding-box overlap. Reacquired regions
carry a score penalty for missed observations.

Use the same `channel`, `threshold`, `connectivity`, `minArea`, and
`invert` settings as `raster.components`. Set `maxDistance` (24 pixels by
default) to bound the distance from the predicted center per frame.
`minAreaRatio` (0.3) gates changes in region area. `maxMissed` (2) retains
unseen tracks for that many frames so brief occlusions can preserve identity.
`maxRegions` (32) caps the live pool, giving visible and most recently
observed tracks priority. Each frame has a 500,000-pixel budget and a
500,000-cell budget across the contour searches.

For seekable clips, feed the frame array into `fx.trackRegions` and set
`options.fps` to the source rate. It samples the graph clock, or
`options.time` if supplied, with `hold` playback by default. Backward seeks
replay associations from the start of the sequence, so the same source
frame has the same labels after seeking or looping. The sequence has a
64-million-pixel budget across its frames.

The [browser example](../examples/persistent-region-tracking.cjs) overlays
outlines, motion histories, and velocity arrows on three moving regions.
Scrub across the missing frames to inspect a reacquired region.

```sh
node examples/persistent-region-tracking.cjs region-tracking.html
```

#### Region events

The tracker and graph node return an `events` array for each source frame.
Each event has a `type`, source `time` in seconds, stable IDs in `from` and
`to`, and an area-weighted `center` in pixel coordinates. A disappearance
uses the last observed center. A reappearance also reports `missedFrames`.

| Type | `from` | `to` |
| --- | --- | --- |
| `split` | Parent ID | Descendant IDs |
| `merge` | Parent IDs | Joined region ID |
| `disappear` | ID lost on this frame | Empty |
| `reappear` | Previously missed ID | Reacquired ID |

Split and merge candidates use shared labeled pixels between adjacent
frames, with the option to align the earlier footprint using its measured
velocity. `eventOverlap` is the minimum fraction of the smaller region
that must overlap, from .01 to 1, with a default of .6. A strong branch can
preserve an eligible ID even when the ordinary matching area gate is
exceeded. Topology events take precedence over visibility events for
the regions they describe. `disappear` occurs once, on the first missed
frame. `reappear` requires an ID retained under `maxMissed`. Graph seeks
return the selected frame's events, including when replaying the clip.

The [lineage demo](../examples/region-lineage-events.cjs) draws directly from
the event records. Select an event to inspect its frame and ID changes.

```sh
node examples/region-lineage-events.cjs region-lineage.html
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
| `warp.opticalFlow` | Estimate [dense motion](#dense-optical-flow) between aligned `before` and `after` rasters. Returns signed XY displacement and a separate `confidence` raster. |
| `warp.cameraMotion` | Separate [camera and subject motion](#camera-motion-compensation) from a forward `motion` field, with optional `confidence` and a background `mask`. |
| `warp.flow` | Pull a `source` raster through a backward `motion` field, with optional `confidence`. Returns the result and its inverse UV `field`. |
| `warp.flowPoints` | Advance an `array<vec2>` of `points` through a forward `motion` field, with optional `confidence`. |
| `warp.refract` | Supply a height raster in `map`. Choose its `channel`, `heightScale`, refractive `index`, and ray `depth` in pixels. Local height gradients bend the sampling ray. |
| `warp.morph` | Supply rasters `a` and `b` and a mesh `control` with landmarks for both. `amount` moves the landmarks and blends the aligned images. Use a named parameter or keyframed value to animate it. |

Mesh, grid, polar, displacement, and refraction nodes expose their
`field` alongside the rendered `value`. Reuse the field on another
raster, or export it as JSON. For mesh, grid, polar, and morph set
`options.width` and `height` to change output dimensions. Displacement
and refraction use the map's dimensions.

### Dense optical flow

`rasterWarp.opticalFlow(before, after, options)` estimates motion for
each pixel from image intensity. It uses coarse-to-fine matching and
subpixel refinement based on the [Lucas–Kanade method](https://www.cs.princeton.edu/courses/archive/spring03/cs496/papers/lucas_kanade.pdf)
and [Bouguet's pyramid formulation](https://web.stanford.edu/class/cs231m/references/pyr-lucas-kanade-feature-tracker-bouget.pdf).
The `value` raster has two signed channels in pixels per frame pair.
Positive X points right and positive Y points down. `confidence` is a
0–1 heuristic based on local contrast in both axes and the remaining
intensity difference. Flat patches and motion outside the frame have
low confidence.

The default `direction: "forward"` maps points on the earlier image to
the later one. Use `direction: "backward"` to estimate the reverse field
on the later image. The default `channel: "luma"` weights color by alpha
for alpha-bearing rasters. Use `channel: "alpha"` for silhouette motion.
`sampleRange` defaults to `[0, 255]`. The solver also accepts `levels`,
`radius`, `iterations`, `search` for the coarse correspondence search,
`maxMotion` in pixels, and `regularization`. Frames use matching dimensions
and a 500,000-pixel budget.

Use forward flow with `rasterWarp.flowPoints(points, motion, options)`
or query it at continuous pixel coordinates with
`rasterWarp.flowSampler(motion, options)(x, y)`. Pixel centers are at
`x + 0.5, y + 0.5`. Use backward flow with
`rasterWarp.flow(source, motion, options)` to advect ink or texture
using the same filtering and edge settings as `warp.sample`. Both
accept `scale` and optionally gate movement with `confidence` and
`minConfidence` (0.15 by default). A gated pixel or point holds its
original coordinate.

Pass an array of backward fields to the `anim.feedback` node's `flow`
input to advect retained ink. Entry zero maps feedback tick 1 into tick
0. Supply one field per subsequent simulation tick. At ticks beyond the
array the feedback uses its authored warp alone. `options.flowScale`
scales the displacement. Use the same `flow` and `flowScale` settings
in a standalone raster feedback recipe.

The [browser study](../examples/dense-optical-flow.cjs) shows opposing motion,
ink and particles driven by the measured field, and a comparison of
fixed and flow-driven feedback.

```sh
node examples/dense-optical-flow.cjs optical-flow.html
```

### Camera motion compensation

`rasterWarp.cameraMotion(motion, options)` fits the dominant camera
transform to a forward displacement raster. The default `similarity`
model estimates pan, uniform zoom, and roll. Use `model: "translation"`
for pan alone. The fit uses spatially distributed correspondences and
[random sample consensus](https://www.cs.cmu.edu/~motionplanning/papers/sbp_papers/f/p381-fischler.pdf)
to reject independently moving regions. Pass the optical-flow
`confidence` plane and optionally a single-channel background `mask`
to restrict the fit to pixels you choose.

| Output | Meaning |
| --- | --- |
| `value` | Signed XY motion in pixels per frame pair, expressed in the earlier frame's stabilized axes. Use it with `warp.flowPoints` to move subject-attached effects. |
| `camera` | The signed XY motion attributed to the camera at each earlier-frame pixel. |
| `field` | Normalized UV coordinates for `warp.sample`. Pass the later frame as `source` to stabilize it against the earlier frame. Use `edge: "transparent"` to show uncovered edges. |
| `inliers` | Byte mask of eligible pixels that agree with the camera transform. |
| `transform` | Forward and inverse two-row pixel matrices, center-relative `pan`, uniform `scale`, `rotation` in radians, and fit diagnostics. Apply the forward matrix to a stabilized anchor to draw it in the later frame. |

`threshold` is the pixel error allowed for camera inliers (1.35 by
default). `minConfidence` defaults to .2, and `maskThreshold` defaults
to .5 for masks with samples in 0–255. `minInliers` (6) and
`minInlierRatio` (.55) control fit acceptance. `maxSamples`,
`iterations`, and `seed` tune the bounded, deterministic fit.
When the fit lacks support, `transform.valid` is false, both
transforms are identity, and `value` preserves the input motion.

The [browser example](../examples/camera-motion-compensation.cjs)
compares a panning, zooming raster with its stabilized result and
draws a subject anchor in both coordinate spaces.

```sh
node examples/camera-motion-compensation.cjs camera-motion.html
```

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

For live input, enable `options.history` on [`anim.frameBank`](#selectively-refresh-a-frame-bank)
and connect its `history` output to `warp.timeRemap.history` in place
of the frame array. The oldest retained observation defines zero for
absolute maps. Offset maps still follow the graph clock. With the default
`hold` playback, times beyond the retained window use the nearest endpoint.

Use an aligned one-channel `mask` in byte coverage units. Zero keeps the
clock's time, 255 uses the mapped time, and intermediate values interpolate
between those times before reading the image. A zero in the optional
`valid` plane also keeps the clock's time. Both planes align with the map's
grid, which defines the output size.

- A mask can be the map itself. Set `scale` to the desired delay in seconds
  divided by 255. Use a negative delay for earlier frames.
- Connect native `scene.pass` `depth` through its raw `data` port and connect
  `valid` so empty depth reads the clock's time. Use `scale` and `bias` to convert
  scene depth to seconds.
- Connect a numeric field or use `channel: "magnitude"` to convert a
  two-channel motion field into a delay proportional to its length.
  Choose channel 0 or 1 for signed X or Y. Mask the field with a tracked
  region by comparing the region’s label raster to its ID and multiplying
  the result by 255.

Run `node examples/masked-time-maps.cjs tidal-delay.html` for a browser
demo with mask, depth, field, and tracked motion controls.

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
| `proc.smpteColorBars` | Generate [SMPTE SD or HD color bars](#broadcast-patterns-and-tv-static) as an RGBA8 raster. |
| `proc.tvStatic` | Generate [TV static](#broadcast-patterns-and-tv-static) as a seekable RGBA8 raster. |
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

### Broadcast patterns and TV static

`generator.smpteColorBars({ pattern, width, height, levels, blueOnly })`
creates an RGB rendition of `eg1` (the default) or `rp219`. EG 1 has a
reverse-blue strip and near-black PLUGE steps. RP 219 uses the default
reference patches, a luminance ramp, gray side panels, and five PLUGE
steps. Width defaults to 128 pixels. Height follows the pattern's 4:3 or
16:9 aspect ratio unless supplied. Use `blueOnly: true` to isolate the
blue channel. The default `levels: "full"` clips below-black values at
zero for display. `levels: "limited"` maps reference black and white
to RGB bytes 16 and 235 and preserves the below-black patch. Both modes
return RGB artwork with alpha. The source standards describe video
signal encoding and timing. [SMPTE EG 1](https://pub.smpte.org/pub/eg1/eg0001-1990_stable2004.pdf) · [SMPTE RP 219-1](https://pub.smpte.org/latest/rp219-1/rp0219-1-2014.pdf)

`generator.tvStatic(options)` creates a standalone layer. Use
`pixelEffects.tvStatic(source, options)` to blend it into an existing
raster. Both accept the same appearance controls. The standalone layer
defaults to 128 × 96. The effect takes its dimensions from the source.

| Option | Behavior |
| --- | --- |
| `preset` | `snow` for fine monochrome grain, `chroma` for color noise, `weak-signal` for horizontal streaks, or `tracking` for a rolling band. |
| `time`, `seed`, `rate` | Time in seconds, integer seed, and noise frames per second from 0.01 to 240. Use zero rate to hold a frame. The graph nodes inherit the graph clock and node seed unless overridden. |
| `grain` | Integer noise cell size `[width, height]` in pixels. |
| `contrast`, `chroma`, `rowNoise`, `scanlines` | Grain contrast from 0 to 2, color separation, independent row brightness, and alternating-row dimming. The last three range from 0 to 1. |
| `band` | Override `height` as a fraction of the image, `speed` in screen heights per second, and `strength` from 0 to 1. Negative speed reverses direction. |
| `opacity`, `density` | Set the alpha of active noise cells and the fraction of cells that are active, both from 0 to 1. |

Run the [broadcast patterns demo](../examples/broadcast-patterns.cjs) to
compare the test patterns, play or scrub the static presets, and see
tracking interference applied to a pixel-art feed.

```sh
node examples/broadcast-patterns.cjs broadcast-demo.html
```

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
| `anim.clock` | Map the project clock to `options.range`, with `delay`, `rate`, `reverse`, and a `mode` of `hold`, `loop` or `pingpong`. Add `phase` and `cues` for authored layer clocks. Returns mapped time, progress, playback direction and activity. |
| `anim.stagger` | Sample several clocks with `count`, `options.interval` and `offset`. `reverseOrder` switches which item starts first. Returns mapped times and per-item clock records. |
| `anim.frame` | Select from raster `frames` with `fps` and a half-open interval from `first` to `end` in frame indices. Accepts the same delay, rate, reverse and looping controls. |
| `anim.visualSample` | Replay a [captured visual span](graph-clips.md#capture-a-reusable-visual-span) with independent timing, alpha, raw data, depth and motion. |
| `anim.frameBank` | Retain and selectively refresh raster pixels. Outputs the banked image, refresh mask, capture tick, and optional history for [per-pixel time](#per-pixel-time). |
| `anim.datamosh` | Pull the previous image through signed motion and blend it with the current image. Outputs the image and retained weight. |
| `anim.subjectFeedback` | Retain marks in a [subject’s UV or rest-space chart](motion-afterimages.md#subject-attached-feedback). Outputs the retained texture and deposit mask. |
| `anim.spriteDesync` | Composite a layered raster `source` with independent frame holds or offsets on named parts and pixel rectangles. Returns RGBA `value` and the sampled `frames`. |
| `anim.captureTransforms` | Snapshot the pose channels of a `source` array of instance records with stable IDs. |
| `anim.staleTransforms` | Patch independent pose channels on a `source` array using `edits` and optional named `snapshots`. Returns the edited array and an applied/skipped count. |
| `anim.retime` | Sample a reusable graph named by `group` at the time mapped by its `timing` input. The group retains its inputs and outputs and owns its independent simulation caches. Pass `timing.time` to feed an explicit time, such as an item from `anim.stagger`. |
| `anim.feedback` | Evolve raster `frames` at a fixed simulation `dt`. Set source `fps` and `mode`, signal `halfLife` and `gain`, and optional `threshold`, `warp`, `filter`, and `cuts`. Feed [backward motion](#dense-optical-flow) into `flow` to advect the retained signal. |

### Transport image history with signed motion

Use `anim.datamosh` on a display raster and a two-channel `motion`
raster on the current image grid. The first sample initializes the
history from `source`. Each later sample looks up the displaced pixel
in the previous result and retains its contribution according to the
elapsed time and `options.halfLife`. Output `carry` reports that
contribution as a 0–1 raster.

Connect [captured motion](graph-clips.md#capture-a-reusable-visual-span)
through `anim.visualSample.motion` and `motionValid`, or connect
[backward optical flow](#dense-optical-flow) and its confidence.
Use `options.direction: "backward"` for the latter. Native captured
motion uses `"current-minus-previous"`, the default direction. Both
use pixels per observed frame unless units are explicitly set to
`"pixels/second"`.

The optional aligned `refresh` raster has byte coverage from 0 to 255.
Connect a frame bank's `refreshed` output or a separately authored
mask. Full refresh copies the current pixel, including alpha. Optional
`confidence` (0–1) weights history and `valid` (0–255) excludes
unreliable motion at zero. Use `options.blockSize` to share vectors
across blocks and `filter: "linear"` for interpolated donors.

Advance in observation order, with warm-up for exported clips that
start midway through a shot. A repeated timestamp reuses the stored
result. A backward seek, size change, cut, or explicit `reset`
starts clean. A `null` motion sample also copies the current image.

```js
const datamosh = KIT.procedural.datamosh.create({ halfLife: 0.8 });
const { value, carry } = datamosh.sample(image, motion, time, { valid, refresh });
```

Use the same settings with a [screen pass](render-graph.md#feed-signed-motion)
for CPU or WebGL scene rendering.

### Selectively refresh a frame bank

Use `anim.frameBank` with a live or replayed raster and a record of named,
aligned one-channel `masks` in byte coverage units from 0 to 255.
`options` accepts `fps`, `tiles`, `regions`, and `refresh` with the
[same timing as the render pass](render-graph.md#frame-banks-with-selective-refresh).
Its `refreshed` output records the pixels that refreshed at this
timestamp, including fractional coverage. An explicit `reset` boolean,
a cut, a backward seek, or a source size change reinitializes the bank
from the current image. Advance in source order or use `graph clip` with
warm-up to build history before the first output frame. Each group
instance keeps its own bank.

In JavaScript, retain a session and call `sample` with the source raster
and time in seconds. Pass `{ masks, reset }` as the optional third
argument, or call `clear()` to start a new history.

```js
const bank = KIT.procedural.frameBanks.create({
  fps: 12,
  tiles: { size: [24, 16], every: 8 },
  regions: [{ mask: 'subject', every: 3 }]
});
const { value, refreshed, tick } = bank.sample(source, time, { masks: { subject } });
```

Set `options.history` to a capacity from 1 to 512 to retain observations
of the banked image, including sub-tick mask refreshes. Skipped ticks
leave gaps in the sample times. The capacity multiplied by the number
of pixels per frame may be at most 16 million. Omit `history` or set it
to zero to keep just the current image. History shares the bank’s reset
rules. In JavaScript, pass the returned history and the current clock
time to the remapper.

```js
const bank = KIT.procedural.frameBanks.create({ fps: 12, regions: [{}], history: 24 });
const { history } = bank.sample(source, time);
const image = KIT.procedural.rasterWarp.timeRemap(history, delayMap, {
  time, mask, valid, interpolation: 'linear'
});
```

For an exact tracked ID, compare the labels with `raster.math` and
`op: "equal"`, then multiply the result by 255 to make the coverage mask.
The renderer's `raster.match` mask binding performs both operations in
one pass.

### Author layer clocks

Add timing to an `anim.retime` group instance to drive a distinct render layer,
or use the same settings with `anim.clock`, `anim.frame` or `anim.stagger`.
Each instance reads its own source time. Composite the results in the usual
layer order. Use [motion layer clocks](motion-layers.md#clock-a-layer) to
drive individual pose layers.

```json
{
  "range": [0, 8],
  "mode": "loop",
  "rate": 0.65,
  "phase": 1.3,
  "cues": [
    { "time": 1.6, "rate": 0 },
    { "time": 3.5, "seek": 0, "rate": 1.4 },
    { "time": 5.5, "seek": "parent", "rate": 1 }
  ]
}
```

This clock starts 1.3 source seconds into its range. It holds from 1.6
parent seconds, restarts at 3.5, and follows the parent clock at 5.5.

- `phase` and numeric `seek` are signed seconds measured from the start
  of the source range, before applying loop, clamp, pingpong or reverse.
- Cue `time` is in parent seconds. Times must be unique. A cue applies
  at its timestamp and can set `rate`, `seek`, or both. Rate zero holds
  the current phase. A later rate change resumes from that same phase.
  Before `delay`, cues can change rate or phase while the clock is inactive.
- Set `seek: 0` to restart according to the current direction.
  `seek: "parent"` copies the parent seconds into the phase at the cue.
  Set `rate: 1` with it to keep following the parent. To align multiple
  layers at a specific source offset, give them identical numeric seeks
  and rates at the same parent time. Layers with the same range,
  direction and playback mode then sample the same source time.
- Cue times, phase offsets and numeric seeks accept decimal seconds or
  exact `{ "numerator": n, "denominator": d }` records. A graph layer
  driven directly by a [take frame](take-clock.md) respects exact cue
  comparisons. A nested group receives the mapped local seconds.
- During sequential graph clip export, an authored seek starts a new
  feedback segment for that group. Holds keep sampling the same local
  frame. Checkpoint-backed simulations seek through their usual sampler.

Use `KIT.procedural.animationGraph.compileClock(settings)` in JavaScript.
Call `sample(parentSeconds)` or `forTake(frame)` on the compiled clock.
The phase at any requested time is independent of the order of sampling.
For interactive stage clocks and fixed ticks, see
[shared time domains](shared-time-domains.md).

Run `node examples/layer-clocks.cjs layer-clocks.html` for the
[interactive sprite study](../examples/layer-clocks.cjs).

### Desynchronize sprite fragments

Provide a layered raster with each named part registered on the same pixel
canvas. The graph accepts either the layered raster definition or a compiled
`graph.raster` asset. For a flattened animation, put the frame sequence in one
layer and use rectangular strips.

```js
const { value, frames } = animationGraph.spriteDesync(sprite, {
  time: 0.5,
  tag: 'walk',
  parts: { head: { hold: 2 }, arm: { offset: 4 }, boot: { offset: -3 } },
  strips: [{ rect: [20, 14, 44, 6], offset: -2 }]
})
```

`hold` is a zero-based frame slot within the selected tag. `offset` is a
signed integer in frames and can lead or lag the current clock. Use one per
fragment. Offsets wrap in looping tags and clamp in non-looping tags.
A part or strip can use a `clock` record in place of either field. A
fragment clock accepts `rate`, `phase`, `cues`, `delay`, `reverse`, and
`mode`, and uses the selected tag's frame rate and source range. Its
default mode follows the tag's looping setting.

The node uses the graph clock unless you supply `options.time`. Direct
sampling defaults to time zero, and the default tag is `all`.

Named parts replace their own layer's cel before compositing. Use `layers`
to choose which layers draw and in what order. Strips then copy RGBA,
including transparency, from the synchronized stack at their own sampled
frames. Rectangles use upper-left pixel coordinates `[x, y, width, height]`
and clip to the sprite. Later strips take precedence in overlaps.

`frames.base` and `frames.strips` report absolute clip frame indices.
`frames.parts` reports the cel index drawn for each selected layer. A short
layer holds its last cel. Sampling depends only on the requested time, so a
direct seek and sequential playback produce the same frame.

Run `node examples/sprite-fragment-desync.cjs fragment-review` to render
[the side-by-side sprite study](../examples/sprite-fragment-desync.cjs).

### Hold or duplicate instance transforms

`KIT.procedural.animationGraph.staleTransforms` reads instance records
with unique string `id` values. Each edit selects `position`, `rotation`,
`scale`, or any combination. Use `snapshot` to hold a recorded pose
and `from` to read a different instance. Both can appear in one edit.
Each edit reads the original input or snapshot, so a pair of live copies
can exchange channels.

```js
const A = KIT.procedural.animationGraph;
const held = A.captureTransforms(sampleAt(0.75));
const { value: poses } = A.staleTransforms(sampleAt(time), [
  { id: 'courier', snapshot: 'held', channels: ['position'] },
  { id: 'scanner', from: 'guide', channels: ['rotation', 'scale'] }
], { snapshots: { held } });
```

- A pose uses XYZ `position`, a right-handed row-major 3×3 `rotation`,
  and positive uniform or XYZ `scale`. The defaults are the origin, identity
  rotation and unit scale. Omit `channels` to copy all three.
- Assign each target channel at most once. The default missing-ID policy is
  `"error"`. Use `{ missing: "skip" }` with changing populations to skip
  edits whose target or donor is absent.
- `captureTransforms` copies pose channels into a serializable snapshot.
  For deterministic seeking, capture from an authored time sample or use
  `anim.retime` to sample a fixed time before `anim.captureTransforms`.
  Pass the snapshot through `data.record` to the `snapshots` input.
- Pass the result to `copies.updateTransforms(poses)` for shared baked
  splat instances. This adapter uses uniform scale. Use
  `A.instanceMatrix(pose)` to get the rotation-and-scale matrix for
  `K.frameSplats` or for `sceneGraph.setLocal(pose.id, { position, matrix })`
  when driving repeated geometry.
- For native particles, supply `renderTransforms({ time, instances })`
  in `K.particles` options. Return the same live IDs with uniform scales.
  The hook runs on display poses after simulation. A newly emitted particle
  gets a fresh ID even when it takes over a pool slot.

[Phase Register](../examples/stale-instance-transforms.js) compares live
flight markers with a position hold, a rotation hold and a copied scale.

```sh
node cli/ink-studio.js clip examples/stale-instance-transforms.js --w 464 --h 230 \
  --to 5.333333333333333 --fps 12 --out phase-register.png
```

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
| `geo.scrambleIndices` | Redirect one corner per selected triangle to an existing vertex within a mesh-space distance limit. Returns an indexed mesh, the individual redirects, and a report. |
| `geo.extrudeImage` | Expand an XY raster mask along Z. Set `pixelSize`, `depth`, `center`, `channel`, `alphaThreshold` and optional `edgeColor`. Holes pass through the part. The main mesh retains per-cell colors on the caps. The `front` port is a UV-mapped front cap for `warp.surface`. |
| `geo.sliceStack` | Build the exterior of a stack of aligned raster `slices` in list order. Set world `axis`, `spacing`, `center`, `pixelSize` and mask controls. Neighboring occupied cells share their boundary and omit their internal faces. |

`pixelSize` can be a world step or an XY pair. Raster tops point toward
local +Y, and later slices advance along the selected positive world axis.
XY maps to world XY for a Z stack, to −ZY for an X stack, and to X−Z for a Y
stack. The extrusion and slice operations return bounds and triangle counts
as separate ports. Feed mesh results to other graph operators such as
`meshPaths`, export them as JSON, or add them to a scene.

#### Bounded mesh index scrambling

Use `geo.scrambleIndices` or `KIT.procedural.sceneGraph.scrambleIndices`
on an indexed triangle mesh. In the default seeded mode, set the share
of eligible faces with `amount` (default .12). Ink rounds the attempted
count up and caps it at `maxFaces` (default 128). A face stays as authored
when the bounded search finds no suitable replacement.

```js
const { value, changes, report } = KIT.procedural.sceneGraph.scrambleIndices(mesh, {
  seed: 29,
  faces: [12, 13, 14, 15],
  donors: [24, 27, 31],
  bounds: { min: [-1, -.5, -.2], max: [1, .8, 1] },
  amount: .5,
  maxFaces: 2,
  minDisplacement: .16,
  maxDisplacement: .8
})
```

- `maxDisplacement` is required and measures the distance from the original
  corner to its replacement in mesh units. Use `minDisplacement` to make
  small redirects ineligible. All three original vertices and the donor
  must lie inside `bounds` when supplied.
- `faces` and `donors` are optional lists of zero-based triangle and vertex
  IDs. The graph uses its seed unless `options.seed` overrides it.
  To author exact redirects, pass `edits: [{ face, corner, vertex }]`.
  `corner` is 0–2 in the triangle's stored order. Authored edits use the
  same face cap, region and displacement limits. Each face accepts one
  edit. A redirect that would collapse its triangle is rejected.
- `value` retains the source positions and face materials. Each new corner
  reads the donor vertex's UV, normal and color where those channels exist.
  `changes` lists `face`, `corner`, `from`, `to` and `displacement`.
  The `report` counts eligible, attempted and changed faces and gives the
  largest applied displacement.

Connect the mesh output to `warp.surface` for depth-tested textured
geometry. [Lacuna Relay](../examples/mesh-index-scramble.js) uses seeded
redirects across a segmented shell and authored redirects to nearby
contact points.

```sh
node cli/ink-studio.js clip examples/mesh-index-scramble.js --w 432 --h 224 \
  --to 5.333333333333333 --fps 12 --out lacuna-relay.png
```

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

### Motion-driven deformation

Feed `fx.regionObservations` into `motion.landmarks` to turn tracked
features into paired `{from, to}` XY landmarks. Host tracking can supply
the same timestamped point records described in [tracked drawing anchors](#tracked-drawing-anchors).

A binding has a unique `id`, a `rest: [x,y]` point, and the stable
`track` ID to follow. It can use the region's center, `boundsAnchor`,
or `silhouetteDirection: [dx,dy]`. A silhouette direction finds the
outermost intersection of a ray from the region center with its contour.
Set `options.contours: true` on `fx.regionObservations` when using silhouette
directions. Rays are expressed in image axes, with positive Y down.

Bindings support the same `offset`, `smoothing`, `lag`, `hold`, and
`minConfidence` settings as drawing anchors. A missing landmark holds for
its configured duration and then uses its rest point. Omit `track` from
a binding to pin its rest point throughout the shot. The graph clock or
`options.time` samples the clip. The `landmarks` port reports each
position and its `tracked`, `held`, `hidden`, or `pinned` status.

| Consumer | Connect the landmark output to |
| --- | --- |
| `geo.motionMesh` | `control`. Mesh positions deform in a planar chart. UVs, vertex colors, material slots and indices stay bound to the same vertices and faces, and authored normals follow the local deformation. |
| `rig.skinSprite` | `motion`. The bound sprite vertices and joints are first posed by their bones, then deformed in output pixels. The source artwork is sampled through the resulting mesh in one pass. |
| `scene.motionSplats` | `control`. Select baked rows with `ids`. The node returns a new world and carries each selected row's covariance and authored brush axes along with its center. |

The mesh and splat nodes use XY by default. Set
`options.chart: {origin, u, v}` to place the landmarks on a different plane.
The XYZ vectors `u` and `v` are one tracking pixel wide and tall. Depth out
of the chart plane is retained. Interpolation reaches the authored controls
and blends their displacement in between. Large offsets between nearby
handles can fold a surface.

For live hosts that already own a rig or splat world, sample
`KIT.procedural.motionDeformation.track(observations, bindings)` and pass
the sampled control to `KIT.deform.motion(control, {chart})`. Use the
resulting map with the native `deform.rest` and `deform.apply` APIs or
the stage's deformation skin. Keep one rest snapshot per selected group
so repeated samples start from the authored shape.

[Browser demo](../examples/motion-driven-deformation.cjs)

```sh
node examples/motion-driven-deformation.cjs motion-deformation.html
```

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
