# WebGPU texture and geometry graphs

Ink's WebGPU graph compiles a dependency graph of WGSL compute passes. A pass can read textures and buffers together and publish textures or buffers for other passes or for drawing. The GPU owns those resources between passes. Read them back explicitly when an authoring tool or export needs the bytes.

The graph is an opt-in browser module. Request a WebGPU device from a secure origin such as HTTPS or localhost. The existing scene renderer still uses WebGL 2. WebGPU resources can feed a WebGPU render pass on the same device. To use their data in the WebGL renderer, read back the resource and upload it to the scene.

## Run the gallery

From the repository root:

```sh
npm run build
python3 -m http.server 8180 --bind 127.0.0.1
```

Open [GPU Studies](http://127.0.0.1:8180/examples/webgpu-graphs/). Refraction generates and filters a texture. Change its channel shift or edit its WGSL and apply it live. Fold deforms a 16,641-vertex surface and shades it using the texture from Refraction. Pelagic opens sample PLY and SPZ assets or a local file and renders them through Ink's WebGL 2 pipeline.

## Compile a graph

```js
import { createWebGPUGraph } from './webgpu.mjs';

const adapter = await navigator.gpu?.requestAdapter();
if (!adapter) throw new Error('WebGPU is unavailable');
const device = await adapter.requestDevice();

const graph = await createWebGPUGraph(device, {
  resources: {
    source: { type: 'buffer', size: 16 },
    positions: { type: 'buffer', size: 16 }
  },
  nodes: [{
    id: 'double',
    shader: `
      @group(0) @binding(0) var<storage, read> source: array<f32>;
      @group(0) @binding(1) var<storage, read_write> positions: array<f32>;
      @compute @workgroup_size(4)
      fn main(@builtin(global_invocation_id) id: vec3u) {
        positions[id.x] = source[id.x] * 2.0;
      }
    `,
    bindings: [
      { resource: 'source', mode: 'read-buffer' },
      { resource: 'positions', mode: 'write-buffer' }
    ],
    workgroups: [1]
  }]
});

graph.writeBuffer('source', Float32Array.of(1, 2, 3, 4));
graph.run(['positions']);
const values = new Float32Array((await graph.readBuffer('positions')).buffer);
console.log(values); // [2, 4, 6, 8]
graph.dispose();
device.destroy();
```

The same module also exports `planWebGPUGraph(definition)` for dependency and resource validation without a device. A graph has one writer per resource. Declare additional resources for consecutive stages. Nodes can appear in any order. Inputs with no producer can be uploaded with `writeBuffer()` or `writeTexture()`. A `write-buffer` binding is read/write in WGSL, so a node can evolve its own persistent state. Dependencies between nodes must be acyclic.

| Resource or setting | Contract |
| --- | --- |
| Buffer | `{ type: 'buffer', size }` in bytes, a multiple of four. WGSL defines attribute layout. The GPU buffer can also be used for vertices, indices, or indirect commands. |
| Texture | `{ type: 'texture', width, height, format }`. Formats are `rgba8unorm`, `rgba16float`, `rgba32float`, and `r32float`. Use `textureLoad` for reads and `textureStore` for output. |
| Bindings | Array positions become bindings in group 0. Modes are `read-buffer`, `write-buffer`, `uniform`, `read-texture`, and `write-texture`. |
| Dispatch | `workgroups` gives one to three dispatch dimensions. WGSL declares the thread dimensions with `@workgroup_size`. Guard writes at the edges when dispatch dimensions round up. The default entry point is `main`. |
| Execution | `run(outputs?)` submits commands. `encode(encoder, outputs?)` appends them to a caller's command encoder for rendering in the same submission. Requested outputs limit dispatch to the nodes that produce them and their dependencies. |
| Interop | `get(name)` exposes a borrowed GPU buffer or texture. Use it on the same device. `readBuffer()` and `readTexture()` return byte arrays. Texture readback is tightly packed with no row padding. |
| Ownership | `dispose()` releases resources allocated by the graph. The caller owns the device. Shader or device validation errors reject compilation, leaving an existing graph available to finish rendering. |

For an image-to-geometry workflow, see the gallery's [shader kernels](../examples/webgpu-graphs/kernels.mjs) and [canvas integration](../examples/webgpu-graphs/demo.mjs).

## Import Gaussian splats

```sh
node cli/ink-studio.js render scan.ply --raw --out preview.png
node cli/ink-studio.js turn scan.spz --raw --n 4 --out views.png
```

The same input path works with `sheet`, `clip`, and `snap`. Use `--size` to fit the cloud to a different world size and `--up z` for Z-up captures. Use `--raw` for the imported colors or choose Ink's palette tools for a stylized resolve.

```js
const ink = require('@shapeshift-labs/ink-studio');

async function frame(file) {
  const cloud = await ink.readGaussianSplat(file);
  const world = await ink.gaussianSplatWorld(cloud, { size: 6 });
  return ink.render(world, { w: 640, h: 480, raw: true });
}
```

In the browser, import `decodeGaussianSplat(bytes)` and `gaussianSplatWorld(cloud)` from `webgl.mjs`. Pass the resulting world to `createRenderer()` as you would a baked Ink scene. The PLY-only synchronous function `decodeGaussianPly()` and the async `decodeGaussianSpz()` are available from the same entry.

- **PLY.** Graphdeco-style Gaussian vertices in ASCII or binary, in either byte order. The first element must be `vertex` with scalar fields for position, log-scale, quaternion, opacity logit, and DC color. Contiguous higher-order SH properties are retained through degree 4.
- **SPZ.** Niantic SPZ versions 1–4. Versions 1–3 use gzip. Version 4 uses Zstandard, decoded natively in supported Node runtimes or with the included fzstd fallback. Ink decodes the core attributes and reports optional extension and antialias flags. Extension payloads and SPZ-specific antialias rendering are outside the Ink world conversion.
- **World conversion.** The decoder retains XYZ, scales, normalized XYZW rotation, opacity and SH coefficients in typed arrays. World conversion fits the cloud and packs each Gaussian's covariance for Ink's renderer. It uses DC color by default. Set `viewDirection: [x, y, z]` in source coordinates to bake the retained harmonics for a fixed viewing direction. The current Ink renderer uses packed color during orbiting.
- **Limits.** Decoding defaults to a four-million-point maximum. Hosts can pass a lower `maxPoints`. A file named `.gsz` must contain a recognized PLY or SPZ payload. Derivative's [Point File In reference](https://docs.derivative.ca/Point_File_In_POP) and [file-type table](https://docs.derivative.ca/File_Types) list `.spz` for this format.

Format references. [Graphdeco PLY implementation](https://github.com/graphdeco-inria/gaussian-splatting/blob/main/scene/gaussian_model.py) · [Niantic SPZ](https://github.com/nianticlabs/spz) · [WebGPU specification](https://www.w3.org/TR/webgpu/)
