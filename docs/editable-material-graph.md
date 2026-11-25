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

`settings` carries native `time`, `seed`, `exports`, `assertions`, and `assetRegistry`, plus optional [shared material base settings](material-base-settings.md) in `base`, with optional `inheritance` rules and a named `primaryInput`. The document, graph scopes, and table entries accept optional `label` and `extensions` fields. Use namespaced keys in `extensions` for opaque JSON editor or plugin data. Saving preserves these values. Ink omits them when preparing the execution graph.

For example, a color output can keep its ID while its connection is rewired. Keep `color-result` in `graph.links` and update its `from` endpoint. The `baseColor` output, its exports, and the connection ID all remain addressable.

```json
"color-result": {
  "from": { "node": "fire", "port": "fired" },
  "to": { "output": "baseColor" }
}
```

Opening checks document structure and references. Executing additionally checks socket types, operations, dependencies, and that each output is bound. Existing version 1 graph projects still run as before and can be converted without altering the source. Ink rejects a document with a newer, unsupported version before writing it.

## Publish and edit reusable subgraphs

A subgraph publishes its graph inputs as typed sockets, with optional defaults, and its bound graph outputs as named sockets. The compiler derives each output type and physical quantity from the connected source. Publish an inline editable scope or reference a shared graph group file from multiple materials. An external publication can be pinned by revision and SHA-256.

Use `ink.editMaterialSubgraph(document, request, options)` to get a new document and the inspected subgraph. Pass `baseDir` for relative graph group files and `sourceFile` to include the editable file in navigation results. The original document remains available if an edit fails validation.

| Request `kind` | Fields and effect |
| --- | --- |
| `publish` | `group` and either `graph` (an editable scope) or `reference` (a group path or pinned reference). |
| `insert` | `node`, `group`, optional literal `overrides` keyed by input port, and optional `connections` keyed by link ID. A connection supplies `port` and `from`, such as `{"input":"accent"}`. |
| `override` | `node` and `overrides` keyed by port. Values use the published socket types. Disconnect a wired port before setting a literal. |
| `reset` | `node` and optional `ports`. Remove those local values or keyframes and use the definition defaults. Existing wires stay connected. An unwired required port still needs a value. |
| `replace` | `node` and the new `group`. Keep the node ID, input bindings, and link IDs. Replacement fails if bindings or connected output types and quantities are incompatible. |
| `inspect` | CLI request with `node` or `group`. In Node, call `ink.describeMaterialSubgraph(document, target, options)`. |

Use the optional `scope` array of group IDs for nested definitions. Inspecting a definition returns its source file, any nested group path within that file, revision information for external groups, and the typed interface. Inspecting an instance also reports which inputs use local values, wires, keyframes, and defaults. Edits apply to direct instances in the open document. Open an external definition's source to edit its contents.

Call `ink.publishMaterialSubgraph(file, document, { baseDir, revision })` to publish the material's root scope as a reusable graph group file. Expose shared data as explicit typed inputs. The publication keeps relative nested dependencies portable and returns the typed interface and pin metadata. Use a new filename for a revised publication.

```sh
node examples/material-subgraphs/demo.cjs /tmp/ink-glaze-library
ink-studio graph subgraph /tmp/ink-glaze-library/glaze-library.material.json /tmp/ink-glaze-library/inspect.json
ink-studio graph subgraph /tmp/ink-glaze-library/glaze-library.material.json /tmp/ink-glaze-library/replace.json --out /tmp/ink-glaze-library/replaced.material.json
ink-studio graph run /tmp/ink-glaze-library/replaced.material.json --out /tmp/ink-glaze-library/replaced
```

Open `demo.html` in the demo directory to compare the rendered combinations. It previews graph runs from two instances with independent pigment settings and replacements.
