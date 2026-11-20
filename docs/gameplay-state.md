# Gameplay state and events

A `gameplay` system runs inside a headless world. It keeps named
countdown timers, objectives, and a state graph in the simulation
checkpoint. Typed connections can drive other systems from gameplay state.
The renderer can read the same state through world queries.

## Configure the system

| Setting | Purpose |
| --- | --- |
| `inputs` | Named `bool`, `number`, `event`, `record`, or `vec3` ports. Each accepts a type name or a `{type, default}` descriptor. |
| `timers` | Each timer has a positive integer `ticks` duration and optional `start` flag. Time is measured in world ticks. |
| `objectives` | Each objective starts active by default. Set `active` to false to wait for activation. Set a positive integer `target` for progress and optional `complete` and `fail` conditions. |
| `states` | Each state can have ordered `transitions` with `to` and `when`, plus an `enter` list of timer and objective operations. |
| `initial` | The starting state ID. Defaults to `idle`, which is also the default state when `states` is omitted. |

Conditions combine with `all`, `any`, and `not`. A leaf selects an `input`,
`event`, `timer`, `objective`, `state`, or `probe`. The optional `when`
uses [world comparisons](headless-worlds.md) against the selected value.
Without a comparison, an input checks for true, an event checks for a
matching kind, a timer checks for expiration, and an objective checks for
completion. A state matches by ID. A probe checks for a successful field
read and can specify `at` and `args`.

Each update processes queued commands in order, expires due timers, then
evaluates active objectives against one snapshot. Failure takes precedence
if both objective conditions match. The first matching transition uses
the resulting objectives and runs its destination's entry operations.
There is at most one transition per system update. The initial state's
entry operations apply at tick zero.

## Use commands, ports, and events

| Action | Arguments |
| --- | --- |
| `timer` | `timer` and `op` of `start`, `pause`, `resume`, or `reset`. Starting sets a new deadline. Reset returns the timer to idle. |
| `objective` | `objective` and `op` of `activate`, `advance`, `complete`, `fail`, or `reset`. `advance` adds `amount` (default 1) toward the target. Reset restores the configured initial status and zero progress. |
| `signal` | An event `kind` and an optional `detail` record. An event condition can match fields in the whole event record, including `detail`. |

The `signals` event input accepts records with a `kind` field.
[Event actions](event-actions.md) can pass timeline cues, interactions,
and simulation events into these commands. Receivers can route
`gameplay-state-changed`, `gameplay-timer-expired`,
`gameplay-timer-changed`, and `gameplay-objective-changed` through the
same event system.

The `state.<id>` Boolean ports select the current state. Timer ports
expose `timer.<id>.remaining` and `timer.<id>.expired`. Objective ports
expose `objective.<id>.progress`, `objective.<id>.completed`, and
`objective.<id>.failed`. The `events` port publishes gameplay notices.
Probe the system's `status` field for timers, objectives, and the current
state with its entry tick.

Gameplay commands wait in the checkpoint until the next system update.
Timer commands use their original command ticks. A timer due between
updates publishes its original deadline when the system next runs.
