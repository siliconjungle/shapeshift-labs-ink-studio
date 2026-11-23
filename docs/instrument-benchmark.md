# Instrument benchmark

Play one scored performance through a native Ink patch and a CLAP
instrument. The command checks that the performed events agree, then
matches the level of the isolated instruments before running both through
one mixer recipe. It also matches the playback loudness of the two mix
prints. The backing assets, sends, inserts, and edit boundaries come
from the same recipe on both passes.

\`\`\`sh
ink-studio music production instrument-benchmark suite.json \\
  --clap-host host.json --preset-root /path/to/SurgeXTData --out comparisons
\`\`\`

Use \`--case saw\` to repeat a single comparison. \`--preset-root\` sets the
base directory for preset files in the suite. Presets default to paths
relative to the suite. Backing assets always resolve relative to the
suite. See [CLAP instruments](clap-instruments-and-handoff.md) for registering
the worker and plugin. The benchmark was tested with the CLAP 1.2.5 SDK.

## Wavetable listening study

Run \`node examples/music-production/wavetable-benchmark.cjs benchmark\` to
build the six performances, their backing WAVs, and \`benchmark/suite.json\`.
Register [Surge XT 1.3.4](https://github.com/surge-synthesizer/releases-xt/releases/tag/1.3.4)
as the alias \`surge\` with plugin ID \`org.surge-synth-team.surge-xt\`. Point
\`--preset-root\` at its installed content directory, which contains
\`patches_factory\` and \`patches_3rdparty\`. On macOS the CLAP binary can be
registered directly from the portable plugin bundle.

| Case | Ink patch | Surge preset | Listen for |
| --- | --- | --- | --- |
| \`sub\` | Sine with a quiet second harmonic | Sub 3 | Fundamental, attack, and release beside the kick |
| \`reese\` | Detuned saw and pulse pair | Primitive Reese by Vospi | Sustained beating, weight, and mono fold |
| \`vowel\` | FM and movable resonant bands | Formant Tables by Sola | Movement across vowel shapes and how the attacks stay legible |
| \`saw\` | Seven-oscillator modular saw stack | JP8K Supersaw by Luna | Width, definition, and how the held lead stays centered |
| \`pad\` | Modulated filter with a fixed-Hz LFO | MW Pulsating | Pulsation through the 110 to 138 BPM change |
| \`pluck\` | FM pluck | Clean | Transient clarity and the shape of the release |

The suite bypasses Surge's internal effect chain, brings the sub and
vowel presets to the score register, turns up the pad's synced LFO amplitudes, and uses the same
mixer effects for both engines. The synths retain their own voice settings. The
comparison tests each chosen patch and performance as a combination.

The backing uses kick, snare and hat recordings from the Versilian
Community Sample Library, released under CC0.
[Sample credits](../examples/native-sound-library/recordings.json)

## Author a case

Use the format \`ink-studio/instrument-benchmark\`, version 1, with a
\`reference\` label and a \`cases\` array. Each case has an \`id\`, \`title\`,
and a normal \`production\` with one focus track and at most 20 seconds
of authored material. Its \`reference\` is a regular \`type: "clap"\` patch.
Supply a preset file and optional \`snapshotParameters\` to initialize it,
or use a previously captured state and identity on the patch.
The \`assets\` table supplies shared WAVs. Give the mixer an explicit
sample rate and put a clip with \`source: "instrument"\` wherever the
matched instrument belongs. Optional settings in \`options\` include
\`tail\` in seconds, \`soloLufs\`, \`mixLufs\`, and \`ceilingDbTP\`.

Each case folder contains matched solo and context WAVs, the common
played events, and a MIDI file made from the native performance.
The report records levels, fold-down, gains, note counts, latency,
and hashes for the performance and shared assets. Matching can lower
the target when a peak limit binds. Use the paired audio to judge the
sound and the report to explain differences in level, width, or timing.
