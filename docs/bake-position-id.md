# Position and ID bakes

Add position or ID maps to a [bake preset](bake-jobs.md) to recover coordinates and categorical surface labels from a mesh's UVs. These maps are registered with the receiving mesh's coverage, including on clipped UV tiles and jobs that project detail from another mesh.

## Bake coordinate maps

| Map | Channels |
| --- | --- |
| `position-object` | Signed XYZ coordinates in the glTF mesh's local space. |
| `position-world` | Signed XYZ after the selected glTF node's full scene transform, including parent transforms. |
| `position-normalized` | Object XYZ mapped to [0,1] independently per axis across the entire mesh. An axis with zero extent maps to 0.5. |

Normalization uses the bounds of all indexed triangle vertices in the source mesh. Those bounds stay fixed when you filter primitives or bake another UV tile. The report records the source bounds. The position preview assigns X, Y, and Z to red, green, and blue. For object or world space the preview fits the selected coordinate space's bounds, while the OpenEXR keeps the original values.

If one scene node places the mesh, world position uses that node. If several nodes place it, select **World position node** in the workstation or use `positionNode` on the bake target. It accepts the zero-based glTF node index or a unique exact name. Meshes with no scene placement use their local coordinates for world position.

```json
{"id":"relay","mesh":"Relay plate","positionNode":"Station mount","tiles":[1001]}
```

## Bake categorical maps

| Map | Identity source |
| --- | --- |
| `vertex-id` | The corner of the original triangle with the greatest barycentric weight at the texel. Ties choose the lower ID. |
| `material-id` | The receiver primitive's material, shared wherever that material is assigned. Unassigned faces have a dedicated ID. |
| `part-id` | The receiver primitive, even when several primitives use the same material. |

IDs remain exact integers throughout the bake. The fallback IDs use original source order, before UV clipping and submesh filtering. For vertex fallback, primitives in one mesh that share a position accessor also share that accessor's vertex IDs. Generated IDs and swatches stay the same across tile, resolution, placement and preset changes. Author persistent IDs if your exporter may reorder or rebuild records:

- Use `extras.inkStudio.materialId` on a glTF material, or `extras.inkStudio.partId` on a primitive. `extras.inkStudio.partLabel` gives the primitive a label in the review.
- Use a scalar `_INK_VERTEX_ID` attribute for persistent vertex IDs. Use float32 exact integers or unsigned byte/short accessors. Split UV vertices can reuse an authored ID when they have the same object coordinates in the same mesh.
- Authored IDs range from 1 through 8,388,607, individually scoped to the map kind. Generated IDs occupy the upper half of the 24-bit range. Zero means empty.

A preview swatch is the low 24 bits of the ID multiplied by hexadecimal `9e3759`, laid out as RGB from high to low byte. This gives each ID its own reproducible swatch, even if the set of IDs on a tile changes. The report includes the number of IDs on each tile and up to 64 legend entries. Keep the ID data on nearest-neighbor sampling.

## Export and compare

Position maps use float32 OpenEXR planes X, Y, and Z. ID maps use a float32 OpenEXR Y plane with exact integer samples. Each has a separate PNG preview. Edge padding extends the nearest captured values without mixing IDs. Both raw formats store zero outside the padded charts. Bake `coverage` alongside position to distinguish a valid origin from unused space. Refresh the maps into material graphs as raw XYZ data or scalar ID data with nearest sampling.

```sh
node examples/bake-position-id/demo.cjs relay-demo
ink-studio bake-job serve relay-demo/station.bake.json --out relay-demo/live
```

Open `relay-demo/index.html` to inspect the same texel in two views. Compare the station and assembly bench placements, or switch between part and material IDs on the enamel relay.
