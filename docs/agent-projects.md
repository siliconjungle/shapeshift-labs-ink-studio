# Agent-driven project authoring

Use one [portable project bundle](project-bundles.md) as the working file
for a JSON diorama, layered pixel artwork, animation keys, and timed
sound cues. An agent can inspect a revision, sample or pick a frame,
preview a batch of edits, and save a new revision from the CLI. The
commands return JSON and can write native-resolution PNGs for review.

## Try the Relay project

Run the example from the repository root.

```sh
node examples/agent-project/demo.cjs /tmp/ink-relay
```

The [script](../examples/agent-project/demo.cjs) follows a picked image
pixel to its source cel, cleans up seven indexed pixels, changes the
pedestal material, keys the camera, and moves the relay click. It previews
all four changes together, saves and reopens the bundle, then exports the
picture and aligned WAV. The output folder includes the edit, the initial
and revised bundles, previews, and the JSON reports from each step.

```sh
cd /tmp/ink-relay
ink-studio project author inspect relay-initial.ink.json
ink-studio project author sample relay-initial.ink.json --at 1.25 --w 240 --h 136 --pick 94,62 --out frame.png
ink-studio project author pixel relay-initial.ink.json relay-art --at 13,22
ink-studio project author preview relay-initial.ink.json relay-edit.json --at 1.25 --image candidate.png
ink-studio project author apply relay-initial.ink.json relay-edit.json --out another-revision.ink.json
ink-studio export-scene another-revision.ink.json --formats still,loop,replay --out review
```

`inspect` lists solid edit addresses, native pixel document revisions and
frame IDs, the authored timeline, and soundtrack assets. `sample` takes
seconds on the scene timeline. `--pick` uses top-left image coordinates
on the native art grid and reports the visible opaque surface, or
`hit: null` for a miss. For a managed pixel stamp it also reports the
asset ID and its source coordinate when available. `pixel` inspects the
composite and contributing layers at a source coordinate. Use `--frame`
or `--layer` to query a specific frame or sample a single layer.

## Pack a project

Pass a named attachment map to `project pack --attachments attachments.json`.
Give the mapping an `ink-authoring` entry that points to the authoring
manifest. Every `source` and `soundtrack` value in the manifest is the
ID of another attachment.

```json
{
  "format": "ink-studio/project-authoring",
  "version": 1,
  "pixels": {
    "relay-art": {
      "source": "relay-pixels",
      "placement": { "at": [0, 0.43, 0.18], "unitsPerPixel": 0.043, "keepSwatches": true }
    }
  },
  "soundtrack": "relay-audio"
}
```

Use a [pixel-art document](pixel-art-authoring.md) for each source and
optionally name a single `frame` to project. The pixel asset ID reserves
the object ID of its generated stamp. Packing and authoring rebuild that
stamp from editable source layers for ordinary Ink rendering. To change
the attachment mapping or placement, edit the source files and pack again.

The optional soundtrack points to a [scene-audio declaration](scene-audio.md).
The bundle carries its referenced local assets. `export-scene` uses the
bundled soundtrack automatically. Pass `--audio` to select a different
soundtrack.

## Compose an edit

Read `base` from `inspect` and put it in a version 1 edit document.

```json
{
  "format": "ink-studio/project-edit",
  "version": 1,
  "base": "<base from inspect>",
  "edits": [
    { "op": "scene.material", "target": "solid:pedestal", "material": "bronze" },
    { "op": "pixels.edit", "asset": "relay-art", "patch": {
      "id": "relay-cleanup", "frame": "artwork",
      "edits": [{ "at": [13, 22], "layer": "freckles", "from": "yellow", "to": "ceramic-light" }]
    } },
    { "op": "timeline.track", "target": "/camera/yaw", "keys": [
      { "time": 0, "value": -0.37 }, { "time": 1.25, "value": 0.37 }, { "time": 2.5, "value": -0.37 }
    ] },
    { "op": "timeline.cue", "id": "relay-click", "values": { "time": 1.25, "gain": 0.9 } }
  ]
}
```

`scene.material` takes a solid key and any material valid for its scene.
`pixels.edit` uses the native pixel-art patch format for an attached,
standalone artwork document. When its `revision` is omitted, Ink uses
the asset's revision at that point in the batch. Keep native frame,
layer, and observed-value guards where the patch requires them.
`timeline.track` sets the whole track for a
[scene timeline target](scene-timeline.md). `timeline.cue` updates the
named root timeline cue or adds one. A new cue needs a time and a cue name
declared in the bundled soundtrack.

Preview validates the ordered edit batch and reports the candidate
revision. Pass `--at` to include a sampled frame report and `--image`
to save its PNG. Apply publishes the same candidate to a new JSON
path only after the full batch succeeds. The base guards the exact
input revision, and a different project already at the output path
causes a conflict. Repeating the same successful apply to the same
path is safe.
