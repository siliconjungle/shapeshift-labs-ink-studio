# Music session experiments

Cross several kinds of musical decision in a saved Ink edit session.
Every eligible combination goes through the native session renderer at
the same listening addresses. Advance a range of options to longer
auditions, then record which heard edit you want to keep.

```sh
ink-studio music session experiment session.json brief.json --out review
ink-studio music session experiment session.json brief.json --scouts --out review
ink-studio music session keep-experiment session.json keep.json --out chosen
```

## Set the search

```json
{
  "id": "return",
  "goal": "Keep the call recognizable and test a later bass entrance.",
  "seed": 93,
  "focus": {"from": {"bar": 4}, "to": {"bar": 12}},
  "scout": {"from": {"bar": 4}, "to": {"bar": 6}},
  "context": {"from": {"bar": 2}, "to": {"bar": 14}},
  "roles": {"hook": "lead", "kick": "kick", "bass": "bass"},
  "axes": {
    "sound": [
      {"id": "plain"},
      {"id": "brittle", "family": "pluck", "revision": {"patches": {"lead": {"type": "fm", "index": 2.4}}}}
    ],
    "phrase": [
      {"id": "steady"},
      {"id": "withheld", "revision": {"cueMap": {"silence": [{"from": 16, "to": 17, "parts": ["kick", "bass"]}]}}}
    ]
  },
  "advance": {"limit": 3, "disagreement": 1, "diversity": ["phrase", "sound", "cue"]},
  "targets": {"hookDb": -2, "contrastDb": 10, "kickBass": 0.35}
}
```

Use any combination of `sound`, `phrase`, and `cue` axes. Each
named variant can hold an ordinary production `revision` or a list of
addressed session `edits`. Families group related variants such as three
attacks from one instrument build. A variant with only an ID is the
reference for that axis.

| Axis | Suitable edits |
| --- | --- |
| Sound | Replace a patch, tweak a connection, edit a note's articulation, or change release and room. |
| Phrase | Move a bass answer, remove an accent, replace a counterline, or give an existing line to another track. |
| Cue | Quote the hook in the approach, withhold the pulse, change the chord path, or leave space after the return. |

Forks apply sound, phrase, then cue to the same starting session. Later
edits use the normal production and session merge rules. All forks must
keep the same session clock and lanes. Use tracks already present in
the starting session for a handoff. Existing pins remain active. Naming
a score `hook` protects its scheduled onsets and pitches in the focus,
including the active comp. A recorded hook protects the active recording
selection. Explicit `locks` can protect another lane with
`{"lane":"bass","mode":"onsets","range":{...}}`. Modes are `onsets`,
`pitch`, and `all` for source material. The range defaults to the focus.
Sound treatments can still shape a hook with a different attack, gate
or release.

The scout defaults to the focus. Specify a shorter span to screen a brief
window before spending time on longer context. The context defaults to
the focus. Extend it to hear the lead-in and the aftermath. Up to 256
combinations can render, subject to the sample budget. Omit an axis to
leave that scale fixed.

## Read the shortlist

Each candidate records its axes, render path and screening result.
Invalid edits, pin violations, identical session recipes, inaudible scouts
and overloaded scout prints are screened. A cue branch with an identical
scout can still earn a slot because its lead-in or follow-through may
differ. Repeated full-context prints are identified in the report.

The quick checks use the actual mixed audio and optional post-fader
role taps. Hook exposure estimates hook level against the rest of the
mix during active hook frames. Routing and nonlinear master processing
can affect that estimate. The pocket check measures energy contrast and
bass activity at strong kick frames. With no bass or kick tap it uses
contrast alone. The report lists both measurements, their separate
ranks, and the first hook and kick windows at absolute sample addresses.
The targets express preferences for this search.

