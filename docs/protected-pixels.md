# Protected one-pixel details

Use `look.protectedPixels` on a scene to keep small authored accents on the
native art grid. Each mark has a stable ID, a palette color, and a world
anchor. An anchor can be an XYZ point, a splat row, or a named mesh UV.
Mesh anchors follow skinned or edited vertices. Splat anchors follow the
row’s pose and disappear when it has no opacity.

```json
{
  "budget": 12,
  "marks": [
    {
      "id": "port-eye",
      "at": { "mesh": "pilot-visor", "uv": [0.22, 0.64], "offset": 0.015 },
      "color": "#fff3af",
      "priority": 100,
      "size": 0.03
    },
    {
      "id": "serial-letter",
      "at": [0.4, 0.9, 0.13],
      "stamp": ["#.", "#.", "##"],
      "color": "#ffa777",
      "priority": 70
    },
    {
      "id": "antenna",
      "path": [[-0.4, 1.1, 0.15], [0, 1.25, 0.15], [0.6, 1.05, 0.15]],
      "color": "#f3c182",
      "priority": 50,
      "size": 0.02
    },
    {
      "id": "relay-spark",
      "at": { "splat": 23 },
      "color": "#ffe8a0",
      "active": [0.3, 1.4],
      "priority": 80
    }
  ]
}
```

An unadorned `at` draws a single art pixel. A `stamp` is up to 9 × 9
pixels and uses `#` for ink and `.` for a hole. A `path` joins anchors with
a one-pixel stroke. Supply an optional mesh `triangle` to disambiguate
overlapping UV islands. Colors accept hex swatches, scene palette indices
and palette roles. `active` gates a mark by scene time in seconds.

Set `size` to the detail’s authored width in scene units. Ink uses the
fallback mark once that width reaches `maxPixels` (default 1.25). With
`size: 0` the fallback can draw at every scale. The native depth pass tests
each candidate against visible geometry. `bias` allows a small depth
tolerance in scene units (default 0.012).

## Spend the shot budget

`budget` is the number of protected art pixels available in one view
and defaults to 32. Ink sorts marks by descending priority and then ID.
An occluded mark costs nothing. A higher-priority mark owns overlapping
pixels. Ink admits each mark’s remaining visible footprint only if the
whole footprint fits. It then tries the next mark.

Pass a frame override such as `{ protectedPixels: { budget: 2,
priorities: { "relay-spark": 120 } } }` to favor a detail in one shot. A
frame can also supply a replacement `marks` list. The CLI accepts
`--protected-pixels on|off|file.json`. Headless rendering returns a
`protectedPixels` report and includes retained pixels in the requested
`protected` pass. WebGL reports the same budget, per-mark status and cost
through `protectedPixelsFrame(report)`.

The protected pass runs after coverage filtering, palette selection, and
scene cleanup. WebGL probes the native depth texture only at the candidate
pixels. Keep source anchors alongside an authored geometry-to-impostor
binding. Ink projects those same anchors through either representation.
Directional atlas color bakes omit the live accents by default so the
receiving shot can spend its own budget. For a final standalone atlas,
include them with `view: { protectedPixels: true }`, or use
`--protected-pixels on` with the atlas CLI.

## Watch the handoff

[Salvage Signal](../examples/protected-pixels.js) compares an untreated
shot, a two-pixel budget, and a wider budget during a live mesh-to-impostor
handoff. Its review JSON includes the representation blend and budget
receipt at every pose.

```sh
node examples/protected-pixels-review.js salvage-signal-review --hardware
node cli/ink-studio.js render examples/protected-pixels.js --w 240 --h 112 --px 1 --out salvage-signal.png
```
