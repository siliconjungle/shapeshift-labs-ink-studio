# Headless solver networks

Author reusable stage definitions, connect their typed ports, and run a
set of branches against the same picture clock. Capture a native
checkpoint at a branch point and inspect fields, particles, and contacts
from the committed solver state. The resulting experiment can be
packed and replayed as one file.

```sh
ink-studio solver-network inspect mill.network.json --out contracts.json
ink-studio solver-network compile mill.network.json --out mill.model.json
ink-studio solver-network run mill.run.json --out bake
```

## Define and instantiate solver stages

Use a version 1 `ink-studio/solver-network` with an `id`, a
`numerics` record containing the native timestep `dt`, a
`library` of named definitions, and a `stages` table. A stage
references a definition with `use`. It may override individual
top-level keys in that definition's `config`. Supply complete values
for any overridden nested object. `schedule`, `contract`, and
`portQuantities` can also be set by the instance.

A definition names a native `kind` and its pinned `revision`.
Optional `ports.inputs` and `ports.outputs` declare the expected
type of particular ports. The compiler resolves the solver, checks
those expectations, and validates the network wires with the native
type and quantity rules. The inspection report lists each stage's
resolved ports, the order, and the [execution plan](simulation-execution-plan.md).

```json
{
  "format": "ink-studio/solver-network",
  "version": 1,
  "id": "trim-bench",
  "numerics": {"dt": 0.05},
  "library": {
    "trim": {"kind": "control", "revision": 1, "config": {"op": "scale", "scale": 1},
      "ports": {"inputs": {"value": "number"}, "outputs": {"value": "number"}}}
  },
  "stages": {
    "drive": {"use": "trim"},
    "trimmed": {"use": "trim", "config": {"scale": 0.5}}
  },
  "connections": [{"from": "drive/value", "to": "trimmed/value"}],
  "inputs": {"knob": "drive/value"},
  "outputs": {"meter": "trimmed/value"}
}
```

To reuse a definition across networks, add `format` set to
`ink-studio/solver-stage`, `version: 1`, and an `id` to the
definition. Save it as a JSON file and use `{"file":"trim.stage.json",
"revision":1}` in the library. A `simulation-model` stage can
instantiate a [native reusable module](simulation-modules.md).
Resolve its default model path relative to its definition and
model paths supplied by instances relative to the network.

`compile` emits a native [simulation model](simulation-models.md).
The network uses the same input and output aliases, connection
settings, tick-addressed commands, probes, and data sections as
that model. The network `revision` and `seed` default to 1.

## Checkpoint and branch on frame addresses

A version 1 `ink-studio/solver-network-run` names its network
with a relative `network` path or an inline definition. Use
`fps` and optional `simulationRate` as integers or exact rate
ratios. An explicit simulation rate must agree with the timestep.

Each branch has an inclusive end frame `to`. Use `frames` for
inspection and `checkpoints` for native checkpoint outputs. The
default inspection selects the end frame. A child specifies
`from: {"branch":"hold","frame":12}`. Ink saves that parent
checkpoint automatically and runs the child from it. The child
inherits pending native commands. To restore from a separate run,
use `from: {"checkpoint":"bake/checkpoints/hold/12.json","frame":12}`.
The checkpoint must match the compiled network and the frame's
committed tick.

The picture frame selects the last completed tick at the frame's
exact start time. A branch command maps its authored `frame` to
the first tick at or after that time, with frame zero mapping to
tick one for commands. A command must map to a tick after the
source checkpoint and at or before the branch's end tick. This
keeps the cut frame identical even when frames and ticks have
different cadences.

```json
{
  "format": "ink-studio/solver-network-run",
  "version": 1,
  "id": "open-or-hold",
  "network": "mill.network.json",
  "fps": 24,
  "branches": {
    "hold": {"to": 48, "frames": [12, 24, 48]},
    "open": {"from": {"branch": "hold", "frame": 12}, "to": 48,
      "frames": [12, 24, 48], "checkpoints": [48],
      "commands": [{"frame": 13, "input": "gate", "value": 0.9}]}
  },
  "inspect": {
    "water": {"kind": "field", "field": "basin/depth", "samples": {
      "line": {"from": [-1, 0, 0], "to": [1, 0, 0], "count": 21}
    }},
    "spray": {"kind": "particles", "field": "effects/frame", "path": "/particles"},
    "impacts": {"kind": "contacts", "field": "body/contacts"}
  }
}
```

Commands can also be a relative JSON file containing an array.
Each row names an exposed `input` and `value`, or a native
`action` and its `args`. The report records the actual committed
tick for each command and the hashes of the checkpoint artifacts.
Use the exported checkpoints with `sim resume` and `sim scrub`.

## Inspect and package the results

| Inspection kind | Result |
| --- | --- |
| `field` | Native grid, line, or point samples with units and each probe's availability. |
| `particles` | A typed point buffer. Use `path` to select a particle array and optional `unit` and `frame` to label its coordinates. |
| `contacts` | Native contact records with an optional `where` condition. |
| `probe` | A native query value with optional target `at`, `args`, and selection `path`. |

All requested frames report the exact picture timecode, committed
tick and time, named model outputs, and the captured inspections.
The run bounds tick work, checkpoint storage, and sample counts.

In a [simulation experiment](simulation-experiment-bundles.md),
add a run with `kind: "solver-network"`, the network run file
as `source`, and the generated `report.json` as `expected`.
The archive follows linked stage files, nested models, branch
command files, and source checkpoints. List additional output
checkpoints under `assets.checkpoints` to carry them for inspection.
Verification reruns the original branch recipe and compares its
inspection data and checkpoint hashes against the packaged report.

```sh
ink-studio project pack experiment.json --root . --out mill.project.json
ink-studio project verify mill.project.json
```

## Demo

```sh
node examples/solver-network/demo.cjs out/ceramic-mill
```

Ceramic Mill holds or releases a gate from the same checkpoint,
then compares the downstream water depth at matching frames.
The review also follows cart contacts and their spray particles.
The portable archive verifies both the branch recipe and
a continuation from the exported checkpoint.
