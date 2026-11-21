# Adaptive stippling and pointillism

`K.stipple` places actual native surface marks rather than adding uniform screen grain. Broad quiet regions receive fewer marks. Curved details, authored focal regions and selected silhouettes receive more closely spaced, smaller marks. Lighting controls density and mark size. The pointillist mode chooses reproducible pigment mixtures from an authored palette.

Open [The Quiet Mark](../examples/stippling.html) to compare an animated ink owl with a colored orchard. Orbit and zoom freely. Change the allocation, density or paper support, then regenerate the baked distribution. Camera motion and native bone animation reuse the baked splats.

```js
S.stipple = {
  style: 'ink',
  fine: 0.6,
  coarse: 2.5,
  views: [[0, 0.2, 1]],
  ink: '#183c50',
  paper: '#f3e7ce',
  zones: [{ at: [0, 2.5, 0.7], radius: 0.6, strength: 1 }]
};
S.ball([0, 1, 0], [0.9, 1.2, 0.7], {r: [2, 3, 4]}, {res: 0.08});
S.bake();
console.log(S.stippleStats);
const world = B.finish(sceneSettings);
```

Set `material.stipple: false` to retain an ordinary native surface within the same bake. Set `S.stipple = false` to retain the original bake path. Transparent, emissive, fiber and ghost surfaces use their existing representations. Whole independently moving parts keep independent exclusion groups. Bind rigs after baking; mark and support rows carry their owner's normal metadata and emission hooks, so existing tags and native bones include both.

The existing [adaptive sculpt sampler](adaptive-sculpt-sampling.md) remains available for continuous surfaces. Stippling takes priority on eligible surfaces when both are enabled. It collects candidates at `res * fine`, performs combined-SDF curvature and shadow probes, selects a deterministic variable-radius distribution, and emits native circle footprints. There is no per-frame resampling or new rendering pass specific to stippling.

## Allocation and appearance

| Setting | Default | Behavior |
| --- | --- | --- |
| `style` | `ink` | Constant ink, or `pointillism` using palette mixtures. |
| `spacing` | `0.08` | Base spacing for the pure sampler. Sculpt baking uses each primitive's authored `res`. |
| `fine`, `coarse` | `0.65`, `2.5` | Spacing multipliers for important and quiet regions. |
| `curvature` | `0.13` | Tangent departure threshold; smaller values refine more curvature. |
| `views` | `[]` | Up to 16 object-to-camera directions, normalized once. No camera-dependent rebaking occurs. |
| `silhouetteBand` | `0.25` | Normal/view band used to refine outlines. |
| `density` | `1` | Scales mark counts by changing exclusion spacing. |
| `toneDensity` | `0.6` | Additional marks in darker regions; zero keeps exclusion spacing independent of tone. |
| `size` | `[0.1,0.42]` | Radius as a fraction of local spacing, interpolated from light to dark. |
| `radiusLimit` | `0.45` | Maximum radius relative to the authored base spacing, preventing coarse regions from becoming large blobs. |
| `light`, `ambient` | `[-0.45,0.8,0.55]`, `0.2` | Allocation light and ambient contribution. Native material shading still determines source pigment colors. |
| `ink` | `#173b51` | Ink RGB bytes or hex. |
| `paper` | `#f5ead0` | Opaque native support under the marks; `false` leaves actual gaps. |
| `palette` | blue / amber | Up to 32 RGB-byte or hex pigment swatches for pointillism. |
| `seed` | `1` | Independent uint32 hash seed. Sampling does not consume the builder's random stream. |
| `shadowSteps`, `shadowDistance` | `6`, `2` | Bounded light-ray probes used for mark allocation. |

`zones: [{at, radius, strength}]` adds smoothly falling focal regions. `importance(candidate)` can add a value from zero to one using position, normal and caller metadata. For sculpt bakes it also receives `owner` and `material`, so facial features, an inscription, or selected objects can receive deliberate attention. Keep callbacks pure. The sampler takes the maximum of curvature, silhouette, zone and authored detail importance.

Paper support is independently sampled at approximately the authored resolution. It preserves opaque occlusion and native picking through gaps between marks. Both support and marks are retained plane-depth circle footprints, so the underlying surface does not erase its own marks when the camera rotates. Native material source colors are sampled at bake time; this representation replaces continuous brush/finish textures on participating rows. Existing scene looks and post effects can still grade the result.

## Pure sampler and inspection

```js
const plan = K.stipple.sample(candidates, {
  spacing: 0.05,
  importance: p => p.detail,
  maxMarks: 20000
});
// candidates: {position:[x,y,z], normal:[nx,ny,nz], spacing?,
//              curvature?, light?, detail?, group?, ...callerMetadata}
// plan.marks: {index, spacing, radius, importance, tone}
// plan.stats: candidate/accepted/rejected counts, work and spacing statistics
```

Candidate normals are normalized. Distinct explicit `group` values do not suppress each other's marks; opposite-facing sheets are also preserved. Compatible marks maintain a minimum distance of half the sum of their local spacings. A bounded octree handles variable radii without scanning every accepted mark.

`features(settings, candidate)` exposes the allocation decision. `measure(settings, signedField, position, normal, step)` measures tangent departure and light visibility. `paint(settings, sourceRGB, position)` returns ink or a deterministically chosen pigment. Pointillism selects between nearby palette colors so their spatial average approximates the source RGB; it does not perform spectral paint mixing.

Defaults limit one bake to 100,000 candidates, 30,000 marks, two million neighbor checks and one million SDF probes (`maxCandidates`, `maxMarks`, `maxChecks`, `maxProbes`). Exceeding a budget throws a specific error. Pure selection returns a complete plan before native mark emission. Disabled sampling allocates no candidate/index buffers. The library has no new runtime dependencies.

JSON scenes accept `finish.stipple` with the same serializable settings. JavaScript callbacks stay in JavaScript authoring.