The engine fills context slots by family across the requested coverage
axes, in priority order. It reserves the requested number of slots for
cases where the two quick rankings differ. It fills spare slots by
combined score when there are too few distinct disagreements.
Full-context clips share a gain factor and preserve the session's
relative levels. The reference and the shortlisted clips remain available
at the same timeline addresses. The family coverage and staged render
budget are inspired by [MAP-Elites](https://arxiv.org/abs/1504.04909) and
[Hyperband](https://jmlr.org/papers/v18/16-558.html).

By default the experiment uses strict peak checking for the auditioned
range. This lets a causal desk stop after the scout on sessions with
default print normalization. Set `screen.allowNormalization` to true
to retain the original peak policy. A full print that uses normalization
may need to read beyond the listening range. Continuous processors follow
the normal session fallback. The compact report stores context audio
paths and optional scout paths when run from the CLI.

## Keep a heard decision

```json
{
  "report": "review/report.json",
  "candidate": "take-006",
  "reason": "The late bass leaves room for the pickup, and the kick still lands after the approach."
}
```

Keep recovers the exact candidate revisions and checks the starting
session, brief, assets, clock and locks. It saves a normal editable
`session.json` and a separate `decision.json` with the choice and reason.
The search does not choose a winner. Use the clips to make the editorial
decision.

The JavaScript methods are `editor.experiment(session, brief, options?)`
and `editor.keepExperiment(session, report, choice)` on a
[music edit session](music-edit-session.md). Supply `options.onScout(id, pcm)`
to consume each rendered scout as it arrives. Use
`music.experimentEditSession` and `music.keepSessionExperiment` in
headless graphs. The experiment node returns the report and named
full-context audio clips. A warm CLI stream also accepts
`{"op":"experiment","brief":{...},"out":"review","emitScouts":true}`.

## Tide Relay

```sh
node examples/music-production/session-experiment.cjs output --scouts
```

This runs twelve source-derived lead treatments against eight pockets
on the same eight-bar hook. A separate cue experiment holds one heard
treatment and pocket fixed while changing the approach. The example
writes both reports, each full-context listening clip, short comparison
reels and a reusable session and brief. `--scouts` adds all 96 full
return WAVs.

## Four-way performance ballot

Use a ballot to hear the current cue, a different lead source, a new
performance of the written lead, and accompaniment rebuilt around that
new performance. Start with the current editable session. The original
branch is that session as supplied.

```sh
ink-studio music session performance-ballot session.json brief.json --out review
ink-studio music session record-ballot review/review-key.json performance-ballot.json --out ballots
```

`brief.json` uses normal session addresses. Set `lead`, a listening
`context`, the first `call`, its later `recall`, and an optional shorter
`scout` within the context. `gapSeconds` controls the silence in the call
comparison. The full-context comparison plays straight through. Name the
accompaniment lanes and response and hook ranges in `accompaniment`
using the [performance arranger](music-edit-session.md#accompaniment-that-follows-a-kept-take).

Each of `sources`, `performances`, and `arrangements` accepts up to 24
named alternatives. Set `id`, `change` to describe the musical experiment,
and optionally `family` in each row.

- Sources supply a native instrument `patch`. They preserve the lead's
  existing gesture, echo and performance configuration, its scheduled
  onsets, and its accompaniment. The swap changes only the selected
  lead's instrument, even when other lanes use the same patch.
- Performances supply lead-only `edits`. Use `record-phrase`,
  `phrase-point`, `comp-phrase`, and `comp`. The written lead,
  instrument and accompaniment stay fixed.
- Arrangements supply a `return` of `exposed`, `withheld`, or
  `handoff` and optional arranger `settings` such as `bassMidi`,
  `returnMidi`, `metalMidi`, `withhold`, and `support`. They
  start from the exact new performance that advanced.

The experiment renderer auditions each family against its reference.
It screens invalid edits, inaudible scouts and over-level renders,
then checks the shortlisted prints in context. `advance` sets the
context budget per family from one to four. The technical ranking
selects representatives for the ballot. It does not judge what is
memorable or worth hearing again. The report keeps the scout and
context results, the advanced choices, and any context prints that
would repeat an earlier ballot branch after gain alignment.

Open `review/public/index.html` or share the whole `public` directory.
Each question shuffles its own A–D labels and matches its four excerpts
to a common integrated loudness under a true-peak ceiling. The browser
downloads a ballot with a favorite or a group of tied favorites and an
independent reason for each answered question. The archive checks the
token and the eight audio excerpts and keeps one submission per listener
per test. A repeat of the same submission is safe. The private key reveals
the labels, and `review/sessions` holds the four editable recipes.

Use `editor.performanceBallot(session, brief)` or the
`music.performanceBallot` graph operation. To validate a downloaded
ballot, use `mediaGraph.performanceBallot.archive(key, ballot, audio)`
or `music.recordPerformanceBallot`.

Run `node examples/music-production/performance-ballot.cjs output` to
reproduce the Blackwater comparison. An optional second argument points
to the earlier accompaniment demo's `source-session.json`.
