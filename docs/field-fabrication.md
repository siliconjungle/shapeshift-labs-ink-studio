# Field-driven fabrication

`KIT.procedural.fabrication` turns a sampled field into closed triangle
geometry. Use one field to vary the wall thickness, cut all the way through
a shell, and raise ribs along chosen values. Use several cuts of a field or
signed profile to make a stack of separate solid layers.

```js
const P = KIT.procedural;
const carrier = P.surface.cylinder({
  id: 'lamp', origin: [0, 0, 0], radius: 1, height: 2.8
});
const ceramic = P.fabrication.shell({
  carrier,
  field: (u, v) => snapshot.sample('v', u, v),
  segments: [144, 64],
  thickness: value => .10 + .15 * value,
  cut: { level: .28, keep: 'below' },
  ribs: [{ level: .18, width: .06, height: .045 }]
});

const indexed = ceramic.indexed();
const sculptMesh = ceramic.mesh();
const lampModel = KIT.model.fromMesh(sculptMesh, { name: 'lamp', closed: true });
```

## Shells

- `carrier.sample([u, v])` supplies a world-space position `p` and a
  normal `n` on the unit chart. Smooth planar or curved charts with an
  orientable, regular sampling grid work as carriers. Periodic axes
  weld in the geometry and retain separate seam UVs for painting.
- `field(u, v)` returns a scalar at each chart node. Pass a positive
  world-space `thickness` or a callback `(value, u, v) => thickness`.
  The two faces sit half a thickness to either side of the carrier.
- `cut: { level, keep }` keeps the region below the level by default.
  Use `keep: 'above'` for the other side. The solver interpolates
  crossings along grid edges and closes the material with walls along
  cut edges and open chart borders. Exact-level samples are assigned
  to the cut side. Crossings stay at least `0.0001` of a grid edge
  away from its endpoints to separate point contacts.
- Each `ribs` entry specifies a `level`, a `width` on either side
  in scalar units, and a peak `height` in world units. Together they
  add relief to the outer side of the wall. The rib falls smoothly to
  zero at the edges of its band.
- `segments: [uCells, vCells]` controls how finely the field and
  carrier are sampled. The default is `[64, 32]`. Pick a grid that
  resolves features such as narrow ribs and holes. Thickness and rib
  height must fit the carrier curvature so the offsets stay separated.
  The generator checks sampled orientation and rejects folded facets.

A solid exposes `bounds` and triangle ranges in `parts.outer`,
`parts.inner`, and `parts.wall`. `indexed()` returns shared
`Float32Array` XYZ positions and `Uint32Array` triangle indices.
`mesh({ outer, inner, wall })` produces a native `KIT.mesh` with optional
normalized RGB colors for the three roles. Use `surface(role)` to pass an
individual region with per-corner UVs to a `SpriteSurface` atlas. An
empty cut returns no triangles and `bounds: null`.

## Layers from contours

```js
const outline = [[-2, -1], [2, -1], [1.5, 1.2], [-1.7, .9]];
const hole = [[-.4, -.3], [.4, -.3], [.45, .3], [-.42, .3]];
const profile = P.construct.profile([outline, hole]);
const plates = P.fabrication.stack({
  bounds: { min: [-2.3, -1.3], max: [2.3, 1.5] },
  field: profile.sd,
  segments: [100, 72],
  layers: [
    { id: 'base', low: 0, high: .15, cut: { level: .08 } },
    { id: 'inset', low: .15, high: .28, cut: { level: -.10 } }
  ]
});
```

`stack` samples in world XZ and places slabs between the requested
`low` and `high` elevations. Layers use the shared field or provide their
own `field(x,z)`. Give each layer a unique ID and ascending elevations.
Layers can touch and remain individually addressable closed pieces.
Supply XZ bounds that cover the intended cuts. The bounds themselves
form side walls wherever material meets the edge of the sampled domain.

## Studies

[Reaction Lantern and Contour Stack](../examples/field-fabrication-studies.js)
uses a retained Gray–Scott snapshot to cut a ceramic shell and shape
raised ribs. The floor receives light from moving rays tested against
the lantern's actual triangles. The other study cuts eight layers from
offsets of one authored contour and opens the stack to reveal the
individual pieces. [Pearson, *Complex Patterns in a Simple System*](https://arxiv.org/abs/patt-sol/9304003)

```sh
node cli/ink-studio.js clip examples/field-fabrication-studies.js --w 940 --h 560 --px 2 --to 6.4 --fps 10 --out reaction-lantern.png
node cli/ink-studio.js clip examples/field-fabrication-studies.js --params '{"study":"stack"}' --w 940 --h 560 --px 2 --to 6.4 --fps 10 --out contour-stack.png
```
