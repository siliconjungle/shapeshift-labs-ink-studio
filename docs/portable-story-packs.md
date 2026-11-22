# Portable story packs and run bundles

Use a story pack to publish definitions and their resources. Use a run bundle to exchange a recorded session with editorial, presentation, or simulation tools. Both use the version 4 Ink project bundle file table. Packing preserves relative paths and writes a SHA-256 digest for each retained file.

## Publish definitions

An `ink-studio/story-pack` recipe lists story documents and any reusable templates. The inventory reports required and inferred capabilities, roles, assets, story IDs, and dependencies from the existing story schema. A receiving world supplies the runtime capabilities.

```json
{
  "format": "ink-studio/story-pack",
  "version": 1,
  "id": "lantern-harbor",
  "revision": 2,
  "documents": ["story/harbor-watch.json"],
  "templates": { "watch": "story/watch.template.json" },
  "assetPacks": ["story/canal-kit.json"],
  "assetRegistry": "assets.json",
  "assets": {
    "signal": { "asset": "lantern/signal", "revision": 1 },
    "chime": { "asset": "lantern/chime", "revision": 1 }
  },
  "inputs": { "controls": "inputs/lamp-controls.json" },
  "media": { "poster": "media/signal.png" }
}
```

At least one document or template is required. Native `assetPacks` carry materials, looks, and physical assets for receiving worlds. Presentation `assets` select exact IDs and revisions from a locked registry. Packing retains referenced scene and graph dependencies, including pinned graph audio. `inputs` and `media` are optional named file maps. Paths are relative to the recipe and stay inside the project root.

```sh
ink-studio project pack lantern.pack.json --root . --out lantern.project.json
ink-studio project inspect lantern.project.json
ink-studio project verify lantern.project.json
ink-studio story instantiate lantern.project.json instance.json --template watch
```

To install the pack, add `{"pack":"lantern.project.json","revision":2}` to a world's `storyDocuments`. The loader embeds the definitions and installs the native asset packs. Run `sim preflight` on the receiving world to resolve its capability and asset requirements. You can edit the bundle's authored files by unpacking it into a new directory and publishing a new revision. [Story requirements](story-documents.md#describe-a-story-package-before-running-it) · [Stable asset references](stable-asset-references.md)

## Exchange recorded runs

An `ink-studio/story-run` recipe points to an event recording. It can include an authored story pack recipe, a native run or simulation fixture, and extra inputs and media for this run. Use names distinct from the inherited pack's input and media names.

```json
{
  "format": "ink-studio/story-run",
  "version": 1,
  "id": "lantern-release",
  "pack": "lantern.pack.json",
  "events": "committed.events.json",
  "recording": "native.run.json",
  "inputs": { "choice": "inputs/choose.json" },
  "media": { "audio": "media/review.wav" }
}
```

The event file can be a committed event log or a version 1 story event recording. Keep its coverage declaration. To capture a complete interval from an existing native recording, use a fixture and export its committed envelopes. This also works when the world disables retained event history.

```sh
ink-studio sim fixture native.run.json --from 0 --ticks 4 --out complete.fixture.json
ink-studio story events complete.fixture.json --format envelopes --out committed.events.json
ink-studio project pack lantern.run-bundle.json --out lantern-run.project.json
ink-studio project verify lantern-run.project.json
ink-studio sim replay lantern-run.project.json
ink-studio story events lantern-run.project.json --format timeline --out timeline.json
ink-studio story cues lantern-run.project.json cue-plan.json --out presentation.json
```

The packer follows blocks referenced by a native recording's checkpoint store. Verification checks every retained file and replays the native source, when present, against its declared event coverage. A complete log must match every event in its interval. A retained log checks the events it carries. The verification report identifies the first disagreement. The cue tool can resolve a reference using the bundle's pinned assets.

For a host-produced event log, omit `recording`. The bundle can drive event analysis, timelines, and presentation cues without a simulation implementation. Its verification report records `replay: "none"`. For a restricted presentation, collect the projected audience effects into a committed event log and include the resources for that audience. [World views and intervention permissions](world-access.md)

## Read a bundle from another Ink tool

Use `readProjectBundle(file)` in Node or `KIT.authoring.projectBundles.open(document)` in a bundled toolkit. Node verifies the file digests and dependency closure. A toolkit host can supply a synchronous `digest(bytes)` callback to check bytes at open time.

Call `storyManifest()`, `storyDocuments()`, `storyInventory()`, or `storyTemplates()` to inspect the definitions. `storyResources()` lists the pinned assets, inputs, and media. Read payload bytes with `storyResource(category, name)` and read a run's committed envelopes with `storyEvents()`. Node hosts can use `verifyStoryBundle(file, options)` or `replayStoryBundle(file, options)` with the normal runtime implementation options for their native capabilities.

```sh
node examples/portable-story-packs/demo.cjs ./studio/out/portable-story-packs
```

The Lantern Harbor demo imports a revision 2 story pack into a receiving world, verifies the complete event log against a block-backed replay, and uses an event-only bundle to produce an editing timeline and a cue with its pinned chime.
