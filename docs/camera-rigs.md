# Camera rigs and shot blends

Set `cameraRig` on a JSON diorama or `visual.cameraRig` on a simulation world. The CPU renderer, WebGL renderer, and CLI use the same sampling code. Angles and vertical field of view are in radians, lengths are in world units, and times are in seconds.

| Field | Controls |
| --- | --- |
| `targets` | Reusable framing points. Set `point` in world space, add `part` to follow a diorama part from that rest point, or set `entity` and optionally `socket` to follow a simulation entity. `offset` follows the target's local coordinate frame when it has one. An unavailable target uses its optional world-space `fallback` or the scene camera target. |
| `rails` | Paths through `points` with an optional `curve` from 0 for straight segments to 1 for smooth curves, and `closed` for loops. Rail progress measures distance along the path. |
| `shots` | Named camera poses. Set `target` to a target ID or an XYZ point. Place the camera with `yaw`, `pitch`, and `dist`, a fixed world-space `eye`, or a named `rail` with `progress`. Progress can be a fraction or keyframes with `time`, `value`, and optional `ease`. Use `fov` and `projection` to set the lens. Unspecified orbit and lens settings come from the scene camera. |
| `sequence` | Ordered rows with `time` and `shot`. The first row starts at 0. Each subsequent row cuts unless it sets a positive `blend` duration. `ease` defaults to `smooth`. `projectionAt` controls the projection switch as a fraction of blend time and defaults to .5. Omit the sequence to play the first shot. |
| `duration` | Optional total duration, in seconds. It must include scheduled blends and rail keys. Clips use the longer of this duration and the scene timeline. |
| `avoidance` | Set to `true` for basic avoidance, or configure `radius`, `start`, `minDistance`, `yawOffsets`, `ignore`, and `field`. |

Rail keyframes run on the shot's local clock, beginning at each sequence entry. The outgoing shot keeps advancing during a blend. Blends interpolate framing, orbit, distance, and lens, taking the shortest yaw turn. `projection` is `perspective` or `orthographic`. The mode switches at the configured point while the eye and subject-plane scale continue along the blend. An orthographic rig uses the actual rail or orbit eye.

Avoidance runs after blending. It tries the authored camera direction first, then each optional relative `yawOffsets` angle in order. If all directions are obstructed, it uses the one with the most room and retracts the camera while retaining subject-plane scale. `radius` adds clearance and defaults to .12. `start` skips the first .35 units around the target by default. `minDistance` defaults to .6. The report sets `occluded` if that minimum limits retraction. The default probe checks opaque baked splats and omits the named target and splats matching any `ignore` target selector. A simulation can specify a signed-distance `field` such as `rig/clearance` to use collision geometry and exclude the current framing entities.

The unified timeline can key `/camera/fov`, `/camera/projection`, and the existing orbit channels. With a rig present it can also key `/camera/railProgress` and cut with `/camera/shot`. Timeline camera values override the corresponding shot channels. An explicit shot selection overrides the sequence and timeline shot selection, and samples the selected shot from time zero.

- `ink-studio camera-rig <scene-or-world> --at <seconds>` reports the sampled camera, blend position, and avoidance result. Add `--camera-shot <id>` to inspect a specific shot. For simulation worlds, the target pose comes from the last simulation tick at or before the requested time.
- `render`, `sheet`, `clip`, and `sim render` use the authored camera by default. Use `--camera-shot <id>` to select a shot and `--ortho on|off` to override the projection.
- Use `world.cameraRig.sample(time, { shot })` to inspect a baked scene. Advance animated dioramas or obtain the simulation snapshot first so targets follow the current scene pose. WebGL accepts `time` and `cameraShot` on the render frame, and the Node renderer accepts `t` and `cameraShot` in its options.
- Programmatic hosts can call `KIT.cameraRig.compile(definition)` and sample it with a base camera, a `resolveTarget` callback returning `{ point, rotation? }`, and a collision query. `clearance(point, { radius, exclude })` returns signed distance. `occlusion({ origin, direction, maxDistance, radius, exclude })` returns the first hit distance or `undefined`.

Family rails can use `{family: {type: "torusKnot", p: 2, q: 3, ...}}` in place of a point rail. They retain the shared curve sampling and accept no other rail fields. See [curve families](curve-families.md).

Interpolated rails accept `{interpolated:{points,options}}`, where the contents are a `K.curve.interpolate()` snapshot. This retains shared adaptive sampling and periodic interpolation without a second spline pass. See [curve analysis](curve-analysis.md).

Named targets can follow a live hierarchy frame with `{node,socket?,offset?,fallback?}`. Hidden/missing nodes use the framing fallback. See [live scene hierarchy](live-scene-hierarchy.md).
