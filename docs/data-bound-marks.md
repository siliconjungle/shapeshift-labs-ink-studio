# Data-bound visual marks

Declare named layers under `dataMarks` in a JSON diorama or `visual.dataMarks` in a simulation world. Marks are native scene splats with ordinary depth, compositing, and picking. Every mark retains a stable ID and the source record used to draw it.

## Sources

| Source setting | Behavior |
| --- | --- |
| `dataset` | Produces one mark for each row of a typed dataset. A declared row key or a GeoJSON feature ID identifies the mark. Otherwise the zero-based row index identifies it. |
| `dataset` with `sample: "time"` | Produces one mark from a series at the current scene time. Inspection includes both contributing records and the interpolation weight when applicable. |
| `field` | Reads rows or a keyed record from a simulation query. Use optional `at`, `args`, and `path` to select the collection. An optional `key` path identifies array entries across revisions. Record maps use their keys by default. |
| `limit` | Uses up to this many source rows in their original order. Scene layers share a budget of 20,000 marks. |

Dioramas use dataset rows or a sampled series as their source. A diorama built by an application can also sample fields for individual channels through `parameterInputs.query`. Simulation snapshots support field-backed collections and per-channel field queries.

## Encodings

Set the layer's `channels` to literals, column bindings, or field bindings. A column binding uses `column` and can request compatible `units` from a typed dataset. A field binding uses `field`, optional `path` to select part of the result, and optional `at`, `args`, and `units`. By default, field bindings after position sample at the mark's base world position. A position field can use an explicit point or entity selector.

| Channel | Value |
| --- | --- |
| `position` | World XYZ vector. Use a mapped vector or three component encodings. Spatial datasets default to their projected point. |
| `size` | Nonnegative size in world units. |
| `color` | Hex RGB string or RGB vector with components from 0 to 255. Scene palette settings still apply. |
| `opacity` | Fraction from 0 to 1. |
| `shape` | `point`, `disc`, `bar`, or `cross`. Discs face forward along +Z and bars run along the Y axis. |
| `motion` | World XYZ velocity per second, added to the base position using scene time. Use a mapped vector or three component encodings. |

Use `scale` with a numeric `domain` and two channel values in `range`. It interpolates numeric, vector, or color outputs and clamps by default. Set `clamp: false` to allow extrapolation. Use `map` for categories and `fallback` for a missing or invalid binding. At layer level, `missing: "skip"` keeps an unresolved mark available for inspection and leaves it out of the render. Use `missing: "error"` to reject unresolved marks. Zero size and opacity hide a resolved mark.

## Inspection

- `world.dataMarks.get(id)` and `world.dataMarks.list({ layer, offset, limit })` expose the retained records, resolved channels, and visibility status.
- Use `ink-studio probe <scene-or-world> --field world/data-mark --args <JSON>` to list a layer or inspect a mark by ID.
- Native contribution hits include `hit.dataMark` in Node, WebGL, and `ink-studio trace <scene> world/contributions`. The source record follows the same snapshot as the hit.
- Use `mark` and `markLayer` as render selectors for look rules and inspection. The object's group name is `dataMarks/<layer>`.
- The normal diorama scene clock updates live marks. Hosts advancing a browser scene can use the dirty rows from `world.anim.rows` for GPU uploads. Simulation marks use the selected snapshot's clock and fields.

Programmatic hosts can compile layers with `KIT.dataMarks.prepare(definition, { dataInputs })` and sample them with `program.sample(time, { query })`. The sample includes the resolved channels and the provenance available to the renderers.
