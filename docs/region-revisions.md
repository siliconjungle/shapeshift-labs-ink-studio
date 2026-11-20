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
