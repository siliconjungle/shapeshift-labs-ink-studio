# Differential growth

`KIT.procedural.growth.differential` grows an ordered curve or an
indexed triangle shell. Each edge has a rest length. Increase selected
rest lengths and let the shape relax against its pins, tethers, and
neighboring folds. A fast-growing edge can buckle around a slower
interior.

```js
const growth = KIT.procedural.growth.differential.curve({
  points: stroke,
  plane: 'xz',
  pins: [0, stroke.length - 1],
  clearance: .14,
  tether: .05,
  splitLength: .18,
  rate: ({ rest }) => .012 + .032 * Math.min(1, Math.abs(rest[0]) / 2)
});
growth.step(12);
const points = growth.frame().points;
```

## Geometry and growth

Use `curve({ points, closed, ...options })` for an open or closed
sequence of XYZ points. Closed paths wrap back to the starting vertex.
Use `shell({ points, triangles, ...options })` for consistently wound
triangle triples indexed into the XYZ points. Shells retain their
authored triangle topology as they grow.

| Option | Effect |
| --- | --- |
| `rate` | A fraction in `[0, .5]` per tick. Defaults to .018. A callback receives `{ tick, edge, at, rest, length }` with the two stable vertex IDs, the current and authored edge midpoints, and its current rest length. |
| `pins`, `tether` | Pin selected original vertex indices in place or pull all unpinned vertices toward their authored positions. Tether strength from zero to one defaults to zero. |
| `plane`, `bounds` | Optional `'xy'`, `'xz'`, or `'yz'` restriction and an XYZ `{ min, max }` box. Planar vertices must start on a shared coordinate along the locked axis. |
| `clearance` | Desired distance between separate sections, default .10 scene units. Zero disables separation. |
| `stiffness`, `smooth`, `iterations` | Attraction toward growing rest lengths, relaxation toward local neighbor centers, and passes per tick. Defaults are .81, .04, and four. |
| `perturbation`, `seed` | Optional seeded displacement of unpinned vertices at the start. Small offsets give a symmetric shape a direction to buckle. |
| `splitLength`, `maxVertices` | Curves can insert a midpoint when an edge stretches beyond `splitLength`. Both child edges inherit half the parent's rest length. Existing vertex IDs remain stable. Splitting stops at the vertex budget. |
| `maxWork` | A geometry work budget for a whole `step` call. Smaller batches give high-resolution or tightly packed shapes room to advance within the bound. |

The solver uses a spatial grid to find nearby elements. It separates
curve segments and shell edges, and checks shell vertices against the
interiors of nearby faces. Incident elements and their immediate
neighbors share the same local material and are skipped. Separation is
iterative, so the actual gap depends on the available room, the pinned
vertices, and the number of relaxation passes.

## Compose and replay

- `step(count = 1, { rate } = {})` advances whole ticks. A per-call
  rate replaces the authored rate for those ticks, and zero relaxes the
  existing shape with no further length growth.
- `frame()` retains the current positions, stable `ids`, indexed
  `edges`, `anchors`, and `restLengths`. Feed a curve's `points`
  into the path or sculpting tools. A shell also exposes `triangles`
  and `mesh()` for the native mesh pipeline.
- `checkpoint()`, `restore(saved)`, and `reset()` preserve geometry,
  rest lengths, and curve subdivision for repeatable playback. Restore
  to the same authored setup and supply the same future rate callbacks.

See [Emilie Yu’s differential growth simulation](https://em-yu.github.io/media/papers/interactive-diff-growth.pdf)
for related work on uneven growth, repulsion, and surface cohesion.

## Render the studies

[Glaze Bloom and Ink Labyrinth](../examples/differential-growth-studies.js)
show a fixed ceramic foot with a faster-growing rim, and an anchored
stroke that accumulates length in a confined register. Glaze Bloom
uses a smooth cubic preview surface over the simulated control mesh.

```sh
node cli/ink-studio.js clip examples/differential-growth-studies.js --w 850 --h 520 --px 2 --to 6.4 --fps 10 --out glaze-bloom.png
node cli/ink-studio.js clip examples/differential-growth-studies.js --params '{"study":"labyrinth"}' --w 850 --h 520 --px 2 --to 6.4 --fps 10 --out ink-labyrinth.png
```
