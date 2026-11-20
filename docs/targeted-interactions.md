# Targeted interactions

A `targeted-interactions` system checks whether a live agent can perform a
named verb on a target. A verb defines range, duration, access, and eligibility.
Each target binds that verb to attributes, a conservative stock transfer,
a typed input, or a result such as repair. Scenario commands and agent orders
use the same rules and commit path.

In the [interaction yard](../examples/world-interaction-yard.json), a visitor
is denied access to the floodgate. Its keeper works the control and the gate
rises. A gardener transfers two baskets to reserves, and a medic walks into
range and treats a patient.

## Author verbs and bindings

Add a system such as `use` with `kind: "targeted-interactions"`. Here is
its `config` for a gate controlled by a mechanics system called `rig`.

```json
{
  "verbs": {
    "open": {
      "range": 1,
      "ticks": 10,
      "access": {"relation": "same"},
      "cue": "gate-opened"
    }
  },
  "targets": {
    "floodgate": {
      "at": {"entity": "gate-control", "socket": "handle"},
      "faction": "canal",
      "verbs": {
        "open": {
          "effect": {
            "action": "world/input",
            "args": {"port": "rig/drive.lift", "value": 1.47}
          }
        }
      }
    }
  }
}
```

- `range` is a three-dimensional distance in world units from the actor's
  position to the target anchor. `ticks` defaults to zero for an immediate
  interaction.
- A target can be an XYZ point, an entity or socket, or a live agent handle
  such as `{"agent":{"system":"crew","id":"patient","generation":3}}`.
  The generation is optional for a named target. An attempt binds to the
  generation it found when it started.
- Factions are read from live actor metadata by default. Set `factionPath`
  to another path or JSON Pointer. A target can declare `faction` or inherit
  it from its bound agent or entity. Use an `access.factions` allowlist,
  `access.relation` of `same` or `different`, or both. A relation requires a
  faction on both sides.
- `actorWhen` reads the agent record. `targetWhen` reads the target record,
  including tags, available position, faction, and `values`. A `requires`
  entry probes a qualified query `field` at the `actor` or `target` and
  checks a condition with `when`. Pass provider arguments with `args`.
- `capacity` defaults to one concurrent attempt at a target. Each actor can
  hold one attempt per interaction system. Set `maxActive` and
  `historyLimit` to bound active and retained attempts.

## Commit effects

Declare each target attribute with `initial` and optional `min` and
`max`. A binding's `changes` can `set` or `add` to those attributes.
Values clamp by default. Use `mode: "exact"` to fail the attempt when the
result would fall outside its bounds. Attributes belong to the authored
target record. Use a generation pin when its record should have only one
valid agent lifetime.

A binding can add one external `effect`. Attribute changes post with it
only when it succeeds.

| Effect | Result |
| --- | --- |
| `world/input` | Set a typed manual input with `port` and `value`. The solver sees it on the completion tick. |
| `world/transfer` | Move the exact `amount` between `from` and `to` accounts. A capacity limit fails the attempt with a transfer receipt. |
| A registered physical work effect | Apply an effect such as `rig/repair` with a body or joint, or `construction/build`. The receiving system still validates the effect. |

Use `cue` to emit an authored world event at the target after a successful
commit. For example, a bell cue can also be heard by a
[perception system](faction-perception.md).

## Request, cancel, and inspect

Queue `use/start` with a request `id`, an `actor` handle, a `target`, and
a `verb`. Use `use/cancel` with the same `id` and owning actor to stop it.
Actor handles without a generation use the current lifetime when the
request starts. Live range, requirements, and access are checked before
each world integration using the latest completed poses and that tick's
scheduled changes. Losing eligibility or cancelling before completion
releases capacity. The world records the outcome and reason.

An order step such as
`{"op":"interact","system":"use","target":"patient","verb":"heal"}`
approaches the target and holds range. Use `{"param":"recipient"}` to
bind a target when issuing an order. Order cancellation or interruption
releases the attempt. A resumed order starts a fresh attempt. An order
can also use the existing
[jobs and reservations](job-reservations.md) contract to claim a separate
job, tool, or work slot.

```sh
ink-studio sim run examples/world-interaction-yard.json --ticks 45 --record yard.run.json
ink-studio probe yard.run.json --ticks 9 --field use/attempts --json
ink-studio probe yard.run.json --field use/attempts --args '{"id":"visitor-open"}' --json
ink-studio probe yard.run.json --field use/target --args '{"target":"patient"}' --json
ink-studio probe yard.run.json --field use/check --args '{"actor":{"system":"crew","id":"visitor"},"target":"floodgate","verb":"open"}' --json
ink-studio sim replay yard.run.json
```

`use/catalog` lists the verbs and available bindings, and `use/offering`
resolves the current position, range, and duration of one binding.
`use/check` previews eligibility and interaction capacity. Stock and
physical effects settle at completion. Checkpoints preserve the active
attempts, deadlines, values, and retained outcomes.
