# Surface decals

Use one versioned surface decal document for painted graphics, lettering,
scuffs, and projected relief. Each decal has a stable ID, an object and
optional part ID, a part-local projector, and a lifetime in render seconds.
The receiver can change from an indexed mesh to a signed-distance field or
a splat cloud while retaining the same decal document and clock.

```js
const decal = {
  id: 'inspection-orange',
  kind: 'paint',
  anchor: {
    object: 'survey-pod', part: 'case',
    node: 'pod', socket: 'front',
    at: [0, 0.1, 0.46], normal: [0, 0, 1], up: [0, 1, 0],
    size: [0.5, 0.3], depth: 0.18
  },
  image: { width: 1, height: 1, pixels: [238, 144, 69, 255] },
  lifetime: { start: 0.4, end: 6, fadeIn: 0.2, fadeOut: 0.8 }
};
const document = K.surfaceDecals.create({
  format: 'ink-studio/surface-decals', version: 1, decals: [decal]
});
```

The projector is centered at `at`. `normal` points out of the surface,
`up` orients the top of the artwork, and `size` is width and height in scene
units. `depth` is the search distance on either side of the projector. The
optional `grid` pair sets the number of conforming cells, defaulting to
12 by 12. Use more cells around curved patches and raised detail. The
`anchor.maxStep` distance controls where triangles stop across discontinuous
surface depths. Cells with missing support are clipped at the sampled
triangle boundaries.

Supply top-down RGBA8 pixels as a flat array, up to 256 × 256. Use
`kind: 'lettering'` for lettering artwork and `kind: 'scuff'` for wear or
impact graphics. Alpha, optional overall `opacity`, and lifetime fades use
a stable cutout pattern in texture space. An optional `mask` is a flat
array with one alpha byte per image pixel. Ink multiplies the image alpha
by the mask before applying opacity and fades. With `kind: 'relief'`, supply
`relief: { height, heights? }` where `height` is the maximum outward
displacement in scene units. The optional grayscale byte raster matches
the color image dimensions. Image alpha supplies height when that raster
is omitted. The relief displaces the decal's render geometry. It leaves
the receiver's collision and source geometry under the receiver's control.

## Edit a decal layer

Add the version 1 decal document as `surfaceDecals` on a JSON diorama.
A rest projector names its receiving solid's stable ID in
`anchor.object`. Include `anchor.part` to check the receiver's rig part.
The projector uses the diorama's rest coordinates and follows the part's
animated pose. The diorama binds its splat receivers automatically.
A diorama also binds editable mesh receivers by object and optional part ID.
Mesh decals can use a rest projector or UV rectangle. Use native receiver
bindings for node and socket anchors.

In the pixel document, add a `decal-layer` destination and link it to an
existing scene binding for the receiving solid. A surface layer can point
to that destination:

```json
{
  "destinations": [
    { "id": "label-edit", "kind": "decal-layer", "binding": "gate", "decal": "warning-label" }
  ],
  "layers": [
    { "id": "label", "kind": "surface", "destination": "label-edit" }
  ]
}
```

Use `pixel-art targets --destination layer:label --scene gate.json` on the
pixel document to inspect the anchor, lifetime, and source revision.
Apply an edit using the regular pixel document revision, frame, and
optional inspected source revision. Use `"destination": "layer:label"`
to respect the layer's lock.

| `operation.type` | Fields |
| --- | --- |
| `move` | `delta` in rest-space XYZ. The native API also accepts a two-component delta for a UV decal. |
| `mask` | `mask` with one alpha byte per image pixel. Use `null` to clear. |
| `replace` | Top-down RGBA `image` with `width`, `height`, and `pixels`. When resizing, supply a matching mask or clear it with `"mask": null`. |
| `bake` | Flattens the mask into the current decal texture. Add `"source": "frame"` to bake the selected pixel frame's composite and apply the decal mask. The frame must fit within 256 × 256. |

The texture bake keeps the decal ID, projection bounds, and lifetime.
The saved layer continues to follow its receiver and fade on the scene
clock. A shared pixel edit session can undo or redo the source edits
alongside changes to the artwork. Preview and replay use the same
revision checks as other bound edits.

For a standalone decal document, use
`K.surfaceDecals.edit(document, decalId, operation)` and bind the returned
document to a receiver. To bake a new raster at the same anchor, pass the
RGBA `image` to the native bake operation.

## Bind and switch receivers

```js
const ids = { object: 'survey-pod', part: 'case' };
const binding = K.surfaceDecals.bind(world, document, {
  graph: world.sceneGraph,
  receivers: [
    { ...ids, representation: 'mesh', mesh },
    { ...ids, representation: 'sdf', field: { distance: sculpt.sdf } },
    { ...ids, representation: 'splats', source: restCloud, bias: 0.025 }
  ]
});

// Invoke alongside the host's geometry switch.
binding.use('survey-pod', 'case', 'sdf');
const { report } = binding.sample(1.9);
```

- **Mesh** rays land on the mesh's rest triangles. The retained barycentric
  coordinates follow changes made by `K.sceneMeshes.pose` or skinning. Use
  the same rest coordinate system for the mesh and the projector. The
  mesh's live vertices supply the world pose.
- **SDF** rays land on the outward surface of a signed-distance field. The
  field can be an object with `distance(x, y, z)`, a provider returning one,
  or an editable field handle with `current()`. A new field snapshot
  reprojects the decal. A node or socket supplies the world pose.
- **Splats** rays use the contribution picker on matching object and part
  rows in the rest cloud. Pass a part-local baked `source` when its live
  world placement differs from the projection coordinates. For an unposed
  cloud the bound world can supply the rest rows. A node or socket moves
  the decal with rigidly posed splats.

