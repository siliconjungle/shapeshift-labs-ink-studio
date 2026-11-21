# Arrange scene sound with the score

A scene cue can suggest a percussion phrase, reserve space on selected music
stems, or do both. The same timeline can include deliberate gaps independent
of a sound cue. These controls are evaluated in the production renderer, so
they also apply to audio exports, graph recipes, and trimmed takes.

Put the rules in `music.production.world` in a [scene soundtrack](scene-audio.md).
Use names from the spatial cue registry or the scene timeline's audio cues.
The soundtrack collects the resolved onsets, including spatial propagation
delay when enabled, and uses the cue's gain as its response strength, capped
at one.

```json
{
  "rhythms": [
    {
      "id": "relay-answer",
      "cue": "relay",
      "track": "rim",
      "segments": ["approach"],
      "grid": 0.5,
      "delay": 0.06,
      "gate": 0.1,
      "hits": [
        { "beat": 0, "level": 0.8 },
        { "beat": 0.5, "level": 0.4, "articulation": "muted" }
      ]
    }
  ],
  "space": [
    {
      "id": "keep-the-switch-audible",
      "cue": "latch",
      "tracks": ["pad", "room"],
      "attack": 0.12,
      "hold": 0.16,
      "release": 0.3,
      "level": 0.25
    },
    { "id": "wait-for-the-door", "from": 6.8, "to": 7.2, "attack": 0.2, "release": 0.08 }
  ]
}
```

Each rhythm routes to a named production track with a percussion role. It
can have its own written notes as well. The response uses that track's patch,
mixer, and choke group. Apply a delay in seconds before rounding forward to
the active segment's beat grid. A grid of `0` follows the cue's timing
directly. `hits` are offsets in musical beats with optional velocity scaling,
MIDI pitch for sample-zone selection, and patch articulation. The default is
one hit at beat zero, MIDI 36, and a gate of .12 seconds. Responses may cross
loop seams within a segment. A transition ends that segment's response
phrase, including any pending hits.

Each space rule can respond to a cue or use an absolute `from` and `to` in
scene seconds. The attack leads into the cue or the start of the interval.
Cue-driven rules hold for the sound's played duration by default, or use
an explicit hold in seconds. For event lists without durations the default
hold is .18 seconds. After the hold, the gain ramps back to one. The default
attack is .05 seconds and the default release is .2 seconds. An omitted
`level` gives silence. Omitting `tracks` applies the envelope to every
production track, including room and stinger audio. For overlapping
envelopes, the lowest gain wins. The world and timeline sound stems keep
their own gain.

For `KIT.music.production.renderTimeline` and the `music production timeline`
CLI recipe, put the rules in `options.world` with an `events` array. Each event
has `cue`, `time` (seconds or a rational timecode), and optional `strength` in
`[0, 1]` and `duration` in seconds. The `music.renderTransitions` graph node
also has a `worldEvents` input. Connect `audio.detectTransients.events` to it
and use the detector's `name` as the cue to turn an existing motor recording,
rain stem, or other audio into a rhythmic input.

The production report's `world.responses` and `world.windows` record the
scheduled hits and gain envelopes in absolute seconds. In a scene export the
same data appears under `audio.worldScore` in the manifest.

Generate the [Pressure Relay demo](../examples/music-production/pressure-relay.cjs)
with `node examples/music-production/pressure-relay.cjs output-directory`.
The output includes the original world cues, music and final mix, plus a
comparison with the world-score rules bypassed.
