# Bake projection controls

Bake high-detail geometry into the UVs of an existing low mesh. A bake job's `source` and target selectors choose the low mesh, submeshes, slots, UV set and tiles. Add named GLB or glTF files to `projectionSources` for the high geometry and optional cage. Open a target's **Projection** section in the [bake workstation](bake-jobs.md) to edit its controls. Choose **Low mesh · self-bake** to use the receiver's own appearance at zero projection distance.

```json
{
  "format": "ink-studio/bake-job",
  "version": 1,
  "label": "Vesper Gate",
  "source": "low.glb",
  "projectionSources": {"detail": "detail.glb", "cage": "cage.glb"},
  "skewMaps": {"rim-ramp": "skew.png"},
  "targets": [
    {
      "id": "plate",
      "mesh": "Vesper_low",
      "tiles": [1001],
      "projection": {
        "mode": "project",
        "high": "detail",
        "match": "name",
        "lowSuffix": "_low",
        "highSuffix": "_high",
        "front": 0.235,
        "back": 0.06,
        "units": "scene",
        "normals": "average",
        "backfaces": "ignore",
        "skew": "rim-ramp",
        "invertSkew": false
      }
    }
  ]
}
```

## Choose which geometry receives or contributes

- Set `mode` to `project` and `high` to a projection source ID, or use `"$receiver"` to pick high meshes in the receiver file. Use `{"mode":"self"}` for an explicit self-bake. An omitted projection preserves the regular direct bake.
- `match: "all"` uses the high scene's active meshes. `match: "selection"` uses the high `mesh` index or unique exact name. `match: "name"` matches case-sensitive mesh names after stripping the configured `lowSuffix` and `highSuffix`. A nonempty suffix has to be present at the end of its name. Use empty suffixes for an exact match. Matching filters geometry before rays start, so rejecting a neighboring mesh leaves it out of the cast.
- Projection resolves active scene transforms before testing distances and normals. Use one scene placement for a selected low mesh and cage. Mesh definitions without a placement use their stored coordinates. The job workflow uses static triangulated glTF geometry and PNG source textures. [The retained cage CLI](registered-material-bake.md) also supports its existing Ink geometry, signed field and scan-proxy source plans.

## Shape the rays

| Control | Behavior |
| --- | --- |
| Front and rear | Start `front` units above the surface and stop `back` units below it. A hit above the surface has positive signed relief. Default reach is 0.1 front and 0.05 rear. |
| Distance units | `scene` uses transformed scene coordinates. `bounds` multiplies each distance by the longest axis of the selected low surface's scene-space bounding box. |
| Ray direction | `authored` uses interpolated low normals, or the face direction when normals are absent. `average` computes area-weighted normals at coincident receiver positions across selected primitives. `face` sends rays perpendicular to each face. These options steer projection. The baked tangent frame still uses the receiver's authored shading normals. |
| Explicit cage mesh | Set `"cage":{"source":"cage","mesh":0}`. Corresponding cage vertices define the ray start. The low surface is its endpoint. Each selected primitive needs corresponding vertex order and identical triangle indices, and cage vertices must sit outward from the receiver. A single mesh cage can omit its mesh selector. Otherwise the fallback is the matching low mesh name. |
| Backfaces | `ignore` skips a backface and continues to the next hit. `block` stops projection at that surface and keeps the low material. `accept` transfers the first visible surface of either winding. The diagnostic records encountered backfaces even when an ignored face has a valid hit behind it. |
| Skew and invert | A grayscale PNG uses black for the averaged normal and white for the authored normal. Values in between blend the ray direction. `invertSkew` flips the weight. Skew steers distance-based projection. The explicit cage supplies its own directions. |

A skew map can be one PNG across the target tiles, or an explicit set such as `{"tiles":[{"tile":1001,"file":"skew.1001.png"}]}`. Ink samples the red lane as linear weights over the baked UV tile with bilinear filtering. A tile entry accepts a UDIM or a signed UV pair. Relative paths resolve from the job file. The black-to-white skew convention and suffix matching follow the documented authoring conventions. [Adobe common bake parameters](https://experienceleague.adobe.com/en/docs/substance-3d/bakers/bakers-settings/common-parameters)

## Inspect a bake

Projection transfers pigment, normal, roughness, metalness, emission and opacity. Misses and blocked hits keep the low material. Coverage and geometry-probe maps describe the low mesh. Enable `cage-hit`, `cage-miss`, `cage-backface`, `cage-distance`, or `cage-relief` in the job preset. The signed relief PNG uses midpoint gray for zero offset. The report gives the scene-unit distance scale, the matched meshes, and hit counts. A ray blocked by a backface appears in the backface map instead of the miss map.

```sh
node examples/bake-projection/demo.cjs vesper-gate
ink-studio bake-job serve vesper-gate/vesper.bake.json --out vesper-gate/review
```

Open `vesper-gate/index.html` to compare the same UV tile side by side. The all-mesh projection picks up a neighboring magenta bracket. Name and suffix matching isolate the brass dial. Toggle maps to compare the short-reach bake, explicit cage, skew and inverted-skew variants, and the backface policies.
