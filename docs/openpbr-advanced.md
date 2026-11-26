# OpenPBR advanced lobes

Author these controls on the same `material.openPbr` graph node described in the [core guide](openpbr-core.md). Older graphs open with neutral weights for the new lobes. A physical reference plan can also set uniform values in a mesh material’s `openPbr` object. The input names, defaults, and units follow [OpenPBR Surface 1.1.2](https://academysoftwarefoundation.github.io/OpenPBR/).

| Group | Default values |
|---|---|
| Transmission | `transmission_weight` 0, `transmission_color` [1, 1, 1], `transmission_depth` 0 cm, `transmission_scatter` [0, 0, 0], `transmission_scatter_anisotropy` 0 |
| Dispersion | `transmission_dispersion_scale` 0, `transmission_dispersion_abbe_number` 20 |
| Subsurface | `subsurface_weight` 0, `subsurface_color` [0.8, 0.8, 0.8], `subsurface_radius` 1 cm, `subsurface_radius_scale` [1, 0.5, 0.25], `subsurface_scatter_anisotropy` 0 |
| Fuzz | `fuzz_weight` 0, `fuzz_color` [1, 1, 1], `fuzz_roughness` 0.5 |
| Thin film | `thin_film_weight` 0, `thin_film_thickness` 0.5 µm, `thin_film_ior` 1.4 |
| Thin wall | `geometry_thin_walled` false |

Bind named maps through a `data.record` just as for the core controls. Scalar depth and radius images use `cm`. Film thickness uses `um`, `µm`, or `μm`. Use float data for signed anisotropy and physical lengths. Scatter anisotropies span −1 to 1. Color maps use the normal linear sRGB conversion. `geometry_thin_walled` is a uniform Boolean. Coat and base keep independent roughness, anisotropy, normals, and tangents.

## Choose the geometry and lighting

- **Closed glass or liquid.** Use an outward-facing closed mesh and start the camera outside. `specular_weight` modulates the IOR and `specular_roughness` broadens refraction. At positive depth, the transmission color is the amount transmitted over that distance. At zero depth it tints the entrance without an absorbing volume. `transmission_scatter` with positive depth adds homogeneous volume scattering. Dispersion varies the IOR using the Abbe number and three sampled RGB wavelength bands.
- **Wax or stone.** Subsurface paths enter the closed mesh, scatter according to the authored RGB mean free paths, and exit through the boundary. Use a low-radius material for a tighter response. At radius zero, the subsurface weight contributes local diffuse color. Transmission and subsurface take their shares from the same nonmetal substrate.
- **Window or paper.** A thin window uses paired-interface Fresnel and absorption with straight-through smooth transmission. Roughness broadens the transmitted lobe. The thin-wall subsurface lobe instead splits diffuse light between the two sides according to anisotropy. Positive values favor light transmitted through the sheet. A sheet has no traveled volume and ignores the volumetric depth, scatter, dispersion, and radius settings.
- **Finished surface.** The film changes angle-dependent reflectance and dielectric transmittance below the coat. Coat IOR changes the effective specular interface. Coat roughness also broadens the base, while coat color darkens the transmitted light at grazing angles. Fuzz adds a broad scattering lobe above the coat and attenuates the substrate and emission beneath it.

One scene unit is one centimeter by default. Pass a positive `metersPerUnit` in the reference plan to use another scale. Bounds for this renderer keep extreme optical IORs and phase lobes finite. Extra bounces help paths exit wax and glass. The report records dispersive paths, volume and subsurface scattering, and both types of thin-wall crossings.

The offline triangle renderer uses an RGB thin-film interference approximation with three samples per band and an effective conductor phase. Its fuzz lobe is analytic, and its coat uses albedo scaling and angular absorption. Direct lighting handles thin diffuse transmission. Refractive connections and caustics rely on traced continuations, so small bright sources may need more samples. These choices make the renderer suitable for comparative look development with repeatable results. Full spectral transport, measured fuzz tables, and the live raster and splat renderers are outside this reference path.

## Mothglass reference scene

```sh
node examples/openpbr-advanced/demo.cjs /tmp/ink-mothglass
```

Open `/tmp/ink-mothglass/index.html`. Compare the prism with dispersion on and off, diffuse transport through the backlit shade, scattering in the wax and glass, and removal of the film, fuzz, and coat from the foil wing. Change the material in the inspector to see the inputs from each rendered variant. The source mesh, graph, EXR thickness map, mask, render plans, and linear output are stored alongside the review.

The numeric reference fixtures check Beer attenuation across scene scales, the smooth thin-wall tint, Fresnel and film transmission balance, combined volume scattering and dispersion, backlit paper, and deterministic checkpoint resume.

```sh
node --test tests/openpbr-advanced.test.js tests/openpbr-core.test.js tests/physical-reference.test.js
```
