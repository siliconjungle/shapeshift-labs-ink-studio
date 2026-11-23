# Graph-editable signed-field sprite materials

`proc.fieldSprite` traces a bounded signed field at an orthographic pose.
It outputs the shaded sprite and aligned surface passes on its native art
grid. Its `materials` input accepts an ordered array of up to 16 prepared
slots. Each slot has its own texture, light response, and optional masks.

| Output | Meaning |
| --- | --- |
| `value` | Composited RGBA sprite. The JavaScript paint callback and default ink can both supply its base. |
| `depth` | The existing normalized ray-depth convention. |
| `normal` | The surface normal in the signed field's XYZ coordinate space. |
| `position` | The surface hit's XYZ position in the signed field's coordinate space. |
| `illumination` | The ambient and banded Lambert light value in [0, 1], before material shading. |
| `coverage` | 1 where the ray hits and 0 elsewhere. Use it to distinguish a missed ray from a position at the origin. |
| `materialId` | The top contributing slot index, starting at 1. Uses 0 for base ink and −1 for missed rays. |
| `surface` | A reusable trace containing base ink, bounds, positions, normals, illumination, and coverage. |

Use `proc.fieldSpriteShade` with the `surface` output to try different
materials with the same pose and lighting. It returns a new `value` and
`materialId` without evaluating the signed field again. A single trace
can feed several material variants at once.

## Build a material slot

Connect a raster to `proc.fieldMaterial.texture`, such as the output of
`draw.render` or a procedurally assembled grain map. Its default is a
solid neutral gray. Optionally connect a signed `mask` field, a
`maskTexture`, a palette or ramp, or any combination. A signed mask
selects hits at or below `options.maskLevel` (default 0). A positive
`maskFeather` softens the edge by that width in field units. The
mask texture uses the slot projection and contributes luminance times alpha. That weight combines
with the field mask, the color texture's alpha, and slot opacity.
Later slots paint over earlier ones. The sprite keeps the traced silhouette.

Choose `projection: 'cylinder-y'` for staves and hoops. Its U coordinate
wraps around Y with the seam on −Z, and V runs down from the top of the
bounds. Use `'xz'` for end grain. Other projections are `'xy'`, `'yz'`,
and the default `'triplanar'`, which blends the three planar samples by
the surface normal. The planar projections normalize to the field bounds.
XY and YZ put positive Y at the top, while XZ puts negative Z at the top.
Control UV repeats and registration with `scale` and `offset` as XY pairs.
The default nearest filter keeps texture details pixel-sharp. A
`linear` filter and per-axis clamp, wrap, mirror, or transparent addressing
are also available. Cylinder U wraps by default. Other axes clamp.

A material without a ramp multiplies the texture RGB by the adjusted
light `lightBias + lightGain × illumination`. With a ramp, its
coordinate is the adjusted light plus `textureGain` times the texture's
luminance offset from neutral gray. A palette, including
`palette.recipe.value`, gives crisp bands. Use a
`{ stops: [[0, color], [1, color]], interpolation: 'step' | 'linear' | 'smooth' }`
record for independently positioned stops.

To assemble slots in a graph, connect the material nodes to named inputs of
`data.record`, then use `data.collect` with those names in back-to-front
order. Connect its value to `proc.fieldSprite.materials` or
`proc.fieldSpriteShade.materials`.

```js
const {generator: G} = require('@shapeshift-labs/ink-studio').load().KIT.procedural;
const trace = G.fieldSprite(barrel, {width: 128, height: 146, orbit: [.5, .6]});
const wood = G.fieldMaterial({texture: grain, projection: 'cylinder-y', ramp: oak});
const hoops = G.fieldMaterial({texture: hammered, projection: 'cylinder-y', mask: bandField, ramp: iron});
const {value, materialId} = G.shadeFieldSprite(trace.surface, [wood, hoops]);
```

```sh
ink-studio graph describe proc.fieldSpriteShade --example > shade.json
ink-studio graph run shade.json --out shaded
node examples/field-sprite-materials.cjs ./cask-study
```

Open `cask-study/index.html` for one turntable with independent wood and
metal edits, plus the position, illumination, and material-slot passes.
