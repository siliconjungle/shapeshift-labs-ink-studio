# Effect recipe library

Find a runnable Ink Studio effect by what you want to make, the inputs you have, or the renderer you need. Each recipe contains source artwork, an editable render graph, sample times, and an input change that the preview and export checks can reproduce.

## Find and run a recipe

```sh
node cli/ink-studio.js effect-recipe search "water ripple" --input mask --renderer webgl2,headless
node cli/ink-studio.js effect-recipe search --json
node cli/ink-studio.js catalog --all "cast shadow sprite-map"
node cli/ink-studio.js effect-recipe open tide-reflection --out tide.json
node cli/ink-studio.js effect-recipe render tide.json --sample 1 --out tide.png
node cli/ink-studio.js effect-recipe check tide.json --out tide-check.json
```

Search matches every word across the recipe ID, title, intent, tags, input labels, input kinds, and renderer names. Use `--input` for an exact input ID or kind. The renderer filter requires every comma-separated renderer to be supported. Built-in recipes declare WebGL2 preview and headless PNG export.

| Recipe | Purpose | Editable inputs |
| --- | --- | --- |
| [Beacon halation](../examples/effect-recipes/beacon-halation.json) | Give a small light source a warm halo. | Artwork, halo radius, emitter mask |
| [Detail window](../examples/effect-recipes/detail-window.json) | Enlarge a feature and switch the inset to an alternate image at a cue. | Artwork, crop center, source cues |
| [Lantern relight](../examples/effect-recipes/lantern-relight.json) | Light indexed tiles and sprites with relief and cast shadows. | Sprite maps, key position, light rig |
| [Scanline roll](../examples/effect-recipes/scanline-roll.json) | Shift a readout and change resolution at specific scanlines. | Artwork, middle band offset, register writes |
| [Tide reflection](../examples/effect-recipes/tide-reflection.json) | Mirror lights into water and distort the reflection inside a mask. | Artwork, waterline, ripple distance |

## Edit a recipe

Open a built-in ID to copy the entire JSON file, then edit it directly. The `graph` field is an ordinary [render graph](render-graph.md). Each entry in `inputs` names a graph pass and a path to an editable field on that pass. For example, `wave-height` points to the first element of the ripple pass's `amplitude` array.

Use a separate JSON file such as `{"wave-height": 9}` to set named inputs without modifying the source. Pass it to `effect-recipe render` with `--inputs edits.json`. The zero-based `--sample` selects a time from the recipe. Earlier samples render in order so effects that depend on history can retain their previous frames.

## Check preview and export

`effect-recipe check` runs the full library by default and also accepts a built-in ID or an edited recipe file. It uses Chrome with WebGL2 for preview and compares its final RGBA framebuffer with the decoded headless PNG at each authored sample time. Set `INK_TEST_CHROME` or use `--chrome` to choose the executable.

The check runs the original and an example edit. It reports how many pixels changed because of the edit and the maximum difference between preview and export. It returns a failing exit status when the edit changes too few pixels or the preview exceeds the recipe's per-channel tolerance. The required repository tests also compare stock PNG pixels with saved frame fingerprints.

## Build the offline demo

Bundle the renderer and assemble the standalone HTML after running the browser checks.

```sh
npm exec --yes --package=esbuild@0.25.12 -- esbuild examples/effect-recipes/preview.mjs --bundle --format=esm --minify --outfile=recipe-renderer.mjs
node examples/effect-recipes/build-demo.cjs recipe-renderer.mjs effect-recipes.html
```

The demo lets you search, change a recipe input in the live WebGL preview, compare checked frames against headless PNGs, and download your recipe.
