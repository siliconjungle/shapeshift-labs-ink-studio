# Curvature bakes

Bake three scalar maps in a [bake job](bake-jobs.md). Use `curvature` for signed mean bend, `curvature-convex` for outward bends, and `curvature-concave` for inward bends. With outward-facing mesh winding, a rounded bump is positive, a bowl is negative, and a flat area is zero. The two magnitude maps are nonnegative. A saddle can register in both even when its signed result is zero.

Curvature measures how the surface turns. Cavity measures how much nearby geometry blocks short rays. The Aster Relief demo has a flat patch under a cover with zero curvature and a strong cavity response. The cavity radius and ray settings affect that response independently of curvature.

## Choose the source and edge policy

| Setting | Mesh | Normal input |
| --- | --- | --- |
| `curvatureSource` | `mesh` (default) | `normal` |
| `curvatureScale` | Gaussian one-ring smoothing length in mesh units. Zero (default) uses the local bend directly. | Integer stride of 1–32 output texels. One is the default. |
| `edgePolicy` | `surface` (default) follows coincident, consistently oriented manifold edges through UV seams. `chart` stops at UV seams. Open, nonmanifold, and inconsistent-winding edges contribute no bend. | `one-sided` (default) shortens the stencil at a chart or tile boundary. `strict` requires the full stencil in both axes. Both stop at seams, gaps, and missing vectors. |
| `normalInput` | Omit. | ID from the job's `normalInputs`. |

The mesh estimate accumulates oriented dihedral angles weighted by edge length, distributes each edge contribution to its endpoints, and divides by vertex area. Smoothing combines only adjacent estimates. Ink interpolates the result over bake UVs. With a normal input, Ink differentiates normalized vectors in the receiver's UV metric and splits the positive and negative directions of the symmetric curvature tensor. Tangent-space inputs measure authored normal detail in the local tangent frame. World-space inputs use the supplied vectors in the receiver's mesh coordinate axes. Results have units of inverse mesh length.

A linked normal input is an RGB or RGBA PNG with unsigned normals encoded into [0,1], or an EXR with signed normal components. A single image applies to each requested tile. For different images per tile use a tiled descriptor. Tile IDs accept UDIM numbers or signed coordinate pairs. A missing file or undeclared requested tile fails the job. An unusable vector or an incomplete stencil yields an unmeasured texel. The report includes measured and unknown texel counts, signed extrema, and edge diagnostics. Unknown samples use the neutral code in exported maps.

```json
{
  "normalInputs": {
    "engraving": {
      "space": "tangent",
      "orientation": "opengl",
      "tiles": [{ "tile": 1001, "file": "engraving.1001.png" }]
    }
  }
}
```

Use `orientation: "directx"` for inverted tangent Y. For `space: "world"` omit orientation. Paths are relative to the bake job. Select these settings in the bake workstation's map overrides or author them in a preset.

## Set normalization and delivery

| Mode | Delivery |
| --- | --- |
| `none` | Default for `exr`. Writes raw signed or magnitude float samples. The workstation uses a display transform for preview. |
| `auto` | Default for `png16` and `png8`. Uses the largest measured lobe magnitude across tiles and compatible maps on the same target. Matching maps use the same measurement settings, output size, and padding. |
| `manual` | Uses a positive `curvatureRange` as the magnitude limit, which is useful for comparing across jobs. The result reports clipped samples. |

In normalized outputs, signed values map from `[-range, range]` and zero is at midpoint. Magnitude values map from `[0, range]`. Material graph refreshes record the normalization so `bitmapAsset` returns values in `inverse-shape-units`.

```sh
node examples/bake-curvature/demo.cjs aster-demo
ink-studio bake-job serve aster-demo/aster.bake.json --out aster-demo/live
```

Open `aster-demo/index.html` to compare the mesh, the normal-map etching, the magnitude maps, and cavity. The scene and both presets are available for rebaking.
