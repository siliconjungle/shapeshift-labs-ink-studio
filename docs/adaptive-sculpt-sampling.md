# Adaptive sculpt sampling

Enable `S.adaptiveSampling = true` before `S.bake()`, or set `finish.adaptiveSampling` on a JSON scene. Adaptive baking samples broad faces at a coarser spacing and concentrates splats around bevels, creases, and tight curves. Authoring tools can supply view directions to prioritize curved silhouettes for a specific camera or directional atlas. The resulting splats use the ordinary Node and WebGL rendering paths.

The sampler compares nearby signed distances against the tangent plane at projected surface points. Coarse and fine samples overlap at transitions. Coarse dabs taper there to keep the detail visible. CSG uses the combined field, and independently moving whole parts use their own distance field.

## Settings

Set the option to an object for additional control.

| Setting | Default | Effect |
| --- | --- | --- |
| `coarse` | 1.8 | Multiplier for broad-face spacing, from 1 to 4. |
| `fine` | 0.7 | Multiplier for detail spacing, from 0.25 to 1. |
| `curvature` | 0.15 | Tangent-plane deviation threshold relative to the probe distance, from 0.02 to 0.6. Lower values refine more of the surface. |
| `views` | `[]` | Up to 16 XYZ directions from the object toward the camera. |
| `silhouetteBand` | 0.22 | Refine gently curved surfaces within this absolute normal-to-view dot product, from 0 to 0.75. |

The multipliers apply after the sculpt's `res`, [detail budgets](pixel-look.md#per-object-detail-budgets), and focus spacing. Uniform sampling is the default. The adaptive option targets opaque surfaces. Glass, coats of built-in sculpt fibers or foliage, ghost shapes, and template point capture use their authored spacing. The extra candidate pass adds bake work. Total splat count depends on how much of the sculpt is curved or beveled.

## Review a lantern at native size

Both images show the lantern at 32 opaque pixels tall on a 48×48 art grid. The example's authored settings prioritize two oblique views.

```sh
node cli/ink-studio.js render examples/adaptive-lantern.js \
  --w 48 --h 48 --px 1 --raw --adaptive-sampling off --out lantern-uniform.png
node cli/ink-studio.js render examples/adaptive-lantern.js \
  --w 48 --h 48 --px 1 --raw --out lantern-adaptive.png
```

Use `--adaptive-sampling on` for the default adaptive profile, `off` for uniform, or pass a JSON file with the settings. Add `--params '{"plinth":true}'` to include a broad planar surface for comparing allocations.
