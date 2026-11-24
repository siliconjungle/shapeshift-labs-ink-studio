# SDF-assisted rendering

SDF assist uses the original sculpt to determine opaque coverage, depth and normals at the art-pixel grid. Baked splats provide surface color. When their footprints miss a point on the surface, the nearest compatible splat on that sculpt part supplies its color. The normal compositor draws foreground marks and transparent effects over the traced surface in depth order.

The mode is opt-in in the headless Node and CLI renderer. It supports finite static sculpts and, with the posed option, affine-skinned opaque parts. See [native hero rendering](hero-render.md) for the posed path, traced fill and native reference fitting. Retained fields are live scene data. Rebuild the authored scene when replaying a shot or changing the geometry.

The [offline SDF reference](sdf-reference.md) traces light through the retained geometry for a side-by-side review.

## Enable on a sculpt

Set `S.keepRenderSdf = true` before baking the sculpt. Use `look.sdfAssist` in `B.finish()` for its default render mode, or pass `sdfAssist` as a Node render option. JSON dioramas keep the source automatically when `finish.look.sdfAssist` is enabled.

```js
S.keepRenderSdf = true;
S.box([0, 1, 0], [2, 1, 0.2], {
  r: [1, 2, 3], materialId: 'sandstone'
}, { res: 0.25, objectId: 'gatehouse' });
S.bake();

const world = B.finish({
  cam,
  look: { sdfAssist: { rules: [{ select: { object: 'gatehouse' } }] } }
});
```

In the CLI, use `--sdf-assist on` to retain and render eligible static sculpts in a scene build. Use `--sdf-assist posed` to include eligible rig parts, or `off` to compare the splat-only result. Pass a JSON settings file for a scoped capture.

```json
{
  "rules": [
    { "select": { "object": "ironwork" }, "enabled": false },
    {
      "select": { "material": "sandstone" },
      "bounds": { "min": [-3, -1, -2], "max": [0.35, 4, 2] }
    }
  ]
}
```

Rules match in order. Each rule can use any existing target selector, a world-space XYZ box, or both. Overlap between rules is resolved by the first match. With omitted rules, the mode covers all eligible retained geometry. The optional `epsilon` and `steps` settings control the surface tolerance and the maximum work per ray through each bake.

## Review the gatehouse

```sh
node cli/ink-studio.js render examples/sdf-gatehouse.js \
  --w 224 --h 144 --px 1 --raw --sdf-assist off --out gate-splats.png
node cli/ink-studio.js render examples/sdf-gatehouse.js \
  --w 224 --h 144 --px 1 --raw --out gate-sdf.png
node cli/ink-studio.js render examples/sdf-gatehouse.js \
  --w 224 --h 144 --px 1 --raw --sdf-assist region.json --out gate-region.png
```

The authored comparison covers the gatehouse sandstone. Its arched cut remains open, and lantern washes retain their splat color. The standard depth, coverage, position, normal, object ID and material ID passes report the traced surface. Tracing costs additional render time and still needs painted samples on each visible side of the sculpt.

[Editable brick meshes](brick-meshes.md) also support headless tracing.
The same object, material, and bounds rules select the current signed
brick field for close-ups. The affected mesh samples yield to the
trace while other parts of the scene use their cached geometry.
