# Reusable interaction components

`KIT.world.interactions.components` makes named controls for the
[durable interaction controller](headless-worlds.md#persistent-interactables).
Use `compose({id, components, routes?, query?, point?})` to create an
interactable definition. Put its named components in a keyed record.
Pass the definition in the controller's `interactables` array.
The same definitions can be reused with independent state in other
controllers or compositions.

Dispatch an action with the assembly ID and a `component/action` name.
For spatial actions, pass an actor with an `id`, an XYZ `position`,
and an optional `generation` or [entity lifetime handle](portals.md#modular-scene-and-entity-lifecycle)
in `entityHandle`. An actor with a generation owns its handle, item,
and checkpoint under that lifetime.

| Component | Settings | Actions and state |
| --- | --- | --- |
| `trigger` | XYZ `bounds` as inclusive `min` and `max`. | `sample` records entry and exit for each actor. Repeat samples while inside or outside leave the state untouched. Pass `{present:false}` to sample a departing actor without a position. |
| `handle` | `at`, `range`, initial `value` from 0 to 1. | `grab` reserves the handle for the actor. `move` accepts `{value}` from the holder in range. `release` clears the reservation. |
| `pickup` | `at` and `range`. | `take` claims an available item. Its owner can `drop` it at their position. The state tracks whether the item is in the world, held, or docked. |
| `socket` | `at`, `range`, optional `accepts` list of pickup component IDs. | `insert` takes `{item}` and docks that actor's held pickup. `remove` passes the docked item to a nearby actor. The pickup and socket update together. |
| `checkpoint` | `at` and `range`. | `activate` remembers the anchor pose and tick for the actor lifetime. `respawn` returns that pose in the event for the host to place the actor. |
| `timedSwitch` | Positive `ticks`, optional `at`, `range`, `onCue`, and `offCue`. | `press` activates the switch and starts or restarts its timer. The controller expires the switch at the saved deadline. |

An `at` can be an XYZ point, an entity or socket selector, or an agent
selector. The default `range` is one world unit. For dynamic anchors,
pass `query(revision)` to the composition or expose `query` on the
controller's realized revision. It must resolve synchronously to the
world query. A timed switch without an anchor accepts a direct or
routed activation. A component can also specify `when` as a
world query condition over `{states, actor, args, tick}`, where
`states` holds the assembly's component states.

## Route and publish actions

A route declares `{from, to, when?, args?, required?}` using named
`component/action` endpoints. It evaluates the source result against
`{states, actor, detail, tick}` and forwards the incoming arguments
unless it supplies its own. A required route declines the entire
action if its target declines. Use `required: false` to let the source
succeed when that target declines. Routes run in breadth-first order,
with outgoing routes in their declared order. Each action can succeed
once per dispatch. Route cycles are rejected when composing.
Timer expirations publish their own cues on the deadline.

Read `controller.current().states[assemblyId]` for committed state.
`assembly.frame(component, snapshot)` resolves an anchored component
against that snapshot. It follows a docked pickup's socket and reports
a dropped pickup's stored world location. A held pickup's placement
belongs to the host's actor.

`event.detail.changes` lists the component actions, cues, details, and
anchor points from one successful dispatch. Use the controller's
`realize` callback to publish scene geometry, clearance, or other
state from the entire proposed update. The controller publishes one
revision per successful dispatch, including routed effects. A failed
realization leaves component states, timers, and the sequence at their
previous committed values.

The existing `checkpoint()` and `restore(saved)` API retains component
state, docked items, respawn poses, and pending timers. Use the same
composition when restoring on a fresh controller. Advance the restored
controller with its saved tick clock to expire timed switches.
