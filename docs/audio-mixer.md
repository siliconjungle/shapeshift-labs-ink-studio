# Mixer routing and automation

Use the offline mixer for recorded material, score stems, or audio from graph
nodes. The mix recipe lives separately from any score. A strip reads clips
and incoming routes, runs its inserts in order, applies a fader and stereo
balance, and routes its output to another strip. [Avid on clip gain](https://resources.avid.com/SupportFiles/PT/Pro_Tools_Quick_Reference_Guide.pdf)
 · [Steinberg on processing and latency](https://steinbergmedia.github.io/vst3_dev_portal/pages/FAQ/Processing.html)

```sh
ink-studio music mix render session.json --out take
```

```json
{
  "assets": {"drums": "drums.wav", "keys": "keys.wav"},
  "mixer": {
    "id": "room-mix",
    "sampleRate": 48000,
    "map": {"tempo": 112},
    "end": {"beat": 16},
    "tail": "keep",
    "output": "master",
    "strips": {
      "drums": {
        "clips": [{"id": "main", "source": "drums", "at": {"samples": 0}, "gainDb": 2}],
        "output": "rhythm",
        "sends": {"crush": {"tap": "pre", "level": 0.36}}
      },
      "crush": {"inserts": ["parallel"], "output": "rhythm"},
      "rhythm": {"fader": 0.8},
      "keys": {
        "clips": [{"id": "chords", "source": "keys", "at": {"seconds": 0}}],
        "inserts": [{"processor": "duck", "sidechain": {"strip": "drums", "tap": "pre"}}],
        "sends": {"room": {"tap": "pre", "level": 0.35}}
      },
      "room": {"inserts": ["plate"]},
      "master": {}
    },
    "processors": {
      "parallel": {"type": "compressor", "thresholdDb": -20, "ratio": 4, "lookahead": 0.012},
      "duck": {"type": "compressor", "thresholdDb": -22, "ratio": 5, "lookahead": 0.008, "wet": 0.8},
      "plate": {"type": "reverb", "decay": 1.6, "size": 1.15}
    },
    "taps": {"dry": {"strip": "keys", "tap": "input"}, "wet": {"strip": "room"}}
  }
}
```

## Signal flow

- **Clip gain** is applied to each clip before summing and inserts.
  `fromSample` and `toSample` select a half-open range in the original
  WAV. `at` places that range on the session timeline. The mixer converts
  mono or stereo sources to the session's stereo sample grid.
- **Inserts** name processors in a separate bank. Replace a definition or
  reorder the strip's insert names without editing the clips or score.
  An insert can take its dynamics detector from another strip's
  `input`, `pre`, or `post` tap. Leave the sidechain out to detect the
  insert's own input. An inaudible key strip can use `output: null`.
- **Input gain** takes a linear 0–1 value before inserts and before the
  input tap. It can be automated with `inputGain`.
- **Faders** take a linear gain, with 1 at unity and 0 at silence. Stereo
  balance runs from −1 to 1. A `pre` send reads the output of the insert
  chain just before fader and balance. A `post` send reads after both.
  Send levels are linear. Incoming sends and strip outputs sum at the
  receiver's input. Use a receiving strip as a group, effect return, or
  parallel path. A non-master strip with no explicit output routes to the
  master. Routing and sidechain dependencies must form an acyclic graph.

## Automation

Replace a static control with a lane. Use `unit` of `beats`, `seconds`, or
`samples`, and order its points by position. The default `linear`
curve ramps between the resolved sample positions. Use `hold` for
steps. Values hold before the first and after the last point. Musical
points follow the session tempo and swing map, and can use exact
`{numerator, denominator}` positions. When points land on the same
sample, the later point wins.

```json
{
  "unit": "beats",
  "curve": "linear",
  "points": [{"at": 12, "value": 1}, {"at": 16, "value": 0}]
}
```

Input gain, fader, balance, send level, and insert automation use the session
timeline. Clip gain automation moves with its clip and starts at
the placed clip onset, including when the clip uses a trimmed source range.
Beat, second, and sample lanes can coexist in one mixer.

| Native insert | Parameters |
| --- | --- |
| `gain` | `db` |
| `drive` | `amount` |
| `lowpass`, `highpass` | Cutoff `hz` |
| `delay` | Fixed `seconds`, automated `feedback` |
| `reverb` | Fixed `size` and `decay` in seconds, automated `damping` |
| `compressor` | Automated `thresholdDb`, `ratio`, and `makeupDb`, with fixed `attack`, `release`, and `lookahead` in seconds |
| `eq` | Up to eight parametric bands with automated frequency, Q, and bell or shelf gain |
| `dynamic-eq` | Up to six stereo-linked dynamic bells and shelves with an optional external key |
| `clipper` | 2×, 4×, or 8× oversampling with drive, clip point, knee, and output trim |
| `gate`, `expander` | Below-threshold dynamics. Both can take an external key |
| `transient` | Independent attack and sustain gain, using two envelope speeds |
| `saturation` | Soft clipping with drive, asymmetry, tone, output trim, and optional 2×, 4×, or 8× oversampling |
| `limiter` | Stereo-linked true-peak ceiling with lookahead and release |
| `deesser`, `band-duck` | Dialogue-focused dynamic EQ with an optional external key for band ducking |

Inserts have a sample-accurate `wet` control between 0 and 1, with a
fully wet limiter. Unmarked parameters accept automation. Every insert declares its
processing latency and tail in samples. Artistic delay or reverb
predelay stays in the wet sound. The mixer compensates algorithmic
latency at joins and sidechains, including the dry part of a wet/dry insert.

Use [audio delivery](audio-delivery.md) to print the master, reconstructible
premaster stems, M&E, and editorial media.

## Export and inspect

A session `end` stops external clips at the specified edit point. By
default the mixer preserves downstream processor tails. Set
`tail: "cut"` for an export ending exactly at the edit. A session with
no explicit end uses the end of its last clip, plus any longer routed tail.
Named export taps can read a strip before its inserts (`input`), before
its fader (`pre`), or after its fader (`post`). The exported mix and taps
start at sample zero, with processing latency removed, and share an end.
The report records the edit and tail endpoints, the route compensation,
and each insert's latency and tail.

If a mix or exported tap peaks above full scale, the default applies one
reported headroom factor to all exported audio. Set `peakPolicy: "error"`
to resolve peaks with the session's own gain staging.

In a graph, pack sources into a named `assets` record and give it to
`audio.renderMixer`. The node returns `value`, `taps`, and `report`. Pick
named taps with `data.get`, or select them by field when
[printing audio](audio-prints.md). The JavaScript API is
`KIT.procedural.mediaGraph.mixer.render(recipe, assets)`. The included
processors run in Ink's offline renderer.

See [mixing essentials](mixing-essentials.md) for processor parameters,
loudness and peak metering, and mono and small-speaker checks.
See [sound design inserts](sound-design-effects.md) for tempo echoes,
imported impulse responses, modulation, tape drift, granular playback,
spectral freeze, and retro sampling.
See [production mix tools](production-mix-tools.md) for dynamic EQ, oversampled
shaping, measured rooms, and in-context insert auditions.
See [audio racks](audio-racks.md) for reusable routing, saved controls,
matched bypass, and the optional offline CLAP worker.

Run [After the Cut](../examples/music-production/mixer-routing-workshop.cjs)
with `node examples/music-production/mixer-routing-workshop.cjs output`
to build a session from existing score stems, ready to render or remix.
The workshop prints both a tail-preserving mix and a hard cut and
checks their audio matches up to the edit.
