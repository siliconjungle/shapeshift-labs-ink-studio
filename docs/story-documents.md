# Story documents

Use an `ink-studio/story` version 1 JSON document to author incidents, questlets, and arcs independently of any particular game or world. A definition describes stages, outcomes, references, and optional triggers. Ink's CLI checks the document and its links without stepping a simulation.

## Inspect the example

[The Burned Mill](../examples/story-documents/burned-mill.json) contains a fire incident, a grain delivery questlet, and a recovery arc that links to both. From the repository root:

```sh
node cli/ink-studio.js story validate examples/story-documents/burned-mill.json
node cli/ink-studio.js story describe examples/story-documents/burned-mill.json mill-recovery
node cli/ink-studio.js graph inspect examples/story-documents/inspect.graph.json --output arc
node cli/ink-studio.js patch run examples/story-documents/inspect.graph.json --watch 'arc=$arc'
```

`story validate` returns a JSON summary listing the document ID, version, and story IDs and kinds. `story describe` without an ID returns the full validated document. With an ID it returns the selected `definition`, its `id`, `documentId`, `version`, and the document's reference table. Both commands fail on an unsupported version or a broken internal reference and identify the field in the error. Node hosts can use `validateStoryDocument(value)` and `readStoryDocument(file)` from the package entry point. Both return the validated document, and validation leaves its data untouched.

## Write a definition

| Level | Required fields | Optional fields |
| --- | --- | --- |
| Document | `format` (`ink-studio/story`), `version` (`1`), `id`, nonempty `stories` map | `title`, `references` map |
| Story | `kind` (`incident`, `questlet`, or `arc`), `title`, `entry` stage ID, nonempty `stages` and `outcomes` maps | `summary`, local `roles` map, `refs`, named `triggers` map, `lifecycle` |
| Role | `kind` | `ref` to a document reference of the same kind |
| Stage | `title`, nonempty `next` map | `summary`, `roles` as local role IDs, `refs`, `story` as a linked story ID in this document, `objectives` when stage progression is enabled |
| Objective | `title` | `summary`, `refs`, `optional`, `evidence` |
| Outcome | `title` | `summary`, `refs`, `status` when stage progression is enabled |
| Reference | `kind`, `id` | |

Map keys are stable IDs. They are case-sensitive and start with a letter. The remaining characters can be letters, digits, underscores, hyphens, or dots, up to 100 characters total. Keep IDs when changing a title or reordering entries. Within a document, story IDs are unique. Stage, outcome, and role IDs are scoped to their story. A `next` ID is scoped to its stage and points to exactly one local target, for example `"delivered": { "outcome": "grain-delivered" }` or `"retry": { "stage": "collect" }`. The key identifies the branch. It does not execute a condition.

`refs` arrays contain IDs from the document's `references` map. Each reference pairs an authored kind such as `actor`, `place`, `scene`, `score`, or `patch` with an ID in the owning system. The ID can be slash-qualified, for example `river-valley/old-mill`. These are logical IDs. Resolve them in the tool that owns the corresponding data. A role with no `ref` leaves the identity open for later binding.

