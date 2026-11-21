# Producer auditions

Start with a production, a named section, and a listening goal. Compare
different musical decisions across the same lead-in and return. Listen to
the room and ensemble in context, then solo the bars and instruments that
influenced the decision. Keep named components and record why they work.

## Plan alternatives

```json
{
  "section": "return",
  "goal": "Make the theme's return feel earned and leave its first note clear.",
  "lead": "keys",
  "layer": "glass"
}
```

`music.planProducer` always supplies the current arrangement as a reference.
The `harmony` strategy tries a dominant-seventh preparation in the preceding
section. If a dominant seventh already leads into the return, it tries a
tritone substitution. The `orchestration` strategy doubles the opening melody on a resting
instrument, or revoices an active chord pad. The goal is carried through into
the comparison and the final reference. Use `strategies` to choose which
approaches to try, or `[]` to compare only your own takes. Choose `octave: -12`
for a low double. The planner reports inapplicable strategies and conflicts
with pinned material.

Provide custom `takes` as entries with `id`, `hypothesis`, and
`components`. Each component has `id`, `summary`, and a `revision` in the
production format used by `music.reviseProduction`. Session components apply
musical edits and preserve the source's pins. Group related chord definitions
and their change events in one component. Keep independent choices such as
an octave double and a drum accent in separate components. The baseline
and alternatives can total up to eight takes.

## Listen

```json
{
  "session": "session.json",
  "options": {
    "start": { "bar": 3 },
    "end": { "bar": 6 },
    "sampleRate": 32000,
    "focus": [
      {
        "id": "cadence",
        "start": { "bar": 3, "beat": 2 },
        "end": { "bar": 4, "beat": 2 },
        "tracks": ["bass", "bed"]
      },
      { "id": "return", "start": { "bar": 4 }, "end": { "bar": 5 } }
    ]
  }
}
```

`music.reviewProducer` plays up to 30 seconds of context. Bars are
zero-indexed. Start and end can also be set in seconds. The full mixes
share a loudness target, reduced as needed for headroom. Focus clips use
the same gain and timing as the context. A `tracks` list solos those
instruments from the context render. Include `room` to hear the shared
reverb return. When selected stems need more headroom, every take of that
focus clip gets the same attenuation. Reports include the chord path and
performed-note counts, with each hypothesis and component listed beside its
audio.

## Keep a decision

```json
{
  "session": "session.json",
  "keep": [
    { "take": "harmony", "component": "cadence" },
    { "take": "full-arrival", "component": "octave-double" }
  ],
  "listened": ["cadence solo", "return in context"],
  "reason": "The dominant prepares the return and the glass supports the hook."
}
```

`music.keepProducer` checks overlapping edits and applies only the named
components to the original production. Use an empty `keep` list to retain
the baseline. Save the editable production and the reference, which contains
the goal, chosen hypotheses, rationale, and exact revision. The graph's
`revision` output can feed `music.reviseProduction` on another compatible
cue. Listen to the combination after keeping components from different
takes, since the individual auditions describe how each revision sounded
with its own surrounding parts.

```sh
ink-studio music production plan-audition source.json brief.json --out session.json
ink-studio music production review-audition source.json review.json --out listens
ink-studio music production keep-audition source.json selection.json --out chosen
ink-studio music production revise source.json chosen/reference.json --out replayed.json
```

The review and selection examples above refer to `session.json` relative
to their own files. The review publishes a manifest and WAVs for each take
and focus. The selection publishes `production.json` and `reference.json`.
The session should be reopened with the source it was planned against.

Run the [Night Signal example](../examples/music-production/night-signal.cjs)
to hear the generated cadence and orchestration, the full take with percussion,
and the combination that keeps the cadence and octave double.
