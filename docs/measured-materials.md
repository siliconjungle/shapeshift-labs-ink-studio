# Measured materials from planar captures

Use `material.measure` to turn aligned or photographed surface samples into a [material channel packet](material-graph-ports.md). The operation registers each exposure to one material UV grid, fits its camera response from measured patches, and divides out calibrated diffuse irradiance. It delivers linear pigment, tangent normals, and evidence masks. Supply physical relief in millimeters and measured roughness when available.

Use [registered RGB-D fusion](scan-to-mesh.md#fuse-registered-rgb-d-views) for the geometry of an object seen from different positions. `material.measure` registers planar reference targets and samples maps into a common UV rectangle. For curved surfaces, first project captures into the receiving UV layout using the surveyed geometry and the [registered material bake](registered-material-bake.md#project-approved-paint-from-several-views). Height samples must share a reference plane and sign before recovery.

## Assemble captures

Import the source images with [bitmap resources](bitmap-resources.md) and make one `data.record` per exposure. Gather those records with `data.collect`. The same schema is available as `KIT.procedural.measuredMaterials.recover(captures, settings)`.

| Capture field | Meaning |
| --- | --- |
| `id`, `color` | Stable identifier and a typed RGB(A) exposure. Ink converts the image to straight, linear sRGB before fitting. |
| `landmarks` | Four to 64 paired coordinates in `{ target: [x,y], source: [x,y] }` form. Integer pixel coordinates identify texel centers. Keep landmarks spread across both axes. An already registered capture can omit the pairs if it matches the target extent. |
| `calibration` | Three to 96 `patches`, each with `measured` and `reference` linear RGB triplets. Use patch measurements from the same camera response with known reference radiances, after applying the same color-space interpretation as the exposure. Supply optional per-channel `black` offsets and `maxResidual` (default .05 in linear RGB distance). Choose patches that span RGB. An omitted calibration uses the decoded colors directly. |
| `lighting` | Calibrated `ambient` and an optional `lights` array of `{ direction: [x,y,z], strength }`. Intensity values may be scalars or RGB. Directions point toward the source in the destination tangent frame, with X right, Y up, and Z out of the material. |
| `irradiance` | Alternative to directional lighting. Supply a typed linear color image or a single unitless intensity lane in [0, 32]. A measured field can represent spatially varying illumination and occlusion. Omit both lighting inputs for images that already carry diffuse pigment. |
| `height`, `reliefMask` | Typed height in millimeters and optional normalized validity mask for that measurement alone. Positive height extends out of the reference plane. |
| `normal`, `normalRotation` | Optional typed tangent normal image and a rotation in degrees from its tangent axes to the destination tangent axes about +Z. Ink handles OpenGL and DirectX Y conventions and normalizes transferred vectors. Reconstruct normals from height where a normal measurement is absent. |
| `coverage`, `weight` | Optional normalized coverage mask for all source maps and a positive per-capture weight. Source alpha also gates its own image. |
| `clipLevel`, `roughness` | Optional linear sample threshold for clipped color and a normalized measured roughness image. |

Keep the maps within each exposure at the same extent and in the same source coordinates. At least one exposure supplies height or tangent normals. `settings.width`, `settings.height`, and `settings.pixelPitchMm` define the delivery grid. `maxLandmarkError` defaults to 1 source pixel. `reliefToleranceMm` defaults to .08 mm. `pigmentTolerance` defaults to .08 in linear RGB distance. `minimumLight` defaults to .06 in all three channels.

The report includes per-exposure registration and color-calibration residuals. Bad or underdetermined fits fail with a diagnostic. The recovery favors agreement near a weighted median and flags contradictory observations in the confidence maps. A single height observation has confidence at most .5. A gap has zero confidence. In directional mode, usable normals or relief support illumination correction. Strong glare is easier to reject when several exposures give a consistent diffuse reading. Use controlled lighting or cross-polarized photography for glossy materials. The operation recovers diffuse pigment and transfers supplied roughness. More complex measured reflectance needs a capture and representation that describe it.

Use [scan processing](scan-processing.md) to repair and tile the resulting material packet with shared channel correspondence.

## Deliver the recovered maps

The graph returns `value` and a `report`. The packet contains `baseColor`, `normal`, `mask.pigment-confidence`, and `mask.normal-confidence`. Height adds `height` and `mask.relief-confidence`. Supplied roughness adds `roughness`. Export the aligned packet as [named EXR channels](material-texture-formats.md), or use the individual image ports with the existing material tools. The Tideglass demo also assigns the recovered pigment, normals, and roughness to the scan mesh used in its relighting preview.

```sh
node examples/measured-materials/demo.cjs /tmp/ink-tideglass
ink-studio graph run /tmp/ink-tideglass/tideglass.material.json --out /tmp/ink-tideglass/replay
ink-studio graph texture-info /tmp/ink-tideglass/artifacts/tideglass.exr --channels height,mask.relief-confidence
```

Open the generated `index.html` to inspect simulated source views, recovered maps, and the relighting sweep. The capture fixture defines the true pigment and includes misalignment, different illumination, missing depth samples and a contradictory relief patch. The demo verifies its recovered pigment against that truth and reopens the actual EXR confidence plane.

## Optional AxF exchange

The host application can supply an adapter backed by the X-Rite AxF SDK. Pass it explicitly to `ink.importAxF(bytes, { adapter })` or `ink.exportAxF(materialChannels, { adapter })`. The adapter's `decode(bytes)` returns `{ value, representation, unsupported }`. Its `encode(value)` returns `{ bytes, representation, unsupported }`. Both methods may be asynchronous. `value` holds typed material maps. `representation` identifies the AxF appearance representation and `unsupported` lists properties the adapter could not map. Use an empty array when all properties transferred.

Ink ships the adapter interface. The SDK and native converter come from the host. Capabilities depend on the adapter and appearance representation. [X-Rite AxF SDK and format](https://www.xrite.com/axf)
