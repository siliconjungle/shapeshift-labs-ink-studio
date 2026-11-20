# Bounded 3D fractal forms

`KIT.procedural.forms.fractal(spec)` returns a negative-inside field
`sd(x, y, z)` and world-space `bounds`. Add it to the sculptor with
`S.implicitForm` to bake native splats. The same field can feed a
section, a voxel extractor, or a boolean composition.

```js
const bulb = KIT.procedural.forms.fractal({
  family: 'mandelbulb',
  power: 8,
  iterations: 16,
  bounds: { min: [-1.35, -1.35, -1.35], max: [1.35, 1.35, .25] },
  pose: { position: [0, 1.4, 0], rotation: [0, .25, 0], scale: 1.12 }
});

S.adaptiveSampling = { coarse: 1.45, fine: .65, curvature: .12 };
S.implicitForm(bulb, { r: [1, 2, 3, 4] }, { res: .06, cell: .043 });
S.bake();
```

`bounds` clips the actual solid in local coordinates. For example, lowering
`max[2]` on an opaque specimen creates a positive-Z cut with a solid cross
section wherever the orbit field is inside. The optional `pose` uses the
same position, rotation, and scale as the other implicit forms and
transforms the clip with the specimen. Box extents must be at least
`1e-5` and coordinates must be within ±64 in local space.

## Families

| Family | Definition | Controls |
| --- | --- | --- |
| `quaternionJulia` | Iterate `q² + c` from the 4D slice `q = (x, y, z, slice)`, with `x` the real component. | `constant` is `[real, i, j, k]`, defaulting to `[-.2, .8, 0, 0]`. `slice` defaults to 0 and ranges from -8 to 8. The bailout must satisfy `abs(c) <= bailout * (bailout - 1)`. The default clip is ±1.65 on each axis. |
| `mandelbulb` (default) | Start at zero, raise the spherical radius to the power, multiply both angles by the power, then add the input point. Local Z is the polar axis. | `power` is an integer from 2 to 12, default 8. The default clip is ±1.35. |
| `menger` | Fold a unit-half-width cube at successive powers of three and subtract the three intersecting axial passages at each level. | `gap` is the fractional half-width of a passage and ranges from .1 to .45. The default of 1/3 gives the regular Menger sponge at finite depth. The default clip is ±1. |

Quaternion Julia and Mandelbulb use a finite escape orbit. Their
`iterations` default to 16 and range from 1 to 24. They use a
`bailout` radius of 4 by default, with an allowed range of 2 to 8.
Menger uses a fold depth of 1–7, defaulting to 3.

The orbit families use a derivative-scaled signed escape margin.
The magnitude is approximate, including inside the set. The
negative-inside sign and zero crossings are the useful quantities for
extraction. The Menger field uses box clipping and folded passage
distances. [Hart, Sandin, and Kauffman's quaternion distance-estimation paper](https://www.evl.uic.edu/hypercomplex/html/book/rtqjs.pdf) · [Daniel White's spherical Mandelbulb construction](https://www.skytopia.com/project/fractal/new/z/mandelbulb.html)

## Sampling

The sculptor samples zero crossings in the finite box and uses its
native curvature-adaptive bake to place finer dabs along edges and
silhouettes. `res` is the base dab spacing before the coarse and fine
multipliers. Set `cell` to fix the voxel spacing when small openings
need a particular resolution. When omitted, the crossing lattice
also follows the current bake spacing. Features below that lattice
spacing can disappear. Work scales with the grid volume and orbit
or fold budget, so start with tight bounds and refine as needed.

For an adaptive mesh preview, pass `form.sd` and a padded
`form.bounds` to `KIT.procedural.geometry.adaptiveSurface`. Start with
`{ maxDepth: 5, lipschitz: 0 }` to bound the subdivision and disable
distance-based pruning. For tooling that
requires distance units, such as a shell of a specific thickness,
first reinitialize a sufficiently fine signed lattice with
`KIT.sdfgrid(...).reinitialize()`.

## Demos

[Fractal Form Studies](../examples/fractal-form-studies.js) compares
all three families on a specimen bench. The section study trims the
Mandelbulb along one plane and colors the exposed surface as banded stone.

```sh
node cli/ink-studio.js render examples/fractal-form-studies.js --w 1120 --h 510 --out lithic-array.png
node cli/ink-studio.js render examples/fractal-form-studies.js --params '{"study":"section"}' --w 770 --h 710 --out sectioned-mandelbulb.png
```
