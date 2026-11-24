# Capture beat-level live performance

Use the patch show clock to save the work around a missed frame or audio underrun. The show keeps recent frames in memory and emits a case with roughly a quarter second on each side of the event.

```sh
ink-studio patch show show.json --capture-performance captures
```

The capture uses the show's existing cue IDs, observed graph event references, clock-map placements, and beat windows. A picture row records graph node timings, native scene raster passes, planar and probe captures, graph pass IDs when available, and WebGPU dispatches from patch shader nodes. It also records a digest of the submitted picture. Windows share one captured input sequence so a stateful graph can be warmed up before the affected frames.

## Include the live mixer

```sh
ink-studio patch show show.json --capture-performance captures \
  --live-score score.json --live-route route.json
```

Use the same score and route documents as `music live replay`. With these flags the show pulls the live software mixer on the show clock alongside the picture graph. It measures the mixer work and retains the voice roster at the block's peak and at the exact sample of a PCM page underrun. The case includes voice parts, streamed resources, continuous stems, cue and beat IDs when available, and software PCM digests. An underrun can open a case even if every picture frame was drawn.

Existing show `audioReports` can contribute placed underrun findings too. A case identifies those findings as imported evidence and retains their report pointer and sample range. Use the live score flags to collect active voices and replayable mixer work with the show. The live score tracer exercises software mixing and stream paging. Audio interface timing and speaker playback are outside this capture path.

## Replay the work

```sh
ink-studio patch stress captures/case-01.json --repeat 3 --out stress-report.json
```

Run from the same project to use the same host graph operations and GPU binding. `report.json` in the capture directory indexes the saved cases. Keep its `run.json` and media files together, plus the referenced graph, score and source assets. Replay checks source digests, warms up through the actual evaluated frame order and recorded controls, then measures the picture and mixer work in the case. Captured scheduler holes remain skipped. Compare the replay timings to the show budget and inspect whether the replay also encountered the recorded PCM gaps. Picture, PCM and captured voice evidence are checked against the original. Divergent evidence returns exit status 2.

The capture retains up to eight windows. It keeps a bounded graph warm-up sequence, controls, audio block evidence and accepted RGBA video inputs. When live input or frame history exceeds its replay budget, a later case can still contain diagnostics and will say why it cannot replay. The feature is opt-in so routine playback can use its normal render path.
