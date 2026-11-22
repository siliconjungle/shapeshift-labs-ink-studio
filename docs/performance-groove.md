# Groove from a performance

Measure a reference take against its own beat grid. Apply the resulting groove
to a production at a different tempo. The template stores timing in beats,
accent as a relative multiplier, and length in beats. Each dimension has its
own control. You can audition a timing change with the written syncopation,
accents and lengths held constant. [Ableton Groove Pool](https://www.ableton.com/en/live-manual/12/using-grooves/)
 · [Witek et al. on syncopation](https://doi.org/10.1371/journal.pone.0094446)
 · [Senn et al. on microtiming](https://doi.org/10.3389/fpsyg.2016.01487)

## Extract a reference

```sh
ink-studio music groove extract take.json --out groove.json
```

For audio, give each role its own WAV lane where possible. A mixed break
can be used as one lane. Supply its recorded tempo and the time in seconds
of the beat-zero downbeat. Here the reference is two bars of 16th notes.

```json
{
  "input": {
    "kind": "audio",
    "lanes": {"kick": "kick.wav", "rim": "rim.wav", "ghost": "ghost.wav"}
  },
  "grid": {"id": "break", "map": {"tempo": 98, "origin": 0.16}, "length": 8, "step": 0.25},
  "detect": {"minGap": 0.065, "sensitivity": 1.7},
  "gate": {"relative": 0.13, "floor": 0.005, "hold": 0.018, "max": 0.7}
}
```

Ink locates transients on the sample grid and estimates accents and audible
lengths with an RMS envelope. `minGap`, `hold`, and `max` are in seconds.
Respectively, the gate controls set the fraction of peak level, the floor,
the quiet time needed to close the gate, and the maximum measured length.
Check the measured hits if the source is noisy or has overlapping sounds.

For a played take in Standard MIDI File format 0 or 1 with PPQ timing,
replace the input with a MIDI file and lane selectors. Channels are 1-based,
tracks are 0-based, and pitch and velocity ranges can refine the routing.
Velocities use a 0–1 range in selectors. Length is the interval from note-on
to note-off in beats. Audio detector and gate options are for WAV input.
[MIDI file specification](https://midi.org/standard-midi-files)

```json
{
  "input": {
    "kind": "midi",
    "file": "playing.mid",
    "lanes": [
      {"lane": "kick", "channel": 10, "notes": [36]},
      {"lane": "rim", "channel": 10, "notes": [37, 38], "velocity": [0.5, 1]},
      {"lane": "ghost", "channel": 10, "notes": [38], "velocity": [0, 0.49]}
    ]
  },
  "grid": {"id": "playing", "length": 8, "step": 0.25}
}
```

Use `{"kind":"events","file":"observations.json"}` to fit your own measured
observations. Each row has a `lane` and either `beat` or `time`. It may have a
`velocity` and a `durationBeats`, or a `duration` in seconds for a timed row.
The audio and event grid can use Ink's tempo map and swing. For any input,
`startBeat` sets the extraction range and `cycles` folds multiple passes into
one template. Onsets beyond `tolerance` beats from the nearest grid line or
outside the extraction window are counted in the report. When a slot has
multiple measurements, Ink takes their medians. Accents are relative to the
median level of that lane.

## Apply it to a score

```sh
ink-studio music production groove score.json mapping.json --out played.json
ink-studio music production render played.json --out take
```

```json
{
  "template": "groove.json",
  "anchors": [0, 4, 8, 12],
  "links": [{"leader": "kick", "followers": ["bass"], "within": 0.0625, "strength": 1}],
  "tracks": {
    "kick": {"lane": "kick", "timing": 0.8, "accent": 0.6, "length": 0},
    "snare": {
      "lane": "rim", "timing": 1, "accent": 0.85, "length": 0.5,
      "articulations": {"ghost": {"lane": "ghost", "timing": 1.1, "length": 1}}
    }
  }
}
```

Use `roles` for defaults such as `lead`, `bass`, or `percussion`. Named tracks
and articulations can override them. Independent strengths of 0 keep the
authored values, 1 applies the measured values, and up to 2 amplifies the
differences. Onsets add the measured offset, accent scales velocity, and
length blends toward the measured gate. Missing cells are neutral, and
explicit pitch ties keep their gates. The destination tempo map sets the
timing in seconds. `startBeat` controls where the pattern first applies.

Anchors keep attacks on the written timing clock while allowing accent and
gate changes. Links match notes by written beat within the given tolerance.
Matched notes follow a leader’s performed attack. Unmatched notes keep their
own timing rules. The score's written beats and pitches stay editable, and
the CLI includes a change report in the playable recipe.

Graph pipelines can connect `audio.extractGroove` or `music.fitGroove`
to `music.applyGroove` by passing the extracted `value` as the mapping's
`template`. The direct production API is `KIT.music.production.mapGroove`.
The same mapping can go into a revision for a producer audition.

## Side Pocket workshop

```sh
node examples/music-production/performance-groove-workshop.cjs output
```

This builds a 98 BPM reference break from
[recorded one-shots](../examples/music-production/samples/CREDITS.md) and a
synthesized kick, and writes a short authored MIDI take. It exports the
measured lanes, the editable transfer, and three 112 BPM renders of the same
cue. Compare the grid, timing only, and the full transfer.

## Ensemble performance

Use `grooveMap.ensemble` to shape how players move through a cue. The
production renderer, edit session, and graph operation `music.applyGroove`
all use the same performance. A cyclic `template` can be layered underneath
the ensemble or omitted.

An ensemble can carry three kinds of performance instructions.

- `pulse` moves everyone together. `players` adds independent offsets,
  velocity multipliers, and gate multipliers. Curves are piecewise linear at
  absolute written beats and hold their end values. Offsets have explicit
  `beats` or `seconds` units. Top-level `anchors` pin attacks to picture or
  score time and leave velocity and articulation editable.
- `partners` matches the nearest unused written attack between two named
  tracks, within `within` beats. A chord counts as one attack. An offset of
  −20 ms for `["kick","bass"]` puts the bass 20 ms ahead of the kick on a
  shared written beat. For two different written beats it adds the offset to
  their written separation. `mobility` splits the correction between players.
  `[1,1]` shares it equally and `[0,1]` fixes the kick. `strength` controls how
  much of the correction to apply. For overlapping partnerships Ink blends
  the corrections computed from the original proposed attacks. Directed
  `links`, if supplied, run after the reciprocal adjustments.
- `transfers` place a recorded phrasing span onto written events. The source
  range is relative to the exported take, and the destination range is in
  absolute beats. Both are half-open. Ink maps the two ranges proportionally,
  then finds the nearest observed attack within `within` source beats (by
  default 0.49 of a source grid step). Use `byPitch: true` for pitch-specific
  matching of MIDI or measured events. The transfer keeps written pitches
  and rhythm addresses, and independently blends attack timing, velocity
  relative to the source span's median, observed gate, and articulation.
  Written note ties keep their gate across the transfer. A player can use
  different takes on disjoint ranges.

```json
{
  "anchors": [0, 8],
  "ensemble": {
    "id": "quartet",
    "pulse": {"unit": "seconds", "points": [[0, 0], [4, 0.012], [8, 0]]},
    "players": {
      "bass": {"offset": {"unit": "seconds", "points": [[0, 0.009]]}, "length": [[0, 0.9], [6, 1.1]]}
    },
    "takes": {"drummer": "groove.json"},
    "transfers": [
      {"track": "hat", "take": "drummer", "lane": "hat", "from": 0, "to": 8,
       "sourceFrom": 0, "sourceTo": 8, "timing": 0.8, "accent": 0.9, "length": 0,
       "articulations": {"loose-hat": "open"}}
    ],
    "partners": [
      {"tracks": ["kick", "bass"], "mobility": [0.35, 1], "within": 0.04,
       "offset": {"unit": "seconds", "points": [[0, -0.018], [4, 0.024]]}}
    ]
  }
}
```

`music groove extract` writes a `take` alongside the repeating `template`.
Use the extraction file path in a CLI mapping, as above, or embed the
`take` record directly in a production or graph. Graph nodes
`music.fitGroove` and `audio.extractGroove` expose it on their `take` port.
The take keeps stable hit addresses within the exported file and each pass's
attack, level, and length. MIDI `lanes` selectors can set `articulation` by
note, channel, or velocity range. WAV lanes can use
`{"file":"open-hat.wav","lane":"hat","articulation":"loose-hat"}` to combine
labeled aligned stems. For graph inputs use `audio` in place of `file`.
WAV levels and gates estimate the audible envelope. WAV articulation labels
come from the source metadata. If a destination patch lacks a mapped
articulation, it retains its own articulation and the report records the
unapplied label. Set `articulation: false` to audition timing and dynamics
separately.

Use `music production groove score.json mapping.json --out played.json`, then
inspect or render `played.json`. The ensemble report lists reference hit IDs,
articulation assignments, and the proposed, target, and realized offsets
for paired attacks. Edge clamping, overlapping partnerships and later
directed links can affect realized offsets.

## Edit the gap you hear

Use the groove editor on a production or music edit session. The CLI shows
the written beat projected onto the score clock, the played note time, the
instrument trigger, and the estimated audible attack. The instrument
trigger can precede the played note when the patch has attack compensation.
The attack estimate measures a sustained energy rise in the isolated
rendered voice before the mixer. The audition prints the actual mix,
including its routing, effects and sidechains.

```sh
ink-studio music groove inspect score.json focus.json
ink-studio music groove edit score.json edits.json --out edited.json --report timing.json
ink-studio music groove audition score.json edits.json --out comparison
```

Example `edits.json` for a four-bar phrase:

```json
{
  "range": {"from": {"beat": 0}, "to": {"beat": 16}},
  "pair": {"anchor": "kick", "track": "bass", "within": 0.07},
  "searchMs": 160,
  "edits": [
    {"op": "trim", "track": "bass", "keepMs": 4},
    {"op": "gap", "metric": "audible", "targetMs": [[0, 38], [8, 10], [16, 13]]}
  ]
}
```

Use the same settings without `edits` for inspection. Range endpoints
accept beat numbers or the session's beat, bar, seconds and sample
addresses. Supply `tracks` when inspecting more lanes. The pair finds the
nearest unused anchor by written beat, with `within` measured in beats.
A positive gap places the target after the anchor. Use a single
`targetMs` value for a fixed gap, or interpolate over absolute written
beats. Choose `"trigger"` to target the trigger gap.

The trim changes playback position inside the sample and keeps the
trigger, written note and expression timing. It tests that the earlier
attack retains enough energy. Use the `at` address from `inspect --json`
to trim just one attack; its beat distinguishes occurrences of the same
looped clip note. A gap edit applies after existing groove links and works
on played clips. It moves the target and remeasures the result, including
any constraints from timing anchors or the start of a clip. Edits remain
addressable under `tracks.<name>.timingEdits` in the recipe.

A session uses its saved comp by default. Use `take` to inspect or edit
a named score take, including `reference`. The report names the take
that supplies each attack. Edits keep fully pinned lanes and avoid edits
during comp fades or across a comp boundary. Auditions of a named take
select it on the inspected tracks for the requested range.

Use `inspect --json` for sample positions and note addresses. The audition
folder contains `before.wav`, `after.wav`, `timing.txt`, `report.json`, and
an editable recipe. Generate the Pocket Clock study with:

```sh
node examples/music-production/groove-editor.cjs output/pocket-clock
```
