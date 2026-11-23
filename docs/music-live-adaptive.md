# Live adaptive audio

`KIT.music.production.live` runs a production timeline indefinitely on a stereo
sample clock. The browser, game, or audio service owns the device and supplies
world inputs. The engine owns note admission, instrument state, tape echo,
room history, looping, and authored joins. It needs no external runtime or
plugins.

## Open and drive a score

Use the existing production sources and [adaptive timeline](music-production.md#assemble-adaptive-transitions).
The timeline's `end` is optional here. Express a finite capture length in the
replay route. A section loops until a transition unless it has `loop: false`.

```js
const live = KIT.music.production.live;
const score = live.open(sources, timeline, {
  clock: adaptiveScore, sampleRate: 48000,
  maxVoices: 32, reservedVoices: 4, foreground: ['reed', 'bass'],
  priorities: { kick: 5, mesh: -5 }
});

score.update({ time: 0.8, parameters: { gateOpen: 1 } });
const block = score.pull(512);
const report = score.inspect();
```

`update` feeds the existing [adaptive score clock](adaptive-music.md), including
its quantization, cue requests, and cancellation of pending control rules.
Advance it with world time even when no parameters change. If the world already
emits committed intents, omit `clock` and call
`score.dispatch(intent, { observedAt })` for each `music-transition`,
`music-cue`, or `music-layer`. Map a world sound to a resource by dispatching a `music-cue`.
`observedAt` defaults to the current output position. With nonzero `startTime`,
world timestamps remain absolute, and output sample positions start at zero.

`pull(frames)` advances the same score by 1–16,384 frames and returns
`{ firstFrame, sampleRate, channels: 2, samples }`. Render calls belong on a
voice worker or output producer with a short buffer before the device.
Choose the buffer size for the host and call `prefetch` ahead of consumption.
No I/O takes place inside `pull`.

## Change a layer while it plays

Bind each part to a named adaptive score parameter or emotion. Add the
following to the score clock config to let danger bring in the kick.

```js
parameters: { danger: { default: 0 } },
layerControls: {
  kick: { parameter: 'danger', range: [0.15, 0.9], attack: 0.4, release: 0.8 }
}
```

`range` names the input values for silence and full gain. The gain between
them is linear and clamps to 0–1 outside the range. Reverse the endpoints for
a layer that fades out as the input rises. The binding reads the input target.
The mixer applies `attack` and `release` in seconds on the sample clock.
The clock emits a `music-layer` intent when the mapped target changes.

Keep the authored section gain positive for parts you want to reveal. The
live gain multiplies it. While a live layer is at zero, its notes, envelopes,
and instrument state continue under the normal voice budget. Ramps affect
the dry signal and new room and tape sends. Existing effect tails decay in
place. Bridge and stinger tracks have their own gains.

Hosts can set `layerGains: { kick: 0 }` in `live.open` and dispatch gain
intents directly. `time` uses the same clock as the other music intents.

```js
score.dispatch({ kind: 'music-layer', time: 3.8, part: 'kick', gain: 1, ramp: 0.4 });
```

A new ramp starts from the current gain on its first sample, including when
it interrupts a previous ramp. Delivery after the intent time starts the
ramp on the next available sample. `ramp: 0` applies an immediate change.
Omit `ramp` for a 50 ms fade. `inspect().layerGains` shows current and target
gains, and the `layer-gain` trace rows include the start and end frames.

## Loop phase-aligned stems

Use a stem group to play printed bass, percussion, or ambience beside the
production score. Give the group one loop length in sample frames. Each
part names a PCM stream and can select its first source frame.

```js
const score = live.open(sources, timeline, {
  sampleRate: 48000,
  streams,
  readPage,
  stemGroups: {
    relay: {
      frames: 192000,
      parts: {
        kick: { stream: 'kick-loop' },
        bass: { stream: 'bass-print', startFrame: 4096 }
      }
    }
  },
  layerGains: { bass: 0 }
});
```

Each stream must contain the full loop window at the engine's sample rate.
Print the loops from a common grid and choose clean seams in the source
audio. All parts read the same position in their respective windows. The
group starts at position zero unless you set `phaseFrames` to a position
inside its loop. The phase advances with the output clock through section
changes, zero gain, and missing data. A new engine can use `phaseFrames`
to start from a saved position.

Use `music-layer` or an adaptive `layerControls` binding with the stem part
name. A native track using the same name shares that fader. Stem part names
are unique across groups. Up to 16 groups and 64 stem parts can play alongside
the regular note and cue voice budget. The stream gain, pan, and room send
apply before the usual master stage.

Prefetch before the first pull and keep enough cache pages for the lookahead
of every stem, including muted ones. Prefetch looks across the loop seam.
If a page is late, its stem fades back in from the current position when data
returns. `inspect().stemGroups` shows each group's current frame and source
windows. Underrun rows include the group, part, source frame, and loop position.

## What plays through a join

An edge with an explicit `exit` waits for the next occurrence of that marker in
the current playback window. A looping section can pass through its loop head
first. A one-shot that has passed the marker leaves at the next available
output frame. An edge without an explicit exit takes the next output frame
at or after the committed intent. This uses the audio that's actually playing.
The offline planner can splice earlier material because it knows the entire
route up front.

A newer request can cancel or replace a pending exit, including at the exit
frame. Bridge and common-tone pickups sound at their authored lead times when
the request arrives in time. Pickups that already sounded get to release.
Transition-linked stingers land with their associated join. An intent arriving
after its timestamp is counted as late and handled causally from its arrival
frame. A transition older than a request the engine has already seen is traced
as stale. The chosen edge uses the section currently playing on the audio clock.

Persistent performers use the existing `performers.tracks` identity and desk
validation. Their admitted notes run through the original gate, phase,
resonator state and release. The matched performers share their tape echo
across sources. One room instance runs on the whole timeline. Choose it with
`performers.roomSource`; otherwise the opening source supplies the room.
A departing nonpersistent voice follows the edge's tail time or a short fade.
An authored room cut can clear the room. Live currently plays Ink-native
patches and PCM; external CLAP instrument renders use the existing offline path.

Phrase history counts a full segment pass when an eligible listening track
actually sounded. A phrase can change at the loop head according to who has
already been heard. Theme history uses admitted mapped notes. The join record
includes the committed intent and arrival, the requested and realized exit,
entry source and phrase, prior listening and route, held and releasing pitches
with phase and gate frames, and which effects continued.

## Budgets and prefetch

Background playback can use `maxVoices - reservedVoices` slots. Protected
foreground voices can use any remaining slot. A higher-priority incoming
voice can replace a background voice through a short fade within the same
hard limit. If the budget is all foreground, later foreground requests can
be dropped and are counted separately. `traceLimit` bounds the recent event
and join histories; `maxEvents` bounds queued intents.

A PCM resource descriptor declares `frames`, `channels` (1 or 2), the engine's
`sampleRate`, and optional gain in dB, pan, room send, priority, and
`foreground`. The host passes the descriptors as `streams` and supplies
`readPage(name, firstFrame, frameCount)`. Return interleaved finite
`Float32Array` samples. The engine issues bounded asynchronous page reads,
keeps the next pages for active and queued sounds, and favors foreground
resources. Set `pageSize` and `maxPages` to fit the host. To prime possible
next sounds before an event occurs, pass their names to
`score.prefetch(lookaheadFrames, names)`. A missing page fades toward silence
where the next miss is visible. When data comes back, the cue resumes from
its current position with a short ramp. Inspect read failures and audio
underruns independently. Native production sampler banks still use loaded assets.

`inspect()` returns the bounded trace, exact sample positions, recent block
peak and RMS, clip counts, voice admission, late arrivals, and PCM cache
activity. The host measures device underruns and processing time separately.

## Rehearse the actual live output

```js
const route = live.fromTrace(capturedTrace, {
  worldCues: { contact: 'chain', surf: 'foam' }
});
const { value, report } = await live.replay(sources, timeline, route, options);
```

A route is `{ end, events: [{ intent, observedAt }], blockFrames?, layerGains? }`.
Adaptive score traces include the initial gains and the committed gain
changes for live replay. Route gains take precedence for those parts.
Change `observedAt` to simulate late delivery and leave `intent.time` intact.
The replay feeds the same causal `pull` path and measures PCM around each
retained join, including the sample-to-sample step and local levels.
For file-backed stems and cues, add `live.streams` to the timeline recipe with
the resource's `file` and optional mix settings, and put engine settings in
`live.options`, including `stemGroups`. A captured trace can use `live.traceOptions.worldCues` and
`live.traceOptions.arrivalOffset`.

```sh
ink-studio music live replay score.json route.json --out printed-route
node examples/music-production/live-adaptive.cjs ./floodgate
```

Open `floodgate/index.html` to drive the demo, or listen to
`floodgate/recorded-route/score.wav`. The recorded route includes a reversal,
a late arrival, a long dwell, and two bursts of world cues. Its JSON report
records which notes carried and why the tower's phrase changes after the
first pass.

Run the Signal Watch example to listen to the same approach on a single
section.

```sh
node examples/music-production/live-layer-controls.cjs ./signal-watch
```

In `signal-watch/mix/score.wav`, danger begins to rise at 1.90 s and reaches
its highest target at 3.80 s. It starts to fall at 6.05 s. The pulse starts
silently with the score and plays as one held note throughout the fade.
`signal-watch/mix/listen.json` has the sample positions for each ramp.

```sh
node examples/music-production/phase-aligned-stems.cjs ./night-relay
```

In `night-relay/mix/score.wav`, bass fades in at 2.35 s, percussion joins at
5.10 s, and the live melody changes section at 8.50 s. The printed stems
stay on the same four-second loop throughout.
