# Calibrate display and speaker latency

Record four aligned flashes and clicks through the real output setup. Ink measures the spacing between the display and the audible click and saves the delay for the faster path in a named output profile.

## Play and record the signal

```sh
ink-studio output-latency signal --out flash-click.mp4
```

1. Play the clip at normal speed through the display, speaker route and player you want to calibrate. Keep the output in the mode you'll use, including display refresh and processing, audio routing and wireless settings.
2. From the viewing position, record the display and room sound together in **one** short video with its in-camera audio. Start before playback and include all four flashes, with dark frames on either side. Keep the camera still. Frame rates of 60 fps or higher give a narrower picture timing bracket. Export at normal speed without retiming the tracks.
3. Pick a box inside the flashing rectangle in your recording. Use fractions of the oriented camera frame for `[left, top, width, height]`. The box should avoid reflections, screen borders and moving people.

## Measure and save the profile

Save a plan next to the camera clip and edit the output labels and region to match your setup.

```json
{
  "format": "ink-studio/output-latency-plan",
  "version": 1,
  "recording": "camera.mov",
  "output": {
    "id": "screen-a-front-row",
    "display": "Screen A, 60 Hz, game mode",
    "speakers": "Soundbar over HDMI ARC",
    "playback": "Local player, full screen"
  },
  "region": [0.38, 0.32, 0.24, 0.30]
}
```

```sh
ink-studio output-latency measure plan.json --out screen-a.json --report measurement.json
```

Positive `audioMinusPictureMs` means the click reached the microphone later than the flash reached the camera. The profile sets `pictureDelayMs` in that case. A negative offset sets `audioDelayMs`. Both fields are nonnegative. Use the delay on the corresponding playback path for this setup.

Measurement uses the video and audio presentation timestamps from the same file, including any difference in track start times. Each picture estimate is the midpoint between the last dark frame and the first bright frame. The report includes both frame times, the detected click sample and any competing candidates. The profile uses the median of at least three unambiguous trials. Its uncertainty includes half the widest picture timing bracket, the median absolute trial deviation, and one audio sample. Offsets within that uncertainty save zero delay.

A clip with unresolved flashes, too few unambiguous clicks or excessive trial spread exits with status 2 and preserves any existing output profile. Use the report to check which trial needs another recording.

| Optional plan field | Meaning |
| --- | --- |
| `window` | `[start, end]` in seconds from the earliest playable track timestamp. Use this to exclude room movement before or after the four flashes. |
| `channel` | A zero-based microphone channel or `"mix"` (default). |
| `maxOffsetMs` | Click search radius on either side of each flash, from 40 to 400 ms. Defaults to 350 ms. |
| `maxSpreadMs` | Maximum spread of trial offsets, from 5 to 100 ms. Defaults to 35 ms. |
| `recorderBiasMs` | Independently measured signed audio-minus-picture bias of the camera and mic path. Ink subtracts it from the raw median. Defaults to zero. |

Camera and microphone bias can affect the measurement. Keep the same recorder and placement for both passes. Acoustic travel to the recording position is included in what you measure. Recheck after changing the display mode, player, speaker route or listening position.

## Verify the correction

```sh
ink-studio output-latency signal --profile screen-a.json --out verify.mp4
```

Play and film the verification clip through the same setup. Measure it into a separate profile or test report to check the residual. The signal puts picture delay on its 120 fps frame grid and audio delay on its 48 kHz sample grid. It prints the applied delays.

Both commands use local FFmpeg. Measurement also uses FFprobe. Override the executable paths with `--ffmpeg` and `--ffprobe`. Measure a 4.5–20 second video with an ordinary audio track. Keep the original camera presentation timestamps, especially with variable-frame-rate capture.

## Runnable example

```sh
node examples/output-latency/demo.cjs /path/to/demo
```

The example inserts a known 84 ms audio delay in a simulated capture, measures a profile, and runs a second simulated capture after applying the profile to the signal. Open `index.html` to play both captures and inspect the measured result.
