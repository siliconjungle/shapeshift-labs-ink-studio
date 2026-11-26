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

Use [assembly stretch](assembly-stretch.md) to pull a connected assembly
between two picks, carry its attachments, and check joint limits.

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

Use `planSculptSplit(request)` and `splitSculpt(request)` to extract an
editable piece with a matching cut boundary.
[Split a sculpt](sculpt-splits.md)

Use `setSurfaceState(state, keys)` to edit a solid's rest-chart marks or pass `null` to clear them. The marks are retained with the source and resampled when geometry is rebuilt. [Deformation-aware materials](deformation-materials.md)

Pass the result of `build()` to `createSceneEditor` to reopen its source at the time of the bake. Retain `serialize()` output for durable storage alongside any exported splat or image data. Opening a scene with mesh operands uses the same asset lookup as opening its source JSON. Active modifiers on a separate analytic shape send its edited surface through the general mesh export path.

Use [3D paintings](painting-3d.md) to retain editable sweep marks together with their surface and rig attachments. A painting can be extracted and placed in another scene.

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

The scene's `instances` map stores each placement. An instance names its `prefab`, an optional `parent` and `transform`, and an optional ordered array of `overrides`. A transform places the complete assembly, including its joints and effect positions. Overrides use the existing `set`, `merge`, `remove`, and `test` edits and address named records in the definition. Override a solid's material or transform, a motion track, or an effect field by its local path. Other fields inherit the shared definition. An override that refers to a retired record raises a validation error.

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

### Promote painted tile faces into a prefab

Use `tileset promote-prefab` to turn selected faces on one or more loose
editable meshes into an inline visual prefab. The initial linked
instance occupies the original position. Any unselected faces stay on
their source mesh. The promotion keeps face, corner, vertex and edge
IDs, UVs, paint bindings and the material slots used by the selected
faces. Tileset dependencies are listed under `usesTilesets`. A boundary
shared with the unselected mesh keeps its IDs in both meshes. Resolved
corner normals are retained when a split crosses a smooth fan.

```json
{
  "prefab": "painted-bay",
  "instance": "west",
  "origin": { "kind": "plane" },
  "faces": { "bay-panel": ["sign", "grille"] }
}
```

```sh
ink-studio tileset promote-prefab promote.json --scene station.json
ink-studio tileset promote-prefab promote.json --scene station.json --out promoted.json
```

Omit `--out` to preview the promotion receipt. It gives the origin,
source and destination object IDs, original selection revisions,
remaining face counts, shared edges, and any conflicts. The origin
defaults to the current construction plane origin. Use
`{"kind":"point","id":"threshold","at":[1,0,2]}` to record a named XYZ point
or `{"kind":"vertex","object":"bay-panel","vertex":"sign/v0"}` to take the
position of a named scene vertex. The prefab uses the scene axes and
stores the selected vertices relative to that origin. If the
construction plane's retained edge moves into the prefab exclusively,
the plane keeps its resolved frame and the receipt records the detached edge.

A `faces` value may be a saved native face selection from
`tileset select --topology-out`. To pass it by filename with
`--selection faces.json`, declare a single source such as
`"faces": {"bay-panel": null}`. Saved selections must match the current
topology revision.

Sources must be static meshes with live tile-face bindings. Motion parts,
active modifiers, topology-dependent attachments and hybrid ownership
require review. A named face decal in the scene follows the first
instance when its receiving face moves. Assign a face to an object-wide
decal before promoting only part of its receiver. The decal stays a
scene-level edit.

In the SDK, use `editor.planTilesetPrefab(request)` and
`editor.promoteTilesetPrefab(request)`. One undo restores the original
faces, their receivers and the construction plane. Use
`editor.setPrefabInstance` to add another placement of the saved definition.

Run `node examples/tileset-pick/prefab-promotion-demo.cjs bay-demo` for a
replayable selection, promotion and reuse example.

### Stamp linked prefab instances on the working plane

`tileset stamp-prefab` places an inline or library prefab at a grid
address on the current construction plane. A run repeats it at a
declared interval. Each placement keeps a link to the same definition.

