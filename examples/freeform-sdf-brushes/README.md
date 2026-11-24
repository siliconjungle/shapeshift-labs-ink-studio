# Freeform SDF relief studies

From the Ink repository root, run:

```sh
node examples/freeform-sdf-brushes/demo.cjs studio/out/freeform-sdf-brushes
```

The sheet shows the original relief, the edited relief, and a matched
depth-change map in each row. Mint marks surface that moved closer or
appeared. Orange marks surface that moved farther away or disappeared.

1. Grab pulls the ears outward with a solid-space mirror.
2. Flatten raises the shoulder into a tangent plane using a native pixel radius.
3. Scrape shaves the face below its original tangent plane.
4. Crease cuts a continuous groove from three pixel marks.
5. Pinch draws both ears toward reflected tangent lines.

The output includes the original scene, the bound drawing, independent
edit commands, the five edited scenes, and the native captures. To replay
an edit from the bundle with the Ink CLI, run:

```sh
ink-studio pixel-art preview drawing.json grab-edit.json --scene relief-studies.json
ink-studio pixel-art edit drawing.json grab-edit.json --scene relief-studies.json --out grab-replayed.json
```
