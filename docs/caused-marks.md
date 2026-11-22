# Place paint by cause

Bake drips, contact scuffs, and sheltered lichen into ordinary named paint layers. The bake uses the scene's retained solid sculpt in its rest pose. The saved samples carry their surface positions and normals, so they stay on the same faces as the camera orbits.

```sh
ink-studio paint cause examples/caused-marks.js examples/caused-marks.recipe.json --dir ./tide-gate-paint
ink-studio render examples/caused-marks.js --dir ./tide-gate-paint --w 448 --h 256 --px 1 --raw --out gate.png
ink-studio paint layers examples/caused-marks.js --dir ./tide-gate-paint
ink-studio paint tune examples/caused-marks.js --dir ./tide-gate-paint --layer sill-drips --opacity .45
```

The bake adds layers to `decals.json` in the scene's paint folder. Use `--replace` to regenerate layers with IDs already in the file. The original recipe and the baked paint are separate files, so editing a decal never changes its source recipe. Use `paint tune` for opacity and region, `paint clear --layer` to remove a layer, or edit the samples in JSON. On a per-pixel scene, `paint export` and `paint absorb` can also edit a generated layer from any angle. Use `--paint-corrections off` for a matched render with all named paint hidden.

## Specify a cause

A recipe has `version: 1`, a deterministic integer `seed`, and up to 32 `layers`. Each layer has a lowercase `id`, a `kind`, and `color` as a palette index or a list of up to eight palette indices. Optional `select` uses [scene target selectors](target-inspection.md) for receiving surfaces. `opacity` scales the whole layer. `region` clips the saved paint using world XYZ bounds and optional inward feather. `spacing` controls the distance between paint samples in world units and defaults to the scene's paint spacing.

| Kind | What it samples | Controls |
| --- | --- | --- |
| `drips` | Downward rays through `bounds` find an actual height drop. Front-facing rays then follow the receiver below that lip and stop at an interruption. | Set horizontal `direction` toward the front of the receiver. Set optional `edge` to a selector for the ledge. `interval` sets candidate spacing across the lip. `minDrop` qualifies the height change, `startDrop` caps the gap before the mark begins, and `reach` caps the inward trace. `length`, `width`, and `density` control the resulting drips. |
| `scuffs` | World-space `contacts` project onto the first solid within reach along the contact normal. | Provide a contact `point` plus optional `normal` (default up), `heading`, `id`, `material`, `weight`, or `load`. Repeated IDs are counted once. Use records from [material contacts](contact-effects.md) or author them directly. `length` runs along heading and `width` across it. Set `reach` for projection tolerance and `loadReference` for the load that gives full strength at weight one. |
| `trail` | Follow a world-space polyline and project wear onto the receiving surface. | Supply `path` as 2–64 XYZ points and tune `width`, `normal`, and `reach`. Use [persistent visual consequences](visual-consequences.md) to drive the opacity from a recorded visit count. |
| `lichen` | Rays facing into `bounds` find receiving faces. Each patch tests solid overhead cover along three rays, including at its edges. | Set outward `direction`, patch `radius`, candidate `interval` and `density`. `shelterReach` limits the overhead test and `minShelter` sets the required blocked fraction (default two of three rays). |

`bounds` uses world XYZ `min` and `max` and should include the ledge and the drop beyond it for drips, or the carrier faces for lichen. A drips layer can reach a wall below the scan bounds. An angled surface is projected sample by sample. Use smaller regions and tighter selectors when several objects share a footprint. `maxWork` and `maxSamples` bound the bake. A budget failure leaves the existing paint document intact.

## Library

Set `S.keepRenderSdf = true` before baking the source sculpt, or use a world built with retained SDFs. Call `K.surfaceMarks.bake(world, recipe)` to get `{layers}`, then pass the document as `paint` to `B.finish()` or as `finish.paint` in a JSON diorama. The returned `type: 'surface'` layers use ordinary editable decal rows `[x, y, z, nx, ny, nz, paletteIndex, opacity]`. They render on the visible side of the face without a capture-angle fade, in both CPU and WebGL paint paths.

The bake samples opaque static sculpt geometry. Bake again when the supporting geometry changes. The [Tide Gate recipe](../examples/caused-marks.recipe.json) shows four independent layers for the left sill, the walkway, the jamb, and the sheltered plaster.

## Leave paint from a simulation event

Pass a world run recording or checkpoint to `paint cause --events`. Each
matching event puts one editable layer on the retained solid geometry. A rule
chooses the receiving surface and the paint style. It can use a position, height,
or direction from the event itself.

```sh
node examples/event-surface-marks.js ./tide-gate-run
ink-studio paint cause examples/caused-marks.js ./tide-gate-run/recipe.json \
  --events ./tide-gate-run/run.json --dir ./tide-gate-run/paint
ink-studio paint layers examples/caused-marks.js --dir ./tide-gate-run/paint
ink-studio render examples/caused-marks.js --dir ./tide-gate-run/paint --w 448 --h 256 --px 1 --raw --out aftermath.png
```

The example records the sluice wetting the quay chamber, an impact cue, a
thermal pulse, and a completed repair. The four rules map those events to a tide
line, scuff, soot, and fresh plaster.

```json
{
  "version": 1,
  "run": "tide-gate",
  "rules": {
    "tide": {
      "on": { "kind": "chamber-wet", "system": "flood",
        "where": { "path": ["chamber"], "value": "quay" } },
      "pattern": "tide-line",
      "select": { "object": "wash-wall" },
      "point": [-2.38, 0, -0.047],
      "bindings": { "/point/1": "/level" },
      "length": 3.31,
      "width": 0.19,
      "color": [22, 23, 24]
    }
  }
}
```

- `on` uses the same kind, optional system, and optional condition as
  [event actions](event-actions.md). Match a field such as `body`, `material`,
  or `tick` when a run emits many events of the same kind.
- `bindings` copy event values by JSON Pointer into existing imprint
  arguments. For example, `{"/point":"/at"}` uses a measured contact position.
  The optional XYZ `normal` points out of the receiving surface, and `heading`
  sets the long axis of the imprint in its plane. `reach` defaults to `0.15`
  world units on either side of the center point. `length`, `width`, palette
  slots, opacity, and sample spacing are editable. `tide-line`, `scuff`,
  `soot`, and `repair` supply distinct footprints and defaults.
- The layer's `sourceEvent` stores the run label, rule, event ID, tick, system,
  and kind. It survives tuning, export and absorb, and saving the paint
  document. A repeat import keeps edited layers. Use `--replace` to regenerate
  a layer from the same source. Assign distinct lowercase run labels to takes
  or forks since event IDs are local to a run.
- A recording replays its committed events through its end tick. A checkpoint
  supplies its retained history and last committed events. Up to 32 matching
  layers fit in one bake. Scope busy runs with an event condition and import
  them in batches. Marks that miss the receiving geometry yield no layer.

From the library, pass events from the live run or an iterable of saved
committed records to `K.surfaceMarks.bakeEvents(geometry, events, recipe)`.
For example, collect `run.events` in `run.advance(to, { onTick })` and bake
the collected events against your retained scene. Each returned layer is an
ordinary surface paint layer with its source reference. Live hosts can gather
new batches without depending on the run's bounded history. Geometry is
sampled in its rest pose, and event positions should use the same world space.
