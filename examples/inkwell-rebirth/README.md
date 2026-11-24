# Inkwell Rebirth scene examples

Start with The Garden. Its gold canopy is an editable material on the
procedural tree. The same scene source drives a live WebGL view and a
headless clip with a self-contained replay.

| Scene | Editable source | What to look for |
| --- | --- | --- |
| Hush Wood | [hush-wood.js](hush-wood.js) | Grown trees with carved faces, moss and fireflies. |
| Afterimage Harbor | [afterimage-harbor.js](afterimage-harbor.js) | Flooded streets, animated illuminated signs and the waterbus reveal. |
| VII · The Burning Sand | [burning-sand.js](burning-sand.js) | Falling fire, illuminated footprints and a walking giant. |
| The Frozen Angel | [frozen-angel.js](frozen-angel.js) | Folded wings, drifting snow and the pilgrim-triggered wake. |
| The Garden | [garden.js](garden.js) | A gold canopy, shafts of light, a frog and moving water. |
| The Last Transmission | [last-transmission.js](last-transmission.js) | A copper iris, a flooded court and an animated broadcast cycle. |

## Play the scenes

From the repository root, build the development bundle and serve the checkout.

```sh
node scripts/build.js development
python3 -m http.server 8000
```

Open [The Garden on localhost](http://localhost:8000/examples/inkwell-rebirth/play.html#garden).
Choose a scene, drag the picture to orbit, or scroll to zoom. The Burning
Sand, The Frozen Angel and The Last Transmission also have a controllable
pilgrim. Focus the picture and use W A S D to walk, or hold left Shift to
run. Enable **Follow the pilgrim** to track the character.

Open [the rose canopy variant](http://localhost:8000/examples/inkwell-rebirth/play.html?canopy=rose#garden)
to test one material change. Edit the canopy ramps in [garden.js](garden.js)
to change the material further. Both playback and export read the same
scene code.

## Reproduce the clips

The review script uses stock `export-scene` to generate a still, a PNG
loop, a replay, and an offline playable HTML export for each scene. It also
renders The Garden's rose canopy as a second take.

```sh
node examples/inkwell-rebirth/demo.cjs review/rebirth
node examples/inkwell-rebirth/demo.cjs review/garden garden garden-rose
```

The per-scene `export.json` links to its products and records compatibility
issues for the sampled frames. Open the file listed under `embed` to play
and scrub the exact rendered pictures.

Render the same material edit directly with the CLI.

```sh
node cli/ink-studio.js render examples/inkwell-rebirth/garden.js \
  --params '{"canopy":"rose"}' --t 2.7 --w 192 --h 120 --px 1 --out review/garden-rose.png
```

These examples use the original geometry and animation from Inkwell Rebirth
revision `ad08221ac6962a696daca4588cfa107c7c4bed85`. The Burning Sand's crowd
uses the scene seed so its clip can be reproduced. The capture script
includes overview cameras for the two Inferno scenes. The live player uses
Ink Studio's standard WebGL renderer. Rebirth-specific screen overlays and
audio belong to the original game host. Afterimage Harbor's headless export
includes the scoped color treatment, and the compatibility report identifies
where the standard WebGL player uses a different path.
