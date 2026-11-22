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
| Story | `kind` (`incident`, `questlet`, or `arc`), `title`, `entry` stage ID, nonempty `stages` and `outcomes` maps | `summary`, local `roles` map, `refs`, named `triggers` map |
| Role | `kind` | `ref` to a document reference of the same kind |
| Stage | `title`, nonempty `next` map | `summary`, `roles` as local role IDs, `refs`, `story` as a linked story ID in this document |
| Outcome | `title` | `summary`, `refs` |
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

Each story starts at most once per run. Its named triggers are alternatives. When several match on the same tick, the first trigger ID in lexical order wins. A start publishes `story-started` in the normal world event stream with document, story, entry stage, trigger, and either the source event IDs or the field and matching interval. Use [event actions](event-actions.md) to turn that into a cue or command. The checkpoint stores pending trigger progress and the first start. Branch choice and stage progression are separate runtime work.

### Replay the demos

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
