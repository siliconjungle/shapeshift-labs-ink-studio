# Spatial audio and event cues

`KIT.world.spatialAudio.create(config)` builds a renderer-independent
mix. A mix can be inspected headlessly or played by a browser host.
The same listener and emitter positions can be used by camera,
simulation, and acoustic queries.

## Author cues and sources

| Setting | Purpose |
| --- | --- |
| `cues` | A table of cue names mapped to asset IDs or records with `asset`, `at`, `gain`, `pitch`, `distance`, and `occlusion`. A cue with an `at` position uses an XYZ point or entity/socket selector. A cue without a position plays without spatial panning. |
| `emitters` | Named looping emitters with a `cue`, optional overriding `at`, `gain`, and starting buffer `offset` in seconds. Entity/socket positions follow the current world snapshot. |
| `bindings` | Named rules with `on.kind`, optional `on.system` and `on.where`, and a `cue` or material `interaction`. A rule can override `at` and scale `gain`. |
| `materials` | A material-to-cue table with optional `step`, `roll`, and `impact` entries. Set `surface` to a physical surface field to read authored material sounds at a contact point. |
| `distance` | Default falloff in world units. Set `reference`, `max`, `rolloff`, and `fade`. Cues can override these values. Default gain is full through 1 unit, falls off inversely, and fades to silence across the last 5 of 50 units. |
| `occlusion` | An `acoustic` hearing field can supply room transmission and the listener-side apparent source. `rays` can name mechanics or construction traces. `segments` can name live volume segment traces. The closest blocker applies `lossDb` and low-pass `cutoff`, with optional overrides by blocker material. |

Room loss leaves distance falloff to the cue. The final segment toward
the apparent source can still be occluded by local geometry. An explicit
blocked acoustic route is silent. Set a cue's `occlusion` to false to omit
these tests for that cue. Set `propagationDelay` to true to include delay
from the acoustic route.

For offline soundtrack rendering, set `follow: true` on a cue to keep its
one-shot tail attached to its entity or socket. Set `bus` to route the cue
to a named post stem such as `foley`. [Adaptive story audio](adaptive-story-audio.md)

## Build and play a frame

Call `frame({query, listener, time, from, events, animation, timeline})`.
The listener is a point, an entity/socket selector, or
`{at, forward, up}`. Pass the committed world query and the events from
that step. `material-sound` and `audio-cue` use their cue and position
directly. Bind other simulation events by kind. An event can supply
`at`, `point`, or an entity ID for its source. Matching bindings take
precedence over direct dispatch and can layer several sounds.

Pass animation streams as a list of `{id, at, frame, contacts}`, where
`frame` is the current animation graph or puppet binding frame.
Animation markers and plant or release responses are available as
`animation-marker` and `animation-contact` events. A sound response can
reference a `contact` ID and use its solved target. Use `contacts` to
provide `at` and `material` for contacts sampled by the host at the
event time.

The optional compiled scene `timeline` supplies active clips with
their trimmed buffer offsets and retimed rates. `from` controls the
interval for zero-duration timeline cues. Active emitters and clips
are returned in `active`, and event cues in `cues`. Each voice reports
its resolved position, distance, per-band gains, filter cutoff, and
any obstacle or acoustic route status.

`createSpatialAudioPlayer(context, {resolveAsset, destination, panning,
maxVoices, smoothing})` is exported by `webgl.mjs`. The caller supplies
a Web Audio context and a resolver returning an `AudioBuffer` or promise
for each asset ID. Call `update(frame)` to update the listener and active
voices and play new cue IDs. One-shot cues use the acoustic mix at
dispatch. The native listener is shared by voices on a context.
Call `update(frame, {seek: true})` on a discontinuous seek and `dispose()`
when the player is removed. The caller owns the context and can resume it
from a user gesture. Cue assets stay under host control.
[Web Audio API](https://www.w3.org/TR/webaudio/)
