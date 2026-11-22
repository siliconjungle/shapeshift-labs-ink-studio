# Story camera and cutaway suggestions

Generate an editable shot plan from a verified native recording. Ink uses the
world pose at each committed beat to propose establishing views, two-subject
shots, detail inserts, and geometry sections where a sightline is blocked.

```sh
ink-studio story shots chartroom.run.json --out suggestions.json
ink-studio story shots-review chartroom.run.json suggestions.json --all --out review
```

The source can also be a story run bundle containing its native recording.
Pass an edited scene timeline with `--timeline editorial.timeline.json` to
start with the marker placements already in your cut. A reused marker can
produce several draft cuts from the same source event.

## Read the evidence

The shot plan lists each beat’s branch-qualified ID, source tick and timecode,
category, and draft editorial time. It resolves participants and locations
from committed subjects, custody object bindings, spatial event anchors, cast
roles, and nearby causal event references. Each subject records how it was
found and its XYZ position at the source tick. Framing uses authored visual
extents and attached geometry when available. Unresolved references stay in
`missing`. Beats without a resolved position have an empty shot list.

When the beat has two separated subjects, `relationship` gives their measured
XYZ delta and distance. The pair shot chooses an angle that keeps the
horizontal separation readable. Choice, outcome, commitment, and consequence
beats are tagged as turning points. The draft gives preference to beats with a
resolved subject, then to turning points when it reaches its beat limit.

| Candidate | What it frames |
| --- | --- |
| `wide` | The resolved group and setting. |
| `pair` | Two separated subjects from a side-on view where possible. |
| `insert` | The principal person, object, or location. |
| `section` | The insert with an editable clipping plane. A sightline probe identifies the foreground blocker and distance. |

Use `--story document/story`, inclusive `--from-tick` and `--to-tick`, and
`--limit` to focus the draft. The default limit is 12 beats and the maximum
is 24. Historical poses are sampled over the verified recording range.
A plan with edited markers checks each marker against its original event.

## Change the cut

Edit a beat’s `selected` to choose a candidate ID. Set it to `null` to leave
the beat out of the cut. Change `time` to place the cut in seconds, and extend
the plan’s `duration` as needed. Selected cuts use distinct times. When two
suggestions start together, the draft assigns the first cut and keeps the
other candidates available. Candidate poses and clipping planes are editable
using the native camera and cutaway settings.

```sh
ink-studio story shots-review chartroom.run.json edited-plan.json --out edited
```

Review writes a numbered `contact.png`, individual frames, and
`report.json`. The report gives each cell, source tick, edited time, and
rendered subject visibility. The same beat ID works with `ink-studio beat`.
Review samples the committed pose for each candidate, so moving a cut keeps
its source pose and evidence. Without `--all`, review renders the selected
candidates. Bigger reviews can use fewer beats or smaller frames.

`camera-rig.json` contains the editable poses and cut sequence. Apply or merge
it under `visual.cameraRig` for a world or `cameraRig` for a diorama.
The sequence uses the base camera before the first scheduled cut.
Section settings are exported under `cutaways/` for use as shot-specific
render overrides. The report carries the selected sections alongside their
cut times.

## Run the demos

```sh
node scripts/build.js node
node examples/story-camera-suggestions/demo.cjs ./chartroom-demo
```

The chartroom contact sheet shows a measured pair shot for the pilot and
keeper, plus a matched insert and section of a chart behind a cabinet door.
The editorial demo imports a moved choice marker, picks a different camera,
and moves the cut to 0.85 seconds while its preview still samples tick 5.

[Camera rigs](camera-rigs.md) · [Interactive cutaways](cutaways.md) · [Scene timeline export](story-scene-timeline.md)
