# Round-trip asset interchange

`ink-studio interchange <input.gltf|input.glb|manifest.json> --out <output>` reads the asset and writes it to a new location. Choose `.gltf` or `.glb` for glTF input and `.json` for a raster or sprite atlas manifest. Keep the PNG companions with their manifest.

## glTF and GLB

Use `readGltfAsset(file)` and `writeGltfAsset(asset, { out })` from the Node entry point. The output contains its binary data and textures. The retained document includes scene roots, node hierarchy and local transforms, material slots, textures, skin data, morph targets, animations, and extras. Local companion buffers and images are packed into a single buffer.

- `asset.snapshot()` returns independent copies of the glTF document and the binary buffer.
- `asset.withDocument(document)` validates an edited document against the retained buffer and returns a new asset. Keep buffer view and accessor references aligned with the binary data.
- `asset.sample(time, { scene, clip })` returns the selected scene's local and world node transforms, material slots, and morph weights. Pass a zero-based clip index or unique clip name to evaluate its core animation channels. Skin data remains available for downstream deformation. Extension channels remain in the document.
- `KIT.authoring.gltfAssets.create({ document, binary })` creates the same asset from a self-contained document with a single embedded buffer payload in Node or the browser.

The glTF pivot is the node's local origin. Use parent and child transforms to represent a pivot offset in other glTF applications. An explicit `node.extras.inkStudio.pivot` is retained and exposed as metadata when present. The [glTF 2.0 specification](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html) defines node transforms and animation channels.

## Keep helper nodes in model delivery

Set `deliveryHelper` on a named exterior solid or a retained scene mesh. Ink
keeps the visual in the authoring scene. When exporting the diorama, Ink
writes the helper's transform and metadata to a meshless node.

```json
{
  "id": "door-clearance",
  "kind": "box",
  "at": [1.25, 0.9, 0],
  "half": [0.4, 0.8, 0.12],
  "deliveryHelper": {
    "socketId": "door-mount",
    "markerId": "clearance-center",
    "collisionRef": "gate/door-clearance@2"
  }
}
```

```sh
ink-studio export-glb gate.json --out gate.glb > delivery.json
ink-studio interchange gate.glb --out gate.gltf
```

The export receipt's `helpers` array identifies the glTF node, its rest
position, and its references. `node.extras.inkStudio` carries the stable
`helperId` and the authored references. Placed prefab helpers use their
qualified scene object IDs and include their instance and prefab IDs.
Helpers on exported rig parts follow the joint's animation. An asset
can consist entirely of helper nodes.

The optional `point` sets an XYZ origin in the solid's recipe coordinates
or the mesh's local coordinates. The default uses the solid's `at`, the
mesh's `pivot`, or local zero. Existing solid `sockets` and retained mesh
`points` become named child sockets. Use an empty `deliveryHelper` object
when those child sockets supply all the references. `collisionRef` is a
reference for the consuming runtime to resolve.

Diorama model export builds its visual meshes from authored solids.
Tagged retained scene meshes contribute helper nodes and sockets.
`readGltfAsset(file).sample()` exposes the helper's metadata as `helper` and
returns socket IDs and world frames for inspection.

## Stable asset revisions

An Ink asset revision manifest names the asset and its parts independently
of source-file indexes or display names. Declare the material, socket, and
bone IDs that belong to each part.

```json
{
  "format": "ink-studio/asset-revision",
  "version": 1,
  "asset": "harbor/signal-relay",
  "revision": 1,
  "parts": {
    "housing": {
      "materials": ["enamel", "casing"],
      "sockets": ["lamp-mount", "test-port"],
      "bones": ["hinge-axis"]
    }
  }
}
```

In glTF, tag a mesh node with `extras.inkStudio.partId`. Tag its explicit
materials with `extras.inkStudio.materialId` and its descendant marker
nodes with `extras.inkStudio.socketId` or `extras.inkStudio.boneId`. Tagged
skin joints can also supply bone IDs. Use the default glTF scene for the
named parts. The manifest must match the tags and assignments. Keep an ID
when revising the same element, including when its display name or glTF
index changes.

Store the manifest under `document.extras.inkStudio.assetRevision`, or
attach a separate manifest to a tagged source while converting containers.

