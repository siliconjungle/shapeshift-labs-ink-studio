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

## Run cancellable local jobs

```sh
ink-studio tasks run examples/task-graph-attractor.json --out attractor-tasks --resume --budget limits.json --progress
```

`--progress` writes newline-delimited task start and finish events to
standard error. Interrupting the command cancels the active process,
keeps the receipts already published, and exits 130. The next run can
resume from those receipts.

An optional budget file is a JSON object. An omitted limit uses the
default below. Hosted jobs always have budgets. A client can request
lower limits than its worker allows.

| Limit | Default | Scope |
| --- | ---: | --- |
| `jobMs` | 300,000 | Wall time for a running task graph |
| `taskMs` | 120,000 | Wall time for an individual task process |
| `heapMb` | 512 | JavaScript old-generation heap per task process |
| `logBytes` | 524,288 | Combined task standard output and error |
| `inputBytes` | 67,108,864 | Declared input assets and per-task inputs |
| `outputBytes` | 67,108,864 | Per-task staged output |
| `files` | 4,096 | File and directory count for an input or output set |

The runtime checks output growth during execution and checks the staged
tree again before publishing a receipt. A task deadline or resource
failure blocks its dependents. A job deadline stops the current task and
skips the remaining graph. The heap limit applies to JavaScript memory.

## Host a declared recipe

The worker operator installs a trusted task recipe and its declared
assets on the worker host. A submission names the registered manifest
ID, which includes the graph and each declared asset digest. Use the
same files on the client to reproduce that ID. A changed recipe or asset
requires a new registration. Worker recipes can run authored scene
code and should come from the worker operator. Submitters choose job
limits and the registered recipe through the authenticated endpoint.

On one machine, set the same private `INK_TASK_WORKER_TOKEN` in both
client and worker environments. Start the worker in one terminal:

```sh
ink-studio tasks serve examples/task-graph-attractor.json --out task-worker --port 8406
```

In the client terminal, inspect the registration and submit a job:

```sh
ink-studio tasks manifest http://127.0.0.1:8406
ink-studio tasks submit http://127.0.0.1:8406 examples/task-graph-attractor.json --wait
ink-studio tasks status http://127.0.0.1:8406 JOB_ID
ink-studio tasks fetch http://127.0.0.1:8406 JOB_ID explore review --out verified-sweep
ink-studio tasks cancel http://127.0.0.1:8406 JOB_ID
```

The worker runs jobs one at a time and queues up to eight more. Status
includes ordered events, a bounded log excerpt, and artifact receipts.
Completed jobs share the worker's on-disk cache. A fetch checks the
retrieved file or directory against the reported digest before publishing
it at the destination. The server retains up to 64 recent job records
in memory. A restarted worker can still reuse its artifact cache.

HTTP listens on loopback by default. Use `--host IP --tls-cert CERT
--tls-key KEY` to self-host on a network interface. Clients connect
using HTTPS and validate the server certificate.

The single-host demo generates an ephemeral token, starts a worker,
cancels a running job, exercises a deadline, and submits the nine-case
sweep twice to verify reuse. It downloads the sweep and its replay and
checks the selected frame byte for byte.

```sh
node examples/task-worker-demo.cjs attractor-worker-demo
```
