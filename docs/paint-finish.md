# Paint a finish over an existing material

Add `finish` to a [retained 3D painting mark](painting-3d.md) with a surface attachment and `snap.mode: "surface"`. The brush footprint and pressure opacity provide coverage. The receiver keeps its authored pigment, ramp, and material ID. The finish is evaluated over that material. A finish-only mark does not need a `mat` field.

```json
{
  "opacity": 0.78,
  "tint": { "color": "#b5dcff", "strength": 0.65 },
  "hueShift": 35,
  "roughness": 0.31,
  "coating": { "weight": 0.6, "roughness": 0.16 },
  "emission": { "color": "#fd9b42", "strength": 0.7 }
}
```

| Channel | Result |
| --- | --- |
| `tint` | Multiplies the underlying color in linear light. Set a hex RGB filter and optional `strength` from 0 to 1. White is neutral. |
| `hueShift` | Rotates the resulting hue in degrees from −360 to 360. Neutrals keep their hue. |
| `roughness` | Blends the base highlight roughness toward a value from 0 to 1. |
| `coating` | Adds a separate specular layer with its own `weight` and `roughness`. PBR evaluates a clear coat. Legacy surface lighting uses a separate sheen. |
| `emission` | Adds colored light to the mark itself. The hex RGB color is converted to linear light and multiplied by `strength` from 0 to 64. |

Each channel is optional. Finish `opacity` multiplies brush coverage. Overlapping color filters multiply, hue turns add, and emission adds. Roughness and coating blend in painting order. Finish strokes combine with named brush profiles, direction fields, grids, and shading relief.

## Light nearby surfaces

Emission lights the mark itself. To also light the scene, add `spill` under `emission`.

```json
{
  "emission": {
    "color": "#fd9b42",
    "strength": 0.7,
    "spill": { "intensity": 8, "radius": 1.8, "lift": 0.25, "shadows": true }
  }
}
```

Spill creates an invisible area light at the painted coverage's posed center. `lift` offsets it along the average surface normal. The light uses the emission color and a separate intensity. The headless lighting pass enables shadows by default. Pass `--area-lights off` to compare the same emissive mark with its spill disabled. Screen glow is an image effect and can be enabled independently. A scene supports up to 16 finish strokes with spill.

Use an edit such as `{"op":"set-finish","id":"border","patch":{"roughness":0.5}}` with `painting-3d update` to edit one channel. Supply `null` in this patch to remove a channel. A regular `set` edit can replace the entire finish. Finish can also be a [brush preset](paint-presets.md) channel. `plan` and `inspect` show the retained settings, and `extract` preserves them in the portable painting.

```sh
node examples/paint-finish-demo.cjs /tmp/ink-paint-finish
```
