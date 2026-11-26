# Whole-asset UV preparation

Use `mesh-uv prepare` to propose seams, repair movable charts, and lay out
every retained face on native UV tiles. [Switchback Relay](../examples/whole-asset-uv.cjs)
paints a label, prepares the surrounding housing, and validates the
source and prepared layouts as one batch.

```sh
node examples/whole-asset-uv.cjs switchback-relay
node cli/ink-studio.js mesh-uv prepare switchback-relay/painted.json switchback-relay/prepare-request.json
node cli/ink-studio.js mesh-uv prepare switchback-relay/painted.json switchback-relay/prepare-request.json \
  --out switchback-relay/replayed.json --layout-out switchback-relay/replayed-pages.json \
  --report switchback-relay/replayed-report.json
node cli/ink-studio.js mesh-uv validate-batch switchback-relay/approved-batch.json
```

## Prepare the retained mesh

Inputs are retained mesh topology documents and editable scenes.
A scene run prepares every retained mesh unless `--object` selects one.
Omit `--out` for a preview. Write a revised scene beside its source so
relative references resolve from the same directory.

```json
{
  "uvSet": "pigment",
  "atlas": [64, 64],
  "texelsPerUnit": 16,
  "densityTolerance": 0.16,
  "maxStretch": 1.8,
  "seamAngle": 58,
  "gutter": 2,
  "maxTiles": 16,
  "columns": 4
}
```

- `uvSet` is a retained UV set number or a material channel name.
  It defaults to `pigment`. A separate existing layout such as an
  authored `bake` set can be prepared independently of pigment.
- `atlas` sets the dimensions of new pages in texels. Existing registered
  maps supply their own dimensions.
- `texelsPerUnit` is measured in model space. `densityTolerance` is the
  permitted fractional difference from the target on each triangle.
  `maxStretch` caps the ratio of the longest to shortest local
  UV stretch.
- `seamAngle` proposes cuts at folds at or above the specified degrees.
  `gutter` reserves pixels around packed charts. `maxTiles` caps the
  page count per mesh. `columns` sets the tile grid width.
- `maxChecks` caps triangle comparisons. The planner accepts up to
  12,000 faces and 24,000 triangles per mesh and up to 1,024 charts.
  A request for one mesh can include a topology `revision` from
  `mesh-uv layout`.

The planner scales an existing movable chart when its shape passes
the density, stretch, winding and internal overlap checks. Otherwise
it tries a planar fit. A chart that still fails can split along
existing face edges. A single face can use the intrinsic flatten
solver. Geometry and stable corner IDs stay in place through the edits.
Separate pages and destination gutters resolve cross-chart collisions.

A chart can exceed a page or remain distorted at the requested
settings. The receipt names the affected faces. A blocked plan writes
its report and leaves the source unchanged. Committing a blocked plan
returns exit status 1.

## Pinned texels and edited maps

An island holds its original material slot and coordinates if it has a
pinned corner, a protected span, or a registered texture on the selected
layout. The CLI also holds relevant retained authoring bindings and
materials with an active bake. Use a separately bound bake layout to
prepare geometry that already has pigment. Existing channels on other
UV sets keep their addresses.

For a standalone mesh or scoped scene object, add an optional protection
object to name approved seams and painted regions explicitly.

```json
{
  "protect": {
    "seams": ["crease-edge"],
    "painted": [{ "id": "maker-mark", "faces": ["label"] }]
  }
}
```

The report records held faces and exact pin coordinates in texel centers.
Protected paint stays on its original sheet with its original bytes.
Conflicts between held charts are reported by face ID. A held chart can
still have a density or stretch issue for batch review.

## Native layout bundle

`--layout-out` writes an `ink-studio/uv-layout-bundle` version 1 document.
Each mesh entry contains its object ID and an `ink-studio/uv-tile-layout`
with the mesh revision, UV set, held faces, and a table of pages. Each page
supplies its two-dimensional tile address `at`, native material slot,
source material, texel dimensions and assigned faces. Local UVs remain
normalized within each material page.

A scene export retains the original texture definitions and copies source
material settings to new page slots. Those slots can act as distinct
bake destinations. The layout declares their target dimensions before
an image is authored there. Downstream rules keyed by particular
material IDs can use the source-material links in the layout.

## Batch density validation

Give `mesh-uv validate-batch` a version 1 `ink-studio/uv-density-batch`
manifest. Paths resolve from the manifest directory. Each asset needs
an `id` and a `file`. Optionally specify `object`, `layout` and
`settings` overrides. A prepared asset's layout verifies the revision
and supplies the exact dimensions for each page.

```json
{
  "format": "ink-studio/uv-density-batch",
  "version": 1,
  "settings": { "texelsPerUnit": 16, "densityTolerance": 0.16, "maxStretch": 1.8 },
  "assets": [
    { "id": "relay", "file": "prepared.json", "layout": "uv-pages.json" }
  ]
}
```

Validation reports per-face triangle counts, density range, worst
stretch, and failures. It checks overlap within each page and reports
the number of intersecting triangle pairs. Use
`acceptHeldDensity: true` to accept density exceptions for held
paint or pins. Distortion and overlap remain failures. The command
writes the report with `--out` and returns exit status 1 if any asset
fails. A batch accepts up to 32 entries.

The SDK provides `KIT.meshTopology.uvPreparation.prepare` and
`KIT.meshTopology.uvPreparation.validate` for retained mesh documents.
