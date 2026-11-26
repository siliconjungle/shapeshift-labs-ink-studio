# Record scene manipulation

Capture scene controls from a headless producer while the shot rolls. Arm the channels you want and send newline-delimited changes as the prop, lamp, or camera moves. The resulting take becomes an editable set of native timeline tracks.

```json
{
  "format": "ink-studio/scene-recording-plan",
  "version": 1,
  "id": "first-pass",
  "from": 0,
  "to": 2,
  "countIn": 0.5,
  "mode": "overdub",
  "channels": [
    "/poses/cart/translation",
    "/effects/0/strength",
    "/camera/yaw"
  ]
}
```

Arm named rig part channels under `/poses/<part>`, authored camera channels under `/camera`, or supported effect channels under `/effects/<expanded index>`. Use the same paths and units as the [scene timeline](scene-timeline.md#dioramas). A prop uses a solid's `part` field to make it movable. Its named `parts` entry can set the joint. Tracked values are absolute within their channel. A pose translation is an offset from the rig joint and a camera yaw is in radians.

```sh
ink-studio scene-record capture stage.json capture-plan.json --out take.json
ink-studio scene-record apply stage.json take.json --out recorded.json
ink-studio clip recorded.json --from 0 --to 2 --fps 12 --out performance.png
```

For live capture, feed one JSON object per line on stdin. Put simultaneous edits in the same packet.

```json
{"changes":[{"target":"/poses/cart/translation","value":[0.4,0,0]},{"target":"/camera/yaw","value":0.25}]}
```

The recorder timestamps arrivals on a monotonic clock. Status messages on stderr identify `count-in`, `rolling`, `punch-in`, and `punch-out`. Each reports its scene time, so a controller can follow the transport. Input during count-in is discarded. Capture stops at `to` or when stdin closes. The command prints a key and ignore-count receipt on stdout.

Use `--input moves.ndjson` to replay a recorded control stream deterministically. Include a nondecreasing `elapsed` field in each packet. It measures seconds since the start of count-in. Scene time is `from + elapsed - countIn`. The capture gate includes its start and excludes its end. The last update to a channel at the same timestamp wins.

- **Overdub** starts each touched channel at its first captured key and holds its final value through `to`.
- **Punch** uses `"mode": "punch"` and a `"punch": [0.75, 1.25]` window inside the rolling interval. It writes only touched, armed channels in that window. The first and last values hold to the punch boundaries.
- Applying a take appends native timeline clips. It preserves existing keys, nested sequences, and cues. Existing playback resumes after the overlay's inclusive end. Use a fresh take ID for another pass. Apply changes beside the source scene so relative asset paths continue to resolve.

Run the original [Signal Dolly example](../examples/scene-recording-demo.cjs).

```sh
node examples/scene-recording-demo.cjs /tmp/ink-scene-record
```

The first pass moves a cart, steers the camera, and rides a lamp. The second pass punches only the lamp. The demo saves both takes, their input journals, an editable final scene, a comparison sheet, and the animated clip.
