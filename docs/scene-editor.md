# Headless scene editor

Open a JSON diorama with `studio.createSceneEditor(source, options)` in Node or `KIT.authoring.sceneEditor.create(source, options)` in the bundled toolkit. The source can be a parsed object, a JSON string, or a baked diorama with its source attached. Pass `env` with the same assets as `KIT.diorama.build` when the scene uses meshes. Set `historyLimit` to bound the number of undo steps.

`snapshot()` returns the current immutable diorama. `serialize(space)` produces the same JSON that `ink-studio validate` and `ink-studio render` accept. Keep relative asset files in the same location relative to the saved scene. `build()` bakes the current state for preview or picking.

Open a [project bundle](project-bundles.md) with `project.editor()` to resolve its files from the bundle. `project.withScene(editor.snapshot())` creates a revised project with the same retained resources.

## Incremental baking

The editor keeps a bounded cache of mesh distance fields, supported solids' sampling points, and complete static splat bakes. A camera-only edit can reuse all packed splats. A geometry or material edit can reuse unaffected inputs while the sculptor recomputes blending, visibility, and shadows. Decoded imported image pixels are shared by content across portable asset recipes. Moving parts, effects, retained render SDFs, and paint corrections use their existing bake paths.

Use `editor.buildIncremental(previousWorld, inputs)` to obtain `{ world, frame }`. Pass both to `renderer.render(world, { ...frame, ...view })`. The WebGL renderer patches changed splat, fine detail, and pattern rows when the supplied previous world is the bake it last uploaded. Keep that world unmodified between builds and uploads. A renderer that missed a revision uploads the whole bake. CPU rendering can use the returned world directly.

`editor.cacheStats()` reports resident bytes and hit, miss, and store counts by entry type. Pass `env.bakeCache` to share a cache between editors or use it directly with `KIT.diorama.build`. Create it with `KIT.authoring.bakeCache.create({ maxBytes })`. Its default memory budget is 64 MiB, and `clear()` evicts entries and resets statistics.

For CLI diorama builds, add `--asset-cache DIR` to reuse candidate points, mesh fields, and static splat buffers across invocations. Entries are keyed by the bake inputs and the compiler version. Keep the directory outside version control and remove it when its disk space is needed.

## Scene tree and selection

- `tree()` returns the scene hierarchy with blend groups, rig parts, solids, and nested operands. Solids assigned to a rig part appear under that part, with any blend group still recorded on the solid.
- A part's map key and a solid's `id` identify the object. An optional `label` supplies a display name. Unnamed nested operands under a named solid use addresses such as `operand:gate/modifiers/vent/shape`, based on the solid and modifier IDs. Existing `slot:` addresses also resolve for the current source order.
- `node(key)` looks up a tree entry. Solid entries include their authored properties. Named solids keep stable keys and unnamed solids use their source paths. An unnamed solid receives a temporary render tag for picking.
- `pick(ray, options)` resolves a world-space ray to a visible editable solid and returns its tree key and contributing hit. A miss returns `null`. A compound shape picks as a whole, and its operands can be selected through the tree. Pass a posed world from `build()` as `options.world` when picking an animated preview.
- `select(keys, { mode })` selects solids by tree key. `selectRay(ray, { mode, ...options })` selects the picked solid. Modes are `replace`, `add`, `toggle`, and `remove`. Read the current keys with `selection()`.

## Transforms and materials

`setTransform(patch, keys)`, `setMaterial(material, keys)`, and `setRole(name, ramp)` edit the source diorama. Omit `keys` to edit the current selection. `setMaterial` accepts a role name or the diorama's full material object. `materials()` returns the effective palette and its role ramps, and `setRole` updates a ramp wherever it is referenced.

| Transform field | Meaning |
| --- | --- |
| `translation` | XYZ displacement in scene units. |
| `rotation` | Yaw, tilt, and roll in radians, in the same convention as a diorama solid's `turn` field. |
| `scale` | Positive uniform scale from 0.02 to 20. |
| `pivot` | XYZ center of rotation and scaling. Defaults to the solid's authored `at` or the origin. |

Transform edits replace individual fields in the solid's `transform`. The transform is applied after its authored geometry and `turn`. A nested operand is transformed before its enclosing operation. A rigged solid's transform edits its rest geometry. Rig joint positions remain controlled by the scene's part definitions.

## Non-destructive shape editing

`updateShape(patch, keys)` edits the geometry fields of a solid or an operand in the tree. This includes primitive dimensions and the parameters and operands of existing boolean and procedural shapes.

