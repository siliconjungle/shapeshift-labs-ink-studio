# Registered part and LOD baking

Use the headless `material-bake` command to batch bake a part's detailed
surface onto separately authored receiver levels. Ink fits the cage in
rest space, preserves retained UV addresses, and exports all levels with
the native registered material maps and diagnostic receipts.
[Ferrylight Manifold](../examples/registered-part-bakes.cjs) bakes a
machined housing and a protected enamel legend at two levels of detail.

```sh
node examples/registered-part-bakes.cjs ferrylight
node cli/ink-studio.js material-bake inspect ferrylight/bake-plan.json
node cli/ink-studio.js material-bake run ferrylight/bake-plan.json --out ferrylight/replay
node cli/ink-studio.js material-bake preset indexed --out indexed-preset.json
```

## Name parts, levels and receivers

A version 1 `ink-studio/registered-part-batch` plan has a `preset`, optional
ordered `palette`, and 1 to 16 `targets`. Each target has a distinct `id`
and `part` plus zero-based `lod`. A part and level pair occurs once.
Paths are relative to the plan file.

```json
{
  "format": "ink-studio/registered-part-batch",
  "version": 1,
  "preset": "review",
  "targets": [
    {
      "id": "housing-near",
      "part": "housing",
      "lod": 0,
      "receiver": "housing-near.json",
      "layout": "housing-near-pages.json",
      "source": { "file": "housing-high.json" },
      "sampling": { "cage": { "search": 0.3, "margin": 0.06 }, "maxWork": 3000000 }
    },
    {
      "id": "housing-far",
      "part": "housing",
      "lod": 1,
      "receiver": "housing-far.json",
      "source": { "file": "housing-high.json" },
      "sampling": { "size": 64, "channels": ["pigment", "normal"] }
    }
  ]
}
```

The receiver is retained mesh topology or a scene with a named
`object` in `topologyMeshes`. Use static rest geometry and opaque
receiver materials. An optional `revision` checks the retained
topology before any bake work. The detailed source is native retained
mesh topology or indexed model JSON in the same coordinate system.
Resolve a source material's PNG path from its model file.
It can carry named source parts in `faceParts`, or the target can
provide a `source.faceParts` table keyed by source face ID. Omitted
source part tags default to the target part. The cage checks accepted
hits against that named part.

The destination defaults to the pigment layout. An explicit `uvSet`
chooses a retained layout number or channel. A `layout` from
[whole-asset UV preparation](whole-asset-uv.md) can supply multiple
pages, their faces and their dimensions. The layout must match the
receiver revision. Each page becomes one native registered export
mesh. Without a layout, the target uses one square atlas and keeps
the normalized UVs. With a layout, native texel centers retain their
original X and Y addresses in the square export canvas. The receipt
shows the conversion and each retained corner pin. Use a large enough
canvas for the native sheet.

Use `protectPigment` to list receiver face IDs whose underlying
color or registered pigment texture should carry through cage sampling.
Normals and other requested channels can still transfer on those
faces. The original scene and its textures stay intact. Using a
palette also quantizes the output pigment on protected faces.

## Fit and review a cage

Each target may override atlas `size`, `padding`, projected
`channels`, normal `direction` (`geometric` or `smooth`),
`minFacing` or the `maxWork` ray budget. A target's default size
of `"sheet"` chooses a power-of-two canvas large enough for its native
page. A target without a layout defaults to 128. Direct sizes
are 32, 64, 128, 256, 512, 1024 and 2048. A batch caps pages,
total texels, source faces and ray work.

Automatic setup probes triangle interiors along receiver normals.
It looks for the nearest facing sample on the expected part in either
direction, then pads the observed signed range. Set
`sampling.cage.search`, `margin`, or `maxProbes` to tune the probe.
The default search derives from the receiver's bounds. An empty
search fails with the target still unbaked. The probe is a sampled fit.
Keep enough margin for details between probes and inspect the cage
miss, backface, and cross-part masks after baking. To use an authored
envelope, supply `front` and/or `back` instead of the probe settings.

The export records per-page and per-part totals, signed relief, and
representative accepted and rejected samples. Seam diagnostics sample
opposite sides of shared rest-geometry edges whose UVs have a cut
or material boundary. The receipt records coverage, the largest RGB
byte difference, and angular separation after decoding tangent normals
into rest space. Use the named page and texel pairs to inspect each
flag. A material boundary or an intentional hard edge can explain a
flag. Flags appear in the report for review.

## Fixed palette slots and export presets

A `palette` can be an inline version 1 `ink-studio/pixel-palette`
asset or its JSON path. Ink preserves the authored swatch order and
writes an indexed pigment PNG in addition to the normal registered
pigment map. Unoccupied pixels use a transparent slot. Occupied
pigment and its filtered mip levels use the declared colors.

A pin has an `id`, `swatch`, either an integer `at` texel or a
normalized `uv` coordinate in the destination layout, and a
`tile` address for a multi-page target.

```json
{ "id": "warning-lamp", "swatch": "signal", "uv": [0.38, 0.32], "tile": [0, 0] }
```

Pins resolve independently at each LOD and use the same palette
indices. A pin must land on a covered receiver texel. Ink applies the
pin before extending gutters. The pin constrains the base-level
texel. Coarser levels follow native chart-owned filtering and
quantize into the same palette.

`material-bake preset` exports `review`, `compact`, and `indexed` as
version 1 `ink-studio/registered-export-preset` JSON. The preset
records sampling and the seam thresholds. Review uses four pixels of
padding. Compact uses two pixels of padding and fewer seam taps.
Indexed requires a palette. Load a preset by its name, file path, or
as an inline preset document, and override its sampling per target.

A successful run publishes a revision folder with `manifest.json`,
one model and registered map set per target, and seam reports. The
output's `latest.json` points to the completed package. A failed
target leaves the previous completed package available.
