# CLI patch tooling

Use `ink-studio patch` to edit and inspect the wiring of an Ink graph from a terminal. Patches use the same versioned graph JSON, typed sockets, groups, assets, assertions and parameter links as `ink-studio graph`. The patch runner adds sequential video input, soundtrack analysis, streaming region tracking and optional native WGSL compute.

[Shared beat inspection links](inspection-links.md) connect event watches and rehearsal cues to the same committed world event.

[Recorded story inputs](story-integration-inputs.md) let a patch follow live story state and let an operator explicitly propose a scoped intervention.

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

## Track fixed-camera footage

Capture a clean plate of the empty scene in the same framing, crop and resolution as the processing frame. Save it as a PNG and load it through `pngAsset`. Keep the camera locked and avoid moving backgrounds. The region tracker supports up to 500,000 pixels per frame, so a 640×360 working frame leaves room for its contour budget. Match the plate to `--size` when processing at a lower resolution.

Run the bundled synthetic tabletop example to see the effects of lighting drift, speckle, holes and a brief occlusion.

```sh
node examples/patch-tooling/footage.cjs ./tabletop
node cli/ink-studio.js patch run tabletop/tracking.json \
  --video tabletop/tabletop.mkv --size 320x180 --fps 15 --frames 60 \
  --watch 'original=original:value,difference=subtract:difference,raw=subtract:value,mask=cleanup:value,ids=ids:value,key=ids:key,raw-tracks=tracking:value,tracks=$tracks,events=tracking:events,picture=$picture' \
  --out tabletop/take --keep
```

Open the original, difference, raw mask, clean mask and colored ID PNGs from the same `frames/<index>/previews/` directory. White pixels in a mask are foreground. `key.json` maps each ID color to a number, and the overlay writes those numbers over the footage. Compare `raw-tracks.json` with `tracks.json` to see how much smoothing moved a center or bounding box. `events.json` shows disappearances, reappearances, splits and merges. For exact per-pixel IDs, watch `labels=tracking:labels` to save a numeric JSON raster with `0` for background. That watch can substantially increase the size of a frame archive.

| Node | Settings and ports |
| --- | --- |
| `patch.cleanPlate` | `source` and `plate` must have matching dimensions. `difference` is the maximum absolute difference across RGB and alpha coverage in byte levels. `value` thresholds it to a binary mask. Increase `threshold` (1–255, default 30) to suppress small changes. Set `maxDrift` (0–64, default 0) to compensate for a bounded per-channel median offset where most of the opaque frame is background. |
| `patch.cleanMask` | `source` is thresholded by luma at `threshold` (default 128). `open` removes narrow details and `close` fills small gaps and pinholes. Both are square kernel radii (integer pixels 0–32, defaults 0 and 1). The kernel clips at the image edge. After morphology, `minArea` (default 8) drops smaller foreground regions using `connectivity` (4 or 8, default 4). `value` is the cleaned mask. |
| `patch.track` | Wire the cleaned mask to `source`. The default luma threshold detects its white pixels. `labels` contains the per-pixel IDs, while `value` contains the raw tracks. Match the `options.connectivity` setting to cleanup if using 8-connected regions. |
| `patch.trackIds` | Wire in `tracking:labels`. `value` paints each visible ID with a consistent color, and `key` lists the colors and full numeric IDs. |
| `patch.smoothTracks` | Wire in `tracking:value` and `tracking:generation`. It smooths centers, bounds and velocity for each visible ID, preserving measured area, confidence and contours. Set `halfLife` in seconds (0–10, default 0.1, with 0 passing tracks through) and `snapDistance` in pixels (default 24, with 0 disabling distance-based snaps). The filter starts fresh after an absent track, a tracker reset or a time reset. |

The example exposes `threshold`, `maxDrift`, `minArea` and `halfLife` as named inputs. Pass `--controls controls.json` to adjust them during playback.

## Run a patch as a show

`patch show` runs a patch at wall-clock speed and sends a named picture output to a dedicated projector page. The cue file sets the patch, sources, frame rate, projector mapping, presets and controls. This example reuses the tabletop patch.

```sh
node examples/patch-tooling/footage.cjs ./tabletop
cp examples/patch-tooling/show.cues.json tabletop/show.cues.json
node cli/ink-studio.js patch show tabletop/show.cues.json --report tabletop/show-report.json
```

