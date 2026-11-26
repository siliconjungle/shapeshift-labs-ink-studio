# Edit a streamed splat pack

Use `stream-splats` to address individual finest-tier splats, edit across layer and cell boundaries, and publish updated tiers without reading the rest of the pack. The edited manifest still opens through the usual streamed pack loader. Edits use the pack’s baked RGB records, including covariance and supported center-depth footprints.

```sh
ink-studio stream-splats index pack/manifest.json
ink-studio stream-splats inspect pack/manifest.json --out catalog.json
ink-studio stream-splats inspect pack/manifest.json --chunk chunk-ID --out rows.json
ink-studio stream-splats edit pack/manifest.json patch.json --previous pack/previous.json --out edit-report.json
ink-studio stream-splats review pack/manifest.json views.json --previous pack/previous.json --out review
```

Index an existing pack in place. Current pack writers record their grid and voxel tiers. For an older pack that already has native cell coordinates, supply its original `--cell-size` and `--voxels` ending in zero. Legacy rebuilds default to raw payloads. Choose `--encoding irc1` to publish lossless compressed tiers. Indexed packs take incremental edits. Use a new destination when performing a full source repack.

The catalog reports the asset fingerprint and current epoch. Inspect a chunk to read its row addresses, positions, covariance, pigment, opacity, and footprint slots. Row inspection defaults to the first 5,000 rows. Use `--start` and `--limit` to page through a large chunk. An address starts as its original chunk ID and a zero-based finest-tier row separated by a slash. A row keeps that address when it moves to another cell or layer. Retired addresses stay retired, including after compaction.

## Apply an incremental patch

Copy `asset` and `epoch` from the catalog and put the edits in a version-1 patch.

```json
{
  "format": "ink-studio/stream-splat-patch",
  "version": 1,
  "asset": "<asset fingerprint>",
  "epoch": 2,
  "edits": [
    {"id": "chunk-ID/71", "pigment": 6736828},
    {"id": "chunk-ID/72", "translate": [0.2, 0.1, 0], "layer": "flare"},
    {"id": "chunk-ID/73", "remove": true}
  ]
}
```

Pigment is a packed `0xRRGGBB` value supplied as a JSON integer. Use `opacity` in the range zero to one. Zero opacity retires the row. `position` sets a new world-space center, and `translate` offsets it. `scale` takes a positive scalar or XYZ scale factors, and `orientation` takes an XYZW quaternion. Scale and orientation transform the covariance together. A row can appear once per patch.

An edit reads the finest payload only for its source and any existing destination cells. It locks edited rows against voxel merging, rebuilds those cells’ levels, and keeps untouched descriptors and files. A changed cell keeps an unchanged level’s revision when its encoded payload and profile match. Rebuilt compressed levels preserve the decoded finest values losslessly. New blobs and the receipt are written before the manifest is replaced. Keep the optional previous manifest beside its payloads to replay the old revision. Stale epochs are rejected. A patch supports up to 32,768 edits, 256 touched cells, and 262,144 decoded input rows.

## Export layers and measure a camera path

The review runs Ink’s residency scheduler against local payloads. Load an earlier manifest first to see which residents survive a revision update. A review plan can configure `budgetBytes`, `maxSplats`, `referenceSplats`, `targetPx`, `guardPixels`, `startsPerFrame`, `concurrency`, and up to 12 named `exportLayers`. Give it up to 16 registered views. Begin with any `before` views and follow with `after` views.

```json
{
  "budgetBytes": 310000,
  "maxSplats": 4200,
  "referenceSplats": 45000,
  "targetPx": 2.5,
  "exportLayers": ["lantern"],
  "views": [
    {"id": "before", "phase": "before", "w": 224, "h": 192},
    {"id": "after", "phase": "after", "w": 224, "h": 192},
    {"id": "remote", "w": 224, "h": 192, "camera": {"target": [58, 0.96, 42]}}
  ]
}
```

A view can pass native `camera` settings and `selected` chunk IDs to prioritize detailed tiers. The reference loads the finest tier of every visible chunk. Size its budget to cover the view. The report records requested files and bytes, evictions, resident reuse, draw counts, and selected levels. Both images use the same headless rasterizer. The report measures RGB error on the pack background, alpha error, silhouette intersection over union, and depth error where both renders have a splat contribution.

Each view includes native `layers.json` decks for the streamed color, finest reference, and requested isolated layers. Alongside opaque depth, the export writes `contribution-depth.png` and `contribution-depth.f32le`, which take the depth of the strongest visible splat and can represent translucent samples. Float depth is camera-axis scene distance with `+Infinity` for an empty pixel. Each view also has a three-times RGB residual.

## Replay Canal Signals

```sh
node scripts/build.js node
node examples/streamed-splat-edit/demo.cjs studio/canal-signals
```

The demo builds a 144-chunk canal district. It recolors a resident lantern and an unloaded one, moves a cap into its own layer, and removes a distant row. Three views show the revision change and the later load of the remote edit. Run the demo in a fresh output directory.
