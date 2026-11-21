# Export graph clips

`graph clip` samples one named raster, render frame, or baked scene output
in frame order. Use an inclusive `--from` and exclusive `--to`, in picture
frames. The range defaults to a start of zero at 24 fps.

```sh
ink-studio graph clip relay.json --output relay --from 12 --to 72 \
  --fps 30000/1001 --warmup 12 --cuts 42 --format both --out review
```

- `--format frames` writes numbered PNGs with their authored frame indices.
  Numbered images may vary in size. Raster channels use the existing
  0–255 RGBA conversion.
- `--format apng` writes a looping `clip.png`. All frames must have the same
  dimensions. The native encoder writes the reduced frame duration exactly,
  such as 1001/30000 seconds per frame. If its numerator or denominator
  exceeds the APNG field width, choose numbered PNGs or a representable rate.
- `--format both` (default) writes both from the same compressed frames.
  `report.json` names the files, statuses of project assertions, cuts, frame
  coordinates, dimensions, and artifact hashes. Assertions check emitted frames.

`--clock file.json` accepts either the [take clock settings](take-clock.md)
or an entire version 1 take file. A supplied `--fps` overrides its picture
rate and `--cuts` adds cut indices. Use normal `--inputs`, `--seed`, and
`--adapters` options to set up the graph. The runner evaluates at most
14,400 frames including warm-up and has a 256 MiB encoded output budget.

For a named baked world output, use `--render-options file.json` to specify
its native dimensions and view. For a raster coming from `scene.render`,
set these options on that node.

```json
{
  "width": 192,
  "height": 108,
  "transparent": true,
  "camera": { "target": [0, 1, 0], "dist": 6, "yaw": 0.4, "pitch": 0.2 }
}
```

## Warm-up and cuts

Each clip starts a fresh graph session. `--warmup N` evaluates up to N
preceding frames on the same clock, beginning no earlier than frame zero.
Those frames feed feedback and are omitted from the output. A cut clears
screen history and starts a new raster feedback segment before evaluating
the cut frame. A warm-up that crosses a cut keeps only history from the
new segment. Reusable groups and mapped groups keep independent history
per call or array position.

Screen feedback advances at picture cadence. Raster feedback continues
to use its authored fixed step. It starts at the tick sampled by the first
evaluation in each segment, including when the cut falls between solver
ticks, and continues to honor cuts declared in the node recipe. A move
backward in a feedback node's local clock starts a fresh segment for that
node. Other graph simulations retain their ordinary checkpoint and seek
semantics across clip cuts.

## Node API

```js
const ink = require('@shapeshift-labs/ink-studio');
const project = ink.readGraphProject('relay.json');
const { report, artifacts } = project.clip({
  output: 'relay',
  from: 12,
  to: 72,
  warmup: 12,
  format: 'both',
  clock: {
    fps: { numerator: 30000, denominator: 1001 },
    cuts: [{ frame: 42, id: 'crosswind' }]
  }
});
```

Artifact entries contain names relative to the output directory and encoded
PNG bytes. An in-process `clip` runs independently of the project's normal
`run` and `inspect` sessions.

## Capture a reusable visual span

Use `--format sample` to retain a short span as `sample.json`. The file
contains straight RGBA, the raw pass when it differs from the preview, and
aligned depth and motion planes with their own validity masks. It keeps the
exact source frame rate and the original first frame index. This format
supports up to 512 frames on a common grid and 64 MiB of decoded pixels.

```sh
ink-studio graph clip relay.json --output frame --from 12 --to 48 \
  --fps 30000/1001 --warmup 12 --format sample \
  --capture-options capture.json --out recorded
```

The optional capture settings work with `project.clip({ format: 'sample',
capture, ... })` as well as the CLI.

| Setting | Behavior |
| --- | --- |
| `pass` | For a scene or render-frame output, defaults to `color`. Choose a native pass such as `normal` or a screen branch such as `graph:signals`. When sampling an existing `scene.render.frame`, request those channels or graph passes on its render node. |
| `crop` | An optional fixed `[x, y, width, height]` rectangle on the source grid. All planes share the crop. Replay reports its top-left origin in source pixels. |
| `region` | Only keep pixels with this persistent numeric region ID. Outside the region and on missing frames, the image is transparent and the auxiliary masks are empty. |
| `labels` | Read one-channel stable IDs from this named graph output, for instance the `labels` port of `fx.trackRegions`. |
| `mask`, `tracking` | When selecting a region without a labels output, track the captured pass or use a named `mask` output as the tracking signal. The `tracking` record accepts the same settings as the region tracker. Warm-up advances tracking and an authored cut starts a new tracking segment. Supply your own labels for IDs that span cuts. |
| `depth`, `motion` | With no setting, retain available native planes on the sampled grid. For baked worlds the exporter requests both. Use `true` to require the native pass, `false` to omit it, or a named output for an aligned one-channel depth or two-channel motion raster. |
| `depthValid`, `motionValid` | Named one-channel outputs override the validity masks. Positive input values are valid. For an explicit depth or motion output, covered pixels are valid by default. |

Captures preserve valid numeric samples in source units. Invalid samples in
the auxiliary planes are zero with a zero validity byte. Native motion
compares the current rendered position to the preceding sampled frame in the
same segment. The first frame of a segment has no prior native motion
reference unless supplied by the caller. Warm-up can provide that reference
before the first stored frame. When a screen effect changes pixel
correspondence, provide aligned auxiliary outputs for that effect's grid.

### Replay the span

Load the sample using a normal `json` graph asset and pass it to
`anim.visualSample`. Use any number of copies, each with its own
rate, phase, holds, restarts, and [sync cues](headless-authoring.md#author-layer-clocks).

```json
{
  "assets": { "relay": { "format": "json", "file": "recorded/sample.json" } },
  "nodes": {
    "recording": { "op": "jsonAsset", "inputs": { "name": "relay" } },
    "echo": { "op": "anim.visualSample", "inputs": {
      "source": { "node": "recording" },
      "options": { "mode": "loop", "rate": 0.5, "phase": 0.15 }
    } }
  }
}
```

The `value` port is the display image. `data` retains the raw pass,
including linear RGB when supplied. `depth`, `motion`, `depthValid`, and
`motionValid` return rasters, or `null` if a frame lacks that plane.
`frame` is the zero-based clip index. `info` gives the original frame
and timestamp, local sample time, origin, and any region ID. Replaying
at a new speed or direction preserves the recorded displacement values
and their source pixel units.

### Capture and sample from JavaScript

```js
const visual = KIT.procedural.visualResampling;
const recorder = visual.create({ fps: 24, region: 7 });
for (const { color, depth, motion, labels } of sourceFrames)
  recorder.append(color, { depth, motion, labels });

const document = recorder.snapshot(); // JSON-compatible
const clip = visual.compile(document);
const copy = clip.sample(0.4, { rate: 0.5, mode: 'loop' });
```

Append frames in source order on a uniform picture clock. Use
`KIT.procedural.pixelEffects.createRegionTracker` to make the labels in
a browser or supply any aligned region IDs. WebGL can return selected
[screen passes](render-graph.md#read-screen-and-scene-passes) to this
recorder. A host can attach its own aligned depth and motion rasters.

Run `node examples/visual-resampling.cjs relay.html` to build the interactive
comparison and two reusable sample files.
