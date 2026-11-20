# Portable project bundles

`ink-studio project pack <scene.json> --out <project.json>` collects a JSON diorama and its assets into one versioned file. The project keeps the scene definition, linked prefab revisions and overrides, typed data inputs, palette, and authored look settings. It also records the bundle schema version, project revision, producer package version, and SHA-256 fingerprint of the authoring toolkit source.

Use `--root <directory>` when the scene shares files outside its own directory. Paths are relative to the files that declare them and stay inside the project root. `--revision <number>` sets the starting project revision. `--asset-pack <file>` installs a look or asset pack into the bundled scene. `--paint <file>` embeds a saved paint document into its finish.

The packer follows scene and prefab mesh references, including nested and disabled shape modifiers. It carries OBJ material libraries and their textures, and glTF or GLB companion buffers and images. Typed data files and external prefab libraries remain in the file table. Sprite atlas placements carry the source manifests, PNGs, and decoded maps so both renderers can use them.

Use `--attachments <files.json>` to carry host-managed resources such as audio cues, alternate meshes, or layered raster assets. The attachment manifest maps logical IDs to local file paths relative to that manifest. A sprite or layered raster manifest also brings its companion images.

## Opening and editing

- **CLI.** Pass the bundle to ordinary diorama commands, including `validate`, `render`, `export-scene`, and `data-inputs`. Use `ink-studio project inspect <bundle.json>` for the entry path, versions, file inventory, and attachment IDs.
- **Editor.** In Node, use `readProjectBundle(file)` and call `project.editor()`. Edit the scene with the usual [scene editor](scene-editor.md) operations. Pass its snapshot to `project.withScene(editor.snapshot())` and save the returned revision with `writeProjectBundle(project, { out })`.
- **Browser.** Load the JSON and call `KIT.authoring.projectBundles.open(json)` from the toolkit bundle. Pass the result of `project.build()` to the [WebGL renderer](browser-renderer.md), or call `project.editor()` for edits. Opening and building resolve resources from the file table.

`project.scene()` returns editable scene data with typed data sources ready to use. `project.snapshot()` returns the portable file document. Use `project.files()`, `project.readFile(path)`, and `project.attachment(id)` to access retained files. The bundle contains declarative dioramas. JavaScript scene factories, simulation recordings, and the application runtime retain their existing distribution formats.