A solid can store an ordered `modifiers` array in the diorama. Each entry has a unique `id` within that solid, a `kind`, and an optional `enabled` flag. A bake applies enabled entries from first to last, then applies the solid's `transform`. The source shape and all entries stay available for the next edit.

| Modifier | Fields |
| --- | --- |
| `join` | `how` selects an existing boolean or blend operation. Supply an operand as `shape`. Optional `size` and `steps` control transitions. |
| `mask` | `mode` is `keep` for the overlap or `cut` to remove it. Supply the mask volume as `shape`. The edited solid supplies the surface material. |
| `fold` | Use one of `polar`, `mirror`, or `repeat`. Set `centre` and `axis` for polar repetition, `centre` for mirroring, or `count` for grid repetition. |
| `warp` | Use `twist`, `bend`, a two-value `taper`, or three XYZ `stretch` factors. Optional `centre` sets the pivot and `wide` bounds the twist's distance correction. |
| `shell` | `t` sets the shell's thickness. |
| `swell` | `by` grows or shrinks the solid by a signed distance. |
| `rough` | `by` sets the height variation and `scale` sets the noise frequency. |
| `bubbles` | `cell` sets the spacing and `h` sets the height of the raised pattern. |

Use `setModifiers(list, keys)` to add, remove, or reorder entries. Use `updateModifier(id, patch, keys)` to edit an entry or bypass it with `enabled: false`. Optional parameter fields can be cleared with `null` in a patch. Mask and join operands appear in the tree even while bypassed. An unnamed operand's tree key follows the modifier ID when the stack is reordered. These edits share the same transactions and undo history as transforms and materials.

Use the [sculpt contribution tools](sculpt-contributions.md) to edit a
single entry by ID and compare the later cuts and material regions it affects.

Use `setSurfaceState(state, keys)` to edit a solid's rest-chart marks or pass `null` to clear them. The marks are retained with the source and resampled when geometry is rebuilt. [Deformation-aware materials](deformation-materials.md)

Pass the result of `build()` to `createSceneEditor` to reopen its source at the time of the bake. Retain `serialize()` output for durable storage alongside any exported splat or image data. Opening a scene with mesh operands uses the same asset lookup as opening its source JSON. Active modifiers on a separate analytic shape send its edited surface through the general mesh export path.

## Native mesh topology

