# Non-orientable and minimal surfaces

The surface tools provide analytic charts, textured meshes, and
seam-aware frames for four finite parametric carriers. All use a unit
UV rectangle, with `origin` in world XYZ and the default axis along Y.

| Constructor | Shape controls | Joins |
| --- | --- | --- |
| `surface.mobius(options)` | `radius`, `halfWidth`, and an odd signed `halfTwists` | Crossing U reflects V as `1 - v`. V has an open boundary. |
| `surface.kleinBottle(options)` | `radius` and `tube` for a figure-eight immersion | U reflects V as `-v` modulo one. V wraps normally. |
| `surface.helicoid(options)` | `radius`, signed `pitch` per turn, and `turns` | Both axes end at the clipped boundary. V runs across the full ruling through the axis. |
| `surface.catenoid(options)` | Waist `radius` and total `height` | U wraps around the axis. V ends at the two rims. |

Each surface exposes `sample([u,v])` with position `p`, derivatives
`du` and `dv`, normal `n`, tangent, and bitangent. Use
`mesh({ segments })` to build a native textured surface suitable for
`SpriteSurface.mesh`. The mesh keeps separate UV vertices at its joins
while their positions meet. `surface.transform(chart, pose)` carries
the derivatives, join rules, and mesh into the placement.

The Klein chart uses the [3D-XplorMath figure-eight parametrization](https://www.math.uci.edu/~vmm/Surface/klein_bottle/klein_bottle.html).
The helicoid and catenoid use rectangular clips of the minimal
surfaces in [Cambridge's differential geometry notes](https://www.dpmms.cam.ac.uk/~gpp24/dgnotes/dg.pdf).

## Paint and move across joins

```js
const P = KIT.procedural;
const band = P.surface.mobius({ radius: 2, halfWidth: .6 });
const gold = P.surfaceMasks.compile([
  { points: [[.93,.23], [.05,.77]], width: .18, softness: .025 }
], { size: [12.56, 1.2], topology: band.topology });
const motion = P.motion.surfaceAdvection(band, [[.9,.23]], {
  step: .05,
  velocity: (_x, _y, _z, _time, { du }) => KIT.V.mul(du, .25)
});
const particle = motion.advance(.8).particles[0];
const mesh = band.mesh({ segments: [96, 24] });
```

`surfaceMasks.compile` and `dirtyBounds` accept `topology` in place
of the legacy `periodic` flag. Brush points are authored in the unit
rectangle. Each segment uses the nearest equivalent point in the
scaled chart metric. Use intermediate control points to specify a
longer route or additional winding. Add and erase strokes carry
across the same joins as the mesh.

The animation API takes unit seed UVs and integrates in a continuous
coordinate plane across each join. The particle snapshot and velocity
callback expose canonical `uv`, continuous `lift`, and an
`orientation` of +1 or -1. The callback also receives the lifted
`du` and `dv`. Use the lifted normal and tangent to mount particles
and strokes that should turn naturally as they travel. A full circuit
along twisted U reverses the local orientation. Two circuits return
it. Paint or shading that should look identical on both local sides
can use side-independent values such as the absolute normal–light
dot product. A Klein crossing keeps its two chart locations distinct.

For a custom carrier, create a join descriptor with
`surface.topology({ u, v })`. U accepts `'open'`, `'periodic'`, or
`'flip-v'`. V accepts `'open'` or `'periodic'`. The descriptor's
`canonical([u,v])` returns the unit UV and orientation.
`liftNear(uv, reference, size)` selects the equivalent coordinate
nearest a lifted reference. A carrier that exposes this descriptor
must sample continuous coordinates on joined axes and return
derivatives in the same frame. Use unit bounds with these carriers.
Advection can stop or clamp at open edges.

## Render the studies

[Twisted Glaze and Minimal Forms](../examples/topological-surface-studies.js)
combine painted mesh ribbons with animated splats. Both are fixed-camera
studies.

```sh
node cli/ink-studio.js clip examples/topological-surface-studies.js --w 940 --h 560 --px 2 --to 6.4 --fps 10 --out twisted-glaze.png
node cli/ink-studio.js clip examples/topological-surface-studies.js --params '{"study":"minimal"}' --w 940 --h 560 --px 2 --to 6.4 --fps 10 --out minimal-forms.png
```
