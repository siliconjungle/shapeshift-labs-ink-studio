# Deep OpenEXR export

Export Ink's deep camera rays as a lossless, single-part deep scanline OpenEXR. Every pixel carries a variable number of samples sorted by increasing depth. The export uses the native art grid. An empty ray has zero samples.

```sh
ink-studio export-deep examples/deep-openexr/signal-relay.js \
  --w 232 --h 158 --t 0 --out relay-plates.exr
```

Pass a directory to write a take with numbered EXRs and a `deep.json` manifest. Specify increasing sample times with `--t 0,.5,1` or with `--from 0 --to 1 --n 3`. Use `--px 2` to export the art grid at half the requested width and height. Use `--reflection ID` to export a named native planar reflection from its mirrored camera.

## Channels

| Channel | Encoding |
| --- | --- |
| `R`, `G`, `B` | Float32 premultiplied linear sRGB, decoded from each Ink fragment's shaded RGB after its per-ray media transfer. |
| `A` | Float32 sample coverage before nearer layers. Use this for deep over or merge. |
| `Z`, `ZBack` | Float32 positive camera-axis depth in Ink world units. They are equal because these are point samples. |
| `ink.visibleCoverage` | Float32 coverage after attenuation by nearer retained samples. Use it for inspection of the original ray. |
| `ink.kind`, `ink.objectId`, `ink.materialId`, `ink.splatId` | UINT32 fragment IDs. `inkIds` in the header maps kind, object, and material IDs. Ink's splat index is one-based and zero indicates an unassigned sample. |
| `ink.surface.R/G/B`, `ink.scatter.R/G/B`, `ink.transmission.R/G/B` | Float32 source color and media transfer in Ink's fragment color space. They store the terms of `scatter + transmission * surface` before conversion to linear sRGB. |

The header includes `worldToCamera` with positive forward Z, `worldToNDC` with normalized top-down image coordinates, and the orthographic `inkCameraSetback` in world units. Match the exported camera and native image dimensions when rendering replacement geometry. Use the same image and depth coordinates when merging another deep plate.

The export captures a single camera view and time ahead of screen-wide look and shutter effects. Camera-ray media is baked into each point's color. Refracted donor-pixel addressing, reflection routing onto the main image, and the continuous intervals of fog or water are separate from the exported point samples. Use a native reflection file for work in a mirrored view.

Ink's existing [deep capture](art-passes.md#deep-compositing) supports up to 16 retained samples per pixel and a two-million-slot budget shared with any reflection capture. The exporter defaults to the largest layer count that fits the native image. Supply `--layers N` to choose a cap, or `--coalesce off` to keep coincident contributions separate. An export that loses samples at the cap fails by default. Use `--allow-truncated on` to publish the retained samples and record the dropped sample and pixel counts in the EXR header and take manifest.

## Node API

```js
const bytes = ink.encodeDeepEXR(frame);
ink.exportDeepEXR(world, {
  out: 'relay-plates.exr',
  view: { w: 232, h: 158 },
  times: [0]
});
```

`frame` comes from `ink.render(world, { deepComposite: { layers: 8 } })`. Both helpers accept `reflection` and `allowTruncated`. `exportDeepEXR` also accepts `pose(world, time)`, `layers`, and `coalesce` for its own captures.

## Edit and replay native deep plates

Use [headless deep shot compositing](deep-shot.md) to reopen a plate, align
a separate take, edit selected samples, and verify the resulting deep ray.

```sh
node examples/deep-shot-prism-relay.cjs prism-relay
ink-studio deep-shot run prism-relay/prism-relay.shot.json --out prism-replay
```

The encoding follows the [OpenEXR file layout](https://openexr.com/en/latest/OpenEXRFileLayout.html) and its [deep sample conventions](https://openexr.com/en/latest/InterpretingDeepPixels.html).
