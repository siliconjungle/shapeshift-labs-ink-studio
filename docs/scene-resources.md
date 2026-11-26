# Static 3D scene resources

Use `scene-resource` to inspect and validate a static scene before converting it. The report lists the active hierarchy, local matrices, material groups, per-group UV sets, and texture hashes and bindings. Validation fails on a missing UV set, a broken binding, malformed geometry, or an unsupported graph. The existing [native glTF container round trip](asset-interchange.md) accepts scenes with animation and retained extensions.

```sh
ink-studio scene-resource validate source.glb
ink-studio scene-resource convert source.glb --out review/scene.usda
ink-studio scene-resource convert review/scene.usda --out review/scene.usdz
ink-studio scene-resource convert review/scene.usdz --out review/reopened.glb
```

For USD or MaterialX, provide a Python environment with the official `usd-core` and `MaterialX` packages. Set `INK_SCENE_PYTHON` or pass `--python /path/to/python`. GLB and glTF inspection and conversion can use Node alone. [OpenUSD Python distribution](https://pypi.org/project/usd-core/) · [MaterialX Python distribution](https://pypi.org/project/MaterialX/)

## USD

Read and write USDA, USD, USDC, and USDZ. The bridge opens the composed default stage through OpenUSD and translates polygon meshes, grouped material subsets, local affine transforms, normals, and indexed or face-varying texture coordinates. It converts Z-up and authored stage units into Y-up meters. The report records the source space. A USD `st`, `st1`, or numbered successor maps to `TEXCOORD_0`, `TEXCOORD_1`, or the corresponding glTF set. The bridge accounts for the image-axis convention when converting. [OpenUSD mesh and primvar schemas](https://openusd.org/dev/user_guides/schemas/usdGeom/overview.html)

USD files use `UsdPreviewSurface` with `UsdUVTexture` and float2 primvar readers. The supported material subset covers base color, metallic, roughness, tangent normal, emissive, opacity, and ambient occlusion bindings. PNG and JPEG companions are copied by content hash. Keep the `textures` directory with loose files. A USDZ includes its dependencies. Material subsets preserve each primitive's slot assignment and available UV sets, including when two parts use different charts. [UsdPreviewSurface specification](https://openusd.org/dev/spec_usdpreviewsurface.html)

Conversion reopens the staged file before publishing. Its `roundTrip` entries compare topology and normal values by triangle corner, plus hierarchy, transforms, group and slot assignment, UV values, and texture bytes and bindings. Some target formats change the resource representation. For example, packing separate PNG scalar maps into glTF roughness and metalness can change the texture-byte result. The JSON report exposes such changes.

## MaterialX looks

```sh
ink-studio scene-resource convert source.glb --out review/look.mtlx
ink-studio scene-resource validate review/look.mtlx
ink-studio scene-resource convert review/scene.usda --materialx review/look.mtlx --out review/relit.glb
```

The exported document uses `standard_surface`, image and texture-coordinate nodes, and the standard normal-map, channel extraction, and arithmetic nodes needed by its bindings. It is independently editable and validated against the official MaterialX library. A replacement applies by exact material display name and can cover any subset of unambiguous scene slots. For USD, the scene carries an independently usable Preview Surface network and the MaterialX document is a separate look resource. MaterialX keeps Ink/glTF alpha-cutoff and AO bindings as metadata alongside the standard surface graph. [MaterialX specification](https://materialx.org/Specification.html)

This bridge focuses on the static default scene, fixed polygon geometry, and the PBR subset above. USD instances, subdivision, time-sampled geometry or transforms, reset xform stacks, and custom shade networks require a separate bake. The MaterialX importer accepts constants and the supported top-level texture chains. General procedural graphs require a bake to textures. glTF scene conversion uses triangle primitives, decomposable transforms, PNG or JPEG maps, and core texture bindings. Tangents and sampler filtering use the receiving format's reconstruction and defaults.

## External conversion

Pass an explicit Blender executable for OBJ, FBX, PLY, or STL input or output. Ink runs its packaged background script, stages the exchange through GLB, and reopens the result to report preserved or changed resources. Each target format determines which attributes it can retain. For example, OBJ supports one UV set and STL carries geometry.

```sh
ink-studio scene-resource convert shell.fbx --blender /path/to/blender --out shell.glb
ink-studio scene-resource convert shell.glb --blender /path/to/blender --out shell.obj
```

## Meridian Switchboard demo

```sh
node scripts/build.js node
node examples/scene-resources/demo.cjs /tmp/ink-meridian
/path/to/blender --background --factory-startup --disable-autoexec --python-exit-code 1 \
  --python examples/scene-resources/render.py -- /tmp/ink-meridian
```

Open the generated `index.html` to compare the source with the reopened USD and MaterialX scene under the same camera and lighting. The enamel image uses its second UV set, while the brass uses the first. The demo includes the USDZ package, the editable MaterialX document, and the resource validation report.