```sh
ink-studio interchange relay.gltf --manifest revision.json --out relay-v1.glb
ink-studio asset-part manifest relay-v1.glb
```

In the SDK, `KIT.authoring.assetRevisions.manifest` validates the
format-neutral data. A retained glTF asset's `withRevision(manifest)`
returns a new asset with the verified manifest. `assetRevision()` reads
the manifest and exposes `part(id)` for source mappings and rest-space
marker frames. Both glTF and GLB round trips retain the original binary
payload and the tags.

## Replace one part in a scene

Add named `assetParts` placements to an Ink diorama. Each placement pins
the source file, asset, revision, and part. The placement key is its
world object ID. Material picks use the stable part and material IDs.
Sockets and bones resolve to frames in the scene. This placement uses
the mesh node's local coordinates, with markers expressed relative to
that node. The scene controls the part's placement and scale.

```json
{
  "assetParts": {
    "relay": {
      "file": "relay-v1.glb",
      "asset": "harbor/signal-relay",
      "revision": 1,
      "part": "housing",
      "transform": { "position": [-0.26, 0, 0] },
      "bindings": {
        "paint": { "kind": "material", "target": "enamel" },
        "lamp": { "kind": "socket", "target": "lamp-mount" },
        "hinge": { "kind": "bone", "target": "hinge-axis" },
        "probe": { "kind": "socket", "target": "test-port", "required": false }
      }
    }
  }
}
```

```sh
ink-studio asset-part preview before.json relay relay-v2.gltf --expect 1 --out preview.json
ink-studio asset-part replace before.json relay relay-v2.gltf --expect 1 --out after.json
ink-studio render after.json --ortho --px 1 --out revised.png
```

The report lists retained, removed, and added IDs and whether each
binding is retained, lost, missing, or restored. A retained socket or
bone can report a changed frame. The candidate must be a different revision
of the same asset, so the same command can restore an older pin. A missing part, missing required binding,
or unavailable candidate geometry blocks replacement. Bindings are
required by default. Optional bindings stay authored so a later
revision can restore them.

Use `--expect` to check the revision shown when you selected the part.
The new scene file sits beside the original to preserve relative
dependencies. The saved change updates just the selected placement's
file and revision. A second placement can continue using the old revision
of the same asset.

Use `KIT.authoring.assetRevisions.preview` and
`KIT.authoring.assetRevisions.replace` for the same check and scene
update in authoring scripts. For runtime placement, load each row with
`readAssetRevisionPart(file, instance, placement)` in Node or
`gltfAssetPart(asset, instance, placement, { toolkit })` in the browser.
Pass the keyed results as `assetPartImports` to `KIT.diorama.build`,
or install the complete set on a world with
`KIT.authoring.assetRevisions.install`. The loaded bindings are
available on `world.assetParts[instance].bindings`. The renderer
uses native triangle meshes and supports base-color textures and
skin joints in the source rest pose. Live clip and morph evaluation
remain with the existing glTF interchange workflow.

Run `node examples/asset-part-revisions.cjs asset-part-review` for a
matched native-grid comparison. The new relay housing keeps its paint
and hinge, moves the lamp socket, and retires an optional test port.
The power pack and the rest of the scene keep their existing revision.

## PNG-backed assets

Use `readRasterAsset(file)` and `writeRasterAsset(asset, { out })` for layered raster assets. `KIT.procedural.graph.raster(definition)` creates an asset from RGBA frames and provides `snapshot()` for edits. The manifest stores the canvas size, stacking order, opacity, optional layer `parent` and `material` names, frame rate, and tagged frame ranges. Optional asset, layer, and frame `pivot` values are `[x, y]` in top-down pixels. Layer samples expose the frame pivot first, then the layer or asset pivot. The parent and material names are authoring metadata.

Use `readSpriteAtlas(file)` and `writeSpriteAtlas(asset, { out })` for direction and elevation atlases. The sprite manifest keeps view rectangles, pivots, timing, map encodings, and cel replacements and holds. Its `snapshot()` returns the original channel pixels and authoring metadata.

PNG companions store straight 8-bit RGBA pixels. The manifest carries the information needed to reconstruct the full asset.

For validated static mesh resources, USD and USDZ exchange, MaterialX looks, and explicit Blender conversions, use [scene resources](scene-resources.md).
