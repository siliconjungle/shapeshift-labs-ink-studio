# Public influence

A world can expose public priorities and funded rewards. Agents consider
eligible offers using their own preferences, needs, commitments, and routes.
A willing agent starts the same type of order used by scripts and direct
controls. The reward-flag inspiration comes from the
[Majesty Gold HD manual](https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/25990/manuals/Majesty_Manual_HD.pdf?t=1713279683).

In the [millworks example](../examples/world-influence-yard.json), a small
road-clearing bounty attracts nobody. A larger reward attracts the ranger.
A higher public priority draws the carpenter to a rebuild, and a release
of irrigation water makes a third offer eligible for the gardener.

## Author a board

Add a system of kind `influence` and give its config a table of `templates`.
Here is a board that can fund a road-clearing offer.

```json
{
  "funding": {
    "treasury": "money/treasury",
    "resource": "coin",
    "units": "coin"
  },
  "templates": {
    "clear": {
      "at": {"entity": "road-post"},
      "target": "site",
      "order": {"task": "clear", "blockedTimeout": 8}
    }
  }
}
```

A template's `at` is an XYZ point or a live entity or socket. An optional
`target` names the order target slot that receives that anchor. The order
may also carry other target bindings, parameters, and normal reservation
requirements. A template can declare `requires` checks such as
`{"field":"channel/depth","when":{"op":"gt","value":0.1}}`. The board samples
the offer position by default. Use `at` and `args` on a check to read another
site or supply a provider argument.

Use existing actions to set the local conditions, such as releasing water
through a gate, opening access, or moving stock. Conditions and reachable
routes are checked on the latest available world state when agents consider
the offer. After acceptance, the order's own rules govern execution.

## Give agents preferences

Add `influence` and a task catalog to the agent roster's config.

```json
{
  "board": "notices",
  "profiles": {
    "ranger": {
      "templates": ["clear"],
      "priorityWeight": 1,
      "rewardWeight": 1,
      "distanceCost": 1.5,
      "minScore": 7,
      "when": {"path": "/needs/hunger", "op": "lt", "value": 35}
    }
  },
  "members": {
    "ranger": {"profile": "ranger", "wallet": "money/ranger"}
  }
}
```

The score is weighted priority plus weighted reward minus weighted
straight-line distance. A score at or above `minScore` proceeds to a
route check using the agent's movement profile. The optional `when`
condition sees the agent record, its needs, and its activity and phase.
Agents with active orders, formations, or eligible activity commitments
stay occupied. One agent takes each offer at a time. Ties favor the nearer
responder, then older postings and stable IDs.

The board considers offers every `interval` ticks and immediately after
a posting or amendment. `maxPairs` and `routeBudget` cap the work of a
scan, with saved cursors advancing through bounded searches.
`retryTicks` sets the delay after a released offer.

## Post, amend, and withdraw

Schedule commands like these for a board named `notices`.

```json
[
  {"tick":1,"action":"notices/post","args":{"offer":"east-road","template":"clear","reward":2}},
  {"tick":8,"action":"notices/amend","args":{"offer":"east-road","priority":3,"reward":16}},
  {"tick":50,"action":"notices/withdraw","args":{"offer":"east-road"}}
]
```

`post` can supply a different `at`, an absolute `expires` tick, a
`priority`, and an optional whole-unit `reward`. Omit funding and wallet
accounts for priority-only boards.

A funded posting reserves the reward from the treasury in the board's
escrow using the world transfer ledger. The treasury and agent wallets
use matching integer accounts. Only the board can transfer from or into
its escrow. Changing an open reward moves the difference, and an
unfunded amendment leaves the prior offer in place.

A successful order pays the accepted reward once. A cancelled or failed
order can reopen the offer after the retry delay. Withdrawing or
expiring an open offer returns its funds. An accepted agent can finish
under the terms it accepted, including after withdrawal. If a wallet
or treasury is full, the board retains the funded payment and retries
as capacity becomes available.

## Inspect and replay

```sh
ink-studio sim run examples/world-influence-yard.json --ticks 38 --record millworks.run.json
ink-studio probe millworks.run.json --ticks 4 --field notices/scan --json
ink-studio probe millworks.run.json --field notices/offers --args '{"offer":"clear-road"}' --json
ink-studio probe millworks.run.json --field world/account --args '{"account":"money/ranger"}' --json
ink-studio sim replay millworks.run.json
```

`offers` lists posting status, assignee, and settlement details.
`scan` shows the reason and score for evaluated responses, including
unreachable routes, conditions, and insufficient incentives. Its
`limited` flag reports search budgets and `truncated` reports omitted
response details. Checkpoints preserve offer revisions, search cursors,
assigned orders, and escrow for replay or forks.
