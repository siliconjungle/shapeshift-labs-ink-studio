# Boundary-driven potential fields

`KIT.procedural.fields.potential` solves a steady scalar potential on a
masked XZ grid. Pin electrode voltages or temperatures, insulate the
surrounding geometry, and sample a single solve as pigment, contour paths,
or downhill flow.

```js
const grid = KIT.procedural.fields.potential({
  width: 128, height: 80, cell: .06, origin: [-3.84, -2.4],
  mask: (x, z) => Math.abs(x) > .14 || Math.abs(z - .65) < .43
});
const field = grid.solve({
  pins: [
    { at: [-2.6, -.3], radius: .28, value: 1 },
    { at: [2.6, .3], radius: .25, value: 0 }
  ]
});
const bands = field.contours({ levels: [.25, .5, .75], cell: .06 });
const ink = KIT.fieldViews.lic(field.source('flow'), { counts: [128, 80] });
```

## Author the grid and its constraints

`potential({ width, height, cell, origin, mask })` builds a reusable grid.
Cell neighborhoods connect in the four cardinal directions. `cell` is a
width or the pair `[dx, dz]`. The default origin is `[0, 0]`. Supply
`mask(x, z, index)` at cell centers to leave obstacles out of the solve.
Faces adjoining those obstacles are insulating, so resolve narrow walls
and gaps with several cells.

| Solve option | Meaning |
| --- | --- |
| `pins` | Up to 256 `{ at: [x, z], value, radius? }` constraints. A point pins the containing open cell. A radius pins the open cell centers within it. Overlapping pins must agree. |
| `pin` | Optional `(x, z, index) => value` callback for authored electrode shapes. Return `null` or `undefined` to leave a cell free. |
| `boundary` | Map on `xMin`, `xMax`, `zMin`, `zMax`. Each side accepts a fixed value, `'insulate'`, or `(x, z, index) => value` at the face center. Callbacks can return `null` or `'insulate'` for individual faces. Unspecified faces are insulated. |
| `floating` | Potential for each connected component with no fixed constraint. It is constant in that component and defaults to zero. |
| `initial` | A retained solve from the same grid to use as the starting estimate. Updated constraints still take precedence. |
| `tolerance`, `maxIterations`, `maxWork` | Defaults are `1e-8`, 2,400 iterations, and 16 million free cell-iterations. The tolerance is the maximum absolute discrete imbalance divided by the row's diagonal weight, in potential units. |

At each free cell, the solve balances its four face contributions.
Interior faces use weights proportional to `1 / dx²` and `1 / dz²`.
Fixed outer values are half a cell away and get twice the matching
weight. Insulated faces contribute zero. The solver uses preconditioned
conjugate gradients and reports `stats.converged`, `stats.residual`,
`stats.iterations`, `stats.components`, and `stats.unanchored`. Inspect
`converged` if setting a small work budget.

This is a planar Laplace solve. Vary the fixed values between solves
to animate a series of equilibria. See [KTH's finite-volume notes on the
five-point stencil and zero-flux boundaries](https://www.csc.kth.se/utbildning/kth/kurser/DN2255/ndiff10/HW1_10a.pdf).

## Sample the result

- `sample(channel, x, z)` interpolates cell-centered values and returns
  `null` outside the open mask. At the outer half-cell the interpolant
  uses the nearest cell centers.
- `potential` is the scalar solution. `gradient` is the world-scaled
  derivative `[∂p/∂x, ∂p/∂z]`, estimated from the adjacent face slopes.
  `flow` is its negative, pointing downhill. `magnitude` is the length
  of the interpolated gradient.
- `data(channel)` copies a row-major buffer with X varying fastest.
  Vector channels are interleaved XZ. In a magnitude buffer each value
  describes that cell center. Masked cells store zeros in buffers, and
  `mask()` returns a matching open-cell buffer.
- `source(channel)` wraps the result as a standard world field at Y = 0.
  For another surface, pass `{ bounds, project }` with world XYZ bounds
  and a mapping from XYZ to XZ chart coordinates. Vector sources can
  also take `vectorToWorld([gx, gz], point)` to orient the result on the
  target surface. An optional `units` label travels with the source.
- `contours(options)` calls `KIT.fieldViews.contours` on the potential.
  Use `result.source()` to contour another projection. A retained solve
  is also a projected material field via `surfaceEffects.fields`.

## Render the studies

[Arc Gate and Thermal Key](../examples/boundary-potential-studies.js)
show directional grain bending through two offset barriers and a
thermographic plate with fixed heaters, sinks, and insulating slots.

```sh
node cli/ink-studio.js clip examples/boundary-potential-studies.js --w 850 --h 520 --to 6.4 --fps 10 --out arc-gate.png
node cli/ink-studio.js clip examples/boundary-potential-studies.js --params '{"study":"heat"}' --w 850 --h 520 --to 6.4 --fps 10 --out thermal-key.png
```
