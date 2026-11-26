# Drive picture from an audiovisual take

Use one run to publish a sample-aligned WAV and drive picture. A pressure
trace can open a cutaway, deflect a mesh, or make a lamp respond as a wave
reaches it. The same take can use RMS measured from the actual output mix to
set a render effect. The render report records the raw and mapped values on
every frame.

Use [headless channel routing](channel-routing.md) to compare several
source clocks and replay an authored route in a graph clip.

```sh
ink-studio take render-av organ.av.json --out published
```

The output includes `sound.wav`, `export.json`, and the selected picture
products. A 24-bit Broadcast Wave time reference places cropped audio at the
correct absolute sample. The ordered picture runner writes numbered PNGs,
an APNG, or both and keeps render history through adjacent frames. Authored
cuts reset picture history, and ordinary take simulation rules determine
whether world state carries or resets. `warmup` evaluates preceding graph
frames without including them in either export.

Use the [delivered sync check](delivered-sync.md) to compare visible contact
in the numbered frames with the attack in the published WAV. Run a [blind audiovisual review](blind-av-review.md) to measure what people pick up from each medium.

## Describe the take

The wrapper references a standard version 1
[take](take-clock.md) whose `graph` is the picture project. The take can
also name a world, simulation policy, or take checkpoint. References follow
the files that declare them.

```json
{
  "format": "ink-studio/audiovisual-take",
  "version": 1,
  "take": "organ.take.json",
  "from": 0,
  "to": 56,
  "picture": { "output": "picture", "format": "both" },
  "audio": { "physical": "organ.physical.json" },
  "bindings": {
    "section": {
      "source": { "kind": "physical", "name": "inlet", "stat": "rms" },
      "input": [0.02, 1.8],
      "output": [0.27, -0.24],
      "shape": "smoothstep"
    },
    "diaphragm": {
      "source": { "kind": "physical", "name": "bell", "stat": "rms" },
      "input": [0.04, 1.65],
      "output": [1.57, 2.01]
    },
    "glow": {
      "source": { "kind": "audio", "name": "mix", "stat": "rms" },
      "input": [0.002, 0.15],
      "output": [0.12, 2.15]
    }
  }
}
```

`from` and exclusive `to` are integer picture frames. `from` defaults to 0.
Use `picture.inputs`, `picture.seed`, and `picture.renderOptions` with the
same meanings as `graph clip`. Declare a record input named `controls` in
the picture graph when the wrapper has bindings. `controlsInput` overrides
that name. This input receives the mapped values on every frame, including
warm-up.

### Audio sources

- `audio.physical` references a [physical audio run](physical-audio.md).
  All its inputs remain available as physical tracks. Its aggregate buses
  are `mix`, `source`, and `propagation`. Individual stems are
  `source.<name>` and `path.<name>`. Pick the WAV's bus with `audio.bus`
  (default `mix`). A native run referenced by several pickups is evaluated
  once and shared by the picture and audio paths.
- `audio: { "graph": "sound.json", "output": "master" }` evaluates a
  separate graph once and uses its named PCM output as `mix`. Optional
  `inputs`, `seed`, and `time` select the evaluation. `startSample`
  places sample zero of the graph buffer on the take clock and defaults to
  zero. Use `signals: { "bell": "nativePressure" }` to expose named
  physical-signal record outputs from the same evaluation.

The selected mix must use the take sample rate. Samples outside the PCM
range are silent. The WAV and the measured mix use the same input buffer.
Measurements use its floating-point samples before WAV quantization.

### Picture controls

| Source | Readout |
| --- | --- |
| `audio` | Measure the named PCM bus. Choose `channel` as `all`, `mix` (arithmetic channel average), or a zero-based channel number. First and last sample reads default to `mix`. |
| `physical` | Measure one named physical input on its native clock. Values use canonical units such as Pa or m/s. An empty native window yields no observation. |
| `world` | Read `signal: "system/port"` or a query `field`, optional `at` selector and `args`, from the last committed simulation state. Use a JSON Pointer `path` to choose part of a record, and optional `project` for vectors. |

For audio and physical tracks, `stat` accepts `rms` (default), `peak`,
`mean`, `min`, `max`, `first`, or `last`. The default `window: "frame"`
reads the full half-open picture interval, including later samples within that
frame. Choose `window: "previous"` when a control should use only past
samples. Both windows use exact integer sample boundaries on each source
clock. The first previous PCM window contains silence if it precedes the
track. Physical statistics exclude samples outside the native trace.

Each rule maps its increasing `input` range to its `output` endpoints,
which can descend. `shape` accepts `linear`, `smoothstep`, or `power`
with `exponent`. A missing observation uses `fallback`, which defaults to
the first output endpoint. The report records each measurement's source,
scope, raw value, mapped value, and native sample range or world tick.

## Bind picture options

Use the `scene.bindControls` node to fill selected numeric fields in an
authored options record. Link its output to an existing mesh, cutaway,
or effects entry point. For example, a scene render options node can bind
to a cut plane and a bloom pass.

```json
{
  "op": "scene.bindControls",
  "inputs": {
    "template": {
      "width": 224,
      "height": 128,
      "cutaway": { "planes": [{ "normal": [0, 0, 1], "offset": 0.27, "keep": "negative" }] },
      "renderGraph": { "passes": [{ "id": "halo", "type": "bloom", "intensity": 0.12 }] }
    },
    "controls": { "input": "controls" },
    "targets": [
      { "control": "section", "path": "/cutaway/planes/0/offset" },
      { "control": "glow", "path": "/renderGraph/passes/0/intensity" }
    ]
  }
}
```

Use another binding node on `geo.transform.options` with a path such as
`/position/0` or `/scale/1`. Targets can also address numeric mesh generator,
light, camera, mask, or render parameters. Each path must exist in the
template; a numeric value or `null` supplies its default. A missing control,
unknown path, or duplicate target is diagnosed. Author unaffected options in
the same template.

## Library

`ink.readAudiovisualTake(file)` resolves a wrapper and returns its report
and named artifact buffers. Use `ink.renderAudiovisualTake(settings,
{kit, graph, world, simulation, checkpoint, audio, signals})` with an
already prepared picture project. `settings.clock` contains the take clock.
The optional world, simulation policy and checkpoint follow `createTake`.
The `audio` table holds named `{audio, startSample}` buffers and `signals`
contains named physical-signal records. `settings.audioBus` selects the
WAV bus. For independent sampling, use
`KIT.world.pictureSignals.prepare(bindings, {audio, signals}).sample(frame, worldSample)`.

## Demo

```sh
node examples/audiovisual-take/demo.cjs studio/out/audiovisual-take
```

The pressure organ shows four probes along a waveguide. The inlet pressure
opens the section, the far probe shifts and scales the diaphragm, and the
exported mix drives bloom. The demo compares each decoded WAV window to the
reported picture RMS and prints both the synchronized export and the
editable graph and run recipes.
