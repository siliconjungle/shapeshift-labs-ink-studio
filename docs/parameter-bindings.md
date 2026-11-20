# Shared parameter bindings

Use `parameterBindings` in a JSON diorama or `visual.parameterBindings` in a simulation world. A program declares `controls`, `values`, and `bindings`. Controls map names to authored defaults. Values map names to constants, source readers, or expressions. Each binding has a `parameter` name and a `path` as a JSON Pointer or an array of keys. Several paths can share one parameter. Bindings apply to the diorama after linked prefabs expand.

| Source | Fields |
| --- | --- |
| `control` | `name` selects an authored control. |
| `parameter` | `name` selects a control or another named value. |
| `time` | Reads scene seconds. |
| `field` | `field` selects a queryable world field. Optional `target` supplies an XYZ position or selector, and `args` supplies query arguments. |
| `signal` | `port` selects a typed simulation output or public port alias. |
| `data` | `dataset` and `column` select a typed input with a required `fallback`. [Typed data inputs](typed-data-inputs.md) |

Time, field, and signal readers require a typed `fallback`. Field and signal readers can use `path` to select a member from a record or array. Optional `keys` map increasing numeric inputs to output values using `linear` or `step` interpolation. The fallback is the output used when a read is missing or incompatible. Field and signal reads share one query snapshot for each sample.

An expression has an `op` and an `args` array with the operands. Use `add`, `subtract`, `multiply`, `divide`, `min`, `max`, `clamp`, `mix`, `abs`, `sin`, and `cos`. Arithmetic evaluates finite numbers and rejects cyclic dependencies. Primitive values and arrays are constants. Wrap an object in `literal` to use it as a constant.

## Dioramas

Bind material fields on `solids`, palette roles, motion tracks, scene light settings, and effects. Baked material and scene-light settings sample at build time. For a JSON render, `--params` supplies a JSON map of control overrides. The bake samples the requested `--t` when it is a single time, or zero by default. Set `--parameter-time` to choose a separate bake time for a still, sheet, or clip.

Motion track axes, amplitudes, timing, keys, and speeds update as the stage advances. Lamp position, range, strength, and flicker also update live. Rain rate and bounds, particle positions, counts, intervals, and spark direction and speed can be driven the same way. Zero lamp strength, rain rate, or particle count pauses that output. Effect types, attachment references, and settings such as emitter materials are resolved when baked.

`KIT.diorama.build(spec, { parameterInputs })` and the headless editor's `build(parameterInputs)` accept `controls`, `time`, and `query`. A query can be the current simulation query object or a function returning it. A baked diorama exposes `world.parameters.values()`, `setInputs({ controls, query })`, and `bake(parameterInputs)`. `setInputs` replaces the supplied control override map and query for subsequent stage updates. Use `bake` to refresh bound materials and other baked settings. The resulting splat world uses the ordinary headless and WebGL render paths.

## Simulation worlds and reusable programs

Simulation presentation resolves `visual.parameterBindings` from the selected tick. Paths address `visual` settings or an entity's `visual` record. The simulation continues to own entity and solver state. Supply host controls in the fourth argument to `KIT.world.visual` or with `--params` on `sim render`.

`KIT.parameters.prepare(definition)` also exposes `sample(parameterInputs)` and `apply(source, parameterInputs)`. These return the sampled names and, for `apply`, the document with its bound properties. The authored source is kept intact.
