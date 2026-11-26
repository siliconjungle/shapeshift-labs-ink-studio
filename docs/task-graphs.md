# Run native artifact tasks

Run a dependency graph of native Ink CLI jobs from one recipe.

```sh
ink-studio tasks plan examples/task-graph-attractor.json
ink-studio tasks run examples/task-graph-attractor.json --out attractor-tasks
ink-studio tasks run examples/task-graph-attractor.json --out attractor-tasks --resume
```

The example sweeps attractor controls, pins one candidate, and replays that
candidate without manual handoff. Run `tasks plan` to validate the
dependency order before rendering.

Each recipe has `format: "ink-studio/task-graph"`, `version: 1`, and a
`tasks` object. A task names a built-in CLI command. Use `shape`,
`mesh-topology`, or `export-glb` for geometry, `sim` for simulation
and recorded-run verification, `render`, `clip`, or `sweep` for
images, `shot` for image approval, and `project pack` or
`export-scene` for delivery. `graph` runs procedural graphs.
Inputs name files or directories relative to the recipe, or use
`{"task":"upstream-id","artifact":"artifact-id"}` to consume a named output.
Its outputs name files or directories relative to that task's own
artifact directory. Arguments are literal strings, `{ "input": "id" }`,
or `{ "output": "id" }`. Pass exactly one `--out` with an output
reference. Use output references for secondary files such as
`--record {"output":"recording"}`. Declare every file that can change
the result, including auxiliary inputs that the scene opens itself.
Use self-contained artifacts or relative internal paths when handing
directories between tasks. The runner launches Ink through the current
Node runtime without invoking a shell.

A task's cache key includes the Ink runtime, task definition, and file
or directory hashes of its declared inputs. Resume verifies the
outputs in each receipt. It reruns failed jobs, stale jobs, and jobs
with missing or altered outputs. A downstream task can reuse its
result if a rebuilt input has the same name and bytes. Independent
work can still run if another branch fails. Set `acceptExit: [0, 2]`
for a command whose findings are valid downstream artifacts. A task failure or blocked
dependency makes the task command exit 2 with a report. An invalid
plan or an output-directory error exits 1.

Each task writes its latest command log and publishes artifacts only
after validating every declared output. The overall report lists
completed, reused, failed, or blocked tasks and points to their files.
