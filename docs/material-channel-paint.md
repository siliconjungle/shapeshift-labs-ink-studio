# Material-channel painting

Connect a typed `materialChannels` packet to `material.paint`. Pass an editable `ink-studio/material-paint` session to its `session` port. The `value` output can feed `material.image`, a normal bake, an export, or a scene material. The `report` lists layer coverage and the changed texel count, bounds, extent and precision per channel. Each unaffected channel and its metadata pass through.

Painted maps need a typed image. Use `image.declare` for a legacy raster or import a [bitmap resource](bitmap-resources.md) with an explicit interpretation. Maps can use different extents. The material canvas accepts axes up to 8192 texels and up to 16,777,216 texels per map. Brush work and the number of changed texels per session are bounded. Color composites in linear light. A canvas's precision, opacity convention, pixel pitch and units carry through the graph. A floating linear color map can keep HDR values, a height map can retain signed physical units, and a two-lane `flow` map can retain signed UV velocities. Set optional `canvases.<channel>.precision` and `colorSpace` to convert a channel within the paint session. Resample a map upstream if you need a new extent.

```json
{
  "format": "ink-studio/material-paint",
  "version": 1,
  "layers": [
    {
      "id": "phosphor",
      "channel": "emission",
      "mask": "mask.inlay",
      "strokes": [
        {
          "space": "uv",
          "samples": [[0.25, 0.55], [0.68, 0.48]],
          "brush": { "radius": 18, "hardness": 0.55 },
          "value": [0.08, 2.4, 1.3],
          "colorSpace": "srgb-linear"
        }
      ]
    }
  ]
}
```

## Painting controls

| Control | Behavior |
| --- | --- |
| Layers | Each layer targets a named channel. Set `visible`, `locked`, `opacity`, or a blend of `normal`, `multiply`, `screen`, `overlay`, or `add`. Use `mode: "erase"` to lift the current layer's paint and reveal the layers below. |
| Masks | A layer's `mask` names a typed mask from the node's `masks` record or a normalized scalar map in the material. The mask must match the target extent. Previously composed paint can provide a mask for subsequent layers. |
| Selection | Each stroke can take an Ink selection query, such as a rectangle, ellipse, lasso, wand, combine, or grow. A `channel` query can select a component in a named aligned map by range. Selection reads the canvas beneath the current layer. The wand compares the visible byte preview. Channel ranges use working samples. |
| Brushes | The round brush accepts a radius in texels, hardness, aspect, angle in degrees and dab spacing. An indexed `{ "kind": "tip", "definition": { … } }` uses an existing brush's holes, rotation, and pressure or speed dynamics with the supplied material paint value. Samples can be points or `{ "at": […], "time": 18, "pressure": 0.6 }` records. Time is elapsed milliseconds. Round brush pressure scales radius. |
| Symmetry | Supply native `mirrorX` or `mirrorY` axes at pixel or half-pixel positions. Use `wrapX` and `wrapY` for repeated texture edges. Mirroring also reflects tangent normal and UV flow components. |
| Flow | Supply an existing Ink flow-map asset in `flows` and name it with the stroke's `flow` field to orient a round brush. Paint the `flow` channel with a fixed `velocity: [u,v]` or `velocity: "stroke"` with `speed` in UV units per second. |
| Brush value | Use one scalar, a signed normal, a UV velocity, or RGB(A). Color input defaults to the destination encoding. Set `colorSpace` to assign a different encoding. |

## Coordinates and editing

Texel coordinates use zero-based centers. UV coordinates use top-left normalized edges. For a world or rest stroke, set `space` and `chart` and supply XYZ samples. Each chart contains its `space`, an existing Ink plane, cylinder, or ribbon `projection`, and two positive chart spans in `extent`. An optional `offset` sets the start of those spans. Place charts in the saved session or wire the node's `charts` record. A host can pass a picked world hit or its corresponding rest hit to the same brush. An out-of-chart sample fails unless it falls within the enabled wrap range.

Use `KIT.procedural.materialPaint.create(packet, document, { masks, charts, flows })` for an interactive journal. Apply `stroke(layerId, stroke)`, `editLayer(id, settings)`, `addLayer(layer)`, and `moveLayer(id, index)`. Paint commits only after validation and supports `undo()` and `redo()`. `snapshot()` returns the editable session for the graph and `preview()` returns the current packet and report. Saving the material with that snapshot preserves the ordered strokes and original source maps.

## Tideglass demo

```sh
node examples/material-channel-paint/demo.cjs
```

Open the printed HTML path. Paint glaze, relief, phosphor, roughness, or flow on the enamel plate. Choose UV, world, rest, or texel coordinates, compare before and after, and download the material to replay the session with its source bitmaps. The graph derives the preview normal map from painted height. The lit panel is a texture-space preview with an adjustable light angle.

For paint bound to scene geometry, [review the same paint at multiple camera ranges](pixel-art-authoring.md#compare-paint-and-finish-across-camera-ranges) with a shared world-space key and separate pigment, relief, roughness, and highlight views.
