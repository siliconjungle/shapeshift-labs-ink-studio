# Scan to mesh with residual splats

A registered depth and color capture can become one glTF asset with an opaque indexed mesh and a smaller set of Gaussian splats. The native surface supplies depth, picking, texture, and normals. Splats carry fine pigment, real relief, or measured edge detail where the surface alone loses it. This workflow keeps the observed part of a scan in its calibrated camera coordinates.
Use [registered scan fusion](#fuse-registered-rgb-d-views) when you have several calibrated captures.

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

## Fuse registered RGB-D views

`scan-fuse` combines two to twelve registered depth views in one
world-space volume. Supply an aligned color image for each view when
available. The same input supports calibrated perspective and
orthographic projections. Each pose maps camera coordinates to world
coordinates with a translation and a unit quaternion in XYZW order.
In camera space, X points right, Y points up, and visible depth runs
along negative Z.

```json
{
  "format": "ink-studio/scan-fusion",
  "version": 1,
  "name": "Surveyed lintel",
  "views": [
    {
      "id": "front",
      "depth": "front-depth.json",
      "image": "front-color.png",
      "pose": { "position": [0, 0, 4], "rotation": [0, 0, 0, 1] }
    },
    {
      "id": "side",
      "depth": "side-depth.png",
      "image": "side-color.png",
      "camera": { "type": "perspective", "fx": 320, "fy": 320 },
      "depthOptions": { "depth-scale": 0.001, "invalid": 0 },
      "pose": { "position": [2, 0, 3.464], "rotation": [0, 0.258819, 0, 0.965926] }
    }
  ],
  "options": {
    "resolution": 0.04,
    "truncation": 0.13,
    "supportTolerance": 0.054,
    "conflictTolerance": 0.072,
    "residualLimit": 12000
  }
}
```

Paths resolve relative to the manifest. Calibration can come from a
depth JSON or the manifest's optional `camera` object. Use
`depthOptions` for [depth decoding and masks](depth-maps.md#depth-and-camera).
Set an optional positive view `weight` to account for known capture
quality. Supply calibrated poses from the survey or your registration
tool.

```sh
ink-studio scan-fuse survey.json --out hatch.glb
ink-studio render hatch.glb --yaw .3 --pitch .2 --out hatch.png
ink-studio render hatch.evidence.glb --yaw .3 --pitch .2 --out hatch-evidence.png
```

Ink averages truncated signed depth distances close to measured
surfaces. Oblique rays carry less weight. When the depth spread exceeds
`conflictTolerance`, the suspect proxy face remains editable and its
evidence identifies the contributing views, raster positions, measured
depths, and signed differences. Samples behind a foreground measurement
outside the truncation band count as occluded. Unmeasured areas stay
open and the evidence records the boundary edges. Use a grid and
truncation size suited to the smallest surface separation you want to keep.

The selected view on each measured face supplies its atlas color. The
residual pass keeps measured edge samples, relief, and color detail
that the proxy misses. It filters samples hidden by the mesh or contradicted
by a registered view, then deduplicates within the spatial budget.

| Setting | Effect |
| --- | --- |
| `resolution` | World units between volume samples. |
| `truncation` | Width of the signed-distance band on either side of an observation. |
| `supportTolerance` | Axial distance for a measurement to support a face. |
| `conflictTolerance` | Depth spread that flags disagreement. |
| `maxCells`, `maxTriangles` | Work budgets. Increase the resolution value or narrow the bounds if the requested grid exceeds the budget. |
| `paintRadius`, `rgbThreshold` | Same-surface color smoothing radius in capture pixels and residual color cutoff in RGB bytes. |
| `residualLimit` | Cap on retained splats. Zero exports an opaque proxy. |

Optional world `bounds` use `min` and `max` XYZ triples. Ink pads
the observed bounds when no box is supplied.

### Approve an unobserved fill

Add explicit world-space triangles to the manifest. A fill needs a
stable ID, a pigment, and an approval with an author and reason. Its
interior is checked against the registered depths. It can occupy an
unmeasured or occluded region inside the fusion bounds. Measured
surfaces and known free space are guarded.

```json
{
  "fills": [
    {
      "id": "lintel-insert",
      "vertices": [[0.22, 0.82, 0.42], [0.7, 0.82, 0.42], [0.7, 0.99, 0.42], [0.22, 0.99, 0.42]],
      "triangles": [[0, 1, 2], [0, 2, 3]],
      "color": [184, 124, 70],
      "approval": {
        "by": "Set artist",
        "reason": "Restore the center from the construction drawing"
      }
    }
  ]
}
```

### Edit and inspect the proxy

- **`hatch.glb`** contains the indexed proxy and retained Gaussian splats.
- **`hatch.proxy.json`** contains a mesh topology document with welded vertices, stable face IDs, and face-corner UVs. Load it with `KIT.meshTopology.create` and apply the normal mesh editing commands. Use the accompanying atlas texture on the `observed`, `conflict`, and `approved-fill` materials.
- **`hatch.atlas.png`** contains the registered color and approved fill pigment. Adding a fill keeps the existing measured UVs in place.
- **`hatch.evidence.json`** links topology face IDs and open boundary edges to the measurements or approval, and lists residual source pixels in GLB splat order.
- **`hatch.evidence.glb`** colors observed faces teal, conflicts pink, open boundaries blue, and approved fill gold.
- **`hatch.scan.json`** records calibration, grid statistics, sampled coverage, and residual filtering.

Call `scanFusion(views, options)` in Node with `{ id, capture, pose, weight }`
per view, using the depth importer capture shape. The result provides
`glb`, `proxy`, `atlas`, `evidence`, `diagnostic`, and `report`. Call
`world('source')`, `world('mesh')`, `world('hybrid')`, or `world('evidence')`
to inspect the registered observations or exported representations.

Generate the harbor hatch demo with
`node examples/registered-scan-fusion.cjs hatch-demo`. The example
includes a deliberate depth mismatch and a partially filled unobserved
patch.
