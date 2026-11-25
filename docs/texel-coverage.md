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

## Relight and edit baked texels

Use a `material` sampler in place of `paint` to capture unlit pigment
and separately editable surface channels. The same sampler parameters
are available, along with an occupied cell ID. Install the bake as a
native indexed mesh to use its actual triangle depth and openings.

```js
import { bakeObjectTexels, editObjectTexels } from './webgl.mjs';

const bake = bakeObjectTexels(mesh, {
  origin: [0, 0, 0],
  resolution: 18,
  material: ({ point, normal }) => ({
    pigment: paintAt(point),
    normal,
    roughness: 0.32,
    emission: 0x000000
  }),
  fallback: (_triangle, normal, { point }) => ({
    pigment: paintAt(point), normal, roughness: 0.58
  })
});
const surfaces = KIT.sceneMeshes;
const helmet = surfaces.fromObjectTexels(bake, {
  id: 'helmet', objectId: 'sentinel', partId: 'head', materialId: 'steel'
});
const world = B.finish({ meshes: [helmet] });

const cell = bake.cells.find(cell => cell?.face === 4);
const edited = editObjectTexels(bake, [
  { id: cell.id, pigment: 0x367765, roughness: 0.22, emission: 0x24ae82 }
]);
surfaces.updateObjectTexels(helmet, edited);
```

- `pigment` and `emission` are packed sRGB colors. `roughness` ranges
  from 0 to 1 and defaults to 0.65. `normal` is an object-local XYZ
  direction and defaults to the source triangle normal. Omitting a
  channel in a cell edit retains its previous value.
- `bake.cells[id]` describes a fixed cubemap cell or a fallback
  assigned to a source triangle. Empty addresses are `null`. The
  address, original coordinates and clipped mesh survive material edits.
  `editObjectTexels` returns a new set of map buffers.
  `updateObjectTexels` applies those maps to the already posed mesh
  without replacing its geometry.
- Bind each rigid part with `sceneMeshes.skin(mesh, boneIds)`, using
  the same integer bone ID for every vertex in that part. Normal
  directions follow its rest-to-posed frame independently of the UV
  lookup. For active `liveSun` lighting, both renderers use its
  direction, ambient and intensity. With no live sun, pass
  `lighting: { light, ambient, specular }` to the mesh constructor to
  tune its default lighting. `emissionStrength` scales the emission.
- The software `opaque-surface` pass exposes coverage, depth, material,
  shading normal and UV. The `emission` pass exposes visible emitted
  color. Shadow casting and reception follow the existing scene-mesh
  lighting paths.

The Vesper Guard example shows a helmet and pierced shield with distinct
metal, cloth, and emissive texels. A moving key crosses both independently
posed parts while the camera orbits.

```sh
node examples/relightable-object-texels.cjs vesper-guard
```

## Select, protect, paint and watch an object texel cluster

Open a transaction editor on the relightable bake. A cluster follows
shared edges between clipped surface pieces, including cubemap seams
and fallback material pieces that actually touch. The default
`pigment` mode follows the seed's exact current RGB value. The
`surface` mode follows all connected cells. An empty capture cell
cannot be selected. Cell IDs stay bound to the bake during camera
and rigid pose changes.

```js
import { createObjectTexelEditor } from './webgl.mjs';

const editor = createObjectTexelEditor(bake, { KIT });
const { selection } = editor.execute({ op: 'select', at: [4, 7, 9] });
editor.execute({ op: 'protect', ids: [selection[0]] });

const stroke = {
  face: 4, points: [[6, 9], [10, 9]],
  values: { pigment: 0x4caa99, roughness: 0.32, emission: 0x174a3d }
};
const preview = editor.execute({ op: 'preview', ...stroke });
editor.execute({ op: 'brush', revision: preview.revision, ...stroke });
editor.apply(helmet);

// Capture this pass at px: 1 for each camera or pose.
const capture = editor.watch(helmet, frameWithSourceSurface);
const visibleCell = capture.cellAt[y * capture.w + x];

editor.execute({ op: 'undo' });
editor.apply(helmet);
```

