# Audio post-production and REAPER round trip

The workshop puts recorder tracks, editorial takes, room tone and printed
story roles on one sample clock. It uses Ink's native editorial and
repair engines. The REAPER adapter exchanges active takes and whole-item
moves, with the exact Ink recipe, source WAVs and verification prints
beside the DAW project.

## Start from a story handoff

```sh
ink-studio music post from-story story/handoff.json --out project.json
```

A story that supplies editable dialogue contributes its individual line
clips to the session. The other roles come from the printed stems. Treat
the story mix as a listening reference if the soundtrack used dialogue
bus effects. Map scene and take from the field recorder's sound report,
then use a shared clock or per-alternate sync marks.

```sh
ink-studio music post relink project.json field-sheet.json --out relinked
```

```json
{
  "recordings": [
    {"id":"boom","asset":"roll","scene":"24C","take":"02","kind":"boom","channels":[0]},
    {"id":"lav","asset":"roll","scene":"24C","take":"02","kind":"lav","channels":[1]},
    {"id":"adr","asset":"studio","scene":"24C","take":"08","kind":"adr","anchors":{"line":3700}}
  ],
  "links": [
    {"clip":"cue-1","scene":"24C","take":"02","anchor":"line","recorderSample":"242400",
      "alternates":["adr"],"prefer":"boom","handles":2100}
  ]
}
```

Add the recordings to the project's WAV asset table first. Scene and take
are exact strings. Supply a zero-based channel selection for a polyphonic
recording. A recording can supply `timeReference` explicitly or use the
Broadcast Wave time reference. Both are counted on the recording's native
grid. The link's `recorderSample` is absolute on the session's sample grid.
An authored mark on the recording takes precedence over clock matching.
Use the `alternates` list for explicitly chosen recordings from other takes
in the same scene. Ink aligns each take's source mark to the clip's shared
picture spot and reports recordings it could not align or fit. It keeps the
original take and source WAV. `prefer` selects an aligned alternative.

## Repair, room tone and picture changes

```sh
ink-studio music post repair relinked/project.json repair.json --out repaired
ink-studio music post room donor.wav room.json --out fill
ink-studio music post review repaired/project.json revised-cut.json --out review
```

A repair request names `clip`, optional `take`, a new alternate ID in `as`,
and the existing [dialogue repair options](dialogue-repair.md) in `options`.
Pass `select: true` to activate it. Repair prints preserve the source clock.
The `before`, `repaired`, and `removed` files share the same range and gain
reference. Listen to the difference before choosing the alternate.

A room request names the reference WAV with `reference`, relative to the
request, and sets `options.donor` and `options.reference` to quiet ranges
with `fromSample` and `toSample` on their respective files. Ink loops and
crossfades the recorded donor, matches three broad frequency bands and level,
and returns `options.frames` frames on the donor grid. Optional
`crossfadeSamples`, `maxBandDb`, `maxLevelDb`, and `seed` control the fit.
Place the resulting WAV on an ambience lane with the usual editorial tools.

Review accepts a revised `picture`, `world`, `map` or `clockMap`. Its report
lists picture trims, removed or reordered shots, moved clips, lost anchors,
and overlaps to audition. Compare the aligned before and after WAVs. Resolve
or explicitly omit unresolved items before a DAW export. A clip with a
sample nudge retains its original anchor. Ink carries the same signed offset
forward when the underlying picture or world address moves.

## Exchange one edit with REAPER

```sh
ink-studio music post export review/project.json reaper.json --out handoff
ink-studio music post import handoff handoff/reaper-return.json --out returned
```

The optional `reaper.json` may supply `picture` as a path to the current
MOV or MP4 edit. Export assumes that picture starts at local zero on the
session's cut. REAPER's ruler uses integer or 1000/1001 frame rates. An
unusual rate keeps its exact picture and sample clock in the Ink archive.
Use `records` to archive named JSON field sheets, repair settings or recut
reports alongside the editable session. Supply `allowUnresolved: true` to omit unresolved clips and
record them in the manifest.

1. Open `handoff/edit.rpp` in REAPER. Switch an item's active take or move a
   whole audio item along its track. Each take uses the same padded window,
   so the internal sync mark stays at the same offset. Project markers show
   the original sync positions.
2. From the Actions list, load and run **Capture Ink edits.lua**, included
   in the handoff. It writes `reaper-return.json` beside the current project.
   Save the edit beside the exported project to keep media addresses relative
   when the package changes machines.
3. Run the import above. Ink validates the item, take, track, source hash and
   archived project. It applies the addressed edits and prints Broadcast
   Wave stems and a mix. The report gives the returned sync samples and
   measures decoded-stem recombination against that mix.

The return supports an active-take selection and a same-track item move,
snapped to the nearest output sample. Selecting a different full take
replaces the current comp on that clip, with the old comp preserved in
`ink/project.json`. A move within the picture bounds retains the underlying
source anchor and updates its sample offset. Moves that would expose already
cropped material are rejected. REAPER trims, fades, time stretch, newly
recorded takes and plug-in edits stay in the DAW project. Ink uses rendered
take proxies to audition its own comps, fades and repairs in the workstation
and keeps the original edit state and WAVs in the archive.

## Reproduce the demo

```sh
node scripts/build.js node
node examples/post-production/reaper-roundtrip.cjs ./post-demo /path/to/REAPER
```

The demo uses the Lantern Gate story, local speech synthesis when generating
the story audio, and FFmpeg for its picture preview. Omit the REAPER executable
to prepare the handoff for manual editing. With REAPER, the verifier opens
the project, switches the first line from a repaired boom take to ADR,
moves the Foley impact by 1,200 samples, captures the edit, and compares
REAPER's native mix render with the returned Ink print on the exact picture
window. The CLI and audio
processors use only Ink code and Node built-ins.

Editorial references. [Nuendo field-recorder workflow](https://www.steinberg.help/r/nuendo/15.0/en/cubase_nuendo/topics/audio_editing_to_picture/audio_editing_to_picture_import_field_recorder_files_c.html) · [Nuendo reconform](https://www.steinberg.help/r/nuendo/15.0/en/cubase_nuendo/topics/reconform/reconform_workflow_c.html) · [RX ambience matching](https://www.izotope.com/en/products/rx/features/ambience-match.html) · [OpenTimelineIO adapter support](https://opentimelineio.readthedocs.io/en/latest/tutorials/feature-matrix.html) · [REAPER ReaScript API](https://www.reaper.fm/sdk/reascript/reascripthelp.html)
