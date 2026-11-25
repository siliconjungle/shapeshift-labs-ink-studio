# Typed material displacement filters

Warp any typed source image with a spatial driver. The output keeps its source channel layout, sample encoding, alpha convention, color space, units, and port type. The same driver and options can move several aligned material maps together.

| Node | Driver and controls |
| --- | --- |
| `image.directionalWarp` | A scalar `map` shifts content along `angle` (clockwise degrees, with zero pointing right). Subtract `center`, which defaults to zero, to set the map's neutral value. |
| `image.nonuniformWarp` | A scalar `map` controls distance and a second scalar `direction` image controls angle. Effective angle is `angle + 360 × directionScale × direction`, with `directionScale` defaulting to one. The angle is interpolated and softened in circular coordinates so values near zero and one can meet cleanly. |
| `image.vectorWarp` | An unassociated unitless RG data image gives X and Y displacements. `encoding: "signed"` uses components directly, with a default center of zero. `"unorm"` doubles the signed difference from a default center of 0.5. Float maps default to signed and integer maps default to UNORM. Set a scalar or XY `center`, and use `yAxis: "up"` for Y-up vectors. The default is Y-down. |
| `image.slopeWarp` | A scalar height, mask, or data `map` provides local slopes. It uses centered differences one map texel to either side and expresses the gradient per source texel. Content moves downhill by default. Set `slope: "uphill"` to reverse it. |
| `image.multiDirectionalWarp` | A scalar `map` sets distance along one, two, or four equally spaced axes starting at `angle`. Both directions on every axis are sampled. `combine: "chain"` composes the opposed coordinates and samples the source once. `"average"`, `"min"`, and `"max"` combine image samples from independent paths in associated linear working space for color and componentwise for numeric data. |

Directional strength and angle maps use a unitless scalar mask or data image. All nodes accept an optional scalar `intensity` map in [0,1] that multiplies local strength. A value of zero keeps the underlying source location. Drivers can have different resolutions and sample at the same normalized coordinates. Alpha or display-color images can be explicitly routed to numeric data with the typed image channel nodes.

## Sign, smoothing and seams

- `amount` is signed and defaults to one. A positive value moves content in the driver's direction for a constant field. The sampler reads the source at output coordinates minus the displacement. A negative value reverses it. Opposed blend modes sample the same set of offsets for either sign.
- `units: "pixels"` uses source texels. With `"normalized"`, one unit spans the source width on X or the source height on Y.
- `smooth` is a Gaussian radius in driver texels (0–32). It acts on decoded distances, vectors, intensity, and circular angles before calculating offsets. A direction whose opposite vectors cancel produces no displacement at that site.
- `mapBorder` controls the driver taps and Gaussian passes. `border` controls the displaced source taps. Both accept `clamp`, `wrap`, `mirror`, and `transparent`, either as a single policy or independent `{u, v}` policies. A missing axis uses the corresponding image descriptor. Use wrap on the driver and source for a periodic warp. Transparent driver taps contribute zero in decoded space.
- `mapFilter` defaults to bilinear (`"linear"`) and also accepts `"nearest"`. The source uses the same `width`, `height`, `filter`, `mip` and `mipBias` controls as the [typed spatial transforms](material-image-transforms.md). Nearest level-zero paths copy the stored samples. Filtered color uses coverage-weighted linear light.

The filter modes draw on the distinctions in Adobe's [directional and nonuniform warp](https://experienceleague.adobe.com/en/docs/substance-3d-designer/using/substance-graphs/nodes-reference-for-substance-graphs/node-library/filters/effects/non-uniform-directional-warp), [vector warp](https://experienceleague.adobe.com/en/docs/substance-3d-designer/using/substance-graphs/nodes-reference-for-substance-graphs/node-library/filters/effects/vector-warp), [gradient-driven warp](https://experienceleague.adobe.com/en/docs/substance-3d-designer/using/substance-graphs/nodes-reference-for-substance-graphs/atomic-nodes/warp), and [multi-directional warp](https://experienceleague.adobe.com/en/docs/substance-3d-designer/using/substance-graphs/nodes-reference-for-substance-graphs/node-library/filters/effects/multi-directional-warp).

## Tidal Glass demo

```sh
node examples/typed-image-displacement/demo.cjs /tmp/ink-tidal-glass
ink-studio graph run /tmp/ink-tidal-glass/tidal-glass.material.json --out /tmp/ink-tidal-glass/replay
```

Open `index.html` to switch warps on a repeating painted tile. Drag the signed offset across zero. Compare Wrap and Clamp on the source or drivers to see which reads affect the seam.
