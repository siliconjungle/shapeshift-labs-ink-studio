# CLAP instruments and DAW handoff

## Play a CLAP instrument from an Ink score

Build the [offline worker](audio-racks.md#offline-clap) against the
[CLAP SDK](https://github.com/free-audio/clap). Register the binary, plugin ID,
and optional SHA-256 in a local manifest. A render uses the registered alias.

```json
{
  "type": "clap",
  "plugin": "glass",
  "parameters": {
    "17": {
      "unit": "beats",
      "curve": "linear",
      "points": [{"at": 0, "value": 0.3}, {"at": 8, "value": 0.75}]
    }
  }
}
```

Place this patch in a production's `patches` table and assign it to a score
track. To inspect the plugin or save state, give `music rack plugin-info`
or `music rack plugin-state` a settings file with
`{"kind":"instrument","sampleRate":48000}`. Copy the saved `state` and
`identity` fields into the patch. Authored parameter lanes run over that
state. They use numeric CLAP IDs and accept beats, seconds, or samples.
To initialize a snapshot from a preset file, set \`preset\` in the settings
for \`plugin-state\`. Resolve it relative to the settings file. The registered
plugin must support the CLAP preset-load extension. The resulting snapshot
contains the plugin state, so score recipes can keep using the normal state field.

```sh
ink-studio music production render cue.json --clap-host manifest.json --out print
ink-studio music session render session.json --clap-host manifest.json --out print
```

An instrument receives performed note times, gate and velocity, independent
note IDs, the score transport and tempo changes, and sample-addressed
automation. The CLAP expression path sends the following controls.

| Ink performance | CLAP event |
| --- | --- |
| Tuning, bend, pitch curve and glide | Tuning in semitones |
| Volume and amplitude curves | Linear note volume |
| Pressure | Pressure |
| Brightness and brightness curve | Brightness |
| Breath | Expression |
| Vibrato depth | Vibrato |

Each expression emits at its onset, its knots and along moving spans. Close
or overlapping notes on the same pitch keep independent expression.
The plugin interprets these controls. An instrument with only a MIDI note
port can play an ordinary equal-tempered performance with distinct active
pitches. Choose a native CLAP note port for independent expression and unison
overlap. The worker uses the first compatible native port, or the first
standard MIDI port when a native one is unavailable.

The offline worker prints the main mono or stereo output. It provides buffers
for up to 15 additional mono or stereo outputs on an instrument and supplies
silence to an optional mono or stereo instrument input. Layout and latency
stay fixed through the render, and the instrument declares a bounded tail. The worker compensates
latency before the common Ink track mix. A production render's `tail` option
sets the release time after the render range. The session's desk uses its
usual tail policy. `music session play` prepares instrument takes offline
before playback, so score edits can feed the audition desk without hosting
a realtime plugin in the browser.

JavaScript callers pass the explicitly trusted adapter as the fourth
argument to `KIT.music.production.render(production, assets, options, host)`
or the second argument to
`KIT.procedural.mediaGraph.musicSession.create(assets, host)`. The adapter
receives `kind: "instrument"` with the normal describe and render contract.
It declares a `notes` dialect of `clap` or `midi` and receives `notes` and
`transport` in place of input audio. Native-only sessions can also use the
headless `music.handoffEditSession` node.

Use the [instrument benchmark](instrument-benchmark.md) to compare a native
patch with a CLAP instrument on one performance and backing.

## Hand the edit to a DAW

```sh
ink-studio music session handoff session.json --clap-host manifest.json --out handoff
```

- **`project.rpp`** opens directly in REAPER with tempo and section markers,
  aligned audio items, MIDI items and their controller data, fader and pan
  envelopes, pre/post-fader sends, groups and audio key routes. The Ink master
  print starts soloed for reference. The MIDI lanes start muted and route to
  their corresponding desk strips. Attach an instrument to a MIDI lane,
  unmute it, and mute the audio item it replaces.
- **`notes.mid`** is a Standard MIDI File for other DAWs. Swung and
  microtimed attacks are written with performed timing against the tempo
  map. Pitched expression uses MPE member channels, pressure, and controller
  data where supported. Check `midi.notices` for polyphony fallback or
  bend-range limits. Exact source values remain in Ink.
- **`audio/`** contains the original master, source-lane stems, and authored
  desk taps. The stems all start at sample zero and include the comped audio,
  the source-track processing, and the score room as its own stem. Optional
  gain restoration for source headroom is stored in `stemGains` and applied
  on the REAPER audio items.
- **`handoff.json`** carries exact sample addresses, active take IDs, source
  note addresses and expression, effective desk controls, insert settings,
  routing and key assignments, transport, and CLAP aliases and plugin IDs.
  Notes that span a comp cut become editable slices in MIDI. Their printed
  stems retain the original gate and crossfade history.
- **`ink/session.json`** retains the original editable session, alternate
  takes, pins, exact curves, CLAP state and relative WAV assets. Provide
  your own registered manifest to rerender its CLAP devices.

Reattach equivalent instruments and processors in the receiving DAW to use
the editable desk. CLAP snapshots and plugin parameter automation travel in
the Ink package and the interchange JSON. This lets the original print
serve as the listening reference even on a machine without the plugins.
[REAPER project and MIDI API](https://www.reaper.fm/sdk/reascript/reascripthelp.html)

## Reproduce the example

```sh
c++ -std=c++17 -O2 -I /path/to/clap/include scripts/clap-host.cpp -o clap-host
c++ -std=c++17 -O2 -shared -fPIC -I /path/to/clap/include examples/clap-instrument/glass-reed.cpp -o GlassReed.clap
node examples/clap-instrument/handoff.cjs manifest.json harbor-glass
```

Register `glass` with the plugin ID `org.ink.glass-reed` and point the manifest
at the fixture and worker. On Linux, add `-ldl` to the worker build if needed.
The example prints the same two overlapping lines with flat and expressive
performance and exports the full arrangement as a project.
