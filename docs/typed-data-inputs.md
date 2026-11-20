# Typed data inputs

Declare named datasets in the top-level `dataInputs` catalog of a diorama or simulation world. The renderer, scene parameter bindings, and simulation queries share the same dataset readers. Loading validates the declared types before values reach the scene.

| Dataset setting | Purpose |
| --- | --- |
| `kind` | `table`, `series`, or `spatial`. |
| `format` | `json` is the default and reads an array of row objects. `csv` and `tsv` read a header followed by records. Spatial inputs also support `geojson`. |
| `data` or `file` | Inline data or a local text file relative to the declaring scene. Use raw text for CSV and TSV. JSON and GeoJSON accept objects or JSON text as appropriate to the format. |
| `columns` | Map source column names to type, units, and missing-value policy. A geometry-only GeoJSON dataset uses an empty map. Use a column’s optional `source` to read a differently named header or property. Extra source columns are ignored. |
| `key` | Optional column of unique string or numeric row keys. GeoJSON uses feature IDs when no key column is supplied. |
| `time` | Required for `series`. Selects the clock and its sampling policy. |
| `coordinates` | Required for `spatial`. Declares the source coordinate reference system and its transform to world XYZ. |

## Types, units, and missing values

Columns accept `number`, `integer`, `vec2`, `vec3`, `boolean`, `string`, and `timestamp`. Numbers, safe integers, and vectors require a `units` label. Use `1` for dimensionless values. Delimited vectors use a JSON array inside the cell, and booleans use `true` or `false`. Timestamps use a UTC date and time ending in `Z`, with optional milliseconds.

Rows preserve the source units. A sample can request compatible output units with `units`. Built-in conversions include length, time, speed, mass, pressure, temperature, angle, and ratios. Opaque unit labels are retained and can be sampled as declared. Converted numeric values can have fractional results.

A column's optional `missing` record accepts a `mode` and `tokens`. Use `error` to reject a missing cell, `null` to retain the gap, or `default` with a typed `value` to fill it. The default mode is `error`. Absent and null JSON fields, empty delimited cells, and configured sentinel tokens are missing. Invalid values still produce a type error. Sampling a retained gap returns `missing`.

## Time series

Set `time.column` to a numeric column with time units or a UTC timestamp column. Keys must increase strictly. An optional `time.origin` maps an authored time to scene zero. Numeric clocks default to an origin of zero in source units. Timestamp clocks default to the first timestamp. The sampler uses seconds after that origin.

The default `time.interpolation` is `linear` for numbers and vectors. Integer, string, timestamp, and boolean columns hold their prior value. Use `step` to hold every column. A linear interval needs values at both endpoints. Outside the time range, the sampler returns `outside` by default. Set `time.outside` to `clamp` to hold the endpoint values.

## Spatial inputs

For Cartesian point rows, set `coordinates.crs` to `cartesian`, specify two or three distinct `axes` in source order, and list the matching numeric `columns`. Set `coordinates.units` to a length unit or `world`. An optional `origin` shifts the output in world XYZ. With length units, `worldUnitsPerMeter` scales the output and defaults to 1.

Geographic point rows support `OGC:CRS84` in longitude-latitude order, `EPSG:4326` in latitude-longitude order, and `EPSG:3857` in easting-northing order within the Web Mercator tile extent. These systems take a WGS84 longitude-latitude `origin` with optional ellipsoidal height in meters. A third coordinate column supplies height in meters after conversion from its declared units. Output axes are east, up, and north. [PROJ topocentric conversion](https://proj.org/en/stable/operations/conversions/topocentric.html) · [PROJ Web Mercator](https://proj.org/en/stable/operations/projections/webmerc.html)

GeoJSON uses `OGC:CRS84` and a declared origin. Point, line, polygon, multipart, and collection geometries retain their structure after projection. Two-dimensional geographic positions use the origin's height. Feature properties use the same column schema as tables. [RFC 7946](https://www.rfc-editor.org/rfc/rfc7946.html)

Use `$position` as the sample column to read a point in world coordinates. Sample by row, key, or `at` with world XYZ to choose the nearest Point. Optional `maxDistance` bounds that search in world units. The dataset's `features` array exposes all projected geometries and their typed properties.

## Read and bind data

- `KIT.dataInputs.prepare(catalog)` returns `describe()`, `get(name)`, and `sample({ dataset, column, ...selector }, sceneTime)`. A selected dataset exposes its normalized `rows`, metadata, and spatial `features`. Select a row with zero-based `row`, a declared `key`, a series `time` in seconds, or a spatial `at` point. Omit the selector on a series to sample the current scene time.
- `readDataInputs(file)` in Node loads a JSON document containing the catalog and resolves its relative files. Browser hosts can pass inline source data or use `KIT.dataInputs.embed(catalog, readText)` with an already loaded text resolver.
- In a parameter binding, a value with `source: "data"` accepts the same dataset and sample fields plus a typed `fallback`. A missing or outside sample uses the fallback. Live bindings use the scene clock. Baked bindings use the selected parameter bake time. [Shared parameter bindings](parameter-bindings.md)
- Use `query.probe('world/data', site, args)` in simulations and on baked dioramas. Put the dataset, column, and sample options in `args`. A site point or entity socket can supply the position for spatial sampling. Simulation checkpoints retain the resolved source content so playback can sample it independently of the original files.
- Use `ink-studio data-inputs <scene-or-catalog> [dataset]` to inspect the schema. Add `--rows` to export the typed rows and projected features, or use `--sample <JSON>` and `--t <seconds>` to inspect a sample.

Map dataset columns and simulation fields onto native splats while retaining the source record. [Data-bound visual marks](data-bound-marks.md)
