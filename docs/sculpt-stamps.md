# Compound sculpt stamps

Place a reusable recipe that adds several solids and carves them in one edit. A cutter can also open the existing solid beneath the stamp. Each added piece keeps its own material.

```sh
ink-studio sculpt-stamp place base.json socket.json placement.json --out stamped.json
ink-studio render stamped.json --ortho --out stamped.png
```

The recipe names the solids to add and the shapes to subtract. All pieces use the same stamp coordinates.

```json
{
  "format": "ink-studio/sculpt-stamp",
  "version": 1,
  "add": {
    "collar": { "kind": "lathe", "at": [0, 0.1, 0], "h": 0.4, "r": 0.6, "mat": "stone" },
    "lip": { "kind": "lathe", "at": [0, 0.48, 0], "h": 0.12, "r": 0.62, "mat": "metal" }
  },
  "cut": {
    "bore": { "shape": { "kind": "lathe", "at": [0, -0.6, 0], "h": 1.4, "r": 0.34 } },
    "keyway": {
      "shape": { "kind": "box", "at": [0.34, 0.55, 0], "half": [0.1, 0.12, 0.14] },
      "targets": ["lip"],
      "host": false
    }
  }
}
```

- Pieces are bounded [diorama solids](reference/api-kit-a-f.md#kitdiorama). Use a piece's own `transform` for its local offset, orientation, and scale. The recipe keys provide the piece IDs.
- A cutter defaults to all added pieces and the selected host. Give it `targets` to select specific pieces. Use `host: false` to leave the host alone or `targets: []` to cut only the host.
- The placement-file ID is unique in the scene. The CLI writes a new scene beside the original so relative assets resolve the same way.

```json
{
  "id": "intake",
  "target": "plate",
  "transform": { "translation": [0.8, 0, 0], "rotation": [0.35, 0, 0] }
}
```

The placement transform uses yaw, pitch, and roll in radians and an optional uniform scale. With a target, the placement is relative to the host solid's untransformed coordinates. At placement, Ink applies the host's transform to the new pieces. The pieces also inherit the host's moving part. Supply the ID of a top-level editable exterior solid. Omit `target` to place the stamp in scene coordinates.

The saved scene contains ordinary solids such as `intake.lip` and scoped mask modifiers such as `intake.bore`. You can edit these directly. The recipe remains a separate reusable file. Changing it affects future placements.

Use `editor.placeSculptStamp(recipe, placement)` in the [headless scene editor](scene-editor.md) for one undoable edit. It returns the IDs of the added pieces.

```sh
node examples/sculpt-stamp-demo.cjs /tmp/ink-stamp-demo
```

The demo writes the plate, recipe, placement, stamped scene, and a before-and-after PNG.
