# Editable material graph

An `ink-studio/material-graph` document saves a graph's authored structure as versioned JSON. Its runtime uses Ink's existing typed graph operations, assets, and exports. A document can be reopened for editing while its texture is offline or its graph is unfinished.

## Open, edit, and save

```sh
node examples/editable-material-graph/demo.cjs /tmp/ink-glaze
ink-studio graph material /tmp/ink-glaze/legacy.json --id bellflower --out /tmp/ink-glaze/imported.material.json
ink-studio graph material /tmp/ink-glaze/review/bellflower.material.json
ink-studio graph run /tmp/ink-glaze/review/bellflower.material.json --instance kiln --out /tmp/ink-glaze/render
```

`ink.openMaterialGraph(source, { id })` takes a parsed material document or imports a version 1 graph project. It copies the input and, for a legacy project, preserves authored IDs and assigns deterministic IDs to its connections. Omitting `id` on legacy import derives an ID from the source document. `ink.readMaterialGraph(file, options)` does the same from a file.

Edit the returned records and call `ink.writeMaterialGraph(file, document, { baseDir })` to validate and atomically save the JSON. `baseDir` is the original directory of the relative resource, registry, and group paths. It defaults to the destination directory for in-place saves and new documents. Saving to a new directory rebases those paths and returns the saved document. External files remain separate and can be collected with Ink's project bundler.

To execute from disk use `ink.readGraphProject(file, { instance })`. To execute an edited object use `ink.createGraphProject(document, { baseDir, instance })`. Pass the resulting project to the usual plan, inspect, and run methods. CLI graph execution accepts `--instance ID`. Explicit runtime inputs override defaults from that instance. Use [multi-channel material ports](material-graph-ports.md) to pass a named set of maps through those graphs.

## Version 1 document

The top-level fields are `format`, `version`, `id`, and `graph`, with optional `resources`, `controls`, `instances`, and `settings`. Each table is keyed by an ID. Display names live in the optional `label` field so renaming a label leaves references and output IDs intact.

| Table | Entry |
| --- | --- |
| `graph.nodes` | Native `op` and optional `group`, `type`, literal or animated `params` and `inputs`. A call to a group uses its node ID as its instance identity within the graph. |
| `graph.links` | Independent ID with `from: { node, port? }` or `{ input }`, and `to: { node, slot, port }` or `{ output }`. Node ports use their registered socket names. `slot` selects `inputs` or `params`. |
| `graph.inputs` | `{ definition }` wrapping a native input type string or socket descriptor. |
| `graph.outputs` | A link can target the output ID. Use `{ binding }` for a literal or animated output. An empty record is an editable pending output. |
| `graph.groups` | `{ graph }` for an inline graph with its own tables, or `{ reference }` for a native external group file or pinned reference. |
| `resources` | `{ definition }` wrapping a native graph asset definition such as `{ format: "png", file: "press.png" }`. Asset operations use the resource ID. |
| `controls` | `{ input }` exposes one root graph input under a stable control ID. |
| `instances` | `{ overrides }` stores values keyed by control ID. Each instance uses the shared graph. |

`settings` carries native `time`, `seed`, `exports`, `assertions`, and `assetRegistry`, plus optional [shared material base settings](material-base-settings.md) in `base`. The document, graph scopes, and table entries accept optional `label` and `extensions` fields. Use namespaced keys in `extensions` for opaque JSON editor or plugin data. Saving preserves these values. Ink omits them when preparing the execution graph.

For example, a color output can keep its ID while its connection is rewired. Keep `color-result` in `graph.links` and update its `from` endpoint. The `baseColor` output, its exports, and the connection ID all remain addressable.

```json
"color-result": {
  "from": { "node": "fire", "port": "fired" },
  "to": { "output": "baseColor" }
}
```

Opening checks document structure and references. Executing additionally checks socket types, operations, dependencies, and that each output is bound. Existing version 1 graph projects still run as before and can be converted without altering the source. Ink rejects a document with a newer, unsupported version before writing it.
