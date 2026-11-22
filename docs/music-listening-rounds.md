# Listening rounds

Use a round to try many musical alternatives and spend listening time on a
small set. Start from an editable [music session](music-edit-session.md).
The library and CLI use native Ink audio. The optional listening model
runs separately on a local server.

```sh
ink-studio music session listening-round session.json brief.json --out round
ink-studio music session listening-evidence round/sessions/take-012.json request.json --out evidence
ink-studio music session record-round round/review-key.json performance-ballot.json --out history
ink-studio music session keep-round round/review-key.json pick.json --out kept
```

## Scout the sound, then the pocket

A brief names the lead and supplies native instrument patches from a
[playable sound workshop](playable-sound-workshop.md) or other Ink instruments.
Put their sample assets in the ordinary session bank. The scout swaps the
instrument on the same performed lead, including any active alternate take.
It checks attack addresses, gates, pitches, velocity and expression.
Gesture, echo and performance settings on the original patch carry over.
The arrangement and accompaniment are fixed in this first stage.

Use `sources` for up to 64 builds and `relationships` for up to 24
ensemble alternatives. Give each `id`, optional `family` and `label`.
Sources carry a `patch`. Relationships carry a native `revision`, session
`edits`, or both. The second stage crosses only advanced builds with the
relationships and checks the same lead. A defense of a specific kick and
bass relationship should fit in the same performed cue clock.

```json
{
  "id":"return-one",
  "series":"relay",
  "seed":18,
  "lead":"lead",
  "roles":{"kick":"kick","bass":"bass"},
  "context":{"from":{"bar":0},"to":{"bar":5}},
  "call":{"from":{"bar":0},"to":{"bar":1}},
  "recall":{"from":{"bar":3},"to":{"bar":4}},
  "groove":{"from":{"bar":3},"to":{"bar":4}},
  "advance":{"sources":8,"context":9,"disagreement":2},
  "integrity":{"attackWindowMs":140,"attackFloorDb":-57,"nearDistance":0.007},
  "sources":[{"id":"wire","family":"metal","patch":{"type":"fm","index":1.9}}],
  "relationships":[{"id":"together"},{"id":"quiet-bass","revision":{"tracks":{"bass":{"gain":-20}}}}]
}
```

`focus` and `scout` default to `recall`. Choose a shorter scout inside the
focus to save render time. The full pair of windows sits inside `context`.
The fast checks reject full-scale overloads, weak energy near expected hook
attacks, and isolated sample jumps at comp edges or addresses listed as
`integrity.joins`. Choose `joinJump` to set the minimum jump magnitude,
`peakLimit` for a lower sample-peak limit, or `nearDistance` for the
gain-aligned waveform sketch. The attack check uses a bounded window on
the rendered hook tap. Sustaining or overlapping notes can mask an absent
attack. Joins are checked at their addressed sample. These checks screen
technical problems and approximate duplicates.

The experiment advances different sound and ensemble families. It also
reserves full-context slots for cases where foreground and pocket ranks
disagree. The final report gives the metrics, each advance reason and
the actual sessions and audio. The ballot draws from that context group
and includes the original.

## Hear evidence and keep a decision

A listening evidence request contains `focus`, optional `context`,
`solo` and `mute` arrays of lane names, and `repairs` such as
`{id:"local-ride",label:"Lower keys at the pickup",edits:[...]}`.
It renders the prior passage, post-fader solos and an actual source mute
through the desk. The mute also removes that source from its sends and
sidechain keys. Repairs run the addressed edits through the same mixer
and preserve the context. A common playback gain preserves level changes.

To retain a repair, use `music session keep-listening-repair session.json
pick.json --out kept` with `{report:"evidence/report.json",take:"local-ride",
reason:"The pickup reads and the room stays intact."}`.

Open `round/public/index.html` for the blind identity, groove and replay
questions. Send the public folder to listeners and keep the review key
in the project. The browser accepts a favorite, a tie and a separate
written reason per question. For a round pick, use
`{ballot:"path/to/record.json",question:"replay",candidate:"take-012"}`.
Keeping verifies the original WAV, the selected editable session and the
asset bank, then saves the excerpt alongside the session and reason.
Merge the fields in `next-round.json` into a new brief and use the kept
session as its input. The parent includes the kept session fingerprint.

## Compare a model with listeners

The publisher writes `listener-preferences.json` for exact public ballot
pairs of up to 15 seconds per side. Add known edits and aesthetically rough
preference cases to the recipe as needed. Leave a preference unlabeled
until people vote. The optional [listener runner](music-critique-audio.md)
plays both A/B orders and identical pairs to a model, accepts abstention,
and retains raw replies. Artifacts include hashes for the trial WAVs.

```sh
ink-studio music critique listener-pack round/listener-preferences.json --out calibrate
ink-studio music critique listener-run calibrate/public/manifest.json --model music-flamingo --out replies.json
ink-studio music critique listener-score calibrate/key.json replies.json --ballots history --out grade.json
```

Point `--ballots` at an archive directory or a JSON list of archived
records. Only votes over the same question type, sample rate and exact
two excerpts label a pair. A vote that chooses an unrelated finalist
does not label that pair. Ties survive and conflicts from one listener
are treated as unresolved. A human label requires a strict majority.
The report gives order consistency, false choices on identical controls,
accuracy on known edits, human agreement, and coverage. Insufficient cases
stay marked as such. The model never applies a repair or chooses what to
keep. [Music Flamingo](https://arxiv.org/abs/2511.10289) · [Human preference benchmark](https://arxiv.org/abs/2506.19085)

In JavaScript use `editor.listeningRound`, `editor.listeningEvidence`,
and `editor.keepListeningRepair`. The graph nodes are
`music.runListeningRound`, `music.listeningEvidence`, and
`music.recordListeningRound`. Use `mediaGraph.listeningRound.archive`,
`keep`, or `calibrationVotes` with verified audio and records.

## Breakwater

```sh
node examples/music-production/batch-listening.cjs output
```

This example builds 36 instruments from three procedural sources and
crosses eight advanced builds with seven ensemble relationships. Open
`output/index.html` for the public ballot, evidence views and the editable
session. The example also prepares a local model calibration pack with
known changes and the deliberately rough pair.
