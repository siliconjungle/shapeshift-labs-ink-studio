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

## Globe comparison

The demo uses the desktop globe RGB-D crop from the scan-to-mesh example. It fits a smooth normal field to the globe's depth and expresses it as a tangent map for the recovered mesh. The diffuse and roughness images are authored estimates. The original camera exposure remains available separately. [TUM RGB-D benchmark](https://cvg.cit.tum.de/data/datasets/rgbd-dataset)

```sh
node examples/relightable-scan-globe.cjs globe-depth.json globe-capture.png /tmp/globe-materials
```

The three panels show daylight, a moving local area light, and the same local light with capture color blended in. The output includes the three material maps, the GLB, the movie frames, and a report with the light path and sampled pixels.
