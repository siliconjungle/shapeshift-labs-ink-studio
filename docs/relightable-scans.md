# Relightable scan materials

Export a [scan surface](scan-to-mesh.md) with separate diffuse, tangent normal, and roughness maps. Use the same pixel registration as the depth capture. The diffuse map supplies the unlit pigment, the normal map changes the direction the surface shades, and roughness controls the width and strength of its highlights. The maps use glTF 2.0 material slots in the exported GLB. [glTF material specification](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#materials)

```sh
ink-studio scan-mesh globe-depth.json --image globe-capture.png \
  --mesh-stride 2 --max-jump .044 --diffuse diffuse.png \
  --normal normal.png --roughness roughness.png --capture-layer --out globe.glb

ink-studio render globe.glb --raw --out daylight.png
ink-studio render globe.glb --raw --scan-daylight off --area-lights lamp.json --out lamplight.png
ink-studio render globe.glb --raw --scan-daylight off --area-lights lamp.json --scan-appearance .65 --out capture-blend.png
```

- Diffuse takes an aligned RGB or RGBA image. Omitting it uses pigment from the capture.
- Normals take aligned tangent-space RGBA8. Red grows right, green grows up the texture, and blue grows out of the surface. Alpha below 128 uses the geometric normal.
- Roughness takes a scalar from zero to one or an aligned grayscale map.
- Each relightable map supports up to 1024 pixels per edge. Depth validity controls opaque coverage for all maps.

The captured color layer is the original exposure stored separately from the material maps. Set `scanAppearance` from zero to one on a frame to blend it over the shaded result. The layer defaults to zero, fades with the angle from the recorded camera, and keeps the same depth and cutouts. A single capture supplies one directional sample. Ink uses the observed color near that direction and fades it away as the view turns.

The headless and WebGL paths use the registered material mipmaps. The daylight key uses the material direction, ambient floor, and specular strength. Set `scanDaylight: false` to keep the ambient floor and inspect area lighting alone. Area lights use the shaded normal and the roughness at the texel when they evaluate highlights.

## Node API

```js
const scan = await ink.scanToMesh(capture, {
  meshStride: 2,
  materials: {
    diffuse: { width, height, channels: 4, data: diffuseRGBA },
    normal: normalsRGBA,
    roughness: roughnessBytes,
    captured: true,
    angles: [0.72, 0.92],
    daylight: { light: [-0.42, 0.75, 0.55], ambient: 0.57, specular: 0.48 }
  }
});
const world = await scan.world();
ink.render(world, { w: 640, h: 480, scanDaylight: false, scanAppearance: 0.4, areaLights });
```

The `angles` pair contains the cosine at zero and full capture weight. An existing registered Gaussian cloud keeps its own appearance channels independently of the mesh's captured texture.

## Paint the material and retain the capture

Use an Ink pixel document with a `scan-material` destination on the
imported mesh. Find its object, mesh part, and material IDs with
`inspect-gltf`. The destination needs `binding`, `mesh`, and `material`
fields. For example, this operation recolors a texel and adjusts its
roughness and tangent normal.

```json
{
  "texels": [
    { "at": [12, 16], "pigment": "mint", "roughness": 0.65, "normal": [0.2, 0, 1] }
  ]
}
```

Coordinates address the registered texture in top-down order.
`pigment` takes a document swatch, `roughness` takes a value from 0 to 1,
and `normal` takes a tangent-space direction. Use `null` on a channel to
restore its source value. The edit keeps the source capture, angle
metadata, and material cutouts. Each edit points at a specific mesh,
material, and registered source.

```sh
ink-studio pixel-art targets document.json --scene globe.glb --destination scan-paint
ink-studio pixel-art preview document.json edit.json --scene globe.glb
ink-studio pixel-art edit document.json edit.json --scene globe.glb --out scan-paint.json
ink-studio render globe.glb --scan-paint scan-paint.json --scan-appearance 0 --raw --out relit.png
ink-studio render globe.glb --scan-paint scan-paint.json --scan-appearance 1 --raw --out reference.png
```

Pass the current asset with `--scan-paint` when inspecting and editing
again. The headless renderer and WebGL accept the same `scanPaint` asset.
With the pixel editor SDK, use `editor.renderOptions(scene)` to draw the
current edit and `editor.undo()` to restore the previous one.

### Directional Gaussian appearance

Gaussian PLY, SPZ, and glTF sources retain their spherical-harmonic
coefficients when you edit explicit splat pigment or finish in
`pixel-art`. Standalone Gaussian files use `gaussian-cloud` as their
bound object. SDK callers building a standalone cloud use
`gaussianSplatWorld(cloud, { colorMode: 'rgb', objectId: 'gaussian-cloud' })`.
The headless renderer evaluates the view-dependent
difference from the captured base and adds it in linear light after
material lighting. `scanAppearance: 0` gives the authored material on
its own, and higher values restore more of the captured directional
response. A captured mesh uses its registered photograph at the
recorded angle. The Gaussian response remains attached to its source
row when you clone or reorder splats.

## Globe comparison

The demo uses the desktop globe RGB-D crop from the scan-to-mesh example. It fits a smooth normal field to the globe's depth and expresses it as a tangent map for the recovered mesh. The diffuse and roughness images are authored estimates. The original camera exposure remains available separately. [TUM RGB-D benchmark](https://cvg.cit.tum.de/data/datasets/rgbd-dataset)

```sh
node examples/relightable-scan-globe.cjs globe-depth.json globe-capture.png /tmp/globe-materials
```

The three panels show daylight, a moving local area light, and the same local light with capture color blended in. The output includes the three material maps, the GLB, the movie frames, and a report with the light path and sampled pixels.
