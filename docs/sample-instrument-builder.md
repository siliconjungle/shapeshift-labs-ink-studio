# Build a pitched instrument from recorded gestures

Analyze a slice or a bank of takes, listen across registers, and keep the
ranges that work. The builder writes a standard Ink production sampler
patch, the baked WAVs it needs, and the names and source takes of the
registers you picked.

```sh
ink-studio music instrument analyze instrument-recipe.json --out analysis.json
ink-studio music instrument audition instrument-recipe.json --out range-review
ink-studio music instrument build instrument-recipe.json --out instrument
```

## Choose and inspect the takes

The `assets` table accepts relative WAV paths and explicit WAV slices.
It also accepts the catalog sample, sample-edit slice and audio-print
references used by [sample kits](sample-kits.md). Supply a relative
`library` path for catalog samples or edits.

```json
{
  "assets": {
    "close": {"wav": "close.wav", "fromSample": 3200, "toSample": 33400},
    "wide": "alternate.wav",
    "breath": "breath.wav"
  },
  "analysis": {"lowHz": 65, "highHz": 900, "attackMs": 32},
  "audition": {
    "offsets": [-5, -2, 0, 3, 7],
    "shape": {"duration": 0.72, "formantCents": 0}
  },
  "zones": [
    {
      "id": "air",
      "label": "Breath pulse",
      "low": 48,
      "high": 48,
      "root": null,
      "takes": ["breath"],
      "shape": {"duration": 0.6, "formantCents": -500}
    },
    {
      "id": "answer",
      "label": "Close and wide answers",
      "low": "A3",
      "high": "E4",
      "takes": ["close", "wide"],
      "roots": {"close": "A3", "wide": 57.22},
      "shape": {"duration": 0.72, "formantCents": 0, "attackFrames": 960}
    }
  ]
}
```

Analysis gives a proposed root in Hz and fractional MIDI, a nearest
key, a confidence score, and the voiced pitch track. The confidence
combines periodicity, voiced coverage, and agreement with the proposed
root. A wide glissando may be voiced and still have a weak root. An
unpitched breath can have no root. Attacks and active aperiodic regions
are reported on the analyzed slice's native sample grid. The report also
gives an opening attack length and source provenance. [YIN paper](https://www.ee.columbia.edu/~dpwe/e6820/papers/deChevK02-yin.pdf)

The range audition writes a stereo reel and a report with the exact
start and end of each take and semitone offset. It peak-matches the
segments with bounded gain. Offsets are relative to the recorded pitch.
Set `audition.shape` to hear a constant duration or another formant
setting across the range. Edit the draft zone names, key limits, and
roots after listening.

## Shape the body

| Control | Meaning |
| --- | --- |
| `pitchCents` | Carrier transposition in cents, within two octaves. A zone adds this to the key-to-root transposition. |
| `duration` | Multiplier of the original duration, from 0.5 to 2. |
| `formantCents` | Approximate spectral envelope shift relative to the original. Zero preserves the original envelope target. Negative values can darken the vowel without lowering the note. |
| `attackFrames` | Exact source prefix to copy at its original rate and level. Zones default to the analyzed opening attack. Zero shapes the whole slice. |
| `joinFrames` | Crossfade inside the processed body. Defaults to 13 ms or the available overlap. |
| `mode` | `tones` for the phase-vocoder body warp or `speech` for overlap-add. The builder defaults to speech for sources without a root. |
| `fundamentalHz` | Optional guide for estimating the spectral envelope. The builder uses the proposed fundamental when available. |

Ink stretches and transposes the body with its native warp modes, then
adjusts a smoothed spectral envelope with a shared stereo estimate.
The protected source prefix stays sample-identical in the graph
output. A long protected prefix leaves less room for shortening. The
formant control also colors aperiodic material, where there is no
stable sung vowel to preserve.

## Save and play the instrument

`instrument.json` contains `patch`, relative `assets`, and labeled
`zones`. Copy `patch` into a [music production](music-production.md)
and resolve its asset paths relative to the saved instrument. The
ordinary production CLI and graph can play it. Each selected key has a
baked clip, so key changes keep the saved duration. The existing
sampler handles round robins, velocity filtering, articulations, and
mixing. Ordinary post-bake note bends use the production sampler's
varispeed playback.

Set `root` to override every take in a register or use `roots` to
override individual takes. Use `null` for a trigger that should
retain its source pitch across keys. Each take can be assigned to
several registers with different shaping. The archive is bounded
by the production sampler's 96 zones and 128 audio assets.

Use `audio.analyzeInstrumentSamples`, `audio.auditionInstrumentRange`,
`audio.shapeInstrumentSample`, and `audio.buildSampleInstrument` in
headless graphs. The build node returns the normal patch at `value`,
decoded baked clips at `assets`, and key labels and processing at
`report`. JavaScript uses `KIT.procedural.mediaGraph.sampleInstrument`.

Use [sample-to-motif audition](sample-motif.md) to compare a recording as a
cue, playable lead, rhythmic accent and granular texture over the same score.

## Workshop and adapter comparison

```sh
node examples/music-production/sample-instrument-workshop.cjs output
```

The workshop generates a breath, laugh-like gesture, and two sung
glides procedurally by default. Optional mono 32 kHz recordings provide
the breath and laugh used in the published review. The workshop expects
the original files so it can trim its known excerpts. [Breathing man by hugh](https://commons.wikimedia.org/wiki/File:Breathing_man.ogg) · [Laughter and clearing voice by Ezwa](https://commons.wikimedia.org/wiki/File:Laughter_and_clearing_voice.ogg)

For the offline comparison, compile the optional probe against
Signalsmith Stretch `88061fd` and Signalsmith Linear `0.6.6`. Pass its
path after the two recordings. The workshop prints both processors
with the same pitch, length, formant, attack, and join settings and
writes a comparison reel and report. Both handled the full gestures.
The native path also rendered the 65 ms one-shot with its attack
pinned. The tested Signalsmith exact-render preset required more
pre-roll for that slice. Ink uses its native path in the builder.
[Signalsmith Stretch](https://github.com/Signalsmith-Audio/signalsmith-stretch)

```sh
c++ -std=c++17 -O2 -I /path/to/stretch -I /path/to/linear/include \
  examples/audio-racks/signalsmith-gesture-probe.cpp -o signalsmith-gesture
node examples/music-production/sample-instrument-workshop.cjs output breath.wav laugh.wav ./signalsmith-gesture
```

## Fit a synthesizer to a recording

The [recording fitter](recording-instrument-fit.md) proposes editable
oscillator, resonator, and recorded-attack graph patches from a single
slice. Use it when you want to reshape the model and play it in another
register or at another length.

Use the [playable sound workshop](playable-sound-workshop.md) to compare
these source-based approaches on a shared performance, keep playable
zones, and derive a motif from the chosen sound.
