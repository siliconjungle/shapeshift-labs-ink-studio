# Layered scene stages

A stage composes a native JSON diorama from a base scene and an ordered list of edits. Use it to keep geometry, rigging, materials, lighting and shot choices in separate files, then render or bundle a particular combination from the command line.

```json
{
  "format": "ink-studio/scene-stage",
  "version": 1,
  "id": "watchlight",
  "base": "base.json",
  "variants": {
    "time": { "default": "day", "choices": ["day", "night"] },
    "framing": { "default": "wide", "choices": ["wide", "close"] }
  },
  "selections": {
    "night-watch": {
      "variants": { "time": "night", "framing": "close" },
      "payloads": { "signal-buoys": true }
    }
  },
  "layers": [
    { "id": "shore-kit", "kind": "asset", "file": "layers/shore-kit.json" },
    { "id": "tower-rig", "kind": "rig", "file": "layers/rig.json" },
    { "id": "night-materials", "kind": "material", "when": { "time": "night" }, "file": "layers/night-materials.json" },
    {
      "id": "moonlight", "kind": "lighting", "when": { "time": "night" },
      "edits": [{ "op": "merge", "path": "/light", "value": { "amb": 0.15, "sky": 0.18 } }]
    },
    {
      "id": "signal-buoys", "kind": "asset", "file": "layers/signal-buoys.json",
      "payload": { "default": false }
    },
    { "id": "close-shot", "kind": "shot", "when": { "framing": "close" }, "file": "layers/close.json" }
  ]
}
```

- Layers apply from first to last regardless of kind. Later edits can replace earlier values. A layer with a `when` map applies when every listed choice matches.
- A layer contains inline `edits` or points to a version 1 `ink-studio/scene-stage-layer` document with an `edits` array. Edits use native JSON Pointers or path arrays. `set` replaces a value, `merge` updates keys in an existing object, `remove` deletes a field or splices an array row, and `test` checks an expected value before proceeding. Write parent collections before editing their children. Only the resolved diorama needs to be renderable.
- The base can also be an inline diorama or a `{ "file": "base.json", "sha256": "…" }` reference. Use an optional lowercase SHA-256 next to a layer's `file` for the same byte check. Stage source paths stay within the directory containing the stage. Scene asset references, including those introduced by a layer or the base, resolve from the stage's directory.
- An asset layer with `payload` opens its edit file only when enabled and its variant gate matches. An unloaded payload may be absent. An enabled payload with a matching gate must be present.
- Defaults come first. A named selection overrides them, and explicit `--stage-variants` and `--stage-payloads` override the selection. Use comma-separated assignments with no spaces. Payload assignments take `on` or `off`.

## Resolve and explain

```sh
ink-studio render watchlight.stage.json --stage-selection night-watch --out detail.png
ink-studio render watchlight.stage.json --stage-selection night-watch \
  --stage-variants framing=wide --stage-payloads signal-buoys=off --out wide.png
ink-studio scene-stage explain watchlight.stage.json --stage-selection night-watch \
  --at /solids/9/mat/role --out lantern-resolution.json
ink-studio scene-stage resolve watchlight.stage.json --stage-selection night-watch \
  --out watchlight.project.json
ink-studio render watchlight.project.json --out reopened.png
```

`explain` reports how each choice was made, whether each layer applied, its declared edits when active, and SHA-256 hashes of the stage and loaded layer files. Add `--at` to see the base value, resolved value, and every operation that changed the queried value, including edits to a parent or an array splice that moved it. A missing value is represented separately from JSON `null`. The source is the last operation that changed the value, or the base if the value stayed as authored. Explanations describe authoring data before render-time evaluation or camera overrides.

`resolve` packages the selected native scene and its project-supported dependencies. The resulting bundle can be moved and rendered independently. Pass `--root` when native asset references need a shared project root above the stage directory. Keep the source stage to compose another selection.

## Replay the demo

Run `node examples/layered-scene-stage/demo.cjs /path/to/output`. Watchlight Station shows a daylight wide shot, moonlit wide shot, and close night watch with the buoy payload enabled. The demo checks the lantern material's two-step change history, and renders the chosen configuration again from the relocated bundle to verify an identical PNG.