```json
{
  "prefab": "painted-bay",
  "id": "east-row",
  "at": [0.75, 1],
  "count": 4,
  "step": [3.5, 0],
  "rounding": "floor",
  "orientation": "plane",
  "angle": 0
}
```

```sh
ink-studio tileset stamp-prefab stamp.json --scene station.json
ink-studio tileset stamp-prefab stamp.json --scene station.json --out stamped.json
```

Use `at` for a plane grid address or `point: [x, y, z]` to project a world
point onto the plane. Both axes use the plane's grid intervals. The
optional `normalOffset` is measured in scene units along the plane
normal. Positions use the current plane, including a camera-picked
plane or a retained edge hinge.

The first address and signed `step` define the unrounded run. Snap
each position with the plane's rounding mode, or override it with
`nearest`, `floor`, or `ceiling`. Set `snapGrid: false` to use fractional
addresses directly. A stamp that rounds two placements to the same
position reports the conflict and leaves the scene intact.

The default `orientation: "plane"` aligns prefab local X, Y and Z
with the plane's right, up and normal. Use `orientation: "world"` to
keep the world axes as the orientation basis while still placing on
the plane. `angle` rotates about the resulting local Z in degrees.

Use `id` as the instance ID for one stamp. For a run, Ink appends
zero-based suffixes such as `east-row.0` and `east-row.1`. The receipt
lists the prefab revision, requested and rounded addresses, and saved
transforms. It also reports existing ID conflicts. Omit `--out` to
preview without making a scene. In the SDK, call
`editor.planPrefabStamp(request)` or `editor.stampPrefab(request)`. One
undo removes the entire run.

Run `node examples/tileset-pick/prefab-stamp-demo.cjs stamp-demo` to
compare floor and ceiling rounding with placement on a tilted plane.

### Edit a prefab source in context

`mesh-topology edit-prefab` edits a shared visual prefab from a placed
instance. The selected instance supplies the placement frame for mesh
transforms. The edit starts from the source definition so its local
overrides don't become part of the shared asset.

```json
{
  "instance": "bay.1",
  "revision": 3,
  "sourceEdits": [
    { "op": "set", "path": "/solids/body/mat", "value": "stone" }
  ],
  "edits": [
    { "member": "panel", "transform": {
      "operation": { "kind": "move", "offset": [0, 0.1, 0] }
    } }
  ]
}
```

Use `sourceEdits` to set, merge, remove, or test named records for solids,
parts, groups, motion, and effects. Use `edits` for the same mesh patch,
transform, pivot, and paint operations available in prefab isolation.
Omit `faces` to edit whole mesh members or provide a face scope to check
for changes outside it. The source revision advances once per committed
batch.

```sh
ink-studio mesh-topology edit-prefab station.json edit.json --preview review --view view.json
ink-studio mesh-topology edit-prefab station.json edit.json --out revised.json
```

The receipt lists every linked instance in the current scene. It records
changed members and face or corner IDs, path overrides that touch a
source change, masked members, and rebased mesh overrides. Ordered path
overrides still apply over the source. A failed test, a removed target,
or an array index that moved to another element blocks the commit.
Mesh overrides merge disjoint changes by stable element ID. Competing
values and incompatible changes to element order block the commit and
identify the conflicting paths.

The optional native preview saves `before.png`, `after.png`, and
`changes.png` with the same camera and time. It counts changed visible
pixels by instance. On a mesh conflict it can show a draft that retains
the local value at the disputed field. A conflict that prevents building
a draft produces the before capture and a report.

Inline definitions save with the scene. For a shared file, supply
`--library-out revised-library.json` with `--out`. The new scene points
at the revised library and the existing library remains available to
other scenes. Output the scene and library beside their respective
sources so relative references keep working.

In the SDK, `planPrefabSourceEdit(request)` returns the receipt.
`previewPrefabSourceEdit(request)` also returns the staged scene, library
when applicable, and preview worlds. Use `editPrefabSource(request)`
to commit an inline revision with one undo.

Run `node examples/tileset-pick/prefab-source-edit-demo.cjs bay-review`
to review three linked bays and a blocked overlap.

### Make a local prefab variant

