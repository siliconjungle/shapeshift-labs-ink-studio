# Jobs and reservations

A reservation board shares capacity across agent rosters. Use a reusable
pool for a tool, a workbench, a destination, or any resource whose access
must be limited. Use a job for an offer that should close after one
successful order. Both can carry metadata and a live scene target.

[Public influence](public-influence.md) lets agents independently choose
an offer and start an order that can require one of these reservations.

The [shelter and crate example](../examples/world-shelter-reservations.json)
runs twenty villagers through five shelter spots while two couriers compete
for one crate job. One villager gives up a spot to answer an interruption
and returns later. The winning courier moves the crate through the
world's transfer ledger.

## Define pools and jobs

Declare the board as a world system of kind `reservations`.

```json
{
  "kind": "reservations",
  "config": {
    "pools": {
      "workbench": {"capacity": 2, "leaseTicks": 180},
      "west-door": {"capacity": 1, "at": {"entity": "shed", "socket": "west"}}
    },
    "jobs": {
      "collect-crate": {
        "at": {"entity": "crate", "socket": "handle"},
        "metadata": {"work": "haul"}
      }
    }
  }
}
```

Each pool has an integer `capacity`. Jobs have one place and can be posted
at runtime with `board/post-job`, where `board` is the system name. Pass
`job` and any optional `at`, `metadata`, `leaseTicks`, or `expires`
properties. The absolute `expires` world tick closes an uncompleted job.
`board/withdraw-job` removes a job by ID. A reposted ID has a new revision.
A holder from the previous posting must claim the new revision with a new order.

## Attach claims to orders

Supply `reservation` on any [agent order](agent-orders.md). Each named
requirement can list candidate pool or job IDs with `anyOf` or find an
open job with a [query condition](headless-worlds.md#query-a-revision) in
`job`. Set `job: true` to match any open job. `units` defaults to one.
A task target can reference the chosen pool or job using `{"claim":"name"}`.
Use an XYZ point or an entity and socket for the offer's `at` binding.

```json
{
  "task": "collect",
  "targets": {"destination": {"claim": "work"}},
  "reservation": {
    "board": "board",
    "require": {
      "work": {"job": {"path": "/metadata/work", "value": "haul"}},
      "bench": {"anyOf": ["workbench"], "units": 1}
    }
  }
}
```

The board grants the whole bundle at once. Requests that can be satisfied
are considered in order of when they started waiting, with stable roster
and agent IDs breaking ties. Candidate lists express preference where a
complete assignment permits it. Job filters prefer earlier postings. An
order waiting for a bundle holds none of it, so unrelated available
capacity can still be used.

Orders release claims on success, failure, cancellation, interruption,
or despawn. A successful order closes the jobs it held. On interruption,
the original order retains its selected IDs and revisions and must
reacquire them before it resumes. If another order finishes a job in
that interval, the original order fails when it tries to reacquire it.

Leases use world ticks and expire before pending transfers settle.
New acquisitions pause in sleeping and cohort simulation. An existing
lease still expires at its designated world tick. An order's
timeout can count time waiting for a claim. Its task-step waits count
only time with the required claims in hand. A claim reserves access.
A transfer step posts actual stock movement.

## Inspect and replay

```sh
ink-studio sim run examples/world-shelter-reservations.json --ticks 295 --record shelter.run.json
ink-studio probe shelter.run.json --ticks 7 --field booking/claims --json
ink-studio probe shelter.run.json --field booking/jobs --args '{"job":"collect-crate"}' --json
ink-studio probe shelter.run.json --field booking/pools --json
ink-studio sim replay shelter.run.json
```

- `claims` lists held, waiting, paused, and failed claims with reasons and
  any selected offers. `claim` looks up the owner by `system`, `agent`,
  `generation`, and order `sequence`. A paused claim retains its bindings
  for resumption. Only held claims count against capacity.
- `pools` and `jobs` report reserved and available units. A completed job
  records the completing owner and closing tick.
- The world event record includes `reservation-granted`,
  `reservation-released`, and job lifecycle events. The order query
  reports missing capacity, an expired lease, and other blockers.
  Checkpoints keep claim owners, queue age, deadlines, and job revisions.
