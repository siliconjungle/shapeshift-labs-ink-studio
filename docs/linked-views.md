# Linked views and selections

`KIT.linkedViews.create(preparedDataset, options)` runs one clock, record filter, and selection for charts, maps, tables, and scenes. Pass a dataset from `KIT.dataInputs.prepare(…).get(id)` or the equivalent Node data-input loader.

Each record has a stable `ref` with `dataset`, `row`, and, where available, `key`. References resolve by key when supplied, with numeric and string keys kept distinct. All projections use the same references. Selection persists when its records leave the current filter or time window.

- `snapshot()` returns the immutable current revision with `time`, `filter`, `window`, `visible`, and `selection`. A series also reports `active` when the input can sample the current time.
- `update({ time, filter, window, selection, mode })` changes any subset atomically. The selection mode defaults to `replace` and also accepts `add`, `remove`, and `toggle`. Clear a filter or window with `null` and clear the selection with an empty list. Filters use world query conditions with `path`, `op`, and `value`, or nested `all`, `any`, and `not`.
- `subscribe(listener, { immediate = true })` observes committed revisions and returns an unsubscribe function.

## Time and projections

Time uses seconds. Typed series supply their own clock and origin. For a table or spatial dataset, pass a numeric `timeColumn` with time units and an optional `timeOrigin` in those units. `timeRange` is the extent in seconds when records have times. An optional `window: { past, future }` limits records to an inclusive interval around the current time. Each side defaults to zero seconds. Without a window, time still drives the scene provider and chart playhead.

The projection methods accept an optional session snapshot as their second argument. By default they read the current revision.

| Method | Result |
| --- | --- |
| `chart({ x, y })` | Numeric points with references and selection flags. The x axis can be `$time` for normalized seconds. |
| `map({ plane, coordinates })` | Typed spatial geometry projected onto `xz` (default), `xy`, or `yz`. Two numeric `coordinates` columns produce points when supplied. |
| `table({ columns, offset, limit })` | A paged row projection with total count, column order, references, and selection flags. |
| `scene(world, snapshot, { highlight })` | A renderable view that tints selected data marks and hides filtered marks and their anchored annotations. Unrelated scene geometry is preserved. |
| `pick(hit, { mode })` | Links a scene contribution hit to its visible source record and returns whether it was accepted. |

Use the same typed dataset ID and keys in the session and the scene's data mark layers. When a mark interpolates two records, its pick uses the current interval's source record. `KIT.linkedViews.diorama(spec, env)` returns a scene provider that samples an authored diorama at the session's nonnegative time. A caller can also supply a provider for its own renderer, camera, or simulation.

## Browser controls

Import `mountLinkedViews` from `webgl.mjs` and supply a host element and a linked session. Pass `panels` to select and order any of `scene`, `map`, `chart`, and `table`. A scene panel takes the toolkit and `scene: { world }`. The world can be baked or supplied by a function receiving the current snapshot. A chart panel takes a `chart` axis configuration. Use `map` and `table` for projection settings, `filterBy` for a categorical dropdown, and `timeRange` and `timeStep` to control the time slider. Set the optional `color(ref)` to style chart points and map features. The scene accepts renderer settings through `scene.frame` (a settings object or a function of the snapshot) and an RGB integer through `scene.highlight`. Use `controls` to hide the filter, time slider, or clear button and `labels` to rename panel headings and controls.

Style the shell and controls with CSS custom properties or `::part()`. Parts include `header`, `toolbar`, `panels`, each named panel and canvas, `filter-input`, `time-slider`, `table`, `row`, and `selected-row`. Supply a `stylesheet` string to add rules inside the shadow root. Set `defaultStyles: false` to supply the entire stylesheet. Chart and map paint reads `--ink-linked-plot-background`, `--ink-linked-grid`, `--ink-linked-muted`, `--ink-linked-point`, `--ink-linked-selection`, `--ink-linked-playhead`, `--ink-linked-series`, and `--ink-linked-plot-font` from each canvas. CSS can vary these per panel.

Click a record, chart point, map feature, or scene mark to select it everywhere. Drag across the chart to select an area. Shift, Control, and Command toggle records in the existing selection. The returned handle offers `render()` to refresh immediately and `destroy()` to release the renderer and subscriptions.


## Accessible encodings

Pass `encoding: { category, label, monochrome, categories }` to the mounted view. `category` names the grouping column, and `label` names the column used to announce a record. The chart and map use the same patterns and symbols, and the structured table uses the same swatches. `monochrome: true` uses a single fill color. The legend gives each encoding a text label, and repeated symbol-pattern combinations get visible number codes.

Each optional `categories` entry can supply a typed `value` and any of `label`, `pattern`, and `symbol`. Category encodings are assigned from the full dataset and stay stable while filtering and scrubbing. Use `session.encoding(options)` for a custom view. Its `entries` are the legend rows, `mark(ref)` returns the record's category encoding, and `name(ref)` returns its spoken label. Available values are listed in `KIT.linkedViews.patterns` and `KIT.linkedViews.symbols`.

Chart and map panels display both scale endpoints with their axis name and units. Override endpoint text prefixes using `chart.scaleLabels` or `map.scaleLabels` with `x` and `y` entries containing `min` and `max`. A table `caption` provides a name for the structured record view.

Tab to a chart, map, scene, or table record to use the keyboard. Arrow keys move the record cursor, Home and End jump to either end, Enter or Space selects the cursor, Shift toggles it in the current selection, and Escape clears the selection. The table follows the focused record across pages. Selection is announced with the record and its category, and the chart and map show a dashed focus outline.

Style the legend, swatches, focus outline, and endpoints with the `encoding-legend`, `pattern-swatch`, `scale`, and `scale-endpoint` parts and the `--ink-linked-pattern-fill`, `--ink-linked-pattern-ink`, and `--ink-linked-focus` properties. The `controls` options include `legend`, `scales`, and `keyboard`.
