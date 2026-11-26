# Animate retained 3D painting cels

Start a cel clip from a named [3D painting](painting-3d.md). Its placement, bindings, brush profiles, flow maps, and presets are shared. Each cel stores its own editable marks in order. Duplicate a cel to carry its mark IDs into another pose. Editing a mark in one cel preserves its earlier poses and settings in the other cels.

```sh
ink-studio painting-cels init scene.json --id moth --fps 12 --out seed.json
ink-studio painting-cels edit scene.json seed.json edit.json --out clip.json
ink-studio painting-cels inspect clip.json
ink-studio painting-cels sample scene.json clip.json --frame open --out open-scene.json
ink-studio render open-scene.json --out open.png
```

The `sample` command writes an ordinary scene. It replaces the placement with the same ID, or adds the placement if it is absent. Save the sampled scene beside its source to retain relative asset paths. The mark `wing-left` of placement `moth` resolves to `paint.moth.wing-left` in every cel that contains it. Sample by cel ID with `--frame` or by seconds with `--at`.

## Edit and time the clip

A hold is an integer number of ticks at the clip's `fps`. For example, three ticks at 12 fps last a quarter of a second. A loop returns to the first cel at the end of its last hold. `once` holds the last cel when sampled beyond the clip. A new clip starts with `cel-1` and a one-tick hold.

```json
{
  "format": "ink-studio/painting-cel-edit",
  "version": 1,
  "operations": [
    {"op": "insert", "id": "open", "after": "cel-1", "from": "cel-1", "hold": 3},
    {
      "op": "edit-marks",
      "id": "open",
      "edits": [{
        "op": "set",
        "id": "wing-left",
        "patch": {
          "poses": [
            {"point": [-0.1, 0.15, 0.35], "pressure": 0.7},
            {"point": [-0.8, 0.5, 0.44], "pressure": 1},
            {"point": [-1.1, 0.32, 0.52], "pressure": 0.9}
          ]
        }
      }]
    }
  ]
}
```

| Operation | What it changes |
| --- | --- |
| `insert` | Give the new cel an ID and optionally insert it `after` an existing cel. Omit `after` to append. Use `from` to copy a cel's marks and hold or omit it for a blank one-tick cel. `hold` can override either default. |
| `edit-marks` | Apply the normal retained painting edits, including mark order, brush settings, finish, and channel erasers, within the named cel. |
| `set-hold` | Change the named cel's duration in ticks. |
| `move` | Move a cel `before` another ID, or to the end if `before` is omitted. |
| `remove` | Remove the selected cel. Keep at least one cel. |

An edit request can also set the clip's `fps` or `playback`. A clip accepts up to 120 cels at 1–120 fps. Each cel can hold for 1–65,535 ticks. Use `inspect` to read the ordered IDs, start times, holds, and resolved mark IDs.

[Boiled marks](painting-boil.md#preview-or-export-a-painting-clip) can keep one seeded drawing per cel or redraw within a held pose. A boiled export records each resolved exposure and its exact hold.

## Review neighboring poses

```sh
ink-studio painting-cels preview scene.json clip.json --frame open --view view.json --out review
ink-studio painting-cels export scene.json clip.json --view view.json --out flipbook
```

The preview includes the active frame, available neighboring frames, and `onion.png`. Pink marks the previous cel and mint marks the next. The renderer uses the active scene time and one locked camera for all three. It compares changed strokes and their surface receivers with the unpainted scene. Shared pixels stay clear, and changed neighbors fade over the active stroke where they overlap. The preview receipt lists shared and changed mark IDs and the camera. Neighbors wrap in loop mode.

The optional view JSON sets `w`, `h`, `camera`, `raw`, and onion `opacity`. Camera settings use Ink's regular orbit or authored camera fields. The export renders each exposure at its start time with one camera, writes numbered PNGs, and packs the images into an animated PNG with their holds and playback mode. `export.json` maps each file to its cel, marks, and timing.

```sh
node examples/painting-cels-demo.cjs /tmp/ink-painting-cels
```

The example creates a four-cel signal moth, an editable sampled scene, the onion-skin review, and the animated PNG.
