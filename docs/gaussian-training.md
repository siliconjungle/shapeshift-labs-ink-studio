# Fit a Gaussian cloud from registered views

`gaussian-train` fits one static, colored 3D cloud from calibrated PNGs at the native art grid. You can supply a photographed or authored foreground with a mask, or capture a static subject from an Ink scene. The command uses the same fitter for both sources.

## Replay Signal Keeper

```sh
node scripts/build.js node
node examples/gaussian-training/demo.cjs studio/signal-keeper
```

The demo captures twenty training views around, above, and below an asymmetric sculpt. Three additional cameras are reserved for evaluation. The demo writes the pose manifest and captures, a fitted `cloud.ply`, a report with before/after metrics, a comparison sheet, and an animated turntable of the exported cloud beside the sculpt.

To capture and fit separately, run the corresponding CLI commands.

```sh
ink-studio gaussian-train capture examples/gaussian-training/signal-keeper.js examples/gaussian-training/cameras.json --out studio/signal-keeper/capture
ink-studio gaussian-train train studio/signal-keeper/capture/dataset.json --out studio/signal-keeper/fit
ink-studio render studio/signal-keeper/fit/cloud.ply --raw --gaussian-footprint compensated --out studio/signal-keeper/cloud-render.png
```

The regular importer centers and uniformly scales the cloud for standalone viewing. The training asset retains the input coordinate system. Held-out diagnostics use its original coordinates, the exact registered intrinsics, and the PLY decoded through Ink’s normal importer.

## Supply registered capture images

Write a version-1 JSON manifest with `format: "ink-studio/gaussian-training"`, world-space `bounds` as `{min: [x,y,z], max: [x,y,z]}`, and a `views` array. Bounds should enclose the entire subject, with a small margin for initialization.

Each view has a unique `id`, a `split` of `"train"` or `"holdout"`, its `width` and `height` in pixels, a PNG path in `image`, and a calibrated `camera`. Paths resolve from the manifest directory. Use source alpha as coverage, or supply a separate aligned grayscale PNG path in `mask`. Where a separate mask is supplied, the first channel times the mask image’s own alpha determines coverage. The image supplies the straight foreground RGB.

Use distinct cameras and keep the full masked subject inside the image. Every view needs both foreground and background. Use the same pose and consistent exposure across the set. A version-1 capture plan uses `format: "ink-studio/gaussian-training-capture"` and the same bounds, splits, and dimensions. Each view uses Ink’s native `camera` settings and an optional `time` in seconds. The capture command writes the calibrated manifest with the rendered PNGs. [Signal Keeper capture plan](../examples/gaussian-training/cameras.json)

| Calibrated camera field | Convention |
| --- | --- |
| `type` | `perspective` or `orthographic` |
| `pose` | World-space `eye` and right-handed orthonormal `right`, `up`, and `back` axes. The camera looks along negative `back`. |
| `fx`, `fy` | Focal lengths in pixels for perspective. Pixels per world unit for orthographic. |
| `cx`, `cy` | Principal point in pixels measured from the upper-left image edge. Pixel zero is sampled at `[0.5, 0.5]`. |
| `near`, `far` | Positive axial depth range in world units. |

The limit is 24 views with at least three training views and one to eight holdouts. Each side can contain 8–512 pixels, with up to 1.6 million pixels across the set.

## Control the solve and read the results

The manifest’s optional `settings` object controls deterministic sampling and work limits.

| Setting | Default | Range and purpose |
| --- | --- | --- |
| `resolution` | 28 | 8–64 cells on the longest side of the initial visual hull |
| `maxPoints` | 2400 | 16–8000 Gaussian rows |
| `iterations` | 24 | 1–96 fitting updates |
| `maxSamples` | 240000000 | 1–800000000 footprint sample visits including diagnostics |
| `alphaCutoff` | 0.5 | 0.05–0.95 foreground classification for seeding and silhouette metrics |
| `maskMargin` | 1 | 0–2 pixels of mask dilation for hull seeding |

The solver carves a coarse hull from training silhouettes, seeds its surface with Gaussians, and estimates starting pigment from depth-ranked training observations. It updates center, isotropic radius, opacity, and RGB against depth-ordered Gaussian composites. The objective is mean squared error in premultiplied display RGB and alpha. The best training iteration is frozen and encoded before the holdout images are opened.

`report.json` records source and asset hashes, calibration, initial voxel counts, the training loss curve, the winning iteration, sample budgets, and individual scores. Each holdout includes full-frame and foreground PSNR, RGB mean absolute error, coverage error, and silhouette intersection over union. RGB metrics use the fixed background recorded in the report. A `null` PSNR means zero measured error. The three-times RGB residual is a display aid. The reference, initial hull, and fitted view PNGs retain alpha.

This first fitter targets bounded, predominantly opaque objects with clean silhouettes. Isotropic splats and a single stored color per point can soften hard pixel marks, and concavities or hidden surfaces need camera coverage to be constrained. Thin features and highlights that change with angle can remain approximate.
