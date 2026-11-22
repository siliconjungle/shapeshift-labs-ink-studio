# Common simulation output adapters

Use graph ports to move solver results into rendering, analysis, audio, and
event-driven tools. The adapters read native output without running the solver
again. An adapter can read a whole value or select an `options.path` JSON
Pointer. A selected successful model probe unwraps to its payload. An
unavailable probe reports its status.

| Graph operation | Output port | Use |
| --- | --- | --- |
| `sim.outputField` | `gridField` | Carry a sampled grid with its sample origin, spacing, component count, units, and coordinate frame. |
| `sim.outputTrace` | `trace` | Carry one or more named scalar channels on a native sample clock. |
| `sim.outputPoints` | `pointBuffer` | Carry packed XYZ positions, optional IDs, and optional velocities. |
| `sim.outputMesh` | `mesh` | Connect indexed triangle surfaces to Ink geometry and scene nodes. |
| `sim.outputRaster` | `raster` | Connect a numeric image or image probe to raster operations without scaling its values. |
| `sim.outputAudio` | `audio` and clock `report` | Pass through PCM or explicitly calibrate selected trace channels and interleave them. |
| `sim.outputEvents` | `eventLog` | Preserve native payloads and dated occurrences in a common event log. |

Existing `sim.run` raster simulations add typed `grid` and `pointBuffer`
ports alongside their original `field` raster and `points` records.
`sim.model.events` publishes the committed events for its sampled tick.
Use a longer recorded log if a consumer needs events from every tick
between two graph samples.

## Typed world graph ports

`sim.world` samples a native world, model, checkpoint, or recording once per graph evaluation. Its `worldFrame` port shares committed events and named query samples with downstream nodes. Load a standalone JSON source through `jsonAsset`. Embed linked story definitions in a world asset or use a portable native recording. A fixture can be replayed to a native recording first.

| Graph operation | Value port | Missing behavior |
| --- | --- | --- |
| `sim.worldPulse` | `eventLog` with one timestamped entry per matching committed event | Emits an empty log when the frame is unavailable. A valid frame with no matching occurrence also emits an empty log, with report status `empty`. Set `missing: "error"` to require a frame. |
| `sim.worldScalar` | `unitScalar` in [0, 1], compatible with ordinary number inputs | Normalizes a finite query value over an authored `range` and clamps outside it. Uses `fallback` (default 0) on loss. Set `missing: "hold"` for the last live value, or `"error"` to require a live value. |
| `sim.worldRecord` | `record` with the selected structured query value | Uses `fallback` (default `{}`) on loss. Also supports `missing: "hold"` or `"error"`. |

Every adapter has a `report` port. The scalar report includes the raw reading and whether it was clamped. Missing value reports explain why the sample was unavailable and held values give their original tick. A hold starts with the fallback and clears on a source or query change, rewind, take cut, graph reset, or new playback sequence.

Define queries in `sim.world.inputs.options.queries`. Each named entry uses the native `field` and optional `args` and `at`. A `when` condition tests the full result for availability. Apply `select` afterward to read a JSON Pointer such as `/tension`. The scalar or record node names that entry with `options.query`. `world/story-objective` takes `{story, objective}` and returns the objective's stage, visit, title, status, and any progress or result receipt. Its sample is unavailable before activation, after closure, and when the current stage has no objective with that ID.

