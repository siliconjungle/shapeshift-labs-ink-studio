# Local ordering for live splats

Two transparent splats can cross in space. Sorting by their centers picks
one draw order for the whole overlap, which can flip as the camera turns.
Surface order estimates each visible fragment's depth from its splat plane.
That allows the warm sheet to be in front on one side of a crossing while the
cool sheet is in front on the other.

Build with `npm run build` and [serve the repository](webgpu-graphs.md#run-the-gallery).
Open the [Crossed glass demo](../examples/surface-order/index.html), then
choose **Step across 0°** to compare both modes at the center-order swap.
**Add a third sheet** and set the layer limit to two to see the per-pixel
fallback. **Measure frame cost** runs the same orbit in both modes with a
one-pixel readback per draw to wait for the render.

## Enable it for a shot

```js
renderer.render(world, {
  width: 160,
  height: 120,
  splatOrder: 'surface',
  surfaceOrder: { region: [0.25, 0.2, 0.5, 0.55], layers: 4 },
  surfaceOrderReport: report => console.log(report)
});
```

A scene can set `look.splatOrder` and `look.surfaceOrder` for the same
behavior. The default `'center'` uses the regular painter order. Use the
frame override `splatOrder: 'center'` for comparison.

| Setting | Default | Meaning |
| --- | --- | --- |
| `region` | `[0, 0, 1, 1]` | Normalized top-left `[x, y, width, height]` rectangle. |
| `layers` | 4 | Maximum local fragments per raster pixel, from 2 to 8. |
| `maxSplats` | 8,192 | Maximum submitted splats before the frame uses center order. Cap 32,767. |
| `maxPixels` | 98,304 | Maximum allocated raster pixels before the frame uses center order. Cap 524,288. Colored contours count its main and crisp rasters. |

Use authored splat normals for native discs and dabs. Live Gaussian imports
can use their retained thin covariance axes. Ambiguous normals and grazing
rays use center depth. The pass keeps the renderer's existing splat coverage
and colors. It gathers a bounded set of nearest fragments with depth
peeling, then uses the original compositing outside the region, where the
order is unchanged, and where there are more layers than the budget permits.
The report describes which mode ran and how many geometry passes it took.
Per-pixel overflow stays on the GPU.

This WebGL path supports ordinary native splat color and depth, including
live Gaussian RGB and standard palette rendering. Frames with water,
viewport media, portals, retained solid or depth proxies, owner-dependent
looks, or separate painted-palette coverage use their regular center-order
composition. Use `surfaceOrderReport` to find an unsupported composition or
an exceeded frame budget.

For headless renders, use `--splat-order surface`. The CPU implementation
has its own `fragmentBudget` and `orderFallback` report.

## Visibility and throughput

[StopThePop](https://r4dl.github.io/StopThePop/) addresses the same class of
view-dependent ordering errors with a hierarchical rasterizer. Ink's
bounded pass is intended for explicit art-grid crossings, with a work limit
for predictable fallback.

[Gaussian Point Splatting](https://momentsingraphics.de/Siggraph2026.html)
explores stochastic point sampling for throughput on much larger scenes.
[AbacusGS](https://arxiv.org/abs/2611.01534) explored preordered groups in a
preprint that its authors have since withdrawn. This pass uses deterministic
coverage and retains the existing center sorter for ordinary draws.
