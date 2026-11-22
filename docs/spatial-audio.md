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
| `soundFamilies` | Named sets of takes for context-based selections in a binding's `select` rules. Takes use the same cue table as ordinary bindings. |
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

## Select a take from contact context

A binding can use `select` to choose a family before it falls back to its
ordinary `cue` or material `interaction`. The first matching rule with
eligible takes supplies the sound. Prop rules run before other rules.
Within each group, rules run in authored order. Independent bindings can
still layer cues on the same event.

```json
{
  "soundSeed": 41,
  "surface": "floor/surface",
  "cues": {
    "wet-tick": { "asset": "wet-tick", "bus": "foley" },
    "wet-strike": { "asset": "wet-strike", "bus": "foley" },
    "board-knock": { "asset": "board-knock", "bus": "foley" },
    "default-contact": "default-contact"
  },
  "soundFamilies": {
    "wet-stone": {
      "takes": {
        "soft": { "cue": "wet-tick", "strength": [0, 0.45] },
        "hard": { "cue": "wet-strike", "strength": [0.45, 1] }
      }
    },
    "dry-boards": { "takes": { "knock": "board-knock" } }
  },
  "bindings": {
    "drops": {
      "on": { "kind": "object-contact" },
      "cue": "default-contact",
      "select": [
        { "id": "wet", "when": { "action": "drop", "object": "metal-hook", "surface": "shop/stone", "wetness": [0.5, 1] }, "family": "wet-stone" },
        { "id": "dry", "when": { "action": "drop", "object": "metal-hook", "surface": "shop/boards", "wetness": [0, 0.5] }, "family": "dry-boards" }
      ]
    }
  }
}
```

Commit the action, object, surface, and normalized strength in the
event, its `contact` record, or a typed fact's `data`. When available,
legacy `interaction`, `entity`, `source`, and `material` also supply
labels. With `surface` configured, Ink samples the contact point for a
material ID and wetness. Explicit event values take precedence over
the surface reading. A binding can convert a recorded contact `speed`
to strength with `speedForFullStrength`. Speeds at or above that
reference map to one.

Rules can constrain `action`, `object`, `prop`, `surface`, `strength`, and
`wetness`. Strength and wetness use ranges from zero to one with an
inclusive lower bound and exclusive upper bound, except that one is
included in a range ending there. A missing measurement can match an
unrestricted rule or take. A take's optional positive `weight`
defaults to one. When several takes qualify, Ink uses `soundSeed`
and the committed event's ID to choose among them. Trimming or
replaying a recording yields the same take.

The voice and story audio report carry a `selection` receipt with
the binding, rule, family, chosen take, eligible takes, and resolved
context. Cue assets can reference WAVs, editable recipes, or exact
registry revisions from a saved event-sound family. [Sound browser exports](music-edit-session.md#export-the-candidate)

Run the [context sound demo](../examples/context-sounds/demo.cjs) with
`node examples/context-sounds/demo.cjs output/context-sounds` to hear
the same hook on wet stone and dry boards.

### Blend velocity layers and override a material

Give a family a `layers` array to blend neighboring takes. Each layer
names its normalized velocity `at` and one or more takes from that
family. Keep layer positions strictly increasing. Weights on takes
still rank alternatives within a layer.

```json
{
  "soundFamilies": {
    "board": { "takes": { "knock": "board-knock" } },
    "brass-latch": {
      "takes": { "soft": "latch-touch", "hard": "latch-clack" },
      "layers": [{ "at": 0, "takes": ["soft"] }, { "at": 1, "takes": ["hard"] }]
    }
  },
  "bindings": {
    "impact": {
      "on": { "kind": "object-contact" },
      "speedForFullStrength": 4,
      "loadForFullStrength": 120,
      "cue": "default-contact",
      "select": [
        { "id": "wood", "when": { "surface": "shop/boards" }, "family": "board" },
        { "id": "latch", "when": { "prop": "brass-latch" }, "family": "brass-latch" }
      ]
    }
  }
}
```

`prop` identifies a particular item. It can be authored on the event
or contact, and defaults to a recorded entity or source ID when available.
Here the specific brass latch takes precedence over the boards. When its
rule or takes are ineligible, the boards can supply the sound.

An explicit normalized `strength` takes precedence. Otherwise Ink
uses scalar `load` or the magnitude of force along the contact normal
when `loadForFullStrength` is set. It uses `speed` when
`speedForFullStrength` is set and a load is unavailable. The
measurement is divided by its authored reference and capped at one.

Ink blends the two neighboring layers with linear gains that add to one
and schedules them at the same event time. At an anchor or outside the
authored span it plays one layer. Without a measurement it tries the
lowest velocity layer. When a take's strength restriction leaves just one of
the two layers eligible, that layer plays at full gain. If neither is
eligible, the selector tries the next rule.

For each played layer, the story audio report records the measurement,
anchor, weight, and any layer fallback alongside the source beat.

Run the [velocity layers demo](../examples/velocity-layers/demo.cjs) with
`node examples/velocity-layers/demo.cjs output/velocity-layers` to hear
wood respond to speed and a brass latch respond to load on the same boards.
