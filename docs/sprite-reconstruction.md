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
