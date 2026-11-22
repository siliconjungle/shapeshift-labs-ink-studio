# Compose inside a music session

Use the same score clock, recordings, kit and mix to audition changes at
cue, phrase and gesture scale. Each candidate is an ordinary editable
[music session](music-edit-session.md). The workbench saves the specific
edit operations with its evidence, so you can keep one candidate recipe or
apply compatible edits from several candidates in a session batch.

```sh
ink-studio music session compose source.json brief.json --out comparisons
ink-studio music session play comparisons/sessions/late-call.json
```

Provide `brief.moves` as a list of uniquely named moves. Each has `id`
and one of the following fields.

| Field | Parameters and result |
| --- | --- |
| `form` | Pass a native [theme plan](music-themes.md) as `theme`, `withhold` windows with `from`, `to`, and `parts`, and an optional `ending: {at, mode}`. Beat positions are absolute. Otherwise the normal theme rules apply, including section-relative appearance beats. Put a fragment on one part and a full statement on another. The report shows the realized owners and the heard and withheld theme notes at each section. Withholding and endings act on score tracks through the cue map. Choose `ring` for natural tails or `cut` to stop them. |
| `phrase` | Pass a [composition search brief](music-composition-search.md). Choose `pedal`, `contrary`, `drum-answer`, or `empty-beat`, among others. Use `constraints.pins` to keep the hook. An empty beat is chosen where the melody and other protected parts have no performed gate; it cuts the unlocked score parts in that window. |
| `voicing` | Pass [voice-leading settings](music-voice-leading.md) for distinct inner voices between fixed outer parts. Set the register, motion, dissonance and delayed resolutions without editing the scale. |
| `gesture` | Pass `{lane, clip, voice, notes: [{note, play?, velocity?}]}` using written note IDs. A pickup uses `play.delay`, a breath can use an expression curve on an instrument that responds to it, `attackFade` shapes the onset in seconds, and `releaseLimit` caps the native voice tail in seconds after key-up. These controls retain the written beat, duration and pitch. |
| `rhythm` | Pass a written pad pattern, named routes, and optional step- and time-level alternatives. See below. |

For comparisons add a common `preview` with `from`, `to`, and optional
`leadInSamples` or `context`. The previews use the native session render
and a common listening loudness and peak ceiling. The gain is recorded
per excerpt. A branch can be planned and saved by omitting `preview`.
The result exposes rejections and choices that sound identical to the
reference. Use the audition report to choose what to keep. The session
recipe retains its authored dynamics.

Use `editor.compose(session, brief)` on
`KIT.procedural.mediaGraph.musicSession.create(assets)` or
`music.composeInSession` in a graph. Outputs are `value` (the report),
`sessions` (the reference and candidate recipes) and `clips` (the optional
listening audio). To continue refining a branch, use its saved session as
the next input.

## Reuse a rhythm across sources

Use a step's `pad` as its logical label. The same step can drive a pitched
note, a named pad of a sample kit, and an editorial Foley clip. Use
`written` to move existing steps by ID while keeping the pattern seed,
conditional hits, and per-hit parameters. `settings.timing` scales the
authored offsets independently of the written beats. Zero leaves the
tempo and swing grid intact. With both dimensions specified the workbench
renders grid, written only, timing only, and both.

```json
{
  "id": "relay",
  "rhythm": {
    "pattern": {
      "id": "answer",
      "length": 4,
      "steps": [
        {"id":"tap","beat":0.5,"pad":"ring","gate":0.25,"offset":-0.014},
        {"id":"reply","beat":2.75,"pad":"ring","gate":0.3,"offset":0.025}
      ]
    },
    "settings": {"startBeat":8,"cycles":2,"scale":{"root":"D4","mode":"dorian"}},
    "written": {"reply":2.5},
    "notes": {"lane":"reed","voices":{
      "top":{"from":"ring","pitches":[{"degree":3},{"degree":5}]},
      "open":{"from":"ring","pitches":["A4","D5"],"transpose":12}
    }},
    "foley": {"lane":"relays","take":"contact","routes":{
      "ring":{"take":"switch","takes":{"switch":{"asset":"relay","sync":{"sample":120}}}}
    }}
  }
}
```

Pass a `pads: {lane, take, kit, routes}` destination with a native
[sample kit](sample-kits.md) and routes like `{ring:{pad:"metal"}}`.
The native kit supplies alternate strikes, choke behavior, inserts, buses
and release behavior. The pattern's per-hit overrides and any triggered
rolls and fills survive routing. Named pitched voices can play scale
degrees or specified MIDI pitches, with independent transposition and
expression. Scale choices apply to degree-based pitches. Foley routes can
use source ranges and sync markers in a session with shared picture.
The generated clip syncs match the projected kit attacks on the sample
grid. Existing instrument attack compensation and groove on a score
track still apply to its pitched notes.

Use `music.projectRhythm` or `mediaGraph.rhythmProjection.project(pattern,
routes, settings)` to create the note clip, pad performance and Foley
clips separately. Here `routes` contains the note voices, pad routes and
Foley routes directly as `notes`, `pads` and `foley`. Use the graph's
`events` and `kitOptions` with `music.renderSampleKit`.

A session audio take can now hold `{kit, performance, at?}`. It plays
through the ordinary mixer and can be edited with `{op:"pad-events",lane,
take,edits}` using existing pad edit operations. Use `audio-select` with
a lane and take name to change its default take. Use `revise-score` with
a native revision to apply a composition decision to the session
reference. Session pins and the current clock still apply.

## Night Relay

```sh
node examples/music-production/composition-workbench.cjs output
```

Open `output/index.html` to compare cue, phrase, gesture, and timing
choices at one playhead. Start with the metal hint, compare the return on
reed and keys, then toggle written rhythm and microtiming independently.
The package contains the samples, all candidate recipes, and a kept
combination with its editable operations and print trace.

The split between authored timing and sound routes draws on event pattern
composition. [SuperCollider pattern composition](https://doc.sccode.org/Tutorials/A-Practical-Guide/PG_06c_Composition_of_Patterns.html) · [Strudel sampling](https://strudel.cc/learn/samples/)
