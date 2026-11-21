# Adaptive music

Add an `adaptive-music` system to describe how a scene's score responds to
emotion, gameplay cues, and the environment. The system produces score state,
musical positions, and cue intents. Resource names are opaque identifiers for
the host. The same score can run in a world recording or through the
standalone `KIT.music.create(config)` clock.

Use [tempo maps](scene-timeline.md#beat-bar-and-phrase-timing) to place authored visual keys and scene cues on beats, bars, and phrases.

[Procedural scores](procedural-score.md) use the same musical grid for
chord events, native synthesis, and visual or simulation controls.

## Author a score

See [the storm score](../examples/world-adaptive-music.json) for a complete
world. Tension rises during a storm and subsides afterward. The score enters
and leaves the storm section on bar boundaries, and a timeline cue marks the
beacon on the next beat. A separate rain parameter follows the weather field
at a listener.

| Setting | Meaning |
| --- | --- |
| `tempo`, `beatsPerBar`, `barsPerPhrase` | Default BPM and meter. Default values are 120, 4, and 4. Sections can override BPM while the beat count and meter continue across changes. |
| `entry`, `sections` | Initial section ID and named sections. Each section supplies a `resource`, optional `tempo`, and optional named `layers` with levels from zero to one. |
| `emotions`, `parameters` | Named channels from zero to one. Use emotions for authored state such as tension or relief, and parameters for controls such as rain, movement, or depth. Each channel can set `default` and exponential `attack` and `release` time constants in seconds. Zero follows its target immediately. Release defaults to attack. |
| `transitions` | Ordered rules with `id`, `from`, `to`, a [query condition](headless-worlds.md) in `when`, and optional `quantize` and `cue`. Test paths such as `/emotions/tension` and `/parameters/rain`. The first matching rule for the current section wins. Set distinct entry and exit thresholds for hysteresis. A linked cue shares the transition's boundary. |
| `cues` | Named intents with a `resource` and an optional `quantize`. Requests can carry an `emitter` and an extra JSON `data` record. |

Quantization accepts `none`, `half-beat`, `beat`, `half-bar`, `bar`, or
`phrase`. Transitions default to `bar` and cues to `none`. A quantized
request uses the next grid line, including when it arrives exactly on a grid
line. A pending transition must remain the first matching rule at its
boundary, using the levels accumulated under the previously held targets.
When a different rule wins during evaluation, its own quantization
determines the new deadline. On a shared beat, a transition and its linked
cue precede standalone cues, which keep request order. `estimatedTime`
uses the current tempo. A queued cue keeps its beat if the tempo changes.

## Drive it from a world

Connect a number port to `emotion.<name>` or `parameter.<name>`, or set
it with `world/input`. A field-bound channel uses `field` with optional
`at` (XYZ, point, entity, or socket), `args`, and a JSON Pointer or path
array in `path` for a nested sample. For spatial fields, supply `at`. Read
a number or boolean and map it into zero to one with `range` (default
`[0,1]`). Booleans convert to zero or one. An unavailable reading uses
the channel's default.

Use the `cue` system action or send records on the `cues` event input.
[Event actions](event-actions.md) can route a named timeline marker, an
interaction, or another world event to `score/cue`. The `intents` event
output carries `music-transition` and `music-cue` records with exact
musical `beat`, simulation `time` in seconds, and a score-local `serial`
for identity. World history adds the tick on which the intent was delivered.
Use `beat` and `level.emotion.<name>` / `level.parameter.<name>` for numeric
outputs. Probe `score/state` for the section, layer levels, tempo, channel
targets and values, winning transition and pending cues. Probe `score/intents`
for the last evaluation's intents.

```sh
ink-studio probe examples/world-adaptive-music.json --ticks 20 --field score/state
ink-studio probe examples/world-adaptive-music.json --ticks 56 --field score/intents
ink-studio sim run examples/world-adaptive-music.json --ticks 100 --record storm-score.run.json
ink-studio sim replay storm-score.run.json
```

## Use the standalone clock

`machine.initial(startTime)` starts at beat zero. Call
`machine.advance(state, {time, emotions, parameters, cues})` to advance the
clock and get `{state, intents}`. All times are simulation seconds.
Omitted channels keep their last target. Each sample applies at the supplied
time, and attack and release integrate the prior target up to that time.
Already scheduled intents are evaluated at their musical boundaries, even
when an advance crosses multiple beats. New transition candidates are
evaluated once per advance, so use fixed steps when reviewing state changes.
`machine.inspect(state)` returns the same read model as the world query.
The state can be saved as JSON and passed into a new machine with the same
score.

A host can also look up spatial data for a cue at a listener, for example
`KIT.music.acoustics(run.query(), intent, {listener, field: 'acoustics/audible'})`.
This accepts an `emitter` on a score cue or an `at` on an existing spatial
sound event. The query reports the [current acoustic path](acoustic-queries.md),
including gain, arrival direction, delay, and attenuation by band. Use the
world snapshot corresponding to the time you want to inspect.