[Graph projects](headless-authoring.md#run-a-graph-project-from-the-cli) can read the validated file via `jsonAsset`. The [graph example](../examples/story-documents/inspect.graph.json) uses `data.get` to select the recovery arc through its stable ID.

## Trigger a story from a world

Add `storyDocuments` to a world manifest. The library accepts an array of embedded story documents. The CLI also accepts entries such as `{ "file": "burned-mill.json" }` relative to the world file. An Ink run recording or checkpoint embeds those documents so it can replay without the original paths. Older story files without `triggers` remain valid.

| Trigger | Example | When it starts |
| --- | --- | --- |
| Event | `{"event":{"kind":"order-succeeded","system":"team","where":{"path":"/order","value":"reach-lookout"}}}` | A world event matches the `kind`, optional `system`, and optional `where` filter. |
| Count within a window | `{"event":{"kind":"shortage"},"count":3,"within":0.3}` | A matching event brings the count to three within the trailing 0.3 seconds. Both ends of the window count, as do distinct matching events published in the same tick. |
| State crossing | `{"state":{"field":"power/charge","at":{"entity":"lookout"},"when":{"op":"gte","value":0.6}}}` | A world query goes from a known false result to true across samples. A value already true at startup or first observed after a missing sample does not count as a crossing. |
| Sustained state | `{"state":{"field":"world/account","args":{"account":"stock/mill"},"when":{"path":"/balance","op":"lte","value":2}},"hold":0.3}` | Every sample has matched for at least 0.3 seconds since the first true sample. A false or unavailable sample resets the timer. A match at tick zero can begin the hold. |

`where` tests an event record. `when` tests a query result. Both use [world conditions](headless-worlds.md#query-a-revision), including JSON Pointers, comparisons, and `all`, `any`, or `not`. For state rules, `field` must be qualified. `at` can select a world point, entity, or socket, and `args` are passed to the query. Rules read the tick's solver and transfer publications before derived event actions and observer updates. Hold durations round up to a whole tick. Repeat windows count ticks within the authored duration, with machine-rounding tolerance at an exact tick boundary.

Each story starts at most once per run. Its named triggers are alternatives. When several match on the same tick, the first trigger ID in lexical order wins. A story starts when a trigger matches or, with manual activation, when it is accepted. `story-started` includes the document, story, and entry stage, plus the trigger and its evidence when applicable. Use [event actions](event-actions.md) to turn that into a cue or command. The checkpoint stores pending trigger progress and the first match.

## Offer, activate, and resolve a story

Add `"lifecycle": {}` to a story definition to track its state and transition reasons. When a trigger matches, the lifecycle marks the story `available`. With the default `"activation": "automatic"`, it becomes `active` on the same tick. Use `"activation": "manual"` to wait for a command. A lifecycle-enabled story without triggers becomes available on the first tick. While a story waits for its trigger, the lifecycle probe returns `null` for it.

| Current state | Allowed destinations |
| --- | --- |
| `available` | `active`, `withdrawn`, `expired` |
| `active` | `suspended`, `completed`, `failed`, `withdrawn`, `expired` |
| `suspended` | `active`, `failed`, `withdrawn`, `expired` |
| `completed`, `failed`, `withdrawn`, `expired` | Terminal states |

For manual activation, `offerFor` optionally specifies how many seconds an offer stays available. The runtime rounds it up to a whole tick. At the deadline, expiration takes precedence over a command on the same tick. An active or suspended story can expire explicitly through a command from the host or an event action.

Schedule `world/story-transition` through ordinary world commands, through `sim run --actions`, or from an event action. Provide the document and story IDs, destination `to`, and a `reason` of up to 256 characters. A `completed` or `failed` transition can also include a declared `outcome` ID.

```json
{"tick":3,"action":"world/story-transition","args":{"document":"winter-crossing","story":"repair","to":"active","reason":"crew-accepted"}}
```

The runtime resolves new offers and automatic expiration before applying transition commands in their scheduled order. A well-formed command against the wrong current state emits `story-transition-rejected` with the current and requested state and the caller's reason. The rejected command leaves the story state as it was. The first activation emits `story-started`. Resuming after a suspension emits the transition only.

Each successful change publishes `story-transition` with `from`, `to`, `tick`, and `reason`. Inspect current state, first-trigger evidence, and the last 64 successful transitions per story with `world/story-lifecycle`. Like other world state, this data survives checkpoints, forks, and replay. It is also available when world event history is disabled. Definitions that omit `lifecycle` retain their existing start-event behavior and recording format.

### Replay The Winter Crossing

[The Winter Crossing](../examples/story-documents/winter-crossing.world.json) exercises every state. The repair is offered, accepted, suspended for ice, resumed, and completed by a routed inspection event. The scout fails, the escort is withdrawn, and the visitor's offer expires.

```sh
node cli/ink-studio.js sim run examples/story-documents/winter-crossing.world.json --ticks 10 --record crossing.run.json
node cli/ink-studio.js probe crossing.run.json --field world/story-lifecycle
node cli/ink-studio.js probe crossing.run.json --field world/history --args '{"where":{"path":"/kind","value":"story-transition"}}'
node cli/ink-studio.js sim replay crossing.run.json
```

## Branch and converge

Set `"lifecycle": { "progression": true }` to run the authored stage graph. First activation enters `entry` at visit `1`. Every stage link opens a new visit, including links back to the same stage. This lets a loop revisit a problem with fresh objectives. Suspension keeps the current visit and progress intact.

- Define `objectives` on a stage as a map keyed by stable IDs. Each objective needs a `title` and can have `summary`, `refs`, `optional: true`, and `evidence`. All required objectives are open together and can complete in any order.
- `next` names alternative branches. Each branch points to a stage or outcome. Multiple branches can point to the same stage. Give an optional stage a detour branch and provide a route that bypasses it.
- A branch opens after all required objectives and any listed in its optional `requires` array are complete. `requires` names objectives on the departing stage. This lets an optional objective unlock a particular route, such as a service key opening an upper entrance.
- An outcome ends the story with `completed` by default, or `failed` if the outcome specifies `"status": "failed"`. Use `world/story-transition` for outside interruptions such as failure, withdrawal, expiry, or suspension. Choose an ending branch to complete the story or select a named outcome.

Use ordinary world commands to resolve manual objectives and choose branches. Include the `stage` and `visit` from the lifecycle probe or `story-stage-entered` event. A request for an older visit cannot affect a new one. Event actions can also issue these commands.

```json
[
  {"tick":4,"action":"world/story-objective","args":{"document":"signal-vault","story":"open-vault","stage":"survey","visit":1,"objective":"service-key","result":"completed","reason":"key-recovered"}},
  {"tick":5,"action":"world/story-choose","args":{"document":"signal-vault","story":"open-vault","stage":"survey","visit":1,"branch":"upper-route","reason":"gantry-unlocked"}}
]
```

`world/story-objective` accepts `completed` for manual objectives and `skipped` for optional objectives. Unresolved optional objectives that do not block the chosen branch appear in the branch event's `skipped` list. Stage progress changes while the story is active. A well-formed request that cannot apply emits `story-progress-rejected`, with pending objective IDs when requirements are missing.

`world/story-lifecycle` exposes `flow.current` and the last 64 closed visits in `flow.route`. Closed visits retain objective results, reasons, skipped IDs, the selected branch, and its target. An authored ending clears `flow.current` and records the outcome on the story. The world publishes `story-stage-entered`, `story-objective-resolved`, and `story-branch-chosen` in commit order. Checkpoints, forks, and replay preserve the route.

### Fork The Signal Vault

[The Signal Vault](../examples/story-documents/signal-vault.world.json) records the survey and power objectives before the fork. The lower route skips the service key and reaches alignment through the tunnel. The upper route uses the key and takes the optional service detour before rejoining at alignment. The two forks then select different endings.

```sh
node cli/ink-studio.js sim run examples/story-documents/signal-vault.world.json --ticks 3 --checkpoint vault-start.json
node cli/ink-studio.js sim fork vault-start.json --ticks 7 --actions examples/story-documents/signal-vault-lower.actions.json --record lower.run.json
node cli/ink-studio.js sim fork vault-start.json --ticks 10 --actions examples/story-documents/signal-vault-upper.actions.json --record upper.run.json
node cli/ink-studio.js probe lower.run.json --field world/story-lifecycle
node cli/ink-studio.js probe upper.run.json --field world/story-lifecycle
```

## Confirm objectives with evidence

Add one `evidence` rule to an objective. Ink completes it when the current visit receives a matching event or observes a matching query result. Once configured, completion requires the rule to match. An optional objective can still be skipped explicitly.

| Proof | Objective's `evidence` field |
| --- | --- |
| A repair event from the mechanics system named `rig` | `{"event":{"kind":"body-repaired","system":"rig","where":{"path":"/body","value":"brace"}}}` |
| At least four crates in the landing account | `{"state":{"field":"world/account","args":{"account":"supplies/landing"},"select":"/balance","when":{"op":"gte","value":4}}}` |

Event rules take the first published record matching `kind`, optional `system`, and optional `where`. State rules read a qualified query `field` with optional `at` and `args`. Use `select` with a JSON Pointer or path array to extract a value before applying `when`. The sample must be available and contain the selected value. A query can confirm a condition that is already true when the visit first samples it.

Ink checks the visit that was active at the start of the tick, using that tick's solver events and state. New and resumed visits start observing on the next tick. Suspended visits take no samples, and events from earlier ticks never count. Evidence resolves before story commands, so a branch choice on the same tick can use a newly confirmed objective. The resulting `story-objective-resolved` event can drive event actions.

Each automatic result has reason `evidence-confirmed` and a `receipt`. An event receipt contains the source record, including its ID, tick, system, and payload. A state receipt contains the tick, query field, supplied `at`, `args` and `select`, and the sampled value. Inspect receipts in the resolution event and in `world/story-lifecycle` under `flow.current.objectives` or `flow.route[].objectives`. They survive checkpoints and replay even with world event history disabled.

The world supports up to 256 evidence rules. Each receipt must fit within 16,384 JSON characters. Use `select` to keep a query receipt focused on the fact it proves.

### Replay The Relief Crossing

In [The Relief Crossing](../examples/story-documents/relief-crossing.world.json), a shipment applies only two of the four requested crates, so the early branch choice reports both objectives pending. After the depot is replenished, the ledger confirms a full shipment on tick 5. A staffed worksite straightens the bent brace on tick 7. The scout and medic then cross the safety line, which the agent query confirms on tick 19. The resulting event closes the questlet on tick 20.

```sh
node cli/ink-studio.js sim run examples/story-documents/relief-crossing.world.json --ticks 32 --record relief-crossing.run.json
node cli/ink-studio.js probe relief-crossing.run.json --field world/story-lifecycle
node cli/ink-studio.js probe relief-crossing.run.json --field world/history --args '{"where":{"path":"/kind","value":"story-objective-resolved"}}'
node cli/ink-studio.js sim replay relief-crossing.run.json
```

## Replay the demos

**The Burned Mill** starts an incident from a survey report, opens a grain questlet after three shortages, and activates an arc only after the stock ledger stays low. A brief recovery resets the hold. The questlet start also schedules a bell event on the next tick.

```sh
node cli/ink-studio.js sim run examples/story-documents/burned-mill.world.json --ticks 12 --record mill.run.json
node cli/ink-studio.js probe mill.run.json --field world/history --args '{"where":{"path":"/kind","value":"story-started"}}'
node cli/ink-studio.js probe mill.run.json --field world/story-triggers
node cli/ink-studio.js sim replay mill.run.json
```

The starts appear at ticks **1**, **6**, and **8**. The bell appears at tick **7**. Probe a run at tick 5 to see the two retained shortages and the beginning of the second low-stock interval.

**The Empty Observatory** starts the lens arc when the charge measured at the lookout crosses 0.6. It starts the survey questlet only after the scout reaches the lookout and the agent system reports the move order succeeded.

```sh
node cli/ink-studio.js sim run examples/story-documents/observatory.world.json --ticks 30 --record observatory.run.json
node cli/ink-studio.js probe observatory.run.json --field world/history --args '{"where":{"path":"/kind","value":"story-started"}}'
```

The lens arc starts at tick **4** and the survey starts at tick **20**. Compare the survey's `evidence.events` entry with the `order-succeeded` event in the same recording.
