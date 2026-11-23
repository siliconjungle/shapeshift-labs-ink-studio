# Simulation-driven material layers

Attach a versioned `simulationLayers` document to a native scene mesh
material. Each layer reads a committed query or signal. A UV or rest-space
mask determines where the response appears. Headless and WebGL evaluate
the same document on the retained mesh.

```js
const simulationLayers = {
  format: 'ink-studio/simulation-material-layers',
  version: 1,
  layers: [{
    id: 'wetness',
    driver: {
      source: 'query',
      field: 'rig/surface-state',
      args: { body: 'gate', face: '+z', uv: [0.5, 0.5] },
      path: ['values', 'wetness']
    },
    mask: {
      space: 'uv',
      min: [0.08, 0.38],
      max: [0.94, 1],
      feather: 0.04
    },
    pigment: '#174859',
    roughness: 0.16,
    sheen: 0.8
  }, {
    id: 'new-repair',
    driver: { source: 'signal', port: 'repair/value' },
    mask: {
      space: 'rest',
      min: [0.72, 1.08, 0.28],
      max: [1.40, 1.49, 0.72],
      feather: 0.07
    },
    pigment: '#b8a783',
    relief: 0.025
  }]
};

const mesh = K.sceneMeshes.create({
  id: 'gate', positions, uvs, indices,
  materials: [{ id: 'enamel', texture, roughness: 0.68, simulationLayers }]
});
const { tick, time } = run.view();
world.lookSnapshot = { tick, time, query: run.query() };
```

The renderer also accepts the query attached by a native world visual
snapshot. A layer's `amount` is constant when the driver is absent and
becomes the fallback when its signal or query is unavailable. The default
is one for a constant layer and zero for a driven layer. Values are clamped
to [0, 1]. Driver `keys` can remap readings from arbitrary units using the
existing look-input interpolation rules. For example, a moisture field
with values in [0, 5] can use `keys: [[0, 0], [5, 1]]`.

Use a UV box with `min` and `max` pairs, a rest box with XYZ triples, or a
UV `kind: 'raster'` with `width`, `height`, and top-down grayscale byte
`values` up to 256 × 256. Registered UV masks can use their decoded
grayscale bytes. A box accepts an optional inward `feather` measured in UV
or rest units. Omitting the mask covers the material. Rest boxes use the
mesh's initial positions. The original UVs and rest positions follow
subsequent poses, including for untextured base materials.

Responses compose in document order wherever the masks overlap. Each
response is optional within a layer.

| Response | Effect |
| --- | --- |
| `pigment` | Blend toward sRGB hex or RGB pigment in linear light. |
| `roughness` | Blend toward a roughness in [0, 1]. |
| `sheen` | Blend toward a highlight gain in [0, 4], independently of roughness. |
| `relief` | Add a signed surface height in scene units. The height gradient perturbs shading normals. Silhouette, collision, and geometric depth use the mesh surface. |

A material can have up to eight named layers. Names can represent wetness,
abrasion, soot, moss, repairs, or project-specific state. Pigment and mask
data are retained as the simulation advances. The renderers read drivers
once per view and reuse the resolved values for every fragment. Simulation
layers use the native mesh's semantic material channels.

Pass `simulationMaterialLayersFrame(rows)` to inspect the resolved amounts.
Set `simulationMaterialLayers: false` on a frame or use
`--simulation-material-layers off` to compare the original material.
Retaining the source document and simulation checkpoint makes the same
appearance reproducible on a later render.

Run `node examples/simulation-material-layers.js <directory> --frames` for
Lowbank floodgate. The demo uses committed `rig/surface-stamp` commands to
add wetness, abrasion, soot, moss, and a repair. It exports matched frames,
the material definition, the simulation input, and a checkpoint.
