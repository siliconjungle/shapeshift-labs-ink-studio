# Live audio and show control

Ink's browser entry `show-control.mjs` exposes live Web Audio routing, beat and timecode readers, projective texture mapping and DMX fixture patching. The local `show-bridge` command provides the browser interface to OSC, ArtTimeCode, Art-Net and sACN. The included Ableton Link companion is optional.

Use [`ink-studio patch show`](patch-tooling.md#run-a-patch-as-a-show) to run a graph from a cue file, send its output to a projector, switch presets from MIDI or OSC, and write a rehearsal report.

## Run Signal Room

```sh
npx ink-studio show-bridge
```

In a checkout use `node cli/ink-studio.js show-bridge`. Open [Signal Room](http://127.0.0.1:8181/). The default setup runs fixture simulation and listens for OSC on UDP 9002 over loopback.

1. Start the two-track audio demo. Use the two gain controls to change the live mix. The waveform and fixture levels follow the buses. Enable **Monitor mix** to hear the result.
2. Switch to **Demo LTC waveform** to decode a generated timecode signal in an AudioWorklet. Try the 29.97 DF setting. The **Demo MIDI Clock** mode uses a simulated MIDI tick stream.
3. Drag a projection corner or focus it and use the arrow keys. Adjust edge blend, save the mapping, or open the clean projector window. Move that window to the target display and double-click the canvas to enter full screen.
4. Try the stage cues and blackout. The simulation uses the same 512-channel fixture patch as the bridge's hardware output.

Chrome is a supported environment for Web Audio, AudioWorklet, Web MIDI and WebGL 2. Microphone, line input and MIDI access depend on the browser and device permissions. A standalone build of the gallery can run the audio, clock and projection studies locally. UDP and the Link companion connect through the local bridge.

## Route and record live audio

```js
import { createLiveAudioRouter } from './show-control.mjs';

const audio = new AudioContext();
await audio.resume();
const router = createLiveAudioRouter(audio);
router.addBus('music', { gain: .6, pan: -.1 });
router.send('music', 'main', .8);

const player = audio.createBufferSource();
player.buffer = decodedAudioBuffer;
const detach = router.attach('music', player);
player.onended = detach;
player.start();
router.setMonitor(.5);

const { rms, peak, bands } = router.read('main');
```

Connect any source node from the same AudioContext, including a file buffer, oscillator, microphone stream or WebRTC media stream. Buses mix into destinations by named sends. Each bus exposes live gain, stereo pan, post-fader waveform, RMS, peak and named FFT bands. Remove a send with `removeSend(from, to)`, or connect a bus's post-fader output to another Web Audio node via `tap(id, destination)`. Dispose the router to disconnect its resources. The host owns the AudioContext, source nodes, device selection and input streams.

Pass an existing [Ink modulation recorder](graph-media.md#recordable-live-modulation) to `router.capture(recorder, ['main', 'music'], performance.now() / 1000)` to record named meter and band samples in a portable input take. Use the recorder's clock domain for explicit timestamps. Each capture writes up to 128 channels in one packet.

Use [sample capture](sample-capture.md) to recover the actual PCM from a
live bus or microphone and save it as a reusable library sample.

## Synchronize music and picture

| Source | Use |
| --- | --- |
| MIDI Clock | Pass incoming Web MIDI bytes and `event.timeStamp / 1000` to `createMidiBeatClock().push()`. Read BPM, beat, phase, transport and lock state with `sample()`. It follows 24 ticks per quarter note, Start, Continue, Stop and Song Position Pointer. |
| Ableton Link | The local companion publishes tempo, beat, peer count and transport state. Read `state.link` through `connectShowBridge().read()` and pass it to `sampleLinkClock()`. The timeline runs through Link's transport changes. |
| MIDI Time Code | Feed MIDI messages to `createMidiTimecode().push(bytes)`. It decodes full-frame Sysex and assembles both directions of quarter-frame messages. Full-frame input requires browser permission for SysEx. |
| SMPTE LTC | Pass PCM blocks to `createLtcDecoder({ sampleRate, fps }).push(samples)`, or load `src/show/ltc-worklet.mjs` in an AudioContext and connect a clean line input to the `ink-ltc` processor. Select the source rate explicitly. The decoder reads forward timecode and supports 23.976, 24, 25, 29.97 and 30 fps. For 29.97 drop-frame pass `30000 / 1001`. |
| ArtTimeCode | Start the bridge with `--art-timecode-in 6454` and read `state.timecode`. Choose an explicit `--input-host` when receiving from another device. |

LTC and MTC return SMPTE labels, frame numbers and times in seconds. `readTimecode()` and `timecodeAt()` apply drop-frame labeling and 24-hour wrap. These decoded positions can drive picture timelines and cue selection. Browser display and bridge sampling operate at application timing with no hardware genlock.

### Connect Ableton Link

Run the bridge and then launch the companion from a Python environment with `aalink` installed.

```sh
python3 -m venv .venv-link
.venv-link/bin/python -m pip install aalink
.venv-link/bin/python scripts/show-link.py --port 9002
```

Enable Link in the DAW on the same network and select **Ableton Link** in Signal Room. The companion follows the session through the Ableton Link library. Enable Start Stop Sync in the DAW if it should share transport state. The companion publishes to loopback and does not write tempo or transport back to the session. Use the same port as the bridge's `--osc-in` setting.

## Map projector surfaces

```js
import { createProjectionMapper } from './show-control.mjs';

const projector = createProjectionMapper(outputCanvas, [{
  id: 'left',
  source: 'scene',
  corners: [[.08, .12], [.91, .07], [.94, .91], [.12, .88]],
  crop: [0, 0, 1, 1],
  edges: [0, 0, .15, 0],
  gain: 1,
  gamma: 1
}]);

projector.render({ scene: inkCanvas });
```

Supply a canvas, video, image or another WebGL texture source per name. Each surface maps a cropped source onto a convex quadrilateral. Coordinates are normalized from the top left and corner order is top-left, top-right, bottom-right, bottom-left. Edge widths are fractions of the mapped surface and ordered left, top, right, bottom. Overlaps combine additively. Adjust crop, edge widths, gain and blend gamma for the projector arrangement. The browser demo saves and reloads a JSON mapping and opens one dedicated output window. Hosts can create a mapper per window or canvas.

## Patch stage hardware

Configure a destination explicitly. The bridge starts disarmed. For example, on a private lighting network with a gateway at `192.168.10.19`:

```sh
npx ink-studio show-bridge --dmx-protocol artnet --dmx-host 192.168.10.19 --universe 0
npx ink-studio show-bridge --dmx-protocol sacn --dmx-host 192.168.10.19 --universe 1
```

Choose one command for the protocol used by the gateway. Art-Net and sACN use unicast UDP ports 6454 and 5568 by default. `--dmx-port` overrides the destination port. Set `--osc-host` and `--osc-port` for outbound OSC. The OSC and ArtTimeCode inputs bind to loopback by default. Use `--input-host <local IPv4>` for LAN traffic, or `0.0.0.0` to listen on all interfaces. The browser UI remains loopback-only.

Signal Room's fixture profiles are three dimmer/RGB washes starting at channels 1, 5 and 9. Match the addresses and channel profiles to the real fixtures before arming, or use a separate patch through `patchDmx()`.

```js
import { connectShowBridge, patchDmx } from './show-control.mjs';

const bridge = await connectShowBridge(); // Same-origin page served by the bridge
const patch = [{ id: 'wash', address: 1, channels: ['dimmer', 'red', 'green', 'blue'] }];
const slots = patchDmx(patch, { wash: { dimmer: .5, red: 1, green: .2, blue: 0 } });
await bridge.arm();
await bridge.dmx(slots); // Send refreshed frames while armed
await bridge.disarm();
```

DMX addresses are one-based and controls range from 0–1. The patch emits 512 slots. The bridge sends at most 40 frames per second, revokes output after 1.2 seconds without a refresh, and sends blackout on disarm or lease expiry. A stale frame cannot re-arm an expired session. sACN ends its stream with terminated packets. Hardware receivers and their fallback behavior are part of the venue setup.

Incoming single-message OSC supports concrete addresses and integer, float, string and boolean arguments. Signal Room listens for `/ink/cue` with cue index 0–2 and `/ink/master` with a level from 0–1. `bridge.osc(address, args)` sends a message to the configured outbound endpoint.

Protocol references. [Ableton Link](https://ableton.github.io/link/) · [MIDI Time Code](https://midi.org/midi-time-code) · [SMPTE ST 12-1](https://pub.smpte.org/pub/st12-1/st0012-1-2014.pdf) · [Art-Net](https://art-net.org.uk/downloads/art-net.pdf) · [ESTA sACN specification](https://tsp.esta.org/tsp/documents/docs/ANSI_E1-31-2018.pdf) · [OSC 1.0](https://opensoundcontrol.stanford.edu/spec-1_0.html)
