# Paint throb

Pulse selected retained 3D marks from cue tracks, oscillators, or recorded audio. Each channel selects its own driver and two multipliers. Drivers produce levels from zero to one. Reverse a range to make a channel recede as the driver rises.

```json
{
  "format": "ink-studio/paint-throb",
  "version": 1,
  "id": "beacon",
  "painting": "signals",
  "marks": ["lamp"],
  "drivers": {
    "breath": { "type": "oscillator", "frequency": 1, "shape": "sine" },
    "reveal": { "type": "cue", "timeline": true, "keys": [
      { "at": 0, "value": 0 },
      { "cue": "ignition", "value": 1 },
      { "cue": "ignition", "offset": 0.5, "value": 0 }
    ] },
    "sound": { "type": "audio", "file": "signal.wav", "measure": "rms", "rate": 48, "gain": 3 }
  },
  "channels": {
    "width": { "driver": "breath", "range": [0.65, 1.4] },
    "coverage": { "driver": "reveal", "range": [0.2, 1] },
    "emission": { "driver": "sound", "range": [0, 2] }
  }
}
```

| Channel | Multiplier | What it changes |
| --- | --- | --- |
| Width | 0.05–4 | The width of each brush dab in its local XY plane. On a surface-bound mark with relief or finish, that is the surface tangent plane. |
| Height | 0.05–4 | Signed shading or volume relief. The stroke footprint and volume seat stay fixed. |
| Coverage | 0–1 | Visible paint opacity. Shading relief keeps its height and raised volume keeps its geometry. |
| Emission | 0–8 | Existing finish emission and its authored light spill. The finish tint stays fixed. |

An oscillator uses cycles per second and an optional `phase` in turns. Sine and triangle shapes start at zero when phase is zero. A cue driver accepts a local `cues` table with a `duration`, or `timeline: true` to read scene markers and events. Refer to nested cues by their timeline path, such as `intro/ignition`. Each key uses an absolute `at` or a named `cue` with an optional `offset`.

WAV files resolve relative to the plan. The native analyzer samples RMS or peak by window. It can use all channels, a mix, or a zero-based channel index. Use `offset` in seconds to line up the start and `gain` to tune sensitivity. The saved scene embeds the envelope for portable playback. The WAV supplies the control signal and can be mixed separately. To refresh the envelope after editing the audio, apply the original plan again.

```sh
ink-studio paint-throb apply source.json pulse.json --out pulsing.json
ink-studio paint-throb inspect pulsing.json --at 0.75 --pulse beacon
ink-studio render pulsing.json --t 0.75 --out beacon.png
ink-studio clip pulsing.json --from 0 --to 1 --fps 12 --out beacon-loop.png
```

Applying the same plan ID replaces it. Separate plans may target different channels on the same mark. A mark channel has one driver assignment. Save the updated scene beside its source to preserve other asset paths.

Run the [Beat Relay example](../examples/paint-throb-demo.cjs) with `node examples/paint-throb-demo.cjs ./beat-demo` to generate the source WAV, editable scene, contact sheet, and animated PNG.