Use `mesh-topology variant-prefab` with a placed instance. Set `mode`
to `fork` for a new inline, reusable definition or to `detach` to convert
the instance into editable scene members. Either operation incorporates
the instance's effective overrides and keeps the qualified scene object
IDs, so a decal on `west.panel` still refers to that panel.

```json
{"instance":"west","revision":3,"mode":"fork","prefab":"west-enamel"}
```

```json
{"instance":"center","revision":3,"mode":"detach"}
```

```sh
ink-studio mesh-topology variant-prefab station.json fork.json --preview review --view view.json
ink-studio mesh-topology variant-prefab station.json fork.json --out forked.json
```

A fork keeps the placement and starts the new prefab at revision 1.
It preserves the effective members and records the source prefab,
source revision, and originating instance in `provenance`. A detach
moves the members into the scene. For static tile geometry, Ink bakes
the placement into the authored vertices and pivot and rotates authored
normals. It preserves face, edge and corner IDs, UVs, tile bindings and
material slots. Detached meshes record the effective source mesh
revision alongside their prefab provenance.

The receipt shows which overrides became part of the variant, along
with source and destination identities. Use `--preview` for matched
native-grid before, after and change images. A detach that would move a
mesh with active modifiers, skin, shape keys or topology attachments
into a new coordinate space reports the dependency for review. A
detach also checks for indexed parameter bindings that would address a
different scene member.

