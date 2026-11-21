# Perform a phrase with patch gestures

A patch can define named gestures that shape a phrase while keeping its
written notes. Use the same score with alternate performances or change
the patch palette while keeping the score.

## Define and place a gesture

Add a `gestures` table to any production patch. Each named gesture
has lanes with ordered `[phase, value]` points. Phase runs from zero to one
over the placement. Values hold before the first and after the last point
within the placement. Numeric lanes interpolate between points.
Articulation and legato use stepped values.

```json
{
  "type": "fm",
  "articulations": {
    "muted": { "index": 1.1 },
    "ring": { "index": 3.1 }
  },
  "echo": { "delay": 0.29, "feedback": 0.43, "damping": 0.67 },
  "gestures": {
    "strike-and-dissolve": {
      "articulation": [[0, "muted"], [0.5, "ring"]],
      "cutoff": [[0, 800], [0.58, 10500], [1, 2400]],
      "echo": [[0, 0], [0.6, 0.1], [1, 0.65]]
    }
  }
}
```

Place the gesture on a track that uses the patch. With a section name,
`from` and `to` are beats relative to that section. Without a section they
are absolute score beats. An omitted range covers the section or score.
Placements on one track are sequential. Combine simultaneous lanes into
one gesture. Use an optional `amount` from zero to one to blend with the
track and note settings. Stepped lanes take effect at amounts of at least
one half.

```json
{
  "patch": "lead",
  "gestures": [
    { "gesture": "strike-and-dissolve", "section": "answer", "from": 0, "to": 8 }
  ]
}
```

| Lane | Effect |
| --- | --- |
| `gate`, `accent`, `delay` | Note-length multiplier, velocity multiplier, and additional onset delay in seconds |
| `brightness`, `vibrato`, `glide` | Note timbre, vibrato depth in cents, and glide duration in seconds |
| `articulation` | Select a named synth articulation or a sample zone |
| `legato` | Connect nearby notes on a monophonic pitched track |
| `gain`, `pan`, `cutoff`, `echo` | Continuous gain offset in dB, stereo position, low-pass cutoff in Hz, and tape echo send |

Note lanes are read at each written onset. Continuous lanes also act while
a note is held. Their points follow the tempo map, and values ease back to
the track settings after the gesture. A legato connection can bridge up to
140 ms between played notes. It extends the first note to the next attack,
crossfades briefly, and glides from the previous pitch on synth patches.
Existing rests beyond that range remain audible.

Tape echo is an optional patch effect with `delay` in seconds,
`feedback`, `damping`, `wow`, `flutter`, `width`, and a default `send`.
Echo returns are part of the processed instrument stem. They can carry past
the end of a gesture and across clip cuts when the render requests a tail.
Filtered feedback and modulation replay on the absolute sample grid, so
rendering a window retains the echo and automation history.

## Audition alternate performances

Use `KIT.music.production.planPerformances(source, takes, assets)`, the
`music.planPerformances` graph node, or the CLI. A take gives an ID and a
table of replacement gesture placements per track. An empty table keeps
the source performance. An empty list on a track clears its placements.
Use `unpin` when you intend to release a protected part for a take. The
tool returns revisions for the existing level-matched production audition
and a report of affected attacks and connected notes. The written score
stays intact.

```json
[
  { "id": "plain" },
  {
    "id": "performed",
    "tracks": {
      "lead": [{ "gesture": "strike-and-dissolve", "section": "answer" }]
    }
  }
]
```

```sh
ink-studio music production performances cue.json takes.json --out choices.json
ink-studio music production audition cue.json choices.json --out audition
```

## Two palettes for the same score

The [gesture palettes](../examples/music-production/gesture-palettes.json)
are reusable production revisions. The brittle palette combines
a metallic FM patch, recorded percussion, and an analog bass. The dusty
palette uses the native `keys` tine instrument and the `brush` drum type.
Adjust placement ranges when taking the palette to another score.
The tine model reacts to velocity with a brighter strike. The brush has a
swept granular envelope and can switch between a tap and a longer swish.
The palettes reuse the existing recorded sample assets credited in the
[sample directory](../examples/music-production/samples/CREDITS.md).

Run the [comparison recipe](../examples/music-production/phrase-gestures.cjs)
to render plain FM, gestured FM, and dusty keys with brush percussion.
It checks that all three takes have identical written note sequences.

```sh
node examples/music-production/phrase-gestures.cjs gesture-audition
```
