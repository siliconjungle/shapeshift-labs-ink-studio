# Audio racks and adapters

A rack packages an Ink mixer graph and exposes its input ports, macros,
and taps. It can take a new recording without changing its routes or
processor settings. The state is a small JSON document. It recalls
macro values, automation and bypass with the definition and revision
that authored them.

```sh
ink-studio music rack list
ink-studio music rack describe porcelain-room --out room.json
ink-studio music rack state porcelain-room settings.json --out room-state.json
ink-studio music rack render porcelain-room recipe.json --out take
ink-studio music rack audition porcelain-room recipe.json --out comparison
```

| Preset | Try it on | Macro controls |
| --- | --- | --- |
| Steel Bus | Drums or short percussion | Attack and parallel weight |
| Porcelain Room | Spaced chords and plucks | Room distance and shade |
| Pocket Repeater | Metallic phrases or sampled hooks | Capture clock and ghost send |
| Dynamic EQ | Buildup on keys, vocals, or a bus | Low-mid and presence cut |
| Oversampled Clipper | Peaks on drums or a mix bus | Drive, soft knee, and clip point |
| Oversampled Saturation | Bass, keys, and subgroups | Drive, tone, and bias |
| Terry’s Typing Room, Terry’s Factory Warehouse, Lady Chapel | Three measured spaces | Room amount |

```json
{
  "assets": {"main": "keys.wav"},
  "state": {
    "macros": {
      "distance": 0.7,
      "shade": {"unit": "beats", "points": [{"at": 0, "value": 0.15}, {"at": 6, "value": 0.8}]}
    }
  },
  "options": {"sampleRate": 24000, "map": {"tempo": 116}, "end": {"beat": 8.5}, "tail": "cut"}
}
```

A recipe can reference a saved state file relative to itself. In a
definition, `inputs` maps port names to empty mixer strips and must
include `main`. A second port can supply an inaudible key for
sidechain processing. A definition can declare WAV assets such as
impulses in an optional `assets` table, with paths relative to the
definition. Recipe assets can override these references. Exporting
a definition with `describe --out` rebases its asset paths. Keep or copy
the WAVs when moving the definition to another machine.
Macros map a normalized value or lane into one or more numeric mixer
controls. A target specifies a path and two endpoint values, which may
have descending order. Set `bypass: true` in a state to route the main
port directly to the output. Keep the rack definition with the state
file to replay it.

`audition` writes `rack.wav` and `bypass.wav` on the same sample
grid, with a common integrated loudness target. A very short or quiet
phrase uses RMS when both prints have a measurable level. The report
records the matching method, both gains, and the true-peak ceiling.
`difference.wav` subtracts the matched bypass from the matched rack.
`effect.wav` subtracts the bypass at the original mix gains, with a
separate peak-safety trim. For a parallel room, it isolates the
reflections. The production render keeps the rack's gain staging.
See [production mix tools](production-mix-tools.md) for processor
settings and an in-context insert comparison.

Use `audio.renderRack` and `audio.auditionRack` in a headless graph.
Their audio outputs can feed another rack, a mixer, or an audio print.
The JavaScript API is
`KIT.procedural.mediaGraph.audioRack` with `state`, `render`, and
`audition`.

## Offline CLAP

The optional CLAP adapter runs a selected plug-in in a separate worker
process. Build the worker against the upstream SDK. It supports a
stereo audio effect with one stereo output and an optional mono or
stereo key input. The worker restores opaque plug-in state, sends
parameter events at sample offsets, and returns aligned audio
with the declared latency removed. The mixer plans the tail and
compensates parallel and key paths as with native effects.
[CLAP SDK](https://github.com/free-audio/clap)

```sh
c++ -std=c++17 -O2 -I /path/to/clap/include scripts/clap-host.cpp -o clap-host
ink-studio music rack plugin-info relay --clap-host manifest.json
ink-studio music rack plugin-state relay settings.json --clap-host manifest.json --out plugin-state.json
ink-studio music rack audition relay-rack.json recipe.json --clap-host manifest.json --out comparison
```

On Linux add `-ldl` if required by the toolchain. The manifest explicitly
selects local binaries. A macOS bundle with one executable is accepted.
Use the full binary path for a bundle with multiple executables.

```json
{"worker":"./clap-host","plugins":{"relay":{"file":"./Relay.clap","id":"org.ink.rack-fixture"}}}
```

An external processor uses
`{"type":"external","adapter":"clap","plugin":"relay"}`. Copy the
`state` and `identity` fields from `plugin-state` into that processor to
recall its snapshot and pin the binary identity. Optional
`parameters` use the numeric IDs from `plugin-info` and are applied
over the saved state. Macro target paths can address numeric
parameter IDs. The same `--clap-host` option works on `music mix render`.
Register plug-ins and workers you trust. Process isolation contains a
worker crash, while the plug-in runs with the account's permissions.

The worker handles offline effects and
[CLAP instruments](clap-instruments-and-handoff.md).
The supported effects contract is fixed channel layout, latency,
and finite tail per render. The built-in graph nodes run native racks. JavaScript callers can supply trusted implementations to
the mixer or rack as `{adapters:{name:{describe,render}}}`. The
adapter declares parameter ranges, latency, tail, sidechain support,
and identity. Its render call receives score-aligned stereo audio,
optional key audio, a state snapshot, and parameter knots in samples.
It returns a `Float64Array` of exactly the requested aligned frames.

## Signalsmith Stretch and Faust evaluation

- **Signalsmith Stretch** at `88061fd`, with Signalsmith Linear
  `0.6.6`, rendered one second of stereo input into exactly 72,000
  frames at 48 kHz while transposing it seven semitones. A 220 Hz
  test tone measured 330 Hz after processing. The default preset
  reported 2,880 samples each of input and output latency. A future
  integration fits clip warp, with separate source and destination
  lengths and seek and flush handling. [Signalsmith Stretch](https://github.com/Signalsmith-Audio/signalsmith-stretch)
- **Faust** via `@grame/faustwasm@0.23.0` and compiler
  `2.95.0` compiled a stereo gain and one-sample delay to WASM.
  The offline probe changed a parameter at a 128-frame callback
  boundary and recalled that value in a fresh instance. A future
  module wrapper needs to provide timing metadata and bridge
  sample-offset lanes through smaller blocks. Faust's JSON UI
  metadata gives that wrapper stable parameter paths and ranges.
  [Faust deployment docs](https://faustdoc.grame.fr/manual/deploying/)

The optional probes live under `examples/audio-racks`. The Signalsmith
probe builds with both upstream header directories on the include
path. Run the Faust probe with the installed package directory.
Neither library is a dependency of the shipped racks.

```sh
c++ -std=c++17 -O2 -I /path/to/stretch -I /path/to/linear/include examples/audio-racks/signalsmith-probe.cpp -o signalsmith-probe
./signalsmith-probe
node examples/audio-racks/faust-probe.cjs /path/to/node_modules/@grame/faustwasm
node examples/audio-racks/workshop.cjs output
```

The workshop generates inputs for its three example presets and prints matched
A/B takes. Pass a fixture manifest as a second argument for the
optional CLAP comparison. Its plug-in alias must be `relay`.
The fixture verifies state, key routing, automatable trim, a seven-sample
latency, and a 29-sample tail.

```sh
# macOS. On Linux use -shared -fPIC in place of -dynamiclib.
c++ -std=c++17 -O2 -dynamiclib -I /path/to/clap/include examples/audio-racks/clap-fixture.cpp -o Relay.clap
node examples/audio-racks/clap-smoke.cjs manifest.json relay
node examples/audio-racks/workshop.cjs output manifest.json
```
