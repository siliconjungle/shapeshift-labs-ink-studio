# Coherent pixel clusters

Color clusters can track selected palette swatches across a shot. Ink measures the four-connected highlights and shadows after the [spatial color-cluster pass](pixel-look.md#material-color-clusters), compensates for camera and splat motion, and records which visible shapes persist, join, split, appear, or disappear. The pass edits resolved RGB at native art resolution and keeps the depth and ownership buffers intact.

Use the existing `look.colorClusters` setting or the `colorClusters` render option. Each target rule can give different swatches their own timing.

```json
{
  "maxMotion": 12,
  "targets": [{
    "select": { "material": "enamel" },
    "minPixels": 1,
    "coherence": [
      { "swatches": ["#ffd899"], "splitFrames": 3, "mergeFrames": 3, "holdFrames": 2 },
      { "swatches": ["#262943"], "birthFrames": 2, "splitFrames": 2, "mergeFrames": 3, "holdFrames": 1 }
    ]
  }]
}
```

| Setting | Behavior |
| --- | --- |
| `birthFrames` | Consecutive observations before showing a new patch. Defaults to 1. During the wait, Ink uses an adjacent untracked swatch from the same domain when available. |
| `splitFrames` | Consecutive observations before accepting a split. Defaults to 2. While waiting, the projected old footprint can fill the gap between the children. |
| `mergeFrames` | Consecutive observations before accepting a join. Defaults to 2. While waiting, Ink keeps the old islands and replaces newly connecting pixels where a valid donor is available. |
| `holdFrames` | Maximum consecutive frames to retain a missing patch. Defaults to 1. Set to 0 to release it immediately. |
| `overlap` | Minimum shared fraction of the smaller connected region after reprojection. Defaults to 0.35. |
| `maxMotion` | Greatest allowed reprojection distance, in native art pixels. Defaults to 12 and applies to all the targets in a definition. |

Frame counts are integers up to 60. Set `minPixels: 1` for time controls without spatial island merging. Timing advances with presented frames, including camera-only redraws. The first frame seeds the visible shapes. Stable IDs follow the strongest overlap across a split or a merge.

Reprojection uses visible splat centers and depth scale. A retained swatch can only land on an eligible pixel of the same object, material, and palette domain. Boundary protection, marked details, locked swatches, and authored target exclusions still apply. Ink leaves a gap when a foreground owner, a protected pixel, or a view change prevents a safe match. Screen clips without a camera can supply aligned pixel grids.

## Rendering and inspection

WebGL keeps a history per renderer. Headless CLI sequences create it automatically. For a custom Node render loop, share one `KIT.colorClusters.history()` as `colorClusterHistory` across frames. If your loop rebuilds the world object each frame, pass the same `colorClusterSource` while the underlying splat rows still correspond. Pass `resetColorClusters: true` or `resetRenderHistory: true` at a cut. Changes to the history source, native grid, projection, or rule definition and backward seeks start a fresh history.

Node exposes `frame.colorClusters.tracking`. Both backends accept a `colorClustersFrame(report)` callback. The tracking record includes the art dimensions, patch IDs and bounds, exact swatches, area, centers, lineage events, and counts of retained pixels and pending topology changes. Set `captureColorClusterLabels: true` for a top-down `Uint32Array` of the stable IDs. Zero denotes pixels outside the tracked patches. The native art grid can contain up to 1,048,576 pixels when coherence is active.

Generate the interactive [Mercury Current comparison](../examples/cluster-coherence.cjs) with `node examples/cluster-coherence.cjs mercury-current.html`.
