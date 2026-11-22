# Composition search

To replace a longer passage with exact protection for an ending or
other time windows, use [phrase and arrangement search with locks](music-locked-arrangement.md).

Search around an existing cue and hear one eligible candidate per kind
of musical decision. The search uses the production's score clock,
instruments, and performed events. Its output is a producer session with
editable revisions.

| Level | Kind | Decision |
| --- | --- | --- |
| Cue | `exposed` | Leave a stretch of the return to the lead before the ensemble enters |
| Cue | `late-pulse` | Withhold the main percussion pulse through the lead-in and first part of the return |
| Cue | `handoff` | Play the opening hook rhythm on percussion before returning it to the lead |
| Phrase | `bass-move` | Follow a different path through chord tones under the same lead |
| Phrase | `pedal` | Sustain one bass pitch across a chord change |
| Phrase | `suspension` | Prepare a pitch against the incoming chord, hold it through the change, and resolve by step between fixed outer parts |
| Phrase | `drum-answer` | Put a percussion response in performed lead gaps and remove near-unison hits on that percussion track |
| Phrase | `contrary` | Move an inner line in the opposite direction to the lead through local chord tones |
| Phrase | `empty-beat` | Find an empty beat in fixed parts and cut the supporting parts for that beat |
| Note | `note-gesture` | Try an early pickup, an accented lean, or short gates on up to six attacks |

## Set the brief

```json
{
  "section": "return",
  "goal": "Make the familiar hook earn its return.",
  "seed": 518,
  "range": {"from": 48, "to": 56},
  "tracks": {
    "lead": "lead",
    "bass": "bass",
    "inner": "keys",
    "percussion": "snare",
    "pulse": "kick"
  },
  "kinds": ["exposed", "handoff", "bass-move", "pedal", "suspension", "drum-answer", "note-gesture"],
  "constraints": {
    "scale": {"root": "D4", "mode": "minor"},
    "chord": "landing",
    "dissonance": [0, 0.7],
    "pins": {"kick": "all"},
    "ranges": {"bass": ["A1", "E3"], "keys": ["G3", "G4"]}
  },
  "preferences": {
    "dissonance": 0.24,
    "harmonyWeight": 0.46,
    "suspensionBeats": 0.62,
    "gesture": "short"
  }
}
```

Only `section` is required. `range` uses absolute beats within the
section, defaults to its first two bars, and spans up to 32 beats. The
late pulse may also reach one bar into the lead-in. Unspecified tracks
are inferred from their production roles. Choose which kinds to try. The default tries exposed, handoff, bass-move,
pedal, suspension, drum-answer, and note-gesture.

- `scale.mode` accepts a named scale or an increasing list of semitone
  offsets starting at zero. The scale and per-track ranges constrain
  added pitched attacks. Existing chromatic material can stay in place.
- `chord` is `free`, `landing` (require a chord tone within an eighth of
  a beat after the active chord starts), or `strict` (at every added
  pitched attack). A held note can cross a chord boundary.
- `dissonance` bounds the overlap-weighted interval score when pitches
  sound together. The preference favors candidates near a target on the
  same 0–1 scale. The estimate measures written pitch intervals through
  their performed gates. Audition the result to hear the effect of
  timbre, tails, and mix.
- `pins` protects an entire track with `all` or the performed pitch
  sequence of a pitched track with `pitch`. The production's own
  arrangement and scene-binding pins still apply.
- `preferences.articulation` can name a supported articulation from the
  melody patch. When omitted, the note move uses the first available
  articulation if the patch has one. `gesture` chooses the preferred
  phrasing profile. Use `pickup`, `lean`, `short`, `attack`, `breath` or
  `release`. `seed` breaks ranking ties.

The report lists attempted candidates, the parts that actually changed,
attack counts, and reasons for rejected choices. Hard constraints apply
before ranking. A move-specific heuristic and the dissonance preference
rank each kind independently. Duplicate performed results are filtered
from the shortlist. A fully blocked family is skipped and the reference
is always available. The bass and inner-voice moves can use a new gap
or replace a note clip with identical bounds.

## Listen and retain

```sh
ink-studio music production search cue.json brief.json --out search.json
ink-studio music production review-audition cue.json search.json --out review
ink-studio music production keep-audition cue.json keep.json --out chosen
```

Use `{"session":"search.json","options":{"start":{"beat":46},"end":{"beat":56}}}`
as the review config to set the comparison window. The audition plays the
same window at matched loudness. A keep file selects one or more
independent changes:

```json
{
  "session": "search.json",
  "keep": [{"take": "bass-move", "component": "move"}],
  "reason": "The bass changes the arrival while the tune stays familiar."
}
```

Cue moves that replace the same cue map conflict when combined. Audition
the result of combined selections to hear how the changes interact.
Each winner's `revision` also works as a score take in a
[music edit session](music-edit-session.md).

The JavaScript entry point is
`KIT.music.production.searchComposition(source, brief, assets?)`.
The graph node `music.searchComposition` exposes the shortlist, producer
session, and report. Connect its `session` output to `music.reviewProducer`
or `music.keepProducer`.

Use the [composition workbench](composition-workbench.md) to hear these choices
alongside cue forms, voicings, gestures and written rhythm comparisons.
