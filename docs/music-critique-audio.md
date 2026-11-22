# Audio critique workbench

Inspect the actual rendered production, listen to selected audio views,
try an editable fix, and keep the chosen version with a listening reason.
The [blind critique workflow](music-critique.md) remains available for
collecting votes.

```sh
ink-studio music critique inspect cue.json passage.json --out evidence
ink-studio music critique compare cue.json repairs.json --out comparison
ink-studio music critique apply cue.json comparison/comparison.json decision.json --out kept
```

## Pull up a phrase

Ranges use the mixer's beat, bar, second or sample positions. They are
half-open. Use `context` to hear what's on either side without having to
move the focus. A probe runs the score and effects from cue start before
returning the requested audio, and uses the original note lengths even
when a preview ends partway through a note.

```json
{
  "range": {"from": {"beat": 8}, "to": {"beat": 11}},
  "context": {"beforeBeats": 2, "afterBeats": 3},
  "lead": "hook",
  "sampleRate": 32000,
  "views": [
    {"id": "arrival", "mode": "mix", "span": "context"},
    {"id": "hook-solo", "mode": "solo", "tracks": ["hook"]},
    {"id": "keys-solo", "mode": "solo", "tracks": ["keys"]},
    {"id": "without-keys", "mode": "without", "tracks": ["keys"]},
    {"id": "mono", "mode": "mono"}
  ]
}
```

`solo` adds the selected track stems. Include the stem named `room` to
hear the shared room. `without` subtracts selected rendered stems from
the mix while retaining the other rendered contributions, including any
shared room and ducking already present. To hear a genuine change to the
track and its sends, audition a `silence` edit. Probe previews share a
headroom trim and the report measures the original PCM.

