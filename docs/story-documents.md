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

`story validate` returns a JSON summary listing the document ID, version, and story IDs and kinds, plus graph diagnostics where present. `story describe` without an ID returns the full validated document. With an ID it returns the selected `definition`, its `id`, `documentId`, `version`, and the document's reference table. Both commands fail on an unsupported version or a broken internal reference and identify the field in the error. Node hosts can use `validateStoryDocument(value)` and `readStoryDocument(file)` from the package entry point. Both return the validated document, and validation leaves its data untouched.

## Preflight story routes

`story preview <file.json> [story-id]` reports authored stages, branch gates, child waits, reachable endings, and a shortest sample route to each shown ending. It keeps up to 16 sample routes per story and up to 64 steps per sample. Omitted counts are explicit. Set `--strict` on `story validate` or `story preview` to exit with status 1 for any diagnostic. By default, broken references or invalid targets fail the check and graph findings appear as warnings. Preview returns its JSON report even when it finds broken links.

| Finding | What to inspect |
| --- | --- |
| Missing reference or ambiguous target | The authored field path identifies an unresolved ID or a branch that names both a stage and an outcome. |
| Unreachable stage | The analyzer could find no path from the entry after checking the available static gates. |
| Ambiguous automatic transition | Two automatic branches may qualify together. Distinct choices or incompatible terminal results on the same child can establish that they are exclusive. Runtime selection uses the first eligible branch ID. |
| Loop without an exit | A reachable cycle has no path to a named ending. |
| Unbounded chain | A reachable cycle has an exit and permits indefinite revisits. A world or work deadline provides a bound. |
| Child wait before opening | A group or branch needs a child that cannot open along the way to it. A world deadline can make an unopened child available as an expired result. |

`sim preflight <world.json> [--strict]` compiles the world with its embedded stories and checks the registered query fields, systems, cleanup targets, and action bindings without initializing or stepping the simulation. `sim run` prints graph warnings to stderr before advancing. Node hosts can use `preflightStoryDocument(value, {story})` for a document preview and `KIT.world.runtime.storyPreflight(world)` for a compiled world report.

The preview uses authored structure and static conditions. It considers possible child openings across incoming paths and checks explicit choice and outcome conflicts. World events, query values, and the order of arrivals are resolved during a run.

### Inspect The Breakwater Survey

[The draft](../examples/story-documents/breakwater-draft.json) contains missing links, an ambiguous automatic decision, an unreachable dock, a loop with an exit, a loop with no ending, and a wait placed before its child opens. [The reviewed story](../examples/story-documents/breakwater-survey.json) has two exclusive routes based on the sounding's outcome.

```sh
node cli/ink-studio.js story preview examples/story-documents/breakwater-draft.json
node cli/ink-studio.js story preview examples/story-documents/breakwater-survey.json pick-channel --strict
node cli/ink-studio.js sim preflight examples/story-documents/breakwater-survey.world.json --strict
node cli/ink-studio.js sim run examples/story-documents/breakwater-survey.world.json --ticks 6 --record survey.run.json
```

## Write a definition

| Level | Required fields | Optional fields |
| --- | --- | --- |
| Document | `format` (`ink-studio/story`), `version` (`1`), `id`, nonempty `stories` map | `title`, `references` map, `objectiveTypes` map |
| Story | `kind` (`incident`, `questlet`, or `arc`), `title`, `entry` stage ID, nonempty `stages` and `outcomes` maps | `summary`, local `roles` map, `refs`, named `triggers` map, `lifecycle`, `incident` metadata on an incident |
| Role | `kind` | `ref` to a document reference of the same kind, `required` for a required world binding or reference default |
| Stage | `title`, nonempty `next` map | `summary`, `roles` as local role IDs, `refs`, `story` as a linked story ID in this document, `objectives` and `decision` when stage progression is enabled, `children` on a progressing arc |
| Objective | `title` | `summary`, `refs`, `optional`, `evidence`, `type` with its `params` |
| Outcome | `title` | `summary`, `refs`, `status` when stage progression is enabled |
| Reference | `kind`, `id` | |

Map keys are stable IDs. They are case-sensitive and start with a letter. The remaining characters can be letters, digits, underscores, hyphens, or dots, up to 100 characters total. Keep IDs when changing a title or reordering entries. Within a document, story IDs are unique. Stage, outcome, and role IDs are scoped to their story. A `next` ID is scoped to its stage and points to exactly one local target, for example `"delivered": { "outcome": "grain-delivered" }` or `"retry": { "stage": "collect" }`. The key identifies the branch. It does not execute a condition.

`refs` arrays contain IDs from the document's `references` map. Each reference pairs an authored kind such as `actor`, `place`, `scene`, `score`, or `patch` with an ID in the owning system. The ID can be slash-qualified, for example `river-valley/old-mill`. These are logical IDs. Resolve them in the tool that owns the corresponding data. A role with no `ref` leaves the identity open for later binding.

