# Sprite-based object reconstruction

One directional atlas can stand in for many copies of a native object. Each copy uses its own world position, yaw, scale, animation clock and distance to the camera. Close views draw the named native splats. Distant views draw an atlas view with per-texel depth. The WebGL renderer submits one quad per distant object, plus a quad when a cel has a separate effect layer.

Open [Signal Transit](../examples/sprite-reconstruction.html) after building the library and demo atlases and serving the repository over HTTP.

```sh
npm run build
node examples/bake-sprite-reconstruction.cjs
```

**Signal Approach** flies into a terminal with a fleet of shared courier and beacon assets. **Courier Bay** lets you orbit a single animated courier. Use the slider to enter the transition band or choose Sprites or Geometry to inspect either representation at the same camera position.

## Bind a reusable asset

Bake an isolated copy of the object with the [directional atlas exporter](art-passes.md#directional-sprite-atlas), or load an existing [impostor atlas](impostor-atlases.md).

```js
const ink = require('@shapeshift-labs/ink-studio');
const { KIT: K } = ink.load();
const sprites = K.sprite.reconstruction;
const courier = sprites.asset({
  atlas: ink.readSpriteAtlas('courier/atlas.json'),
  range: [8, 13]
});

// Name the full-detail splats in the scene bake. The anchor is the atlas pivot in scene space.
sprites.bind(world, [
  { asset: courier, object: 'courier-a', at: [-2, 1.5, 0], playback: 'loop' },
  { asset: courier, object: 'courier-b', at: [2, 1.5, -5], yaw: .35, scale: .85, frame: 0 }
]);
```

`asset` accepts either a compiled `K.sprite.atlas` or its source with `metadata` and RGBA `images`. Each view can contain at most 262,144 pixels. `range` holds the near and far distances in scene units. `bind` attaches up to 128 placements and replaces a previous binding. Pass an empty list to remove it. `object` matches a native object name from builder metadata, for example through `B.describeSplats(..., {object})` or a sculpt's `objectId` option. Every placement has a distinct name.

Bake the near geometry at the same `at`, `yaw` and `scale` as the atlas placement. If `at(time)` moves the pivot, animate the full-detail object to match. `frame` also accepts a callback, and `playback` accepts the existing atlas time modes. Synchronize any native animation to the atlas bake's sample times. The closest baked heading and elevation are used while the atlas is active. More views reduce changes between neighbouring silhouettes.

## Render and inspect the handoff

The transition follows a smooth distance curve between the two endpoints and uses complementary coverage on the art pixel grid. Native geometry and sprites never claim the same transition pixel for a placement. A mismatch between the two silhouettes can still be visible, so keep the pivot, scale, views and animation in register. Orthographic camera setback is removed from the distance calculation.

Both renderers accept `spriteReconstruction: 'auto' | 'geometry' | 'sprite'` on a frame. The default is `'auto'`. The CLI accepts the same modes with `--sprite-reconstruction` for scenes that bind the asset in their build function. A frame callback `spriteReconstructionFrame(report)` exposes the distance, native coverage share and selected atlas view for each object. `geometryRows` counts native rows eligible for submission, before ordinary viewport culling and draw budgets.

Depth, alpha, baked or additive emission, normal maps, and edited cels come from the atlas. Set a placement's `depth`, `lighting`, or `emission` flag to control use of its maps. A scene's optional live sun can shade sprite normals. The WebGL picker uses the same depth and coverage as the drawing and reports the same named object. Use scene colliders or shadow proxies wherever those have to stay independent of the displayed representation. This API binds native splat rows and lives on the runtime world built by JavaScript.

For lace and foliage, enable [cutout coverage mipmaps](impostor-atlases.md#cutout-coverage-at-a-distance)
in the atlas manifest. The same registered level is used for color, depth,
and picking throughout the reconstruction pass.

## Mixed representations on one asset

Use `bindParts` for an object with independently rendered parts. Each
part has one canonical material and an optional distant sprite. Build
the near parts using their native APIs and give them the same object,
part, and material labels as the binding. When an asset has several
materials, author one bound part for each region that needs its own
material assignment in the distant view.

```js
const object = 'lantern';
const shell = K.sceneMeshes.create({
  id: 'lantern-shell-draw', objectId: object, partId: 'shell',
  positions, indices, uvs,
  materials: [{ id: 'enamel', texture }]
});
K.curveSplats.draw(B, cablePath, {
  object, material: 'copper', target: { part: 'cables' },
  color: '#e2aa72', width: .12, edge: 'hard'
});
const first = B.count();
// Add the glow splats to B.
B.describeSplats(first, B.count(), {
  object, material: 'mint', target: { entity: object, part: 'halo' }
});
const world = B.finish({ meshes: [shell] });
const sprites = K.sprite.reconstruction;
const distant = (atlas, range) => ({ asset: sprites.asset({ atlas, range }), at: [0, 1.4, 0] });
sprites.bindParts(world, [
  { object, part: 'shell', material: 'enamel', representation: 'mesh', mesh: shell,
    sprite: distant(shellAtlas, [9, 13]) },
  { object, part: 'cables', material: 'copper', representation: 'curves',
    sprite: distant(cableAtlas, [7.6, 11]) },
  { object, part: 'halo', material: 'mint', representation: 'splats',
    sprite: distant(haloAtlas, [6.4, 9.8]) }
]);
```

A mesh binding refers to a mesh in `world.meshes`. Its mesh draw ID
identifies the submission and its `objectId` and `partId` identify
the asset. Curve and splat bindings select authored rows by the
object and part labels. Each fallback atlas uses the same labels as
its source part and requires an anchor in the same coordinate space.
Leave out `sprite` to keep a part native at every distance. Parts
can share an object ID and have different handoff intervals.
Whole-object bindings can coexist on other objects.

Both renderers apply a complementary native-grid coverage pattern
during each handoff. A distant mesh part leaves the mesh draw list.
Distant curve and splat rows leave their native submission. The
sprite atlas provides the distant material's baked appearance,
coverage, and optional depth and normal maps. The headless buffers
and browser ray picks preserve the object, part, and material
labels. Soft pixels follow their usual depth ownership rule.
The frame report includes the representation, part, material,
native coverage share, and selected sprite view for each binding.

The [Brine lantern scene](../examples/part-representations.js) bakes
the three atlases from their original native geometry.

```sh
ink-studio passes examples/part-representations.js \
  --channels opaque-surface,partId --t 1.6 --w 244 --h 160 --px 1 --px1 --out lantern
ink-studio surface-pixel examples/part-representations.js \
  --at 122,78 --t 3.2 --w 244 --h 160 --px 1
```

Use `--sprite-reconstruction geometry` or
`--sprite-reconstruction sprite` for fixed-camera comparisons.
