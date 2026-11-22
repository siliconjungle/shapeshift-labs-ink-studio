# Region revisions

A world run can publish immutable, region-scoped state and changes at each
committed tick. A region is an authored simulation chunk. Solvers use their
chunk owner, and entities follow their resolved world positions. Solvers
that enumerate poses can publish nearby moving entities with no authored row.
Place IDs distinguish chunks at the same coordinates. Unowned entities and
solvers belong to the opt-in `@global` region.

```js
const { KIT } = require('@shapeshift-labs/ink-studio').load();
const run = KIT.world.runtime.create(world, {
  regionRevisions: { stream: 'canal-survey-1', retain: 32 }
});
const receiver = KIT.world.regionRevisions.receiver();
const interest = { at: [2, 0, 2], radius: 8 };
receiver.apply(run.regions.pull(interest));

run.advance(4);
const since = receiver.snapshot().cursor;
const update = run.regions.pull(interest, { since });
receiver.apply(update);
```

Supply a distinct stream ID for a different authoritative branch or
timeline. The cursor identifies the stream, tick revision, and complete
region selection. Pass the cursor of the last applied update. A change in
interest can use the same cursor to add entering regions and remove
departing regions, including at the same tick. The receiver checks the
baseline before applying a patch and ignores duplicates and older updates.

A scope can use `{ regions: ['west', 'east'] }` or
`{ at: [x, y, z], radius, place }`. Set `includeGlobal: true` to include
unowned data. `run.regions.catalog()` lists region bounds and solver
ownership. `run.regions.status()` returns the current and oldest retained
revisions.

Exact retained baselines yield deltas using Ink Studio's structured edit
operations. Expired baselines and deltas beyond the edit budget yield a
fresh snapshot of the requested regions. A snapshot includes local entity
records and resolved positions, solver states, named signals, and available
chunk clocks. Aggregate and sleeping state keeps its working representation.
The resulting view is a regional read model. Resume an entire simulation
from a world checkpoint.

To persist a receiver, serialize `receiver.snapshot()` after applying an
update. Reopen it with `receiver({snapshot: saved})` and pass its cursor on
the next pull. A [runtime-backed place](portals.md#persistent-simulation-places)
restores the authority from its world checkpoint, so the saved stream can
resume across travel and reload.

Updates also include ordered, committed actions relevant to the scope.
Entity edits in a mixed patch are filtered by membership before or after
the committed tick. Whole-table edits are reflected in the resulting state.
Boundary transfers may name both account endpoints. Apply the state delta
or snapshot to advance a receiver. The action list is available for
inspection, and `actionsComplete` indicates whether the scoped interval
was retained within the action budget.

The journal is in-process, opt-in, and bounded by retained revisions.
It accepts `retain`, `maxEdits`, and `maxActions`. Region packets are
ordinary versioned JSON and the receiver validates them before committing
a replacement. The API works with local scripts and files.

## Carry named continuity across region views

Add `regionContinuity` to a world with authored simulation chunks. It
selects the people, parties, accounts, and story lifecycles that a
receiver needs even when it unloads every regional section.

```json
"regionContinuity": {
  "people": {
    "mira": { "system": "crew", "agent": "mira", "generation": 1 }
  },
  "parties": {
    "caravan": { "formation": "crew/caravan" }
  },
  "accounts": {
    "on-the-road": { "account": "west-stock/pack", "party": "caravan" },
    "east-rations": { "account": "east-stock/rations", "dormantTransfers": true }
  },
  "stories": {
    "canal-caravan/deliver": { "people": ["mira"], "parties": ["caravan"], "accounts": ["on-the-road"], "regions": ["east"] }
  }
}
```

| Record | Source and continuity |
| --- | --- |
| `people` | A roster, agent ID, and generation identify one lifetime. The report includes the live region, solver owner, detail or aggregate representation, sleep state, and any current order or travel phase. A departed lifetime becomes `unavailable`. |
| `parties` | Use a live `formation` handle or a list of named `members`. A formation publishes its current membership and phase. The report lists the regions the members occupy, including both regions when a party straddles a boundary. |
| `accounts` | Read the balance from one exposed account. An optional `person` or `party` makes its region follow that carrier while the native account keeps its solver owner. |
| `stories` | Use a qualified lifecycle ID. The report includes status, current stage and visit, and any outcome. Link named people, parties, accounts, or explicit regions to identify where the story is relevant. |

`world/region-continuity` reports those records to the CLI, host queries,
and story conditions. A condition can select `/people/mira/region`,
for example. The report derives from the committed simulation. Region
packets include the same report under `state.continuity`, and deltas
can update it as the selected region set changes. Pull with
`{ "regions": [] }` to unload all regional sections while retaining
that report. Recipients can save the resulting snapshot and pick up
the same stream, including after a history gap. The authoritative
run resumes from its world checkpoint.

The reported geographic region and solver owner are independent.
A person can be east of the boundary while its roster stays in the
west. Its owner still determines when that solver steps. The runtime
keeps formation and story state through sleep and aggregation.
Detailed work resumes at the solver's normal boundaries.

For native store accounts, `dormantTransfers` allows a story settlement
to post an exact transfer while the owning chunk sleeps. Every sleeping
endpoint must opt in. The same account capacity checks, atomic batch
commit, and transfer receipts apply, and the solver clock stays
asleep. Movement, work, and reservations retain their existing
simulation requirements.

The [Canal Caravan demo](../examples/story-documents/canal-caravan.world.json)
follows Mira and Noor across the canal, through cohort mode and sleep,
and back to detailed movement. An allocation moves four rations
between sleeping depots while the delivery questlet is in progress.

```sh
ink-studio sim run examples/story-documents/canal-caravan.world.json --ticks 24 --record caravan.run.json
ink-studio probe caravan.run.json --ticks 10 --field world/region-continuity
ink-studio sim regions caravan.run.json --stream canal-continuity --regions '' --ticks 10 --out unloaded.json
ink-studio sim regions caravan.run.json --stream canal-continuity --regions east,west --ticks 24 \
  --since unloaded.json --out returned.json
ink-studio sim regions-apply unloaded.json returned.json
```

## Headless example

```sh
ink-studio sim regions examples/world-region-revisions.json --stream canal-demo --near 2,0,2 --ticks 0 --out west.json
ink-studio sim regions examples/world-region-revisions.json --stream canal-demo --regions west --ticks 4 --since west.json --out west-update.json
ink-studio sim regions-apply west.json west-update.json --out west-current.json
```

The cart crosses from west to east, a transfer moves two units between
the tanks, and the western marker is removed. `sim regions` also accepts
a recording and builds the retained window from its starting checkpoint.
Use a small `--retain` value to exercise snapshot recovery.
