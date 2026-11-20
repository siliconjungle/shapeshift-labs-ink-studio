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

Pass the result of `session.scene(world)` to the existing renderer. A contribution hit from that renderer can go back into `session.pick` to select the corresponding record in the chart, map, and table projections.
