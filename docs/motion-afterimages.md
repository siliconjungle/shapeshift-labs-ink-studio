# Motion-aware afterimages

Set `look.afterimages` to a list of trail settings, or pass `afterimages` to the renderer as a frame override. Each trail captures past splat poses from selected source splats that are active in the scene and fades them over time. Opaque scene geometry can hide the ghosts. The ghosts themselves are translucent and leave scene depth and ownership intact.

Omit `attach` to leave old poses at their scene positions. With `attach`, the history uses the selected receiver's local frame and follows its current pose. A surface attachment projects the history onto the anchor's tangent plane. Choose an anchor near the intended mark for a curved surface.

| Setting | Effect |
| --- | --- |
| `select` | Required source selector. Supports named objects, materials, entities, surfaces and tags. |
| `attach` | Optional selector for the moving object or surface that carries the trail. |
| `at` | Optional XYZ point in the receiver's rest space. Uses the nearest matching splat as the anchor. Without it, the first visible matching splat is used. |
| `project`, `lift` | Project onto the anchor's tangent plane and lift the mark above it by world units. Projection defaults on for surface selectors. Lift defaults to 0.004. |
| `duration`, `interval`, `copies` | Fade duration in seconds, minimum time between samples, and the number of retained poses. Defaults are 0.4 seconds, 1/30 second, and six poses. |
| `opacity`, `color` | Initial opacity from 0 to 1 and an optional hex tint. The default opacity is 0.45. The source's baked colors are used when color is omitted. |
| `maxSamples`, `motionThreshold` | Maximum splats captured per pose and the distance below which unchanged samples are suppressed. Defaults are 512 splats and 0.01 world units. |

The renderer accepts up to eight trails, 16 retained poses per trail and 2,048 splats per pose. The frame's look and optical media also apply to the ghost geometry. Water reflections use the same captured trail poses as the main view.

WebGL manages a history automatically. It accepts an explicit `frame.afterimageHistory` and `frame.resetAfterimages` for camera cuts. Afterimages use the automatic depth sorter. With a host-supplied draw order, the renderer uses the host's rows. Instanced sources and receivers use the expanded draw path.

For repeated Node renders, create `K.afterimages.history()` and pass the same object as `afterimageHistory`. Update the world's animation before each frame. Rewinds, scene switches and changes to an attachment start fresh history. Call `history.clear()` or set `resetAfterimages: true` at a cut. The CLI manages history in clips, sheets and transition reviews. Use `--afterimages file.json` to supply a trail list or `--afterimages off` to disable it.

## Subject-attached feedback

Use `anim.subjectFeedback` or `K.procedural.subjectFeedback.create()` to retain a texture in a receiver’s UV chart. A posed mesh samples the same chart as it translates, rotates or deforms. The surface goes through the native depth test in both renderers, so foreground geometry hides the marks while the history continues to age.

```js
const feedback = K.procedural.subjectFeedback;
const history = feedback.create({ width: 96, height: 54, halfLife: 1.2, velocity: [4, 0] });
const paint = feedback.bindAtlas(atlas, region);
const { value } = history.sample(sourceOrNull, time);
paint.apply(value);
```

Pass a display raster at chart size to paint directly, or pass `null` to advance without new paint. For screen capture, pass a display raster and sample options with an aligned `coordinates` raster. Two-channel coordinates are normalized UV with the origin at the top left. A configured `projection` accepts three-channel rest-space coordinates, such as the native `objectPosition` pass. Choose a plane, cylinder or ribbon projection that matches the receiver’s chart, and set `extent` to its U and V spans. Pass the position pass’s `valid` buffer, and use `objectId` as `owners` with a positive `owner` to limit deposits to the visible receiver. Multiple screen pixels landing in one texel are averaged.

Set `halfLife` in seconds and `velocity` in chart texels per second. `gain` scales new deposits from zero to one. Use `filter: 'linear'` to interpolate motion across texels and `wrapU: true` to wrap the horizontal seam. A chart-sized `refresh` mask clears selected history before fresh paint is added. The `deposited` output is a byte mask of the current deposit strength.

Give each receiver its own history. Repeated samples at the same time use the stored chart. A backward seek, `reset: true` or `history.clear()` clears it. The graph node also resets on playback cuts. Its input ports correspond to the source and sample options in the session API, with the chart settings supplied through `options`.

Bind an atlas region used by a UV-mapped sprite mesh to update the retained texture over the region’s base art. `paint.clear()` restores that art. Move the receiver with scene attachments or update the mesh vertices while keeping their UVs.

Run `node examples/subject-feedback.cjs wakeplate.html` for a standalone demo of a deforming receiver moving behind a foreground gate.
