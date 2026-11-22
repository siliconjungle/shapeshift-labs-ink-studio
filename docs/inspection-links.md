# Shared beat inspection links

A beat ID addresses a committed event within a world and recording lineage. The
address `ink:beat:low-bank-sluice/main/4.2` names event `4.2` on branch `main`
of world `low-bank-sluice`. Forks preserve the IDs of inherited events and
give new events their own branch-qualified IDs. Replaying a recording keeps the
same IDs. When an edit uses a beat more than once, each placement has its own
time and shares the source beat ID.

## Run a linked example

From the Ink Studio checkout, build the Node target and generate the demo.

```sh
node scripts/build.js node
node examples/shared-inspection-links/demo.cjs ./sluice-demo
```

The demo follows the crew commitment at simulation tick 4. The graph observes it
at frame 4. The edit places it at frames 2 and 9, and both placements schedule
the amber preset in the rehearsal. The demo also renders the native world at
tick 4 and verifies a replay of that shot. In a second run it forks the decision
into two branches. `inherited.inspection.json` finds the original commitment in
both branches, and `fork.inspection.json` finds the consequence in just the
requested branch, even though both branches assigned the same local event ID.

From the demo directory, query the same beat against as many reports as needed.

```sh
ink-studio beat ink:beat:low-bank-sluice/main/4.2 \
  causal.json watches/watch.ndjson story.timeline.json edit.map.json \
  edit.timeline.json clip/report.json sluice-beat.json rehearsal.json \
  --out inspection.json
```

Each match contains a report path and a JSON Pointer to the exact row. NDJSON
matches also have a one-based `line`. Where available, matches include the source
tick, observed or edited frame, time, scheduled frame, and a relative path to
the retained image or preview. An empty pointer addresses the full document.
Paths are relative to the index file's directory, or to the working directory
when writing to stdout. The index lists reports without a match under
`unmatched`. The command exits with code 2 if none of the reports match.

## Produce linked reports

| Output | How to produce or find the link |
| --- | --- |
| Causal trace | Run `ink-studio trace recording.json world/cause --beat ID`. Enable causality in the world before recording the events you want to trace. |
| Graph watch | Watch a typed event log or world graph frame. Use `patch run --progress --out watches --keep > watches/watch.ndjson` after creating the output directory. The kept report and watch stream both carry the link. Save the stream in the output directory so its frame artifacts resolve relative to it. |
| Timeline | Use `story events --format timeline` for original event markers. In a clock map, write `"at": {"beatId": "ink:beat:low-bank-sluice/main/4.2"}` for a cue and use `take map --format timeline` to export its edited placements. Both the clock map and the timeline keep the cue's source event. |
| Rendered clip | Expose an event log or world graph frame as a graph output when running `graph clip`. The clip's `report.json` links each observed beat to a frame. It points to a numbered frame when retained, or to the APNG with its frame number. |
| Native still | Run `ink-studio sim render recording.json --beat ID --out still.png`. Ink replays through the event's original tick and writes `still-beat.json` beside the PNG. A checkpoint can substitute for the recording when it contains the beat at its saved tick. Use a recording to seek earlier ticks. |
| Rehearsal | Use the clock map as `cueMap` on the show and run `patch show --rehearse --report rehearsal.json`. Scheduled cue rows show `applied`, `superseded`, or `not-reached`. An applied preset reached the frame controls. Exposed event outputs also contribute `observed` rows. |

Rehearsal reports count dropped observations in `unlogged` when the observation
budget fills. Graph clip reports count omitted links in `omittedLinks`.

Events redacted for a faction or spectator carry an `ink:public-beat:` address
within that published stream. Those links resolve in reports from the projection.
Tracing or rendering a native event requires the native ID and its source data.

[World graph ports](simulation-output-adapters.md) · [Exact take clock](take-clock.md) · [CLI patch tooling](patch-tooling.md)
