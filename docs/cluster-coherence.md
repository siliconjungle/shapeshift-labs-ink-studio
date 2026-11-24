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

## Paint an exact correction

Set `look.shotCorrections` or use the `shotCorrections` render option to
carry a handmade highlight or shadow through a shot. Paint at the native
art grid and pin the drawing to a visible splat surface. The pin is
projected from the current posed splat, then the drawing moves with it
in whole art pixels. Palette colors, outlines, native highlight cels,
and cluster decisions resolve before the correction. The correction
changes the visible color while leaving cluster lineage, depth, and
ownership available for inspection.

```js
const { KIT } = ink.load();
const { shotCorrections } = KIT;
const source = ink.render(world, {
  w: 194, h: 132, px: 1, t: 23 / 12, captureShotCorrectionSurface: true
});
const anchor = source.shotCorrectionSurface.pin(111, 54);
const track = shotCorrections.paint({ size: [source.w, source.h], fps: 12 }, {
  id: 'crown-hook',
  frames: [23, 26],
  anchor,
  pixels: [[0, -1, '#fff1bc'], [0, 0, '#fff1bc'], [1, 0, '#fff1bc']]
});
const result = ink.render(world, {
  w: 194, h: 132, px: 1, t: 24 / 12, shotCorrections: track
});
```

Use a capture from the same shot, and pick a pixel on the surface you
want to edit. `pin(x, y)` uses top-left native art coordinates and
returns a serializable anchor or null. It uses a stable string ID from
`world.splatIds` when available, or the splat row in a scene that
keeps its row order. A named object, part, or surface allows the
correction to cross neighboring splats on that same material. Visible
ownership and depth are checked for every painted pixel, including
when another object crosses the hook. Anonymous paint stays on
the captured owner. Set `depthTolerance` in scene units to tune
the depth check on a curved surface. By default it covers the
projected span of three art pixels at the anchor.

Each paint entry gives X and Y offsets from the pin and an exact
`#rrggbb` swatch. The authored grid must match the shot's native
width and height. The held shape is preserved at that grid size.
`frames` is a zero-based inclusive range. In the example, the
correction is released on frame 27. Supply `startTime` in seconds
to start the track at a shot boundary or `shotCorrectionFrame`
in renderer options to address an exact frame when scrubbing.
Corrections are applied in document order. Add or replace a correction
by ID using `paint`, and save the returned document as JSON.

For separate frame keys, use `keys: [{ frame, pixels: [{ anchor, color }] }]`
in place of the held `anchor` and offset `pixels`. Each pixel uses its
own stable splat ID and exact RGB. Ink checks the original splat owner
and depth at that key. Frames between keys keep the rendered image.
Generate these keys from witnessed native pixels with
[tracked edits on moving parts](pixel-art-authoring.md#place-a-tracked-edit-on-a-moving-part).

Node exposes a `shotCorrections` report with the shot frame,
projected anchor locations, and painted or clipped pixel counts.
Both renderers support `shotCorrectionsFrame(report)`. In WebGL,
set `captureShotCorrectionSurface: true` and pass a
`shotCorrectionSurfaceFrame(surface)` callback to obtain the
same pin picker as Node. The edit uses visible depth-writing splat
surfaces in the primary view. On a headless shot with a sampled
shutter, the exact pixels are applied after the shutter integrates.

[Kingfisher’s Turn](../examples/shot-correction.cjs) shows a two-pixel
split in the original gloss while a three-pixel painted hook holds
for four frames. Scrub, repaint individual cells, set a new surface
anchor, and change the release frame in the browser editor.

```sh
npx esbuild src/webgl/renderer.mjs --bundle --format=esm --outfile=/tmp/ink-shot-renderer.mjs
node examples/shot-correction.cjs /tmp/ink-shot-renderer.mjs /tmp/ink-kingfisher
```

Open `/tmp/ink-kingfisher/kingfisher-turn.html` in a WebGL 2 browser.
