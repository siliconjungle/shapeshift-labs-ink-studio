# Bake curves to ribbons and cards

Bake a braid, reed bundle, or tangle from its finite curve rows. The output
is a standard directional sprite atlas plus a registered coverage PNG. One
view can also become a textured ribbon mesh in the same coordinate system.
Both representations use the baked silhouette and depth.

```sh
node scripts/build.js node
node cli/ink-studio.js curve-bake examples/curve-splat-scene.json \
  --object gold-spline --directions 8 --normals on --out gold-spline
```

Use `--object` and `--part` to isolate authored rows. Omitting both bakes
all finite curves in the scene. The bake fits orthographic views around the
selected spans with pixel padding. `--w`, `--h`, `--yaw`, `--pitches`,
`--pivot`, and `--pad` control framing. `--t` samples one time, including
curve reveals and trails. The Node API starts from the current native rows.
The bake isolates curves from surrounding props and scene media.

| File | Contents |
| --- | --- |
| `atlas.json` | Standard view rectangles, world pivot, pixel scale, depth range, and versioned curve bake settings |
| `color.png` | Straight RGBA with the combined strand color and alpha |
| `coverage.png` | Color alpha as a separate grayscale mask |
| `depth.png` | RGB24 camera-axis distance for the foremost contributing curve fragment, including soft pixels |
| `normal.png` | Optional view-space signed normals at the registered depth samples |

A card stores one depth sample per pixel. At translucent crossings its
color can include several strands, and the depth represents the front
contribution. The normal map marks texels with an available analytic normal.

## Use the ribbon as native geometry

```js
const ink = require('@shapeshift-labs/ink-studio');
const { KIT: K } = ink.load();

const bake = ink.bakeCurves(world, {
  object: 'woven',
  part: 'stem',
  normals: true,
  ribbon: { view: 0, alphaCutoff: 0.5, depthTolerance: 0.02 }
});

const restored = ink.readSpriteAtlas('woven/atlas.json');
const { mesh } = K.curveSplats.bakedRibbon(restored);
ribbonScene.meshes = [...(ribbonScene.meshes ?? []), mesh];
```

`bake.ribbon.mesh` gives the same native mesh directly. The ribbon joins
covered texels into UV-mapped strips along the long axis of the chosen
view. It splits at holes and depth discontinuities and fits each strip
within `depthTolerance` at the source texel centers. The mesh uses
cutout coverage and can use tangent-space normals converted from the
baked view. It is a relief of one baked view. Use the directional card
when a camera needs to select from several sides.

Set `--ribbon-view`, `--alpha-cutoff`, or `--depth-tolerance` to change the
stored ribbon recipe. `axis: 'x' | 'y' | 'auto'` also works in the Node or
runtime API. Use `--ribbon off` for a card bake.

## Bind the middle-distance card

Use the existing distance handoff with the same object, part, and
material as the native geometry.

```js
const cards = K.sprite.reconstruction;
cards.bindParts(world, [{
  object: 'woven',
  part: 'stem',
  material: 'reed',
  representation: 'curves',
  sprite: {
    asset: cards.asset({ atlas: restored, range: [8, 11] }),
    at: restored.snapshot().metadata.pivot,
    lighting: false
  }
}]);
```

A part with several material identities can bake and bind each material
as its own part. The near geometry and card use complementary art-pixel
coverage during the handoff. Use `spriteReconstruction: 'geometry'`
and `'sprite'` to compare the two at a fixed distance.

## Review the braid and reeds

```sh
node cli/ink-studio.js curve-bake-review --hardware --out out/curve-bake-review
```

The review saves paired WebGL and headless renders of finite curves,
ribbons, and cards, and three distances through the automatic handoff.
The pale crosspiece intersects the strand depths. Both reusable atlas
folders include the coverage, depth, and normal maps.
