# Tide gauge sculpt detail

From the Ink repository root, run:

```sh
node cli/ink-studio.js sculpt-detail examples/multires-sculpt-detail/tide-panel.js \
  --plan examples/multires-sculpt-detail/plan.json --out studio/out/tide-detail
```

1. The smooth gauge is the form reference.
2. Five engraved lines are sculpted on the fine lattice at a cell size of 0.06.
3. A separate form edit bulges the center, cuts an opening, thins the wall at the right, and adds an overhang. This pass uses cells of size 0.12.
4. The fine lines follow the bulge at the original resolution. The thin wall, cutout, and overlapping sheets are flagged and excluded from transfer.

The chart map uses mint for eligible relief, purple for folds, amber
for thin walls, and coral for missing surfaces. Dark gray denotes valid
samples with zero relief. The native depth-change map compares stages
3 and 4 only. Peach marks surface that moved farther from the camera, as
it does in a groove. Mint marks surface that moved closer.

The report gives per-sample evidence in solid space and the final
dirty-brick work. The layer JSON holds the captured relief for later
reprojection onto another coarse revision.
