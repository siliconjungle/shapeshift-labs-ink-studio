# Portable simulation experiments

An experiment is a versioned recipe and the files needed to reproduce its
results. Pack it with the same commands used for [dioramas and takes](project-bundles.md).
Packing keeps the authored files and their relative paths, records a SHA-256
digest for each file, and pins the Ink version, Node toolkit, and CLI runner
fingerprints. Seeds, numerical settings, and operator revisions remain in the
original [model](simulation-models.md) and solver inputs. A model checkpoint
reference brings the blocks reachable from its content-addressed store.

## Author a recipe

Paths are relative to the recipe and must stay within the project root. Named
assets organize materials for collaborators and can include additional files for
manual inspection. The packer also follows recognized run inputs, such as a
referenced model module, a mesh for a mode bake, or audio for a measurement.

```json
{
  "format": "ink-studio/simulation-experiment",
  "version": 1,
  "id": "sluice-release",
  "revision": 2,
  "assets": {
    "models": { "sluice": "../models/sluice.json" },
    "geometry": { "crossSection": "../geometry/channel.obj" },
    "references": { "survey": "../reference/levels.csv" }
  },
  "runs": {
    "resume": {
      "kind": "model",
      "source": "../models/sluice.json",
      "checkpoint": "../checkpoints/gate-closed.ref.json",
      "commands": "../inputs/open-gate.json",
      "tick": 12,
      "select": "/outputs",
      "expected": "../expected/outlet.json",
      "tolerance": { "absolute": 0.000001 }
    }
  }
}
```

`revision` defaults to 1. Increase it when you publish a changed experiment.
The optional asset tables are `models`, `geometry`, `inputs`, `references`,
`checkpoints`, `solvers`, and `notes`. Their named entries point to local files.

Each run names an ordinary Ink source document and a JSON expectation. Omit
`select` to compare the full result, or use a JSON Pointer to compare a
specific output, probe, array, or scalar.

| Run kind | Source and replay |
| --- | --- |
| `solver-network` | A [headless solver network run](solver-networks.md) with matched branch inspections and checkpoint hashes. |
| `model` | A versioned simulation model. Evaluate its outputs and probes at the absolute `tick`. Optional `commands` adds a JSON array of timed model input commands. Optional `checkpoint` resumes an inline world checkpoint or a checkpoint-store reference. |
| `modes` | A resonant-mode plan. Bake its modes from the packaged source geometry or analytic definition. |
| `native` | A built-in wave, mode, exciter, controller, lumped network, numerical solve, grid operator, state remap, or virtual sensor run. Sample counts and checkpoints belong to the solver document. |
| `measure` | A simulation measurement run with saved traces, WAVs, or built-in solver inputs. |
| `fit` | A parameter fit run with built-in candidate templates and reference inputs. |

Replay executes built-in solvers with declarative inputs. Custom solver files
may be carried as attachments for use with their original host after unpacking.
JavaScript integration and equation modules require that host.

Use an independently calculated value or an approved baseline for the
expectation. Array lengths, object keys, strings, and booleans compare exactly.
Numbers default to exact comparison. If specified, the accepted error is
the larger of the absolute tolerance and the relative tolerance times the
larger magnitude of the two numbers. A report identifies the first differing
path within the selected result for each run.

## Verify and share

```sh
ink-studio project pack recipes/sluice.json --root . --out sluice.project.json
ink-studio project inspect sluice.project.json
ink-studio project verify sluice.project.json --out verification.json
ink-studio project unpack sluice.project.json --out sluice-source
```

Move the packed JSON on its own to verify elsewhere. Verification checks
file digests before mounting the archive. Exit code 0 means all checks
matched, 2 indicates a failed check or an engine mismatch, and 1 indicates
invalid input. If you deliberately want to measure drift on a different
toolkit build, use `--compare-engine`. Its report still records both
fingerprints and whether they matched. Omit `--out` to print JSON on stdout.
Unpack into a new directory to edit the authored inputs and repack a new
revision.

From Node, call `verifyProjectExperiment(bundleFile, { compareEngine: false })`
to get the same result. Use `readProjectBundle(bundleFile).experimentDocument()`
to read the authored recipe.

Run `node examples/simulation-experiment-bundles/demo.cjs <output-directory>`
from an Ink checkout to generate and replay the sluice and membrane demo
archive. The demo also exports a review gallery and the membrane audio.
