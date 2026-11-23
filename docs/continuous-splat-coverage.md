# Continuous splat coverage

Set `look.splatCoverage` to `"continuous"` to join overlapping opaque splats on surfaces such as stone, walls, and skin. The renderer projects the splat's elliptical footprint onto the art grid, applies a small pixel filter, and uses a broader opaque core with a feathered edge. Overlapping footprints fill small gaps before the palette resolve. The mode follows the camera and works at native pixel size in the headless and WebGL renderers.

```sh
node cli/ink-studio.js render examples/splat-surface-coverage.js \
  --w 192 --h 128 --px 1 --raw --yaw .48 --splat-coverage legacy --out gate-legacy.png
node cli/ink-studio.js render examples/splat-surface-coverage.js \
  --w 192 --h 128 --px 1 --raw --yaw .48 --splat-coverage continuous --out gate-continuous.png
node cli/ink-studio.js clip examples/splat-surface-coverage.js \
  --w 192 --h 128 --px 1 --raw --camera-orbit 50 --to 4 --fps 12 --out gate-orbit.png
```

Choose a scene default through `world.look.splatCoverage` or `finish.look.splatCoverage` in JSON. Pass `splatCoverage` to Node's `render(world, options)` or the WebGL renderer's frame options to override the scene default.

| Mode | Coverage |
| --- | --- |
| `legacy` | Uses the original splat coverage. This is the default. |
| `continuous` | Joins neighboring opaque surface splats. Translucent, glass, optical, background, and animated particle splats retain their usual pipeline. |
| `soft` | Uses Gaussian coverage and leaves opaque ownership and depth to other geometry. |

A sculpt material can override the scene mode with `pixelStyle: { coverage: 'soft' }` for hair or broad brushwork. Use `'legacy'` on a material that relies on a deliberately sparse or hard edge, or `'continuous'` to enable the treatment on one material in a legacy scene. Material `edgeHardness` remains available in legacy mode. Ordinary translucent splats already use soft Gaussian coverage.

The wider footprint can slightly grow a silhouette and shade more fragments. Review critical thin gaps at the intended export size. Coverage follows the projected footprints, so a surface with large gaps still needs more samples. Picking uses the same coverage curve on the ray's world-space footprint.

For four-sample coverage across splats, wires, meshes, and decals on the same art grid, see [Filter coverage before palette lookup](texel-coverage.md#filter-coverage-before-palette-lookup).

The technique takes inspiration from elliptical screen-space reconstruction in [Surface Splatting by Zwicker et al.](https://www.merl.com/publications/TR2001-20).
