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
| `bindings` | Named rules with `on.kind`, optional `on.system` and `on.where`, and a `cue` or material `interaction`. A rule can override `at` and scale `gain` or define compound `impactLayers`. |
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

`createSpatialAudioPlayer(context, {resolveAsset, destination, destinations,
panning, maxVoices, smoothing})` is exported by `webgl.mjs`. The caller supplies
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

### Rotate takes and replay the choices

Add a `variation` record to a sound family that should rotate takes or
vary pitch.

```json
{
  "takes": { "a": "hook-a", "b": "hook-b", "c": "hook-c" },
  "variation": { "rotate": true, "pitchCents": [-90, 90] }
}
```

With rotation enabled, Ink draws from unused eligible takes before
starting a new cycle. It excludes the last take while another take
qualifies. If just one take qualifies, that take can repeat. History
is separate for each binding, family, and velocity layer. Take
weights still apply when choosing among the available alternatives.

`pitchCents` is an inclusive range of integer cents between −1200 and
1200. It defaults to zero cents. Each event gets a seeded draw,
applied on top of its event and cue pitch. Set `rotate` to false or
omit it to use pitch variation with ordinary weighted selection.

Live hosts can pass a fresh `planner.createPlayback()` as `playback`
to `frame` when starting a new event stream. Without one, the
planner keeps its own history and resets it when frame time moves
backward. Feed it events in committed order. Recent duplicate event
deliveries reuse their decisions.

`story audio` runs the selector from the recording's origin, including
the events before a trimmed window. It writes `receipts.json` for
families with variation. Each receipt holds the source beat, binding,
family, take, layer when present, pitch in cents, and final playback rate.

```sh
ink-studio story audio shop.run.json shop.audio.json --out first
ink-studio story audio shop.run.json shop.audio.json --receipts first/receipts.json --out replay
```

Replay uses saved choices for the matching beats. Keep the referenced
takes and assets available in the soundtrack. Beats without a saved
choice still use the live selector, with the history updated by any
saved choices it played.

Run the [repeat avoidance demo](../examples/repeat-safe-sounds/demo.cjs)
with `node examples/repeat-safe-sounds/demo.cjs output/repeat-safe-sounds`
to compare a weighted draw, a rotation, and receipt replay after a seed
change.

## Sustain drag, roll, and scrape sounds

Add `contactLoops` to the spatial settings used by a live player or a scene
soundtrack. Each interaction uses a looping cue and can override it by
material. Use a loop-ready WAV or a compatible soundtrack asset for each cue.

```json
{
  "surface": "floor/surface",
  "cues": {
    "wheel-boards": { "asset": "wood-rumble", "bus": "foley" },
    "wheel-stone": { "asset": "stone-rumble", "bus": "foley" }
  },
  "contactLoops": {
    "fields": ["drive/contacts"],
    "attack": 0.035,
    "crossfade": 0.12,
    "release": 0.16,
    "response": 0.04,
    "interactions": {
      "roll": {
        "cue": "wheel-boards",
        "materials": { "shop/stone": "wheel-stone" },
        "speedForFullRate": 3,
        "loadForFullGain": 60,
        "rate": [0.55, 1.65]
      }
    }
  }
}
```

Configure any of `drag`, `roll`, and `scrape`. Speed moves the playback
rate through the authored range and preserves the loop's playhead. The
cue's pitch multiplies that rate. Gain is the square root of normalized
speed times normalized load, with each input capped at its reference.
A stationary contact stays registered at zero gain. Omitted speed starts
at zero. Omitted load uses the full-gain reference. Envelope times are
in seconds. `response` smooths gain changes. A material change uses
the crossfade time if it selects a different cue.

Choose how to feed the planner:

- Set `fields` to native material-contact probes such as `drive/contacts`
  or `feedback/contacts`. Ink groups successive readings by field, producer,
  entity, wheel, and interaction, or by a stable `contactId` from a custom
  field. A missing reading releases the contact. Use
  `contactEvents: "material"` for mechanics to include speed and load.
