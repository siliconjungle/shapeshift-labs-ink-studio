# Whole-material layering

Use `material.layer` to put one material packet over another. Connect layer nodes in order to build a stack. Each node places all enabled maps together and returns a `materialChannels` packet for preview, baking, or publishing. Insert `material.replace` before a layer node to swap its base color or roughness while retaining the other maps. Use `defaultMode: "keep"` with explicit channel rules to transfer only the named maps.

## Inputs and controls

| Control | Behavior |
| --- | --- |
| `base`, `layer` | Material packets with matching UV sets on overlapping maps. Blended maps need typed images. Use `image.declare` for a legacy raster. |
| `mask` | Optional typed unitless grayscale image with samples from 0 to 1. A layer-space mask moves with the layer. A base-space mask stays fixed. |
| `options.opacity` | Shared contribution from 0 to 1. |
| `options.channels` | Per-map records with optional `mode` and `opacity`. Missing rules follow `defaultMode`. |
| `options.defaultMode` | `blend` applies the default blend to every map supplied by the layer. `keep` enables only the explicitly listed maps. |
| `options.transform` | Affine source-to-base transform in normalized UVs with Y down. Accepts `matrix`, clockwise `rotation` in degrees, `scale`, `pivot`, and `offset`. The default pivot is [0.5, 0.5]. Set `filter` to nearest or linear and `border` to clamp, wrap, mirror, or transparent, or choose a border per axis. Unspecified sampling and addressing use the source image settings. |
| `options.maskSpace` | `layer` by default, or `base`. |
| `options.height` | Set a record to enable height dominance. Compare the transformed upper height plus `offset` with the base height. `bias` favors the layer without changing delivered height. `softness` sets the transition around the comparison in matching height units. |

The result retains the base grid, channel encoding and metadata for each existing map. New maps use their layer grid and metadata. Maps can have different resolutions. The operation samples each layer map at the destination texel centers using the same normalized UV transform. Base-only maps and maps set to `keep` pass through by reference. New maps blend against neutral values. Height, metalness, flow and custom masks start at zero, normals start flat, RGB pigment and emission start black, and roughness, AO and opacity start at one. New RGBA maps start with zero coverage.

Pigment and emission blend in linear light. Embedded color or normal alpha affects that map. To use opacity across the stack, also wire that grayscale image to the mask input. Roughness, metalness, AO, opacity and custom masks use normalized values. For color, scalar and flow maps, modes include `copy`, `multiply`, `screen`, `overlay`, `hardLight`, `softLight`, `add`, `subtract`, `addSub`, `divide`, `min`, `max`, `difference`, `exclusion` and `keep`. Template defaults use `copy`. Height and flow keep their signed values. Blended values are clipped where the destination contract requires it.

Normals default to reoriented normal mapping (`rnm`) for tangent space. You can select `whiteout` or normalized `lerp` per normal channel. World-space normals use `lerp`. Tangent relief follows the UV transform, including mirrored directions. Flow vectors follow the forward UV transform. Height dominance uses the same height comparison for every enabled channel, so a raised ridge can keep its relief, pigment and finish together. It requires a height image in both packets with matching units.

In code, use `KIT.procedural.materialChannels.layer(base, source, options, mask)`.

## Lantern Relay demo

```sh
node examples/material-layering/demo.cjs /tmp/ink-lantern-relay
ink-studio graph run /tmp/ink-lantern-relay/lantern-relay.material.json --out /tmp/ink-lantern-relay/delivery
```

Open `index.html` in the demo directory. Recolor the enamel, swap its finish, move the maker's mark, or turn off height dominance to see the enamel cover the raised brass detail. Select a map above the preview to inspect the channels directly.
