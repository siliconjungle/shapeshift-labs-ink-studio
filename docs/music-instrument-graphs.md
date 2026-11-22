# Modular instruments

A production patch with `type: "graph"` runs its own signal graph for each
performed note. Oscillator phase, delay memory and filter and resonator state
belong to that note. Use the same patch in a score slot, an alternate take or
a live edit session. The patch uses the production's WAV asset table.

This graph lets pressure add level and breath open a low-pass filter. The
envelope is a regular node whose output modulates the gain.

```json
{
  "type": "graph",
  "output": "voice",
  "tail": 0.28,
  "nodes": {
    "reed": {"type": "oscillator", "wave": "pulse", "width": 0.32},
    "tone": {"type": "filter", "input": "reed",
      "cutoff": {"base": 380, "by": {"breath": 3400}}, "resonance": 1.6},
    "shape": {"type": "envelope", "env": {"attack": 0.08, "decay": 0.25,
      "sustain": 0.8, "release": 0.22}},
    "pressure": {"type": "gain", "input": "tone",
      "amount": {"base": 0.22, "by": {"pressure": 0.6}}},
    "voice": {"type": "gain", "input": "pressure", "amount": {"base": 0, "from": {"shape": 1}}}
  }
}
```

In a written note or motif event, put constants and curves inside `play`.

```json
{"play":{"pressure":0.38,"curves":{
  "breath":[[0,0.02],[0.48,0.93],[1,0.13]],
  "damping":[[0,0.09],[0.66,0.2],[1,0.87]],
  "contact":[[0,0.14],[0.8,0.39],[1,0.39]]
}}}
```

Values are normalized to 0–1. A curve overrides a note constant, which
overrides the named patch default in `controls`. The defaults are
pressure 0.5, breath 0, damping 0.25 and contact 0.5. Curves use Ink's
performed-note phase, hold their last value into release, and can come
from a performance rule. The graph defines what each control does.

## Nodes and routing

| Node | Audio inputs and parameters |
| --- | --- |
| `oscillator` | Sine, triangle, saw, or pulse. `ratio` and `detune` in semitones offset the played pitch. Fixed `hz` supports LFOs and fixed-frequency carriers. Pulse `width` is 0.04–0.96. Sine can take `phaseInput` with `index` in turns. Initial `phase` is in turns. |
| `noise` | A seeded bipolar source. |
| `sample` | Reuse sampler `zones` and `env`, with root pitch, looping, articulation and round robins. Use `channel` to read `left`, `right` or their average (`mix`, the default). `startSeconds` delays playback, and `offsetSeconds` skips into the source independently of the delay. |
| `curve` | Piecewise-linear `points` such as `[[0, 0], [0.2, 1], [1, 0.3]]`. With `clock: "gate"` (default) the x axis is normalized note phase. With `clock: "seconds"` it is time since note-on. The endpoint values hold outside the curve. Use `from` to route the value into another node. |
| `envelope` | A gated envelope with `env` settings for attack, decay, sustain and release. Route it to a parameter with `from`. |
| `mix` | Sum up to 16 named `inputs`. Use gain nodes for a weighted mix. |
| `blend` | Crossfade two named `inputs` on a shared clock. `position` is modulatable from 0 to 1. Use `law: "linear"` (default) or `"equal-power"`. An optional `window: [low, high]` sets where the crossfade starts and ends. |
| `gain`, `drive` | Apply `amount` to an `input`. Drive uses a tanh waveshaper. |
| `filter` | Low-pass, high-pass or band-pass `mode`, with `input`, `cutoff` in Hz and `resonance` as Q. |
| `resonator` | Excite up to 12 damped modes from one `input`. Each mode needs a frequency `ratio` and can set `gain`, relative `decay` and integer `shape`. The node tracks note pitch, with optional fixed `hz` and a node-wide `ratio`. Node `decay` is the time to drop 60 dB, in seconds. A mode with a shape receives excitation proportional to `sin(π × shape × contact)`. The contact input defaults to the note's contact position. |
| `delay` | Read past audio and write from an `input`. Set one of `samples` or `seconds` and a signed write `gain` up to 0.98 in magnitude. |

A modulatable parameter takes a number or
`{base, by: {control: depth}, from: {node: depth}}`. The renderer adds each
source times its depth and clamps to the parameter's range. In addition to
pressure, breath, damping, contact and room, `by` can read `velocity`, `gate` (1 while
held), `key` (MIDI note divided by 127), and `phase` (0–1 over the gate).
`from` reads the current output of a node. For example, a sine oscillator
at `hz: 0.4` can open and close a filter around its authored cutoff.

Choose a mono `output` by ID or a stereo output with `{left, right}`.
`tail` sets how long the voice keeps running after note-off, up to six
seconds. The graph can run up to 32 nodes, and only executes nodes with a
path to the output. Articulations can override named node settings,
expression defaults and the output or tail.

To form feedback, send part of a mix through a delay and return the delay
output to that mix. Delay writes occur after the whole graph has rendered
one sample. This also allows a filter or a saturator inside the circuit.
The engine rejects cycles without a delay and saturates the delayed write
to bound the stored signal. The combined delay lines are limited to half
a second of memory per voice at the minimum supported sample rate.

```sh
ink-studio music production inspect-instrument patch.json
ink-studio music production render cue.json --out print
```

For a sample-based graph, the inspect recipe is `{patch,assets}`, where
`assets` maps names to relative WAV paths. Inspect reports evaluation order,
asset requirements, feedback writes and parameter wiring. The JavaScript
tool is `KIT.music.production.inspectInstrumentGraph(patch, assets?)`.
The graph node is `music.inspectInstrumentGraph`.

For background on the exciter–resonator model, see Julius O. Smith III's
[Modal Expansion](https://www.dsprelated.com/freebooks/pasp/Modal_Expansion.html).
