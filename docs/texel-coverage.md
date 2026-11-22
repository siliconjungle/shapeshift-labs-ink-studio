# Where the pixels live

## Object-local texels

Bake a rigid opaque mesh from a fixed point in its own coordinates. Each
of the six capture faces records the nearest hit on a grid of rays. Ink
clips the original triangles against the sides of each grid cell and binds
the resulting pieces to that cell's captured color. The cells keep their
shape and position on the prop during perspective motion. Geometry that
the probe couldn't sample draws with the supplied fallback color.

```js
import { bakeObjectTexels } from './webgl.mjs';

// mesh has flat XYZ points and triangle indices in the prop's coordinates.
const bake = bakeObjectTexels(mesh, {
  origin: [0, 0, 0],
  resolution: 12, // texels per edge of each capture face
  paint: ({ point, normal, triangle, face, x, y }) => paintAt(point, normal),
  fallback: 0x263447
});
const atlas = SpriteSurface.make(bake.width);
const region = atlas.reserve(bake.width, bake.height);
atlas.meshRegion(bake, region);
const spriteSurfaces = atlas.finish();
SpriteSurface.update(spriteSurfaces, region, {
  w: bake.width, h: bake.height, rgba: bake.rgba
});
```

Pass `spriteSurfaces` to `B.finish` to draw the prop through Ink's existing
textured-surface path in WebGL or headless renders. Put the probe inside an
enclosed prop and away from its triangle planes. Start with a simple mesh
and a face resolution between 8 and 24. `fallback` can be an RGB swatch or
a function of the source triangle index and normal. Keep the bake and
atlas region to update swatches with `SpriteSurface.update`. The lantern
example uses that update to switch enamel swatches with the live view angle
while keeping the texture coordinates fixed.

The fixed-probe projection follows Dylan Ebert's
[Texel Splatting](https://arxiv.org/abs/2603.14587). Ink projects the captured
cells onto the supplied mesh, which keeps the original surface depth and
allows fallback paint on occluded areas.

## Resolve coverage before palette color

Use `look.coverageVote` on a WebGL scene with named opaque splat materials.

```js
look: {
  coverageVote: {
    ramps: { enamel: [4, 5, 6, 7, 8], copper: [9, 10, 11, 12, 13] }
  }
}
```

Each ramp lists scene palette indices under the material's `materialId`.
Keep the same `objectId` on dabs that belong to the same object. Ink draws
two samples along each axis of an art pixel and groups visible solid samples
by object and material. At a boundary, the group with the most samples wins.
Tied groups prefer the nearer sample and then the lower group ID. The renderer
averages the winning group's shaded samples and chooses from its own ramp.
Interior pixels, sky, and winning materials with no configured ramp use the
ordinary resolve.

Set `coverageVote: false` in the frame to compare against the normal
palette resolve. This pass targets ordinary unpatterned, opaque splat
surfaces with a scene palette. Raw, patterned, tone-mapped, water, instanced,
proxy, and palette-constrained views use their regular resolve.

Build `npm run build -- development`, serve the repository and open the
[lantern and coverage comparison](../examples/texel-coverage/index.html).
