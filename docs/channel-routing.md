# Headless channel routing

Inspect rig motion, audio, and simulation outputs together. A channel plan
places the sources on an exact comparison clock, evaluates editable stages,
and publishes named numeric controls for graph playback.

```sh
ink-studio channels discover relay.channels.json --out index.json
ink-studio channels resample relay.channels.json rms --out rms.json
ink-studio channels filter relay.channels.json smooth --out smooth.json
ink-studio channels blend relay.channels.json mix --out mix.json
ink-studio channels run relay.channels.json --out comparison.json
ink-studio channels route relay.channels.json --out controls.json

ink-studio graph clip relay.graph.json --output picture --from 0 --to 96 \
  --fps 24000/1001 --controls controls.json --out playback
```

## Describe sources and their clocks

Use a version 1 `ink-studio/channel-plan` with an `id`, `clock`, and
`sources`. A sample on the output lattice is at `start + index / rate`.
The clock accepts decimal seconds or integer ratios in `start`, which
defaults to zero. Use an exact integer or a ratio in `rate` and give
the number of `frames`. Stage-specific clocks use the same fields.

| Kind | Source fields | Discovered channels and timing |
| --- | --- | --- |
| `animation` | `rig`, `file`, `clip`, optional `contacts` | Assembled rig and [motion catalog](character-motion.md). Root coordinates are `root.x`, `root.y`, and `root.z`. Ball joint coordinates use `.x`, `.y`, and `.z` in degrees. Hinges use `.angle` and report their axis. Values use the clip's authored easing and nested placement. Set `contacts: true` to read the solved controls. |
| `audio` | `file`, optional `startSample` | WAV with named channels `ch1`, `ch2`, and so on in normalized full-scale units (`FS`). The WAV time reference sets the default absolute sample index when present. An explicit `startSample` can replace it. |
| `simulation` | `file`, optional `options` | Saved native sample trace, wave pressure or flow, modal pickups, contact track, or sample-rate sensor output. Use the existing trace adapter's `path`, `measure`, `track`, or `unit` fields as appropriate for the source. |

Paths are relative to the plan. Each source can specify an exact `offset`
in seconds added to its native origin. Discovery reports source format,
channel names, units, input hashes, original sample indices, effective
origin, and end. The underlying animation clock runs from zero through
the clip duration inclusively. A sample buffer starts at its original
sample index and ends just before the next sample after its last entry.

## Filter, blend, and resample

Each stage can read a `source/channel` reference or another stage by name.
Stages are evaluated in dependency order. A stage uses the plan clock unless
it declares its own `clock`.

- `resample` reads one `input`. `linear` (the default) interpolates
  adjacent samples. `hold` uses the current sample cell. The last sampled
  value holds through its cell. Continuous animation is sampled as a
  point on the authored curve with `linear`.
- `mean`, `rms`, and `peak` read a half-open output frame interval
  from a sampled channel. Mean and RMS weight fractional source cells
  by their overlap. This lets an audio envelope use the whole frame's
  samples when moving from an audio rate to a picture rate.
- `filter` reads one `input` using an optional `method`. Use
  `lowpass` or `highpass` with a `seconds` time constant, `abs`
  to rectify, or `map` to convert a range. Smoothing starts from the
  first available value and resets at a gap.
- `blend` adds `inputs` with explicit `weight` values (default 1).
  Each input can specify a resampling `method`. Map the inputs to a common
  unit before blending. A missing input produces a gap by default. With
  `missing: "zero"`, available weighted inputs continue contributing
  and intervals with no available weighted input remain gaps.

A range map clamps its source to increasing `input` bounds and maps
them to `output` bounds in the desired `unit`. Its `shape` can be
`linear`, `smoothstep`, or `power`. The power shape supports an
optional `exponent` (default 2).

```json
{
  "format": "ink-studio/channel-plan",
  "version": 1,
  "id": "relay",
  "clock": {"rate": {"numerator": 24000, "denominator": 1001}, "frames": 96},
  "sources": {
    "intake": {"kind": "audio", "file": "intake.wav"},
    "pipe": {"kind": "simulation", "file": "pressure.json", "options": {"measure": "pressure"}},
    "boom": {"kind": "animation", "file": "motion.json", "rig": "rig.json", "clip": "scan"}
  },
  "stages": {
    "rms": {"op": "resample", "input": "intake/ch1", "method": "rms"},
    "smooth": {"op": "filter", "input": "rms", "mode": "lowpass", "seconds": 0.075},
    "recorded": {"op": "filter", "input": "smooth", "mode": "map",
      "map": {"input": [0, 0.3], "output": [0, 1], "unit": "1"}},
    "measured": {"op": "filter", "input": "pipe/relay", "method": "rms", "mode": "map",
      "map": {"input": [0, 1.2], "output": [0, 1], "unit": "1"}},
    "mix": {"op": "blend", "missing": "zero",
      "inputs": [{"input": "recorded", "weight": 0.6}, {"input": "measured", "weight": 0.4}]}
  },
  "traces": {"audio": "smooth", "boom": "boom/boom.pivot.angle", "relay": "mix"},
  "routes": {"lamp": {"input": "mix", "fallback": 0,
    "map": {"input": [0, 1], "output": [0, 2], "unit": "1"}}}
}
```

## Publish comparisons and drive named controls

`run` publishes every declared trace on the plan clock, even when a
source or stage used a different rate. Use named references in `traces`,
or use objects with `input` and `method` to change how a column samples.
Omitting `traces` compares the stage outputs. A comparable trace includes
exact frame timecodes, source-clock metadata, units, stage settings,
values, and gap counts. Out-of-coverage points and windows are JSON
`null`.

Each entry in `routes` names a control. Give its `input` and optional
sampling `method`, range `map`, and numeric `fallback` for gaps.
`route` publishes the control series by name. `graph clip --controls`
also accepts a `run` report with controls, and injects a record into the
graph input named `controls` or the name given by `--controls-input`.
Use `scene.bindControls` to bind those names to existing numeric fields
in scene, drawing, and render settings.

The clip checks that the route uses the exact picture rate and that
the route covers all required frame times, including warmup. Missing
control samples fail playback. The render receipt records the route's
input name, hash, exact clock, and control names.

## Demo

```sh
node examples/channel-routing/demo.cjs out/breakwater-relay
```

Breakwater Relay aligns a WAV with a nonzero sample origin, two
pressure pickups, and a nested rig clip on a 24000/1001 picture clock.
The comparison sheet shows the control traces beside frames from an
Ink graph driven by the resulting routes. The demo includes the
animated clip, repeatable inputs, a discovery report, and numeric
evidence of the pressure arrival delay.
