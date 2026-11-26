# UDIM and batch baking

Use a batch plan to assign named UV tile sets to existing bake-job targets, run jobs in parallel, and publish delivery aliases.

```sh
ink-studio bake-job batch breakwater.batch.json --out breakwater-output
```

Open the revision's `index.html` to review which work units were baked or reused, inspect tile thumbnails, open the combined bake reviews, or download output aliases. `latest.json` updates after the complete batch is published. A failed or cancelled run leaves the prior revision available.

## Tile sets and output aliases

```json
{
  "format": "ink-studio/bake-batch",
  "version": 1,
  "label": "Breakwater Signal",
  "workers": 3,
  "memoryMb": 640,
  "tileSets": {
    "plates": [[-1, 0], 1001, 1002]
  },
  "jobs": [
    {
      "id": "plates",
      "job": "enamel.bake.json",
      "heapMb": 128,
      "tiles": {"enamel": "plates"},
      "aliases": [
        {"name": "signal-glaze", "target": "enamel", "map": "pigment"}
      ]
    }
  ]
}
```

A job can choose a `preset` file and assign each target a named tile set or an inline tile list. Other targets inherit their authored tiles. Job and preset paths resolve from the batch plan. Source textures and geometry resolve from their own bake job. Tile sets accept UDIM numbers or signed `[u,v]` pairs. Each set supports up to 32 tiles.

Aliases have unique, case-insensitive names across the batch. They use the map's delivered type and names such as `signal-glaze.1002.png` or `signal-glaze.u-1_v0.png`. Mips append `.mip-N` and paired validity masks append `.valid.png`. The batch report records the original per-job reviews and the aliased files with their hashes. Resource refreshes in the source bake job run after all its tiles are assembled.

## Cache and incremental work

Independent maps use a work unit per target and tile. Height and curvature keep a target's tiles together so shared normalization sees the full range. Occlusion keeps the complete job together because its scene can depend on several receivers.

The cache verifies the engine, bake recipe, dependencies read by the worker, and delivered artifact hashes. Changing the pixels in a linked source for tile 1002 invalidates the units that read that file. Changing a shared GLB, shared texture, or effective bake settings can invalidate several units. A change to the texture registry is treated as a recipe change. Unchanged units carry forward byte-for-byte. Alias renames reuse the existing bake files and generate new delivery filenames. A corrupted cache entry is rebuilt.

Set `cache.policy` to `reuse` (default), `refresh` to rerender and replace entries, or `off` to bypass cache storage. Set `cache.maxMb` (default 512) and `cache.maxEntries` (default 192) to bound the cache. The cache lives under the batch output directory. Published revisions are independent of cache eviction.

## Schedule workers

`workers` is the maximum concurrent bake count. `memoryMb` is the aggregate worker admission budget in MiB. Each active unit reserves its configured V8 heap plus an estimate for geometry, samples, and codecs. The scheduler admits units only while their reservations fit. Each worker also has a V8 heap limit. The reservation is an estimate for scheduling, and the report records the peak reservation and worker count. Cache hits launch no bake worker and take no worker reservation.

## Breakwater Signal demo

```sh
node examples/udim-batch-bake/demo.cjs breakwater-demo
```

Open `breakwater-demo/index.html` and switch between the initial bake, the unchanged rerun, and **Edited tile 1002**. The demo uses two jobs and four work units. Editing the east glaze reruns one unit while preserving the three other outputs.
