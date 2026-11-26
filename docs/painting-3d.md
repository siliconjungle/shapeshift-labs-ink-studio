# Retain and edit a 3D painting

Store a 3D painting as an ordered collection of shaped marks. Each mark retains its brush, pressure poses, material, transform, attachment, and place in the order. Use the same document in another scene by rebinding its attachment slots.

```sh
ink-studio painting-3d plan base.json placement.json
ink-studio painting-3d apply base.json placement.json --out painted.json
ink-studio painting-3d update painted.json edit.json --out revised.json
ink-studio painting-3d inspect revised.json
ink-studio painting-3d extract revised.json --id detail --out painting.json
ink-studio render revised.json --ortho --out revised.png
```

A placement looks like this.

```json
{
  "id": "detail",
  "bindings": { "panel": "door-front" },
  "painting": {
    "format": "ink-studio/painting-3d",
    "version": 1,
    "id": "door-trim",
    "marks": [{
      "id": "pinstripe",
      "brush": { "kind": "sphere", "radius": 0.045 },
      "poses": [{ "point": [-0.4, 0.25, 0.5] }, { "point": [0.4, 0.25, 0.5] }],
      "mat": "metal",
      "attachment": {
        "kind": "surface", "slot": "panel",
        "snap": { "mode": "surface", "maxDistance": 0.5, "direction": [0, 0, 1], "offset": 0.01 }
      }
    }]
  }
}
```

| Attachment | Where authoring coordinates land |
| --- | --- |
| `free` (default) | Scene rest coordinates. |
| `surface` | The named receiver's local rest coordinates. The sweep projects onto its field after sculpt modifiers and follows the receiver's transform and rig part. Use the [sweep snap settings](sculpt-snaps.md) to project all poses or anchor the root. |
| `part` | Scene rest coordinates for the named sculpt rig part. Its posed transform carries the mark at playback, even when the mark sits away from the geometry. |

Both the placement and each mark can supply `transform` with `position`, quaternion `rotation` and scalar or XYZ `scale`, or `position` and a 3×3 `matrix`. Ink applies the mark transform first, then the placement transform in the attachment's coordinate system. Surface snap directions use the receiver's rest axes. The plan and inspect reports include resolved IDs and projection contact counts. Invalid bindings or snap misses reject the request before it writes anything.

Marks use native [sweep brushes and pressure poses](sculpt-sweeps.md). They render and export as ordinary 3D sweeps with addressable IDs such as `paint.detail.pinstripe`. Later marks take precedence on coincident paint surfaces in the same rest space. Geometry depth controls occlusion during rendering. Give a surface mark a little relief to keep its color visible above the receiving surface. `mat` uses the destination scene's palette roles or a native material definition. Define the same roles in a new scene when you want consistent colors. Extraction returns the portable painting and keeps bindings and placement transforms in the scene.

[Custom mark profiles](mark-profiles.md) set the silhouette, coverage, spacing, grain, and relief. Name profiles in the painting to reuse them across marks.

[Paint looseness](paint-looseness.md) adjusts dab size, spacing, displacement, and outline variation in a selected interior, with an explicit silhouette allowance for surface-bound marks.

[Comb and ruffle retained marks](mark-direction.md) to align their brush tips with a surface direction field and vary the angle independently.

[Align retained marks to a grid](mark-grid.md) to snap dab centers to a tangent or UV lattice, or snap headings relative to a surface direction.

[Paint relief](paint-relief.md) lets a retained stroke act as flat pigment, a shading ridge or groove, or finite raised or cut volume.

[Brush presets](paint-presets.md) apply several style channels together. Each stroke can override any channel independently.

[Finish paint](paint-finish.md) layers tint, hue, roughness, coating, and emission over the receiver material. Emissive marks can also opt into nearby light spill.

## Dabs, pressure, and ruled strokes

Use one pose for a precise dab or multiple poses for a stroke. Both use the same brush, quaternion orientation, pressure, and edit operations. Set `path: "ruled"` to lay the recorded poses along a straight line between the first and last points. Ink distributes the poses along the line by their original spacing along the stroke. A surface-bound mark rules the guide before projecting it onto the receiver.

Set `pressureResponse` to control width and opacity independently. Each pair gives the response at pressure 0 and 1, with linear interpolation between them.

| Setting | Result |
| --- | --- |
| `{ "opacity": [0, 1] }` | Fixed brush size and a fade from no paint to full coverage. |
| `{ "width": [0.3, 1.4] }` | Scales the brush from 30% to 140% at full opacity. |
| `{ "width": [0.4, 1.2], "opacity": [0.1, 0.9] }` | Both channels use the recorded pressure. |

Width ranges accept 0–4 and opacity ranges accept 0–1. A missing channel defaults to 1 when a response is supplied. For these mappings, pressures above 1 use the high endpoint. Marks without a response retain the original 0–4 pressure-to-scale behavior. Ink composites translucent marks over the receiver in its render and exports them as separate blended geometry in GLB.

Use a mark's `set` edit to replace `pressureResponse` or switch `path` between `"free"` and `"ruled"`. These edits keep the original poses, including pressure and orientation, in the painting and its extracted JSON.

```sh
node examples/paint-mark-pressure-demo.cjs /tmp/ink-paint-mark-pressure
```

An update can change a placement's `bindings` or `transform`, replace its `painting`, or apply an ordered `edits` array. `set` patches a mark, `move` places it `before` another mark or at the end, `add` appends a new mark, `remove` deletes one, and `apply-preset` changes its style channels together. Set `enabled` to `false` to keep a mark available for later revisions. The scene retains the placement under `paintings3d`. Save beside the source file to preserve relative asset paths.

```json
{
  "id": "detail",
  "edits": [
    { "op": "set", "id": "pinstripe", "patch": { "mat": "ember" } },
    { "op": "move", "id": "pinstripe" }
  ]
}
```

For automation, the headless scene editor provides `planPainting3d`, `applyPainting3d`, `inspectPaintings3d`, and `extractPainting3d`. Pass `{ update: true }` to plan or apply an edit. Applying a placement or edit creates an undoable transaction.

```sh
node examples/painting-3d-demo.cjs /tmp/ink-painting-3d
```
