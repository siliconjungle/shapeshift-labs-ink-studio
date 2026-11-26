# Recover editable materials from a Gaussian capture

`cloud-materials` analyzes a standalone Gaussian PLY, SPZ, or GSZ capture and writes a source-bound material bundle. It estimates a directional capture light, linear diffuse pigment, shading normals, roughness, and specular strength. Uncertainty is available per splat. The original Gaussian rows, geometry, opacity, and directional color remain in the byte-identical capture file within the bundle.

```sh
ink-studio cloud-materials recover beacon.ply --out studio/beacon
ink-studio cloud-materials inspect studio/beacon/material.json --row 214
ink-studio cloud-materials render studio/beacon/material.json relight.json --out relit.png
ink-studio cloud-materials override studio/beacon/material.json edits.json --out studio/beacon-edited
```

Recovery is bounded to 40,000 rows and 64 MiB of source bytes. The output directory holds `material.json`, `report.json`, and `capture.ply` or `capture.spz`. Keep these together to move the bundle. Render and override verify the captured bytes against the recorded SHA-256. The `rows` array is indexed by the source Gaussian row. Recovery and rendering use the original axis convention and the importer’s standard centered size-six framing.

## Estimate the capture light

Pass an optional JSON object with `--plan`. By default, the solver compares brightness variation across similarly colored splats to estimate an ambient floor, directional key strength, and direction. It assumes `ambient + key = 1` for that solve. The report flags absolute exposure as unresolved. It falls back to ambient-only when it lacks enough evidence to fit a key.

Normals use the shortest covariance axis when that axis is well supported. The solver also fits a plane to nearby centers and uses it when the covariance axes are round or ambiguous. Sign is oriented outward from the center by default. Use `normalToward: [x,y,z]` to orient mostly open surfaces such as a scan of a relief panel. `neighbors` defaults to 14 and accepts 4–32. `fallbackRoughness` defaults to 0.64 and accepts 0–1.

For a capture with known pigment samples, provide 4–128 distinct anchors with known, nonblack **linear RGB** triples.

```json
{
  "anchors": [
    {"row": 20, "pigment": [0.32, 0.19, 0.08]},
    {"row": 73, "pigment": [0.32, 0.19, 0.08]},
    {"row": 81, "pigment": [0.07, 0.24, 0.19]},
    {"row": 122, "pigment": [0.07, 0.24, 0.19]}
  ]
}
```

Spread anchors over several surface orientations. If the capture light is known, supply `captureLight` with `direction`, `ambient`, and `key` in place of `anchors`. Direction points from the surface toward the light. Ambient ranges from 0.025 to 4 and key from 0 to 4.

## Inspect and relight

For each splat, the solver samples the original directional response on its visible hemisphere. It fits a neutral highlight lobe and treats its remaining constant color as the lit diffuse term. The estimated capture light gives the factor used to separate that term into editable pigment. The bundle records the estimated irradiance, sample fit residual, normal evidence, roughness range, the reason a lobe was resolved or rejected, and three uncertainties. Scores are heuristic and run from zero for stronger evidence to one for unresolved. They are not statistical confidence intervals.

Degree-zero input retains editable pigment and normals and uses the fallback roughness with uncertainty 1. High uncertainty also marks rows with weak highlight evidence or limited geometric support. The single-key approximation can leave baked cast shadows, tinted reflections, or indirect light in the recovered pigment. Repeated hues can indicate several different materials. Calibration anchors and the per-row evidence help identify ambiguous regions.

A render view uses native camera settings and records optional output controls.

```json
{
  "width": 224,
  "height": 208,
  "camera": {"yaw": 0.35, "pitch": 0.18, "dist": 10.7, "ortho": true},
  "light": {"direction": [0.62, 0.42, 0.66], "ambient": 0.31, "key": 0.69},
  "mode": "relit",
  "captured": 0
}
```

The PNG uses Ink’s ordinary headless Gaussian rasterizer. Set `captured` between zero and one to blend from the recovered material to the exact original directional capture in linear light. A value of one restores the captured layer completely. Use `transparent: true` for RGBA. Other modes are `captured`, `pigment`, `normals`, `roughness`, `normal-uncertainty`, `pigment-uncertainty`, and `roughness-uncertainty`. Teal marks stronger evidence in uncertainty images, and orange marks weaker evidence.

## Override selected channels

Create a version-1 patch with `format: "ink-studio/cloud-materials-overrides"`, `sourceSha256` copied from the bundle, and an `edits` array. Each entry has a unique zero-based `row` and any combination of `pigment` (linear RGB), `normal` (nonzero source-axis direction), `roughness`, and `specular` (both 0–1).

For example, an edit entry can be `{"row": 214, "pigment": [0.52, 0.12, 0.41], "roughness": 0.73}`. A value of `null` restores the estimate for that channel. Each override run writes a new bundle. The recovered values, original capture, and uncertainty evidence remain available alongside the edits.

## Replay Copper Beacon

```sh
node scripts/build.js node
node examples/cloud-material-recovery/demo.cjs studio/copper-beacon
```

The demo synthesizes a directional capture from a beacon with known pigment, normal, and roughness. It recovers materials using pigment anchors, then compares their render under a different light to a render using the known material values. It also paints a magenta override on the front insert and checks that restoring the captured layer matches the original image exactly.
