# Editable effect clips

An effect clip puts cue markers, numeric controls, keyed parameter lanes
and pinned graph passes on one playhead. Its effect is an ordinary Ink
graph, and the edited setup exports as a reusable graph group.

## Edit a clip

```sh
ink-studio effect-clip serve examples/rose-engine.effect.json
```

Open the loopback URL printed by Ink. In **Rose Engine**, choose
**Ignition**, jump to the cue, then move it later while keeping the
playhead still. The pressure front, hot core and nozzle light sample
the same new cue timing. Jump to the new cue to see the ignition again.

The timeline steps at the clip's picture rate. Scrubbing and key times
can also use fractional seconds. Select a lane to edit its keys. Change
a key's anchor between absolute seconds and a named cue with a signed
offset. Add a key at the playhead or remove a selected row. Moving a cue
moves all keys that refer to it. A lane's resolved times must remain
within the clip and increase in authored order.

Pin up to eight named graph outputs or authored node ports, including
ports inside a group. Each frame evaluates the graph once and reads all
the pins from that evaluation. Raster panes show native pixels with
integer enlargement. Numeric scalar rasters get a grayscale preview
with a fixed display range. Other numeric and structured data appear as readouts.
Parameter sliders affect the same graph frame.

**Download clip** keeps the cue-linked keys, parameter defaults and pins.
**Export graph group** downloads the graph with the edited defaults.
The workbench opens on the local machine and keeps edits in memory until
you download them. It loads source graph and media files relative to the
clip. Browser downloads use local file paths for dependencies. The CLI
can write a companion project that carries the original named assets.

## Author a clip

```json
{
  "format": "ink-studio/effect-clip",
  "version": 1,
  "id": "ignition",
  "duration": 2,
  "fps": 24,
  "cues": { "fire": { "at": 0.8, "label": "Ignition" } },
  "parameters": { "gain": { "default": 0.75, "min": 0, "max": 1 } },
  "lanes": {
    "heat": {
      "keys": [
        { "at": 0, "value": 0 },
        { "cue": "fire", "offset": -0.08, "value": 0, "ease": "linear" },
        { "cue": "fire", "value": 1 },
        { "at": 2, "value": 0 }
      ]
    }
  },
  "graph": {
    "nodes": {
      "level": {
        "op": "multiply",
        "inputs": { "a": { "node": "lane-heat" }, "b": { "input": "gain" } }
      }
    },
    "outputs": { "level": { "node": "level" } }
  },
  "pins": ["level"]
}
```

| Field | Authoring |
| --- | --- |
| `duration`, `fps` | Duration in seconds and picture rate as a number or an exact numerator/denominator. |
| `cues` | Named markers containing `at` in seconds and an optional `label`. Each becomes a `cue-NAME` seconds input. |
| `parameters` | Named scalar defaults. Optional `label`, `min`, `max` and `step` define the editor control. Each becomes an input of the same name. |
| `lanes` | Named scalar tracks with the same optional control bounds. Refer to `lane-NAME.value` from a graph node. A key has `at`, or `cue` and optional `offset`, plus `value` and optional Ink keyframe `ease`. The exported group exposes editable key arrays as `lane-keys-NAME`. |
| `graph` | Normal graph `nodes` and `outputs`, plus optional `inputs`, `groups`, `assets` and `assetRegistry`. Inputs outside the effect controls need defaults for preview. |
| `previews`, `pins` | Output names are available by default. Add named previews with `{output,label}` or `{node,port,label}`, then list the selected names in `pins`. A numeric scalar raster can set `range: [min,max]` for preview, defaulting to `[0,1]`. The underlying graph output stays in its original units. |

The generated nodes use [Ink's keyframe sampler](headless-authoring.md#animation-and-raster-simulation)
via `anim.cueTrack`. It accepts numeric `cues`, scalar `keys`, and
`duration` in seconds. It resolves keys against the named times
before applying normal Ink easing. Use it directly in a graph when the
cue schedule comes from another part of the graph.

## Run headlessly and reuse a group

```sh
ink-studio effect-clip preview examples/rose-engine.effect.json --at 0.97 --out frame
ink-studio effect-clip export examples/rose-engine.effect.json --edits delayed.json --out take
ink-studio graph clip take/rose-engine.project.json --output beauty --from 0 --to 58 --fps 24 --out render
```

An edits file contains partial tables, for example
`{"cues":{"ignition":1.2},"parameters":{"power":0.8}}`.
A `lanes` edit replaces the key array for each named lane. A `pins` edit
replaces the list of pinned passes. Invalid times or values leave the
last valid edit intact.

The companion project forwards the exported group's inputs and outputs.
Use [a shared graph group](headless-authoring.md#reference-a-shared-group)
in any parent graph, override `cue-ignition` or another named input, or
place a group on a child clock with `anim.retime`. Graph-owned assets
still use the surrounding project's named asset table. Use ordinary
[graph clip warm-up and cuts](graph-clips.md#warm-up-and-cuts) for
sequence-dependent feedback when printing the result.

```js
const ink = require('@shapeshift-labs/ink-studio');
const clip = ink.readEffectClip('rose-engine.effect.json');
clip.edit({ cues: { ignition: 1.2 }, pins: ['beauty', 'pressure', 'nozzle'] });
const { report, artifacts } = await clip.preview(1.21);
clip.export('./take');
clip.clear();
```

Use `ink.createEffectClip(document, { baseDir })` for an in-memory recipe.
`snapshot()` exposes the full editable recipe. `state()` describes the
controls, resolved key times and available previews. `sample(seconds)`
returns the current lane values without rendering.
