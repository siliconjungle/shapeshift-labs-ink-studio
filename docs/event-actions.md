# Event actions for staged sequences

Use event actions to connect a scene timeline to the same commands an
interactive host can run. A cue can start a weather change or launch a
body. A later command can wait for a measured contact, tear, or release.
Each reaction names the event it consumed and the tick its commands are
due, so the result can be reviewed alongside pose and simulation state.

## Author a world rule

Add `eventActions` at the top level of a world manifest. Each rule names
an event, an optional producing system, and a list of commands. For example,
a fabric release can supply its actual attachment position to a spray burst.

```json
{
  "eventActions": {
    "shed-water": {
      "on": {
        "kind": "deformable-detach",
        "system": "fabric",
        "where": { "path": ["shape"], "value": "canopy" }
      },
      "limit": 3,
      "actions": [
        {
          "action": "spray/impact",
          "args": { "point": [0, 0, 0], "speed": 7, "load": 16 },
          "bindings": { "/point": "/point" }
        }
      ]
    }
  }
}
```

- `on.kind` matches a committed world event. `on.system` can qualify its
  source. Timeline events use `world` and carry their original cue ID,
  clip path, and authored time. Use the usual world conditions in
  `on.where` to match an event's body, shape, actor, or timeline path.
- `delay` is in seconds, defaults to zero, and rounds up to a solver tick.
  Commands always land on a later tick. With zero delay they run on the
  next tick. This fixes the order when several systems respond to contact.
- `limit` defaults to one matching event per run. Give a repeated beat an
  explicit budget. Events run in their publication order. For one event,
  matching rules run in rule ID order and commands run in array order.
- `actions` use ordinary `system/action` and `args` records.
  `bindings` map an argument JSON Pointer to a JSON Pointer on the
  triggering event. Author a valid argument template. Both the template
  and the resolved command go through the normal command validator.

The simulation checkpoint retains rule counts and pending commands. A
saved run recomputes reactions from its events on replay. An invalid
resolved command or missing bound value fails the current tick before
publishing its changes. The rule table accepts up to 128 entries, each with
up to 16 commands and a limit of 10,000 activations. Up to 512 derived
commands can be scheduled by one tick.

The `contact-effects` system's `impact` action accepts the same positional
and material fields as its measured contact input. It supplies the impact
kind and uses the existing material spray, sound, and shake rules. Multiple
scripted impacts accumulate in order, including when the system updates
less often than the rest of the world. Cloth detach events include the last
committed attachment point.

## Review the storm canopy

The [storm canopy](../examples/world-storm-canopy.json) uses a timeline cue
to start the rain and kick a falling weight. Mechanics sweeps the weight into
the canopy and the deformable solver loads its nodes. The first measured
contact schedules the east pins to release. Confirmed releases pass their
positions to the spray solver. The camera track and thunder cue use the
same timeline.

```sh
ink-studio sim run examples/world-storm-canopy.json --ticks 40 --record storm.run.json
ink-studio sim scrub storm.run.json --ticks 29,20,28 --json
ink-studio sim render storm.run.json --ticks 34 --out storm.png
```

Look for `event-action-scheduled` in the scrub report or world history.
It records the rule, source, triggering event ID, due tick, and command
names. Probes such as `fabric/motion`, `fabric/water`, and `spray/frame`
show the geometry, retained rain, and transient particles at that tick.

## Bind a creature or a splat stage

For rigs, deformers, or effect systems attached to a splat stage, use
`KIT.eventActions.playback({timeline, eventActions, dt, build})` with the
same rule syntax. Pass an authored timeline or an existing compiled
timeline. The host's `build()` returns a fresh `{world, actions, step,
dispose?}`. Its `actions` is a map of named synchronous handlers.

```js
const playback = KIT.eventActions.playback({
  timeline,
  eventActions,
  build() {
    const { world, stage, material, spray, measureContact, applyPose } = makeScene();
    return {
      world,
      actions: {
        'shell/release'(args, { emit }) {
          material.release(args);
          emit('shell-released', { point: material.inspect(0).position }, 'shell');
        },
        'particles/spray'({ point }) { spray(point); }
      },
      step(dt, time, { sample, emit }) {
        applyPose(sample);
        stage.update(dt, time);
        const point = measureContact();
        if (point) emit('wing-contact', { point }, 'wing');
      }
    };
  }
});

const frame = playback.seek(2.6);
draw(frame.world, frame.time);
```

Each fixed step runs due actions against the preceding committed frame,
passes that tick's timeline sample to the host, and queues reactions to the
emitted events. `seek(seconds)` snaps to the nearest tick. It rebuilds and
replays a seeded scene when moving backward. This adapter makes releases,
particles, and contact measurements seekable even when their solvers require
forward integration. Use the sampled timeline for camera, pose, and audio
state. Keep audio playback and other external effects at the presentation
boundary when reviewing a frame. Call `dispose()` to release the host scene.

## Reuse the pattern

The same boundaries fit different set pieces.

| Set piece | How to wire the beat |
| --- | --- |
| Kraken | Route the measured strike to a tensioned sail or rope. Use a release or fracture event for water spray at the breaking point. |
| Moth Cathedral | Key the cocoon and wing poses. Release the shell through materialisation and let the confirmed release or named wing-beat markers shed dust. |
| Frozen Angel | Key the pose rise and bind the ice break to destruction or a deformable release. Feed the resulting position to snow or melt spray. |
| Garden | Emit a cue from a planted foot, activated surface contact, or creature animation. Use its point for a wet splash, a local field write, or a nearby plant response. |
