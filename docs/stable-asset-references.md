# Stable presentation asset references

Give reusable assets a namespaced ID and an exact positive revision. Different revisions of an ID can coexist. Keep the prior entry when you publish a new revision so an earlier scene, cue, or show can still select it.

A registry is a version 1 `ink-studio/asset-registry` JSON document. Start with entries that name local files relative to the registry. Add a SHA-256 for each entry with `assets lock`. The command checks existing digests and fills in new ones. An asset can move to a different catalog path without changing its identity when its bytes stay the same.

```json
{
  "format": "ink-studio/asset-registry",
  "version": 1,
  "entries": [
    { "asset": "harbor/watch-camera", "revision": 1, "kind": "rig", "file": "rigs/watch-wide.json" },
    { "asset": "harbor/watch-camera", "revision": 2, "kind": "rig", "file": "rigs/watch-close.json" },
    { "asset": "harbor/pier", "revision": 3, "kind": "scene", "file": "scenes/pier.json" }
  ]
}
```

```sh
ink-studio assets lock draft.json --out assets.json
ink-studio assets validate assets.json
ink-studio assets resolve assets.json harbor/watch-camera 1
ink-studio render @harbor/pier@3 --asset-registry assets.json --out pier.png
```

In a document, add `assetRegistry` with the locked registry path relative to the document. At a supported field, replace its file or inline value with `{"asset":"harbor/watch-camera","revision":2}`. A reference can also provide `sha256` to require that digest even when the registry changes. Missing revisions, wrong kinds, and modified files fail resolution. Existing inline values and file paths still work.

| Kind | File | Supported fields |
| --- | --- | --- |
| `scene` | Named JSON diorama | A scene argument such as `@harbor/pier@3` with `--asset-registry` on `render`, `clip`, and `export-scene`. |
| `rig` | Native camera rig or diorama parts table | Diorama `cameraRig` or `parts`, and simulation world `visual.cameraRig`. |
| `effect` | Native effect recipe array or effect palette JSON | Diorama `effects` or `finish.look.effectPalettes`, and simulation world `visual.look.effectPalettes`. |
| `voice` | Prerecorded WAV | Named soundtrack `assets`, graph WAV assets, or show `audio`. |
| `sound` | WAV | Named soundtrack `assets`, graph WAV assets, or show `audio`. |
| `graph` | Version 1 graph project | Native take `graph`, soundtrack asset `graph`, or show `patch`. |
| `projection` | Array of show surface definitions | Show `projector.surfaces`. Use the same corners, crop, edges, gain, and gamma as inline surfaces. |

A graph project declares a pinned asset in its existing table with `"bell":{"format":"wav","file":{"asset":"harbor/bell","revision":1}}`. A `json` graph asset can also reference a rig, scene, effect, graph, or projection JSON. Graph plans retain the file hash. Show reports list the exact bound graph, audio, and projection revisions in `assetBindings`. [Patch show fields](patch-tooling.md#run-a-patch-as-a-show)

## Pin assets to a story cue

Add an `assets` object to a presentation rule's `cue`. It can bind one reference for each kind. The cue stays on the same committed event and still carries its original timing. Run `story cues` with `--asset-registry` to validate the authored bindings and stamp the resolved digests on the exported cue references. Host consumers can use the references in the sheet to select their native assets.

```json
{
  "kind": "arrival",
  "assets": {
    "voice": { "asset": "harbor/dispatch", "revision": 2 },
    "sound": { "asset": "harbor/bell", "revision": 1 },
    "rig": { "asset": "harbor/watch-camera", "revision": 2 }
  }
}
```

```sh
ink-studio story cues events.json cue-plan.json --asset-registry assets.json --out cue-sheet.json
```

## Carry references with a portable project

`project pack` includes the catalog and the revisions used by a scene or take with their native dependencies. Pack from a root containing those files. A portable scene keeps unmodified pins when saved with `withScene()`. The Node packer, mounted take loaders, and scene readers verify the pins. In browser hosts `KIT.authoring.projectBundles.open()` resolves directly from the embedded files. The optional synchronous `digest(bytes)` callback enables content verification at open time.

`KIT.authoring.assetReferences.compile(document).bind(reference, kind)` lets host code look up the same immutable entry and check its kind and optional explicit digest. The host reads the selected file from its own storage.

```sh
node examples/stable-asset-references/demo.cjs ./studio/out/stable-asset-references
```

The Beacon Station demo renders the wide and close scene revisions, confirms that a portable copy reproduces the close frame, mixes a synthetic radio cue and a bell, and rehearses a show with a pinned projection surface. Its committed event produces a cue sheet with all seven asset kinds.
