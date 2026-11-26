# Share procedural splat attributes across render and export

Use `splat-attributes` to retain selections, remove isolated samples, transfer a weight field, and drive a shared deformation. The command emits an ordinary splat fit for Ink rendering and a typed attribute table for replay. A native `.inksplats` export reopens as a static scene with the fitted geometry and attributes already applied.

```sh
ink-studio splat-attributes inspect source.ply --out source-attributes.json
ink-studio splat-attributes plan source.ply plan.json --out fitted
ink-studio render source.ply --splat-fit fitted/fit.json --scan-appearance 1 --raw --out live.png
ink-studio splat-attributes export source.ply fitted --out baked.inksplats
ink-studio render baked.inksplats --scan-appearance 1 --raw --out reopened.png
ink-studio splat-attributes verify source.ply fitted baked.inksplats --views views.json --out review
```

Supply the same `--size` and `--up` when importing the source for planning, rendering, or export. A reopened export uses its stored scene coordinates. Source rows need unambiguous stable IDs. An imported cloud can derive these from owner and rest position. Give coincident source rows explicit IDs in the native scene if you need to edit them separately.

## Select and clean the rest cloud

The plan is a JSON object with `format: "ink-studio/splat-attribute-plan"`, `version: 1`, and optional `target: {"object": "gaussian-cloud"}`. Use `part` to narrow the object. Native columns include `position`, `opacity`, `pigment` as a packed RGB number, `normal` where available, `variance` as the covariance trace, and `object`, `material`, and `part` labels. Optional `attributes` names a typed splat table whose custom columns join by stable ID. A reopened export supplies its own retained table by default.

For example, pick an editable patch by material and height. The conditions in a selection must all pass.

```json
{
  "id": "sail",
  "where": [
    {"channel": "material", "equals": "enamel"},
    {"channel": "position", "component": 1, "min": 0.2}
  ],
  "exclude": ["finial"]
}
```

Place the object in `selections`. A condition can test `equals`, inclusive `min` and `max`, or `exists`. Use zero-based `component` for vector components. `ids` restricts a selection to named rows, and `exclude` removes named rows from it. The built-in `all` selection includes all editable rows in the target.

An `outliers` entry can specify `{"selection": "all", "radius": 0.2, "minNeighbors": 2, "protect": "pinned"}`. A sample is removed if it has too few distinct-position neighbors within the radius among editable rest rows in the same target. Define `pinned` as a selection to preserve intentional isolated marks. Omit `protect` for a rule without pins. Removed rows disappear from both the render and its shadow inputs. The report records each removed or protected outlier and its neighbor count.

## Transfer a weight and reuse it for deformation

Use a version-1 [geometry attribute table](headless-authoring.md#transfer-attributes-through-edits) as a donor. A transfer names a numeric channel with values between zero and one.

```json
{
  "id": "wind",
  "selection": "sail",
  "source": "cage-weights.json",
  "channel": "curl",
  "radius": 0.86,
  "neighbors": 4,
  "fallback": 0
}
```

Put the transfer in `transfers`. It samples up to 16 donor elements inside the radius in source scene units. Multiple exact matches contribute together. Other matches use normalized inverse squared distance and the donor channel’s declared interpolation rule. Missing or conflicting matches use the specified fallback. The receipts include donor IDs, distances, normalized factors, and fallback use.

A `groups` entry supplies a `selection`, an optional `weight` transfer ID or retained numeric column, a `pivot`, and the native bend, taper, or lattice `modifiers`. Groups follow the authored order and can also use [radial falloff](pixel-art-authoring.md#deform-a-retained-splat-group). A weight of zero pins the row in that group. The plan supports `rowEdits` by stable `id` for `position`, `orientation` as an XYZW quaternion, `scale`, or `opacity`. These run before groups. The same transform carries covariance, normals, footprint axes, and the rigid rotation of directional color into the renderer and the export.

The generated `attributes.json` retains custom values, `selection/<id>` membership, and `weight/<id>` columns. Named channels can be refreshed by a later plan on the reopened cloud. The exported table matches the compacted stable IDs and updates built-in geometry columns to their fitted values. Source and table digests protect against applying a plan to a different capture.

## Verify the exported cloud

The exchange stores static, textureless Gaussian rows, stable IDs, palettes, the native camera, supported normal and owner metadata, footprints, and up to four directional bands. It supports up to 32,768 rows. Plans can use up to 32 named selections, 16 weight transfers, and the native group limits. Live scene animation, external receivers, meshes, texture carriers, and authored scene looks are outside the exchange. Supply frame lighting at render time. Directional cast shadows use Ink’s ordinary opaque caster rules.

`verify` compares the native live-fit render and the independently reopened exchange. Give it an array of one to eight fixed views with `id`, `w`, `h`, `camera`, and optional `liveSun` settings. It checks the serialized payload, rendered RGB, coverage, depth, geometric normals, and cast shadows. The report also records which pixels the fit changed and how many RGB channels changed when directional color was enabled. It writes source, live-fit, and reopened PNGs for each view. A mismatch exits with status 2 and saves the evidence.

Replay the [Tide Vane demo](../examples/shared-splat-attributes/demo.cjs) for two views with moved shadows and fourth-band color. The demo removes four stray splats, retains intentional details, transfers cage weights, and checks the reopened export with the ordinary render command.

```sh
node scripts/build.js node
node examples/shared-splat-attributes/demo.cjs studio/tide-vane
```
