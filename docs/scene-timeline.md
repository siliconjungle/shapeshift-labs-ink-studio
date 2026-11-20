# Unified scene timeline

Add `timeline` to a JSON diorama, an authored simulation world, or a scene built through the headless editor. A timeline uses seconds. Its duration defaults to the last key, cue, or clip endpoint. An explicit duration can leave room after the last item.

| Timeline field | Entry fields |
| --- | --- |
| `tracks` | `target` is a JSON Pointer or path array. Each key has `time`, `value`, and optional `ease`. |
| `markers` | A unique `id`, a `time`, and an optional `label`. |
| `audio` | A unique `id`, a `time`, and a `cue` resolved by the host. Optional `duration`, source `offset`, and `gain` default to zero, zero, and one. |
| `events` | A unique `id`, a `time`, a world event `kind`, and optional JSON object `detail`. |
| `sequences` | A catalog of named reusable timelines with their own tracks, markers, audio, events, and clips. |
| `clips` | A unique instance `id`, a `sequence`, and a start `time`. Optional `in` and `out` trim source seconds. Optional `duration` scales the retained range in the parent. |

Keys hold their first and last values within the sequence. The easing on a key controls the interval after it. Supported easings are `smooth` (the default), `linear`, `step`, `in-sine`, `out-sine`, and `in-out-sine`. Angle channels interpolate by the shortest arc. Positive channels such as camera distance and pose scale interpolate geometrically. Boolean and string channels hold their values until the next key.

Each clip maps track samples, cue ranges, and point events through the same trim and rate. Nested clips can reuse the same source under different instance IDs. Cue records carry the instance IDs in `path`. A clip overrides a parent track while its range is active. If sibling clips overlap on a target, the later-listed clip takes precedence. Point events at either trim boundary are included.

## Dioramas

- `/camera/<field>` keys `target`, `dist`, `yaw`, `pitch`, or `sway`. Camera angles use radians.
- `/poses/<part>/<field>` keys local `translation`, XYZ Euler `rotation` in radians, rigid `orientation` as a row-major 3×3 rotation matrix, or positive uniform `scale`. Orientation keys interpolate along the shortest rotation. Pose offsets compose with existing procedural motion around each part's joint. Children inherit the parent's transform. GLB export samples the same pose tracks and defaults to the timeline duration.
- `/effects/<index>/<field>` uses the index in the expanded diorama's effects list. Key lamp position (`at`), radius (`r`), `strength`, or `flicker`. Key rain `rate` or `box` as six coordinates containing the two XYZ corners. Key emitter position (`at`), count (`n`), or interval (`every`), dust `spread`, and spark `dir` and `speed`. Particle counts are rounded down when emitted. Keyed effects override shared parameter bindings while their tracks are active.

Advance `world.anim.update(dt, time)` on the timeline's clock to apply the live tracks. Stateful particles still use forward stage steps. `render --t` and `clip` step the stage through their usual paths. A clip with a positive timeline duration uses that duration as its default end time.

## Simulation worlds

Camera tracks work on the visual snapshot. Tracks under `/visual` can key existing numeric, numeric vector, boolean, and string presentation settings. When both a binding and a track address the same setting, the track takes precedence within its active range. Simulation visuals sample at the selected tick.

Timeline events enter the simulation's command queue on the first tick at or after their timestamp. Time-zero events enter on tick one. Recorded events include their source ID, instance path, and authored time under `timeline`. Pending events travel with checkpoints and recordings so resume and replay use the same order and emit each event once.

## Presentation tracks

Dioramas and simulation worlds can address render-graph passes and inspection
targets by ID. Use the existing sequence catalog and clips to place or
retime a reveal, callout, inset, camera move, and audio cue together.

| Target path | Keyed fields |
| --- | --- |
| `/renderGraph/<pass-id>/<field>` | `enabled`, `opacity`, mask `rect` and `feather`, distortion `offset` and `amplitude`, or history `halfLife`. |
| `/renderGraph/<mask-id>/volume/<field>` | An existing world mask's `at`, `extent`, or `feather`. |
| `/inspection/<target-id>/<field>` | `active`, `coverage`, `label`, or `detail`. |
| `/inspection/<target-id>/magnify/<field>` | `enabled` or `zoom` on an authored magnifier. |

Put the graph and inspection definitions in `finish.look` for a diorama or
`visual.look` for a world. The renderers sample the named channels at frame
time. Explicit frame overrides for `renderGraph` or `inspection` take
precedence. The base definitions still supply unkeyed fields. Hosts
advance a diorama's stage for its camera and poses, as with other scene
timeline channels, and resolve its audio cues.

The [signal observatory](../examples/signal-observatory.json) sweeps an
ellipsoidal reveal through two stations. A selected phosphor surface holds
its fading color as the beam moves on. Callout labels and magnifiers
activate on the same clock as the camera and cues, and a second clip
reuses the sequence. Use `ink-studio timeline examples/signal-observatory.json
--at 3.25` to inspect the sampled tracks and audio, or use `clip` to render
the history across frames.

Use [event actions](event-actions.md) to route timeline cues and measured
simulation events into deferred system commands. Save and scrub the run
to review the resulting deformation, releases, and effects at a frame.

## Hosts and CLI

Diorama builds, simulation runs, and visual snapshots expose the compiled program as `world.timeline` or `run.timeline`. A host can also compile standalone tracks with `KIT.timeline.compile(definition)`.

- `sample(time)` returns the active property edits and playing audio clips, including each clip's current source `position`, playback `rate`, and `gain`. Use this when seeking.
- `between(from, to)` returns markers, world events, and audio cues in `(from, to]`. Use a negative initial time to include cues at zero. Positive-duration audio produces `start` and `end` phases. Zero-duration cues fire once. The host resolves and plays the referenced audio.
- `markers`, `events`, and `audio` expose the flattened schedule. `ink-studio timeline <scene> --at <seconds>` exports a sampled frame and cue report. Use `--from` and `--to` to limit the cue interval, and `--out` to write JSON.

[Simulation scrubbing and takes](simulation-scrubbing.md) describes recording simulated poses and field values into timeline tracks.
