# Linked 3D material preview

Generate a preview from a material graph and a carrier plan. Use [displacement preview](material-displacement-preview.md) to compare a graph height map as flat, parallax, and tessellated relief. Pick a slot or UV tile in the controls, or click a visible surface to open its map and mark the source texel. Click the 2D map to locate the nearest visible sample of that UV in the current view. The selected region stays outlined as the camera moves.

```sh
ink-studio graph material-preview material.material.json preview.plan.json --out preview
```

Open `preview/index.html`. The portable review directory contains native Ink renders, source maps, and the renderer's screen-space sample data. The orbit control moves through those rendered angles. Generate the preview again after editing the graph or carrier. Use `--inputs overrides.json`, `--instance ID`, `--at seconds`, and `--seed N` to preview a particular evaluation.

## Bind carriers and material slots

```json
{
  "format": "ink-studio/linked-material-preview",
  "version": 1,
  "label": "Harbour Relay",
  "targets": [
    { "id": "relay", "kind": "mesh", "label": "Relay housing", "file": "relay.obj" },
    { "id": "sphere", "kind": "sphere", "slot": "Enamel", "uvGrid": [2, 1] }
  ],
  "slots": {
    "Enamel": { "output": "enamel", "tiles": [1001, 1002], "tileInput": "tile" },
    "Bronze": {
      "maps": {
        "baseColor": { "map": "bronze-color" },
        "roughness": { "map": "bronze-finish" }
      }
    }
  }
}
```

Use a `sphere`, `plane`, or `cube` with a named slot. Optional `uvGrid` stretches the primitive's chart over `[columns, rows]` tiles. A `mesh` target reads a UV-bearing OBJ, glTF, or GLB. An `ink` target reads a retained Ink mesh topology, an Ink triangle asset with a texture carrier, or a UV-bearing Ink GLB. File paths are relative to the plan. Imported slots retain their source material names. Repeated names receive a numbered suffix. Choose `uvSet` to override the selected layout on an imported target.

Use `output` with a typed base-color output or [material channel packet](material-graph-ports.md). Alternatively supply `maps` keyed by channel name. Each map selects a graph `output` or a published output usage with `map`. The preview shades with base color, tangent normals, roughness, metalness, emission, and opacity. Height supplies a normal map when no tangent normal is bound. Heights, named masks, and other typed maps in the binding are selectable in the surface and 2D map panes.

`tiles` defaults to `[1001]`. Supply UDIM numbers or signed `[u,v]` coordinates. A `tileInput` selects the named graph input that receives each UV pair. Feed it to a tiled [bitmap resource](bitmap-resources.md) or any other editable graph branch. The preview clips crossing triangles at tile boundaries so each fragment samples its own tile. OBJ tile numbers use the authored vertical coordinate and local images are still displayed top-down. Geometry in an unbound slot or tile uses a neutral preview with no linked graph map.

The optional `view` record sets `width`, `height`, `steps`, and `textureSize`. The first two set the native render grid. `steps` sets the orbit sample count. `textureSize` caps the shading texture edge. The map pane retains the graph image's extent.

## Review material passes

Use **Surface pass** for Beauty, base color, tangent normal, roughness, ambient occlusion, height, opacity, emission, metalness, or a named map from the graph. Maps are projected using each visible pixel's native UV, slot, and tile. Muted violet marks surfaces with no binding for the selected map. The separate **Source map** selector gives access to the entire underlying image, including opacity texels the renderer cuts away.

The diagnostics include material ID, surface UV, camera-axis depth, depth-owner coverage, and map bindings. Material IDs are one-based slot/tile region indices scoped to a carrier, with zero reserved for background. In Surface UV, red encodes U and green encodes V. Depth is displayed over the current view's range. The samples retain its actual camera-axis units. Map bindings shows where a slot/tile has any graph map attached.

Click the surface or the map to see the exact texel address, component values, source precision, and units or color encoding. Use the arrow keys when the 2D map has focus. The readout preserves stored integer values and floating-point samples at the graph's original extent. An on-surface sample also reports its native screen pixel, material ID, slot, UV, depth, and coverage. The browser loads the lossless sample files on demand, so keep the generated `samples` directory with the preview.

## Pin A/B and compare variants

**Pin A** and **Pin B** freeze the active variant, carrier, angle, and pass independently. Continue exploring the live preview or replace either pin with the current view. Click either pinned image to inspect the same native screen pixel in both. Use a matching carrier and angle to compare the same material location.

A plan may include up to three named `variants`. Each can override graph `inputs`, `time`, or `seed`. The unmodified evaluation is **Current**. A per-tile input remains controlled by its slot binding, and the render and texel budgets apply to the whole preview.

```json
"variants": [
  { "id": "weathered", "label": "Weathered glaze", "inputs": { "weathering": 1 } }
]
```

## Reproduce the demo

```sh
node examples/linked-material-preview/demo.cjs /tmp/ink-relay
ink-studio graph material-preview /tmp/ink-relay/harbour-relay.material.json /tmp/ink-relay/preview.plan.json --out /tmp/ink-relay/replay
```

The relay housing has separate enamel and bronze slots. Its front carries two different enamel tiles on adjacent UV regions. The demo includes the imported OBJ, a retained Ink topology carrier, three primitives, and an editable material graph with embedded maps.

The Vesper Relay example exercises the full pass viewer with two glaze variants, a cutout, an emissive lamp, and floating-point height and AO.

```sh
node scripts/build.js node
node examples/material-passes/demo.cjs /tmp/ink-vesper
```

For an editable HDRI, reusable room and camera rigs, and live environment reflections, use the [material lighting room](material-lighting-room.md).
