# Portable project bundles

`ink-studio project pack <scene.json> --out <project.json>` collects a JSON diorama and its assets into one versioned file. The project keeps the scene definition, linked prefab revisions and overrides, typed data inputs, palette, and authored look settings. It also records the bundle schema version, project revision, producer package version, and SHA-256 fingerprint of the authoring toolkit source.

Use `--root <directory>` when the scene shares files outside its own directory. Paths are relative to the files that declare them and stay inside the project root. `--revision <number>` sets the starting project revision. `--asset-pack <file>` installs a look or asset pack into the bundled scene. `--paint <file>` embeds a saved paint document into its finish.

The packer follows scene and prefab mesh references, including nested and disabled shape modifiers. It carries OBJ material libraries and their textures, and glTF or GLB companion buffers and images. Typed data files and external prefab libraries remain in the file table. Sprite atlas placements carry the source manifests, PNGs, and decoded maps so both renderers can use them.

Scene and take entries also retain the registries and specific revisions they use. [Stable presentation asset references](stable-asset-references.md)

Use `--attachments <files.json>` to carry host-managed resources such as audio cues, alternate meshes, or layered raster assets. The attachment manifest maps logical IDs to local file paths relative to that manifest. A sprite or layered raster manifest also brings its companion images.

## Opening and editing

- **CLI.** Pass the bundle to ordinary diorama commands, including `validate`, `render`, `export-scene`, and `data-inputs`. Use `ink-studio project inspect <bundle.json>` for the entry path, versions, file inventory, and attachment IDs.
- **Editor.** In Node, use `readProjectBundle(file)` and call `project.editor()`. Edit the scene with the usual [scene editor](scene-editor.md) operations. Pass its snapshot to `project.withScene(editor.snapshot())` and save the returned revision with `writeProjectBundle(project, { out })`.
- **Browser.** Load the JSON and call `KIT.authoring.projectBundles.open(json)` from the toolkit bundle. Pass the result of `project.build()` to the [WebGL renderer](browser-renderer.md), or call `project.editor()` for edits. Opening and building resolve resources from the file table.

`project.scene()` returns editable scene data with typed data sources ready to use. `project.snapshot()` returns the portable file document. Use `project.files()`, `project.readFile(path)`, and `project.attachment(id)` to access retained files. A version 1 bundle opens as a diorama in the CLI, editor, and browser.

## Bundle a whole take

A native [take](take-clock.md) is the entry in a version 2 project bundle.
Declare the parts of the take relative to its JSON file. The world and graph
are optional. A take can include a soundtrack, an asset pack for its world,
a saved resume point, and named review shots.

```json
{
  "format": "ink-studio/take",
  "version": 1,
  "id": "harbour-take",
  "clock": { "fps": 24, "simulationRate": 60, "sampleRate": 48000 },
  "world": "../world/harbour.json",
  "graph": "../graphs/caption.json",
  "audio": "../sound/score.json",
  "assetPack": "../looks/coastal.json",
  "checkpoint": "../checkpoints/intermission.json",
  "shots": { "cover": "../shots/cover.shot.json" }
}
```

Packing follows [external graph groups](headless-authoring.md#reference-a-shared-group)
and graph assets, including nested group references, WAVs, and input recordings.
It verifies group revision and SHA-256 pins and embeds the original files.
The bundled graph continues to use those copies when shared source files change.
Packing also follows soundtrack WAVs and graphs, world data tables, and
the original inputs recorded by each shot recipe. An asset pack retains its
existing schema and revision. The bundle preserves the directory layout so
references and shot input fingerprints survive relocation.

A default take checkpoint can be an inline checkpoint file saved by
`take sample --checkpoint` or a reference to a content-addressed checkpoint
store. Packing verifies the digests and includes the blocks reachable from each
reference. An explicit `take sample --resume` can select a different checkpoint.
`export-scene` renders from the authored world and uses the take's soundtrack
unless `--audio` supplies a replacement.

```sh
ink-studio project pack takes/harbour.json --root . --out harbour-take.json
ink-studio project inspect harbour-take.json
ink-studio take sample harbour-take.json --frame 48
ink-studio graph clip harbour-take.json --output caption --from 0 --to 48 --out captions
ink-studio export-scene harbour-take.json --to 2 --out review
ink-studio shot replay harbour-take.json --shot cover --out cover.png
ink-studio project unpack harbour-take.json --out unpacked
```

`project unpack` writes to a new directory. Move that folder and use its
`takes/harbour.json` with the ordinary take commands to continue editing.
The Node API exposes the same extraction via
`unpackProject('harbour-take.json', { out: 'unpacked' })`.
Portable shots use declarative scenes and local inputs. A project that uses
custom graph operations or a codec adapter can still supply those through its
host. The take commands and shot replay use the Node library and CLI.

## Bundle a simulation experiment

A version 3 project bundle carries a [simulation experiment](simulation-experiment-bundles.md).
Use `project pack` to retain its model, geometry, inputs, references,
checkpoint, and expected results. Use `project verify` to replay the named
checks against the packaged files on the pinned engine.
