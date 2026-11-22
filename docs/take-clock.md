# Exact take clock

Use [audiovisual takes](audiovisual-takes.md) to drive a picture graph from
the same physical signals and audio buffers that supply a take WAV.

Use a take to sample an Ink world and a graph at the same frame. The clock
derives video frame boundaries, committed simulation ticks, and output audio
sample positions from integer ratios. Rendering, keyframe interpolation, and
audio DSP still receive seconds or samples through their existing APIs.

## Sample a take from the CLI

Save a version 1 take beside its source files. The world and graph are optional
and paths are relative to the take. The graph uses its normal asset declarations
for WAV files and recorded inputs. Use a [project bundle](project-bundles.md#bundle-a-whole-take)
to move a take with its graph, audio, looks, shot recipes, and checkpoints.

```json
{
  "format": "ink-studio/take",
  "version": 1,
  "clock": {
    "fps": { "numerator": 30000, "denominator": 1001 },
    "simulationRate": { "numerator": 60000, "denominator": 1001 },
    "sampleRate": 48000,
    "cuts": [{ "frame": 10, "id": "lantern-close" }]
  },
  "world": "world.json",
  "graph": "graph.json"
}
```

```sh
ink-studio take sample take.json --frame 9 --checkpoint before.json
ink-studio take sample take.json --frame 10 --resume before.json --out cut.json
ink-studio take sample take.json --frame 10 --out direct.json
```

The report includes the exact clock's integer coordinates, the current shot,
the scene timeline sample and its frame cues, the last committed world's tick
and events, and the graph report with artifact hashes and assertions. Reports
from a direct seek and resumed seek have the same timing and output content.
Graph cache diagnostics can differ between warm and cold evaluations.

A take defaults to 24 fps, 60 simulation ticks per second, and a 48 kHz output
sample grid. Use an integer or an explicit numerator and denominator for rates
such as 30000/1001. A world declaring its own `dt` must match the take's
simulation period. Worlds without `dt` inherit that period. A take checkpoint
keeps the frame index, native world checkpoint, and fingerprints of its timing,
world, and graph sources. Reopen it with the same take. The native graph
simulation nodes can reconstruct their frames directly from their recipes and
individual checkpoints.

## Coordinates and boundaries

- `frame.start` and `frame.end` describe the half-open interval for picture
  frame `frame.frame`. Cuts are attached to frame indices.
- `frame.tick` is the last completed simulation tick at frame start.
  `frame.endTick` is the corresponding boundary at the next frame.
- `frame.firstSample` and `frame.endSample` partition the output sample grid.
  WAV nodes use the same boundaries in the source file's own sample rate.
- Timeline markers, audio start/end cues, and recorded pulses belong to the
  half-open frame containing them. An ending sound is listed before one
  starting at the same instant. A world event is applied at the first tick
  at or after its authored instant, with time-zero events applied on tick one.

Use decimal seconds or `{ "numerator": 1001, "denominator": 3000 }` for
exact timeline times, trims, durations, and audio offsets. Exact timeline
compilation propagates these values through nested clips before converting
them to seconds. Set the same rational value as an input event's authored
`time` to put it on the same boundary. A saved input recording preserves
that ratio in its `timecode` field alongside the seconds used by older
readers. Graph `audio.window`, `audio.analyze`, `audio.fft`, and
`input.replay` inherit the take frame unless their node options select their
own time, frame, rate, or origin. An `anim.retime` group uses its authored
local seconds. Raster simulations use an integer tick lookup, including the
exact take tick when the recipe shares its period.

## Library and shared domains

```js
const ink = require('@shapeshift-labs/ink-studio');
const kit = ink.load(), K = kit.KIT;
const { take } = ink.readTake('take.json');
const sample = take.seek(10);
const saved = take.checkpoint();

if (sample.world) {
  const scene = K.world.visual(kit, sample.world, sample.query, { take: sample.frame });
  const image = ink.render(scene, { ...sample.render, w: 160, h: 96, px: 1 });
}
```

A cut or nonsequential seek requests a render-graph history reset. It leaves
the native simulation and audio coordinates continuous. Callers can use
`ink.createTake({ clock, world, graph }, { checkpoint })` with their own
manifest and compiled graph project.

For an existing live stage, use the same frame snapshot with the
[shared time domains](shared-time-domains.md) and the graph. The simulation
root matches the take period and retains backlog. Advance it again at the
same frame to drain its per-update budget when necessary. Restore live
domain and stage state before a backward seek. An externally driven stage
uses `stage.useTimeDomains(domains, { advance: false })`.

```js
const clock = K.timeDomains.take({ fps: { numerator: 30000, denominator: 1001 } });
const domains = K.timeDomains.create({ domains: {
  simulation: { step: clock.dt },
  animation: { fps: 12 }
} });
const frame = clock.at(3);
domains.advanceTake(frame);
const renderOptions = domains.frame({ take: frame });
const graphFrame = graph.run({ take: frame });
```

Use `clock.locate(secondsOrRational)` for the frame, sample, tick, and cue tick
of an authored point. Compile a standalone timeline with
`K.timeline.compile(definition, { exact: true })` and sample it with
`timeline.forTake(frame)`. Native worlds configured by a take select exact
timeline compilation automatically.

Use [the native simulation policy](simulation-fast-checkpoints.md#set-a-takes-native-simulation-policy)
for fast state at cuts, warm-up and loop wraps.

## Map an editorial cut

`take map` maps source addresses to edited picture frames, equivalent simulation ticks, PCM samples, and show cue frames. It keeps the original coordinates beside every edited placement. It can read committed envelopes, native recordings, checkpoints, or portable fixtures. Use a fixture or a complete envelope export when the original world history was disabled or filtered.

```json
{
  "format": "ink-studio/clock-map",
  "version": 1,
  "id": "harbor-edit",
  "clock": {"fps": {"numerator": 30000, "denominator": 1001}, "sampleRate": 48000},
  "sources": {
    "harbor": {
      "clock": {"sampleRate": 44100},
      "events": {"file": "harbor.fixture.json"},
      "words": [{"id": "land", "text": "land", "from": {"sample": 8820}, "to": {"sample": 13230}}]
    }
  },
  "clips": [
    {"id": "entry", "source": "harbor", "in": {"tick": 6}, "out": {"tick": 18},
      "at": {"frame": 10}, "duration": {"frame": 8}}
  ],
  "cues": {
    "arrival": {"source": "harbor", "at": {"event": "12.0", "branch": "main"}, "preset": "amber"},
    "dialogue": {"source": "harbor", "at": {"word": "land", "edge": "end"}, "preset": "blue"}
  }
}
```

An address can be seconds, a rational seconds pair, or one integer `tick`, `frame`, or `sample`. Source addresses use the named source's rates. Edited addresses use the top-level clock. Linked native sources supply their take rates when available. An envelope export can supply its exact simulation rate. A timed event keeps its occurrence time and its separate commit tick. Dialogue uses supplied word intervals and accepts a relative file containing the same word array.

Each clip maps the half-open interval from `in` to `out` onto the edited interval beginning at `at`. Its `duration` defaults to the source length. The map includes the visible portion of a trimmed word and preserves its full original interval. Repeated placements keep separate clip IDs. Cues can refer to a source coordinate, an event, or a word edge. A cue with an explicit `clip` resolves within that placement. A cue with no source uses an edited address directly. Unplaced cues appear under `issues`.

`frame`, `tick`, and `sample` are the containing output coordinates. A show fires at `showFrame`, the first picture frame at or after the cue. Scene presentation can use the containing frame and the exact subframe time. Exact calculations use integer ratios through trims and speed changes. Numerators and denominators that exceed safe JSON integers are serialized as decimal strings.

```sh
ink-studio take map cut.clock.json --out cut.map.json
ink-studio take map cut.clock.json --format timeline --out cut.timeline.json
```

Use the timeline export as the scene's `timeline`. Set `cueMap` in a [patch show](patch-tooling.md#run-a-patch-as-a-show) to the report path. Embed the same report as `clockMap` in an [audio editorial session](audio-editorial.md#session) and choose a clip spot such as `{"cue":"dialogue","clip":"entry"}`. The JavaScript entries are `KIT.world.clockMapping.map` and `timeline`. For individual positions, `clock.address({sample: 8820})` returns the same coordinate fields.

```sh
node examples/clock-mapping/demo.cjs ./studio/out/clock-mapping
```

The demo retimes a committed arrival and dialogue word markers, prints paired WAVs with mapped sync points, and rehearses the resulting show cue frames.
