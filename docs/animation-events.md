# Animation events and state graphs

Native clips can declare an `events` array. Each event has a `name`, a source `time` in seconds, an optional unique `id`, and optional JSON `data`. Different markers can share a name. Legacy named cue pairs and untyped named cue records can drive the same graph. Trimmed and retimed clip sequences carry the named markers with the source motions. Retargeted clip bakes preserve them.

Use `clip.eventsBetween(from, to, { playback, speed })` to inspect the named events in `(from, to]`. Start below zero to include a marker at zero. Playback can follow the clip's loop setting with `clip`, or use `once` or `loop`. A negative speed plays in reverse. At a loop seam, end markers precede the next cycle's start markers.

## Author the graph

Use `KIT.anim.machine(definition)` with native clips. For JSON graphs, use `KIT.anim.animationGraph.create(definition)`. In JSON, the graph's `clips` record contains native clip definitions keyed by ID, and each state's `clip` names one of those IDs.

- `inputs` declares named boolean, number, or trigger inputs. Use `set(id, value)` for persistent values and `fire(id)` for a pulse at the next step.
- `layers` specifies independent state lanes in pose order. Each layer has an `id`, an `entry` state, `states`, and optional `transitions`. Later layers override the channels they animate.
- A state can play a clip with `speed` and `playback`, or leave the layer's channels to the layers underneath. Named events and keyed poses share the source clock. Presentation effects use the graph's elapsed clock.
- A transition specifies `from` and `to`, optional input `conditions`, an `exitTime` measured in clip lengths, and `duration` and `easing` for the blend. Use `on` to require a named event from the current state on that layer. Transition order determines precedence when several rules qualify at once.

The active clip owns event dispatch as soon as it enters. Its outgoing clip continues contributing pose during a fade. A qualifying named transition during the fade waits for the fade to finish and checks its guards again before taking effect. Contact, sound, and effect responses still fire at the event timestamp.

## Route named responses

The `eventBindings` record maps each event name to an ordered list of responses.

| Response type | Fields and behavior |
| --- | --- |
| `contact` | `contact` names a constraint and `action` is `plant` or `release`. A planted constraint persists until released. |
| `sound` | `cue` names the sound asset or cue. Optional `gain` defaults to one. An optional `contact` names the source anchor for [spatial playback](spatial-audio.md). |
| `effect` | `effect` selects `flash`, `sprite-flash`, `shake`, `zoom`, `pan`, `fade`, `letterbox`, or `impact`. Optional `settings` supplies native cue parameters such as `duration`, `amount`, or RGB `color`. |

`advance(dt)` steps the graph and returns the ordered events crossed during the step, the active contact IDs, and the sampled presentation. Named event rows include graph time, source time, layer, state, clip ID, and cycle. `pose(out)` returns the current layered and blended pose. Repeated reads of `frame()` and `pose()` leave the event cursor in place.

Use `machine.bind({ world, puppet, contacts, sockets, onEvent, onSound })` to run a graph from a puppet's existing animation update. Give each contact ID an authored point, socket, or captured surface target. The binding applies active contacts after blending and sends presentation to the normal renderers. Use the returned binding's `frame()` to inspect the contact solve and `reset()` to start playback again from zero. Hosts can also step the machine directly and consume its event records independently of a renderer. [Native contact format](authored-contacts.md)

Use `ink-studio animation-graph <graph.json> --at SECONDS` to inspect a portable graph. Supply `--inputs FILE` for an ordered list of rows with a `time` and optional `set` record or `fire` list. Motion advances to each timestamp before its input changes are applied. Use `--out FILE` to save the event trace, final pose, and active blend weights.

Named events can also start action recipes, open contact windows, and advance recovery phases. [Action windows](action-windows.md)

Use a clip marker to play a directional pixel stamp during a held pose.
[Directional contact marks](contact-marks.md#connect-an-animation-or-material-contact)
