# Round-trip asset interchange

`ink-studio interchange <input.gltf|input.glb|manifest.json> --out <output>` reads the asset and writes it to a new location. Choose `.gltf` or `.glb` for glTF input and `.json` for a raster or sprite atlas manifest. Keep the PNG companions with their manifest.

## glTF and GLB

Use `readGltfAsset(file)` and `writeGltfAsset(asset, { out })` from the Node entry point. The output contains its binary data and textures. The retained document includes scene roots, node hierarchy and local transforms, material slots, textures, skin data, morph targets, animations, and extras. Local companion buffers and images are packed into a single buffer.

- `asset.snapshot()` returns independent copies of the glTF document and the binary buffer.
- `asset.withDocument(document)` validates an edited document against the retained buffer and returns a new asset. Keep buffer view and accessor references aligned with the binary data.
- `asset.sample(time, { scene, clip })` returns the selected scene's local and world node transforms, material slots, and morph weights. Pass a zero-based clip index or unique clip name to evaluate its core animation channels. Skin data remains available for downstream deformation. Extension channels remain in the document.
- `KIT.authoring.gltfAssets.create({ document, binary })` creates the same asset from a self-contained document with a single embedded buffer payload in Node or the browser.

The glTF pivot is the node's local origin. Use parent and child transforms to represent a pivot offset in other glTF applications. An explicit `node.extras.inkStudio.pivot` is retained and exposed as metadata when present. The [glTF 2.0 specification](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html) defines node transforms and animation channels.

## PNG-backed assets

Use `readRasterAsset(file)` and `writeRasterAsset(asset, { out })` for layered raster assets. `KIT.procedural.graph.raster(definition)` creates an asset from RGBA frames and provides `snapshot()` for edits. The manifest stores the canvas size, stacking order, opacity, optional layer `parent` and `material` names, frame rate, and tagged frame ranges. Optional asset, layer, and frame `pivot` values are `[x, y]` in top-down pixels. Layer samples expose the frame pivot first, then the layer or asset pivot. The parent and material names are authoring metadata.

Use `readSpriteAtlas(file)` and `writeSpriteAtlas(asset, { out })` for direction and elevation atlases. The sprite manifest keeps view rectangles, pivots, timing, map encodings, and cel replacements and holds. Its `snapshot()` returns the original channel pixels and authoring metadata.

PNG companions store straight 8-bit RGBA pixels. The manifest carries the information needed to reconstruct the full asset.
