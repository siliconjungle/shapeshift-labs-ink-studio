# Process a planar material scan

`material.scanProcess` brings the maps in a typed material packet onto one grid. It removes measured illumination, repairs defects with one donor per texel, and creates a repeat from a shared crop. Use it with planar scanner maps or a material packet from [measured captures](measured-materials.md). Use registered 3D projections to prepare curved scans first.

## Register the maps

Connect a packet with `baseColor` and any measured `height`, `normal`, `roughness`, or other scalar and color material channels. Each map needs a typed image. The node also accepts one-texel constants. The output keeps the channel labels and metadata, stores color in straight linear sRGB, stores normals as unit XYZ, and keeps height in its original units. Integer source samples are decoded to float. Float64 source maps retain float64 storage.

Set `options.align.width`, `height`, and `pixelPitchMm` to define the target. Dimensions default to the pigment extent and pitch comes from pigment or height when available. Set `pivot` to anchor the target. Provide 4–64 `landmarks` as `{target:[x,y],source:[x,y]}` pairs from target pixel centers to source pixel centers. Use `perChannel` for independently displaced maps, or set an entry to null for an already aligned map. Use `filter` to choose nearest or coverage-weighted linear sampling, and `tolerance` to limit the maximum landmark fit error in source pixels.

Tangent normals default to the calibrated surface frame. Set `normalFrame:"image"` when normal axes follow the source pixels. Ink uses the local registration derivative and the available pixel pitch to transfer the slopes. World-space normals retain their world axes. Roughness uses a weighted root mean square during registration.

## Remove illumination and repair defects

Supply scalar or linear RGB `illumination` on the same source grid as pigment. Ink divides out calibrated illumination at each source sample before blending the registered pigment. Set `deLight.strength` to vary the correction and `deLight.minimumLight` to reject samples too dark to divide stably. Use a measured flat-field or a light estimate from a calibrated capture. Height, normals and roughness retain their independent data through this stage.

Connect a target-space `defects` mask and an optional `validity` record of source-space grayscale masks keyed by channel. `repair.threshold` sets how strongly the defect mask must mark a sample. `repair.minimumCoverage` controls the minimum fraction of usable source evidence. The repair copies all material channels from the same nearest clean donor within `repair.radius` target pixels. Set the radius to zero to inspect missing or damaged samples before repairing. This repair is suited to small scan defects and localized missing data.

## Make a repeat

Set `options.tile` to enable repeat processing. Set `crop` to an integer target rectangle `[x,y,width,height]`, choose `axes` as `u`, `v`, or `both`, and set `band` to one blend width or independent U and V widths. All maps use the same crop and seam weights. Full `strength` joins the scalar and color edge samples and sets wrap addressing on the selected axes.

Tangent normals with calibrated height default to `normalMode:"height-detail"`. Ink separates the measured directional detail from the input height gradient, tiles the detail, then composes it with the periodic height gradient. It needs `mm` height with pixel pitch or `art-px` height. Set `normalMode:"sampled"` to blend the supplied normals directly and renormalize them. A repeat crop with unresolved defects fails with a diagnostic. Set `tile:null` to review the repaired material before selecting a crop.

## Inspect and deliver

The node exposes `aligned`, `delit`, `repaired`, and the final `value` packet. The `support`, `repairedMask`, and `unresolved` ports describe the full target grid prior to cropping. The report includes alignment residuals, repair counts, low-light skips, and each map’s before and after edge mismatch. Use ordinary material outputs to export color, height, normals and roughness from the same final packet.

## Juniper Kiln demo

```sh
node examples/scan-processing/demo.cjs /tmp/ink-juniper-kiln
ink-studio graph run /tmp/ink-juniper-kiln/juniper-kiln.material.json --out /tmp/ink-juniper-kiln/replay
```

Open `index.html` to compare the simulated capture, registered maps, repaired surface and repeat. Switch maps at any stage or rotate the preview light to check that pigment, relief and finish stay aligned.
