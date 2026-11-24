# Flash and flicker review

Use the take's composited frames and the actual encoded delivery to review short flashes and their accumulation. Ink scans both picture tracks, traces decoded events to named lights or effects through source-disabled renders, and remeasures a lower-flicker preview after encoding.

```sh
ink-studio take review-flashes plan.json --out flash-review
```

Open `flash-review/index.html` for stills, a pulse accumulation map, a pulse table with contributing source IDs, and picture playback. Keep the original delivery in place so the review can play it. Use `--fail-on-flags` if a flagged interval should return exit status 2 after the review is written.

## Provide aligned evidence

```json
{
  "format": "ink-studio/flash-flicker-review",
  "version": 1,
  "picture": "all-sources/clip.json",
  "delivery": "delivery.mp4",
  "sources": [
    { "id": "relay-beacon", "kind": "light", "without": "no-beacon/clip.json" },
    { "id": "glass-discharge", "kind": "effect", "without": "no-discharge/clip.json" }
  ],
  "alternate": "reduced-flash/clip.json",
  "preview": { "reduction": 0.7, "crf": 18 }
}
```

- `picture`, each `without` and the optional `alternate` accept a numbered graph clip report, a take audiovisual export, or an inline `{"fps":24,"firstFrame":0,"frames":["000000.png","000001.png","000002.png"]}` reference. Paths in the plan are relative to the plan file. Use opaque SDR picture frames.
- Render each `without` sequence with only that authored light or effect disabled. Keep the camera, clock, seed, remaining sources and all compositing stages fixed. For graph-authored sources, use `graph clip` with the same clock and the appropriate `--inputs` override.
- Supply `alternate` when you have an authored revision that reduces several sources together. The review can use it as a preview candidate. Up to eight source ablations are accepted.
- Match the delivery frame count and presentation cadence to the picture excerpt. An optional integer `scale` maps nearest-neighbor enlarged deliveries onto the native picture grid by averaging each corresponding decoded block. Use `scale: 1` to scan the full delivery raster. The excerpt can contain 3–720 frames at up to 120 fps. Include handles so a flash has room to begin and return.
- The preview uses local FFmpeg H.264 and the selected CRF. FFprobe verifies both original and preview frame timing. Override either binary with `--ffmpeg` or `--ffprobe`.

## Read the results

A pulse requires opposite changes at the same picture pixel within `maxPulseSeconds`. The detector measures linear luminance and red-channel dominance and counts a pixel once when both trigger together. The thresholds in the plan are optional editorial settings.

| Threshold | Default | Meaning |
| --- | --- | --- |
| `minLumaDelta` | 0.12 | Minimum change in relative linear luminance on both legs |
| `minRedDelta` | 0.22 | Minimum change in linear red excess over green and blue on both legs |
| `minArea` | 0.08 | Picture fraction that must complete a pulse on the same frame for it to count toward a flagged interval |
| `maxPulseSeconds` | 0.33 | Maximum separation between the two transitions |
| `windowSeconds` | 1 | Rolling window length for completed pulses |
| `minFlashes` | 3 | Completed pulses in the rolling window that flag an interval |

`report.json` lists the affected bounds, the peak frame, the completion frame, and whether the pulse crosses a marked edit. Delivery-only pulses have no matching composited pulse in the same region. Delivery-amplified pulses have matching composited evidence at lower measured energy. The measure of energy weights pulse amplitude by screen area. Attribution compares local pulse energy against each source-disabled render using nearby completion frames. Sources can interact, so their separate reductions do not add up to a single percentage.

The review selects an ablation or authored alternate that reduces the source composite's pulse burden. It first tries the configured constant blend across the excerpt, then the full alternate. A composited sequence with lower burden than its delivery can also be retried with the preview encode settings. The review publishes the picture-only preview once its decoded result shows improvement under the same thresholds. The report records which variant and reduction it verified. Original renders and delivery files stay intact.
