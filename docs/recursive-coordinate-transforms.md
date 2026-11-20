# Recursive coordinate transforms

`KIT.procedural.coordinateTransforms` maps a plane with reversible
Möbius transforms, circle inversion, and bounded Droste recursion.
Use the same map on point coordinates, textured geometry, UVs, and
image pixels.

```js
const W = KIT.procedural.coordinateTransforms;
const bend = W.mobius({ a: [1, .06], c: [.105, -.075] });
const plate = W.repeat(bend, 3);
const inverted = W.inversion({ center: [.4, -.2], radius: .62 });
const combined = W.compose(plate, inverted);

const p = combined.forward(.3, .5);
const original = combined.inverse(...p);
```

## Maps and composition

`mobius({a,b,c,d})` evaluates `(a*z + b) / (c*z + d)`. Write a complex
coefficient as `[real, imaginary]` or use a real scalar. The defaults
are the identity. A singular or numerically ill-conditioned matrix
is rejected at construction.

`inversion({center, radius})` inverts about a circle and defaults to
the unit circle at the origin. It maps a point at radial distance
`r` to distance `radius² / r` along the same ray. Inversion reverses
winding in the mapped plane.

Both constructors return `forward(x, y)`, `inverse(x, y)`,
`orientation` (`1` or `-1`), and optional finite `pole` and
`inversePole` coordinates. Coordinate evaluation returns a pair or
`null` at a pole, near an unstable denominator, or when input or
output exceeds the finite coordinate range of ±1e12.

`compose(first, second, ...)` applies maps in argument order and
composes their matrices. It can cancel removable poles, including
the center of a double inversion. `repeat(map, count)` applies one
map zero to 64 times and returns another reversible map.

## Droste levels and pullback

```js
const stack = W.droste({ center: [.5, .5], radius: .48,
  ratio: .44, angle: .35, twist: .9, depth: 5 });
const nested = stack.levels[2].map.forward(.87, .5);
const print = W.image(source, { map: stack, filter: 'linear' });
```

Depth ranges from 0 to 16. `levels` begins with the identity, and
each nested level has a stable `id`, `index`, `scale`, `angle`,
`radius`, `innerRadius`, and reversible `map`. The ratio ranges from
.125 to .95. Each step scales and rotates one more time about
`center`. Use these level maps to place nested doorways, geometry,
UVs, or views.

`resolve(x, y)` finds the annular level and returns
`{ id, level, point }`, where `point` is the coordinate in the first
annulus. Shared boundaries choose the deeper annulus. The result is
`null` outside the outer radius or inside the innermost cut. The
`pullback(x, y)` shortcut returns just the source coordinate.
`twist` adds logarithmic rotation to this sampling operation,
measured in radians per unit change in log radius. Level placement
maps remain reversible similarities. [De Smit on the Droste effect and logarithmic coordinates](https://www.math.leidenuniv.nl/~smitbde/prep/bridges.pdf)

## Geometry, UVs, and images

```js
const warped = W.mesh(surface, plate, { plane: 'xy' });
const warpedUV = W.mesh(surface, inverted, { target: 'uv', outside: 'clamp' });
const print = W.image(cameraAtlas.read('inside'), {
  map: stack.levels[1].map, filter: 'linear', background: [18, 23, 34, 255]
});
```

- `mesh(surface, map)` accepts the native textured mesh layout
  `{ points, uvs, triangles }`. With `target: 'geometry'`, it maps
  the `xy`, `xz`, or `yz` plane and preserves the third coordinate.
  It uses the forward direction by default and corrects winding for
  reflections. Triangles crossing a pole or touching an unmappable
  vertex are omitted, and the result reports their `dropped` count.
  Use `maxCoordinate` to bound mapped positions.
- With `target: 'uv'`, the same adapter preserves geometry and uses
  the inverse by default. Out-of-range UVs drop the affected
  triangles by default. Set `outside: 'clamp'` to clamp finite UVs
  to [0, 1]. Supply `direction` to select either direction explicitly.
  Refine the mesh to represent curved mappings between vertices.
- `image(source, options)` takes the same top-down RGBA or RGB/alpha
  raster as frame composition and the camera atlas. It samples each
  destination pixel center using the map's inverse, a Droste
  pullback, or an authored `(x, y) => [u, v] | null` callback.
  `extent` and `sourceExtent` are XY boxes and default to [0, 1] on
  both axes, with increasing Y down. Output size defaults to the
  source size and can be set with `w` and `h`. Use nearest or
  alpha-aware linear filtering. Missing and out-of-bounds pixels
  use the supplied RGBA background or transparent black.

## Demos

[Recursive Coordinate Studies](../examples/recursive-coordinate-studies.js)
uses one engraved motif to show a Möbius-warped mesh, inverted UVs,
and a Droste print. **Room Within** captures four views of one
room deepest-first. Each tile is warped into the doorway for the
next capture. The final capture feeds the main view. All four
tiles share the same camera-atlas refresh rate and frame budget.

```sh
node cli/ink-studio.js render examples/recursive-coordinate-studies.js --w 1140 --h 525 --out recursive-coordinates.png
node cli/ink-studio.js render examples/recursive-coordinate-studies.js --params '{"study":"room","feeds":true}' --w 840 --h 680 --t 1.2 --out room-within-atlas.png
node cli/ink-studio.js clip examples/recursive-coordinate-studies.js --params '{"study":"room"}' --w 620 --h 502 --to 5 --fps 10 --out room-within.png
```