- A live host can pass a complete `contacts` array to `frame()`. Every row
  supplies a stable `id`, an `interaction`, and any measured values. Remove a
  row to release its voice.
- For a recording, send committed `contact-start`, `contact-update`, and
  `contact-end` events with a nested `contact` record. Keep the same contact
  ID from start to end. An update can supply only the changed values and an
  end needs only the ID.

```json
[
  { "kind": "contact-start", "contact": { "id": "crate-left", "interaction": "drag", "material": "shop/boards", "speed": 0.7, "load": 24, "point": [-1, 0, -2] } },
  { "kind": "contact-update", "contact": { "id": "crate-left", "speed": 2.1, "material": "shop/stone" } },
  { "kind": "contact-end", "contact": { "id": "crate-left" } }
]
```

A reading can use `at`, `point`, or an entity ID for positioning. If it
omits the material, Ink checks the configured `surface` at that position.
A sustained contact is independent of any one-shot impact or footstep
bindings. Its loop appears in `frame.active`. `frame.contactChanges`
lists the time and voice for envelope and rate changes, with `ended`
marking a completed fade. Keep a playback state per live session. To
reconstruct a contact across a seek, replay its events from the run
origin or give the host a current contact snapshot.

`ink-studio story audio` prints sustained voices into `spatial.wav`, or
the `foley` bus by default when soundtrack post is enabled. Its report
includes the contact ID, source cue, and sample range for each material
loop. [Run the continuous contact demo](../examples/continuous-contact-sounds/demo.cjs)

## Layer compound impacts

Use `impactLayers` inside a cue binding to split an impact into a
`strike`, `surface`, `rattle`, and `tail`. Include the layers that make
sense for the object. The binding can listen for an authored event or
native `material-sound` events with `interaction: "impact"`.

```json
{
  "cues": {
    "tool-hit": "tool-hit",
    "boards": "boards-thump",
    "stone": "stone-crack",
    "hardware": "loose-hardware",
    "ring": "toolbox-ring"
  },
  "materials": {
    "shop/boards": { "impact": "boards" },
    "shop/stone": { "impact": "stone" }
  },
  "bindings": {
    "toolbox": {
      "on": {
        "kind": "material-sound",
        "where": { "path": "/interaction", "value": "impact" }
      },
      "impactLayers": {
        "strike": { "cue": "tool-hit", "bus": "foley" },
        "surface": {
          "interaction": "impact",
          "threshold": { "measure": "speed", "min": 1.2 },
          "delay": 0.009,
          "bus": "effects"
        },
        "rattle": {
          "cue": "hardware",
          "threshold": { "measure": "load", "min": 35 },
          "delay": 0.043,
          "gain": 0.7,
          "bus": "foley"
        },
        "tail": {
          "cue": "ring",
          "threshold": { "measure": "strength", "min": 0.7 },
          "speedForFullStrength": 4,
          "delay": 0.027,
          "bus": "ambience"
        }
      }
    }
  }
}
```

Each layer can use a named `cue`, look up a material cue with
`interaction: "impact"`, or use `select` for context rules, velocity
layers, and rotating takes. The binding's `at` and `gain` apply across
its layers. A layer can override the position and add its own gain
multiplier. Use a prop-specific rule for sounds such as loose tools
inside a box.

A threshold uses an inclusive minimum. Ink reads `speed`, `load`, or
normalized `strength` from the event or its contact record. Load can come
from force projected onto the contact normal. For strength, Ink uses an
explicit value in `[0, 1]` first, then load or speed normalized by the
layer's `loadForFullStrength` or `speedForFullStrength`. Missing
measurements leave their gated layer silent. When a compound binding
matches, its layers replace the event's automatic cue.

