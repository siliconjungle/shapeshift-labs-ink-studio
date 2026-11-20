# Proportional subdivision

`KIT.procedural.proportions` recursively divides a rectangle into named
regions. Use the tree in local façade units, on a surface chart, or in
screen pixels. Each split exposes its two child regions and the seam
between them.

## Subdivide a rectangle

```js
const { phi, subdivide, pixelRect } = KIT.procedural.proportions;
const layout = subdivide({ min: [8, 30], max: [442, 250] }, {
  ratio: phi, depth: 2, gap: 6
});
const tiles = layout.leaves.map(({ path, bounds }) => ({
  id: path.join('-'),
  rect: pixelRect(bounds)
})).filter(({ rect }) => rect[2] && rect[3]);
```

| Option | Default | Meaning |
| --- | --- | --- |
| `ratio` | `phi` | Major span divided by minor span after reserving the gap. Use a finite value of at least 1. |
| `depth` | `1` | Maximum number of split levels, from 0 to 12. |
| `axis` | `'longest'` | Select the longest edge with ties on U, force `'u'` or `'v'`, or `'alternate'` starting on U. |
| `recurse` | `'minor'` | Continue through the `'minor'` branch, the `'major'` branch, or `'both'`. |
| `majorAt` | `'start'` | Put the major region at the low edge, at the high edge with `'end'`, or turn with `'turn'`. The turning order uses low, low, high, high by level. |
| `gap` | `0` | Gutter width in the input coordinate units. |
| `minSpan` | `0` | Stop splitting when either dimension of either child would fall below this length. A gap that consumes the available span also ends the branch. |

With bounds of `phi` by 1, no gap, and `majorAt: 'turn'`, the default
minor-branch recursion places successively smaller squares around the
remainder. Changing the ratio or using other root proportions gives a
different hierarchy of rectangular regions.

The immutable result contains `nodes` (including the root), `leaves`,
and `seams`. A node has two-dimensional `bounds`, a root-relative
`path` of `'major'` and `'minor'` tokens, and `depth`. A split node's
`split` references its seam. A seam appends `'seam'` to the parent path
and reports its `axis`, center coordinate `at`, and bounds. With
`gap: 0`, the bounds describe a line. Existing paths remain stable
when you resize or extend the tree as long as the same branches split.

`pixelRect(bounds)` rounds each edge to the nearest integer and returns
`[left, top, width, height]`. Shared edges round to the same coordinate.
Pass visible, nonempty tiles to a [camera atlas](camera-atlas.md) or
[screen compositor](mixed-resolution.md).

## Use it in an XYZ shape grammar

```js
const rules = {
  front: {
    op: 'proportion', plane: ['x', 'y'], depth: 3, majorAt: 'turn', gap: 0.08,
    major: { op: 'emit', role: 'sign-panel' },
    minor: { op: 'emit', role: 'small-label' },
    seam: { op: 'emit', role: 'brass-trim' }
  }
};
const { parts } = KIT.procedural.grammar.expand({
  id: 'exchange', symbol: 'front',
  bounds: { min: [-4, 0, -0.2], max: [4, 5, 0.2] }
}, rules);
```

`plane` maps U and V to two distinct axes and defaults to `['x', 'y']`.
The other axis retains the enclosing scope. A leaf uses the production
for its final branch (`major` or `minor`), falling back to `use` when
that branch has no override. An unsplit root uses `use`. Set a production
to `null` to reserve its space. A `seam` production can realize the
positive-width gutters as solids, sockets, or other grammar parts.
The ordinary grammar budgets and retained part keys still apply.

## Demos

[Phi Exchange](../examples/proportional-facade.js) uses a golden hierarchy
to place an entrance sign, intake and service labels, and brass seams.
The [camera study](../examples/proportional-shots.js) uses the same
subdivider with a custom 1.85 ratio to arrange three views of the building.
Use an even seed for a golden-ratio shot layout.

```sh
node cli/ink-studio.js render examples/proportional-facade.js --w 960 --h 636 --out phi-facade.png
node cli/ink-studio.js clip examples/proportional-shots.js --w 900 --h 540 --to 4 --fps 16 --out phi-shots.png
```
