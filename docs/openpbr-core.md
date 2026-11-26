# OpenPBR core

Use `material.openPbr` in an [editable material graph](editable-material-graph.md). It produces a versioned surface packet and a report with the resolved defaults, authored values, units, and map descriptors. The input contract follows [OpenPBR Surface 1.1.2](https://academysoftwarefoundation.github.io/OpenPBR/). Ink declares linear sRGB as the RGB working space for the packet.

## Inputs and defaults

| Group | Default values |
|---|---|
| Base | `base_weight` 1, `base_color` [0.8, 0.8, 0.8], `base_metalness` 0, `base_diffuse_roughness` 0 |
| Specular | `specular_weight` 1, `specular_color` [1, 1, 1], `specular_roughness` 0.3, `specular_roughness_anisotropy` 0, `specular_ior` 1.5 |
| Coat | `coat_weight` 0, `coat_color` [1, 1, 1], `coat_roughness` 0, `coat_roughness_anisotropy` 0, `coat_ior` 1.6, `coat_darkening` 1 |
| Emission | `emission_luminance` 0 cd/m², `emission_color` [1, 1, 1] |
| Geometry | `geometry_opacity` 1, `geometry_thin_walled` false, `geometry_normal`, `geometry_coat_normal`, `geometry_tangent`, and `geometry_coat_tangent` follow the unperturbed surface frame by default |

The scalar controls are unitless except for emission luminance. Opacity, roughness, anisotropy, metalness, base and coat weights, and coat darkening take values from zero to one. The IOR controls must be positive. Emission luminance, emission RGB, and specular weight accept nonnegative values above one. Uniform geometry vectors use world-space XYZ. Use null to take the vector from geometry.

## Bind maps

Connect typed image nodes with a `data.record` keyed by the standard names. Route the record into `maps` and set untextured inputs through `parameters`. A map replaces the corresponding uniform where the map has a texel. A transparent UV address falls back to the uniform except on `geometry_opacity`, where it cuts out the surface. Address and filter settings come from each map.

| Target | Image contract |
|---|---|
| Color | Typed RGB or RGBA color. Ink converts from the declared color space to linear sRGB and limits the result to the input range. Alpha does not control surface coverage. |
| Scalar | One-channel unitless data or mask. Use floating-point data for values above one. |
| `emission_luminance` | One-channel data with units `nits` or `cd/m2`. A float map can carry HDR luminance. |
| Base and coat normal | Typed XYZ normals in tangent or world space. Tangent maps accept OpenGL and DirectX orientation and default to OpenGL. |
| Base and coat tangent | Floating-point RGB-layout data with signed XYZ components in the unperturbed UV tangent frame. |
| `geometry_thin_walled` | Uniform Boolean. |

The renderer projects an authored tangent into its own normal plane. A missing or degenerate vector falls back to the mesh frame. Publish `value` to render the material and `report` to inspect the contract. For example, here is a physical reference material table using one uniform material and one graph output.

```json
{
  "brass": {
    "openPbr": {
      "base_color": [0.54, 0.30, 0.11],
      "base_metalness": 1,
      "specular_roughness": 0.36,
      "specular_roughness_anisotropy": 0.65
    }
  },
  "enamel": {
    "graph": { "file": "storm-dial.material.json", "output": "finish" }
  }
}
```

## Render the material

```sh
node examples/openpbr-core/demo.cjs /tmp/ink-storm-dial
ink-studio physical-reference /tmp/ink-storm-dial/finish.plan.json --out /tmp/ink-storm-dial-review
```

Open `/tmp/ink-storm-dial/index.html` to compare the coated, uncoated, flat, sealed, and unpowered variants. The source maps, editable graph, and render plans are written beside it. The [physical reference renderer](physical-reference.md) also writes a material receipt and linear EXR. Its emission scale maps 100 cd/m² of white to one unit of scene-linear radiance before coat and exposure. Intermediate opacity is sampled on camera, bounce, and shadow rays. The first-hit diagnostic passes use a 0.5 threshold for a stable guide. Thin-walled materials can emit on both sides.

The reference renderer uses anisotropic GGX, rough diffuse scattering, and an approximate layered coat with absorption and darkening. The packet covers the base, specular, coat, emission, and geometry groups. Runtime raster and splat shading, MaterialX exchange, and additional OpenPBR lobes are outside this integration.
