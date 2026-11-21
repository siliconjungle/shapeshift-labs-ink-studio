# Ink Studio starter recipes

Copy a recipe folder and edit its `graph.json`. Each folder has a version 1
graph and a version 1 take clock. The graphs use stock Ink Studio nodes and
local inputs. Run them with the CLI or load them with `ink.readGraphProject()`.

| Recipe | What to edit | What it makes |
| --- | --- | --- |
| [Relightable sprite](relightable-sprite/graph.json) | Change `copper`, `lightDirection` or the signed shapes that form the beacon. | A transparent lighting preview and an Ink sprite atlas with flat colour, registered normals, and a mounting pivot. The card uses its pivot plane for depth. |
| [Audio-driven sign](audio-driven-sign/graph.json) | Change the short `text` label or replace `beat.wav`. Match the `level` node’s analysis rate to the take’s picture rate if you change it. | A neon sign driven by frame-aligned WAV amplitude, plus the sampled level and source audio. |
| [Weathered tile set](weathered-tiles/graph.json) | Change `textureSeed` or `mossRamp`. Edit the other two ramps in the graph or open the shared [stone group](weathered-tiles/stone.group.json) to change joints and grain. | Dry, mossy, and frosted 64 × 64 tiles, an atlas, and a repeated swatch for checking seams. |
| [Looping spell](looping-spell/graph.json) | Reverse `clockwise`, paint new marks in the `strip` node, or adjust the glow. | Two counter-rotating rune bands and a transparent two-second loop. |
| [Layered vista](layered-vista/graph.json) | Edit `yawOffset`, `distance`, the camera keys, or each band's radius, height, and drawn artwork. | A perspective camera move around a 3D stone lookout, with layered sky, mountains, and woodland. The `horizon` output can be used as a scene horizon profile. |

From the repository root, use `ink-studio` below or substitute
`node cli/ink-studio.js`.

```sh
recipes=examples/starter-recipes
ink-studio graph validate "$recipes/relightable-sprite/graph.json"
ink-studio graph run "$recipes/relightable-sprite/graph.json" \
  --inputs "$recipes/relightable-sprite/right-light.json" --out review/beacon
ink-studio graph run "$recipes/weathered-tiles/graph.json" --out review/tiles
ink-studio graph run "$recipes/audio-driven-sign/graph.json" --at 0.05 --out review/sign
ink-studio graph run "$recipes/layered-vista/graph.json" --at 0.75 --out review/vista
```

For motion, pass the included take clock. The audio clip exports the picture.
Use the sign’s `sound` WAV alongside it when reviewing with sound.

```sh
ink-studio graph clip "$recipes/audio-driven-sign/graph.json" \
  --clock "$recipes/audio-driven-sign/take.json" --output sign \
  --from 0 --to 24 --format apng --out review/sign-loop
ink-studio graph clip "$recipes/looping-spell/graph.json" \
  --clock "$recipes/looping-spell/take.json" --output spell \
  --from 0 --to 32 --format apng --out review/spell-loop
ink-studio graph clip "$recipes/layered-vista/graph.json" \
  --clock "$recipes/layered-vista/take.json" --output vista \
  --from 0 --to 36 --format apng --out review/vista-orbit
```

Keep the schema `version` when editing a recipe. The tile graph pins the
stone group’s `revision`. If you publish a new group revision, update its
reference explicitly. Use the existing project bundler to snapshot a recipe
with a project revision and its local assets.

```sh
ink-studio project pack "$recipes/weathered-tiles/take.json" \
  --root "$recipes/weathered-tiles" --revision 1 --out tiles-r1.json
ink-studio graph run tiles-r1.json --out review/packed-tiles
ink-studio project unpack tiles-r1.json --out editable-tiles
```
