# Reference clip workbench

Compare two short animations on a shared playhead. Mark the frame where
a particular beat happens in each source. The workbench holds source
frames and maps the time between those marks, so an early ignition can
line up with a late ignition. Both original frame numbers stay visible.

```sh
node examples/reference-clip-workbench.cjs ./rose-engine-review
```

Open `rose-engine-review/index.html` from disk. Jump to **First pressure
ring**, **Ignition**, or **Falloff**. Turn on **Loop beat** to play from
that marker up to the next one. Use **±1 frame** to step on the reference
clock, or scrub continuously to see how faster candidate frames land.
Open **Edit beat alignment** to preview the two source frames independently.
Save them with a label to add or revise a marker. Download the alignment
JSON to share the edit or reuse it in the CLI.
Side by side, swipe, and signed luminance difference use the same Ink
[comparison compositor](comparison-views.md). Integer zoom preserves the
art pixels. Save a note at the playhead and click the note's timestamp
to revisit it. Download the notes JSON to keep with the workbench or
open it in another copy of the same review.

## Review your own files

Pass a plan to the CLI. This plan accepts a directory of already extracted
PNG frames and renders an Ink graph directly at a different cadence.

```json
{
  "format": "ink-studio/reference-clip-review",
  "version": 1,
  "title": "Rocket pressure and ignition",
  "reference": {
    "directory": "./reference-frames",
    "fps": 18,
    "startFrame": 10
  },
  "candidate": {
    "graph": "./engine.json",
    "output": "beauty",
    "from": 100,
    "to": 152,
    "fps": { "numerator": 24000, "denominator": 1001 }
  },
  "beats": [
    { "id": "first-ring", "label": "First pressure ring", "reference": 15, "candidate": 109 },
    { "id": "ignition", "label": "Ignition", "reference": 19, "candidate": 119 },
    { "id": "falloff", "label": "Falloff", "reference": 26, "candidate": 134 }
  ]
}
```

```sh
ink-studio reference-clip review.json --out comparison
ink-studio reference-clip review.json --beat ignition --mode difference --sheet --out ignition-review
```

Each side accepts one source.

| Source | Settings |
| --- | --- |
| PNG directory | `directory`, required `fps`, optional `startFrame` (default 0). PNGs sort numerically by name, so frame-2 precedes frame-10. Addresses advance by one per image. |
| Ink render already on disk | `clip`, the path to a [graph clip](graph-clips.md) `report.json` exported with `--format frames` or `--format both`. The workbench uses the report's picture rate, frame indices, and frame hashes. |
| Ink graph | `graph`, `output`, `to`, optional `from` (default 0) and `fps` (default 24). Also accepts `inputs`, `seed`, `warmup`, `cuts`, and `renderOptions`. Ink evaluates the graph in frame order before aligning the comparison. |

Paths are relative to the plan. Each source can set a `label`,
`crop: [x,y,width,height]` in source PNG pixels, `pixelSize` for the
integer enlargement already baked into those pixels, and `offset: [x,y]`
in art pixels for registration. Crop dimensions must divide by `pixelSize`.
Each side has one native grid. Ink pads both sides to the common extent
after applying offsets. The same registered grid is used for swipe and
difference.

Use absolute source frame indices in `beats`, strictly increasing in
each source. Playback uses seconds relative to the start of the reference.
Ink maps linearly between matched beat frames and holds each selected
source frame until its next frame. Clip boundaries fill in the span
before the first beat and after the last one. A marker on the first
reference frame can map past the start of the candidate. After the last
frame, the playhead holds the final addressable frame.

The output has a portable browser workbench, `workbench.json`, a
`comparison.png` on the native grid, and `frame.json` with the resolved
playhead and both source addresses. Use `--at` for a specific review
time in seconds or `--beat` for a named mark. `--sheet` adds a native
contact sheet with the previous reference frame, the marked frame, and
the next frame in each row. Each tile displays the paired frames.
Combine `--sheet` and `--beat` to isolate one row.

Set `beats` to a downloaded alignment file or to the pairs shown above.
Set `notes` to a downloaded notes file or to an array of `{id,time,text}`
entries in the plan. Both downloads identify the same two source clips.
Notes stay on the reference timeline when the alignment changes and show
the newly paired candidate frame. The browser also keeps local edits
where local storage is available. Inputs are bounded to 512 frames
per side, a one-megapixel registered grid, 96 MiB of decoded native
pixels, and 64 MiB of unique encoded frames.

## Node and browser APIs

```js
const ink = require('@shapeshift-labs/ink-studio');
const review = ink.createReferenceClipReview('review.json');
const [start, end] = review.alignment.range('ignition');
const { address, image } = review.frame(start, { mode: 'difference' });
const notes = review.alignment.notes([
  { id: 'rim', time: start, text: 'Check how long the rim remains visible.' }
]);
review.write('ignition-review', { time: start, includeSheet: true });
```

Use `KIT.referenceClips.create({reference, candidate, beats})` for the
alignment itself. Each source describes `fps`, `startFrame`, and
`frameCount`. `sample(seconds)` resolves the source addresses.
`frameTime(referenceFrame)` locates an exact reference frame.
`range(beatId)` gives the beat's playback span. The workbench uses the
ordinary Ink comparison playback session to loop that range.
