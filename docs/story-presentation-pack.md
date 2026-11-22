# Story presentation packs

`ink-studio story present` renders several views from one verified native world recording or story run bundle. Each view uses the same world tick, picture frame, audio sample range, and source beat IDs. Change the presentation plan and replay the recording to produce a different interpretation of the same events.

The command runs headlessly and writes images, inspection data, and optional media for the existing projector runner.

```sh
ink-studio story present beacon.run.json beacon.present.json --out pack
ink-studio patch show pack/views/screen/show.json --rehearse --report rehearsal.json
```

## Plan a pack

Create an `ink-studio/story-presentation-plan` version 1 JSON file. Give it an `id` and a `views` map with up to 12 named views. File paths resolve from the plan directory.

```json
{
  "format": "ink-studio/story-presentation-plan",
  "version": 1,
  "id": "beacon",
  "window": { "fps": { "numerator": 30000, "denominator": 1001 }, "fromFrame": 30, "toFrame": 90 },
  "markers": "markers.plan.json",
  "performance": "performance.plan.json",
  "effects": "effects.plan.json",
  "views": {
    "operations": { "mode": "debug", "story": "harbor-watch/dispatch", "entities": ["keeper", "skiff"] },
    "stage": { "mode": "puppet", "graph": "puppet.graph.json", "width": 320, "height": 192 },
    "harbor": { "mode": "splat", "width": 320, "height": 192 },
    "light": { "mode": "webgpu", "source": "harbor", "shader": "beacon.wgsl", "channel": "beacon-refract" },
    "screen": { "mode": "projector", "source": "light" }
  }
}
```

`window` is optional. Frame rate defaults to the recorded take's rate, or 24 fps when the recording has no take clock. `fromFrame` and `toFrame` form a half-open range of absolute picture frames. Omit either boundary to use the available full frames in the recording. The output timeline keeps original event times, including events authored at sub-tick times.

| Mode | Input and configuration |
| --- | --- |
| `debug` | Draws world positions and visual footprints on an X/Z map and shows the selected story's current status and stage. Use `entities` to pick IDs, `story` to select a document/story pair, and `bounds` with `min` and `max` vectors to frame the map. |
| `puppet` | Takes a [performance plan](actor-performance.md) and an Ink `graph` with a record input named `performance`. Use `scene.actorPerformance` to get poses, cast, props, and captions. Set `output` to the graph's picture output name if it differs from `picture`. The graph controls the composition and returns a raster at the configured dimensions. |
| `splat` | Uses the recorded world's native splat scene, effects, and persistent visual consequences. Optionally override the camera with `target`, `dist`, `yaw`, `pitch`, and `fov`. Camera angles are in radians. |
| `webgpu` | Runs WGSL on a puppet or splat `source` at its dimensions. Use `shader` for the compute program and `amount` to scale its strength from zero to one. An optional `channel` samples a shader cue from the [effects plan](event-visual-effects.md) and provides its intensity and world position. Without a channel, strength defaults to one and the position to the origin. |
| `projector` | Takes a puppet, splat, or WebGPU `source`. It composites transparent pixels onto black and writes an opaque lossless feed and a stock show cue file. Use `surfaces` for the [projection mapping](show-control.md#map-projector-surfaces). |

Debug, puppet, and splat views default to 320×180. Width and height each accept integers from 64 through 1024. The WebGPU adapter uses the patch shader bindings for a source texture, output texture, and 32-byte uniform containing time in seconds, amount, width, height, world position, and padding. The demo includes a working shader. Install the optional `webgpu` package or pass `--gpu-module` when selecting this mode. Projector encoding uses `ffmpeg` by default and accepts `--ffmpeg` to select an executable. The generated cue file plays the picture at its authored rate.

## Inspect and play the result

- `presentation.json` gives the shared clock, source recording digest, and per-view frame receipts with relative PNG paths and SHA-256 hashes. A committed event is linked at the first frame in the selected window that observes its tick. Active performance and effect cues can extend across several frames.
- `timeline.json` contains editable markers. An optional [marker plan](story-scene-timeline.md) labels events used by the production. The pack also includes the projected performance and effect sheets when configured.
- Each projector view includes `feed.mkv`, `patch.json`, and `show.json`. Run the show cue file through the existing projector runner. Playback starts at local frame zero. The pack keeps the source frame and tick so you can find the corresponding simulation state.
- `ink-studio beat <id> pack/presentation.json pack/timeline.json` finds the same event in the frame receipts and editable timeline. Add the performance and effects reports to follow the event into the corresponding gesture, caption, light, or shader.

## Try the beacon demo

```sh
npm run build
node examples/story-presentation/demo.cjs ./beacon-demo /path/to/webgpu/index.js
```

The example records a harbor-watch choice and uses the resulting beacon event in a top-down map, a rigged puppet scene, a native splat view, and a WebGPU treatment. The projector uses the WebGPU picture. The example compares decoded projector pixels against all 18 source frames and runs the stock rehearsal. A second plan crops the same recording and sends a different splat camera to the projector without the shader. The demo also writes both previews and the beat inspection report.
