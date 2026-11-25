# Advanced typed texture filters

These graph filters keep color space, alpha convention, sample precision, tile addressing and physical alignment on the shared typed-image contract. Relief outputs retain their height units. Generated masks store normalized coverage.

| Node | Editable controls and output |
| --- | --- |
| `image.slopeBlur` | Trace a trail downhill along a height driver using signed `distance` in source texels, `slopeGain`, and 2–32 `samples`. Negative distance follows the uphill path. Choose average, minimum or maximum accumulation. `border` and `mapBorder` independently address the source and the aligned UV domain of the driver, which may have a different resolution. |
| `image.bevel` | Turn a thresholded mask or color channel into signed `art-px` relief. Set width in texels, height, inner/outer/both placement, and a linear, rounded or smooth profile. This uses the typed signed distance transform and its per-axis borders. |
| `image.emboss` | Derive a directional lighting mask from height. Set azimuth, elevation, strength, flat-area bias, derivative method, spacing and border. Flat relief returns the bias, which defaults to 0.5. |
| `image.seamRepair` | Crossfade opposing edge bands using one width or independent UV widths, an axis selection, and strength. Full strength makes opposite edge samples and enabled corners identical. Band reach is limited to half the corresponding axis. Interior samples outside the bands keep their original codes. Source addressing metadata is retained. |
| `image.heightShadow` | Trace the heightfield horizon toward the light and return cast-shadow coverage. Edit azimuth, elevation, angular softness, reach, sample step/filter, bias, sample spacing, border and opacity. A value of one is fully shadowed at full opacity. |
| `image.heightFrequency` | Separate height into `fine`, `mid`, and `coarse` bands using two increasing Gaussian radii. Recombine with independent signed gains. Unit gains reproduce the source height at the requested precision. |
| `image.scanCleanup` | Replace isolated outliers using actual neighboring median samples, a contrast threshold and a required neighborhood support fraction. An optional aligned mask scales repairs. An optional measured illumination image compensates color in linear light. The `repaired` port marks outlier replacements. |
| `image.edgeWear` | Compare height to a local low-pass surface to find convex ridges, concave grooves or both. Edit radius, threshold, softness, amount, border and an optional mask. The `height` port subtracts the selected wear multiplied by the authored cut depth. |

## Sampling and controls

Slope trails include their starting texel. Source color accumulates in coverage-associated linear light. Minimum and maximum accumulation act componentwise in that working space. A zero slope leaves the original sample in place. Seam repair uses the same associated color interpolation. It joins values at the selected boundary and can soften detail within the crossfade band.

For emboss and height shadows, azimuth is clockwise from image +X and elevation rises above the texture plane. In the shadow pass, reach and step are in source texels. The bias uses height units. When heights are in millimeters, the existing pixel pitch supplies spacing unless overridden. Transparent shadow borders exclude unavailable casters. Long rays and larger scan neighborhoods have bounded sample budgets.

Scan cleanup measures color contrast in linear luminance and uses the original snapshot for all neighborhoods. It uses covered pixels as candidates and preserves the source alpha. Supply a unitless aligned illumination map in [1/32, 32], where 1 means reference illumination. The compensation multiplies by the reference divided by the measured value, blended by `illuminationStrength` and the optional mask. Keep deliberate specks or fine marks with the mask. Large gaps are handled through the existing raster repair tools.

Slope trail controls follow the workflow described in [Adobe’s Slope Blur guide](https://experienceleague.adobe.com/en/docs/substance-3d-designer/using/substance-graphs/nodes-reference-for-substance-graphs/node-library/filters/blurs/slope-blur). For edge-local tile repair and heightfield shadows, see [Make It Tile Photo](https://experienceleague.adobe.com/en/docs/substance-3d-designer/using/substance-graphs/nodes-reference-for-substance-graphs/node-library/filters/tiling/make-it-tile-photo) and [RT Shadows](https://experienceleague.adobe.com/en/docs/substance-3d-designer/using/substance-graphs/nodes-reference-for-substance-graphs/node-library/filters/effects/rt-shadow).

## Breakwater Foundry demo

```sh
node examples/typed-advanced-texture/demo.cjs /tmp/ink-breakwater-foundry
ink-studio graph run /tmp/ink-breakwater-foundry/breakwater-foundry.material.json --out /tmp/ink-breakwater-foundry/replay
```

Open `index.html` to inspect the scan, a repeated seam preview, individual relief maps, and the relit material.
