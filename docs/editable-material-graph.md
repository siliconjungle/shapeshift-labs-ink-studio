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

Edit the returned records and call `ink.writeMaterialGraph(file, document, { baseDir })` to validate and atomically save the JSON. `baseDir` is the original directory of the relative resource, registry, group, and thumbnail paths. It defaults to the destination directory for in-place saves and new documents. Saving to a new directory rebases those paths and returns the saved document. External files remain separate and can be collected with Ink's project bundler.

To execute from disk use `ink.readGraphProject(file, { instance })`. To execute an edited object use `ink.createGraphProject(document, { baseDir, instance })`. Pass the resulting project to the usual plan, inspect, and run methods. CLI graph execution accepts `--instance ID`. Explicit runtime inputs override defaults from that instance. Use [multi-channel material ports](material-graph-ports.md) to pass a named set of maps through those graphs.

## Version 1 document

The top-level fields are `format`, `version`, `id`, and `graph`, with optional `resources`, `controls`, `instances`, `presets`, `settings`, and `metadata`. Each table is keyed by an ID. Display names live in the optional `label` field so renaming a label leaves references and output IDs intact.

| Table | Entry |
| --- | --- |
| `graph.nodes` | Native `op` and optional `group`, `type`, literal or animated `params` and `inputs`. A call to a group uses its node ID as its instance identity within the graph. |
| `graph.links` | Independent ID with `from: { node, port? }` or `{ input }`, and `to: { node, slot, port }` or `{ output }`. Node ports use their registered socket names. `slot` selects `inputs` or `params`. |
| `graph.inputs` | `{ definition }` wrapping a native input type string or socket descriptor. |
| `graph.outputs` | A link can target the output ID. Use `{ binding }` for a literal or animated output. An empty record is an editable pending output. |
| `graph.groups` | `{ graph }` for an inline graph with its own tables, or `{ reference }` for a native external group file or pinned reference. |
| `resources` | `{ definition }` wrapping a native graph asset definition such as `{ format: "png", file: "press.png" }`. Asset operations use the resource ID. |
| `controls` | Entries expose root graph inputs under stable IDs. Add [parameter presentation and defaults](#expose-and-reset-material-parameters) as needed. |
| `instances` | `{ overrides }` stores values keyed by control ID. An applied preset adds an exact comparison snapshot. |
| `presets` | Named parameter sets with a display label and typed values keyed by control ID. |

`settings` carries native `time`, `seed`, `exports`, `assertions`, and `assetRegistry`, plus optional [shared material base settings](material-base-settings.md) in `base`, with optional `inheritance` rules and a named `primaryInput`. Use [output usages](material-graph-ports.md#publish-material-output-usages) in `outputUsages` to bind previews and delivery files to graph outputs. The document, graph scopes, and table entries accept optional `label` and `extensions` fields. Use namespaced keys in `extensions` for opaque JSON editor or plugin data. Saving preserves these values. Ink omits them when preparing the execution graph.

For example, a color output can keep its ID while its connection is rewired. Keep `color-result` in `graph.links` and update its `from` endpoint. The `baseColor` output, its exports, and the connection ID all remain addressable.

```json
"color-result": {
  "from": { "node": "fire", "port": "fired" },
  "to": { "output": "baseColor" }
}
```

Opening checks document structure and references. Executing additionally checks socket types, operations, dependencies, and that each output is bound. Existing version 1 graph projects still run as before and can be converted without altering the source. Ink rejects a document with a newer, unsupported version before writing it.

See [Bitmap resources](bitmap-resources.md) for linked and embedded images, native precision, editable pixels, and sequence or tile policies.
See [SVG and vector resources](vector-resources.md) for editable path geometry, graph contour and mask nodes, and standalone SVG exports.
See [Font resources](font-resources.md) for linked and embedded TrueType faces, editable text layout, and font pins in published groups.

## Publish and edit reusable subgraphs

A subgraph publishes its graph inputs as typed sockets, with optional defaults, and its bound graph outputs as named sockets. A [reusable function graph](reusable-function-graphs.md) adds a single declared value result to that interface. The compiler derives each output type and physical quantity from the connected source. Publish an inline editable scope or reference a shared graph group file from multiple materials. An external publication can be pinned by revision and SHA-256.

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

## Describe and publish material metadata

Keep the existing `id` as the stable graph identifier and use `label` for its display name. Save the other catalog fields in the optional top-level `metadata` record.

| Field | Authoring value |
| --- | --- |
| `author`, `description`, `intendedUse` | Creator credit and text describing the material and its intended placement. |
| `tags` | Up to 32 distinct labels for search and filtering. |
| `userData` | Finite JSON for application-specific notes or fields. Workspace and local library cards include it. |
| `materialModel` | Model identifier such as `pbr.metallic-roughness` or `stylized.palette`. |
| `physicalDimensions` | Positive `width` and `height`, optional positive `depth`, and a `unit` of `mm`, `cm`, `m`, `in` or `ft`. |
| `thumbnail` | A relative PNG `file` and optional `alt` text. Library and publication previews support up to 1024 × 1024 and 2 MiB. Take bundles collect the referenced file. |
| `visibility` | Independent `library` boolean and `publication` state of `private`, `unlisted` or `public`. Workspace-only visibility is the default. |

Physical dimensions describe the intended real-world size of the material. Shared base settings drive texture sampling and delivery. The material's reported metadata is available in graph plans and snapshots, and editorial edits preserve execution and artifact identity.

Register material graphs as `graph` entries in a locked Ink asset registry. `ink.searchMaterialLibrary(registry, options)` uses the exact registered revisions and lets you search by label, author, description, intended use, model or tags. Use `audience: 'workspace'` to view drafts, `audience: 'library'` for library-listed cards, or `audience: 'publication'` for public cards. Use `ink.describeMaterialMetadata(file, { audience: 'publication' })` for an explicitly selected public or unlisted card. These audiences control catalog discovery and the fields included in the publication.

`ink.publishMaterialLibrary(registry, { out, query, tag, offset, limit })` writes one filtered page of the public catalog to a new directory. The portable index contains shareable metadata and relative paths to content-addressed thumbnail copies. The source graphs, local paths, and user data stay in the workspace. Use `limit` up to 128 and `offset` to select a page.

```sh
node examples/material-graph-metadata/demo.cjs /tmp/ink-station
ink-studio graph material-info /tmp/ink-station/graphs/verdigris-enamel.material.json
ink-studio graph material-library /tmp/ink-station/registry.json --audience library --tag Ceramic
ink-studio graph material-library /tmp/ink-station/registry.json --out /tmp/ink-station/public-cards
```

Run `graph material-library` without a registry file to browse the built-in [Material recipe library](material-recipe-library.md).

Use `graph material ... --metadata metadata.json --out material.json` to replace the authored metadata record. Thumbnail paths in that record resolve relative to the input material and are rebased when saving to another folder. Open `demo.html` in the demo directory to compare the catalog views and open their records.

## Show controls and ports conditionally

Set `visibleWhen` on a root control, graph input, or graph output. Inline subgraphs can use it on their declared inputs and outputs. These rules filter inspector presentation. Graph wiring, input values, exports and evaluation remain available.

```json
{
  "input": "glow",
  "label": "Glow strength",
  "visibleWhen": {
    "op": "and",
    "args": [
      { "op": "eq", "args": [{ "source": "input", "name": "finish" }, "enamel"] },
      { "source": "control", "name": "lamp-enabled" }
    ]
  }
}
```

Use `{ "source": "input", "name": "portId" }` for a declared graph input and `{ "source": "control", "name": "controlId" }` for a control's underlying input. References use their declared boolean, string, or numeric type, including supported numeric socket aliases. Use a primitive literal or `{ "literal": value }`. All rules return a boolean.

| Operators | Operand types |
| --- | --- |
| `and`, `or`, `not` | Booleans. The first two short-circuit runtime reads. |
| `eq`, `ne` | Two operands of the same scalar type. |
| `lt`, `lte`, `gt`, `gte` | Two numbers. |
| `add`, `subtract`, `multiply`, `divide` | Two numbers. Arithmetic rejects nonfinite results. |

Use `ink.inspectMaterialVisibility(document, { inputs, instance, scope })` for an editable graph, including drafts with offline resources. Supply values by graph input ID. Explicit values take precedence over instance overrides and declared defaults. An inline group `scope` is an array of group IDs. The result includes one visibility status per control or port. An error keeps its field visible, and the diagnostic gives the rule's JSON Pointer, failing subexpression path, code, and message.

Subgraph publication carries the port rules. Use `project.describeSubgraph({ node, inputs })` or `ink.describeMaterialSubgraph(document, target, options)` to inspect an instance. The inspector reads literals, defaults, and directly linked input defaults. Pass effective values by the instance's port IDs when bindings depend on evaluated nodes or keyframes. An unavailable value produces a diagnostic only for rules that read it.

```sh
node examples/material-conditional-visibility/demo.cjs /tmp/ink-signal
ink-studio graph material-visibility /tmp/ink-signal/signal-lens.material.json
ink-studio graph material-visibility /tmp/ink-signal/signal-lens.material.json --inputs values.json
```

Open `demo.html` to switch the finish and lamp, select visible output maps, and repair the example rule. The demo evaluates conditions in the browser with `KIT.procedural.graphVisibility.inspect`.

## Expose and reset material parameters

A control's table key is its stable parameter ID. The entry can specify a label, group, widget, default, units, limits, editing step, enum options, and display order.

| Field | Meaning |
| --- | --- |
| `input`, `label`, `group`, `order` | Bound root input ID, display label, inspector section, and nonnegative sort position. IDs break order ties. |
| `widget` | `slider`, `number`, `toggle`, `select`, `text`, or `json`. An omitted widget follows the socket type and any enum options. |
| `default` | Optional authored parameter default. This takes precedence over the socket default. |
| `units`, `min`, `max`, `step` | Display units, numeric limits, and the widget's edit increment. A slider needs both limits. Units fall back to the socket's physical quantity when present. |
| `options` | Ordered list of `{ label, value }` options for a select widget. The values keep their declared scalar type. |
| `visibleWhen` | An optional [typed visibility rule](#show-controls-and-ports-conditionally). |

Use `ink.editMaterialParameters(document, request, options)` to edit a copy of a graph. An `expose` batch maps parameter IDs to definitions. Bind an existing graph input with `input`, or promote a node input using `target: { node, port }`. Promotion captures the node's literal value or socket default and gives the new input and its connection stable IDs. Wired and animated ports require a separate authoring edit before promotion.

```json
{
  "kind": "expose",
  "parameters": {
    "colorway": {
      "input": "colorway", "label": "Colorway", "group": "Glaze", "order": 10,
      "options": [{ "label": "Coastal teal", "value": "coast" }, { "label": "Kiln copper", "value": "kiln" }]
    },
    "gloss": {
      "target": { "node": "shineWeight", "port": "a" },
      "label": "Gloss", "group": "Glaze", "widget": "slider",
      "min": 0, "max": 1, "step": 0.05, "order": 20
    }
  }
}
```

Use `{ "kind": "set", "instance": "kiln", "values": { "gloss": 0.7 } }` to create or update a named instance. A `reset` request takes the instance ID and an optional `controls` list of parameter IDs. With the list omitted, the instance uses its shared defaults again. Bounds and enum membership apply to authored defaults and instance overrides. Raw graph input bindings still use the graph socket contract.

`ink.inspectMaterialParameters(document, { instance, inputs })` returns ordered parameters with their type, current value, default, value origin and visibility. Runtime `inputs` are keyed by graph input ID. The browser toolkit exposes the same schema through `KIT.procedural.materialParameters.prepare`.

```sh
node examples/material-exposed-parameters/demo.cjs /tmp/ink-medallion
ink-studio graph material-parameters /tmp/ink-medallion/before.material.json /tmp/ink-medallion/expose.json --out /tmp/ink-medallion/batch.material.json
ink-studio graph material-parameters /tmp/ink-medallion/medallion.material.json --instance kiln
ink-studio graph material-parameters /tmp/ink-medallion/medallion.material.json /tmp/ink-medallion/reset.json --out /tmp/ink-medallion/default.material.json
```

Open `demo.html` to edit and reset the exposed controls against a live render of the same graph.

## Save and apply material presets

A preset is a named set of exposed parameter values on an editable material. Its table key is a stable ID. The label can change independently. Values are keyed by exposed control ID, including on graphs where the graph input has a different name.

Use `ink.editMaterialPresets(document, request)` for these edits.

| Request `kind` | Fields and effect |
| --- | --- |
| `save` | `id`, optional `label`, and explicit `values` or an optional `instance` and `controls` list. Captures the current available values. Saving an existing ID updates that preset. |
| `rename` | `id` and `label`. Changes the display name. |
| `copy` | `id`, new ID in `to`, and optional `label`. Creates an independent set. |
| `apply` | `id` and `instance`. Sets the preset's values on that instance and records the applied values for comparison. Partial presets leave other controls in place. |
| `import` | `bundle` and optional `replace: true`. Validates the complete package against the destination's exposed controls before committing any entries. Use `replace` to update matching IDs. |

`ink.inspectMaterialPresets(document, { instance })` reports compatible presets and the changed controls on one or all instances. Each control compares against the exact applied value when the preset covered it, or the current shared default otherwise. The report also indicates whether the current value differs from the shared default. Editing or replacing a preset leaves an instance's comparison snapshot in place until that preset is applied again. The parameter inspector includes the same per-control comparison for a selected instance.

Use `ink.exportMaterialPresets(document, { ids })` for a portable version 1 package. Omitting `ids` exports all sets. Another editable material can import them when the affected IDs, types, bounds and options are compatible.

```sh
node examples/material-parameter-presets/demo.cjs /tmp/ink-station-presets
ink-studio graph material-presets /tmp/ink-station-presets/station.material.json --instance hall
ink-studio graph material-presets /tmp/ink-station-presets/station.material.json --export /tmp/ink-station-presets/copper.json --presets copper
ink-studio graph material-presets /tmp/ink-station-presets/station.material.json /tmp/ink-station-presets/night-shift-presets.json --out /tmp/ink-station-presets/imported.material.json
ink-studio graph material-presets /tmp/ink-station-presets/station.material.json /tmp/ink-station-presets/apply-twilight.json --out /tmp/ink-station-presets/twilight.material.json
```

Open `demo.html` to apply a preset to either live graph instance and edit its gloss. The demo includes a sample import package.
