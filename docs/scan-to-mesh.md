# Scan to mesh with residual splats

A registered depth and color capture can become one glTF asset with an opaque indexed mesh and a smaller set of Gaussian splats. The native surface supplies depth, picking, texture, and normals. Splats carry fine pigment, real relief, or measured edge detail where the surface alone loses it. This workflow keeps the observed part of a scan in its calibrated camera coordinates.

```sh
ink-studio scan-mesh globe-depth.json --image globe-capture.png \
  --mesh-stride 2 --max-jump .044 --paint-radius 2 --rgb-threshold 15 \
  --out globe.glb
ink-studio inspect-gltf globe.glb
ink-studio render globe.glb --yaw .35 --out globe.png
```

Use the same [depth capture inputs and camera flags](depth-maps.md) as the depth importer. A PNG depth map can use an explicit metric scale or a grayscale near and far range. For pre-registered RGB-D, use the calibrated focal lengths and optical center. Depth discontinuities and invalid samples limit where the mesh connects. The texture carries the valid-sample mask so coarser geometry still respects holes. The recovered surface is open and covers the measured side of the prop.

| Option | Effect |
| --- | --- |
| `--mesh-stride` | Depth sampling interval for the opaque surface. |
| `--max-jump` | Maximum depth difference across a triangle edge, in scene units. |
| `--sample-stride` | Sampling interval for Gaussians generated from the capture. |
| `--paint-radius` | Same-surface smoothing radius in source pixels. A radius of zero puts the registered color directly on the mesh. |
| `--rgb-threshold` | Minimum opacity-weighted RGB byte difference or directional-color estimate for a matched surface to retain an appearance splat. |
| `--surface-tolerance` | Distance within which a splat is considered on the opaque surface. The default scales with the projected pixel and mesh stride. |
| `--residual-limit` | Hard limit on retained splats. Zero produces a native mesh-only GLB. |
| `--cloud` | A PLY, SPZ, or GSZ Gaussian cloud already registered to the capture. |

In capture space, the camera is at the origin, X is right, Y is up, and visible depth runs along negative Z. A supplied cloud uses the capture's units and orientation. Ink tests the splat center against the closest opaque surface along its capture ray. It removes faint, occluded, out-of-region, and redundant candidates. It keeps supported detail in front of the mesh and appearance deviations on the surface. A small forward bias keeps registered appearance splats above the mesh. The report records the outcome counts and the residual budget. Export retains directional Gaussian harmonics through degree three.

The GLB uses ordinary indexed triangles, a PNG texture, and the uncompressed [Gaussian glTF extension](gaussian-gltf.md). Ink renders the same file through its native mesh and Gaussian paths. Add an area light to compare shading from the recovered mesh and retained observation normals. The color capture includes the original illumination, so this is a relighting preview over captured pigment.

Use [relightable scan materials](relightable-scans.md) to supply explicit diffuse, normal, and roughness maps and retain the original exposure as a separate layer.

## Node API

```js
const ink = require('@shapeshift-labs/ink-studio');
const scan = await ink.scanToMesh(capture, { meshStride: 2, rgbThreshold: 15 });
const world = await scan.world();
console.log(scan.report);
```

`scan.glb` holds the portable asset. Request `scan.world('source')`, `scan.world('mesh')`, or `scan.world('hybrid')` for matched reviews. The source variant uses one observed splat per sampled RGB-D pixel or the supplied registered cloud.

## Desktop globe demo

Download and unpack the TUM RGB-D sample published by Open3D. The script makes a foreground crop of the desktop globe and compares the three representations on a 36-frame orbit, with two crossing occluders, and with a warm area light. The report records RGB error against the full-splat render, opaque owners in the occlusion frame, and the lighting response. [Open3D sample archive](https://github.com/isl-org/open3d_downloads/releases/download/20220201-data/SampleTUMRGBDImage.zip)

```sh
node examples/scan-residual-globe.cjs /path/to/unpacked-sample /tmp/globe-review
```

Capture by the TUM RGB-D benchmark authors. The demo crops and masks the original image and uses the published default camera intrinsics. [TUM RGB-D benchmark, CC BY 4.0](https://cvg.cit.tum.de/data/datasets/rgbd-dataset) · [Capture formats and calibration](https://cvg.cit.tum.de/data/datasets/rgbd-dataset/file_formats)
