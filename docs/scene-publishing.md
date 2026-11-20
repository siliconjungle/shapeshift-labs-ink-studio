# Scene publishing

`ink-studio export-scene <scene> --out <directory>` publishes from the same authored scene, seed, and look. Each output is identified by a relative path in `export.json`. Keep the referenced take directory when relocating an export.

Scenes that register [editable simulation inputs](editable-simulation-inputs.md) include a JSON sidecar in the manifest and carry their seed and marks in scene replay and embed data. Open the sidecar or replay with the original scene and `--authoring` to rerender the simulation.

| Product | Contents |
| --- | --- |
| `still` | A PNG rendered at the requested still time. The renderer receives the sequence dimensions multiplied by `--still-scale`, which defaults to 2. |
| `loop` | An indefinitely looping APNG and numbered PNG frames for external editing. |
| `replay` | A portable `scene.replay.json` containing the original PNG frames, source start time, and playback rate. |
| `embed` | A self-contained HTML file with offline playback. It can run as a page or inside an iframe. |

All four products are included by default. Use `--formats` with a comma-separated list to select outputs. Set `--w`, `--h`, and `--px` to control the sequence dimensions and native art-pixel size. `--px1` renders at one screen pixel per art pixel. Use camera, palette, and other headless view options as usual. Pass `--transparent` for straight-alpha color.

Set the motion interval with `--from`, `--to`, and `--fps`. The endpoint is exclusive. The default rate is 12 fps and the range begins at zero. The default end uses the authored timeline or camera duration when available, with a two-second fallback. `--t` selects the still independently and defaults to `--from`. The still and moving capture each start from fresh scene state so either can sample a stateful scene from its own starting time. The moving capture can use `--camera-orbit` and `--camera-pan`.

## Replay and embed

`ink-studio scene-replay <recording.json> --at <elapsed-seconds> --out <frame.png>` extracts the original PNG for that playback time. Add the recording's `start` to the frame offset to recover its source scene time. Use `--embed --out <embed.html>` to regenerate the player from the recording.

With `--embed-config <file.json>`, configure the page title and image alternative text with `title` and `alt`. Use booleans `controls`, `autoplay`, `loop`, and `pixelated`. Set `fit` to `contain` or `cover`, and choose hex colors or `transparent` for `background`, `color`, and `accent`. The default player starts paused and shows controls for multi-frame recordings. Autoplay respects the browser's reduced-motion preference. The output HTML contains its styles, which can also be edited directly.

The embed exposes `window.inkScene.play()`, `.pause()`, and `.seek(seconds)` for a same-origin host. `currentTime`, `duration`, and `paused` expose its playback state. The embed plays the captured visual frames. Live scene interaction is available through the [browser renderer](browser-renderer.md). [Simulation run recordings](simulation-checkpoints.md) and [shot recipes](shot-recipes.md) preserve inputs for replaying the simulation or rerendering it.

In Node, `readSceneReplay(file)` opens a recording, `sampleSceneReplay(recording, seconds, { loop })` returns the selected `png` bytes with its index and source time, and `writeSceneEmbed(recording, { out, settings })` writes HTML. `exportScene(createCapture, options)` accepts a factory called with `{ width, height, moving, from }` for each requested capture. Return `{ scene, title, duration, sample }` and have `sample(time, lastTime)` return a rendered frame with `w`, `h`, `rgb`, and optional `alpha`. `lastTime` is supplied for sequences. The export options are `out`, `formats`, `width`, `height`, `from`, `to`, `fps`, `stillTime`, `stillScale`, and `embed`.
