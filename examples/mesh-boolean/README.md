# Gauge panel Boolean study

From the Ink repository root, run:

```sh
node examples/mesh-boolean/render.cjs studio/out/mesh-boolean
```

The six native-grid views show the gauge panel, mesh union, mesh
intersection, mesh difference, the requested SDF difference, and the
difference between the two solver results. The SDF pass uses a cell size
of 0.19. The mesh solver preserves the 0.12-unit fin. The sampled solver
loses the fin at the named probe and spreads some of its material onto
a nearby reconstructed surface.

The final panel uses coral for removed silhouette, mint for added
silhouette, amber for depth changes, and purple for material changes.
The JSON report gives world-space edge and wall probes and source
material ownership.

Replay a bundled edit from its extracted directory with Ink installed:

```sh
ink-studio mesh-topology boolean gauge.json fallback-request.json \
  --operand cutter.json --view view.json --preview replay \
  --out replay-mesh.json --report replay-report.json
```
