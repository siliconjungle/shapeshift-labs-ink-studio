# Playable sound workshop

Start with an audible sound and try several ways of making it respond to
the same performance. Ink saves each build as an editable instrument
patch. Keep a build across the keyboard or use several builds in
different key and velocity zones. One held trigger of a chosen build can
then suggest a new motif from its measured pitch and attacks.

```sh
ink-studio music instrument workshop source.json --out bank
ink-studio music instrument audition-workshop bank/workshop.json audition.json --out review
ink-studio music instrument keep-workshop bank/workshop.json keep.json --out kept
```

## Build from a source

```json
{
  "source": {
    "gesture": {
      "model": "breath",
      "seed": 56,
      "duration": 0.88,
      "parameters": {"pitchStart": 250, "pitchEnd": 340, "voice": 0.91}
    }
  },
  "options": {
    "id": "reed",
    "fit": {"attackMs": 46},
    "variants": [
      {"id": "sample", "family": "sample"},
      {"id": "strike", "family": "attack"},
      {"id": "bend", "family": "contour"},
      {"id": "wire", "family": "handoff", "tail": "wire", "phase": 0.66, "blend": 0.16}
    ]
  }
}
```

The source can also be a WAV path, a WAV slice, or a library sample,
sample edit, or print reference. Those use the same fields as the
[sample instrument builder](sample-instrument-builder.md). The workshop
fits one mono or stereo gesture, 20 ms to six seconds at 8–96 kHz. It
saves the source, the attack asset, editable patches and an analysis report.

| Family | Playable result |
| --- | --- |
| `sample` | Play the original active sound across the keys with native sampler speed and envelope. |
| `attack` | Start with the captured attack and crossfade into the fitted body. The short attack retains its original pitch across keys. |
| `contour` | Play the fitted harmonic and noise layers, including the source's pitch motion. |
| `modal` | Play a fitted exciter and resonances. Available when the source yields a usable modal fit. |
| `handoff` | Crossfade a fitted body to a separately shaped breath or wire voice. |

Omit `variants` to get sample, attack, contour and both handoff voices.
Supply up to twelve named variants. Set `motion` from 0 to 1.75 on an
attack, contour or handoff to scale the fitted pitch movement. The
workshop uses the measured voiced trajectory where there is sustained
pitch evidence. Set `trackPitch: false` to use the fitter's ordinary
classification for noisy or inharmonic material. Fit up to two partials
inside the workshop to leave room for the handoff nodes.

For a handoff, `phase` and `blend` set the midpoint and width in fractions
of the performed gate. The default midpoint follows the measured decay
within a playable range. The voices meet in an equal-power crossfade.
`tailDb` adjusts the second voice. The resulting graph retains both
voices and their blend and envelope nodes for editing.

## Audition the same phrase

```json
{
  "pitches": ["A3", "C4", "F4"],
  "velocities": [0.42, 0.84],
  "anchor": {"key": "C4", "velocity": 0.84},
  "candidates": ["sample", "strike", "bend", "wire"]
}
```

Ink uses one short score to test a soft entrance, two strikes at the
same pitch, a connected interval, and a held note into release. It renders
the actual instrument performance through the production renderer. To
supply a different probe, set `options.performance` during build with
`tempo`, `beats`, and `notes`. Each note uses `id`, `beat`, `duration`,
`transpose` in semitones from the tested key, `velocity` as a multiplier of
the tested velocity, and optional native note `play` curves.

The anchor is the pair used for the listening reel and level match. The
same gain is applied to every test of a build, so quiet playing and
register changes remain audible. Set `targetRmsDb` to adjust the playback
target or `match: "shared"` to preserve the builds' authored relative levels. The review writes the reel, individual
takes at every tested key and velocity, and exact note and clip sample
addresses.

The report compares attack, body and tail using normalized envelope and
brightness. It also estimates voiced pitch span and relative contour
error in cents from a separate held trigger. Lower distance suggests a
closer match to the source on that measure. Sparse voiced evidence gives
a null pitch comparison. Use the independent measurements to shortlist
and the rendered phrase to choose.

## Keep a playable instrument and derive the motif

```json
{
  "candidate": "bend",
  "trigger": {"key": "C4", "velocity": 0.78},
  "projection": {"beats": 2.5, "pitchStep": 2.3, "minNoteMs": 80},
  "zones": [
    {"id": "quiet", "candidate": "strike", "low": 48, "high": 67, "velocity": [0, 0.57]},
    {"id": "open", "candidate": "wire", "low": 48, "high": 67, "velocity": [0.57, 1]}
  ],
  "fallback": "bend"
}
```

The selected `candidate` generates one dry trigger. The workshop
projects that new audio into ordinary `contour`, `attacks`, and `tail`
motifs with sample-derived identities. The diagnostic phrase is separate
from this step. Use `from: "source"` to project the original recording.
Sources without a reliable pitch contour still yield attack and tail motifs.
Use `analysis` with the keep request to refine detection on this trigger
or original source. The full projection settings are documented under
[compose from a recorded gesture](timbre-composition.md).

The saved `instrument.json` uses a normal `type: "zoned"` production patch.
Each zone selects a named native instrument from `instruments`. Key bounds
are inclusive. The lower velocity bound is inclusive and the upper is
exclusive, except that 1 includes full velocity. Zones cannot overlap.
Optional `gainDb` trims one zone, and `fallback` names the instrument for
untested keys and dynamics. Without a fallback, uncovered keys or
velocities are silent. Keep the raw graphs, samples and performance map
together for reuse in a score or edit session.

Use `music.buildPlayableSound`, `music.auditionPlayableSound`, and
`music.keepPlayableSound` in a headless graph. JavaScript exposes
`KIT.procedural.mediaGraph.playableSound` with `build`, `audition`, and
`keep`. The keep node exposes the patch, motif, and assets on separate sockets.

## Fog Hinge demo

```sh
node examples/music-production/playable-sound-workshop.cjs output
ink-studio music session render output/sketch-session.json --out replay
```

The reel starts with a procedural three-puff source call. Five instruments
then play the same test phrase. The sketch starts with the source again,
then uses the fitted instrument's projected contour as a melody and its
attacks as a percussion answer. It keeps separate quiet, low firm and
high firm playing zones in an editable session.