An ordinary graph sample takes events from its selected tick. Set `options.eventFrom` on `sim.world` to include earlier committed ticks. On an exact take the default window covers ticks since the preceding picture frame through the selected world tick. A picture frame that advances no world ticks has an empty window. These intervals replay committed events even with history disabled. Pulse filters can match `kind`, `system`, `story`, `branch`, and a `where` condition on the [event envelope](simulation-checkpoints.md#committed-event-envelopes).

```sh
node examples/world-graph-ports/demo.cjs ./studio/out/world-graph-ports
ink-studio graph run ./studio/out/world-graph-ports/dock.graph.json --at 0.1 --out arrival
ink-studio graph describe sim.worldScalar
```

The dock demo publishes an arrival, a mooring tension gauge, and a story objective. As the cable loses its anchor and the stage closes, the gauge holds its previous value and the record uses its fallback. A second trace shows the arrival crossing from a 10 Hz world into a 5 fps take.

## Join a running world

`sim live` runs a native world or checkpoint at wall-clock speed and serves the latest committed tick. Use `--queries` to publish a JSON object of named probes with the same shape as `sim.world` queries. A native recording plays from its origin with its saved commands and defaults to its recorded end tick. For a world or checkpoint, set `--ticks` to the absolute stop tick. `--step-ms` changes publication pacing while preserving the simulation clock and event timestamps. `--linger-ms` keeps the final state available after the last commit and defaults to 500 ms.

```sh
node cli/ink-studio.js sim live examples/live-snapshot-cursor/dock.world.cjs \
  --ticks 16 --queries examples/live-snapshot-cursor/dock.queries.json --step-ms 480
```

Read `url` and `token` from the `live-ready` NDJSON line. The server defaults to an assigned port on loopback. Use `--host` with a reachable IP and `--port` with a fixed port to connect a remote viewer. Both routes require the session token in the `Authorization: Bearer …` header. The server marks its final response with `X-Ink-Ended: 1` during the linger interval.

| Request or response | Behavior |
| --- | --- |
| `GET /snapshot` | Returns the current named query samples and a new subscriber's cursor. No earlier effects fire. |
| `GET /live?after=…` | Pass the URL-encoded JSON cursor from the last applied response. A cursor contains `stream`, `revision`, and `tick`. |
| `kind: "live"` | Updates state and delivers the newly committed event envelopes when both the publication and tick are consecutive. |
| `kind: "idle"` | Confirms the applied cursor still points at the current state. |
| `kind: "snapshot"` | Replaces state when joining, skipping publications, or switching streams. The separate `effects` list is empty. |

Version 1 packets use `format: "ink-studio/live-snapshot"`. Each echoes the requested cursor as `base` (null on a fresh join) and gives the cursor to acknowledge after applying the packet. `state` is a `worldFrame` with an empty event list. Use `effects` for one-shot cues. Apply a packet only when its base matches the subscriber's applied cursor. A stale response leaves that subscriber unchanged. The publisher retains the latest state and up to one tick's effects. Use a recording for an exhaustive event history.

In a patch, declare a graph input of type `liveSnapshot` with a default of null and connect it to `sim.liveWorld.packet`. Wire `sim.liveWorld.value` to `sim.worldRecord`, `sim.worldScalar`, or `sim.worldPulse` as usual. On evaluations without a new packet, pass null to keep state and clear the pulse list. The `report` port shows the cursor, status, reason when available, and effect count. Hosts using the library can also publish a committed frame with `KIT.world.liveSnapshots.create({stream})` and apply packets with `KIT.world.liveSnapshots.receiver()`.

```sh
node examples/live-snapshot-cursor/demo.cjs ./studio/out/live-snapshot-cursor
```

The demo joins a running dock simulation, misses deliveries, then starts a patch and attaches the projector after the show is underway. It saves the viewer packets, projector frames, and show diagnostics. [Patch show setup](patch-tooling.md#run-a-patch-as-a-show)

Pass `--policy` to serve separate authoritative, faction, and spectator streams from the same run. The policy also grants named interventions through the native command scheduler. [World views and intervention permissions](world-access.md)

## Fields, surfaces, and points

An `ink-studio/grid-field` version 1 has a `shape` of one to three
axis lengths, `components` from one to four, `origin` at the first sample,
`spacing`, `unit`, `frame`, and `data`. X varies fastest and each
sample's components are adjacent. Pass a record with these attributes,
or a flat numeric array with `options.shape`. A raster supplies its own
two axis sizes and channel count. Its first sample is centred at
`[0.5, 0.5]` in art pixels. An authored array without a supplied origin
starts at zero.

Connect a `gridField` to `sim.fieldRaster` to obtain a numeric image
and a coordinate report. A three-axis field can select `axis` and
`index` and any field can select `component`. The remaining axes
appear in their original order. `sim.fieldMesh` takes a scalar plane and
places sample centres on an XZ plane with Y elevation
`heightOffset + sample * heightScale`. It keeps the slice's sample
spacing. Use the existing callable `field` type for analytic fields and
SDFs.

An `ink-studio/point-buffer` version 1 has packed `positions`, a `count`,
`frame`, and `unit`. It can carry aligned `ids`, `velocities`, and
`velocityValid` flags. Supply packed XYZ coordinates or point records
with `point` or `position`, optional `id`, and optional `velocity`.
XY points are padded with zero Z. The flags distinguish an unmeasured
velocity from a measured zero. `sim.pointRecords` returns ordinary point
records for drawing and other array consumers.

## Native traces and PCM

An `ink-studio/sample-trace` version 1 records `sampleRate`,
`startSample`, `frames`, and `channels`. Each named channel has a
`unit` and `samples`. Use the same shape without the versioned header
to adapt authored data. Shorthand arrays use `options.unit` or
dimensionless `1`.

| Native input | Channels |
| --- | --- |
| Wave trace | Named pressure in Pa by default, or volume flow in m³/s with `measure: "flow"`. |
| Modal trace | Named displacement pickups in model units. |
| Wave sensor report | Named readings in their calibrated report units. |
| Contact excitation trace | Pick a `track` and `measure` of `force`, `impulse`, `point`, or `slip`. XYZ components become `x`, `y`, and `z` channels. |

Use `sim.traceWindow` with integer `from` and exclusive `to` on the
native clock. A crop retains its absolute origin. To audition pressure
as PCM, connect the trace to `sim.outputAudio` with
`options: { "channels": ["left", "right"], "gain": 0.15 }`. Gain
is required when adapting a trace. Choose a value that keeps every PCM
sample within [−1, 1]. The report supplies the absolute start and end
samples for placement. Use an [audiovisual take](audiovisual-takes.md)
if picture and WAV need to be published on a common clock, or
[physical audio](physical-audio.md) for source calibration and propagation.

## Event logs

`sim.outputEvents` accepts an array, a native report with `events`,
or a previously normalized `ink-studio/event-log`. Entries contain
`at` and the original `event`. The adapter orders occurrences stably,
so simultaneous events retain their recorded order. It retains a report's
`dropped` count.

Native sample-stamped event reports can supply their rate under
`info.sampleRate` or through `options.sampleRate`. Tick-only events need
`dt` in their report or options. Explicit timecodes can use seconds or
integer ratios. When a native fractional sample requires a ratio beyond
JSON's safe integer range, the event entry keeps that ratio in decimal
strings under `exact`. The presentation time remains available in `at`.

`sim.eventWindow` returns an event log and an ordinary `events` array.
Supply `options.from` and `options.to` for a half-open interval or omit
them when the graph is evaluated with a take frame. An event on a frame
boundary belongs to the next frame.

## Library and demo

`KIT.world.outputAdapters` exposes `field`, `trace`, `points`,
`mesh`, `raster`, `audio`, `events`, and the slice, mesh, point, trace,
and event window helpers. These operations are also discoverable with
`graph nodes` and `graph describe sim.outputTrace`.

```sh
node examples/output-adapters/demo.cjs studio/out/output-adapters
ink-studio graph run studio/out/output-adapters/bench.graph.json --at 0.8125 --out bench
```

The spillway bench publishes a native FLIP density field, point buffer,
height mesh, and raster alongside a native wave trace, stereo WAV, and
contact event log. The review shows the same simulation frame in its
raster, field, and point views. The mesh preview builds a surface from the
sampled density.
