# Audio, recorded inputs and host adapters

WAV import/export, audio analysis and input replay run in the library and
CLI graph. WAV and capture files travel with the graph project as local
assets. Graph evaluation can seek to any time without reopening a device
or making a network request.

## WAV and frame analysis

Use an asset with `format: "wav"` and reference it by name with `audioAsset`.
Ink reads little-endian RIFF/WAVE with 8-, 16-, 24- or 32-bit integer PCM
and 32- or 64-bit IEEE float PCM, including extensible multichannel headers.
The audio port contains `sampleRate`, `channels` and normalized interleaved
`samples`. Over-range finite float input is clamped to `[-1, 1]`.

Export an audio output with `format: "wav"` and optional `encoding`.
The default is `pcm16`. Other choices are `pcm8`, `pcm24`, `pcm32`,
`float32` and `float64`. Inspecting an audio socket can also write a WAV
preview. Node callers can use `ink.readWav`, `ink.decodeWav` and `ink.encodeWav`.

| Operation | Outputs |
| --- | --- |
| `audio.buffer` | An audio port from `sampleRate`, `channels` and an interleaved numeric sample array. |
| `audio.window` | The selected frame’s audio and an exact sample-boundary report. |
| `audio.analyze` | Per-channel RMS, peak and mean. The separate `rms` and `peak` ports aggregate the selected channels. |
| `audio.fft` | Per-channel dominant frequencies, named band peaks and a one-channel numeric raster with bins across X and audio channels down Y. |
| `audio.series` | An array of frame records with waveform features and optional FFT bands. Set `first`, `count` and optional `fft` settings. |

Frame operations accept `options.fps` as a number or
`{ "numerator": 30000, "denominator": 1001 }`. They use the graph clock
unless an explicit `time` or `frame` is supplied. Set `origin` to place
video frame zero and `offset` to place audio sample zero in graph seconds.
Audio windows share half-open sample boundaries. `padding: "zero"` includes
silence beyond the file, while `"trim"` returns just the available samples.

Select `channel: "all"` (default), `"mix"` for an arithmetic mean, or a
zero-based channel index. FFT windows center on the selected frame.
`size` is a power of two between 16 and 65,536. `window` accepts `hann`
(default), `rect`, `hamming` or `blackman`. The reported `binHz` is the
frequency step between columns. Bins use one-sided, window-normalized
amplitude. A named `bands` entry gives a frequency interval in Hz. Its
value is the peak bin amplitude in that band, and the separate `bands`
port takes the maximum across selected channels.

