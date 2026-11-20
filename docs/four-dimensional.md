# 4D projections and slices

`KIT.procedural.geometry.fourD` transforms convex polytopes and scalar
fields in XYZW. Use the resulting XYZ geometry or field with Ink Studio's
ordinary paths, meshes, masks, and splats.

```js
const D = KIT.procedural.geometry.fourD;
const solid = D.cell24({ radius: 1.44 });
const rotation = D.rotation([['xw', .61], ['yw', -.32], ['xz', .18]]);
const plane = D.frame({ offset: .46 });

const wire = D.project(solid, { rotation, perspective: 3.45 });
const cut = D.slice(solid, { rotation, frame: plane });
const faces = cut.mesh();
const opening = D.sliceField(solid.field, { rotation, frame: plane });

// At this XY position, test whether the cut is open in the scene's Z = 0 plane.
const isOpen = opening(.25, -.1, 0) < 0;
```

## Rotations and frames

`rotation([[plane, radians], ...])` composes planar turns in the listed
order. It accepts the six planes `xy`, `xz`, `xw`, `yz`, `yw`, and
`zw`. The result exposes `apply(point4)` and `inverse(point4)`. The
default transform is the identity.

`frame({ normal, offset, axes })` describes a destination hyperplane.
The default normal is `[0, 0, 0, 1]`, so the frame at offset zero is the
ordinary XYZ plane. `offset` is measured along the unit normal. If you
supply `axes`, give three independent directions that span the plane
after projection onto it. Their order sets the XYZ axes before
orthonormalization. Use `to3(point4)`, `depth(point4)`, and
`to4(point3, depth)` to convert coordinates. Depth is relative to the
frame and defaults to zero in `to4`.

## Polytopes and output geometry

- `tesseract({ radius })` and `cell24({ radius })` create the regular
  shapes at the given circumradius, which defaults to one. The 24-cell
  uses the coordinate permutations of `(±1, ±1, 0, 0)`, scaled to that
  radius. [Rastanawi, *On 4-Dimensional Point Groups and on Realization Spaces of Polytopes*](https://refubium.fu-berlin.de/bitstream/handle/fub188/36650/thesis_Rastanawi.pdf?isAllowed=y&sequence=3)
- `polytope({ vertices, edges, cells, tolerance })` accepts a convex
  4-polytope in author coordinates. Supply the complete boundary
  graph as XYZW vertices and edge pairs of vertex indices. Each cell
  is the unordered list of all vertices on one 3D supporting
  hyperplane. The optional tolerance controls coplanarity checks in
  world units. Solids expose `field(x, y, z, w)`, a signed maximum of
  their supporting plane distances.
- `project(solid, { rotation, frame, perspective, near })` returns an
  XYZ wireframe with `points`, indexed `edges`, `depths`, `vertexIds`,
  and `edgeIds`. Omit `perspective` for orthographic projection.
  In perspective, the eye is that distance along the frame normal.
  Edges are clipped against the positive `near` distance before the
  perspective divide.
- `slice(solid, { rotation, frame, epsilon })` intersects original
  edges with the hyperplane and assembles the boundary polygons.
  Results contain `points`, indexed `edges`, `vertexIds`, `edgeIds`,
  and `faces` with vertex indices and normals. A 3D section has outward
  face winding. A tangent section can have dimension `2`, `1`, or
  `0`, and an empty section has dimension `-1`. `mesh()` emits the
  faces in the native `geometry.builder` format. IDs refer to original
  vertices, edges, or cells so you can follow elements between frames
  while those intersections exist.

## Scalar fields

`sliceField(fn, { rotation, frame })` evaluates a scalar `fn(x,y,z,w)`
at each XYZ point of the rotated slice. `projectField(fn, options)`
samples along the frame normal at uniformly spaced depths. It accepts
`depth: [min, max]`, `samples`, and `reduce: 'min' | 'max' | 'mean'`.
The default is 33 samples over `[-1, 1]` with the minimum reducer.
Both adapters return ordinary `(x,y,z)` functions for use with masks,
contours, implicit meshing, or other field consumers. A finite
projection samples a depth interval, so details smaller than the
sample spacing can be missed.

## Demo

[The Fourth Gate](../examples/fourth-gate.js) uses the same moving cut
for a native mesh aperture, clearance for the light moving through
it, and a mint boundary in the adjacent wireframe. Choose the 24-cell
or switch the same rig to a tesseract.

```sh
node cli/ink-studio.js clip examples/fourth-gate.js --w 940 --h 560 --px 2 --to 6.4 --fps 10 --out fourth-gate.png
node cli/ink-studio.js clip examples/fourth-gate.js --params '{"shape":"tesseract"}' --w 940 --h 560 --px 2 --to 6.4 --fps 10 --out tesseract-gate.png
```
