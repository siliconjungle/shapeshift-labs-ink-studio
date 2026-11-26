# MaterialX and shader interchange

Use `materialx` to exchange a material independently of a mesh scene. Ink validates the document against the official MaterialX 1.39 library, resolves supported input connections, and records how it handled each authored binding. The [scene-resource bridge](scene-resources.md) handles mesh scenes and the existing Standard Surface scene subset. [MaterialX specification](https://materialx.org/Specification.html)

```sh
python3 -m venv .venv-materialx
.venv-materialx/bin/python -m pip install 'MaterialX>=1.39,<1.40'
export INK_SCENE_PYTHON="$PWD/.venv-materialx/bin/python"
```

## Import an editable surface

```sh
ink-studio materialx validate source.mtlx
ink-studio materialx import source.mtlx --out imported
```

The importer writes a versioned Ink material graph for each supported material and a `materialx-report.json`. Choose one exact label or MaterialX element path with `--material`. Reopen the graph’s `surface` output in Ink’s [physical reference renderer](physical-reference.md). Its OpenPBR uniforms and linked typed textures are editable separately.

- OpenPBR Surface covers the core and advanced fields. Uniforms follow the official library’s active defaults. Ink uses centimeters for depth and radius, micrometers for film thickness, and nits for emission. Explicit compatible MaterialX distance tags are converted into those units. [OpenPBR parameter reference](https://academysoftwarefoundation.github.io/OpenPBR/#parameterreference)
- Standard Surface uses a documented OpenPBR mapping for base, specular, metalness, coat, sheen, named normal inputs, uniform or grayscale coverage and a subset of transmission and subsurface controls. The report identifies the shading-model approximation. Unitless emission uses a 100-nit reference white. Colored coverage, scene-length controls and source-specific lobe behavior need review.
- Texture chains support image nodes on the primary UV chart, NodeGraph outputs, scalar or component constants, packed-channel extraction, multiplication by a uniform, scalar promotion and tangent normal-map decoding. Supported expressions are evaluated on the original grid into linked float EXRs. Readable texture files include PNG, TIFF, OpenEXR and PFM. Periodic, clamp and mirror addressing and closest or linear filtering are retained.
- Common linear Rec.709, sRGB and Display P3 tags resolve into Ink’s linear Rec.709 carrier. For other color encodings or embedded ICC profiles, supply an Ink `colorManagement` settings JSON through `--color-settings color.json`. Its `sources` can map a MaterialX colorspace token to an OCIO space. [Ink color management](color-management.md)

The report identifies missing or unsupported signals by material and input path. A dropped input uses the receiving OpenPBR default. Other supported fields remain editable. Use `--strict` with validate or import to reject drops or model approximations. A strict blocked import writes its report. Geometry assignments, custom procedural graphs, displacement, volume connections, UV transforms, named texture layers and animated textures should be retained in the source and baked as needed.

## Export a published material

```sh
ink-studio materialx export enamel.material.json --output surface --out delivery/enamel.mtlx --strict
```

The exporter evaluates the named Ink graph output and emits a standard `open_pbr_surface` and `surfacematerial` with a reusable NodeGraph of texture bindings. A typed Ink material-channel packet can also provide common maps. Keep the content-addressed `textures` directory with the document. The accompanying `.mtlx.report.json` distinguishes evaluated textures, normalized encodings, retained uniforms and unsupported fields. The authoring graph remains the source for procedural history, controls and presets.

The exporter independently reopens the staged MaterialX. It compares uniform values and verifies the map bytes, filter, address mode, type and normal interpretation before publication. DirectX normals are converted to the OpenGL tangent convention. Export uses the installed MaterialX library’s OpenPBR NodeDef version and records it separately from the OpenPBR Surface specification version.

## MDL and Iray migration references

Designer 16 retired its MDL graph editor and Iray renderer. Preserve legacy sources, approved renders, source color interpretation and material settings as migration references. Bake the stable maps in the source environment, record physical units for relief and transmission, then rebuild the surface in OpenPBR and compare it under matched lighting and camera settings. `materialx migration` writes a provenance record and migration steps for a legacy `.mdl`, `.mi` or `.iray` file. These files serve as references for migration. [Adobe’s end-of-life documentation](https://experienceleague.adobe.com/en/docs/substance-3d-designer/using/technical-issues/mdl-graph-iray-eol)

## Pier Relay demo

```sh
node examples/materialx-interchange/demo.cjs /tmp/ink-pier-relay
```

Open `index.html` in the output folder. The split compares the original Ink material with the reimported version under the same camera, lighting and sample seed. An exaggerated difference pass shows any changed output pixels. The loss example uses a valid MaterialX noise node on coat roughness and shows why strict import blocks that variant. The bundle includes the original and reimported graphs, MaterialX, linked maps and JSON reports.
