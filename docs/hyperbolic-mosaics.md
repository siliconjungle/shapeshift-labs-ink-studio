# Hyperbolic mosaics and circle packing

`KIT.procedural.tiles.hyperbolic` generates a finite regular tiling in
the Poincaré disk. `KIT.procedural.packing.apollonian` fills the gaps
between tangent circles. Both expose world-space geometry, stable
addresses, and cutoffs for detail near their enclosing circle.

## Poincaré tiling

```js
const disk = KIT.procedural.tiles.hyperbolic({
  p: 5, q: 4, depth: 8, radius: 1.8, center: [0, 2.5],
  minEdge: .0014, edgeSegments: 9
});

for (const tile of disk.tiles) {
  const color = KIT.procedural.data.hash(tile.id, 23);
  // Paint tile.outline or use the sampled polygon in a mesh or extrusion.
}
```

Each regular `{p,q}` tiling has `p` sides per tile and `q` tiles at
each complete vertex. Both numbers can range from 3 to 16, with
`(p - 2) * (q - 2) > 4`. The generator starts with the centered tile,
reflects across its geodesic edges, and visits the resulting graph
breadth-first. Poincaré edges lie on circular arcs orthogonal to the
disk rim. [Coxeter’s hyperbolic tessellations paper](https://www.cambridge.org/core/journals/canadian-mathematical-bulletin/article/trigonometry-of-hyperbolic-tessellations/D0219653B540B3A893C4E3D2FDA5CD84)

| Option | Default | Meaning |
| --- | --- | --- |
| `p`, `q` | 5, 4 | Regular disk tiling. |
| `depth` | 6 | Maximum reflection depth, from 0 to 16. |
| `minEdge` | .0015 | Minimum Euclidean chord length as a fraction of the disk radius, from .00001 to .5. Smaller candidates are omitted. |
| `edgeSegments` | 10 | Samples per edge as a count of line segments, from 1 to 48. |
| `maxTiles` | 4,096 | Tile budget, up to 16,000. The product of this budget, P, and the edge segment count is capped at 2,000,000. |

The layout contains `{ p, q, center, radius, tiles, limited }`. A tile
contains `{ id, address, depth, center, vertices, outline }`.
`vertices` are corners, and `outline` samples the curved edges in
counterclockwise order with the closing point implicit. The address
starts at the seed and records which edge was reflected at each step.
Duplicate visits use the first address found. A larger depth or tile
budget keeps earlier IDs with the same size cutoff.
`limited` reports when the tile budget cuts the requested traversal.

## Apollonian packing

```js
const { boundary, circles } = KIT.procedural.packing.apollonian({
  depth: 8, minRadius: .002, center: [0, 2.5], radius: 1.8,
  rotation: Math.PI / 2
});
```

The default seed contains three equal circles tangent to each other
and to a unit enclosing circle. You can supply three different
`seeds: [{center, radius}, ...]` in unit-disk coordinates. For example,
a unit enclosure admits radii `.5`, `.5`, and `1/3` at
`[-.5, 0]`, `[.5, 0]`, and `[0, 2/3]`.

Each new circle fills a gap through complex Descartes reflection.
The traversal returns the seed circles first and deeper circles in
breadth-first order. Each circle carries its `id`, `center`, `radius`,
`address`, `depth`, and the `parents` it touches. Parent IDs refer
to the enclosing `boundary` or an earlier returned circle.
[Lagarias, Mallows, and Wilks’s complex Descartes theorem](https://arxiv.org/abs/math/0101066)

`depth` ranges from 0 to 20 and defaults to 7. `minRadius` bounds new
circles relative to the enclosing radius, from .000001 to .5. It
defaults to .001. `maxCircles` defaults to 6,000 and ranges from 3
to 20,000, including the seed circles. `limited` reports when this
budget stops the traversal.

Both APIs accept `center`, `radius`, and `rotation` in radians.
The output frame defaults to the unit disk at the origin. Frame
transforms preserve addresses and size thresholds operate before the
transform. The returned records and coordinate arrays are immutable.

## Demos

[Disk Gate and Apollonian Seal](../examples/disk-studies.js) use the two
layouts as world-space inlays. The gate translates the mosaic through a
disk isometry so tiles magnify near the middle and compress against the
rim. The seal paints the packing as enamel cabochons.

```sh
node cli/ink-studio.js clip examples/disk-studies.js --w 760 --h 612 --to 5 --fps 12 --out disk-gate.png
node cli/ink-studio.js render examples/disk-studies.js --params '{"study":"seal"}' --w 864 --h 696 --out apollonian-seal.png
```
