# Reusable environment packs

An environment preset is a named asset in Ink Studio’s existing version 1 asset-pack format. It can carry sky profiles, their sequences and tracks, weather fronts, cloud recipes, celestial tracks, atmosphere layers, wind, and related art controls. Each of those settings uses the same data format as the corresponding render primitive.

The [Tideline pack](../examples/coastal-environment-pack.json) supplies a sky clock, a moving coastal squall, and a horizon band with shared artwork. The jetty changes the dawn horizon colour. The beacon raises aerial extinction and cools its dusk horizon. Both use revision 1 of the same pack.

```sh
ink-studio render examples/coastal-pack-jetty.json --asset-pack examples/coastal-environment-pack.json --t 0 --w 224 --h 140 --px 1 --raw --out jetty.png
ink-studio render examples/coastal-pack-beacon.json --asset-pack examples/coastal-environment-pack.json --t 6 --w 224 --h 140 --px 1 --raw --out beacon.png
```

## Bind a preset

Set `environmentPreset` at the top of a diorama or in a simulation’s `visual` block. Load the package through the scene’s `assetPacks` array or the CLI’s existing `--asset-pack` option. JavaScript scenes can pass `assetPacks` and `environmentPreset` to `builder.finish()`.

```json
{
  "environmentPreset": {
    "asset": "tideline/coast",
    "revision": 1,
    "overrides": {
      "skyEnvironment": { "profiles": { "dusk": { "horizon": "#8aa2b1" } } },
      "aerialPerspective": { "density": 0.056 }
    }
  }
}
```

Objects in `overrides` merge by key. Arrays replace the corresponding list. Use an empty list to clear a track or a set of layers, or use `false` for a primitive that supports being switched off. Explicit `finish` or `visual` settings take precedence by setting, including individual fields inside `look`. Render flags can still override the resolved settings. Native scene geometry, sockets, and precipitation sources continue to use their existing authoring tools.

A string binding such as `"tideline/coast"` follows the installed revision. Include `revision` to pin the binding. Ink reports a missing asset or revision mismatch before building a scene. Saved simulation checkpoints keep the original pack data and binding.

## Package artwork and revise a pack

Put named presets in the manifest’s `environments` array. Each entry has `id`, `label`, and `settings`. A pack can supply environment presets, artwork, and the existing families, looks, and materials together.

A horizon band can set `image` to `{ "asset": "tideline/headland" }`. The owning pack’s `environmentImages` array supplies the namespaced `id`, `width`, `height`, and top-down straight RGBA `pixels`. In Node, `ink.readEnvironmentImage("tideline/headland", "ridge.png")` prepares a PNG for embedding. The image bytes travel with the pack. Use an optional `revision` on an image reference to pin the owning pack, especially for artwork shared from another pack. An image in the same pack can follow that pack’s revision with its preset.

- `KIT.authoring.assetPacks.bundle(packs, ids)` includes packs that own referenced images, following dependencies across the bundle.
- `KIT.authoring.assetPacks.merge(installed, incoming)` preserves the existing same-revision conflict and downgrade rules.
- `KIT.authoring.assetPacks.reviseEnvironment(pack, id, { label, settings })` keeps the preset ID and increments the pack revision when content changes. Pass the complete settings when revising a definition. Scene overrides remain on the scene.
- `KIT.authoring.environments.bind(binding, catalog)` returns immutable resolved settings, the installed pack revision, and the referenced image revisions. Use these settings directly with Ink’s sky, weather, or render APIs. Built scenes expose the resolved identities as `environmentSource`.

Environment `settings.look` can carry horizon bands, effect palettes, art direction, stable dithering, and silhouette protection. Use portable JSON settings and literal swatch colours for presets meant to travel across scene palettes.

## Named aesthetics

Add `aesthetic` metadata to an environment preset to make it discoverable
by art direction. Give it a short `description` and lowercase `tags` such as
`calm`, `mist`, or `suspense`. Keep synonyms that you want people to find in
the tags. Ink searches the asset ID, display label, and tags. A query with
several words requires every word to match.

```json
{
  "id": "millrace/river-hush",
  "label": "River Hush",
  "aesthetic": {
    "description": "Quiet blue-green water, pale stone and warm lamps held in soft river mist.",
    "tags": ["calm", "quiet", "contemplative", "mist", "dusk"]
  },
  "settings": {
    "look": {"artDirection": {"atmosphereBands": 0, "cadence": {"scene": 0, "environment": 0}}}
  }
}
```

`KIT.authoring.environments.findAesthetics(catalog, query)` lists semantic
matches in the installed asset packs. Bind one by its asset ID and optional
revision through the usual `environmentPreset`. The resolved metadata is
also available in `world.environmentSource` and the environment inspector.

```sh
ink-studio environment aesthetics examples/millrace-aesthetics.json calm
ink-studio render examples/raster-millrace.js --params '{"aesthetic":"millrace/river-hush"}' \
  --w 260 --h 168 --px 1 --t 1.25 --out river-hush.png
```

[Millrace aesthetics](../examples/millrace-aesthetics.json) authors three
looks for the same shot. Each specifies role swatches, sky, lighting,
mist, ink, glow, edge treatment, and motion cadence. Use the existing scene
overrides to adjust a look locally, or revise the asset to share the edits.

## Complete looks

An environment preset can also carry a complete look for the Node renderer and CLI. Package [scene color curves](pixel-look.md#color-ramps-and-channel-curves), [selective ink](art-passes.md), [shadow ramps](live-sun.md), [contact shadows](contact-shadows.md), and [edge filters](art-passes.md) as `settings.look.colorCurves`, `ink`, `shadowArt`, `contactShadows`, and `edgeFilter`. Use `settings.liveSun` for light direction and shadow softness, `settings.atmosphere` and `aerialPerspective` for fog, and [`settings.look.artDirection.cadence`](art-direction.md) to hold scene and environment motion at different rates. The camera still samples at the output frame time.

Use `settings.look.paletteRemap` and `colorStack` for [scene colour and
grading](pixel-look.md#named-color-stacks), and `settings.look.effects` for
native-pixel effects such as glow. A remap that targets named palette stops
expects those roles on the receiving scene.

Use `settings.look.surfaceLightRamps` to replace the light ramp on an existing diffuse or highlight layer. Keys first name the surface finish's `id`, then the layer's name. The profile leaves each layer's strength, masks, and other settings in place. Authors can reuse the same names across scenes or omit them on surfaces that should keep their own ramps. Use explicit hex or RGB stops to make the colors independent of each scene's palette.

```json
{
  "surfaceLightRamps": {
    "stone": {
      "daylight": {
        "interpolation": "step",
        "stops": [[0, "#262439"], [0.32, "#534154"], [0.57, "#96736b"], [0.82, "#d0a880"]]
      }
    }
  }
}
```

The [Copperwind pack](../examples/copperwind-looks.json) contains painterly pixel art, hard-edged storybook, and soft atmospheric presets for the same [animated windmill scene](../examples/copperwind-crossing.json). Swap the binding with `--environment-preset` when rendering a JSON diorama. Use `off` to bypass the authored binding. Leave the option unset to use a revision-pinned binding and its scene overrides. A renderer host can bypass just the ramp overrides with `render(world, { surfaceLightRamps: false })`.

```sh
for style in painterly storybook atmospheric; do
  node cli/ink-studio.js render examples/copperwind-crossing.json \
    --asset-pack examples/copperwind-looks.json --environment-preset "copperwind/$style" \
    --w 340 --h 184 --px 1 --t 1 --out "$style.png"
done
```