The first registered receiver for a part is active until `use` changes it.
Passing `false` to `use` hides that part's decals. Reusing a receiver
keeps its projected grid. Call `invalidate(object, part, representation)`
after a rest source is edited in place. Use a small positive `anchor.bias`
or an additional receiver `bias` to resolve near-coplanar depth, especially
on softly sampled splat surfaces. Depth and front-face tests keep graphics
on the visible side of the part and behind foreground geometry. Removing
or hiding an anchor node hides its decals.

Headless and WebGL rendering sample the same binding. Headless can render
the SDF receiver directly with [SDF assist](sdf-assist.md). In WebGL a decal
can project against an SDF while its host is drawn with its mesh or splat
carrier. Set `surfaceDecals: false` on a render frame or pass
`--surface-decals off` in the CLI for an undecorated comparison. Existing
`paint` and `paintCorrections` layers remain editable through their current
workflows.

Run `node examples/surface-decals.js <directory> --frames` for the Aster
survey pod demo. The output includes the portable decal document, a report,
and renders of the moving part switching from mesh to SDF to splats. The
scuff expires while the painted lettering and raised badge stay attached.

## Retained pixel brushes

Use `K.surfaceDecals.fromBrush` to place an
[indexed pixel tip](pixel-art-authoring.md#capture-and-reuse-a-pixel-brush).
The returned decal carries the tip's colors, holes, and offset from its
anchor. Add it to a version 1 surface decal document and bind the receiver
as above.

```js
const patch = K.surfaceDecals.fromBrush({
  id: 'jacket-patch',
  tip,
  anchor: { object: 'courier', part: 'coat', material: 'cloth', uv: [.42, .63] },
  pixelSize: [.011, .014]
});
```

For a native mesh, `anchor.uv` locates the brush anchor in the mesh's
top-down UVs. `pixelSize` measures one resized tip pixel in UV units.
The brush is clipped to the receiver's triangles and follows their
barycentric positions through posing or skinning. Overlapping UVs share
the mark on the selected material. Use the optional `material` to scope
a stamp when several materials reuse the same UV range. A UV decal is
visible while its mesh receiver is active.

For rest-space projection, supply `anchor.at`, `anchor.normal`, and an
optional `anchor.up`, `depth`, and node or socket. `pixelSize` is then
measured in scene units. The existing conforming projector follows posed
mesh triangles, reprojects when an SDF snapshot changes, and supports
rigid node or socket attachments on splat receivers.

## Control projection and chart padding

For a rest projector, set `anchor.minFacing` to the minimum cosine
between the projector's outward normal and the receiving normal. The
default is `0.25`. Larger values reject grazing surfaces. An explicit
facing threshold on a splat receiver requires recorded surface normals.
`anchor.depth` limits how far on either side of the rest projector Ink
searches for a surface. `anchor.maxStep` limits how far neighboring
samples can separate in that direction before triangles are clipped.

For a mesh UV decal or brush, supply the receiving atlas rectangle and
its reserved margins in `anchor.chart`.

```js
const chart = { min: [0.25, 0], max: [0.5, 0.5], padding: [0.01, 0.015] };
```

The padding is measured in mesh UV units on each side. Ink clips the
decal to the writable portion of that rectangle and keeps the brush's
original UV registration through clipping and skinning. The mesh's
material selector is also available when multiple materials share UVs.

## Place a decal on a named face

A sign, repair, stain, or wear layer can name an editable mesh face in
`anchor.face`. Ink clips the projected decal to that face, including when
other faces share the same material and atlas crop. A decal is placed
once across the receiver. The brick or trim under it can still use
[`tileset wrap`](mesh-uv.md#repeat-a-crop-on-one-face).

```json
{
  "id": "pump-label",
  "kind": "lettering",
  "anchor": {
    "object": "cistern-wall",
    "part": "masonry",
    "face": "straight-run",
    "at": [-0.4, 0.2, 0],
    "normal": [0, 0, 1],
    "size": [1.9, 0.75],
    "depth": 0.1,
    "bias": 0.008
  },
  "grid": [16, 10]
}
```

Use the scene's rest coordinates for the projector, including the placed
rest transform of a prefab receiver. A UV anchor with a face ID uses the
receiver's authored UVs before texture repetition. A UV decal is useful
when the receiver has a suitable chart. The rest projector is useful
when the underlying atlas has a collapsed or shared UV axis.

```sh
ink-studio tileset decal sign.json --scene wall.json --image sign.png --preview review --view camera.json > receipt.json
ink-studio tileset decal sign.json --scene wall.json --image sign.png --expect receipt.json --out signed-wall.json
```

Use an inline RGBA image or supply a PNG with `--image`. The preview
writes `before.png`, `after.png`, and `depth-conflicts.png` at the same
native resolution. The optional view file sets `w`, `h`, `t`, `camera`,
`raw`, and `depthTolerance` in scene units. The report counts projected
and visible pixels, identifies foreground blockers, and flags samples
close to the depth of another layer. It also reports visible pixels
with no opaque scene depth behind them. An expired or out-of-frame
layer may have zero projected pixels.

Place each layer with its own small bias. Overlaps follow scene depth,
with the earlier decal taking an exact depth tie. An object in front
can still hide the decal. The SDK exposes
`editor.planSurfaceDecal(decal)` and `editor.addSurfaceDecal(decal)`.
Each placement is one undo and works with the existing move, mask,
replace, bake, and lifetime controls.

Run `node examples/tileset-pick/wrapped-surface-decals-demo.cjs decal-review`
for a layered pump wall with a foreground pipe and a coplanar test.