The report includes beat, sample and second addresses for candidate
problems and written clip notes. It highlights over-range peaks, mono
loss and simultaneous band energy between the lead and competing stems.
Use the band readings as clues and listen to the actual phrase and
solos. An overlap suggestion has an initial frequency, Q and local gain
cut you can copy or change. The report also includes similar beat
patterns and the underlying measurements by window. [Neutron's masking workflow](https://www.izotope.com/en/learn/unmasking-your-mix-with-neutron)

## Audition a repair

Use the same range and context in the comparison. The edit scope defaults
to the focus. An explicit `range` can address a smaller spot or part of
the surrounding context. Up to six alternatives can be compared at once.

```json
{
  "range": {"from": {"beat": 8}, "to": {"beat": 11}},
  "context": {"beforeBeats": 2, "afterBeats": 3},
  "lead": "hook",
  "sampleRate": 32000,
  "level": "matched",
  "candidates": [
    {
      "id": "local-bell",
      "label": "Cut the upper-mid overlap",
      "edits": [
        {"op": "eq", "range": {"from": {"beat": 8}, "to": {"beat": 9}},
          "parts": ["keys"], "hz": 700, "q": 1.15, "gainDb": -5, "fadeSeconds": 0.025}
      ]
    },
    {
      "id": "softer-answer",
      "edits": [
        {"op": "note", "part": "keys", "clip": "return", "voice": "upper",
          "note": "answer", "set": {"velocity": 0.48}}
      ]
    }
  ]
}
```

Time-scoped operations are `eq`, `level`, `silence`, `register`,
`density`, `room`, `tail` and `depth`, with the usual [cue-map settings](music-cue-map.md).
Omit `parts` to use the normal scope of that cue lane.
`note` edits a written clip note's beat, duration, MIDI, velocity,
expression or tie. Use note addresses from the probe. Edits are validated
by the ordinary production compiler. Conflicts with existing automation,
out-of-range edits and changes to pinned parts appear under `blocked`.

The comparison includes the original and each valid take on the same
sample timeline. The default `matched` matches the context's integrated
loudness under a common ceiling. Use `fixed` to hear changes at a common
playback gain. Per-take focus measurements and band overlaps use the
unscaled render. `differenceRms` uses the raw context to show how much
the edit changed that audio. Audible preference is an editorial
decision. [ITU-R listening test methodology](https://www.itu.int/rec/r-rec-bs.1534/en)

## Keep the heard decision

```json
{"token":"edit-token-from-comparison","take":"local-bell",
 "reason":"The hook reads through the entrance and the chord still rings."}
```

`apply` checks that the production, audio assets and comparison still
match. It writes a portable production recipe, a reusable native revision,
and a searchable listening reference with the recorded reason.
The existing `music critique find` command indexes these decisions too.

JavaScript exposes `KIT.music.production.critique.openAudio(production, assets)`
with `inspect(request)` and `compare(request)`. The handle reuses the
original render for repeated requests over the same sample context.
Use `critique.applyEdit(production, key, decision, assets)` to keep a take.
Graph operations are `music.inspectCritiqueAudio`,
`music.compareCritiqueEdits` and `music.applyCritiqueEdit`. The inspect
node's `clip` port carries the first requested view directly as audio.
The comparison node's `original` and `candidate` ports carry the
original and first valid edited audio. Its `audio` port holds the whole
comparison and `value.blocked` explains unavailable alternatives.

Use [foreground mixing](music-foreground-mix.md) to propose moves that follow
a sequence of foreground tracks and compare rendered balance per moment.

## Test what causes a problem

Run a controlled comparison on a production recipe or a music edit session
recipe with `music critique diagnose source.json request.json --out evidence`.
Use the same native session for diagnosis, keeping the winning edit, and
the final print. Its mixer and warmed effects run through the ordinary
session renderer. The audition adds private post-fader taps for analysis.
A pinned lane or an overlapping alternate take on an edited lane can
block a proposal. Select the reference in that span before diagnosing
an active alternate take on a target lane.

```json
{
  "range": {"from": {"beat": 8}, "to": {"beat": 12}},
  "context": {"beforeBeats": 4, "afterBeats": 1},
  "lead": "hook",
  "level": "fixed",
  "test": {"kind": "masking", "track": "keys", "duckDb": -8, "holdMs": 165}
}
```

Masking returns the same passage with the rival cut, transposed away from
the lead, or briefly ducked around the lead's attacks. Set `semitones` to
choose the interval yourself. Listen to the lead-in (`previous`) and the
two rendered track solos (`solo-anchor` and `solo-target`) for context.
Read `diagnosis.tests` for the cue-map or note edits behind each WAV and
`diagnosis.range` for the focus inside that audio. Use `apply` with the
comparison token and chosen take to save the addressed edit. Applying to
a session writes an editable `session.json` recipe.

```json
{
  "range": {"from": {"beat": 8}, "to": {"beat": 12}},
  "level": "fixed",
  "test": {
    "kind": "groove", "anchor": "kick", "track": "bass",
    "note": {"clip": "return", "voice": "line", "note": "downbeat"},
    "targetMs": 0, "accent": 0.48
  }
}
```

Groove compares accent, trigger timing relative to the anchor, and
sample start independently. A sample-start edit is offered when the
engine can render the addressed note earlier using a supported offset
and still retain its attack energy. The per-take timing separates the
written grid, trigger, and estimated audible onset. That estimate uses
a short energy rise in the isolated rendered voice before the mix.
The two isolated voices (`voice-anchor` and `voice-target`) and the
actual in-context mix are available for listening. A slow attack can
still be the preferred performance.

In JavaScript call `critique.openAudio(productionOrSession, assets).diagnose(request)`.
The graph operation is `music.diagnoseCritiqueAudio`. It exposes the
report, reference audio, all comparison clips, and the key and token for
`music.applyCritiqueEdit`.

## Calibrate a listening model

The example renders an original cue, controlled edits, and a bank of
short listener tests. It includes one artistic roughness question left
unlabeled until someone records a preference.

```sh
node examples/music-production/audio-critique-diagnosis.cjs critique-demo
ink-studio music critique listener-pack critique-demo/listener-recipe.json --out listener
ink-studio music critique listener-run listener/public/manifest.json \
  --endpoint http://127.0.0.1:8767 --model music-flamingo --out listener/responses.json
ink-studio music critique listener-score listener/key.json listener/responses.json --out listener/report.json
```

Each recipe case names two equal-length WAV clips on the same sample
grid, a listening question and a criterion. `kind: "known"` uses an
`expected` side (`left`, `right`, or `tie`). For a preference case,
`kind: "preference"` accepts optional human `votes` using those same
labels. A strict majority supplies the human label. The packer makes
two counterbalanced A/B pairs and one exact identity control for
each case. Keep `key.json` private during listening.

The optional runner targets a loopback [audio.cpp
server](https://github.com/0xShug0/audio.cpp/blob/v0.9.6/docs/models/audio_flamingo.md)
with an Audio Flamingo family model loaded under the selected alias.
The example uses 16 kHz WAVs. Other rates require SOXR in that server.
That backend downmixes stereo for inference. Run stereo judgments with
a backend that preserves the stereo image. Model weights are supplied
separately. `listener-run` saves and resumes from the response file.

Other listeners can use the public manifest and return a record with
`token`, `model`, and `responses`. Each response uses a `trial` ID and
`choice` (`A`, `B`, `tie`, or `abstain`), an optional `reason`, and
optional `evidence` with `side`, `from` and `to` in seconds relative
to that side, and an `observation`. Valid times map back to source
samples. Timestamp validation checks the bounds of a claim.

The score reports agreement across A/B orders, false preferences on
identical audio, abstentions, missing responses and per-criterion
accuracy. A preference with no votes or a split vote remains unlabeled.
The default gate requires at least five completed labeled pairs and
five identity responses per criterion before reporting a pass or fail.
Audition decisions remain explicit edits. JavaScript exposes
`critique.listener.pack` and `critique.listener.evaluate`. The graph
equivalents are `music.packListenerCalibration` and
`music.evaluateListenerCalibration`.