Each layer's `bus` can override the cue's bus. The default is `effects`.
Enable `post` on the scene soundtrack to print the separate buses. A live Web Audio host can pass
`destinations: {foley, effects, ambience}` to the spatial player, where
each entry is an AudioNode on the player's context. Unmapped buses use
the player's `destination`. Layer `delay` is measured in seconds from
the live dispatch or the recorded event onset. Acoustic propagation
delay is added independently.

Story audio reports preserve the impact's beat ID and show each
sounding layer's threshold reading, scheduled sample, arrival sample,
and stem. A rotating or detuned layer has its own sound-choice receipt
under `impact:<binding>/<layer>`. [Run the compound-impact demo](../examples/compound-impact-sounds/demo.cjs)

## Color the same source by context

Use `processing` to give a cue the tone of an object, enclosure, or
medium. The cue keeps the same source asset. A profile can trim level,
roll off low or high frequencies, and add up to two resonant peaks or
cuts. Frequencies are in Hz, `gainDb` is in dB, and a larger peak `q`
makes the band narrower.

```json
{
  "cues": { "call": { "asset": "radio-call", "bus": "dialogue" } },
  "processing": {
    "path": "acoustics/path",
    "profiles": {
      "pipe": {
        "highpass": 370,
        "lowpass": 2600,
        "peaks": [{ "hz": 695, "q": 4.8, "gainDb": 13 }]
      },
      "hatch": {
        "lowpass": 800,
        "peaks": [{ "hz": 380, "q": 3, "gainDb": 5 }]
      },
      "water": { "lowpass": 390, "gainDb": 1 }
    },
    "rules": [
      { "id": "submerged", "when": { "medium": "water", "minMeters": 1.2 }, "profile": "water" },
      { "id": "closed-hatch", "when": { "opening": "hatch", "maxOpen": 0.08 }, "profile": "hatch" },
      { "id": "steel-pipe", "when": { "object": "steel-pipe" }, "profile": "pipe" }
    ]
  }
}
```

Rules run in authored order. The first match adds its profile to any
base `audioProfile` on the cue. An event can choose its own registered
`audioProfile` as the base. Combined profiles add their gains and peaks
and use the narrower passband. A cue with neither a base nor a matching
rule plays without contextual filters.

A rule can match `cue`, source `entity`, or `object`. An event can name
its object, and a positioned source's entity ID is the default object.
Set `path` to an acoustic path trace to match a traversed `room`,
`opening`, or `medium`. `maxOpen` tests an opening fraction from 0 to 1.
`minMeters` measures the total distance in the requested medium. You can
combine selectors in one rule. Existing occlusion and propagation-delay
settings still control acoustic transmission independently.

Active loops and clips update their filters as the world changes, and
one-shots use the context at dispatch. In scene exports, a cue with
`follow: true` samples the context along its attachment. Story audio
reports show the resolved profiles and matching rule per cue, and
filtered trims restore the source's filter history.

The demo script takes an output directory and a dry WAV. It creates
four listening passes from the same source.
[Run the contextual audio demo](../examples/contextual-sound-processing/demo.cjs) · [Acoustic queries](acoustic-queries.md)

## Play shared world sounds

A committed `world-sound` names a cue, a fixed world position, a source
level, a frequency band, and a duration. The same event feeds
[perception](faction-perception.md#share-a-sound-between-playback-and-hearing)
and the mixer. A cue's asset, bus, distance, and processing settings
apply. Set `soundReferenceDb` in the spatial settings to choose the
source level that maps to unity playback gain before cue and path gain.
The default is 70 dB. The event's band selects the acoustic route and
its nominal transmission. The asset supplies the actual waveform.

Duration caps the cue's playback window. A shorter asset plays once to
its natural end. Keep an asset long enough to fill its window when
playback must cover the full hearing interval. The story audio report
includes the source beat, world sound data, and the sample range for
played cues. Additional acoustic delay uses the existing
`propagationDelay` option.
