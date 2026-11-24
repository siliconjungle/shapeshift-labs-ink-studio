# Shoulder-cap retopology

From the Ink repository root, run:

```sh
node examples/mesh-retopology/render.cjs studio/out/mesh-retopology
```

The three columns show a dense mesh, a signed sphere, and an opaque
scan proxy. Each patch adds 48 editable quads and stitches eight edges
to the existing bronze rim. The scan proxy is reconstructed from a
synthetic, registered RGB-D capture. Its GLB stays in capture coordinates.

The lower row shows the same patches with the topology and guides
visible. Gold marks the existing rim, mint the flow guide, copper the
joint arc, lavender the pinned seam, and ivory the pinned silhouette.
The report gives the maximum snap distance, sampled quad deviation,
source hits and exact retained vertex IDs.

Replay the scan patch from an extracted bundle with Ink installed:

```sh
ink-studio mesh-topology retopology scan-proxy-before.json scan-proxy-request.json \
  --surface scan-reference.glb --view scan-proxy-view.json \
  --preview replay --out replay-mesh.json --report replay-report.json
```
