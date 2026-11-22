# Instrument performance

Use a performance map to decide how each note starts, joins its neighbor,
or ends. A gap starts a new phrase, nearby strikes at the same pitch can
repeat, and a nearby different pitch can connect when it fits the interval
limit. The map is optional on any native production patch. Start with a
[stock performance instrument](music-playable-instruments.md) to hear these
gestures on a flute, an electric bass, or a prepared-metal kit.

## Phrase-aware patch

```json
{
  "type": "sample",
  "env": {"attack": 0.004, "release": 0.09},
  "zones": [
    {"samples": ["swell"], "root": "A4", "oneShot": false},
    {"samples": ["strike-a", "strike-b"], "root": "A4", "articulation": "tap", "oneShot": false},
    {"samples": ["up"], "root": "A4", "articulation": "rise", "oneShot": false},
    {"samples": ["down"], "root": "A4", "articulation": "fall", "oneShot": false},
    {"samples": ["off"], "root": "A4", "articulation": "keyoff"}
  ],
  "performance": {
    "connect": {"gap": 0.065, "interval": 7, "fade": 0.026},
    "repeatGap": 0.17,
    "rules": [
      {"when": "attack", "attackLead": 0.124},
      {"when": "repeat", "articulation": "tap", "level": 0.85},
      {"when": "legato", "interval": [1, 7], "articulation": "rise", "attackLead": 0.06},
      {"when": "legato", "interval": [-7, -1], "articulation": "fall", "attackLead": 0.052},
      {"when": "release", "articulation": "keyoff", "level": 0.8}
    ]
  }
}
```

Gaps and fades are in seconds. The interval is in signed MIDI semitones
relative to the previous note on the same voice. Use `keys: [low, high]`
to restrict the rule to specific destination MIDI notes. Select a directional
or interval-specific rule before a catch-all legato rule. A rule's optional
`velocity: [low, high]` matches inclusive bounds against the incoming
normalized note velocity, before applying the rule's level. Put a
velocity-specific rule before its general fallback. Use `glide` for a
native synth transition. A sampler can select an authored transition
recording instead. Connecting voices crossfade and suppress the outgoing
key-off articulation. Authored silence and choke groups still apply.
Set `recorded: true` on a legato rule with a named articulation and an
interval to apply it to captured MIDI takes and overlapping live notes.
Set `connect.unmatched: "attack"` to play a full new attack on unmapped
intervals. Live monitoring starts the recorded pickup as the next key
arrives. Score playback can advance it by `attackLead`.

`attackLead` advances the trigger by up to two seconds while preserving the
intended musical onset and note-off. The cue start, an authored silence,
and the previous note on the same pitched voice can limit the advance.
Set it to the measured or chosen time from sample start to the audible
attack. `music production inspect` reports each note's intended `time`,
earlier `start` if applied, performed gate, articulation, and release.

An explicit note articulation takes precedence over the rule's sample or
synth variation. With a performance map, strikes rotate independently by
articulation, so ghost notes and closed hats leave the open-hat alternation
on its own count. A release rule triggers at key-up once a note ends into
space. Releases cut by a choke or replaced by a joined attack are suppressed.
Without a performance map, existing track gesture connections and sampler
rotation retain their original behavior.

The mapping takes inspiration from [Cubase's articulation attack compensation](https://www.steinberg.help/r/cubase-pro/15.0/en/cubase_nuendo/topics/expression_maps/expression_maps_sound_slots_r.html)
and [SFZ's distinct initial and transition regions](https://sfzformat.com/tutorials/legato/).

## Per-note expression

Put these curves in a note's `play.curves` or in a performance rule. Notes
can override individual rule curves. Each lane has up to 32 increasing
`[phase, value]` points from zero to one. Phase spans the played gate
including its compensated pickup. Values hold at the edges and into the
release. A well-bounded export window preserves the phase of the full note.

```json
{
  "gainDb": [[0, -9], [0.24, 1.5], [1, -5]],
  "pitchCents": [[0, -22], [0.35, 6], [1, 0]],
  "cutoffHz": [[0, 700], [0.65, 3700], [1, 960]]
}
```

Pitch is integrated over time to keep phase and sample playback continuous.
Cutoff adds a per-voice low-pass filter. An `amplitude` curve applies a
linear 0–1 gain that can reach silence. A `roughness` curve sets the
depth of rapid amplitude modulation in the same 0–1 range. These curves also work on notes
played without performance maps. [Modular patches](music-instrument-graphs.md)
can also route per-note pressure, breath, damping, contact position and room
to their own parameters.

## Groove against another player

Extend an existing [groove link](performance-groove.md) with an offset
curve. The following bass plays a little behind the kick, then leans ahead,
without moving the kick. Unmatched notes keep their own timing. Groove
anchors still hold their written positions.

```json
{
  "leader": "kick",
  "followers": ["bass"],
  "within": 0.075,
  "strength": 1,
  "offset": {"unit": "seconds", "points": [[8, 0.026], [12, -0.018], [16, 0.034]]}
}
```

Offset positions are absolute written beats. Values can use `seconds`
(±0.125) or tempo-relative `beats` (±0.25). Set separate links for bass
and hats to pull them in different directions against the same kick.

## Audition the two axes

Supply a pocket brief with `rhythm: {edits, tracks?}` and a `groove` map.
Use ordinary part revisions in `edits`, or clip-only track overrides.
The planner returns four editable revisions. They play the reference,
the new written pattern, timing changes on the original pattern, and both
changes together. The timing variants use the supplied transfer's timing
and links with accent and length transfer disabled. If the source already
has a groove transfer, the reference and written variants clear that
transfer for the comparison. Track groove and tempo-map swing are shared.

```sh
ink-studio music production instrument-presets --out patches.json
ink-studio music production pocket score.json pocket-brief.json --out pocket-takes.json
ink-studio music production audition score.json pocket-takes.json --out audition
```

The stock palette provides **Glass Reed**, **Smoked Tines**, and **Coast
Bass** as editable patches. JavaScript uses
`KIT.music.production.instrumentPresets` and
`KIT.music.production.planPocket(source, brief, assets?)`. The graph nodes
are `music.instrumentPresets` and `music.planPocket`.
