# Story documents

Use an `ink-studio/story` version 1 JSON document to author incidents, questlets, and arcs independently of any particular game or world. A definition describes stages, outcomes, and references. Ink's CLI checks the document and its links without stepping a simulation.

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
| Story | `kind` (`incident`, `questlet`, or `arc`), `title`, `entry` stage ID, nonempty `stages` and `outcomes` maps | `summary`, local `roles` map, `refs` |
| Role | `kind` | `ref` to a document reference of the same kind |
| Stage | `title`, nonempty `next` map | `summary`, `roles` as local role IDs, `refs`, `story` as a linked story ID in this document |
| Outcome | `title` | `summary`, `refs` |
| Reference | `kind`, `id` | |

Map keys are stable IDs. They are case-sensitive and start with a letter. The remaining characters can be letters, digits, underscores, hyphens, or dots, up to 100 characters total. Keep IDs when changing a title or reordering entries. Within a document, story IDs are unique. Stage, outcome, and role IDs are scoped to their story. A `next` ID is scoped to its stage and points to exactly one local target, for example `"delivered": { "outcome": "grain-delivered" }` or `"retry": { "stage": "collect" }`. The key identifies the branch. It does not execute a condition.

`refs` arrays contain IDs from the document's `references` map. Each reference pairs an authored kind such as `actor`, `place`, `scene`, `score`, or `patch` with an ID in the owning system. The ID can be slash-qualified, for example `river-valley/old-mill`. These are logical IDs. Resolve them in the tool that owns the corresponding data. A role with no `ref` leaves the identity open for later binding.

[Graph projects](headless-authoring.md#run-a-graph-project-from-the-cli) can read the validated file via `jsonAsset`. The [graph example](../examples/story-documents/inspect.graph.json) uses `data.get` to select the recovery arc through its stable ID. V1 defines authored documents and references. Trigger evaluation, branch selection, and simulation state belong to a later runtime.
