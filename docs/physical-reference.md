# Physical mesh and material reference

The CPU reference path tracer renders a small, reproducible mesh scene in linear RGB. Use it to judge how pigment, roughness, shadows, bounced light, or glass behave before applying an Ink look. The [retained-SDF reference](sdf-reference.md) uses the same Ink camera conventions and is available for checking finite sculpt fields against their baked splats.

```sh
ink-studio physical-reference room.plan.json --out review --quality studio --batch 8
```

Open `review/index.html`. Both sides of the comparison can show an accumulation milestone, final raw or denoised color, the sampling error estimate, albedo, shading normals, or camera-axis depth. The slider compares both images at the same pixel. `raw.exr` contains linear RGB float32 radiance before display exposure, tone mapping, and denoising.

## Scene inputs and supported transport

A version 1 plan specifies the camera, transformed triangle meshes, and material slot bindings. Use the `mesh` kind for a UV-bearing OBJ, glTF, or GLB. Use `ink` for retained Ink topology and the same UV-bearing Ink assets accepted by the [linked material preview](linked-material-preview.md). Sphere, plane, and cube carriers use the built-in UV layouts. Geometry keeps its authored coordinates. `position`, XYZ Euler `rotation` in degrees, and positive per-axis `scale` apply to each instance. Supply a `material` for the whole instance or a `slots` mapping from authored slot names, with `material` as the optional fallback.

Material constants use linear RGB. A `graph` binding can evaluate a typed base-color output or a material channel packet from an editable Ink material. For individual outputs, use `maps` keyed by channel with `{"output":"name"}` or `{"map":"published-usage"}`. Graph textures support base color, tangent-space normals, roughness, metalness, opacity, and emission. Color maps follow their declared color space and sampling contract. The base-color constant tints the graph pigment, scalar maps override their matching constants, and graph emission adds to constant emission. Base-color alpha and opacity combine as a cutout using the material's `cutoff` (default `0.5`).

A material can also supply `openPbr` uniform inputs or reference a graph output from `material.openPbr`. The [OpenPBR core guide](openpbr-core.md) covers the map conventions. The [advanced lobes guide](openpbr-advanced.md) covers rough refraction, absorbing and scattering media, dispersion, thin walls, thin film, and fuzz. Advanced media use centimeters by default. Set `metersPerUnit` on the plan for differently scaled geometry.

Legacy opaque materials use diffuse scattering and an isotropic GGX reflection lobe. OpenPBR core materials add anisotropic base and coat lobes, separate UV-driven frames, and sampled coverage. Emissive triangles produce soft shadows and bounce. Point-light intensity falls off with squared distance. The environment accepts a constant linear RGB color or a latitude-longitude Radiance HDR, OpenEXR, or PFM panorama with rotation and strength. Light and BSDF samples are combined with multiple importance sampling. The `glass` profile traces smooth dielectric boundaries with Fresnel reflection, refraction, and RGB absorption per world unit. Use closed, outward-facing meshes for glass and place the camera outside them. [Path tracing and multiple importance sampling](https://pbr-book.org/4ed/Light_Transport_I_Surface_Reflection/A_Better_Path_Tracer)

The reference scope is static triangle surfaces and homogeneous OpenPBR media inside closed meshes. Direct lighting uses visibility rays with alpha coverage. Refracted caustics can arrive by traced paths and converge slowly. The live art-grid and splat renderers use their own material paths. For art grids and moved sculpts, use the review workflow appropriate to the asset.

## Plan example

```json
{
  "format": "ink-studio/physical-reference",
  "version": 1,
  "label": "Material proof",
  "view": { "width": 240, "height": 160 },
  "camera": { "target": [0, 0.5, 0], "yaw": 18, "pitch": 12, "distance": 5, "focalLength": 37 },
  "environment": { "color": [0.12, 0.18, 0.27] },
  "materials": {
    "glaze": { "baseColor": [0.1, 0.43, 0.65], "roughness": 0.26 },
    "key": { "baseColor": [0, 0, 0], "emission": [6, 4.2, 3.2] }
  },
  "meshes": [
    { "id": "sample", "kind": "sphere", "material": "glaze", "scale": [0.7, 0.7, 0.7] },
    { "id": "softbox", "kind": "plane", "material": "key", "position": [-2, 2.8, 2], "rotation": [132, -31, 0] }
  ]
}
```

## Managed color

Set `colorManagement` in the render plan to proof the same linear film through an OCIO display and view. The browser review links to the managed display PNG and working-space EXR alongside the native linear data. See [color management](color-management.md) for resource mappings, HDR metadata, and palette proofing.

## Quality, accumulation, and denoising

| Preset | Samples per pixel | Surface bounces |
|---|---:|---:|
| `draft` | 8 | 2 |
| `studio` | 32 | 4 |
| `final` | 128 | 6 |

Override the preset with `--samples`, `--bounces`, `--w`, `--h`, and `--seed`. Bounces count surface events after the camera hit, including specular transmission. `--bounces 0` keeps direct illumination. Each invocation is bounded to 16 million primary samples. Use `--batch` to control the interval between accumulation milestones and checkpoint writes. Resume by passing a previous `accumulation.bin`. Samples are addressed by seed, pixel, and absolute index, so splitting a render across runs reproduces the same accumulated film. Checkpoints reject mismatches in evaluated geometry, materials, lighting, camera, grid, seed, or bounce limit.

```sh
ink-studio physical-reference room.plan.json --out review --samples 16 --batch 8 --bounces 4
ink-studio physical-reference room.plan.json --out review --resume review/accumulation.bin --samples 32 --batch 16 --bounces 4
```

Use `--denoise off|gentle|strong` for zero, two, or four edge-aware filter iterations. The filter uses shading normals, depth, first-hit material and albedo, plus the measured variance. The denoised image is a visual estimate. Inspect the raw accumulation for fine detail and reflection boundaries. Pass `--samples 0 --resume …` to change denoising or `--exposure` in stops without tracing again. [Edge-avoiding à-trous filtering](https://jo.dreggn.org/home/2010_atrous.pdf)

## Kiln & Prism demo

```sh
node scripts/build.js node
node examples/physical-reference/demo.cjs /tmp/ink-kiln
```

The example includes a graph-painted cobalt vessel, pressed dielectric glass, warm metal, and three mesh area lights. The optional arguments after the output directory set sample count and width.
