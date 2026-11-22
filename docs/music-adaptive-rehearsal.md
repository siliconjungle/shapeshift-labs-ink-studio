# Rehearse an adaptive score

Run an ordinary [adaptive production timeline](music-production.md#assemble-adaptive-transitions)
against paths someone could take through the world. Capture a late request, a
reversal before a reveal, a long dwell, and a cue that lands during the hook.
The same recorded requests, transitions, and cues play for every edit.
[Persistent performers and adaptive phrases](music-persistent-performers.md)
add held-note and listening-history evidence to the rehearsal.

## Capture a trace

```sh
ink-studio sim run scene.json --ticks 600 --record scene.run.json
ink-studio music rehearsal capture scene.run.json capture.json --out late.json
```

Set `capture.json` to a record such as
`{"id":"late-entry","label":"Arrive just after the bar","system":"score"}`.
The recording starts at tick zero and includes up to 24,000 ticks. Ink
replays it and checks its final checkpoint. Optional `end` restricts the
captured excerpt in seconds. The trace includes the entry section, exact time
and serial of every emitted music intent, world `audio-cue` events, and the
history of observed quantized requests. A request can commit, be cancelled,
or still be pending when the trace ends. Immediate transitions are already
represented by their emitted intent.

Use `music rehearsal capture-score timeline.json capture.json --out trace.json`
for a timeline with an `adaptive` score and timestamped updates. Set an
explicit trace `end` for standalone capture. Optional `worldEvents`
supplies audio cues with `cue`, `time`, `strength` and `duration`.

## Rehearse and compare

```json
{
  "traces": ["late.json", "reversed.json", "long-dwell.json", "latch.json"],
  "variants": [
    {
      "id": "held-handoff",
      "note": "Use the full phrase and let the A carry across the join.",
      "transitions": [{
        "from": "search",
        "to": "reveal",
        "exit": {"beat": 8},
        "bridge": "softer-pickup",
        "pickup": 0.26,
        "commonTone": {"segment": "held-a", "pickup": 0.18}
      }]
    },
    {
      "id": "clear-hook",
      "stingerRules": [
        {"resource":"latch-signal","section":"reveal","linked":false}
      ]
    }
  ],
  "options": {
    "sampleRate": 24000,
    "watchTracks": ["lead"],
    "before": 1,
    "after": 1.5,
    "limit": 8
  }
}
```

```sh
ink-studio music rehearsal run timeline.json suite.json --out review
```

The report includes an edge matrix with exercised and unexercised rules,
counts of cancelled and pending requests, dwell lengths, loops, and the
highest-priority cases. It links each selected case to time-aligned WAVs.
Set `options.cases` to an array of `{trace,id}` entries to revisit particular
cases. Comparison windows use the same absolute samples and a shared
loudness target with a peak ceiling. Each take lists nearby boundaries so
a moved loop or splice can be located within the same window. Use `target` in LUFS and `ceiling`
in dBTP to set playback. The rehearser accepts up to twelve traces and five
alternatives within its PCM budget. Keep cases short for fast auditions.

Inspect the flags alongside the clips. A score can choose to hold silence,
wait for a downbeat, or play a stinger over a note. The ranking uses concrete
signals such as measured gaps, local level changes, clipping and waveform
steps, plus score evidence such as quantization waits, a source jump at
an exit, and stinger or world cue times next to performed hook notes.
Leaving and entering pitches are estimated from performed note gates.
Hook proximity is a timing cue. Use `radius` to adjust its window.
Add the same [world score rules](music-world-score.md) under
`options.world` to hear each trace's percussion answers and score space.

## Keep the transition edit

Edit only the named parts of the timeline. A variant can merge settings
into a segment or a `from`–`to` transition, append stinger rules, replace
stinger mappings, and apply ordinary production revisions under
`productions`. Set an optional edge field to `null` to clear it. Set a
stinger mapping to `null` to remove that resource throughout the timeline.

A `commonTone` is an independently authored segment which plays once
across the join. Choose a pitch that belongs to both sides, and write a
held note with the articulation you want. The optional `pickup` starts
it before the boundary, within the outgoing section. Its source clip must
be longer than the pickup. The ordinary bridge can play alongside it.

A `stingerRules` entry with `resource` and `section` withholds its mapped
stinger in that active section. Omit `linked` to match any cue with that
resource. Set it to `false` for standalone cues or `true` for transition-linked
cues. A cue on a transition boundary uses the destination section.
The original cue remains in the trace, and other world responses still run.

```sh
ink-studio music rehearsal keep timeline.json edit.json --out edited.json
ink-studio music rehearsal keep timeline.json edit.json latch.json --out replay.json
ink-studio music production timeline replay.json --out playback
```

An optional trace embeds its intents and duration in the saved recipe.
Put world score rules in the base recipe's `options.world` to include
its trace-specific world audio cues in that saved playback.

The JavaScript API is `KIT.music.production.rehearsal` with
`capture`, `captureScore`, `run`, and `revise`. Graph operations include
`music.captureScoreTrace`, `music.rehearseTransitions`, and
`music.reviseTransitions`. The transition matrix follows a familiar
source/destination authoring model. [Wwise's transition guide](https://www.audiokinetic.com/download/documents/WwiseProjectAdventure_en.pdf)

## Run a regression over seeded and recorded routes

Use `music rehearsal regression` after authoring a linear cue and the
adaptive score that drives it. Define route scenarios as time-stamped
inputs to the actual score state machine. A timestamp or end can be a
fixed number of seconds or a two-element jitter range. Each route
receives a repeatable seed. Supply recorded `traces` in the same request
when specific real routes also matter. The command uses the score from
the timeline recipe's `adaptive.score` or from `score` in the suite.

```json
{
  "seed": 7744,
  "scenarios": [
    {
      "id": "turn-back",
      "count": 72,
      "end": [6.5, 7.0],
      "updates": [
        {"time": [0.65, 0.85], "parameters": {"open": 1}},
        {"time": [1.4, 1.7], "parameters": {"open": 0}},
        {"time": [2.2, 2.4], "parameters": {"open": 1}}
      ]
    }
  ],
  "variants": [
    {
      "id": "cleaner-return",
      "stingerRules": [{"resource": "latch", "section": "reveal", "linked": false}]
    }
  ],
  "options": {
    "sampleRate": 12000,
    "watchTracks": ["lead"],
    "checks": {
      "hooks": [{"id": "call", "segments": ["reveal"], "tracks": ["lead"], "minGap": 2.5}],
      "dwells": [{"id": "holding", "segment": "search", "maxConsecutive": 3}]
    },
    "listenFor": ["early-hook-return", "exhausted-dwell", "hook-collision"],
    "maxAffected": {"hook-collision": 0}
  }
}
```

```sh
ink-studio music rehearsal regression timeline.json routes.json --out review --assert cleaner-return
```

The runner streams full mixes of up to 512 traces for each version,
within its total mixing budget. Each version uses the same intents and
world events. Repeated source windows share the normal timeline renderer's
stems. Only representative WAV windows are exported. The manifest groups
occurrences by failure and passage, counts affected routes separately
from total occurrences, and compares both counts for every edit. Use
`listenFor` to choose what gets auditioned without changing the scan.
`--assert` tests route counts against `maxAffected` for the named version
and returns a nonzero exit status on a failed gate after writing the
report, comparable WAVs, and exact `traces.json`.

A hook policy measures the time between first attacks in eligible
placements. Narrow it by source when the same scene has different
arrangements. A dwell policy checks consecutive sounding uses of the
same source in one visit. Both policies accept a normal transition
`repair` to attach to the representative, such as a later entry marker
or a phrase rotation using existing sources. A played stinger is
checked near its first scheduled attack and can suggest a withholding
rule scoped to the scene and linkage. These signals flag passages for
listening. Set a limit only for behavior the score should avoid.
Add a proposed repair to `variants` to measure it over the full suite,
then use `music rehearsal keep` to write the chosen timeline. Each
audition folder has its own `trace.json` and, when available, an editable
`repair.json` ready for `music rehearsal keep` or a new suite.

Use `rehearsal.seedTraces(score, scenarios, seed)` and
`rehearsal.regression(sources, timeline, settings, assets)` from
JavaScript, or use `music.regressAdaptiveScore` in a graph. To reproduce
both workflows and their audio, run
`node examples/music-production/listening-regression.cjs demo-output`.
