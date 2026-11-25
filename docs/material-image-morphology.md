# Typed material distance, edges, and morphology

These graph nodes apply exact Euclidean distance and boundary operations to typed images. They share the geometry distance solver with Ink’s existing field and byte-raster tools.

| Node | Result |
| --- | --- |
| `image.distance` | Distance to the nearest selected seed in `value`, its original texel coordinates in `nearest`, and owner presence in `valid`. |
| `image.propagate` | Copy samples from `source` using the `nearest` output of the distance node. Reuse one owner image for several source maps. |
| `image.signedDistance` | Positive distance to the selected region outside it and negative distance to a vacant center inside it. |
| `image.dilate` | Include centers at or within `radius` of the selected region. |
| `image.erode` | Keep selected centers whose distance to vacancy is greater than `radius`. |
| `image.outline` | Produce separate `inner` and `outer` masks and the combined `value`. Widths are measured to the opposing pixel-center class. Use `feather` for a smooth transition centered on the outline width. |
| `image.edgeDetect` | Return a thresholded mask and the raw `magnitude` plane from a Sobel or Scharr stencil. |

## Selection, units, and precision

Selection defaults to threshold `0.5`, with optional `invert`. Grayscale and height images use their scalar samples. RGBA defaults to alpha and RGB defaults to linear Rec. 709 luminance. Specify `channel` to measure decoded `r`, `g`, `b`, `luminance`, or `alpha`. Zero-coverage RGB contributes zero to color measurements.

Distances use centers at integer texel coordinates. The default `units: "pixels"` produces height in `art-px`. With `units: "normalized"`, one unit spans the shorter image axis and both axes use the same scale. Radii, distance caps, and outline widths use the selected units. Opposing samples adjacent to a straight boundary have distances of minus one and plus one pixel. Interpolation places the zero between them.

Distance outputs default to float64 and also accept float32. Typed images store finite values, so an unreachable distance uses `maxDistance` with the appropriate sign. The default cap is the image diagonal in the selected units. The cap limits distance output and leaves ownership intact. An empty seed set produces `[-1, -1]` in the two-channel owner map and zero in the validity mask. Propagation keeps the original sample where ownership is missing. Elsewhere it copies the owner’s stored channels exactly, including UNORM16 codes, HDR, or premultiplied alpha. The source and owner maps must share extent, pivot, and physical pixel pitch.

Morphology returns binary masks, and outlines and edge masks may have fractional coverage. These masks default to float64, with optional float32, UNORM16, or UNORM8. Edge detection uses the source samples directly. `threshold` selects gradient magnitudes, `softness` feathers upward from that cutoff, and the `magnitude` port stays float64.

## Tile seams

Omitting `border` inherits each source axis. Set a single border policy or use `{u, v}` to mix policies.

- `wrap` computes the nearest seed or vacancy through the periodic seam. Owner coordinates point to the original tile. Equal-distance ties favor the lower unwrapped Y, then the lower unwrapped X.
- `clamp` keeps the distance search inside the tile. `mirror` has the same minimum distances because reflected centers are at least as far as the corresponding centers already in the tile.
- `transparent` treats outside pixels as vacant. This changes signed distances and shrinking operations at an open edge. Distance to a selected seed only considers actual seeds.
- Edge detection samples each border policy directly, including mirror reads and zero for transparency.

The periodic transform sweeps three copies of each wrapped line and retains the middle period, so it never allocates a repeated 2D tile. The typed nodes accept up to six million texels.

## Seam Garden demo

```sh
node examples/typed-image-morphology/demo.cjs /tmp/ink-seam-garden
ink-studio graph run /tmp/ink-seam-garden/seam-garden.material.json --out /tmp/ink-seam-garden/replay
```

Open `index.html` to view all seven operations on the same repeating inlay, change borders independently on each axis, and inspect the distance and owner of any texel.