A diorama can retain polygon meshes under `topologyMeshes`. Use
`editor.meshTopology(object, part)` for the source and
`editor.editMeshTopology(object, patch, options)` to update it in the
same journal as solid and pixel edits. The edit returns correspondence,
displaced bindings and invalidated material bakes.
[Mesh topology transactions](mesh-topology.md#edit-topology-in-a-scene-transaction)

Use `planTilesetStroke(request, options)` to preview a run of painted
faces and `applyTilesetStroke(request, options)` to draw or erase the
run in one journal entry. [Tile stroke requests and CLI](mesh-uv.md#draw-and-erase-a-run-of-painted-faces)

Use `planTilesetRectangle(request, options)` to inspect occupied cells and
`applyTilesetRectangle(request, options)` to fill or erase them in one
journal entry. [Rectangle requests and CLI](mesh-uv.md#fill-or-erase-a-rectangle-of-faces)

Use `planTilesetBrushRun(request, options)` and
`applyTilesetBrushRun(request, options)` to repeat a multi-tile pick
with a chosen overlap and artwork anchor in one undo entry.
[Brush run requests and CLI](mesh-uv.md#repeat-a-multi-tile-brush-with-overlap-and-alignment)

Use `eyedropTilesetFace(request)` to inspect a painted face and recover
a reusable stamp without opening an edit transaction.
[Face eyedrop workflow](mesh-uv.md#eyedrop-a-painted-mesh-face)

Use `planTilesetReskin(request)` and `applyTilesetReskin(request)`
to replace a face's tileset or crop with a reviewed pigment UV change.
[Face reskin modes](mesh-uv.md#reskin-a-face-in-place)

Use `planTilesetGrow(request, options)` and
`growTilesetFace(request, options)` to attach and fold a painted quad
along a retained boundary edge. [Edge grow workflow](mesh-uv.md#grow-a-tile-from-a-mesh-edge)

Use `planTilesetBlock(request)` and `applyTilesetBlock(request)` to
place, extend, or cut a tiled volume in one edit.
[Tiled block workflow](mesh-uv.md#add-and-subtract-tiled-blocks)

Use `planTilesetPrimitive(request)` and `applyTilesetPrimitive(request)`
to stamp and revise painted primitives. The source retains dimensions
and segment counts with its mesh. [Textured primitive workflow](mesh-uv.md#stamp-and-revise-textured-primitives)

Use a [retained sculpt sweep](sculpt-sweeps.md) as a standalone solid or
as a join modifier's shaped operand. It preserves the authored poses,
pressure, and blend radius in the saved scene.

Use `placeSculptStamp(recipe, placement)` to add solids and cut their opening
in one revision. [Compound sculpt stamps](sculpt-stamps.md)

## Brushes and local rebuilds

Use `paintShadowBand(stroke, { pbrMaterial })` to append a stroke to a [named PBR diffuse ramp](pbr-materials.md#paint-a-pbr-shadow-band).
Use `paintShadowBand(stroke, { layer, keys })` to paint the lighting
threshold of a selected solid's diffuse material. The stroke uses rest
XYZ points and joins the editor's undo history.
[Shadow band paint](shadow-band-paint.md)

Use `paintShadeNormal(stroke, { layer, keys })` on the same diffuse
layers to aim their lighting normals in rest space. Pass `normal: null`
to erase the tilt from the footprint.
[Shade normal paint](shadow-band-paint.md#paint-the-shade-normal)

Use `setBrushRegion(region)` to select a bounded 3D region or pass `null` to clear it. The region is stored as `brushRegion` in the saved diorama. Set `bounds` with XYZ `min` and `max`, and list the IDs of the stationary solids to edit in `solids`. Omit `solids` for a region that starts empty. `cell` sets the surface sampling interval and defaults to 0.16 scene units. `chunkCells` sets the size of each chunk along an axis and defaults to 12.

Use `applyBrush(stroke)` to append a retained stroke and receive the rebuilt world immediately. A stroke needs a unique `id`, a `mode`, one or more XYZ `points`, and a positive `radius`. Brush footprints are clipped to the region.

| Mode | Operation |
| --- | --- |
| `sculpt` | Add solid material along a swept sphere path. |
| `paint` | Change the material of existing editable surfaces inside the path. Surface sampling is reused. |
| `erase` | Carve the path out of the editable surface and earlier stamps. |
| `place` | Place a solid stamp at each point. Set `shape` to `ball` or `box`. Radius is the ball radius or box half-width. |
| `scatter` | Scatter solid stamps within horizontal disks around the points. Set `count`, `size`, and optionally `seed` and `shape`. Radius sets the disk radius. Size is the stamp radius or half-width and defaults to 15 percent of the disk radius. The default count is 12. |

All modes except erase accept a palette role in `material` and default to `stone`. Apply strokes in order. Added stamps have deterministic ownership and can be picked as stroke entries in the scene tree. Use `begin()` and `commit()` to group strokes. Edit the region's `strokes` array to change or remove a saved stroke. The CLI can validate and render the saved diorama.

The returned `world.brushRegion.chunks` maps chunk keys to packed splats. `world.brushRegion.work` reports rebuilt and resampled keys and the number of reused chunks. The first build samples the region. Subsequent strokes reuse distant chunk buffers and keep native splats outside the editable lattice. The assembled world can go directly to either renderer.

Brush regions use a static diorama and a separate sampled surface for the locally editable geometry. That surface uses the diorama's palette roles and directional light. Choose the cell size for the detail required. Brush regions publish splat geometry. Their scene source and strokes are retained in the diorama JSON.

## Linked visual prefabs

Set `prefabLibrary` to a shared JSON file, relative to the diorama. The file maps prefab IDs to definitions. A definition has a positive integer `revision` and a `solids` map. It can also declare `parts`, `groups`, `motion`, and `effects` as named maps. Their values use the ordinary diorama records. Use the names as stable identities when the library changes. Mesh paths in the CLI library resolve relative to the library file. A scene can also declare inline definitions under `prefabs`.

A definition can declare `usesTilesets` as an array of registered sheet IDs.
An instance requires those sheets in its scene. Tileset revision previews
also report requirements from unused definitions, including definitions in
the shared library. See [tileset revisions](mesh-uv.md#manage-tileset-revisions).

The scene's `instances` map stores each placement. An instance names its `prefab`, an optional `transform`, and an optional ordered array of `overrides`. A transform places the complete assembly, including its joints and effect positions. Overrides use the existing `set`, `merge`, `remove`, and `test` edits and address named records in the definition. Override a solid's material or transform, a motion track, or an effect field by its local path. Other fields inherit the shared definition. An override that refers to a retired record raises a validation error.

In Node, pass the shared map as `env.prefabs`. `setPrefabInstance(id, record)` creates or replaces an instance and accepts `null` to remove it. Instances appear in the scene tree and can be picked by ray. Use `refreshPrefabs(prefabs, { assets })` to load a replacement library without rewriting the scene. The editor validates local overrides before accepting the new library. The CLI reads the shared library each time it loads a diorama.

For [generated prefab members](procedural.md#stable-identities-for-generated-parts),
use `planPrefabRefresh(prefabs, { assets })` to preview the changes. The
report lists each affected instance, its member identities, and the local
override paths that are preserved or need review. A split lists the local
IDs of its successors. Resolve an override on a retired member by updating
the instance's edit list for the target library. A failed refresh leaves the
editor on its current library and exposes the report on the thrown error.

### Isolate a prefab instance for mesh edits

A visual prefab can include a `topologyMeshes` map alongside its `solids`.
Use the same retained mesh rows as a diorama, including material slots
and tile bindings. Store vertices in prefab-local space. Each instance
renders its own placement with qualified scene object IDs such as
`west.panel`. Declare referenced tilesets in `usesTilesets` so dependency
review can find them even when the definition is unused.

```json
{
  "instance": "west",
  "revision": 3,
  "faces": { "panel": ["sign"] },
  "hideSurroundings": true,
  "edits": [
    { "member": "panel", "transform": {
      "operation": { "kind": "move", "offset": [0.08, 0, 0] },
      "pins": { "vertices": ["sign/v1", "sign/v2"] }
    } }
  ]
}
```

Use prefab-local member and face IDs. A member can take a saved native
face selection in place of its ID list to validate the topology revision.
Omit `faces` to include every face of the instance's retained meshes.
Omit `edits` to inspect the scope or capture an unedited view.

Each edit takes one `patch`, `transform`, `reskin`, or `pivot` request. Patches edit
retained faces, corners, and their vertices or edges. A transform defaults
to the active faces. Its local axes follow the prefab and its world axes
follow the scene. Use the normal transform pins to hold vertices shared
with inactive faces. A reskin reuses the existing tile brush, crop and
tileset modes. A request that changes an inactive face, shared boundary,
or shared bake used outside the scope blocks the batch and lists the
affected faces. Face IDs created outside the active set also block.
A [pivot placement](mesh-topology.md#place-a-pivot-independently) stores
an instance-local point that subsequent transforms in the batch can use.

```sh
ink-studio mesh-topology isolate-prefab station.json edit.json \
  --view view.json --preview isolated.png --out revised-station.json
```

Omit `--out` to review without writing changes. With `hideSurroundings`,
the native preview keeps the entire selected prefab visible, including
its inactive reference faces, and filters out other scene objects. The
report lists the visible objects and their pixel counts. Saved scenes
retain their full surroundings. A commit stores the changed mesh on
the selected instance as one undoable override. It pins the source
prefab revision and base mesh revision so a changed library cannot
silently replace or shadow the original mesh.

Use `editor.planPrefabIsolation(request)` for the report,
`editor.previewPrefabIsolation(request)` for the world and headless
render options, or `editor.editIsolatedPrefab(request)` to commit.

```sh
node examples/tileset-pick/prefab-isolation-demo.cjs prefab-isolation-demo
```

See [shared parameter bindings](parameter-bindings.md) for named controls, expressions, fields, and signals in editor builds.
See the [unified scene timeline](scene-timeline.md) for animating those builds and inspecting their markers and audio cues.

## Breakable groups

Use `editor.suggestBreakable({ at, radius, voxel })` to query a nearby
connected component. Author a destruction group with the returned part key,
or combine several scene-tree keys in a group with
`editor.setBreakables({ groups, links })`. See the
[destruction binding and fixture](destruction.md#breakable-groups-from-authored-parts)
for available keys and runtime collision queries.

## History

Standalone edits commit immediately. Use `begin(label)` to group repeated transform or material edits into one gesture. `preview()` validates the draft, `commit()` records it as one undo step, and `cancel()` restores the prior scene. If preview or commit fails validation, the transaction rolls back.

Use `undo()`, `redo()`, `history()`, and `revision()` to track saved edits. `onChange(listener)` reports committed edits and history changes with the current snapshot. Selection belongs to the editing session.

Pass a scene editor to [`createPixelEditor`](pixel-art-authoring.md#undo-pixel-and-scene-edits-together)
to group native scene operations with pixel edits in the same transaction.

## Retained mesh modifier stacks

Use `setMeshModifiers(object, list)` and
`updateMeshModifier(object, id, patch)` on an editable mesh. The mesh
tree keeps each stage at `mesh-modifier:<object>/<id>` while reordering or
bypassing it. `build()` draws the evaluated mesh and `snapshot()` stores
the editable cage and ordered stack. Use `planApplyMeshModifiers` to
review changed bindings and bakes before `applyMeshModifiers` writes
the selected prefix to topology. See [mesh modifier stacks](mesh-topology.md#run-a-non-destructive-mesh-modifier-stack).
