# Modeling benchmarks

Run a matched edit on an unchanged starting revision. People and agents
submit the same native source formats, get the same task brief, and see
their edits evaluated at 160 × 104 art pixels across three fixed views
or poses.

| Task | Starting document | Edit and evidence |
| --- | --- | --- |
| `gatehouse` | Painted portal scene with editable topology and a registered sign | Widen and bevel the arch. Measure contiguous clearance, visible bevel, sign registration and native color, and exact protected atlas texels. |
| `signal-coil` | Retained winding route and copper swatch | Reroute the winding over the service clamp. Measure clearance using the sampled path and its radius. Check both socket positions, route continuity, and the swatch. |
| `captured-prop` | Three registered RGB-D views of a harbor hatch | Fit an approved insert into the unmeasured lintel. Check the opening, measured face/UV links, and protected capture atlas texels. The synthetic fixture has a deliberate missing patch and conflicting depths. |
| `rigged-sleeve` | Textured mesh with two named skin joints | Grade the elbow weights while preserving the cuff attachments, rest topology and UVs, and the weave. Review the rest pose and two bends. |

## Start and submit an attempt

```sh
ink-studio modeling-benchmark prepare --out suite
ink-studio modeling-benchmark start suite gatehouse \
  --participant maker-1 --kind person --workflow current --tool-revision commit-or-build-id --out trial
```

Distribute each suite before revealing reference solutions. Give every
participant a fresh attempt. Read `trial/BRIEF.txt`, leave `trial/start/`
in place, and edit `trial/edit.json`. The run directory also contains
working copies of the hatch captures for local previews. Evaluation
uses the pinned companions from `start/`. The same suite prepared twice
on the same benchmark release has the same input revisions.

Use the existing [topology transaction API](mesh-topology.md) for the portal
scene. For the coil, edit the `route` document via the
[retained spline tools](curve-families.md#edit-retained-splines), then put it
back in the submitted JSON alongside `pigment`. Preview the hatch with
`ink-studio scan-fuse trial/edit.json --out trial/hatch.glb`. With the
sleeve, apply the [skin weight tools](mesh-topology.md#edit-and-pose-mesh-skin-weights)
to the `mesh` document, then put it back alongside `texture`.

```sh
ink-studio modeling-benchmark repair trial --target sign-anchor --note "Rebound the sign after editing the rim"
ink-studio modeling-benchmark finish trial --repairs-complete
```

Record one receipt per manual fixup, such as restoring paint,
rebinding an attachment, or repairing topology after the main edit.
Record ordinary edit steps through the authoring tools. Mark
`--repairs-complete` to confirm that the log is complete, including when
zero repairs were needed. Otherwise the report includes recorded entries
and leaves the full count unknown.

Submission time is wall-clock time from the start command to the final
finish command. It includes authoring, pauses, and author-run previews.
It excludes the benchmark's own scoring and capture time. If validation
fails, fix the submission and run finish again. Pass an optional JSON
path to submit a separate file. Successful submission freezes the JSON
and writes a report and an Ink review bundle under `trial/result/`. Each
bundle includes the native renders, zoomed views, pixel diffs, and protected
binding and paint evidence. A run can finish once.

Use participant IDs and `--kind person`, `agent`, or `script` to keep
the cohorts identifiable. Record the actual tool build or agent
configuration in `--tool-revision`.

## Review blind

```sh
ink-studio modeling-benchmark blind baseline-run trial --seats 4 --out blind
ink-studio modeling-benchmark score blind/review-key.json returned-ballots --out scores.json
```

Share only `blind/reviewers/` and assign one HTML file per reviewer.
The offline pages show the starting revision and each anonymous submission
at native size. An anonymous order rotates across seats. Each reviewer
scores brief fulfillment, native-pixel craft, and view or pose continuity
from 1 to 5, then downloads a JSON ballot. The coordinator retains the
private key and receives the ballots. Scores show coverage and per-criterion
means. A missing rating cohort stays unrated.

## Compare attempts

Create a version 1 comparison plan beside both run directories:

```json
{
  "version": 1,
  "baseline": ["baseline-run"],
  "candidate": ["trial"]
}
```

```sh
ink-studio modeling-benchmark compare compare-plan.json --scores scores.json --out comparison.json
```

Pair the same task and participant in both lanes. The comparison rejects
mixed starting revisions and baseline images for each task. Report
candidate-minus-baseline deltas for elapsed time, confirmed manual repair
count, lost and displaced bindings, exact paint and swatch retention, passed
checks, and blind review scores. Each mean includes its number of matched
pairs, grouped by participant kind. Keep unmatched attempts for inspection.

Use comparable machines and time rules within a pair. Alternate workflow
order across participants to account for practice. Pair agent settings
such as model and budget as part of the workflow design. Inspect task checks
and review scores alongside speed, especially when a faster attempt
leaves part of the edit undone.

## Run the demo

```sh
node examples/modeling-benchmark/demo.cjs modeling-demo
```

The demo produces four scripted reference edits, four unedited controls,
a comparison board, a blind review with empty ballots, and an exact
comparison plan. The recorded timings describe the demo process.
Human review scores become available after reviewers return ballots.

The Node SDK provides `prepareModelingBenchmark`, `startModelingBenchmark`,
`recordModelingRepair`, `finishModelingBenchmark`,
`buildModelingBenchmarkReview`, `scoreModelingBenchmarkReview`, and
`compareModelingBenchmarks`.
