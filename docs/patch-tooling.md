# CLI patch tooling

Use `ink-studio patch` to edit and inspect the wiring of an Ink graph from a terminal. Patches use the same versioned graph JSON, typed sockets, groups, assets, assertions and parameter links as `ink-studio graph`. The patch runner adds sequential video input, soundtrack analysis, streaming region tracking and optional native WGSL compute.

## Run Night Current

The included generator writes a six-second source video with sound, a separate WAV, an edit journal for each patch, and two graphs. The CPU graph uses Ink's composite-video effect. The WGSL graph replaces the finish with a shader that uses the bass band to displace the image. Both route the same FFT band into the half-life of tracked trails.

```sh
node examples/patch-tooling/demo.cjs ./night-current
node cli/ink-studio.js patch plan night-current/night-current.json
node cli/ink-studio.js patch run night-current/night-current.json \
  --video night-current/night-current-input.mp4 --audio video \
  --size 320x180 --fps 12 --frames 72 \
  --watch 'camera=camera:value,boxes=markings:ink,trails=trails:value,bass=bass:value,final=$picture' \
  --out night-current/cpu --keep
```

Use FFmpeg on PATH or pass an explicit executable to the generator's second argument and to the runner's `--ffmpeg` option. The generator uses a build with H.264 and AAC encoding. To run the WGSL variant, install the optional `webgpu` package in the patch's directory or supply its module file explicitly.

```sh
npm install --prefix night-current webgpu
node cli/ink-studio.js patch run night-current/night-current-wgsl.json \
  --video night-current/night-current-input.mp4 --audio video \
  --size 320x180 --fps 12 --frames 72 \
  --watch 'before=mix:value,after=$picture,bass=bass:value,half-life=sustain:value' \
  --out night-current/gpu --keep
```

The folder names in the commands are independent of the graph. Use `npx ink-studio` in an installed package and inspect any of the example files as ordinary JSON.

## Edit a graph

```sh
ink-studio patch init project.json
ink-studio patch apply project.json edits.json
ink-studio patch plan project.json --dot > wiring.dot
ink-studio patch nodes
ink-studio patch describe patch.shader --json
```

An edit journal is a JSON array. For example:

```json
[
  {"op":"input","id":"gain","socket":{"type":"number","default":0.4}},
  {"op":"add","id":"source","node":{"op":"add","inputs":{"a":0,"b":0}}},
  {"op":"wire","from":"@gain","to":"source:a"},
  {"op":"wire","from":"source:value","to":"$result"}
]
```

| Edit | Fields |
| --- | --- |
| `add` | `id`, `node` containing a graph node definition |
| `remove` | `id` of an existing node |
| `input` | `id`, `socket` declared using the graph socket schema |
| `set` | `to`, `value` for a literal |
| `wire` | `from`, `to` |
| `bind` | `id` of the new mapping node, `from`, `to`, ascending `source: [low, high]`, `range: [low, high]` |
| `disconnect` | `to` where the socket has a default or the output can be removed |

A source is a top-level `node:port` or `@input`. A destination is `node:input` or `$output`. Omit a source port for `value`. The graph compiler checks socket types, required inputs, output references, group dependencies and cycles for the whole journal before an atomic file replacement. An invalid journal leaves the original bytes in place. `--out new.json` creates a separate project and resolves relative group and asset paths from its directory. `patch plan` also supports `--json` for the complete typed plan.

For single connections, use `patch wire`. To link a signal to a parameter with scaling and clamping, use `patch bind`. Graphs store the mapping as an ordinary `patch.map` node.

```sh
ink-studio patch bind project.json bass:value trails:length \
  --id sustain --from 0.04,0.65 --to 0.075,0.64
```

Both `patch bind` and `patch apply` validate the complete graph and save the edited wire. Patch-specific operations require the patch runner. Stock-only projects can still run through `ink-studio graph`.

## Observe a running patch

Each frame evaluates the graph once. `--watch` accepts `name=node:port` or `name=$output` entries. Use `name=group/inner:port` for the output of a node in a group instance. By default the runner watches the named graph outputs.

- With `--out`, `previews/` is refreshed with PNG images, WAV audio or JSON values. `report.json` includes the frame index, output hashes, cache status and per-node elapsed time in milliseconds. GPU elapsed time includes submission and readback.
- `--progress` emits one newline-delimited JSON report per completed frame. With `--keep`, every report also points to an immutable per-frame directory under `frames/`. The archive budget is 512 MiB per run.
- `--controls controls.json` reads a JSON object of named graph input overrides at frame boundaries. Update the file while the run is active. An invalid update after startup is reported and the last valid settings continue to drive the graph.
- `--video FILE` decodes a local clip into RGBA at the requested size and rate. `--video -` accepts tightly packed top-down RGBA8 frames on stdin from any producer. The graph timestamps frames at the declared rate, starting at zero. The runner processes successive frames in order and applies backpressure. `--audio FILE.wav` uses a separate WAV soundtrack, and `--audio video` extracts audio from a local video clip before running the patch.
- `--frames` bounds rendering. With video the default is up to 120 frames or EOF. Without video, the default is one. A raw frame must contain exactly `width × height × 4` bytes.

For a paced input example, pass a file through FFmpeg in realtime. The same raw input contract can be used with a capture device.

```sh
ffmpeg -re -i night-current/night-current-input.mp4 -an \
  -vf fps=12,scale=320:180 -pix_fmt rgba -f rawvideo - | \
  ink-studio patch run night-current/night-current.json \
    --video - --audio night-current/pulse.wav --fps 12 --size 320x180 --frames 72 \
    --watch 'picture=$picture,tracks=tracking:value,sustain=sustain:value' \
    --out night-current/live --progress
```

## Author a WGSL node

`patch.shader` accepts a raster, the WGSL source as a string, and an optional numeric `amount`. Insert the shader text into the graph with a JSON edit or by generating an edit journal from a `.wgsl` file. The runtime reuses a compiled pipeline for a shader and set of dimensions within the run.

| Binding | WGSL declaration |
| --- | --- |
| 0 | `texture_2d<f32>` source image, read with `textureLoad` |
| 1 | `texture_storage_2d<rgba8unorm,write>` destination |
| 2 | `var<uniform> controls: vec4f` with seconds, amount, width and height |

Use entry point `main` with `@workgroup_size(8,8)`, and guard coordinates outside the image. `patch.shader` returns the computed RGBA image as a normal raster port. Group instances can use shader nodes as direct graph operations and expose their outputs to the parent. This path uses the optional [Dawn Node bindings](https://github.com/dawn-gpu/node-webgpu) and an available GPU adapter. It runs without a browser.

Node hosts can use `await project.previewFrame(watches, { inputs, time }, { profile: true })` for once-per-frame evaluation and named previews from a `createGraphProject()` instance. This path can await host operations in direct group instances. The existing synchronous graph runner and worker scheduling remain available through their normal API.

More about the shared tooling. [Graph projects](headless-authoring.md#run-a-graph-project-from-the-cli) · [Audio analysis and media](graph-media.md) · [WebGPU compute](webgpu-graphs.md) · [FFmpeg device input](https://ffmpeg.org/ffmpeg-devices.html)
