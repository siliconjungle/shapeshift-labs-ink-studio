# Agent orders and task execution

Add `config.orders` to an `agents` system to enable reusable tasks, ordered
work, and per-agent outcomes. A game host can send the same actions as a
scripted scenario or a recorded CLI run.

In the [courier example](../examples/world-agent-orders.json), a scout gets
a move order and a queued return trip. A storm interrupts a courier's
delivery after pickup. The courier retains the grain, waits at a shelter
until the rain field clears, then resumes the remaining delivery steps. The
scout's return trip is cancelled while it is queued.

## Define reusable tasks

The `tasks` catalog maps task IDs to lists of 1–32 steps. Use
`{"target":"name"}` to declare a target slot and supply its value when
issuing an order. A target can be XYZ or `{"entity":"building","socket":"door"}`.
The socket is optional. Live entity and socket poses are resolved as the
step runs, so an order can follow a relocated destination.

| Step | Options and result |
| --- | --- |
| `move` | `at` gives a target slot or literal target. Uses the agent's walking, swimming, or flying profile. Records the actual position on arrival. |
| `wait` | `ticks`, a query condition, or both. A query condition uses `field`, optional `at` and `args`, and `when` in the same format as [scenario conditions](headless-worlds.md#query-a-revision). The default sample location is the agent. |
| `transfer` | `from`, `to`, and `amount` use literals or `{"param":"name"}`. The world transfer ledger validates resource, type, and units and records the actual receipt. `mode` defaults to `exact`. Use `partial` to accept a nonzero partial delivery. A blocked transfer fails the order with the receipt. |
| `emit` | `kind` and optional `data` publish a world event with the order, target bindings, and agent position. Add a later `wait` step if the task should verify an outcome from another system. |
| `interact` | `system`, `target`, and `verb` select a [targeted interaction](targeted-interactions.md). The agent approaches the live target and waits for the attempt to settle. The target and verb can use parameter slots. |

An order can have an optional `timeout` in execution ticks. The timeout
and elapsed waits pause while interrupted, sleeping, or in cohort LOD.
An execution tick is a world tick in which the detailed solver visits
the active order. Multiple substeps in that tick count once. Waiting on
routing, a crossing, a missing target, or a field condition can be inspected
while the order runs.

Add [jobs and reservations](job-reservations.md) when an order must claim
limited capacity or a single-use job before any of its steps run.
[Physical work](physical-work.md) adds range-checked transfers and a
`work` step for staffed logistics recipes.

## Issue, interrupt, and cancel

A scheduled move for an agents system named `crew` looks like this:

```json
{
  "tick": 12,
  "action": "crew/issue-order",
  "args": {
    "agent": "scout",
    "mode": "append",
    "order": {
      "id": "reach-lookout",
      "task": "move",
      "targets": {"destination": {"entity": "lookout"}},
      "timeout": 120
    }
  }
}
```

- `append` adds work in issue order. `interrupt` pauses the active
  order at its current step. The most recently paused work resumes first,
  ahead of queued work. `replace` cancels all pending work and starts a new order.
- `crew/cancel-order` takes `agent` and optional `order`. Use an order's
  label or numeric sequence, or omit `order` to cancel all pending work.
  Both actions accept an optional agent `generation` to target a specific
  lifetime. Sequences increase within each lifetime. Labels must be unique
  among pending orders and retained outcomes for that agent.
- `maxQueued` controls the combined waiting and paused capacity per agent
  and defaults to 16. `historyLimit` controls how many terminal outcomes
  the per-agent query retains and defaults to 16. The regular world history
  separately records issue, start, interruption, resume, and terminal events.
- Explicit work temporarily owns the agent's movement and task label.
  An activity policy reevaluates when orders drain. Route queue priority can
  be set per order with `priority`. A walker already admitted into a shared
  crossing clears the passage before stopping or redirecting.
- Cancellation removes pending work before transfers settle for that tick.
  Previously committed steps stay committed. For example, cancelling after
  pickup leaves stock in the cargo account. A recovery order can deliver or
  return it using the same transfer step.

## Inspect a run

```sh
ink-studio sim run examples/world-agent-orders.json --ticks 82 --record courier.run.json
ink-studio probe courier.run.json --ticks 37 --field crew/orders --args '{"agent":"courier"}' --json
ink-studio probe courier.run.json --field crew/orders --args '{"agent":"courier"}' --json
ink-studio probe courier.run.json --field crew/order-tasks --json
ink-studio sim replay courier.run.json
```

`orders` reports the active step and reason, paused and queued work, and
terminal outcomes with completed step results. `order-tasks` lists each
task's steps and required target and parameter slots. Use the agent ID,
the agent's entity selector, or its generation with the same query
conventions as [agent storage](agent-storage.md). Checkpoints and forks
retain step progress and queued work. A prepared transfer is confirmed once
by the world ledger, even when the agent solver uses a slower cadence.
