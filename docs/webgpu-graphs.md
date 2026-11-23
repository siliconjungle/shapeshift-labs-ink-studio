# WebGPU texture and geometry graphs

Ink's WebGPU graph compiles a dependency graph of WGSL compute passes. A pass can read textures and buffers together and publish textures or buffers for other passes or for drawing. The GPU owns those resources between passes. Read them back explicitly when an authoring tool or export needs the bytes.

The graph is an opt-in browser module. Request a WebGPU device from a secure origin such as HTTPS or localhost. Ink's full scene renderer uses WebGL 2. The WebGPU Gaussian renderer renders imported clouds directly on the device. WebGPU resources can feed a WebGPU render pass on the same device. To use their data in the WebGL renderer, read back the resource and upload it to the scene.

## Run the gallery

From the repository root:

```sh
npm run build
python3 -m http.server 8180 --bind 127.0.0.1
```

Open [GPU Studies](http://127.0.0.1:8180/examples/webgpu-graphs/). Refraction generates and filters a texture. Change its channel shift or edit its WGSL and apply it live. Fold deforms a 16,641-vertex surface and shades it using the texture from Refraction. Pelagic opens sample PLY and SPZ assets or a local file and renders them through Ink's WebGL 2 pipeline. The [side-by-side viewer](../examples/live-gaussian/index.html) shares a camera between directional RGB and palette views. [Pelagic Current](../examples/gaussian-gpu/index.html) shows GPU culling, projection, and sorting with a denser imported cloud and timing receipts.

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

To keep coefficients on the GPU and shade from the current camera:

```js
const world = gaussianSplatWorld(await decodeGaussianSplat(bytes), {
  colorMode: 'rgb',
  palette: [0x0b1523, 0x24465c, 0x4089a8, 0x86d3d3, 0xcd7e7b, 0xffd5b0]
});
renderer.render(world, { camera, gaussianColor: 'palette', width: 320, height: 240 });
```

- `colorMode: 'rgb'` uses the decoded directional RGB. `colorMode: 'palette'` uses the same shading and resolves the composited pixels against the world palette.
- `gaussianColor` switches a live world between `'rgb'`, `'palette'`, and its packed `'baked'` fallback. The live RGB and palette choices control palette resolve even when the frame supplies `raw`.
- `colorMode: 'baked'` is the default. The CLI and CPU renderer use the packed fallback, including any source-space `viewDirection` supplied at import.
- Live color evaluates degrees 0–4 on the GPU. Perspective rays run from the camera to each splat. Orthographic rays are parallel. The importer keeps the coefficients in source coordinates and applies the inverse of its up-axis rotation to the rays.
- A live cloud uses 12 bytes of RGB coefficient data per term and point before texture padding. For large files, set the decoder's `maxPoints` to suit the device.

- **PLY.** Graphdeco-style Gaussian vertices in ASCII or binary, in either byte order. The first element must be `vertex` with scalar fields for position, log-scale, quaternion, opacity logit, and DC color. Contiguous higher-order SH properties are retained through degree 4.
- **SPZ.** Niantic SPZ versions 1–4. Versions 1–3 use gzip. Version 4 uses Zstandard, decoded natively in supported Node runtimes or with the included fzstd fallback. Ink decodes the core attributes and reports optional extension and antialias flags. Extension payloads and SPZ-specific antialias rendering are outside the Ink world conversion.
- **World conversion.** The decoder retains XYZ, scales, normalized XYZW rotation, opacity and SH coefficients in typed arrays. World conversion fits the cloud and packs each Gaussian's covariance for Ink's renderer. It uses DC color by default. Set `viewDirection: [x, y, z]` in source coordinates to bake the retained harmonics for a fixed viewing direction. Use a live color mode in WebGL to evaluate those coefficients during orbiting.
- **Limits.** Decoding defaults to a four-million-point maximum. Hosts can pass a lower `maxPoints`. A file named `.gsz` must contain a recognized PLY or SPZ payload. Derivative's [Point File In reference](https://docs.derivative.ca/Point_File_In_POP) and [file-type table](https://docs.derivative.ca/File_Types) list `.spz` for this format.

### Render a cloud with GPU visibility

The WebGPU renderer accepts a world from the PLY, SPZ, or GSZ decoder and
draws its baked RGB into a WebGPU texture. Use the same orbit camera
settings as the scene renderer. Set `viewDirection` in `gaussianSplatWorld`
to bake directional color before upload. The WebGL viewer continues to
offer live harmonic color, palette resolve, and its scene and material tools.

```js
import { createGaussianSplatRenderer, decodeGaussianSplat, gaussianSplatWorld } from './webgpu.mjs';

const adapter = await navigator.gpu.requestAdapter();
const device = await adapter.requestDevice({
  requiredFeatures: adapter.features.has('timestamp-query') ? ['timestamp-query'] : []
});
const format = navigator.gpu.getPreferredCanvasFormat();
const context = canvas.getContext('webgpu');
context.configure({ device, format, alphaMode: 'opaque' });
const renderer = await createGaussianSplatRenderer(device, { format });

const cloud = await decodeGaussianSplat(bytes, { maxPoints: renderer.maxSplats });
renderer.setWorld(gaussianSplatWorld(cloud, { size: 6 }));
const report = await renderer.render(context.getCurrentTexture(), {
  yaw: .5, pitch: -.1, profile: true
});
console.log(report);
```

Upload a cloud once with `setWorld` and reuse it across camera moves. A
compute pass projects the full covariance, checks the near and far planes
and the projected three-sigma bounds, and compacts the survivors. A GPU
depth sort orders that compact list back to front, breaking equal depths by
original source index. The visible count limits both indirect sort dispatches
and the indirect draw. The draw consumes the projected ellipses directly.
The normal frame path transfers a 96-byte camera uniform and returns
immediately after submitting commands.

Request `profile: true` for a diagnostic frame. It reads back the count and
optional timestamps. `sortCapacity` is the active padded count in the sort.
The report lists the cloud bytes uploaded since the previous frame and the
camera bytes separately with CPU enqueue timings. On a device created with
`timestamp-query`, `gpuMs` gives distinct timings for projection and culling,
sorting, and the raster pass including fragment shading and blending. Devices
without timestamps return `gpuMs: null` with the same counts and upload data.
Call `dispose()` when the renderer is no longer needed.

### Stream Gaussian chunks

Build a pack from a PLY, SPZ, or GSZ input.

```sh
node scripts/pack-gaussian-chunks.mjs scan.ply packs/scan 2 .2,.1,.05,0 6
```

The arguments after the destination are the spatial cell size, nested
voxel sizes, fitted world size, and optional up axis. A final voxel size
of zero keeps the original records. The packer groups samples into
spatial chunks, matches the moments of each coarser voxel, and records the
largest source-center displacement per tier. The `manifest.json` records
bounds, levels, revisions, and chunk filenames. Its little-endian binary
payloads contain the same 64-byte records as the imported Gaussian world.
Serve the manifest and its files together over HTTP. Code can use
`packGaussianChunks(world, { layer: index => 'foliage', ...settings })`
to assign layer IDs before writing a pack.

After creating a WebGPU renderer and loading Ink's browser toolkit:

```js
import { createGaussianChunkStream } from './webgpu.mjs';

const url = new URL('./packs/scan/manifest.json', location.href);
const manifest = await (await fetch(url)).json();
const stream = createGaussianChunkStream(renderer, KIT, manifest, {
  url,
  budgetBytes: 6 * 1024 * 1024,
  maxSplats: 70000,
  projectedError: { targetPx: 3, hysteresis: .2 },
  guardPixels: 16,
  layers: { foliage: { maxSplats: 20000, splatsPerPixel: .6 } }
});
const report = await stream.render(context.getCurrentTexture(), { yaw: .5, profile: true });
console.log(report.stream);
```

Advance by rendering frames as the camera moves and while the shot has
pending loads. The renderer uploads each admitted chunk as it arrives,
draws from the resident buffers, and sorts their visible splats together.
The byte budget caps chunk buffers and in-flight reservations. The render
report lists reusable projection and sort workspace separately as
`workBytes`. The visible splat ceiling applies before GPU culling, so
the profiled GPU visible count is at or below that ceiling. Call
`stream.dispose()` before disposing the renderer.

Run the [Glasswater Transect demo](../examples/gaussian-stream/) with:

```sh
npm run build
node examples/gaussian-stream/prepare.mjs
python3 -m http.server 8180 --bind 127.0.0.1
```

Open [Glasswater Transect](http://127.0.0.1:8180/examples/gaussian-stream/)
and play the dolly or scrub the camera. The receipt shows the resident
chunks, draw tiers, memory, visible splats, and per-layer limits.

## Inspect a patch while orbiting

In the [Pelagic viewer](../examples/live-gaussian/index.html), click either view
or move the cursor with the arrow keys and press Enter. The marker follows the
selected splat in world space. **Base (DC)** shows its constant color and
**Live splat RGB** shows its evaluated harmonics. **Palette pixel** shows the
swatch actually rendered through that patch after the cloud is composited.
The viewer hides the swatch when the splat's contribution falls below the
visibility threshold.

Small orbit steps can flag a swatch jump. **Check ±1°** samples the nearby
views without moving the displayed camera. A jump requires a weighted RGB
distance of at least 24 on the 8-bit scale over at most two degrees of orbit,
with the selected splat visible in both samples.

Hosts can use `createGaussianColorInspector(renderer, world, { width, height })`
from `webgl.mjs`. Pass normalized top-left coordinates and the same camera
frame to `select(u, v, frame)`. After the palette render, call
`inspect(frame, readPalettePixel)` with a callback that reads an RGB pixel at
the returned integer grid coordinates. Coordinates start at the top left.
Pass successive inspection samples to `gaussianSwatchJump(before, after)`
to compare visible swatches on the selection.

### Paint a mask on an imported cloud

In [Pelagic](../examples/live-gaussian/index.html), select **Paint** and drag
over either view. The brush picks nearby visible contributors and retains
their splat indices. Turn the cloud to continue the same mask from another
angle. **Show mask** displays its visible coverage in the palette view. **Erase**, **Undo**,
and **Clear mask** let you revise it.

- **Mask ramp** quantizes the painted region against its own editable swatches.
- **Protect painted pixels** lets the region keep its resolved pixels when
  **Pixel cleanup** is enabled. Ramp and cleanup controls work independently.
- Translucent splats participate through the same back-to-front opacity
  compositing as the color pass. A foreground occluder can hide painted splats.

For browser hosts, import `createSplatMaskPainter` from `webgl.mjs`. Create
it with `(renderer, world, { width, height })` using the palette render's art
grid. Call `stroke(points, frame, { radius, erase })` with normalized
top-left points and a radius in art pixels. Use the returned mask or read
`painter.mask` after `undo()` or `clear()`. The mask can be stored as JSON
and reused with the same imported cloud and vertex order:

```js
renderer.render(world, {
  ...frame, gaussianColor: 'palette', clean: true,
  splatPaint: { mask: painter.mask, ramp: [0x432640, 0x974a5b, 0xf08a62, 0xffdda0], protect: true }
});
```

### Export an indexed turntable sheet

Open **Turntable sheet** in [Pelagic](../examples/live-gaussian/index.html).
Enter angles in degrees in the order you want them to play. Set the tile size,
columns, FPS, and the minimum visible coverage for the cutout. **Build preview**
renders the actual indexed frames. Play the loop or step through the frames
with the pivot crosshair visible. The preview reports empty frames and frames
that touch the tile border.

Download the indexed PNG and JSON sidecar after checking the loop. All tiles
share a palette, including any applied mask ramp, and use the same orthographic
framing and center pivot. The cutout uses splat coverage and reserves a separate
transparent palette entry. JSON includes top-left tile rectangles, tile-local
pivots in pixels, yaw angles in degrees and frame durations in seconds.

Select **Bake normals** before building the preview to export a matching RGBA
normal PNG. Inspect the normal colors or move the light in **Toon light**.
The normal sheet stores view-space XYZ in RGB, with X right, Y up, and +Z toward
the camera. Alpha zero marks a missing normal. Gaussian normals are estimates
from the visible splats' covariance axes. Export coverage and a normal's alpha
can differ where the visible splats lack a reliable surface axis.

Hosts can call `renderer.captureTurntable(world, { angles, width, height, columns,
fps, cutoff, pivot, frame, normals })` for an imported live Gaussian world. `cutoff`
ranges from above zero to one and `pivot` is a world-space XYZ point.
The result contains the shared indexed pixels and their metadata.
`encodeGaussianTurntablePNG(sheet)` from `webgl.mjs` produces a PNG Blob
from that same result. With `normals: true`, the result also contains `normal`
RGBA bytes in the same tile layout. Encode them with
`encodeGaussianTurntableNormalPNG(sheet)`.

Format references. [Graphdeco PLY implementation](https://github.com/graphdeco-inria/gaussian-splatting/blob/main/scene/gaussian_model.py) · [Niantic SPZ](https://github.com/nianticlabs/spz) · [WebGPU specification](https://www.w3.org/TR/webgpu/)
