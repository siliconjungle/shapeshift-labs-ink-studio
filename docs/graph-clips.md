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
