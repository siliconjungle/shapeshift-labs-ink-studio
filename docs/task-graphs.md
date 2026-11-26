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
`tasks` object. A task names a built-in CLI command such as `render`,
`sweep`, `sim`, `graph`, or `export-glb`. Its inputs name files
relative to the recipe or an upstream task and its named artifact.
Its outputs name files or directories relative to that task's own
artifact directory. Arguments are literal strings, `{ "input": "id" }`,
or `{ "output": "id" }`. Pass exactly one `--out` with an output
reference. Declare auxiliary inputs even if the scene handles the
file reads itself. The runner launches Ink through the current Node
runtime without invoking a shell.

A task's cache key includes the Ink runtime, task definition, and file
or directory hashes of its declared inputs. Resume verifies the
outputs in each receipt. It reruns failed jobs, stale jobs, and jobs
with missing or altered outputs. Independent work can still run if
another branch fails. Set `acceptExit: [0, 2]` for a command whose
findings are valid downstream artifacts. A task failure or blocked
dependency makes the task command exit 2 with a report. An invalid
plan or an output-directory error exits 1.

Each task writes its latest command log and publishes artifacts only
after validating every declared output. The overall report lists
completed, reused, failed, or blocked tasks and points to their files.
