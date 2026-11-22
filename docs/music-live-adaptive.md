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
`score.dispatch(intent, { observedAt })` for each `music-transition` or
`music-cue`. Map a world sound to a resource by dispatching a `music-cue`.
`observedAt` defaults to the current output position. With nonzero `startTime`,
world timestamps remain absolute, and output sample positions start at zero.

`pull(frames)` advances the same score by 1–16,384 frames and returns
`{ firstFrame, sampleRate, channels: 2, samples }`. Render calls belong on a
voice worker or output producer with a short buffer before the device.
Choose the buffer size for the host and call `prefetch` ahead of consumption.
No I/O takes place inside `pull`.

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

A route is `{ end, events: [{ intent, observedAt }], blockFrames? }`.
Change `observedAt` to simulate late delivery and leave `intent.time` intact.
The replay feeds the same causal `pull` path and measures PCM around each
retained join, including the sample-to-sample step and local levels.
For file-backed streamed cues, add `live.streams` to the timeline recipe with
the resource's `file` and optional mix settings, and put engine settings in
`live.options`. A captured trace can use `live.traceOptions.worldCues` and
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