Forks and loose tiles still use the registered sheets from the original.
To change the sheet pixels for only one face, use the existing
[local paint variation](mesh-uv.md#choose-shared-paint-or-a-local-face-variant) workflow.

In the SDK, use `planPrefabVariant`, `previewPrefabVariant`, and
`applyPrefabVariant`. Each conversion is one undo. Run
`node examples/tileset-pick/prefab-variant-demo.cjs variant-demo`
for a replay that edits a fork, detached tiles, and the source independently.

### Replace selected prefab instances

`mesh-topology replace-prefab` changes the prefab used by one or more
placements. The instance IDs, positions, orientations, scales, and
pivots stay in place. The target can be an inline or library definition.
Supply its `revision` to check that you are using the reviewed definition.

```json
{
  "instances": ["west", "east"],
  "to": "revised-bay",
  "revision": 7,
  "migrations": {
    "bay": {
      "revision": 3,
      "members": { "topologyMeshes": { "panel": "fascia" } },
      "faces": { "panel": { "sign": "badge" } }
    }
  }
}
```

```sh
ink-studio mesh-topology replace-prefab station.json replacement.json --preview review --view view.json
ink-studio mesh-topology replace-prefab station.json replacement.json --out replaced.json
```

Omit `instances` to pass a saved prefab instance report with
`--selection selected.json`. Save one with
`tileset select query.json --scene station.json --out selected.json`,
using the `instances` domain and `query.kind: "prefab"`.

Members match by stable local ID. Optional migrations name each source
prefab and its expected revision. A `members` entry maps a named record
in `solids`, `parts`, `groups`, `motion`, `effects`, or
`topologyMeshes`. A `faces` entry maps named decal receiver faces within
the source mesh member. Scene decals follow compatible receivers, with
mesh UV overlap or sampled projector contact recorded in the receipt.
Static mesh attachments can use the native attachment transfer through
topology correspondence. Pose-dependent transfers require separate pose
evidence through the existing attachment tooling.

The visual revision tools replay compatible path overrides and rebase
disjoint local mesh edits against the replacement revision. Missing
targets, conflicting mesh edits, lost decal contact, or moved indexed controls block the batch
and appear in the report. Preview images use matched native captures and
show changed pixels for the selected instances. One undo restores the
original links and decal receivers.

In the SDK, use `planPrefabReplacement`, `previewPrefabReplacement`, or
`replacePrefabs`. Run
`node examples/tileset-pick/prefab-replacement-demo.cjs replace-demo`
to replace two bays and inspect the carried sign, mark, and material.

### Duplicate a prefab instance in three axes

`mesh-topology array-prefab` duplicates a placed instance using independent
XYZ counts and signed spacing in scene units. The counts include the
source at `[0,0,0]`. The other cells receive stable instance IDs such as
`rack.1.0.1`, so resizing on any axis keeps the same name for a surviving
coordinate. Each copy starts with the source prefab link, authored
rotation, scale, pivot, and local overrides.

```json
{
  "id": "rack",
  "instance": "west",
  "count": [2, 2, 2],
  "spacing": [1.75, 1.25, 2.5],
  "space": "world"
}
```

```sh
ink-studio mesh-topology array-prefab station.json array.json --preview review --view view.json
ink-studio mesh-topology array-prefab station.json array.json --out arrayed.json
```

Use `space: "local"` for the source's rotated axes or `space: "plane"`
for its working plane's right, up, and normal axes. The source remains
the origin of the array. Spacing is independent of the source scale and
the construction grid interval.

Reuse the array `id` with updated `count`, `spacing`, or `space` to
resize it. Omitted settings come from the saved array. A surviving
copy keeps its prefab link, local overrides, rotation, scale, pivot, and
manual translation offset relative to the grid. Added cells take their
settings from the current source. Copies that share a parent inherit its
motion, and resizing accounts for that motion. A deleted or detached cell is listed
as missing while its coordinate is within the array.

The receipt lists added, moved, retained, missing, and retired copies.
Colliding instance IDs, retired cells used by another array, or changed
indexed parameter targets block the edit. Normal scene validation checks
named references such as decals on retired copies. One undo restores
the array and its placements.

In the SDK, use `planPrefabArray`, `previewPrefabArray`, and
`applyPrefabArray`. Run
`node examples/tileset-pick/prefab-instance-array-demo.cjs array-demo`
to duplicate a bay in three axes, edit an individual copy, and resize
the array with that edit intact.

### Combine placed instances into a module

`mesh-topology combine-prefab` captures the effective geometry, paint,
materials, and local overrides of two or more linked placements into a
new inline prefab. The module preserves their relative positions,
orientations, and scales. Member IDs are qualified by source placement,
such as `west.panel` and `east.panel`.

```json
{
  "instances": ["west", "east"],
  "prefab": "paired-bays",
  "mode": "replace",
  "instance": "lower-module",
  "origin": [-1.31, 0, 0]
}
```

Choose the mode explicitly. **Keep** registers the module and leaves the
selected placements in the scene. Omit `instance` in keep mode. **Replace**
installs one new linked instance at the chosen origin and removes the
selected placements in the same undo. Omit `origin` to use the first
selected placement in scene order.

```sh
ink-studio mesh-topology combine-prefab station.json combine.json --preview review --view view.json
ink-studio mesh-topology combine-prefab station.json combine.json --out combined.json
```

Use `--selection selected.json` with a saved prefab instance report from
`tileset select` in place of the explicit `instances` list. The receipt
lists source revisions and member mappings. Replacement reroutes
scene-level decals to the corresponding module receivers. The module
records source provenance and tileset requirements. Its mesh frames
keep editable documents in their own local coordinates.

Projection modifiers that require a mesh outside the selected module
need review. Replacement also checks references such as an array's
source instance or an indexed scene control before retiring placements.

In the SDK, use `planPrefabCombination`, `previewPrefabCombination`, and
`combinePrefabs`. Run
`node examples/tileset-pick/prefab-combine-demo.cjs combined-bays`
to compare the original placements with a combined stamp and then reuse
the module elsewhere.

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

### Nest and reparent placed instances

Set an instance's `parent` to the ID of another visual prefab instance
in the same scene. Its `transform` is relative to that parent. Omit
`transform` to inherit the parent's frame, or omit `parent` to place the
instance in world coordinates. Scene tree entries and rendered member
IDs such as `sign.panel` keep their names as the hierarchy changes.

Use `mesh-topology reparent-prefab` to change the parent while keeping
the instance and its descendants in place. Pass `null` to move it to
the scene root. Later edits to a parent carry the entire subtree.

```json
{"instance":"sign","parent":"gantry"}
```

```sh
ink-studio mesh-topology reparent-prefab station.json nest.json --preview review --view view.json
ink-studio mesh-topology reparent-prefab station.json nest.json --out nested.json
```

The receipt records the old and new parents, local transforms, and
world frames. The native-grid preview includes affected members for
each descendant. Missing parents, cycles, and a required local scale
outside Ink's transform range of 0.02 to 20 block the edit. Move the
remaining children before removing their parent, detaching its members,
or replacing it with a combined module.

In the SDK, use `planPrefabReparent`, `previewPrefabReparent`, and
`reparentPrefab`. One undo restores the old link and its local transform.
Run `node examples/tileset-pick/prefab-reparent-demo.cjs nested-bays`
to compare a keep-world reparent with the subsequent motion of the parent.

### Mirror a placed prefab while editing

`mesh-topology mirror-prefab` adds a live reflected placement with its
own instance ID. The mirror follows the source's prefab, local overrides,
and world transform, including motion inherited from a parent. It also
reflects the paint, restores front-face winding, and keeps the UV corners
associated with their authored texels.

```json
{
  "source": "west",
  "instance": "east",
  "plane": {"origin": [0, 0, 0], "normal": [1, 0, 0]}
}
```

Omit `plane` to capture the active construction plane. The plane is
stored in world coordinates. Submit the same source and mirror IDs
with another plane to move the reflection plane. While linked, edit
the authored source through the usual prefab commands. A scene-level
decal belongs to its named receiver. Scene placements nested under
the source keep their own links.

```sh
ink-studio mesh-topology mirror-prefab station.json mirror.json --preview link-review --view view.json --out live.json
ink-studio mesh-topology mirror-prefab live.json commit.json --preview commit-review --view view.json --out independent.json
```

Use `{"action":"commit","instance":"east"}` in `commit.json` to retain
the reflected pose and current overrides as an independent placement.
Both sides can now move and take instance edits separately. They still
share the prefab definition. Use `variant-prefab` to give one side its
own definition. Commit and link updates are undoable. Commit the live
mirror before removing its source or replacing that source with a
different prefab.

In the SDK, use `planPrefabMirror`, `previewPrefabMirror`, and
`applyPrefabMirror`. Run
`node examples/tileset-pick/prefab-mirror-demo.cjs mirror-bays`
to link two bays, paint them together, and make a local variation.

### Name object points for placement and alignment

Store named points on a retained mesh or on a visual prefab definition.
A point has a local `position` and an optional `direction`. Socket
direction defaults to local +Z. Placement transforms resolve the same
point in world space, including nested and reflected placements.

```json
{"object":"panel","points":{"hinge":{"position":[-0.75,0.3,0],"direction":[0,1,1]}}}
```

Inspect the change with `tileset object-points` and add `--out` to
publish it. Omit `points` to list the effective local and world
coordinates, or give a point a `null` value to remove it. Use
`"instance":"west"` in place of `object` to edit that inline prefab's
definition through the existing revision workflow. For a shared
library, publish a new revision with `mesh-topology edit-prefab`, using a
`sourceEdits` path such as `/points/hinge`.

```sh
ink-studio tileset object-points points.json --scene station.json --out authored.json
ink-studio mesh-topology plane authored.json --snap-origin object-point --object panel --point-id hinge
```

Use a selector such as `{"kind":"object-point","object":"panel","id":"hinge"}`
as a mesh pivot target, component snap target, or prefab promotion
origin. Use `instance` to refer to a point on a placed prefab, and
`object` with a qualified ID such as `west.panel` for a prefab member.
Snap requests can also use `kind: "socket"` with
`instanceKind: "prefab"` and the point's name as `binding`.
Live diorama graphs expose these sockets on `prefab.<instance>`
and on `mesh.<object>` when a mesh has named points.

Stamp a prefab by putting its named anchor at a target. Use a root point
name or a member point selector such as `{"member":"panel","id":"hinge"}`
for `anchor`. With a named `target`, placement uses its exact world
XYZ. Orientation and angle still come from the stamp request. Plane
stamps can also use an `anchor` and retain their normal grid behavior.

```json
{
  "prefab":"bay",
  "id":"upper-bay",
  "anchor":"foot",
  "target":{"kind":"object-point","instance":"west","id":"dock"},
  "orientation":"world"
}
```

Pivot and plane snaps sample the current position. Graph sockets
continue following their nodes. Mesh points are authored in local
coordinates and independent of individual vertices. Promotion and
module combination preserve the coordinates of points carried into
the resulting prefab. A detached prefab keeps member mesh points and
reports the prefab-level points whose owner was removed.

In the SDK, use `planObjectPoints`, `editObjectPoints`, and
`KIT.authoring.objectPoints.resolve`. Run
`node examples/tileset-pick/object-points-demo.cjs station-points`
to replay a named pivot, construction snap, and anchored prefab stamp.

### Organize placed prefabs in scene layers

Use `mesh-topology scene-layer` to organize placed visual prefabs.
Layers have stable IDs and can belong to another layer. Start with a
`set` request to create a layer or change its label, parent, and local
visibility. Use `parent: null` to move a layer to the scene root.

```json
{"action":"set","layer":"east-wing","parent":"station","visible":false}
```

A hidden layer suppresses the geometry, attached decals, and effects
of its modules and its child layers. Showing a parent keeps each
child's own visibility setting. A nested prefab or live mirror with
no layer assignment inherits its carrier's or source's layer. Assign
a placement explicitly to organize it independently of that link.
Layer edits preserve the transform hierarchy and world placement.

```sh
ink-studio mesh-topology scene-layer station.json hide.json --preview review --view view.json --out hidden.json
ink-studio tileset select east-wing.json --scene hidden.json --out selected.json
ink-studio mesh-topology scene-layer hidden.json move.json --selection selected.json --out moved.json
```

Use `{"domain":"instances","query":{"layer":"east-wing"}}` in
`east-wing.json` to select the entire branch. Hidden placements are
included unless the query sets `includeHidden: false`. The saved
selection can be passed to other prefab commands. A `move` request
chooses the destination `layer` and one of `instances`, `selection`,
or `from`. The latter moves the population of an entire source
branch. Use `layer: null` to move selected placements to the scene
root.

Set `{"action":"insertion","layer":"east-wing"}` to route new prefab
placements into that layer. Use `layer: null` to clear the insertion
target. Without a target, array copies and combined modules use their
source layer. An `inspect` request or an empty request lists layers,
the insertion target, and each module's effective layer and visibility.
One undo restores a layer edit and its membership together.

In the SDK, use `planSceneLayers`, `previewSceneLayers`,
`editSceneLayers`, and `selectSceneLayer`. Run
`node examples/tileset-pick/scene-layers-demo.cjs station-layers`
to hide a wing, move a saved selection, and stamp into an insertion layer.

### Inspect layer bounds and set module origins

Add a `layer` to an `inspect` request to measure that branch. The
receipt lists each module's local and world origin, member bounds,
and the combined bounds. It includes hidden descendants by default.
Use `includeHidden: false` for the visible population, or `layer: null`
for unlayered placements.

```json
{"action":"inspect","layer":"station"}
```

The measurement uses world-space rest geometry. It samples the
evaluated native mesh vertices and conservative solid envelopes.
Unbounded members are listed separately and prevent a geometric
center from being used. The receipt also includes a separate box
and center for the authored module origins.

```json
{"action":"center","layer":"station","basis":"bounds"}
```

Centering moves the construction frame's origin and keeps its axes,
grid and rounding. Use `basis: "origins"` to center on the origin box
instead. An edge-anchored origin can slide along its edge. Use
`detachEdge: true` to move it elsewhere.

```json
{"action":"set-origins","layer":"station","target":{"kind":"module-center"}}
```

Set each module origin to its own bounds center with `module-center`,
or give every module a common target with `layer-center`, `plane`,
`{"kind":"point","position":[0,1,0]}`, or a named object point selector.
Origins are local to their prefab recipes. The edit preserves
geometry, child placement and socket positions. Instance selection
and live prefab pivot frames use the new origin. A live mirror's
origin follows its source. Commit a mirror before assigning its
origin directly.

```sh
ink-studio mesh-topology scene-layer station.json inspect.json
ink-studio mesh-topology scene-layer station.json center.json --out centered.json
ink-studio mesh-topology scene-layer centered.json origins.json --preview review --view view.json --out authored.json
```

The origin receipt lists before and after positions and any dependent
mirror origins. One undo restores the entire batch. Run
`node examples/tileset-pick/scene-layer-frames-demo.cjs station-frames`
to inspect a layered station, center its construction frame, and
review the changed origins over matched native-grid renders.
