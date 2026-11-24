# Ambisonic ambience export

Add `--ambisonic` to a recorded story audio export to print a rotatable bed and separate placement stems.

```sh
ink-studio story audio run.json soundtrack.json --from 2 --to 8 --ambisonic --out delivery
```

The handoff files are in `delivery/ambisonic`. The ordinary stereo soundtrack files are also written.

| File | Contents |
| --- | --- |
| `ambience-ambix.wav` | Four-channel first-order soundfield for the ambience and effects roles |
| `dialogue.wav` | Unpanned stereo dialogue source stem |
| `close-foley.wav` | Unpanned stereo Foley source stem |
| `manifest.json` | Channel convention, scene axes, files, roles, sample bounds and headroom |

## Route the handoff

Set `bus: "ambience"` on room beds and `bus: "effects"` on environmental cues. Set `bus: "dialogue"` for foreground speech and `bus: "foley"` for close action. Timed `tracks` can name these buses in a soundtrack with a `post` block. The same role defaults as the [scene post mixer](foley-perspective.md#route-a-soundtrack-by-role) apply where the bus is unspecified.

Positioned environmental cues use their apparent source relative to the listener, including portal routing and geometric early reflections. The soundfield follows the listener's position and keeps the scene axes as the reference for rotation. A source at the listener and an unpositioned mono bed contribute to W. An unpositioned stereo bed feeds a virtual pair at 45° left and right of scene front. Position-dependent room impulse responses take only the positioned environmental feed, with their late return summed into W.

Dialogue and Foley carry the authored timing, rate, source gain and tone processing on the same clock. The placement stems are printed before spatial panning, binaural filtering, reflection sends, room returns and scene post inserts. The handoff uses authored source voices independently of the presentation voice budget and crowd aggregation. The music role stays outside the soundfield.

## Import and rotate

Import the four-channel Broadcast WAV as first-order **ACN/SN3D**, with its channels in **W, Y, Z, X** order. In Ink scene coordinates, front is −Z, left is −X and up is +Y. Set the track to Ambisonic routing in your DAW or decoder, then rotate the bed and place the dialogue and Foley from their two separate files. [ACN and SN3D conventions](https://www.rfc-editor.org/rfc/rfc8486.html#section-3.1) · [First-order channel mapping and axes](https://github.com/google/spatial-media/blob/master/docs/spatial-audio-rfc.md#appendix-1---ambisonics)

All three files use 24-bit PCM and the same Broadcast Wave time reference. The print applies one shared gain for headroom across the handoff. Its peak check includes the length of the first-order directional vector so a rotation can redistribute its components without exceeding the PCM range. The manifest records the gain and the half-open sample interval. Render shorter excerpts if an export exceeds the PCM budget.
