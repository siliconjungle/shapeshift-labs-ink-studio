# Independent lines and voicing search

A production track can play polyphonic note clips with named voices. The
voice-leading tool searches those clips around an existing melody and bass.
It keeps the two outer tracks' performed events fixed and returns editable
revisions for the inner track.

```sh
ink-studio music production voice-lead source.json settings.json --out choices.json
ink-studio music production audition source.json choices.json --out auditions
```

Use a selected variant's `revision` with `music production revise`, or edit
its notes before applying it. The same recipe works with the normal
[production renderer](music-production.md), cue maps, and adaptive playback.

## Author a clip

Place `clips` on a pitched production track. A clip covers a half-open
beat range and replaces that track's written material inside it. Notes
outside the clip remain available. Each voice has its own ordered notes,
and different voices can play at the same time. A clip, voice, and note have
stable IDs. The performed event reports all three.

```json
{
  "id": "bridge-lines",
  "beat": 8,
  "length": 4,
  "voices": [
    {
      "id": "tenor",
      "notes": [
        { "id": "pedal-a", "beat": 0, "duration": 2, "midi": "C4", "velocity": 0.6 },
        { "id": "pedal-b", "beat": 2, "duration": 2, "midi": "C4", "tie": true }
      ]
    },
    {
      "id": "alto",
      "notes": [
        { "id": "question", "beat": 0.5, "duration": 0.75, "midi": 69 },
        { "id": "answer", "beat": 2.75, "duration": 0.5, "midi": 67,
          "play": { "brightness": 0.7 } }
      ]
    }
  ]
}
```

A tie continues an adjacent, same-pitch note in the same named voice. It
can cross adjacent clip boundaries and inherits the original attack,
velocity and expression. Tie segments render as one gate. Use longer gates
or ties to hold a pitch across chord changes. A sampler patch needs a gated
zone or a sustain loop to hold audio beyond the sample's natural length.
Use common [note expressions](music-production.md) and the production's
existing track effects. Clips on one track have disjoint ranges. Voices
within each clip can contain gaps.

Use `loopBeats` to repeat one editable cycle over the clip's placed
`length`. A partial last cycle plays up to the clip edge. Notes cut at
the edge retain their original expression phase. [Clip jams](music-clip-jam.md)
write this format when you record launches into an arrangement.

## Search voicings with fixed outer lines

Give the search a target track, melody and bass tracks, a window in beats,
and up to three inner voices in low-to-high order. Each voice has a MIDI
range, optional register anchor, and velocity. Use overlapping ranges if a
voice should be able to choose either side of a shared register.

```json
{
  "track": "inner",
  "melody": "melody",
  "bass": "bass",
  "from": 0,
  "to": 20,
  "voices": [
    { "id": "tenor", "low": "G3", "high": "D4", "anchor": "C4" },
    { "id": "alto", "low": "D4", "high": "C5", "anchor": "G4", "velocity": 0.66 }
  ],
  "pedals": [{ "voice": "tenor", "from": 0, "to": 6, "midi": "C4" }],
  "suspensions": [{ "voice": "alto", "at": 8, "delay": 0.5, "hold": "A4", "resolve": "Bb4" }],
  "preferences": { "motion": 0.9, "tension": 0.14, "dissonance": 0.28, "delay": 0.5 }
}
```

The search tries three paths:

| Path | What it searches for |
| --- | --- |
| `connected` | Compact movement and common tones in the inner voices. |
| `suspensions` | A prepared note that can hold into a new chord and then resolve by step. |
| `counterline` | An upper inner voice that answers between the performed melody's note gates. The search favors motion against the outer lines when the outer pitches are present. |

A pedal forces a pitch through its named range, including through a
deliberate clash. An authored suspension forces the held pitch from the
preceding harmony through the delay, then the destination chord tone
through the next change or the end of the search window. The automatic
suspension path can also find additional stepwise resolutions. In the
counterline path, a forced note can play outside a gap. Search windows
can replace a previous clip at the same range. A window that partly
overlaps an existing clip needs a more precise selection.

The search considers pitch order, chord membership, the distance each
voice travels, and a blend of interval-class and spectral roughness.
`motion` weights the cost of movement. `tension` sets a preference for
the share of non-chord tones, and `dissonance` sets a separate preference
for rougher or smoother intervals. Both targets use a 0–1 scale. `delay`
sets the automatic suspension's delay in beats. `ties: false` allows
rearticulation of ordinary common tones while leaving explicitly held
notes continuous. These are search preferences and playability measures.
Reports include editable clips, held resolutions, travel, the estimated
tension and dissonance of the chosen notes, and the melody gaps used in the
search. Tight ranges or forced notes can reduce the number of distinct
paths. The report names profiles that could not add a distinct take.

The search keeps the identified outer tracks fixed for the comparison.
Existing [production pins](phrase-composer.md#pin-revise-and-take-inspiration)
still apply when adopting a revision. Use the production inspector to see
how groove, cue maps, or track effects shape the written notes in playback.

## Use it from a graph

Use `music.noteClip` to validate and normalize an authored clip and
`music.voiceLead` to generate editable variants. JavaScript callers use
`KIT.music.production.voiceLead(source, settings, assets)`.
The [Low Water example](../examples/music-production/voice-leading-workshop.cjs)
renders all three paths and compares the locked melody and bass stems
sample for sample.

```sh
node examples/music-production/voice-leading-workshop.cjs low-water
```

The movement cost is inspired by Tymoczko's treatment of voice leading
as movement between pitches. The search preserves named voices and
adds timing and roughness preferences for this authoring workflow.
[Tymoczko, Scale Theory, Serial Theory and Voice Leading](https://doi.org/10.1111/j.1468-2249.2008.00257.x)
