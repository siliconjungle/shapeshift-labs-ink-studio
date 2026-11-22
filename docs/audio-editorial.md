# Audio spotting and editorial

Spot a marker inside an original recording to picture, to a committed world
event, or to the score. A clip stores its source range, available handles,
active take, and alternate ranges independently of its position in the cut.
Ink can move the placement after an edit while keeping those decisions.

```sh
ink-studio music editorial inspect latch.json --out spotting.json
ink-studio music editorial edit latch.json changes.json --out edited.json
ink-studio music editorial render edited.json --out print --stems
ink-studio music editorial reconform edited.json revised-cut.json --out review
```

`render` writes a stereo WAV, a placement report, and optional aligned track
stems. `reconform` writes level-matched `before.wav` and `after.wav` on the
same sample grid, a report, and a revised `project.json` for further work.
Both project files reference the original WAVs by relative path.

Use [Foley spotting](foley-perspective.md) to derive a session with paired
close and distant takes from committed world events.

## Session

A CLI recipe contains a `session` object and an `assets` table mapping
IDs to WAV paths relative to that recipe. The source used here is at least
30,000 samples long on its native grid.

```json
{
  "assets": {"steel": "recordings/latch.wav"},
  "session": {
    "format": "ink-studio/audio-editorial",
    "version": 1,
    "id": "gate-edit",
    "sampleRate": 48000,
    "picture": {
      "fps": {"numerator": 24000, "denominator": 1001},
      "shots": [
        {"id": "hall", "frames": 24},
        {"id": "latch", "inFrame": 80, "frames": 36}
      ]
    },
    "map": {"tempo": 96},
    "clips": [{
      "id": "impact",
      "track": "foley",
      "spot": {"shot": "latch", "sourceFrame": 92},
      "take": "steel",
      "takes": {
        "steel": {
          "asset": "steel",
          "sync": {"sample": 14400},
          "fromSample": 8000,
          "toSample": 25600,
          "handles": {"fromSample": 3000, "toSample": 30000}
        }
      },
      "fades": {"inSamples": 240, "outSamples": 1200, "curve": "equal-power"}
    }]
  }
}
```

Each spot uses one of these addresses.

| Address | Anchor |
| --- | --- |
| `{"shot":"latch","sourceFrame":92}` | A specific frame in a named shot. It follows that frame through reorder and head trims. |
| `{"frame":36}` | An absolute frame on the output timeline. |
| `{"event":"gate-open"}` | A committed simulation event. |
| `{"cue":"dialogue","clip":"entry"}` | A cue in the session's embedded [clock map report](take-clock.md#map-an-editorial-cut). Use `clip` to select an occurrence of a repeated cue. |
| `{"beat":4}` or `{"bar":2,"beat":1}` | A position in the [tempo and meter map](scene-timeline.md). |
| `{"samples":72072}` or `{"seconds":{"numerator":3003,"denominator":2000}}` | An absolute position on the output PCM grid or in seconds. |

Shots are contiguous in array order. Their source ranges start at
`inFrame` (default zero) and span `frames` frames. If a picture uses the
same source material multiple times, give each occurrence a distinct shot ID.
The report gives each resolved spot's exact rational time, picture frame,
musical beat, and zero-based output sample. An event between frames keeps its
subframe timing. Ink floors to the destination PCM sample once.

To spot a world event, pass `world: {simulationRate, events, aliases?}`
in the session. Collect committed rows from `runtime.events` after each
tick. Spot by the event's actual `id` or provide a stable alias, such as
`aliases: {"gate-open":"333.0"}`. After a new world run, update the alias to
the corresponding committed event ID. The address comes from
`event.tick / simulationRate`.

A mapped cue keeps its original address in the placement report. The clock map needs the session's picture and output sample rates. Pass a revised `clockMap` to `reconform` to move those spots after an edit.

## Take edits

A take source is a mono or stereo WAV. Take trims and handles are zero-based,
half-open ranges on that WAV's native PCM grid. The sync point must sit inside
the active range. To use a named transient, put a
[sample edit document](sample-edit.md) in `session.sourceEdits` under its
asset ID, and set `sync: {"marker":"impact"}`. Ink reads the marker's position
on the original audio. To use a processed or reordered source, first render
that edit to its own WAV and mark the printed source.

Each alternate has its own source and sync point. All are aligned at the
same output spot. Clip fades, comp offsets, and head-slip joins are in
**output** samples. `fromOffset` and `toOffset` address a half-open comp
range relative to the shared sync sample, so negative offsets precede it.
The range must fit in both takes. The entry and exit fades sit inside the
range. Use `linear` or `equal-power` for clip and comp fades.

`slip-head` displaces only the lead-in. Its signed `samples` offset is in
**source** samples. A negative offset reads earlier source material. The
engine blends back to the original lead-in across `joinSamples` before the
pinned transient. Enough material must remain within the handles for the
shift and the join. Pass `slip: null` to clear it.

Write an ordered JSON array for `edit`. This edit trims and slips the
lead-in, then uses an alternate for part of the tail.

```json
[
  {"op":"trim","clip":"impact","fromSample":7200},
  {"op":"slip-head","clip":"impact","slip":{"samples":-960,"joinSamples":480}},
  {"op":"put-take","clip":"impact","take":"other","source":{"asset":"steel","sync":{"sample":15100}}},
  {"op":"comp","clip":"impact","ranges":[{"take":"other","fromOffset":3600,"toOffset":8400,"fadeSamples":480}]}
]
```

The remaining edits are `add-clip` (full clip object), `remove-clip`,
`spot`, `take`, `handles`, and `fades`. `trim`, `handles` and
`slip-head` can target a named alternate via `take`. Editing is
nondestructive and validates the resulting session before returning it.

## Reconform and use in a scene

A reconform file supplies any combination of revised `picture`, `world`,
and `map` values. The report shows old and new clocks and sample windows,
moved clips, spots trimmed out of a shot, missing events, and newly
overlapping clips on the same track. Overlaps are kept for audition.
Unresolved spots are omitted in the preview. A final render requires all
spots to resolve unless you explicitly pass `--allow-unresolved`.

The graph operations `audio.inspectEditorial`, `audio.reviseEditorial`,
`audio.renderEditorial`, and `audio.reconformEditorial` accept the same
session and a table of decoded audio. Rendered PCM can feed the mixer or the
[soundtrack graph asset](scene-audio.md#soundtrack-file) pipeline. A printed
mix may also be used as a soundtrack WAV placed at time zero.

To build the Latch Room demo's WAVs, project, and reports, run
`node examples/music-production/editorial-workshop.cjs output-directory`.
It uses kit recordings mixed with original synthesized material. The
lead-in moves independently of the pinned latch, the resonance comes
from an alternate, and the revised cut moves both a shot anchor and a
world relay event.