Pass a known `seed` cell ID or `at: [face,x,y]` to select. Face order
is +X, −X, +Y, −Y, +Z, −Z. A brush can set any object-texel material
channel. Add an existing `ink-studio/pixel-brush` tip to a face stroke
to stamp its palette or tint, with explicit `values` taking precedence.
Supply `ids` for specific addressed cells or omit the path and IDs to
paint the whole selection. Use `scope: 'all'` to allow a stroke outside
the selection. A preview returns exact changed channel values and skipped
cells. Protected cells are skipped during a brush operation and rejected
by the per-cell API on the protected bake. Undo and redo restore the
material and protection state through the same authoring transaction
history. Export a journal with `editor.exportSession()` and pass it
as the `session` option to reopen against the original bake.

The watch reads the visible, native-grid `sourceSurface` evidence.
`cellAt` gives the cell ID at each pixel and uses `-1` for pixels
outside the object or covered by another surface. The watch includes
pixel counts per visible cell, selected cells missing from the view,
and a mask for selected and protected pixels. A cell can occupy more
than one art pixel.

### Run an object texel session from the CLI

Create a version 1 `ink-studio/object-texel-source` JSON document. It
contains an `id`, a `mesh` with flat `points` and `triangles` arrays,
and optional `origin`, `resolution`, `material`, and `fallback`.
An optional `cells` array sets initial material values by ID, in the
same format as `editObjectTexels`. The session retains the source and
transaction journal in its checkpoint directory.

```sh
ink-studio pixel-art texels init lantern-session lantern.json
ink-studio pixel-art texels run lantern-session select.json
ink-studio pixel-art texels run lantern-session brush.json --out receipt.json
ink-studio pixel-art texels watch lantern-session views.json --out review
ink-studio pixel-art texels run lantern-session undo.json
```

Commands are the same JSON objects used by `editor.execute`.
An undo request is `{"op":"undo"}`. A watch request names its output
grid and views.

```json
{
  "format": "ink-studio/object-texel-watch",
  "version": 1,
  "w": 192,
  "h": 144,
  "views": [
    { "id": "front", "camera": { "yaw": 0.12, "pitch": 0.18 } },
    { "id": "turned", "poseYaw": 1.2, "camera": { "yaw": 0.24 } }
  ]
}
```

Each view writes a native PNG and a selection overlay. Read source cell
IDs and visibility counts from `watch.json`. The [Kite 07 example](../examples/object-texel-clusters.cjs)
shows the same cluster from three angles, protects small brass accents,
and verifies that undo restores every original render.

```sh
node examples/object-texel-clusters.cjs kite-07-review
```

## Filter coverage before palette lookup

Enable `look.coverageFilter` in a scene or pass `coverageFilter` in the
headless or WebGL render options. Four evenly spaced subpixel samples feed
each native art pixel. The renderer blends the shaded samples on the art
grid, then runs the native palette, tone, and dither resolve. A suitable
palette ramp gives partial coverage an intermediate swatch.

```js
look: {
  coverageFilter: {
    sharpness: 0.12,
    materials: {
      wire: 0,
      'printed-decals': 1,
      'cutout-grille': 0.22,
      'beacon-splats': 0
    }
  }
}
```

Sharpness ranges from 0 for the full four-sample filter to 1 for a hard
center sample on opaque geometry. Translucent contributions blend material
sharpness according to their opacity. Use the same material labels as the
indexed mesh material ID, an atlas chart’s `materialId`, the finite curve
appearance’s `material`, or `B.describeSplats`. Settings apply across
indexed faces, alpha-tested textures, atlas decals, finite curves, and native
splats. A sharp decal keeps its hard edges while filterable geometry around
it can pick up subpixel coverage. `true` uses the full filter everywhere.

The extra samples affect color and, in transparent headless exports, alpha.
Picking and diagnostic depth and identity stay at the native sample. The
headless filter supports up to four million native pixels. WebGL
uses the native palette path for ordinary views. Contribution-aware and
portable-stage resolves, water and glass views, portal captures, and live
Gaussian RGB or palette views use their existing resolve. The older WebGL
coverage vote is available when the filter is off.

The headless CLI accepts `--coverage-filter on|off|settings.json` for a side-by-side
render. The [Tidal Signal Bridge](../examples/coverage-filter.js) renders the
same camera move with center samples, full filtering, and tuned material settings.

```sh
node cli/ink-studio.js render examples/coverage-filter.js --w 240 --h 112 --px 1 --out signal.png
node examples/coverage-filter-review.js signal-coverage-review --hardware
```

## Vote by material ramp at splat seams

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
