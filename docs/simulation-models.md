# Versioned simulation models

An `ink-studio/simulation-model` document packages the inputs and settings for
a fixed-tick simulation. Ink resolves the document into an ordinary world,
then uses the same runtime for direct runs, worker execution, checkpoints,
and replay. The [sluice model](../examples/simulation-models/sluice.json)
opens a gate at tick 5 and measures flow, downstream water depth, and the
mass balance.

```sh
ink-studio sim model validate examples/simulation-models/sluice.json
ink-studio sim model inspect examples/simulation-models/sluice.json
ink-studio sim model compile examples/simulation-models/sluice.json --out sluice.world.json
ink-studio sim run examples/simulation-models/sluice.json --ticks 12 --workers 2 --record sluice.run.json
ink-studio sim verify sluice.run.json
```

Run a model directly or run its compiled world. Both use the same tick
duration and seed. Run and replay reports include the named outputs and
probe results at the selected endpoint. Use [`sim plan`](simulation-execution-plan.md) to see
the resolved schedule, or `probe` to sample an individual world field.
[Boundary sets](boundary-conditions.md) share source and boundary laws with
finite-volume grids, wave networks, and moving-boundary world systems.

Use [headless solver networks](solver-networks.md) to instantiate reusable stage definitions and inspect matched checkpoint branches.

Use [simulation diagnostics](simulation-diagnostics.md) to check stability
and conservation of individual solver plans.

[Gesture scores](gesture-scores.md) publish overlapping timed targets
as typed controls for model operators.

[Input compilers](input-compilers.md) import editable timed events and
publish named curve values to model operators.

[Controllers and inverse targets](controllers-inverse-targets.md) can
close feedback loops or fit bounded model inputs to measured outputs.

[Virtual instruments](virtual-sensors.md) can turn native fields,
geometry and events into reusable measured outputs.

## Author a model

