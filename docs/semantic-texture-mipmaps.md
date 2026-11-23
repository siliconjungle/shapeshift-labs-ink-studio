# Semantic texture mipmaps

Native scene meshes can select a material mip level from the projected
footprint of one art pixel. Headless and WebGL use the same per-material
mip chain. Set `mipmaps: true` or supply a rule on the material.

```js
const mesh = KIT.sceneMeshes.create({
  id: 'signal-panel',
  positions, uvs, indices,
  materials: [{
    id: 'enamel',
    texture: { width, height, indices: pigment, palette, coverage },
    normal,
    roughness,
    emission,
    emissionStrength: 1.3,
    mipmaps: {
      protect: [0xfad183],
      protectCoverage: 0.10,
      variance: 1,
      light: [0.6, 0.2, 0.75],
      specular: 0.28
    }
  }]
});
```

The indexed texture takes one byte index per texel and up to 256 RGB24
swatches. Optional coverage takes one byte per texel and uses the material's
`alphaCutoff`, which defaults to 0.5. A top-down RGBA8 `texture.pixels` also
works. A normal map takes matching tangent-space RGBA8 pixels. Roughness
accepts a scalar in [0, 1] or a matching grayscale byte map. Emission takes
matching sRGB RGB8 or RGBA8 pixels. `emissionStrength` scales the decoded
radiance. The material texture and all supplied maps must share dimensions.
Each semantic map can be up to 1024 pixels per edge.

- **Indexed pigment** votes by covered source area. A protected swatch can
  win a mip texel when its share of that covered area reaches
  `protectCoverage`. Ordinary ties follow palette order. RGB pigment is
  averaged in linear light.
- **Cutout coverage** retains the covered area fraction in every mip. A
  deterministic pattern in the selected texture level resolves that fraction
  to a depth-tested cutout. Fully empty footprints stay empty.
- **Normal and roughness** average covered unit normals and renormalize the
  result. A shorter mean vector indicates more lost directional detail. Ink
  adds that variation to squared roughness and uses it to broaden and temper
  the distant highlight. `variance: 0` disables the roughness adjustment.
- **Emission** averages the covered source in linear light and adds the result
  after surface lighting. Normals, roughness and emission blend between
  adjacent levels. Indexed pigment chooses a single level to retain exact
  source swatches before lighting and palette resolve.

Every level integrates the source pixels, including partial edge footprints
on odd-sized maps. Material tiles are isolated. The viewer chooses the level
from the larger of the two projected texture gradients. The result is an
isotropic mip chain with palette-aware pigment and cutout rules.

Use `semanticMipmaps: false` on a frame or `--semantic-mipmaps off` in the
CLI to compare against level zero with the same material channels. The
material's maps are prepared when the mesh is created. Posing the mesh
updates the projected footprint without rebuilding the maps. Choose either
`mipmaps` or the existing `sampling` rule per material.

For a registered material bake, pass the pigment PNG as `texture.pixels`,
normal PNG as `normal`, roughness PNG as a one-channel byte array, and
emission PNG plus its manifest's `emissionStrength`. This uses the same
UVs as the exported mesh. To protect particular swatches, supply palette
indices for the pigment. Automatic filtering is available on the native
indexed scene-mesh path. The standalone
`ink.load().SemanticTextureMipmaps` generator also exposes `build` and
`sample` for tools that already have projected footprints.

Run `node examples/semantic-texture-mipmaps.js <directory> --frames` to compare
the two paths on the Pelagic telegraph. The shot pulls back over an indexed
stencil, a cutout grille, an emissive strip, and a finely grooved enamel
panel. The output includes matched captures and a tracked motion report.
