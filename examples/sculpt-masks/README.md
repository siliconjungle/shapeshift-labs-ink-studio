# Ceramic instrument panel

Replay the four stages on the native 176 × 112 grid from the Ink repository.

```sh
node cli/ink-studio.js sculpt-masks examples/sculpt-masks/workshop.js \
  --plan examples/sculpt-masks/plan.json --out studio/out/sculpt-mask-review
```

1. Install the rest-space face sets and lock the bronze trim.
2. Carve a recess whose brush crosses the trim. The feathered shoulder probe receives half influence. The bronze receives zero, and the remesh verifies the surviving locked faces.
3. Hide the blue side cover. Its display faces and pick hits disappear in a control-only revision.
4. Isolate the carving set. The view keeps the new clay surface and the faces in the same rest-space region.

The report records each probe, face-set totals, dirty samples and exact rebuilt brick IDs. The final mask document can be applied to the same brick mesh again.