[Graph projects](headless-authoring.md#run-a-graph-project-from-the-cli) can read the validated file via `jsonAsset`. The [graph example](../examples/story-documents/inspect.graph.json) uses `data.get` to select the recovery arc through its stable ID.

## Bind reusable role slots

Declare any role ID under a story's `roles` map. Names such as requester, rival, escort, and destination are author choices. Kind IDs are also author-defined. A binding carries the declared kind and a JSON value, such as a named participant, a native solver handle, a coordinate, a transfer account, or a custom record.

For a story declaring `"escort": {"kind":"courier"}`, add a binding under its `document/story` key in the world manifest.

```json
{
  "storyBindings": {
    "relief-charter/courier": {
      "escort": { "kind": "courier", "value": { "system": "trail-crew", "agent": "ridge-runner" } }
    }
  }
}
```

Use `{"$role":"escort"}` for the whole value, or project part of it with a JSON Pointer or path array, such as `{"$role":"escort","path":"/agent"}`. Local references work in story triggers, objective evidence and parameters, and cleanup targets. Stable graph IDs and choice options stay authored. For example, a reach objective can read the escort's roster from `/system` and the destination's receiving bounds from `/bounds/min`.

World commands and event actions use an explicit scope, such as `{"$role":"escort","story":"relief-charter/courier","path":"/agent"}`. The same command recipe can issue an order on a bound roster and transfer a reward from a bound account. Bindings contain concrete values. Story compilation expands them before checking the resulting commands, objective parameters, and cleanup targets against the ordinary world rules.

A role's `ref` supplies its reference ID as a default. A world binding of the same kind overrides it. Ink requires a value for every referenced role and every role declared with `"required": true`. Roles used purely as annotations may stay open. `story preview` shows declarations and stage role lists. `sim preflight` checks actual bindings. Probe `world/story-roles` with optional `story` and `role` arguments to see values and whether each came from the world or a reference. World bindings travel with the embedded story documents in checkpoints and recordings.

### Recast The Relief Charter

[The Relief Charter](../examples/story-documents/relief-charter.json) uses one story and one command file across [the ridge](../examples/story-documents/relief-charter-ridge.world.json) and [the quay](../examples/story-documents/relief-charter-quay.world.json). Each world binds its own requester, consignment, escort, rival, witness, destination, treasury, and dispatch authorization. The native roster moves the bound escort, the ledger settles the bound delivery, and the completion event pays the bound wallet.

```sh
node cli/ink-studio.js story preview examples/story-documents/relief-charter.json courier --strict
node cli/ink-studio.js sim preflight examples/story-documents/relief-charter-ridge.world.json --strict
node cli/ink-studio.js sim run examples/story-documents/relief-charter-ridge.world.json --actions examples/story-documents/relief-charter.actions.json --ticks 18 --record ridge.run.json
node cli/ink-studio.js sim run examples/story-documents/relief-charter-quay.world.json --actions examples/story-documents/relief-charter.actions.json --ticks 18 --record quay.run.json
node cli/ink-studio.js probe quay.run.json --field world/story-roles --args '{"story":"relief-charter/courier","role":"escort"}'
```

## Find and explain casting candidates

Use `sim cast` to search one or more agent rosters in a world, checkpoint, or run recording. Each named requirement contributes an explanation for every returned candidate. The report records the snapshot tick and the observed values behind `pass`, `fail`, or `unavailable`. A missing account or relationship stays unavailable even when a threshold would accept zero.

```sh
node cli/ink-studio.js sim cast examples/story-documents/beacon-casting.world.json --spec examples/story-documents/beacon-casting.query.json
node cli/ink-studio.js sim cast examples/story-documents/beacon-casting.world.json --spec examples/story-documents/beacon-casting.query.json --actions examples/story-documents/beacon-shift.actions.json --ticks 2
```

Ada qualifies at tick zero. At tick two Ada has taken a gate watch and transferred her repair kits to Bow, who now qualifies. The [clearance query](../examples/story-documents/beacon-clearance.query.json) uses the same world and command file to find Rei after the keeper approves him through a live world signal.

Give the spec a `rosters` array of system IDs and an optional `requirements` map. Each entry has one criterion. All requirements must pass. Up to 32 rosters and 32 requirements may be evaluated in one report.

| Criterion | Example | Evidence |
| --- | --- | --- |
| Traits | `{"traits":{"all":["steady","local"]}}` | Candidate's `metadata.traits` array and any missing tags. |
| Capabilities | `{"capabilities":{"all":["carry"]}}` | Candidate's `metadata.capabilities` array and any missing tags. |
| Faction | `{"faction":{"is":"harbor"}}` | Candidate's `metadata.faction` ID. |
| Relationship | `{"relationship":{"with":"keeper","when":{"path":"/trust","op":"gte","value":0.6}}}` | Directional value under `metadata.relationships` at the counterpart ID. |
| Inventory | `{"inventory":{"accountPath":"/metadata/toolAccount","atLeast":2}}` | Live scalar balance, resource, and units from `world/account`. |
| Proximity | `{"proximity":{"at":{"entity":"beacon","socket":"landing"},"within":3}}` | Inclusive 3D distance in world units from the candidate to an XYZ point or resolved entity/socket. |
| Availability | `{"availability":"free"}` | Native roster state. Dormant agents are `unavailable`. Orders, shared travel, driven formations, assigned tasks, or an outstanding movement destination make the agent `busy`. Others are `free`. |
| Candidate condition | `{"where":{"path":"/metadata/score","op":"gte","value":5}}` | The shared world condition evaluated against the agent record. |
| World query | `{"query":{"field":"world/signal","bind":{"port":"/metadata/clearancePort"},"when":{"value":true}}}` | A live field read, its resolved arguments, and the value compared. |

Traits, capabilities, faction, and relationship criteria accept an optional `path` for custom metadata layouts. Conditions use the same operators as story triggers. Custom world queries accept literal `args` and a `bind` map from argument names to candidate paths. Supply `at` as a point, an entity/socket, or `"candidate"` to sample at the candidate's current position. Use `select` to compare and record just one part of a field result. Candidate paths can use the agent's usual fields plus `/system`, `/agent`, and `/generation`.

Qualified rows come first. Within each group, rows are ordered by roster ID then agent ID. `limit` caps returned rows at 100 by default and accepts 0 for counts only, up to 10,000. Counts refer to the entire search, and `omitted` counts rows outside the limit. The same report is available to Ink systems through the `world/story-candidates` probe, with the spec passed as its query arguments.

To get copyable role bindings on qualified rows, add `"binding":{"story":"document/story","role":"escort"}` to use the role kind from an embedded story. Use `"binding":{"kind":"field-escort"}` to cast from a roster snapshot before binding a required role. The default binding value contains the roster system, agent ID, and generation. Set `binding.select` to a path for a single value or a map of names to paths for a custom value record. Candidates missing a required value list its projection key under `bindingMissing`. Write the selected row's `binding` into the world's `storyBindings` and run `sim preflight` to verify the authored story can use it.

## Instantiate parameterized story templates

Use an `ink-studio/story-template` version 1 document to reuse a story graph while varying the cast, sites, objective thresholds, deadlines, and consequences. The template has its own `id` and positive integer `revision`. Its `document` is a story document body with a `stories` map and optional `title`, `references`, and `objectiveTypes`. It can contain multiple stories, including arcs with local child questlets.

Declare inputs in the template's `parameters` map. Each entry has a `type`. Supported types are `string`, `id`, `boolean`, `number`, `integer`, `point` for finite XYZ coordinates, `object`, `array`, and `json` for any finite JSON value. `default` makes an input optional. Numbers and integers accept inclusive `min` and `max`. Each instance can supply up to 64 declared parameters. An undeclared value, wrong type, missing required input, or out-of-bounds number fails expansion.

`{"$param":"cases"}` inserts a whole JSON value. `{"$param":"destination","path":"/account"}` inserts a selected part of a structured value. The selector accepts a JSON Pointer or a path array. Object keys are authored literally. Keep story, stage, objective, and outcome IDs fixed when the variations share the same graph. `{"$instance":true}` inserts the instance document ID, and `{"$instance":"delivery"}` inserts that instance's qualified story ID, such as `quay-run/delivery`.

A template can declare `bindings` as a map of local story IDs to role bindings and `eventActions` as native event routing rules. A `$param` can carry a complete `{kind,value}` binding from a casting query. Inside the story, `$role` resolves in the usual way. For a qualified role use in an event action, use `{"$role":"courier","story":{"$instance":"delivery"},"path":"/agent"}`. Template route IDs are prefixed with the instance document ID. To listen for your instance's lifecycle events, filter `/document` with `{"$instance":true}`. The usual action validation applies to the expanded commands. Duplicate document IDs, role bindings, and event action IDs fail preflight.

Add a `storyTemplates` array to the world manifest. Each instance uses `id`, either an embedded `template` or a CLI-relative `file`, and optional `parameters` and `revision` to pin the expected revision. Concrete `storyDocuments` can live alongside instances. Each instance counts against the world's existing 32-document limit. CLI runs embed the template sources and chosen values in checkpoints and recordings so replay needs only the recording.

```json
{
  "id": "quay-run",
  "file": "supply-dispatch.template.json",
  "revision": 1,
  "parameters": {
    "label": "Resupply the quay before the tide turns",
    "courier": { "kind": "supply-courier", "value": { "system": "crew", "agent": "nilo", "generation": 2, "seek": "crew/seek" } },
    "destination": { "point": [0.6, 0, 1], "min": [0.4, -0.1, 0.85], "max": [0.8, 0.1, 1.15], "account": "dispatch/quay-depot" },
    "stock": "dispatch/quay-stock",
    "wallet": "dispatch/nilo",
    "cases": 4,
    "timeBudget": 1.6,
    "reward": 7
  }
}
```

`story instantiate template.json instance.json` prints the expanded `document`, `storyBindings`, `eventActions`, and instance provenance. For this command, the instance file has the same `id`, `parameters`, and optional `revision` as the world row. The template comes from the first file argument. Node code can use `instantiateStoryTemplate(template, instance)` for the same result. Use `sim preflight` to verify the assembled world and inspect resolved parameter values and defaults under `templates`. During or after a run, read the same provenance through `world/story-templates` with an optional `id` argument.

### Run three dispatch variants

The [supply-dispatch template](../examples/story-documents/supply-dispatch.template.json) runs three independent instances in the [same world](../examples/story-documents/supply-dispatch.world.json). Mai delivers two cases to the mill and earns three coins. Nilo's first handoff falls short of the quay's four-case requirement. A later shipment proves the delivery and pays seven coins. The ridge courier runs out of time and receives no reward.

```sh
node cli/ink-studio.js sim preflight examples/story-documents/supply-dispatch.world.json --strict
node cli/ink-studio.js sim run examples/story-documents/supply-dispatch.world.json --actions examples/story-documents/supply-dispatch.actions.json --ticks 14 --record dispatches.run.json
node cli/ink-studio.js probe dispatches.run.json --field world/story-templates --args '{"id":"quay-run"}'
node cli/ink-studio.js probe dispatches.run.json --field world/story-lifecycle
node cli/ink-studio.js sim replay dispatches.run.json
```

## Check feasibility before offering a story

Put named checks under `lifecycle.feasibility`. Ink tests them against the completed tick before it publishes the `available` transition. Every check must report ready. A request that arrives while blocked stays pending and is checked on later ticks. Ink keeps the original trigger evidence or the parent arc's opening visit. An authored story without triggers first requests an offer at tick one.

| Check | Shape | What Ink verifies |
| --- | --- | --- |
| Route | `{"route":{"system":"crew","agent":"courier","generation":2,"to":{"entity":"shelter","socket":"intake"}}}` | Uses the live agent's navigation profile, bounds, and clearance. Starts at the current agent position or an explicit `from` pin. Pins can be XYZ points, entity sockets, or agent handles. |
| Stock and capacity | `{"transfer":{"from":"supplies/depot","to":"supplies/shelter","amount":2}}` | Quotes one exact native transfer. It checks resource, units, quantity, access, withdrawable balance, receiving room, and ledger precision. The report lists source and destination shortages independently. Optional `requester` uses the named solver's account access. |
| Work | `{"work":{"site":"workshop/platform","batch":1,"workers":[{"system":"crew","agent":"builder","task":"platform"}]}}` | Checks the next recipe batch, worksite control state, materials, and output room. It verifies enough listed workers are free, have a matching work step, and can reach the site. Built-in build, repair, and recruit effects use their live blocker checks. |
| Custom world state | `{"state":{"field":"world/signal","args":{"port":"power/ready"},"when":{"value":true}}}` | Samples a qualified Ink field with optional `at`, `args`, and `select`, then applies the usual world condition. An unavailable field sample keeps the offer pending. |

Worker entries accept an optional agent generation plus `params` and `targets` for parameterized order tasks. The work check uses the current next batch when `batch` is omitted. For custom work effect providers, an optional read-only `blocker(state,args,batch,ctx)` hook returns a blocker reason or `null`. A work effect with no snapshot check reports unavailable. Use custom state checks to include other requirements such as reservation pools, weather, or power.

Feasibility checks accept `$role` references and template parameters. `sim preflight` validates the resolved references and lists authored checks. `world/story-feasibility` returns the request and the last attempted report. Set `preview:true` to also sample current conditions, including before a request arrives. Results distinguish `ready`, `blocked`, and `unavailable`. The offer keeps its passing report, while a later preview reflects current conditions. A transfer quote reports unbounded availability or room as `null`. Quotes read the snapshot. Commitments and settlement use the normal reservation, transfer, and work systems.

An offer clock begins when the checks pass and the offer is published. World deadlines keep running while a request is pending. If the deadline arrives first, the story expires before any offer. Checkpoints and recordings preserve the request, original trigger or opening visit, and last report.

### Run the sluice relief example

The [story](../examples/story-documents/sluice-relief.json) requests relief at tick one. It waits for two crates of medicine, space at the shelter, a clear passage, and a worksite with boards and output room. The [commands](../examples/story-documents/sluice-relief.actions.json) remove each blocker by tick six. Accepting at tick seven dispatches the courier and workshop order. The story records the delivery, finished work, and arrival before completing.

```sh
node cli/ink-studio.js sim preflight examples/story-documents/sluice-relief.world.json --strict
node cli/ink-studio.js probe examples/story-documents/sluice-relief.world.json --field world/story-feasibility --args '{"story":"sluice-relief/relief","preview":true}'
node cli/ink-studio.js sim run examples/story-documents/sluice-relief.world.json --actions examples/story-documents/sluice-relief.actions.json --ticks 28 --record sluice.run.json
node cli/ink-studio.js probe sluice.run.json --ticks 5 --field world/story-feasibility --args '{"story":"sluice-relief/relief"}'
node cli/ink-studio.js probe sluice.run.json --field world/story-feasibility
node cli/ink-studio.js sim replay sluice.run.json
```

## Declare live reference policies

Put named watches under `lifecycle.liveReferences` to react to changes in the world. Watches can start with concrete targets, `$role` bindings, or template parameters. Sample an agent with `{"agent":{"system":"crew","agent":"pilot","generation":2}}` or an entity with `{"entity":"dock","socket":"landing"}`. The generation pins an agent's lifetime. Without one, Ink pins the first observed generation.

Each watch has an optional `on` map. These are the supported changes.

| Change | Detection |
| --- | --- |
| `moved` | The current position is farther from the anchor than `moveTolerance` in world units. The default is 0.25. |
| `faction-changed` | The target's faction differs from its anchor. Ink reads `metadata.faction` or a custom `factionPath`. |
| `inaccessible` | The position or identity is unavailable, the agent is dormant, or an authored access check fails. |
| `missing` | The entity or agent can no longer be found by its ID. |
| `died` | A matching death event identifies this target's lifetime. |
| `replaced` | The same agent ID now has a different generation, or an entity's optional `identityPath` now has a different ID or positive integer. |

Set `access.routeFrom` to an agent handle to test a native route to the current target position. Use `access.state` for a world query condition with optional `select`. For death, give `death.event` a normal event selector and `death.target` a path to the affected identity. For example, `{"event":{"kind":"population-death","system":"harbor"},"target":"/actor"}` checks the event's `{system,agent,generation}` handle. Entity events carry the entity ID, or `{entity,identity}` when the watch has an `identityPath`. Death stays latched to that lifetime.

| Policy | Effect |
| --- | --- |
| `track` | The default for unlisted changes. Keeps the lifecycle going and records the change. Movement and faction tracking update their anchors. |
| `suspend` | Holds activation and pauses active stories. The same policy resumes its suspension once all blockers clear. An existing manual suspension still requires a manual resume. |
| `fail` | Fails an active or suspended story. An unaccepted offer is withdrawn. |
| `withdraw` | Withdraws an available, active, or suspended story. |
| `adopt` | Applies to `replaced`. Accepts the new lifetime, establishes fresh movement and faction anchors, and clears the previous lifetime's death. A death observed that tick is handled before adoption. |

Suspending on movement or faction keeps the anchor fixed until the target returns within tolerance or regains its original faction. When several policies apply, failure takes priority over withdrawal, which takes priority over suspension. Normal world and offer deadlines still apply. Live policy transitions run before that tick's objective checks and user story commands. Use [feasibility checks](#check-feasibility-before-offering-a-story) to hold publication of the offer itself.

`world/story-references` exposes observed identities, anchors, current issues, and adoption receipts. Pass `story` and optionally `reference` to narrow the report. `world/story-reference-target` takes both arguments and returns the accepted target's current position, faction, identity, and accessibility. Add an optional `from` agent handle to include its distance to the target. Missing, dead, and unadopted lifetimes have no live target. Story objectives and feasibility checks can read this field. The original `$role` binding continues to identify the authored cast.

Ink emits `story-reference-changed` events with the reference ID, change, policy action, disposition, and observed details. Event actions can act on the new target, for example by binding a new movement destination from `/target/position` on an adoption event. `sim preflight` lists the resolved watches. Checkpoints and recordings preserve the original identity, current target, and decisions. A closed story retains its final observation.

### Run the harbor handoff example

In [The Harbor Handoff](../examples/story-documents/live-passage.json), a dock and a pilot both move. Closing a passage suspends the story and reopening it resumes the work clock. The pilot then dies. Ink adopts a replacement under the same roster ID at its new generation, and the handoff objective records proof against that replacement.

```sh
node cli/ink-studio.js sim preflight examples/story-documents/live-passage.world.json --strict
node cli/ink-studio.js sim run examples/story-documents/live-passage.world.json --actions examples/story-documents/live-passage.actions.json --ticks 27 --record passage.run.json
node cli/ink-studio.js probe passage.run.json --ticks 9 --field world/story-references --args '{"story":"live-passage/escort","reference":"pilot"}'
node cli/ink-studio.js probe passage.run.json --field world/story-reference-target --args '{"story":"live-passage/escort","reference":"pilot"}'
node cli/ink-studio.js sim replay passage.run.json
```

## Negotiate an actor commitment

Add `lifecycle.commitment` to ask an actor to take an ordinary [agent order](agent-orders.md) when the story activates. Each commitment names one actor and one proposed order. The actor can come from a `$role` binding or template parameter. A generation pins the request to that actor's lifetime.

```json
{
  "actor": { "system": "crew", "agent": "mira", "generation": 2 },
  "activity": "dock-shift",
  "terms": { "reward": 8, "units": "coin" },
  "consider": {
    "minimum-pay": {
      "when": { "path": "/terms/reward", "op": "gte", "value": 6 },
      "otherwise": "refuse"
    }
  },
  "order": {
    "id": "dock-dispatch",
    "task": "unload",
    "reservation": {
      "board": "booking",
      "require": { "crane": { "anyOf": ["crane"] }, "landing": { "anyOf": ["landing"] } }
    }
  }
}
```

Ink checks existing orders, assigned movement, shared travel, formations, and autonomous activities that the actor has committed to finish. Optional `activity` uses an activity assigned to the actor to check its [recurring shift and need condition](agent-needs.md). Ink uses the current completed tick and keeps the authored window, meter values, and condition in the decision report. The accepted order then runs under the usual order and reservation rules.

`terms` is author-defined JSON. Each named `consider` condition can read `actor`, `needs`, `activity`, `phase`, and `terms`. Use `otherwise: "refuse"` for a hard requirement and `otherwise: "defer"` for a condition that may improve. Story authors can route wages or other consequences through normal ledger actions.

| Response | What happens |
| --- | --- |
| Accepted | Ink starts the native order and grants the entire requested reservation bundle in the same tick, then activates the story. The next solver visit begins the order's work. |
| Deferred | The offer stays available and the original request retries automatically. Busy actors, unmet need or shift conditions, and unavailable reservation capacity can defer a request. The offer deadline runs while waiting. |
| Refused | Ink withdraws the offer with reason `actor-refused`. The report can name an unmet hard term, a replaced generation, an activity the actor lacks, or a closed reservation job. |

Manual offers start evaluation when a `world/story-transition` command requests `active`. Automatic offers request activation on their own. A withdrawal or deadline closes an offer before a pending attempt can dispatch. Older pending requests are considered first, with story IDs breaking ties. The order's reservation follows the native [whole-bundle allocator](job-reservations.md). A deferred attempt leaves the actor's order queue and the reservation board available for other work.

`sim preflight` lists resolved proposals under `commitments`. Use `world/story-commitments` with an optional `story` argument to inspect the proposal and latest decision. `story-commitment-decision` events report when the response or blocker changes. The `story-started` event includes the accepted order handle. To inspect an actor's current availability and activity terms separately, read the roster's `commitment-terms` field with `agent` and optional `activity` arguments.

An accepted commitment records the actor's roster, generation, and order sequence. If the story ends while that order is still pending, Ink cancels that exact order on the next tick and the native board releases its claims. The accepted decision and pending request survive checkpoints and replay.

### Run the dock dispatch example

The [dock dispatch template](../examples/story-documents/dock-dispatch.template.json) offers Mira eight coins for unloading medicine. The [commands](../examples/story-documents/dock-dispatch.actions.json) finish her stocktake, lower fatigue, wait through the closed shift, and release the occupied crane. The story accepts at tick 11 with both the crane and landing reserved. Changing the template's `rate` parameter to three coins makes her refuse the same proposal.

```sh
node cli/ink-studio.js sim preflight examples/story-documents/dock-dispatch.world.json --strict
node cli/ink-studio.js sim run examples/story-documents/dock-dispatch.world.json --actions examples/story-documents/dock-dispatch.actions.json --ticks 20 --record dispatch.run.json
node cli/ink-studio.js probe dispatch.run.json --ticks 8 --field world/story-commitments --args '{"story":"dispatch/unload"}'
node cli/ink-studio.js probe dispatch.run.json --ticks 11 --field booking/claims
node cli/ink-studio.js sim replay dispatch.run.json
```

## Delegate or hand off an active story

Add named proposals under `lifecycle.handoffs` on a story with an initial [actor commitment](#negotiate-an-actor-commitment). Each proposal has a successor `commitment` with the same actor, order, activity, and terms options as the original. Supply a continuation order for the unfinished work. Posted transfers, completed objectives, and the current stage visit carry forward.

```json
{
  "relief": {
    "stage": "transfer",
    "requires": ["staged"],
    "commitment": {
      "actor": { "$role": "relief" },
      "order": {
        "id": "finish-delivery",
        "task": "finish",
        "reservation": {
          "board": "booking",
          "require": { "lift": { "anyOf": ["lift"] }, "landing": { "anyOf": ["landing"] } }
        }
      }
    }
  }
}
```

Optional `stage` restricts the proposal to that stage. `requires` waits for the listed objectives in that stage to complete. An active story can request a handoff through an authored command or a normal event action.

```json
{
  "tick": 2,
  "action": "world/story-handoff",
  "args": {
    "document": "quay-relay",
    "story": "delivery",
    "proposal": "relief",
    "revision": 0,
    "reason": "change-of-watch"
  }
}
```

Read the current revision from `world/story-handoffs`. Revision zero identifies the initial assignment. A successful transfer increments it, so delayed commands for an earlier assignment are rejected. Up to 16 proposals and 32 successful transfers are supported per story. Deferred requests retry while the story and stage visit remain eligible. Use `world/story-cancel-handoff` with `document`, `story`, `revision`, and `reason` to cancel a pending request. Leaving the requested visit or closing the story cancels it.

Ink evaluates the successor's commitment against the completed world tick. Acceptance cancels the outgoing order by its exact roster, agent generation, and sequence, releases its claims, and issues the incoming order with its full reservation bundle. The native reservation board decides access and queue priority. A refusal or deferral keeps the outgoing assignment and its claims in place. Unrelated orders continue normally. If the story ends after a successful transfer, its cleanup applies to the current assignment.

`sim preflight` lists the resolved proposals. `world/story-handoffs` takes an optional `story` argument and shows the current assignment, revision, latest decision, and accepted transfers. The transfer records retained work from the outgoing native order. Completed objectives keep their original evidence and carry `credit` naming the assignment that was in effect when each objective was completed. `story-handoff-decision` events report changes in the response, `story-handoff-rejected` identifies invalid requests, and `story-handoff-accepted` carries the incoming order handle and new revision for event routing.

### Run the quay relay example

In [the quay relay](../examples/story-documents/quay-relay.json), Mira stages two crates. The handoff waits for that receipt, Niko's stocktake, and an occupied landing. At tick eight the whole assignment transfers. Niko delivers those same two crates from staging to the pier, and the completed visit credits each courier for their leg.

```sh
node cli/ink-studio.js sim preflight examples/story-documents/quay-relay.world.json --strict
node cli/ink-studio.js sim run examples/story-documents/quay-relay.world.json --actions examples/story-documents/quay-relay.actions.json --ticks 17 --record relay.run.json
node cli/ink-studio.js probe relay.run.json --ticks 7 --field world/story-handoffs --args '{"story":"quay-relay/delivery"}'
node cli/ink-studio.js probe relay.run.json --field world/story-lifecycle
node cli/ink-studio.js sim replay relay.run.json
```

## Settle costs and rewards through the world

Use `lifecycle.settlement.costs` for the first activation and
`lifecycle.settlement.outcomes` for named endings. Within each batch, name
each effect with a stable ID. The engine evaluates the effects in ID order
and commits the whole batch at once. The story can use bound roles and
template parameters in these effects.

| Effect | Native operation |
| --- | --- |
| `transfer` | Move an exact `amount` from `from` to `to` using exposed world accounts. Use it for money, inventory, or any compatible transfer resource. |
| `claim` | Require the current assignment to hold a claim on `board` and `pool`, with optional minimum `units` (default one). Include the reservation on the commitment order. |
| `work` | Require an outcome to use a retained `work-completed` objective receipt from `stage` and `objective`. Name the native `site` and `batch`, and optionally the contributing `actor` by roster, agent, and generation. The order and recipe perform the labor and consume its inputs. |
| `access` | Post a genuine single-use reservation `job` on a `board`. Optional `holder`, `at`, `leaseTicks`, `expires`, and `metadata` are native job fields. |
| `reputation` | Add a signed integer `delta` to a `subject`'s standing with a `faction` on a `social-ledger`. |
| `obligation` | Open a named `obligation` from `debtor` to `creditor` on a `social-ledger`. Provide a `terms` record for downstream rules. |

An unaffordable activation leaves the story available. When the story has a
commitment, the order, the reservation, and the costs commit together.
Automatic offers and pending commitments retry while they remain available.
Resuming from suspension preserves the original cost receipt. If a named
outcome is blocked, the story keeps its stage and objective receipts so
the ending can be selected again. Automatic ending branches retry on their
normal evaluation ticks. A story can use another ending in the meantime.
Applied costs persist when a story closes. To author a refund, attach a
reverse transfer to a named outcome.

The world posts settlement after the regular solver phases and before the
story transition. Account probes and the transfer ledger reflect the
posting on that tick. Orders and solvers can act on it on their next
scheduled step. `world/story-settlements` exposes the resolved definition,
applied costs and outcome, and latest blocker. Use `story-settlement` and
`story-settlement-blocked` with world event actions. Native transfer,
reservation, and social ledger events also remain available to those rules.

Declare a system of kind `social-ledger` with optional initial
`config.reputation` scores keyed by subject and then faction. You can
query `standing/reputation` with `subject` and `faction` or read the whole
table. Use `standing/obligations` to read the open and closed records. The native
actions `adjust-reputation`, `open-obligation`, and `resolve-obligation`
can also be called by other world systems and event actions. Resolve an
obligation with `{ "obligation": "<id>", "status": "fulfilled" }` or set
the status to `released`. The world records the close tick and emits
`obligation-resolved` for downstream rules.

The [harbor signal contract](../examples/story-documents/signal-contract.json)
uses a two-coin fee and two timber bundles to commission a signal frame.
The ending pays five coins after the worker finishes the batch, grants
priority yard access, raises harbor standing by three, and opens an
inspection obligation. The run also shows another visitor waiting while
the grant holder uses the reservation.

```sh
ink-studio sim preflight examples/story-documents/signal-contract.world.json --strict
ink-studio sim run examples/story-documents/signal-contract.world.json \
  --actions examples/story-documents/signal-contract.actions.json --ticks 14 \
  --record signal-contract.run.json
ink-studio probe signal-contract.run.json --field world/story-settlements \
  --args '{"story":"signal-contract/repair"}'
ink-studio sim replay signal-contract.run.json
```

## Catalog incidents

Add `incident` metadata to a story of kind `incident`. The catalog uses
the story's qualified `document/story` ID, title, summary, entry stage,
reference IDs, role slots, and triggers.

```json
"incident": {
  "category": "recovery",
  "intensity": 0,
  "tags": ["harbor", "supplies"]
}
```

Choose one of `setback`, `opportunity`, `visitor`, `discovery`,
`environmental-change`, and `recovery`. Intensity is an authored
integer from 0 to 5. Use 0 for a quiet beat. Tags are optional and
support up to 16 unique IDs. Incidents with older definitions appear
under `unclassified`. Their category and intensity are `null`.

List one or more documents with `story catalog`. Combine an exact
`--incident document/story` with `--category`, a comma-separated
`--tags` list, `--min-intensity`, `--max-intensity`, or `--text`.
Tag filters require all listed tags. Text matches the qualified ID,
title, summary, category, and tags without regard to case. The JSON
report gives the unfiltered `total`, matched `counts` by category,
and matching `incidents` in qualified ID order.

```sh
node cli/ink-studio.js story catalog examples/story-documents/harbor-pressures.json \
  examples/story-documents/harbor-encounters.json --category recovery --max-intensity 1 --tags harbor,supplies
```

World preflight lists the resolved catalog under `incidentCatalog`,
including expanded template instances and their template revisions.
Use the `world/incident-catalog` probe to add live status, matched
trigger details, and the last lifecycle transition. It accepts
`incident`, `category`, `tags`, `minIntensity`, `maxIntensity`,
`text`, and `status` as query arguments. In addition to the lifecycle
statuses, the catalog can show `registered` for a definition with no
trigger or lifecycle, `waiting` for a configured incident before it
opens, `pending` when a trigger matched and the offer has yet to open,
or `started` for a triggered incident with no lifecycle.

Authored event and state triggers, activation rules, feasibility, and
deadlines govern starts. Classification travels with story events in
`incident`, so a world event action can match `/incident/category` and
react to an entire class of incidents. Recorded events keep the same
metadata for analysis and presentation.

The [harbor catalog world](../examples/story-documents/harbor-catalog.world.json)
loads two documents and runs all six categories. You can welcome a
relief barge and unload its crates, or let its offer expire. The pantry
must recover and stay stocked before the quiet watch starts.

```sh
node cli/ink-studio.js sim run examples/story-documents/harbor-catalog.world.json \
  --actions examples/story-documents/harbor-catalog.welcome.actions.json --ticks 13 --record harbor.run.json
node cli/ink-studio.js probe harbor.run.json --field world/incident-catalog \
  --args '{"category":"visitor","status":"completed"}'
node cli/ink-studio.js sim replay harbor.run.json
```

## Queue incident opportunities

Add `lifecycle.candidate` to a catalog incident to queue it when its
trigger matches. Queueing records the original trigger evidence and
starts an independent lifetime in world seconds.

```json
"candidate": {
  "for": 0.4,
  "release": "automatic",
  "onExpire": "quay-followups/shallow-load"
}
```

Ink evaluates authored `lifecycle.feasibility` checks on each committed
tick while the candidate waits. A ready candidate can become blocked
when a route, account, worksite, or other sampled condition changes.
The initial trigger evidence remains in the receipt. Use feasibility
checks for conditions that should still hold at dispatch.

The default `release:"manual"` holds a ready candidate for explicit
selection. Send a scheduled `world/dispatch-candidate` command with
`incident` and `reason`. Rejected selections record the current queue
status. `release:"automatic"` dispatches a ready candidate after that
tick's explicit selections. Automatic dispatch orders ready candidates
by creation tick and then their qualified IDs. Dispatch opens the
native story offer and carries its passing feasibility report forward.
The story's activation policy, costs, commitments, and deadlines still
govern what happens after dispatch.

```json
{
  "tick": 5,
  "action": "world/dispatch-candidate",
  "args": {
    "incident": "quay-opportunities/repair-shift",
    "reason": "timber-replenished"
  }
}
```

Queue lifetime rounds up to world ticks. A candidate expires before
selection at its cutoff. An earlier story world deadline can end the
candidate first. Set `onExpire` to a local incident ID or qualified
`document/incident` to queue a follow-up. Give that incident its own
candidate policy and let the original expiry supply its trigger. It
receives a fresh lifetime and its own feasibility checks. An incident
instance gets one queue entry per run. Multiple expirations can point
to the same follow-up and the first creates it. Preflight rejects
missing targets, targets with independent triggers, and cycles.

World preflight reports compiled queue policies under
`incidentCandidates`. Probe `world/incident-candidates` for ready,
blocked, and closed entries with their latest check, deadline, and any
follow-up link. Pass an `incident` argument to inspect one entry. The
incident catalog includes its current queue status. Candidate records
survive checkpoints and replay, and changes emit
`story-candidate-queued`, `story-candidate-checked`,
`story-candidate-dispatched`, `story-candidate-expired`, and
`story-candidate-rejected`. Use those events in event actions and
`story events` reports.

The [quay demo](../examples/story-documents/quay-candidates.world.json)
changes the available timber twice before dispatching a repair shift.
A blocked barge option expires into a shallow-ferry alternative. A
separate survey window expires when it goes unused. Opening the deep
berth in time lets the original barge unload instead.

```sh
node cli/ink-studio.js sim run examples/story-documents/quay-candidates.world.json \
  --actions examples/story-documents/quay-candidates.actions.json --ticks 9 --record quay.run.json
node cli/ink-studio.js probe quay.run.json --ticks 3 --field world/incident-candidates
node cli/ink-studio.js sim replay quay.run.json
```

### Select from a weighted pool

Add `selection` to an automatic candidate policy to make the incident
compete for one dispatch per pool per world tick.

```json
"candidate": {
  "for": 0.3,
  "release": "automatic",
  "selection": { "pool": "relief-landing", "weight": 3 }
}
```

Each pool has its own draw. An eligible candidate's integer weight
from 1 to 1,000,000 gives it that many tickets. A zero-weight candidate
stays in the queue and can still be selected explicitly. The draw considers feasible candidates with positive weights. Expiration
and explicit dispatch run first.

Ink assigns tickets by queue age, then by qualified incident ID in
lexical order for equal ages. The algorithm uses the world seed, pool
ID, and tick to choose a ticket. A sole eligible candidate wins with
reason `only-eligible-candidate`. A draw with multiple eligible candidates
records `seeded-weighted-draw`. Other candidates stay queued and can be
reconsidered on the next tick.

Probe `world/incident-selections` with optional `pool` and `winner`
filters. Each receipt retains the algorithm, seed, tick, candidate set,
effective eligibility, assigned ticket ranges, draw, winner, and reason.
The winner's queue record also contains the receipt.
`story-candidate-selected` publishes it for event actions and recorded
story analysis. Checkpoint restore verifies the saved draw against its
recorded inputs.

In the [relief landing demo](../examples/story-documents/landing-selection.world.json),
the canal has three tickets and the ridge has one. A closed deep quay
and a zero-weight survey appear in the receipt. Changing the seed
selects a different destination for the same crate shipment.

```sh
node cli/ink-studio.js sim run examples/story-documents/landing-selection.world.json \
  --ticks 5 --record landing.run.json
node cli/ink-studio.js probe landing.run.json --field world/incident-selections \
  --args '{"pool":"relief-landing"}'
node cli/ink-studio.js sim replay landing.run.json
```

### Budget simultaneous incident commitments

Set `incidentPressure` on the world to cap the number of simultaneous
queue commitments and any named pressure dimensions.

```json
"incidentPressure": {
  "commitments": 2,
  "limits": { "danger": 2, "scarcity": 2, "social-tension": 1, "travel": 2 }
}
```

Author the incident's demand with `lifecycle.candidate.pressure`. The
units are relative to your world, and dimensions can use any stable
ID. Candidate loads and dimension limits use nonnegative integer
units up to 1,000,000. The optional commitment cap is 0–256. An omitted
cap leaves that measure open and it still appears in the usage report.

```json
"candidate": {
  "for": 1.2,
  "release": "automatic",
  "pressure": { "danger": 2, "travel": 1 }
}
```

Every dispatched queue candidate occupies one commitment slot from
its offer through active and suspended stages. Its authored loads
occupy the corresponding pressure dimensions for the same period.
A terminal transition releases the hold in the published world
snapshot. The queue can use that capacity on the next tick.

The queue checks budgets as well as native feasibility. Each successful
dispatch reserves capacity before the next manual or automatic choice.
Weighted draws use the candidates that fit at the time of the draw.
A candidate that exceeds any cap stays queued and can be reconsidered
until its deadline. A manual choice that exceeds a cap reports
`pressure-budget-exhausted`.

Probe `world/incident-pressure` to see the live holds, committed units,
limits, and remaining capacity. On `world/incident-candidates`, the
`pressure` check reports the candidate's requested load and the caps
that blocked it. Dispatch and rejection events carry the admission
receipt. Checkpoints restore holds from the incident lifecycle and
retain the queue's decision receipts for replay.

The [crossing demo](../examples/story-documents/pressure-shifts.world.json)
holds a rescue and a supply convoy at once. Once the convoy ends, the
remaining danger budget favors mediation. The ridge watch can dispatch
after the rescue commitment closes.

```sh
node cli/ink-studio.js sim run examples/story-documents/pressure-shifts.world.json \
  --ticks 10 --record crossing.run.json
node cli/ink-studio.js probe crossing.run.json --ticks 4 --field world/incident-pressure
node cli/ink-studio.js probe crossing.run.json --ticks 6 --field world/incident-candidates \
  --args '{"incident":"pressure-shifts/ridge-watch"}'
```

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

Add `"lifecycle": {}` to a story definition to track its state and transition reasons. When a trigger matches, the lifecycle marks the story `available`. With the default `"activation": "automatic"`, it becomes `active` on the same tick. Use `"activation": "manual"` to wait for a command. A lifecycle-enabled story without triggers becomes available on the first tick. The lifecycle probe returns `null` while a story waits for its trigger or world deadline.

| Current state | Allowed destinations |
| --- | --- |
| Waiting for the trigger | `available`, `expired` at a world deadline |
| `available` | `active`, `withdrawn`, `expired` |
| `active` | `suspended`, `completed`, `failed`, `withdrawn`, `expired` |
| `suspended` | `active`, `failed`, `withdrawn`, `expired` |
| `completed`, `failed`, `withdrawn`, `expired` | Terminal states |

For manual activation, `offerFor` specifies how many seconds an offer stays available and remains supported in version 1 story documents. Use [deadlines](#set-story-deadlines) to author and inspect the three clocks. An active or suspended story can expire explicitly through a command from the host or an event action.

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

## Set story deadlines

Add one or more clocks under `lifecycle.deadlines`.

| Clock | Settings | What time counts |
| --- | --- | --- |
| `world` | `{"at": 30}` | An absolute timestamp in simulation seconds since tick zero. It keeps running while the story is suspended and can expire the story before its trigger arrives. |
| `offer` | `{"for": 6}` | A window in seconds starting at the tick the story becomes `available`. Requires manual activation. Accepting the offer closes this clock. |
| `work` | `{"for": 12}` | A budget in seconds across all active intervals of the story. It starts at activation, pauses on suspension, and resumes with the same remaining budget. |

For example, an offer can stay open for up to six seconds, work can take up to twelve active seconds, and the whole story can have an absolute cutoff at world time 30.

```json
{
  "activation": "manual",
  "deadlines": {
    "world": { "at": 30 },
    "offer": { "for": 6 },
    "work": { "for": 12 }
  }
}
```

Dates and durations are positive seconds and round up to a whole simulation tick. Work charges the interval that just ended if the story was active at its start. The ticks that activate or resume the story start a new interval. Suspending spends the preceding active interval and pauses future ones. Use the existing `world/story-transition` command or event actions to suspend and resume.

At the cutoff tick, expiration takes precedence over a trigger, objective confirmation, or story command. If two clocks become due together, Ink records the world deadline first. The first expiration is terminal. A legacy `offerFor` can still be combined with the world and work clocks. Use one setting for the offer window.

The `world/story-lifecycle` probe shows each configured clock's status and remaining ticks once the story has an offer or an expiration. After a clock closes, its remaining ticks reflect the moment it closed. For stories using `lifecycle.deadlines`, automatic expiration stores a `deadline` receipt on the transition, reports it on the probe, and publishes it on `story-transition`. Event actions can match `/deadline/clock` to route a fallback. Checkpoints, forks, and replays preserve the clocks and their receipts.

### Fork The Harbor Watch

[The Harbor Watch](../examples/story-documents/harbor-watch.world.json) loses the tow offer at tick 6 and hits the pier survey's fixed tide deadline at tick 7, even while the survey is paused. The pump crew has two work ticks left at the shared checkpoint. Both forks resume on tick 9. Delivery on tick 10 completes the objective and closes the story. At tick 11, the work clock expires before objective confirmation. The transfer still reaches the crew, and the timeout cues the relief crew.

```sh
node cli/ink-studio.js sim run examples/story-documents/harbor-watch.world.json --ticks 8 --checkpoint harbor-start.json
node cli/ink-studio.js sim fork harbor-start.json --ticks 14 --actions examples/story-documents/harbor-watch-on-time.actions.json --record on-time.run.json
node cli/ink-studio.js sim fork harbor-start.json --ticks 14 --actions examples/story-documents/harbor-watch-at-cutoff.actions.json --record at-cutoff.run.json
node cli/ink-studio.js probe harbor-start.json --field world/story-lifecycle
node cli/ink-studio.js probe at-cutoff.run.json --field world/story-lifecycle
node cli/ink-studio.js sim replay at-cutoff.run.json
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

## Author autonomous and player-directed stages

Set `decision` on any stage with [stage progression](#branch-and-converge)
enabled. A questlet can use a different policy on each stage.

| Decision | How the stage advances |
| --- | --- |
| `{"mode":"autonomous"}` | All branches use `"auto":true`. Ink selects the first eligible branch by ID after world evidence and story commands have been processed. |
| `{"mode":"player"}` | An explicit `world/story-choose` selects an eligible branch. Use `world/story-select` first when that branch requires a typed choice. |
| `{"mode":"intervene","for":0.3}` | At least one branch uses `"auto":true` as a fallback. The active stage opens a window once a fallback meets its objective and child gates. During the window, explicit choices can select any eligible branch. If the window elapses, Ink tries the first eligible fallback by ID. |

An automatic branch must be able to satisfy its gates without a manual
objective or typed player choice. For example, a stage can use an optional
`choose` objective to unlock a player branch while its fallback waits on
inventory evidence. Existing arc branches with child gates can use
`"auto":true` without a decision policy.

A window first opens after the visit's entry tick. Ink checks readiness
after sampling world evidence and before processing story commands.
The opening tick accepts intervention, and the cutoff tick runs the
fallback after rejecting late player commands. Durations are in seconds
and round up to world ticks. Suspension pauses the window. A new visit,
including a return to the same stage, gets a fresh window and rejects
commands for the previous visit. Story deadlines still apply while a
stage waits. An elapsed fallback can retry an unsettled outcome when
world conditions change.

`story preview` lists the authored policies. `sim preflight` reports their
resolved tick durations. Probe `world/story-decisions` with an optional
`story` filter to inspect the current visit, window time remaining, typed
choices, and eligible branches. `selectable` also accounts for the visit's
policy and lifecycle. The `story-stage-entered` event includes the compiled
policy. Timed windows emit `story-decision-opened` and
`story-decision-elapsed`, which can drive event actions. The
`story-branch-chosen` event and retained visit identify progression by
`player`, `autonomous`, or `fallback`. Checkpoints retain the window and
closed visits for replay.

The [breakwater dispatch](../examples/story-documents/breakwater-watch.json)
waits for a native stock transfer, then offers two chances to intervene.
The normal route ships two crates to the pier. Taking both opportunities
lets the player approve a larger shipment to the night shelter. Native
event actions announce windows and broadcast the selected route.

```sh
node cli/ink-studio.js sim run examples/story-documents/breakwater-watch.world.json \
  --ticks 14 --record observed.run.json
node cli/ink-studio.js sim run examples/story-documents/breakwater-watch.world.json \
  --actions examples/story-documents/breakwater-watch.intervene.actions.json \
  --ticks 14 --record intervened.run.json
node cli/ink-studio.js probe intervened.run.json --ticks 4 --field world/story-decisions \
  --args '{"story":"breakwater-watch/dispatch"}'
node cli/ink-studio.js sim replay intervened.run.json
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

The world supports up to 256 objectives with a type or evidence rule. Each receipt must fit within 16,384 JSON characters. Use `select` to keep a query receipt focused on the fact it proves.

### Replay The Relief Crossing

In [The Relief Crossing](../examples/story-documents/relief-crossing.world.json), a shipment applies only two of the four requested crates, so the early branch choice reports both objectives pending. After the depot is replenished, the ledger confirms a full shipment on tick 5. A staffed worksite straightens the bent brace on tick 7. The scout and medic then cross the safety line, which the agent query confirms on tick 19. The resulting event closes the questlet on tick 20.

```sh
node cli/ink-studio.js sim run examples/story-documents/relief-crossing.world.json --ticks 32 --record relief-crossing.run.json
node cli/ink-studio.js probe relief-crossing.run.json --field world/story-lifecycle
node cli/ink-studio.js probe relief-crossing.run.json --field world/history --args '{"where":{"path":"/kind","value":"story-objective-resolved"}}'
node cli/ink-studio.js sim replay relief-crossing.run.json
```

## Use typed objectives

Set `type` and supply its `params`. Ink derives the proof rule from those parameters. An objective may use a type, its own `evidence` rule, or manual resolution. Typed results include the type ID alongside the reason and receipt in the lifecycle probe and resolution event.

| Type | Parameters | Completion proof |
| --- | --- | --- |
| `reach` | Agent `system`, `agent`, inclusive XYZ `min` and `max`, optional `generation` | The agent's published position is inside the box. |
| `acquire` | Qualified `account`, positive `amount` | The scalar account balance is at least the requested amount. |
| `deliver` | Qualified `from` and `to` accounts, positive `amount`, optional source `system` | One published transfer between those accounts applied at least the requested amount. |
| `observe` | One `event` or `state` rule using the evidence syntax above | The event or query matches the rule. |
| `build` | Construction `system` ID | The system publishes `construction-built`. |
| `negotiate` | Influence board `system` and `offer` ID | The board publishes `offer-completed` after the agreement settles. |
| `maintain` | A `state` rule and `for` in seconds | The condition holds for a continuous sampled interval. |
| `protect` | A `state` rule for a target's safety and `for` in seconds | The target stays safe for the interval. A known violation fails the objective. |
| `survive` | A `state` rule for an actor or party and `for` in seconds | The survival condition holds for the interval. A known violation fails the objective. |
| `choose` | An `options` map from stable option IDs to display labels | An explicit `world/story-select` command selects a known option on the active visit. |

Timed rules count elapsed time from the first matching sample and round up to a whole tick. A missing sample or suspension clears the pending interval. A false reading restarts `maintain` and resolves `protect` or `survive` as `failed` with a receipt of the observed violation. Completed intervals store their starting tick and elapsed ticks in `receipt.interval`. Pending windows appear in `flow.current.progress`. An objective's result is final for its visit.

Use `requiresFailed` on a branch to require specific `protect` or `survive` failures. Each listed objective is checked for failure in place of the usual completion check on that branch. All other requirements still apply. Use `requiresChoice` to map a choice objective to the option that opens a branch. The choice command takes effect once per visit and retains the selected option in its receipt.

```json
{"tick":20,"action":"world/story-select","args":{"document":"highwater-beacon","story":"relief","stage":"response","visit":1,"objective":"choose-route","option":"ridge","reason":"ridge-road-cleared"}}
```

### Define a custom objective type

Add a document-level `objectiveTypes` entry with a stable ID and one reusable `evidence` rule. An optional `match` map declares required per-objective parameters. Each parameter adds an equality check at the indicated JSON Pointer or path array on the event or selected query value. The base condition and all supplied parameters must match. Custom definitions travel with embedded story documents in checkpoints and recordings. Native systems and host-registered world systems can both publish the source event or query field.

```json
{
  "decode-transponder": {
    "evidence": {
      "event": {
        "kind": "transponder-read",
        "system": "crew",
        "where": { "path": "/data/verified", "value": true }
      }
    },
    "match": { "channel": "/data/channel" }
  }
}
```

Use that definition on an objective with `"type": "decode-transponder", "params": {"channel":"rescue"}`.

### Fork The Highwater Beacon

[The Highwater Beacon](../examples/story-documents/highwater-beacon.world.json) uses all ten built-ins and a custom transponder objective. Both forks start from tick 3. The ridge route records delivery, construction, a paid access agreement, a recovered power interval, and the chosen route. The other fork briefly breaks the seal, then restores it. The recorded violation opens the failure ending.

```sh
node cli/ink-studio.js story describe examples/story-documents/highwater-beacon.json relief
node cli/ink-studio.js sim run examples/story-documents/highwater-beacon.world.json --ticks 3 --checkpoint beacon-start.json
node cli/ink-studio.js sim fork beacon-start.json --ticks 24 --actions examples/story-documents/highwater-beacon-ridge.actions.json --record ridge.run.json
node cli/ink-studio.js sim fork beacon-start.json --ticks 24 --actions examples/story-documents/highwater-beacon-breach.actions.json --record breach.run.json
node cli/ink-studio.js probe ridge.run.json --field world/story-lifecycle
node cli/ink-studio.js probe breach.run.json --field world/story-lifecycle
```

## Nest questlets in an arc

An arc with `"lifecycle": {"progression": true}` can open questlets from the same document. Add `children.open` to any stage that opens them. Each questlet needs its own `lifecycle`, takes its start from that arc, and follows its authored automatic or manual activation policy. An arc can open a questlet from more than one stage. Each run keeps one instance of the questlet, so a later visit reuses its existing state and outcome.

```json
{
  "title": "Survey the two routes",
  "children": {
    "open": ["ford-report", "ridge-report"],
    "wait": { "any": ["ford-report", "ridge-report"] }
  },
  "next": {
    "use-ford": {
      "stage": "prepare-ford",
      "auto": true,
      "requiresChildren": { "ford-report": { "outcome": "clear" } }
    },
    "use-ridge": {
      "stage": "prepare-ridge",
      "auto": true,
      "requiresChildren": { "ridge-report": { "outcome": "clear" } }
    }
  }
}
```

- `children.wait.any` waits for at least one listed questlet to reach a terminal state. `children.wait.all` waits for every listed questlet. A stage can wait on children opened on an earlier visit.
- The terminal states are `completed`, `failed`, `withdrawn`, and `expired`. An absolute deadline can expire a questlet before it opens. An unfinished questlet continues independently after the arc moves on or ends.
- `requiresChildren` on a branch checks named outcomes, terminal statuses, or both. For example, require `{"status":"completed","outcome":"clear"}` on a success route or use `{"status":"expired"}` on a fallback. The wait group and existing objective requirements also apply.
- With `"auto": true`, Ink checks that branch after the tick's story commands. An active arc can take one automatic branch per tick, starting after its stage's entry tick. When several are eligible, the first branch ID in lexical order wins. Without a decision policy, an automatic branch needs a child wait or outcome condition. Manual `world/story-choose` commands use the same gates and report pending or mismatched child IDs when blocked.

In the `world/story-lifecycle` probe, `flow.current.children` shows the wait group's readiness and live child statuses. Each opened questlet stores its parent arc, stage, visit, and opening tick in `parent`. A closed arc visit and its `story-branch-chosen` event capture the relevant terminal child results observed at the decision. The snapshots stay fixed when a sibling resolves later. Checkpoints and replays preserve those links and snapshots.

### Fork The Lantern Pass

[The Lantern Pass](../examples/story-documents/lantern-pass.world.json) opens two survey questlets. One fork takes the ford as soon as its report clears. The other receives a blocked ford report and waits for the ridge to clear. Each route opens a supply delivery and a beacon check. Dispatch waits for both surveys, the delivery, and the beacon result.

```sh
node cli/ink-studio.js sim run examples/story-documents/lantern-pass.world.json --ticks 2 --checkpoint pass-start.json
node cli/ink-studio.js sim fork pass-start.json --ticks 14 --actions examples/story-documents/lantern-pass-ford.actions.json --record ford.run.json
node cli/ink-studio.js sim fork pass-start.json --ticks 14 --actions examples/story-documents/lantern-pass-ridge.actions.json --record ridge.run.json
node cli/ink-studio.js probe ford.run.json --ticks 11 --field world/story-lifecycle
node cli/ink-studio.js probe ridge.run.json --field world/story-lifecycle
```

## Clean up when a story ends

Use `lifecycle.cleanup` to name the resources a story should release when it completes, fails, is withdrawn, or expires. Each named rule targets one resource. Cleanup runs at the start of the next simulation tick, before that tick's commands and solver work. A suspended story can be explicitly withdrawn with `world/story-transition`.

| Target | Required fields | What cleanup does |
| --- | --- | --- |
| `claim` | Agent roster `system`, `agent`, `generation`, and order `sequence` | Cancels that pending reserving order. The reservation board releases its claims through the ordinary order lifecycle. |
| `offer` | Influence board `system`, `offer`, and `revision` | Requests withdrawal of that posting. Open offers return their escrow through the board. An already accepted order can finish under its accepted terms. List its reserving order separately if it should also be cancelled. |
| `site` | Logistics `system` and worksite `process` | Retires the process for the rest of the run and returns inputs reserved for the unfinished batch. A full destination leaves the refund pending until stock space opens. Completed batches and their outputs remain in the ledger. |

Add `keepOn` for terminal statuses or `keepOutcomes` for named outcomes that should keep the resource. Either match keeps the rule's target. Other world consequences, such as stock already delivered or a completed construction effect, remain part of the simulation.

```json
{
  "bench-claim": { "claim": { "system": "crew", "agent": "builder", "generation": 1, "sequence": 1 } },
  "public-notice": { "offer": { "system": "notices", "offer": "camp-help", "revision": 1 } },
  "temporary-yard": {
    "site": { "system": "workshop", "process": "frames" },
    "keepOutcomes": ["permanent"]
  }
}
```

Read order generations and sequences through the roster and reservation probes. Read offer revisions through the influence board's `offers` field. Cleanup skips a missing target or a replaced generation or revision. Rule IDs execute in lexical order within each story.

Probe `world/story-lifecycle` for the scheduled tick and each rule's `pending`, `kept`, `applied`, or `skipped` result. Actual attempts emit `story-cleanup-resolved` with their target and reason. Native events and probes report the resulting order cancellation, claim release, offer withdrawal and site retirement. The site probe includes `retiredAt` and `refundPending`. Checkpoints and replays preserve pending rules and their results.

### Fork The Canal Camp

[The Canal Camp](../examples/story-documents/canal-camp.world.json) forks from a held bench claim, a funded public notice, an unfinished frame, and a delivered bedding bundle. Withdrawing the story frees the bench, closes the notice, and retires the yard with its planks returned. The permanent-yard outcome frees the bench and closes the notice, and a second worker finishes the frame at the retained yard. The bedding delivery persists in both runs.

```sh
node cli/ink-studio.js sim run examples/story-documents/canal-camp.world.json --ticks 3 --checkpoint camp-start.json
node cli/ink-studio.js sim fork camp-start.json --ticks 18 --actions examples/story-documents/canal-camp-withdraw.actions.json --record withdraw.run.json
node cli/ink-studio.js sim fork camp-start.json --ticks 18 --actions examples/story-documents/canal-camp-permanent.actions.json --record permanent.run.json
node cli/ink-studio.js probe withdraw.run.json --field world/story-lifecycle
node cli/ink-studio.js probe permanent.run.json --field workshop/worksite --args '{"process":"frames"}'
```

## Connect a host runtime

A story can use Ink's [agent orders](agent-orders.md) and [world queries](headless-worlds.md#query-a-revision)
directly. A host can provide the simulation behind those same interfaces.
In a Node host, wrap synchronous, versioned capabilities with
`KIT.world.storyHosts.adapter({version:1, read, step, perform})` and register
the resulting factory through the normal world implementation options.

```js
const { runtime, storyHosts } = KIT.world;
const implementations = { 'story-host': storyHosts.adapter(capabilities) };
const run = runtime.create(world, { implementations });
run.advance(12);
const checked = runtime.replay(run.recording(), { implementations });
```

Use that implementation name as the system's `kind`. Its JSON config
can declare `initial` state, typed `fields`, named `operations`,
`events`, and transfer `accounts`. Implement the callbacks your config uses.

| Capability | Contract |
| --- | --- |
| `read(state, request)` | Sample `{field,args,target,tick,time}`. Return `{status:"ok",value}` of the declared type or `{status:"missing",reason}`. `unavailable` and `outside` are also valid miss statuses. |
| `step(state, clock)` | Return `{state, events?}` as the host advances. The clock contains `system`, `tick`, `time`, and `dt`. |
| `perform(state, request, clock)` | Apply a declared operation. The request identifies `operation`, `args`, interaction `service`, `attempt`, `actor`, `target`, and `verb`. Return `{status:"applied",state,receipt,events?}` or `{status:"blocked",reason,receipt}`. |

Fields use `number`, `vector` (XYZ), `boolean`, `categorical`,
`record`, or `records` (an array of records). An optional `selector:true`
passes the requested selector to the host. By default Ink resolves targets
to world points. Events are `{kind,detail?}` records with kinds declared
in the system config. A receipt supplies an `id` and optional `detail`
record. Ink stamps the host system, operation, interaction attempt, tick,
and applied or blocked status.

Callbacks evaluate immutable JSON snapshots. Return a proposed snapshot
from `step` or `perform` and keep external side effects outside the
callbacks. This lets Ink discard a failed tick and restore or replay a
checkpoint with the same implementation. Use an `onTick` callback to consume committed events when the host needs
to do something outside the simulation.

To run an operation from an order, author the usual `interact` step.
Bind the [targeted interaction](targeted-interactions.md#commit-effects)
to a declared host operation with an effect like
`{"action":"station/approve","args":{"amount":2}}`. The native interaction
still owns range, duration, access, and cancellation. Ink publishes
the committed host receipt in the interaction outcome and carries it into
the agent's order results. Story objectives can retain the interaction
event and receipt as evidence. A blocked operation preserves its refusal
receipt and leaves the host state untouched.

Declare optional accounts with the usual `resource`, `units`, and `type`
descriptors and optional `min`, `max`, and `at`. Put their opening values in
`initial.balances` under the matching account IDs. Ink's exact transfers can
then move resources between native and host accounts, including during
story settlement. Story documents can use the same account names in both
worlds.

[Bench Inspection](../examples/story-documents/bench-inspection.json) runs
the same questlet with an Ink transfer effect or with a host that publishes
an inspection receipt. Both verify the bench interaction and deliver two
approved parts through a native settlement transfer. The host setup and
callbacks are included in the [Node example](../examples/story-documents/bench-inspection.host.cjs).

## Analyze and present event recordings

Use `story events` to open a standalone event recording, a native run with
embedded checkpoints, or a checkpoint. It reads recorded activity without
running the originating simulation or loading its host implementation.

```sh
node cli/ink-studio.js story events inspection.run.json --format events --out inspection.events.json
node cli/ink-studio.js story events inspection.events.json --story bench-inspection/release --out analysis.json
node cli/ink-studio.js story events inspection.events.json --format markdown --out review.md
node cli/ink-studio.js story events inspection.events.json --format timeline --out timeline.json
```

An imported `ink-studio/story-events` version 1 file contains an `id`,
fixed timestep `dt`, inclusive `from` and `to` ticks, `coverage`,
`dropped`, and an `events` array. Give events unique IDs and write them
in tick order, retaining publication order within each tick. Rows have
`id`, `kind`, `system`, `tick`, and any event-specific JSON fields. Set
`coverage:"complete"` and `dropped:0` when the file covers the declared
span. Ink labels extraction from a saved run or checkpoint
`coverage:"retained"` because world history may have been filtered or
truncated. To record a full stream, collect `run.events` after each
committed tick via `run.advance(to, {onTick})`.

The report counts recorded transitions, branches, objectives, and
intervention windows, and retains the events and host receipts that
support the summary. A story filter also follows source event IDs in
recorded objective and trigger evidence. The Markdown view presents a
chronological transcript. Timeline export provides Ink scene `markers` and
`story-cue` events at the recorded tick times. Add the exported object
under `timeline` to drive presentation event actions using the source
event, story, branch, or outcome. This playback works in a world without
the original story document or host.

See the [imported relay recording](../examples/story-documents/bench-inspection.imported.events.json)
for a standalone input. Node and browser bundle hosts can use
`KIT.world.storyEvents.read`, `analyze`, and `timeline`.

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
