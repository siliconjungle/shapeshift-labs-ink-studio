# FX Map

`image.fxMap` draws an editable hierarchy of signed shapes and typed image stamps. Give a node a literal versioned map, connect its named images and parameters, and evaluate the color or gray output. Quadrant, Iterate, and Switch follow the same pattern-authoring concepts as the corresponding Designer nodes. [Adobe FX-Map guide](https://experienceleague.adobe.com/en/docs/substance-3d-designer/using/substance-function-graphs/fx-maps/fxmaps)

## Define a hierarchy

This map repeats one rose design in the four quadrants. Each quadrant draws two dabs with a small local offset.

```json
{
  "format": "ink-studio/fx-map",
  "version": 1,
  "root": "cloth",
  "patterns": {
    "rose": { "shape": { "type": "disc", "radius": 0.44 } }
  },
  "nodes": {
    "cloth": { "kind": "quadrant", "children": "bloom" },
    "bloom": { "kind": "iterate", "body": "dab", "count": 2, "limit": 8, "step": [0.06, 0.06] },
    "dab": {
      "kind": "quadrant",
      "stamps": [
        { "id": "rose", "pattern": "rose", "size": [0.86, 0.86], "color": "#e29e7c", "opacity": 0.72 }
      ]
    }
  }
}
```

| Node | Behavior |
| --- | --- |
| `quadrant` | Paints its ordered `stamps` in the current frame, then subdivides it. Provide one child name to repeat it in all quadrants or four child slots ordered top left, top right, bottom left, bottom right. Use `null` for an empty slot. |
| `iterate` | Paints optional `base` once, then visits `body` for `count` passes. `limit` defaults to 64 and accepts up to 512. `step` translates by local fractions per pass. `turn` adds clockwise degrees per pass. `shrink` multiplies the previous size. |
| `switch` | Visits `whenTrue` or `whenFalse` according to Boolean `select`. An empty branch can be `null`. |

Nodes can be referenced from several parts of the hierarchy. Node and stamp names give each visit an inspectable path. The walk draws parents first, then children in slot order. Iterate draws lower indices first.

Each node can apply `branchOffset`, `rotation`, and two-axis `scale` to its own frame and all descendants. The frame's center begins at `[0.5, 0.5]` in top-left UV coordinates. A stamp's `offset`, `rotation`, and `size` apply just to that mark. Offsets and sizes are fractions of the inherited frame. Rotations are clockwise in the local pattern plane. Each quadrant halves both axes and increments depth. Iterate and Switch preserve depth.

## Images and alpha

A pattern is either a signed `shape` definition or an `image` reference. Declare each named image socket in the map's `images` field as `colorImage` or `grayImage`. Shape patterns use the [signed shape library](material-shape-library.md), including soft profiles and compound symbols. An image pattern can declare `filter` as `nearest`, `linear`, or `image`, which inherits the source sampler. `wrapU` and `wrapV` accept `clamp`, `wrap`, `mirror`, `transparent`, or `image`. Use `uv: [left, top, right, bottom]` to choose an image region or flip an axis.

| `alpha` | Color image | Gray image |
| --- | --- | --- |
| `source` | Uses the image alpha. RGB input has full coverage. | Uses the sample as coverage for the stamp color. |
| `ignore` | Uses full coverage and preserves straight RGB when present. | Uses the sample as opaque grayscale. |
| `luminance` | Uses linear luminance times source alpha as coverage for the stamp color. | Uses the sample as coverage for the stamp color. |

Image filtering and overlaps are evaluated in premultiplied linear light. Each stamp can specify a display `color` tint, `opacity`, and `blend` mode. The modes are normal, multiply, screen, add, lighten, darken, and subtract.

The host node takes `width`, `height`, optional typed `background`, and `options`. Options include a solid `background`, output `precision` (`unorm8`, `unorm16`, or `float32`), a two-Boolean `wrap` pair, an integer `seed`, and `samples` of 1, 2, or 4 per axis. A typed background is composited over the solid before stamps. Wrap defaults to both axes enabled. Copies of one stamp share the same ID and contribute at most once per sample across a seam.

Set `mode` to `color` for straight-alpha sRGB or `gray` for linear luminance over black. The `coverage` map accumulates the stamps' alpha before the background. `stampId` records the top contributor at each texel center, with zero representing the background. `layout` contains one row for each painted stamp, including its path, seed, scope, and full affine axes. IDs follow paint order. The path identifies an occurrence across edits to other branches.

## Vary a branch or stamp

Use an inline [Value Processor](value-processor.md) as `program` wherever an FX Map node or stamp needs computed settings. Declare just the parameters it reads. Map-level `parameters` become typed graph sockets. Each program also has access to the following named local values.

| Parameter | Meaning |
| --- | --- |
| `position`, `size` | Birth center in canvas UV coordinates and the lengths of the current frame's two UV axes. Both are `vec2`. |
| `canvasSize` | Output width and height as a `vec2` in pixels. |
| `depth`, `quadrant` | Subdivision depth and most recent quadrant slot. The root starts at depth 0 and slot −1. Both are `i32`. |
| `iteration`, `iterations` | Nearest Iterate index and count. The index starts at zero and is −1 outside a repeat. Both are `i32`. |
| `state`, `random` | Four inherited local values and four independent seeded random values. Both are `vec4`. |
| `stampIndex` | Zero-based stamp index in the current node, or −1 in node programs. |
| `["seed"]`, `["time"]` | Path seed as signed 32-bit integer and evaluation time in seconds. |

A node program can return `branchOffset`, `rotation`, `scale`, or `state`. Iterate also accepts `count`, `step`, `turn`, and `shrink`. Switch accepts `select`. A stamp program can return `offset`, `size`, `rotation`, `opacity`, or RGBA `color`. Add an Iterate `stepProgram` returning `state` to carry state across passes. Descendants inherit the state of their current branch.

The engine derives seeds from the root seed and the visited path. Inserting more iterations after an existing pass preserves that pass's seed. The document validates references and rejects cycles. Expanded nodes, stamps, program work, image storage and raster work are bounded.

For direct use call `KIT.procedural.fxMap.compile(map).run({ width, height, images, parameters, options })`.

## Ember Brocade

```sh
node examples/fx-map/demo.cjs /tmp/ink-ember-brocade
open /tmp/ink-ember-brocade/index.html
```

Change the petal count to repeat the bloom branch, or switch from the painted input image to a signed shape. Try both filters on the painted petal. Click a petal to inspect its path, seed, quadrant and iteration, then switch to a 2 × 2 repeat to check the seams. The editable material saves the graph, map, and active controls together.

```sh
ink-studio graph run /tmp/ink-ember-brocade/ember-brocade.material.json --out /tmp/ink-ember-brocade-render
ink-studio graph inspect /tmp/ink-ember-brocade/ember-brocade.material.json --node weave --port layout
```