| Property | Contents |
| --- | --- |
| `format`, `version` | `"ink-studio/simulation-model"` and schema version `1`. |
| `id`, `revision` | A model ID and a positive integer revision. Publish edits as a new model revision. |
| `seed`, `numerics` | An explicit integer world seed and `{"dt":0.05}` for the world tick in seconds. Optional `blockSize` enables [sample-rate blocks](simulation-blocks.md). |
| `domain`, `parameters`, `initial`, `boundaries` | JSON records that hold the authored data. A model may leave any of these records empty. Individual operators define how they interpret the data wired into their settings. |
| `operators` | A named map of native system instances. Each has a `kind` and a pinned `revision`. Supply `config`, `schedule`, and `contract` as for a [world system](headless-worlds.md#compose-system-contracts). Put per-operator numerical settings here. Use [physical port quantities](physical-ports.md) to declare units and frames on named ports. |
| `inputs`, `outputs` | Named aliases of `"operator/port"` strings. An exposed input must be free of internal connections. Its type comes from the native port definition. |
| `probes` | Named records with a world `field` and optional `at` and `args`. Use an XYZ position, a point selector, or an entity/socket selector. Reads retain the normal world query status. |
| `connections` | Optional native world signal connections between operators. |
| `commands` | Optional inputs scheduled as records with `tick`, `input`, and `value`. Supply `id` to give a command its own stable label. |
| `world` | Optional `entities`, `visual`, `assetPacks`, and `metadata` carried into the compiled world. |

Use an object such as `{"$model":"/initial/water"}` as an operator setting,
world setting, or scheduled input value. The JSON Pointer reads from one of
the four authoring sections. A binding replaces the entire value at its
destination. An unknown section or missing key fails validation. For example,
the sluice passes its initial wet region to the water solver and uses the same
downstream coordinate for its outlet sensor throughout the run.

A take can point its `world` at a model file. Match the take's simulation
rate to the model timestep. `project pack` retains the model source with
the rest of the take, so the bundled take can run after relocation.

## Use the library

For custom typed-buffer solvers, see [creator-authored simulation kernels](simulation-kernels.md).

```js
const { KIT: { world: W } } = require('@shapeshift-labs/ink-studio').load();
const model = require('./sluice.json');
const run = W.runtime.create(model);
run.advance(12);
console.log(W.models.sample(run));
run.schedule([W.models.command(run.view().world, 'gateOpening', 0.1, 13)]);
run.advance(13);
```

Call `W.runtime.validate(model)` to check the document and resolve its
operator kinds, ports, and probes. The returned world holds the resolved
settings and operator pins. Store the original model for editing and the
ordinary run recording or checkpoint for exact replay.

A host can register a custom implementation with
`W.runtime.register(kind, factory, { revision: 2 })`. Different revisions
of one kind can coexist. Supply the pinned revision in every host that
loads the model or replays its checkpoint. Increment an operator's revision
when its numerical behaviour changes. Unpinned world manifests still use the
first registered implementation or their host override.

## Instantiate a model in a world

Use [reusable simulation modules](simulation-modules.md) to name one definition and place several instances with exposed parameters.

Add a `simulation-model` system. Reference the model relative to the
world file and supply its revision, or put the complete model JSON in
`config.model`. From the library, use
`W.models.system(model, { drive: ['gateOpening'] })` to build the system
record from an already loaded model.

```json
{
  "systems": {
    "sluice": {
      "kind": "simulation-model",
      "config": { "model": { "file": "sluice.json", "revision": 1 } }
    },
    "overflow": { "kind": "control", "config": { "op": "threshold", "threshold": 0.05 } }
  },
  "connections": [{ "from": "sluice/outletDepth", "to": "overflow/value" }]
}
```

Each instance keeps its own clock, seed, and checkpoint. It advances to the
last completed model tick at the current world boundary. Its named inputs
and outputs are ordinary typed world ports. Its named probes are available
as fields such as `sluice/outletFlow`, evaluated at the targets in the model.
The inner bodies, fields, and layouts stay in the model's domain. Publish a
port or a probe for the data a surrounding scene needs.

Unconnected inputs follow the model's authored settings and commands. A
connection drives its input during the model ticks covered by each world
step. List an unconnected input in `config.drive` to drive it with the host's
`world/input` commands. Driven levels take precedence over the model's
authored levels at those ticks. Event inputs queue until the next model
tick, and event outputs collect the events from all model ticks advanced by
that step.

The [sluice world](../examples/simulation-models/sluice.world.json) runs
at 10 Hz while the model runs at 20 Hz. The world checkpoint embeds the
resolved model definition, so resume and replay use the original definition
even after editing or removing the source file.

## Sample a model in a graph

Load the same file with `jsonAsset` and connect it to `sim.model`'s
`model` port. `value` contains the named outputs and probe results plus
the model ID, revision, and tick. Separate `outputs`, `probes`, and
`checkpoint` ports make those results reusable by other nodes. Add
`commands` as a full schedule of records with a named `input`, `tick`, and
`value`. A supplied `checkpoint` must belong to the model, and added commands
must follow the checkpoint tick.

The node samples the last completed model tick at the graph's time or take
frame start. Supply `options.tick` for an explicit model tick. It supports
backward seeks using the same checkpoint cache as
`W.models.session(model, { commands, checkpoint })`.

Use [common output adapters](simulation-output-adapters.md) to convert named
probes into typed field, trace, point, geometry, and media ports. `sim.model.events`
publishes the committed events at the selected tick.

## Run the same model four ways

The [sample graph](../examples/simulation-models/sluice.graph.json) and
[sample take](../examples/simulation-models/sluice.take.json) refer to the
same [sluice model](../examples/simulation-models/sluice.json). At the take's
frame 12, its embedded world and graph both reach model tick 12.

```sh
ink-studio sim run examples/simulation-models/sluice.json --ticks 12
ink-studio probe examples/simulation-models/sluice.world.json --field sluice/outletFlow --ticks 6
ink-studio graph run examples/simulation-models/sluice.graph.json --at 0.6
ink-studio take sample examples/simulation-models/sluice.take.json --frame 12
```

A take that directly uses a model as its world also reports the model's
named results in `take sample`. A graph node in a take runs its own model
instance. To compare it with a model driven by a world, feed it the same
input schedule. Portable take bundles keep the model files referenced
through both the world and the graph.

[Section measurements along a path](path-sections.md) provide geometry profiles
for models of ducts, valves and variable-width channels.

[Branched domains](branched-domains.md) assemble those profiles into a versioned
geometry graph with explicit junctions, cavities, reservoirs, ports and probes.

[Compiled discretizations](discretization.md) supply physical cells, oriented
faces, neighbors, and boundary regions for grid, chart, and mesh operators.

[Physical property measurements](mass-properties.md) provide mass, volume,
centres, inertia tensors, thickness and resolved material coefficients for
model bindings.

[Moving boundaries](moving-boundaries.md) turn socket and cloth motion into
aperture, sealing, and displaced-volume signals for solvers.

[Conservative state remapping](state-remap.md) transfers mass, heat and other
extensive channels across resolution and moving-boundary changes.

[Reduced simulation models](model-reduction.md) bake detailed sections, branched domains,
and sampled responses into smaller assets with recorded fitting ranges and error.

[General state integrators](state-integrators.md) provide fixed RK4,
semi-implicit Euler, adaptive RK4, and time-localized reactions for
creator-authored equations.

[Grid and mesh operators](grid-operators.md) provide field reconstruction,
tagged boundary application, and conservative finite-volume transport.

[Linear and bracketed nonlinear solves](numerical-solvers.md) add dense,
tridiagonal, and sparse matrix solves plus scalar root finding with
residuals and work limits.

[Lumped effort/flow networks](lumped-networks.md) compose storage, resistance,
inertance, springs, dampers, and sources with junction and energy balance.

[Distributed waves](distributed-waves.md) use measured variable-area
tubes for pressure and volume-flow propagation or faster delay guides.

[Contact samples and exciters](contact-exciters.md) publish reusable contact
geometry, impulses, slip and force from swept impacts and authored gestures.

[Resonant mode assets](resonant-modes.md) store authored, analytic, and
mesh-derived modes with spatial excitation and pickup sites.
