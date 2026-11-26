# Apply multiple paint channels with a brush preset

Store reusable [3D painting](painting-3d.md) styles under `painting.presets`. A preset can supply just one channel or a complete brush style. Set a new mark's `preset` to the name. Its poses, attachment, and transform live on the mark.

```json
{
  "presets": {
    "pressed-reed": {
      "brush": { "kind": "mark-profile", "profile": "reed" },
      "direction": { "field": { "kind": "flow-map", "map": "grain" } },
      "looseness": { "spacing": 0.65 },
      "relief": { "mode": "volume", "height": 0.16, "silhouetteAllowance": 0.12 }
    }
  }
}
```

This preset uses the painting's `profiles.reed` and `flowMaps.grain` assets. `looseness.spacing` multiplies the interval between dabs, so a value below 1 places them closer together. The full set of preset channels is `brush`, `step`, `blendRadius`, `pressureResponse`, `looseness`, `direction`, `grid`, `relief`, and `mat`. The resolved mark still needs a valid brush, material, and attachment for its style.

Use an `apply-preset` edit to put the same style on an existing stroke.

```json
{
  "id": "detail",
  "edits": [{ "op": "apply-preset", "id": "border", "preset": "pressed-reed" }]
}
```

This takes the preset's values for every channel it defines. Other values stay on the stroke. Ink retains values inherited from the old preset as mark channels if the new preset leaves them unspecified.

Set a channel on the mark to override that one preset value. Replace the whole channel record, for example `{"op":"set","id":"border","patch":{"relief":{"mode":"volume","height":0.035,"silhouetteAllowance":0.03}}}`. Set `relief` to `null` in a `set` patch to return to the preset's relief. `plan` and `inspect` report the resolved settings and show which named channels came from the preset or the mark under `channelSources`.

A `painting-3d update` can also replace named presets with a top-level `presets` map. Linked strokes use the new values for inherited channels and keep their overrides. Delete a preset with `null` at its name and reassign any marks that use it in the same edit. `extract` keeps the preset definitions, profile and flow assets, and any local overrides in the portable painting.

```sh
node examples/paint-presets-demo.cjs /tmp/ink-paint-presets
```
