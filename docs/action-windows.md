# Action windows and contact outcomes

Assign action recipes and contact receivers to scene IDs. A recipe owns the
timing of one action. A receiver turns a qualifying contact into an outcome
even when the target has no active recipe. Either can drive puzzle signals,
animation, sound, fractures, or other game state.

```js
const { actionWindows } = KIT.world;
const machine = actionWindows.create({
  recipes: {
    calibrate: { phases: [
      { id: 'windup', until: 'extend', cue: 'warning' },
      { id: 'active', until: 'retract', duration: 0.5,
        onContact: [{ kind: 'sweep', emit: 'calibrated' }] },
      { id: 'recovery', duration: 0.4, flags: ['exposed'] }
    ] }
  },
  assign: {
    arm: { actions: ['calibrate'], markers: { prime: 'calibrate' },
      receive: [{ kind: 'probe', during: { action: 'calibrate', phase: 'recovery' }, emit: 'service' }] },
    plate: { receive: [{ kind: 'landing', minSpeed: 4, emit: 'press' }] },
    slab: { receive: [{ kind: 'landing', minSpeed: 5, emit: 'break', once: true }] }
  }
});

let state = machine.initial();
const frame = graph.advance(dt);
const result = machine.step(state, {
  to: state.time + dt,
  commands: actionWindows.markers('arm', frame.events),
  sweeps: [{
    source: 'arm', target: 'sensor', kind: 'sweep',
    probe: { from: previousTip, to: currentTip, radius: 0.12 },
    targetBody: { from: sensorPosition, half: [0.2, 0.2, 0.2] }
  }]
});
state = result.state;
```

## Timing and assignments

Each entity runs at most one assigned action at a time. Send
`{ op: 'start', entity, action }`, `{ op: 'cancel', entity }`, or
`{ op: 'marker', entity, name }` to the clock. A marker can start an action
while the entity is idle or advance the current phase. The animation helper
turns named events from a native graph's `advance()` into marker commands.
Pass a third argument in seconds to shift an animation clock onto the action
clock. [Animation events](animation-events.md)

A phase advances after its `duration`, on the matching `until` marker, or
whichever happens first when both are present. Phase names are authored
IDs. A phase can publish a named `cue` and boolean `flags` such as
`exposed`. `result.events` records starts, phase entries, cancellations,
and finishes. `result.active` and `result.flags` describe the end of the
step. Save `result.state` to retain phase clocks, action activations, and
which contacts have already produced a result.

Command and contact `at` values are absolute seconds within the direct
API step and default to its end. Timed transitions take effect before
commands at the same time. Commands at that time are processed in supplied
order, followed by contacts. A new phase owns contacts at its opening
boundary.

## Contact rules

A contact names `source`, `target`, and `kind`. Optional fields include
`id`, `at`, `speed`, `energy`, `point`, and `normal`. Give duplicate
deliveries of the same measured contact the same `id` within an evaluation.
Each matching rule emits its named signal in `result.outcomes`. Add
`sources`, `targets`, `minSpeed`, `minEnergy`, or a JSON `data` payload
as needed.

- A phase's `onContact` emits once per rule and target during that phase.
  Use `once: 'action'` to share the limit for that signal across phases of
  the same activation.
- A target's `receive` can react on any qualifying contact. Set
  `during: { action, phase }` to restrict reactions to a target's phase
  or `sourceDuring: { action, phase }` to require a source phase and
  deduplicate that receiver per source window. Set `once: true` for a
  single-use receiver whose spent state is checkpointed.
- A sweep supplies a `probe` and `targetBody` with `from` and optional
  `to` positions. Give each body a `radius`, a box `half`, or a Studio
  `collider`, with an optional fixed `rotation` matrix. Use `start` and
  `end` to time the proposed sweep or let it cover the entire step.
  The clock clips translations to each phase and sweeps against relative
  target motion. For an animated rotating part, supply consecutive
  translation segments sampled from the part or socket. Sweep outcomes
  report the probe center, contact normal, and approach speed.

## Headless world ports

Use the same JSON recipe and assignment tables in an `action-windows`
system. Its `commands`, `contacts`, and `sweeps` inputs are event ports.
Times on those ports are fractions of the consuming evaluation, from zero
to one. Use `contactChannels` to declare more named contact inputs. The
system exposes phase events on `events`, outcomes on
`signal.<name>`, and end-of-evaluation flags on `flag.<entity>.<flag>`.
Probe `<system>/state` or `<system>/outcomes` for the current snapshot.

- Set `landingContacts: true` on a `characters` system. Its `landings`
  output reports the supporting body and the character's approach speed
  relative to the surface. Assign the support ID as a receiver.
- Set `impactEvents: true` on a `mechanics` system to expose its swept
  `impacts` as contacts. Body-to-body impacts publish a contact in each
  direction using the bodies' entity IDs. Ground impacts use `ground`
  as the target.
- Wire `signal.press` to a puzzle event input for a switch or timed
  window. Wire `signal.break` to a mechanics system's
  `fracture-contacts` input. Configure `fractureOn` keyed by eligible
  box body IDs. Requests can target the body ID or its entity ID. Each entry can set `minSpeed`, `axis`, `parts`,
  `omit`, `impulse`, or `impactMass`. An explicit contact energy
  takes precedence over energy calculated from approach speed and
  impact mass. The normal material fracture threshold still applies.
  [Puzzle recipes](puzzles.md)

Render the calibration arm and landing workshop with
`node examples/action-windows.js action-windows.png`.
