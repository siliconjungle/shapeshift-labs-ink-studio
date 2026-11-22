# Production mix tools

Use a preset on a WAV, or audition a single insert in an existing mixer
recipe. The second command uses the same clips, automation, send levels,
and downstream processing on both passes. The report identifies the
strip and insert. Program-dependent processing later in the route can
respond differently to the two passes, and its response is audible in
the difference.

```sh
ink-studio music rack list
ink-studio music rack audition dynamic-eq voice.json --out eq-check
ink-studio music mix audition mix.json --strip keys --insert carve --out insert-check
```

A rack recipe needs a main WAV such as
`{"assets":{"main":"voice.wav"}}`. Audition writes a level-matched bypass
and processed take, plus `difference.wav` for the matched subtraction
and `effect.wav` for the subtraction at original mix gains. The effect
print has its own peak-safety trim. Set `--target-lufs` and
`--ceiling-db-tp` on a mixer audition, or use `targetLufs` and
`ceilingDbTP` in a rack recipe's `options`. Defaults are −18 LUFS and
−1 dBTP. The common target can fall to protect peaks on the compared
prints and their difference. See [audio racks](audio-racks.md) for the
low-level fallback and saved state.

## Dynamic EQ

A `dynamic-eq` insert takes one to six bands in order. Each band
processes both channels with the same gain. An above-threshold detector
can cut or boost within `rangeDb`. A band can also carry a static
`gainDb` offset. All bands detect the same unprocessed insert input
or the strip's external sidechain.

```json
{
  "type": "dynamic-eq",
  "bands": [
    {"mode": "peak", "hz": 310, "q": 1.15, "thresholdDb": -35,
      "ratio": 4, "rangeDb": 6, "attack": 0.008, "release": 0.14},
    {"mode": "high-shelf", "hz": 2900, "direction": "boost",
      "detector": "wide", "thresholdDb": -24, "ratio": 2, "rangeDb": 2}
  ]
}
```

Use `peak`, `low-shelf`, or `high-shelf` for `mode`. The default band
detector listens through a bandpass, lowpass, or highpass respectively.
Set `keyHz` for an independent bandpass and `keyQ` for its width. A
`wide` detector reads the full key signal. Frequency, Q, gain,
threshold, ratio, and range accept mixer automation. `attack` and
`release` are fixed seconds.

## Oversampled clipping and saturation

`clipper` defaults to 4× oversampling. Use `oversample: 2`, `4` or
`8` for either nonlinear insert. The existing `saturation` type
selects its original processing when `oversample` is omitted.

```json
{
  "drum-clip": {"type": "clipper", "oversample": 4, "driveDb": 5,
    "ceilingDb": -5, "kneeDb": 1.5, "outputDb": -2},
  "bass-color": {"type": "saturation", "oversample": 4, "driveDb": 8,
    "bias": 0.12, "toneHz": 9300, "outputDb": -3}
}
```

A zero knee clips hard. Positive `kneeDb` softens the transition around
the clip point. The clip point sets the waveshaper ceiling. Reconstruction
and output trim can produce peaks above it, so use the mixer's
`limiter` when delivery needs a true-peak ceiling. Oversampled inserts
run offline with 48 samples of compensated lookahead.

## Captured rooms

The `typing-room`, `factory-warehouse`, and `lady-chapel` racks put
a stereo convolution on a send and expose a room amount macro. Their
impulses are conditioned excerpts of the University of York
OpenAIR measurements. The included source notes list authors,
license, exact source files, fades, resampling, and gain adjustments.
Use `rateCompensate: true` on a convolution insert to preserve its
calibrated impulse gain across render sample rates.
[Capture credits](../examples/audio-racks/rooms/credits.json)
· [University of York OpenAIR](https://www.york.ac.uk/physics-engineering-technology/research/communication-technologies/projects/open-acoustic-impulse-response-library/)

`node examples/music-production/mix-tools.cjs return-signal` builds
a playable demo with editable rack and mixer recipes, rendered WAVs,
and the room assets.
