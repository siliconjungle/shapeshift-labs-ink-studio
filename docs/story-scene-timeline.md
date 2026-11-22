# Scene markers from a committed run

Use `story timeline` to turn committed narrative beats into an editable Ink
scene timeline. The export contains a `duration` and a `markers` array. Paste
it into a scene's `timeline`, add its markers to an existing cut, or reuse it
as a named sequence. The generated markers are presentation data.

```sh
ink-studio story timeline harbor.run.json --out harbor.timeline.json
ink-studio timeline harbor.timeline.json --from 0 --to 1.3
```

| Marker category | Recorded evidence |
| --- | --- |
| `arrival` | Arrivals such as `arrival`, `group-arrived`, and `population-arrival`. |
| `discovery` | Discovery events, discovery facts, and `custody-changed` when the operation is `discover`. |
| `argument` | Argument or dispute events and typed facts with those names. |
| `choice` | A committed `story-branch-chosen` or authored choice event. |
| `outcome` | A story transition to `completed`, `failed`, `withdrawn`, or `expired`, or an explicit outcome event. |

Use `--from-tick` and `--to-tick` to select inclusive committed ticks.
`--story document/story` matches the story reference on the committed event.
An arrival or discovery with its own world evidence may have no story
reference. The export keeps times on the original clock. Use a clip to
trim and reposition them.

Native run export verifies replay and reads each newly committed tick even
when the run disabled history retention. Earlier ticks in a checkpoint-based
recording and standalone checkpoints depend on the history they retained.
Fixtures, committed event logs, and portable story run bundles also work
within their recorded coverage. Each export supports up to 4,096 markers.

## Select authored beats

Pass `--plan marker-plan.json` to classify additional event kinds or rename
existing categories. Each rule names an event kind and can refine the match by
`system`, `story`, `stage`, `branch`, or an envelope condition under `where`.
The first matching rule supplies one marker for the event. Unmatched events use
the built-in categories.

```json
{
  "format": "ink-studio/story-marker-plan",
  "version": 1,
  "rules": [
    {
      "on": {
        "kind": "world-fact",
        "where": { "path": "/payload/fact/type", "value": "argument" }
      },
      "category": "argument",
      "label": "The crew disputes the signal route"
    },
    {
      "on": { "kind": "chart-checked" },
      "category": "review",
      "label": "The signal team reviews the causeway chart"
    }
  ]
}
```

## Edit without losing the source event

Change a marker's `time`, `label`, or `category`. Use seconds, an exact
`{ "numerator": n, "denominator": d }` coordinate, or a musical position
when its timeline has a tempo map. Adjust the timeline duration if a new
placement extends beyond it.

Ink uses a committed event's measured occurrence time when present and its
tick time otherwise. Each generated marker carries the original timecode,
tick, world, branch, and event reference in `source`. Its `beatId` resolves
from the original export, edited placement, and causal trace. A timeline
inspection reports the edited time and leaves the original source time intact.

```sh
ink-studio timeline edited.timeline.json --out placements.json
ink-studio beat ink:beat:lantern-harbor/main/5.2 placements.json
```

The library exposes `KIT.world.storySceneTimeline.replay(recording, options)`
for verified native replay and `project(source, options)` for recorded event
logs or retained checkpoints. The existing `story events --format timeline`
workflow also emits routable playback events when a scene needs them.

## Run the demos

```sh
node scripts/build.js node
node examples/story-scene-timeline/demo.cjs ./harbor-timeline-demo
```

The first demo exports a skiff arrival, chart discovery, argument, choice,
and outcome from a native run. The second adds an authored review marker
and places the same choice at 1.750 and 2.725 seconds in two clips. Both
placements link back to the original tick 5 choice.

[Unified scene timeline](scene-timeline.md) · [Shared beat inspection links](inspection-links.md)
