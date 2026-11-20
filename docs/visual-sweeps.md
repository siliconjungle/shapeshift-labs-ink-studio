# Visual parameter sweeps

Compare the same view across a Cartesian product of settings and seeds.
The sweep writes a labeled PNG contact sheet, an optional synchronized
animated PNG sheet, each individual case, and a JSON report. Pin a tile
to retain its seed, bindings, case settings, and sampling times.

## Sweep scene controls

Use the same named controls a scene accepts through `--params`. Supply
base `controls`, optional named `cases` with top-level control overrides,
and named `parameters` with a `values` list. A parameter can name a
nested control with a JSON Pointer or path array. Without a path it
sets the top-level control of the same name.

```json
{
  "controls": {"parameters": {"b": -2.3, "d": -2.1}},
  "seeds": [37],
  "parameters": {
    "a": {"path": "/parameters/a", "values": [0.71, 1.4, 2.12]},
    "c": {"path": "/parameters/c", "values": [1.66, 2.4, 3.15]}
  },
  "visual": {
    "width": 300,
    "height": 192,
    "columns": 3,
    "pixelSize": 2,
    "at": 0.5,
    "clip": {"from": 0, "to": 2, "fps": 8}
  }
}
```

```sh
ink-studio sweep examples/visual-sweep-attractor.js examples/visual-sweep-attractor.plan.json --out attractor-sweep
```

Times are in scene seconds. The clip samples at the given integer
`fps` from `from` up to `to`, using the same frame cadence as
`ink-studio clip`. A poster on a clip frame uses that frame. Any other
poster time is rendered independently so it cannot affect the clip.
Omit `clip` for a still-only sweep. Omit `at` to use the first clip
sample or scene time zero. If seeds are omitted, the scene's authored
seed is used, with zero as the fallback.

## Sweep runtime worlds

Add a `visual` object to the existing [observation sweep plan](headless-worlds.md#scheduled-observations-and-parameter-sweeps).
Manifest paths, scheduled input ports, actions, cases, and seeds work
as they do for numeric sweeps. Images and observations come from the
same runs. A visual-only plan may omit observations.

```json
{
  "ticks": [4, 12],
  "observations": {"height": {"field": "pond/depth", "at": [0, 0, 0]}},
  "seeds": [3, 17],
  "parameters": {
    "rain": {"path": "/systems/pond/config/rain", "values": [0.02, 0.06]}
  },
  "visual": {"at": 12, "clip": {"from": 4, "to": 12, "every": 2, "fps": 6}}
}
```

```sh
ink-studio sim sweep world.json plan.json --out rain-sweep
```

Here `at`, `from`, and `to` are absolute simulation ticks. The clip
includes its final tick. `every` controls sampling, and `fps` controls
playback. When no poster or clip start is given, the still or clip
starts at the world or checkpoint's starting tick. A checkpoint or
recording uses its saved seed and permits variation through scheduled
actions and inputs. Visual output takes a new or empty directory.
Numeric-only sweeps still take a report filename.

## Pin and explore

Pick the tile number printed on the sheet or the exact run ID from
`report.json`.

```sh
ink-studio sweep pin attractor-sweep 5 --out selected.json
ink-studio sweep replay selected.json --out selected-render
ink-studio sweep nearby selected.json offsets.json --out attractor-nearby
```

For example, `offsets.json` can contain `{"a":[-0.16,0.16],"c":[-0.18,0.18]}`.
Offsets are relative to named numeric parameters. Zero is included on
each varied axis so the pinned case appears in the new sheet, marked
**PIN**. Unlisted settings, seed, case actions, and frame schedule
remain fixed. The pin records the scene file or registered scene ID.
Keep the source and any authored assets available when reopening it.

Both modes default to 240 by 144 pixels, a two-pixel art grid, and three
columns. Tile dimensions must divide by `pixelSize`. The optional
`title` labels the sheet. Visual batches support up to 48 runs and 120
clip frames, subject to the total sheet pixel budget. `report.json`
records exact parameter values even when the labels round them.