Open the `projector` URL from the `show-ready` line in Chrome on the computer running Ink. Move the window onto the projector display, then click **Start in full screen**. This releases the show clock. Chrome asks for MIDI device access if the cue file configures MIDI. The projector server listens on loopback and feeds one active window. Omit `projector.surfaces` for a picture that fits the window, or set corners, crop, edge blends and gain using the [projection surface settings](show-control.md#map-projector-surfaces). Every surface uses the selected patch output, so the cue file can omit the surface's `source` field.

| Cue field | Behavior |
| --- | --- |
| `format`, `version`, `patch`, `output` | Use `ink-studio/patch-show`, `1`, a patch project file relative to the cue file, and the name of its display raster output. |
| `fps`, `size`, `frames` | Default to 30 fps and 320×180 media input. FPS accepts a number or ratio such as `30000/1001`. `frames` bounds the show to 1–36,000 slots. With no bound, a live show runs until interrupted and a rehearsal runs for 120 slots. |
| `video`, `audio`, `videoTimeoutMs` | Video accepts a local clip or `-` for a **paced** stream of tightly packed RGBA8 frames. Audio accepts a WAV, or `video` for the soundtrack of a local clip with a finite show length. Paths resolve from the cue file. Audio feeds patch nodes. Video holds the last available frame during an outage and uses black before the first frame. Failed audio loads use silence and appear in the report. `videoTimeoutMs` defaults to 1000. |
| `inputs`, `presets`, `initial`, `cues` | Each preset contains named graph input overrides applied on top of `inputs`. `initial` selects the starting preset. Each cue has a zero-based `frame` and a `preset`. If a deadline skips a scheduled cue, the latest due preset applies on the next rendered slot. The last valid MIDI or OSC selection received before that slot takes precedence. |
| `cueMap` | A relative path to a [clock map report](take-clock.md#map-an-editorial-cut) with matching picture rate and resolved cue addresses. Ink schedules its presets at `showFrame` and includes the exact mapped time and original source address in the rehearsal report. Inline and mapped cues need distinct frames. |
| `liveWorld` | Optional object with `url` and `token` from `sim live`, plus the name of the patch's `liveSnapshot` graph `input`. Shows join at the current world tick. Each newly observed contiguous tick can deliver pulses. Rehearsals report connection status as the `world` source. [Live world protocol and demo](simulation-output-adapters.md#join-a-running-world) |
| `assetRegistry` | Optional locked registry path relative to the cue file. Use ID and revision references in `patch`, `audio`, or `projector.surfaces`. The show report includes their exact identities and hashes. [Stable presentation asset references](stable-asset-references.md) |
| `projector` | `port` defaults to `0` for an available loopback port. `wait` defaults to `true` in show mode and `false` in rehearsal mode. Use `wait: true` when rehearsing with a connected display. |
| `osc` | Optional IPv4 UDP input. Defaults are host `127.0.0.1`, port `9102` and address `/ink/preset`. Send one string argument containing a preset name. `idleMs` flags silence after the configured interval when a sender is expected to keep sending. Use the assigned `oscPort` from `show-ready` when the configured port is `0`. |
| `midi` | Optional input via the projector's Web MIDI connection. Use `input` for an exact device name or omit it to use the first connected input. `channel` is 1–16 and defaults to 1. `notes` and `programs` map numbers 0–127 to preset names. Note-on requires positive velocity. |

For example, add `"midi": { "channel": 1, "notes": { "60": "steady", "62": "responsive" }, "programs": { "4": "steady" } }` to the tabletop cue file. Use the [Web MIDI API](https://www.w3.org/TR/webmidi/) on the projector computer or send `/ink/preset` with the string `responsive` from an OSC controller.

Set `projector.wait: false` to let the patch run before the projector joins. The projector starts from the latest complete picture and follows its frame serial. After reconnect, frame skips are measured from the new baseline. A headless projector client can read the session `key` from `GET /session`, send it as `X-Ink-Session` with a stable `X-Ink-Client`, call `GET /snapshot`, then poll `GET /frame?after=SERIAL` using the last drawn `X-Ink-Serial`. HTTP 204 means a picture is pending or unchanged. `X-Ink-Ended` marks the completed show after the final picture has been acknowledged.

### Rehearse and diagnose

```sh
node cli/ink-studio.js patch show tabletop/show.cues.json \
  --rehearse --report tabletop/rehearsal.json
```

The final `show-report` line is the same JSON written by `--report`. A rehearsal returns exit status `2` for missed frames, slow stages, input outages, or failed graph assertions. `dropped.schedule` counts wall-clock slots missed by evaluation, `dropped.projector` counts published frames skipped between the viewer's draw acknowledgements, and `dropped.video` counts incoming frames superseded before the patch could use them. A headless rehearsal can measure the graph and inputs. Attach the projector page to measure viewer drops and MIDI.

`stages` gives per-stage timing for the graph, each evaluated node, and projector image preparation. `slowMs` sets the threshold in the cue file and defaults to one frame interval. `sourceEvents` includes the frame index, elapsed time and reason for input outages and recoveries. `presets` shows each applied preset and where it came from. Press Ctrl-C to end a live show and write the report.

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
