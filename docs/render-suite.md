# Standard render comparison suite

Run the headless suite from a built checkout.

```sh
npm run build
node cli/ink-studio.js render-suite --out render-review
```

Each fixture has a pan, orbit, zoom, and hard cut. Both lanes use the same
seed, pose time, camera and native art dimensions. The cut sequence holds
the camera on either side. History resets at the start of each move and
at the cut. The default is 128 × 80 art pixels, 12 fps, and six frames per
move. Use `--w`, `--h`, `--fps` or `--frames-per-move` to change them.

| Scene | Reference | Candidate |
| --- | --- | --- |
| Gatehouse | Traced SDF arch and painted sluice screen | Splat arch with the same screen |
| Signal coil | Full finite strands | Projected-error subdivision at 0.65 art pixels |
| Night watch at Saltgate | 21 cloud steps with the authored fog and lights | 9 cloud steps with the same fog and lights |

`comparison.apng` plays the matched moves. `comparison.png` shows the
first frame after the cut for all scenes. Read each row from left to
right as reference, candidate, and evidence. Orange marks missing
silhouette pixels, cyan marks added pixels, and pink marks detected
strand gaps. Red intensity marks RGB error elsewhere.

## Read the report

`report.json` includes the exact camera plan, profiles, seed, art dimensions,
per-frame observations and per-move summaries.

- **Frame time.** The suite runs each scene and lane in its own Node
  process, warms up four frames, then records headless render time with
  work counters enabled. Scene construction, posing, diagnostic captures
  and image encoding are outside the frame timing. Percentiles are
  nearest-rank p50, p95 and p99. Increase the frame count when comparing
  tails across changes.
- **Memory.** The process peak RSS includes startup, the scene, warmup
  and the render sequence. RSS, heap, external allocation and array
  buffers also have snapshots before the sequence and sampled peaks
  after each measured frame. The report stores all memory values in
  bytes. [Node process measurements](https://nodejs.org/api/process.html#processresourceusage)
- **Overdraw.** The work count is composited fragments divided by native
  art pixels, including any secondary raster passes in the frame. The
  frame also records raster passes, translucent fragments, curve spans
  and cloud samples. Fragments rejected before compositing are outside
  this count.
- **Silhouette and paint.** The silhouette error is the symmetric
  difference divided by the union of the two masks. The gatehouse mask
  uses the arch's object ID so a filled opening registers as an error,
  the coil mask uses visible strand coverage of at least 0.45, and the
  night mask uses scene coverage of at least 0.5. The gatehouse report
  also measures RGB RMS error on pixels owned by the painted screen in
  both lanes.
- **Strand breaks and flicker.** The coil checks gaps bracketed by visible
  samples from the same reference strand and reports missing strands
  separately. Its tracked flicker follows strand motion. For every
  scene, the RGB flicker metric measures the change in the candidate's
  per-pixel error against the matched reference. Moving shots can carry
  spatial errors through a pixel, so the report also isolates held
  cameras. Transitions across cuts and move boundaries are excluded.
- **Timing and diagnostic parity.** Each frame has a picture hash from
  the timing run and records whether the diagnostic render reproduced
  it. The summary counts any mismatches for review.

Use [video codec round-trip approval](video-round-trip.md) to check a decoded delivery file against its numbered source frames.

## Compare a different setting

Use `--scene` to run just `gatehouse`, `signal-coil`, or `night`. A JSON
profile overlays each lane's defaults with headless render options.
The night fixture also accepts `cloudSteps` from 2 to 32.

```json
{
  "signal-coil": {
    "candidate": { "render": { "curveSubdivision": { "pixels": 0.35 } } }
  },
  "night": {
    "candidate": { "cloudSteps": 14 }
  }
}
```

```sh
node cli/ink-studio.js render-suite --profile settings.json --out render-review
```

Use the same command on another checkout to collect comparable work and
image measurements. Timing and process memory vary by machine and Node
version. The report records both.

## Accept a painted gatehouse revision

```sh
node examples/gatehouse-revision/demo.cjs gatehouse-edit-review
```

The edit fixture reuses the standard gatehouse set, sluice and orbit.
The fixture uses an editable polygon portal for the gatehouse arch.
The pixel editor previews and commits a topology patch that widens the
throat and adds an entrance bevel. The asset path exports the committed
topology, previews replacement of the pinned part, and reloads the new
revision. The sign material and its mounting socket survive replacement.

Both edited lanes must produce identical pictures. The test compares sign
coverage and RGB against the original frame at each camera and checks all
6,144 source texels against the original atlas. A second capture exposes a
probe just past the rear face of the opening. The test measures its
visible pixels and longest continuous row on the 128 × 80 art grid.
The report also records five straight through-passage ray checks at a
fixed height in scene units.
With the sluice held at the left end of its travel, the edited passage
must gain at least two contiguous pixels and 12 visible exit pixels at
each of nine orbit views.

`orbit.apng` plays the three matched lanes at 1×. `comparison.png` shows
three angles with integer 2× zoom. Read the columns left to right as the
original, native edit, and asset replacement. In `clearance.png`, teal
marks the visible probe before and after the native edit. The output includes the atlas, both
GLBs, the native patch and receipt, the asset replacement preview, and
`report.json` with per-view measurements.