These tools cover waveform windowing and FFT workflows comparable to
Pixel Composer’s audio analyzer and transform nodes.
[Audio Window](https://docs.pixel-composer.com/nodes/animation/audio/analyzer/audio_window.html) · [FFT](https://docs.pixel-composer.com/nodes/values/number/operator/fft.html)

## Editable musical event tracks

Feed a decoded WAV or an audio buffer into `audio.detectTransients`.
It looks for sudden rises in spectral energy and refines each detected
attack against the source waveform. By default it analyzes channels
independently, so stereo phase cancellation does not hide an attack.
Choose one channel by index or use `channel: "mix"` to detect against the
mono mix. Set `minGap` in seconds (default 0.075) to group nearby
attacks. Increase `minStrength` to reject quiet detections or increase
`sensitivity` to require a larger rise over the local background.
`size` and `hop` override the FFT window and step in samples.

The `value` port is an `ink-studio/musical-events` version 1 JSON
document. Each cue has a stable `id`, a `name`, and `time` in seconds.
Detected cues start with the name in `options.name` (default `Hit`).
They carry an exact `timecode` and a `detected` record with the original
sample index, sample rate, analysis strength, and channel. Editing the
cue preserves that detection record.

Connect the detected track, or a saved track loaded through `jsonAsset`,
to `audio.editEvents.source`. Its `edits` input applies operations in
order and returns a new time-sorted track.

```json
[
  {"op":"move","id":"hit-4800","time":0.105},
  {"op":"rename","id":"hit-4800","name":"Open iris"},
  {"op":"delete","id":"hit-19200"},
  {"op":"add","id":"freeze","name":"Freeze frame","time":0.625}
]
```

Use an integer `timecode: {"numerator":1001,"denominator":30000}`
instead of `time` for an exact move or insertion. The `timeline` port
provides scene markers and `music-cue` events with the cue name in
`detail.name`. It uses seconds by default. Set `options.exact: true`
when importing both arrays into an exact timeline.
Connect the `recording` port to `input.replay` for `music:cue` pulses
on the graph clock. Each pulse carries the cue's ID and name, and
preserves exact timecodes for takes. Export the `value` port as JSON
to continue editing the same track later.

Hosts can call `KIT.procedural.mediaGraph.detectTransients(source, options)`
and `mediaGraph.editMusicalEvents(track, edits, options)` directly.
`mediaGraph.makeMusicalEvents(events)` creates a track from manually
authored cues.

[Browser demo](../examples/editable-musical-events.cjs)

```sh
node examples/editable-musical-events.cjs musical-events.html
```

## Recorded control events

An `ink-studio/input-recording` version 1 document has `initial` channel
values and ordered `events`. A `set` event updates a held value. A `pulse`
has a payload and leaves the held state alone. Events at the same time
retain capture order.

```json
{
  "format": "ink-studio/input-recording",
  "version": 1,
  "initial": { "gamepad:stick": 0 },
  "events": [
    { "time": 0.5, "channel": "gamepad:stick", "kind": "set", "value": 0.6 },
    { "time": 0.75, "channel": "desk:cue", "kind": "pulse", "value": "flash" }
  ]
}
```

Use `input.recording` to assemble a take from graph data or `inputAsset`
to load an asset with `format: "inputs"`. `input.replay` returns the held
state at the sample time, the frame’s events and its pulses. The frame’s
events cover `[start, end)`. Set `options.from` to request the interval
`(from, time]` instead. Its FPS, origin and offset controls align it with
audio and video. Connect its held state to `input.actions` to use Ink’s
context bindings and dead zones.

Use `KIT.procedural.mediaGraph` for the underlying clock, analysis and
event APIs. Node hosts can append timestamped rows to `mediaGraph.recorder`
or call `ink.recordInputEvents(iterable, { initial, signal })` for a device
source that provides a finite event stream.

## Optional host adapters

Register the adapter object through the Node graph API’s `adapters`
option, `graphAdapters` in the local `ink-studio.config.js`, or the CLI’s
`--adapters path/to/host.cjs`. The command-line module replaces the configured
registry for that invocation. Each registry maps names to callbacks.
The host supplies the device driver, additional codec or project translator.

| Registry | Callbacks and values |
| --- | --- |
| `devices` | `read({ type, options, signal })` returns a typed snapshot, such as normalized audio or a recorded control take. |
| `network` | `read({ type, options, signal })` receives data. `write({ type, value, options, signal })` sends a typed value and returns a JSON receipt. `ink.httpJsonAdapter(url)` supplies a bounded GET/POST JSON transport for a host-configured endpoint. |
| `codecs` | `decode({ bytes, type, file, options })` returns audio or a raster. `encode({ value, type, options })` returns `{ extension, bytes }`. An optional `mux` callback packages scene exports with sound. These callbacks are synchronous. [Scene soundtrack export](scene-audio.md#optional-video-adapter) |
| `pxc` | `import({ bytes, file, options, inspect })` returns `{ project, report? }` with an Ink graph project. `inspect()` decodes a supported PXCX payload for translators. |

Use asset or export `format: "codec"` with `codec`, `type` of `audio` or
`raster`, and optional `options`. Feed a decoded raster to `rasterAsset`
or decoded sound to `audioAsset`.

Device and network operations run through `ink.createGraphHost().exchange`
or a separate `graph capture` command. A capture request is an
`ink-studio/host-request` version 1 record with `kind` of `device` or
`network`, the `adapter` name, `type` of `audio`, `raster`, `inputs`
or `json`, and optional `options`. Its default `direction` is `read`.
For a network `write`, give the `file` to send relative to the request file.
Reads write an audio, raster or JSON snapshot and print a hash receipt.
A graph project references the recorded file in its assets.

```sh
ink-studio graph capture capture.json --adapters host.cjs --out take.json
ink-studio graph run automation.json --out review
```

## Pixel Composer projects

`graph inspect-pxc` reads the PXCX container metadata. `graph import-pxc`
imports saved RGBA8 preview art or the thumbnail as a raster graph. The
native importer preserves those pixels. Editable node conversion uses
a registered translator with `--using`, and reports the adapter’s name.
The resulting Ink graph is validated before writing.

The native preview path follows the documented role of project output
as a compositable surface and the publicly described PXCX save structure.
[Pixel Composer PXC node](https://docs.pixel-composer.com/nodes/io/pxc/pxc.html) · [PXCX container and preview format](https://github.com/Stovoy/pixel-composer-tools#container)

```sh
ink-studio graph inspect-pxc source.pxc
ink-studio graph import-pxc source.pxc --out preview.json
ink-studio graph import-pxc source.pxc --adapters host.cjs --using translate --out editable.json
```

## Spectral Relay

The example writes an original stereo cue, captures a synthetic controller
take, renders a frame-locked FFT and waveform review, and verifies a
synthetic PXCX preview import pixel for pixel.

```sh
node examples/graph-audio-automation.cjs spectral-relay
ink-studio graph run spectral-relay/spectral-relay.json --out spectral-relay/graph
```
