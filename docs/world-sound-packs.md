# Portable world-sound packs

A world-sound pack carries cue IDs, context selection rules, material
mappings, and the audio they use in one versioned JSON file. Copy it to a
second project and import the same IDs into that scene's soundtrack.
Each payload carries a SHA-256 digest. Packs preserve the original bytes
of recordings, editable recipes, and audition runs.

## Build and inspect

Author a source document with the existing
[spatial audio settings](spatial-audio.md#select-a-take-from-contact-context).
The files are relative to the source document.

```json
{
  "format": "ink-studio/world-sound-pack-source",
  "version": 1,
  "id": "dock-hardware",
  "revision": 1,
  "assets": {
    "dock/latch-touch": {
      "recipe": "latch-touch.sound.json",
      "recording": "latch-touch.wav",
      "playback": "recipe"
    },
    "dock/iron": { "recording": "iron.wav" }
  },
  "spatial": {
    "cues": {
      "dock/latch-touch": { "asset": "dock/latch-touch", "bus": "foley" },
      "dock/iron": { "asset": "dock/iron", "bus": "foley" }
    },
    "materials": { "dock/iron": { "impact": "dock/iron" } },
    "bindings": {
      "dock/drop": {
        "on": { "kind": "tool-drop" },
        "interaction": "impact",
        "select": [{ "id": "latch", "when": { "object": "latch" }, "family": "dock/latch" }]
      }
    },
    "soundFamilies": {
      "dock/latch": {
        "takes": {
          "soft": { "cue": "dock/latch-touch", "strength": [0, 0.45] },
          "hard": { "cue": "dock/iron", "strength": [0.45, 1] }
        }
      }
    }
  },
  "examples": {
    "workshop": {
      "run": "workshop.run.json",
      "preview": "workshop-mix.wav",
      "label": "Latch on iron",
      "sampleRate": 32000
    }
  }
}
```

```sh
ink-studio music sound pack build dock.source.json --out dock-hardware.json
ink-studio music sound pack inspect dock-hardware.json
ink-studio music sound pack unpack dock-hardware.json --out editable-dock
```

Each asset supplies a versioned `.sound.json` recipe, a mono or stereo WAV,
or both. With both present, the WAV plays by default. Set
`playback: "recipe"` to synthesize from the stored recipe. Add `credit` to
retain attribution alongside a source. Both source fields also accept an
exact `{asset, revision, sha256?}` reference through `assetRegistry`.
The pack keeps the resolved revision and hash and includes the media bytes.
Identical payloads are stored once.

The `spatial` fragment can include `cues`, `materials`, `soundFamilies`,
`bindings`, `contactLoops`, and `processing`. Cue assets used by the pack
must all be included. This makes compound impacts, continuous contacts,
rotation, velocity layers, and cue processing travel with their IDs.
In the receiving scene, set listener, surface fields, occlusion, mix buses,
seed, and voice priorities in the usual places.

Unpack into a new directory to edit the ingredients. The output includes a
buildable source document and any registry pins. Use a new revision when
publishing changed content.

## Use a pack in another scene

Add a pin to the ordinary soundtrack, alongside any local assets, cue
definitions, or spatial settings.

```json
{
  "format": "ink-studio/scene-audio",
  "version": 1,
  "worldSoundPacks": [
    { "file": "sound/dock-hardware.json", "id": "dock-hardware", "revision": 1 }
  ],
  "listener": [0, 0, 0],
  "spatial": { "soundSeed": 391, "distance": { "reference": 1, "max": 30 } }
}
```

Copy the pack SHA-256 from `inspect` into the reference's optional
`sha256` field to pin the complete file. The loader checks pack identity,
revision, and media digests. ID collisions in assets, cues, families,
and bindings fail during loading. A scene can add a different interaction
to a packaged material. A conflicting cue for the same interaction fails.
Each soundtrack has one `contactLoops` table and one `processing` config,
which can come from the scene or one imported pack.

Bindings and cues resolve through the same soundtrack loader used by
`story audio`, `story audition`, and native takes. Story audio reports
identify the pack revisions and hashes used for the render. Put the pack
inside the project root and [pack the take](project-bundles.md#bundle-a-whole-take)
to transfer both together. An ordinary `story audio` render also accepts a
standalone pack as the soundtrack with its default listener and mix.

A programmatic host can call `KIT.world.soundPacks.open(document, {decode,
digest})` with synchronous base64 and SHA-256 functions. Pass the verified
packs to `soundPacks.compose(spatial, packs, localAssetNames)` and use the
resulting spatial configuration with `KIT.world.spatialAudio.create`.
The pack reader returns copies of its payload bytes for the host's audio
resolver. Recipe payloads can be rendered with
`KIT.procedural.mediaGraph.soundRecipe`. WAV bytes can be sent to the host's
usual decoder.

## Replay a packed audition

An example stores an inline native run recording. Optional `from` and `to`
use seconds or a ratio such as `"3/2"`. An example can also specify
`listener`, `sampleRate`, `soundSeed`, and a committed `beat` that must
produce a cue in the window. Optional `preview` adds a reference WAV for
listening alongside the newly rendered mix.

```sh
ink-studio music sound pack audition dock-hardware.json workshop --out audition
node examples/world-sound-packs/demo.cjs ./dock-hardware-demo
```

The Dock Hardware demo carries two editable recipes, a companion print,
two recorded iron strikes, and a native workshop audition. A freight lift
uses the same cue and material IDs alongside its own relay sound. The demo
replays the workshop without its loose inputs and verifies that moving the
lift project preserves its mix and sound choices.
