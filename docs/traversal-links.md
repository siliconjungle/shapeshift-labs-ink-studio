# Character traversal links

Traversal links connect a capsule character to a rail, moving route, boost, or flow volume. Each link has admission rules and a movement rule. Route links sweep the character into, along, and out of the route using the same body and clearance queries as ordinary movement.

```js
const { characters, traversalLinks } = KIT.world;
const controller = characters.create();
const travel = traversalLinks.create({
  controller,
  links: {
    rail: {
      kind: 'route',
      path: [[0, 1.5, 0], [6, 1.5, 0]],
      motion: { speed: 4 },
      entry: { radius: 0.6 },
      switches: [{ at: 3, link: 'spur' }],
      exit: { boost: [0, 2.4, 0] }
    },
    spur: {
      kind: 'route',
      path: [[3, 1.5, 0], [6, 2.5, -3]],
      motion: { speed: 3 }
    },
    ring: {
      kind: 'impulse',
      entry: { at: [7, 2.5, -3], radius: 0.7, normal: [1, 0, 0] },
      velocity: [6, 3, 0]
    }
  }
});
let actor = travel.state({ position: [0, 1.5, 0], inventory: ['lantern'] });
const result = travel.step(actor, { traverse: 'rail' }, dt, world, { time });
actor = result.actor;
```

Use your usual character controls on the same call. Pass `traverse: 'spur'` while approaching its junction to request the switch. Pass `detach: true` to cancel waiting or leave the active movement rule. With no explicit request, automatic entries are considered in the order the character traverses the swept motion segments. `actor.traversal` records the link and its `waiting`, `riding`, `flow`, or `released` phase. Save it with the actor and resume using the same timetable. You can reuse a compiled catalog for a different capsule with `travel.withController(controller)`.

## Entry, motion, and exit

| Kind | Movement |
| --- | --- |
| `route` | Starts its own clock on admission. Follow the authored route between the arc-length distances `from` and `to`. Request another rail through a `switches` entry with `{ at, link, radius }`. |
| `scheduled` | Evaluates the route at the world clock plus `phase`. The actor waits near `from` for an eligible shuttle and rides to `to`. Set `maxWait` in seconds and `maxBoardSpeed` in world units per second. Supply the start time of each step as `{ time }`. |
| `impulse` | Applies `velocity` on entry. Set `inherit` to add a fraction of the actor's incoming velocity. A normalized `entry.normal` defines a one-way disc that must be crossed inside `entry.radius`. |
| `flow` | Applies `acceleration` inside a world-space `volume: { min, max }` while the character uses ordinary movement and collisions. `speedLimit` caps the speed added along the acceleration direction. The flow ends on leaving the volume or reaching `duration`. |

Route links accept an existing `K.anim.route` or inline `path` points and `motion` options. `offset` adds a world-space displacement from the follower's point to the capsule center. For a scheduled lift, put stops at the boarding and exit distances and render the platform with the same follower and clock. [Route followers](route-followers.md)

`entry.radius` defaults to 0.65 world units. `entry.modes` and `entry.minSpeed` can restrict admission to eligible characters. `entry.auto` defaults to true for impulses and flows. Set `enabled` to a boolean or, in JavaScript, a callback that receives `{ actor, world, time, input, link }`. A step can also supply `enabled(linkId)` to read an external gate.

Route exits can name a world-space `exit.offset` for the destination capsule center relative to the end of the route. The character retries a blocked exit from the last accepted pose. On-demand routes pause at obstructions along the path. Scheduled riders release from the last clear pose if the carrier's next move is obstructed. Use `exit.inherit` to scale exit velocity and `exit.boost` to add a world-space launch vector.

The result includes the character controller's movement segments, body and eye media, and events. Traversal emits `traversal-wait`, `traversal-enter`, `traversal-switch`, `traversal-exit`, `traversal-cancel`, and `traversal-blocked`. The blocked event identifies the entry, motion, or exit stage.

## Headless worlds

Add the same JSON link table as `config.traversalLinks` on a `characters` system. Use inline `path` and `motion` for route links. Each character exposes a `traversal.<actor>` record input with `{ link, detach }`. Each link exposes an `enable.<link>` boolean input, which can connect to a signal. The system publishes the traversal state in its `actors` field alongside position and velocity. Its events use the existing `character-` prefix.

Run `node examples/traversal-links.js traversal-links.png` to simulate and render a rail switch, boost ring, fan updraft, and timed lift.
