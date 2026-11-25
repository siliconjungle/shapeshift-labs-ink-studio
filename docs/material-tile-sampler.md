# Map-driven Tile Sampler

`image.tileSampler` uses the same periodic placement and compositor as the [Tile Generator](material-tile-generator.md). It accepts 1–32 signed shape definitions on `stamps` and optional typed images on eight map sockets. All maps sample the original cell anchor after the authored row and column offsets. Sampling happens before jitter, displacement, scale or rotation. Crop and output resolution affect the bake, while the placement record stays in texture space.

## Map sockets

Scalar and vector maps use unitless `data` or `mask` images with values decoded and clamped to 0–1. The two-channel inputs use an RG data image. A disconnected socket supplies its default.

| Map | Channels | Effect |
| --- | --- | --- |
| `selection` | R | Splits 0–1 into equal bins across the ordered stamp list. The endpoint 1 selects the last stamp. With the map disconnected, the selection stream chooses a stamp per cell. |
| `position` | RG | Adds signed U/V displacement in cell fractions. A value of .5 is neutral. `controls.positionAmount` gives the maximum travel on each axis at 0 or 1. |
| `rotation` | R | Adds an angle about the tile's center. A value of .5 is neutral. `controls.rotationAmount` sets the magnitude in degrees at 0 or 1. |
| `scale` | R or RG | Multiplies size after gutters and jitter. R applies equally on both axes. RG controls width and height independently, interpolated over `controls.scaleRange`. |
| `color` | R, RGB, or RGBA | Multiplies palette color in linear sRGB. A scalar is a linear grayscale gain. Typed color is converted to linear sRGB, and its alpha multiplies palette opacity. Linear texture filtering interpolates associated color to avoid transparent-edge fringes. |
| `density` | R | Multiplies the global retention probability. Each cell has a stable draw from the density stream. Lower density removes a subset of the previous cells when other inputs and seeds stay fixed. |
| `visibility` | R | Keeps cells whose map sample is greater than or equal to `controls.visibilityThreshold`. |
| `priority` | R | Higher values paint above lower values. At equal priority, the higher row-major tile ID paints above. Priority changes affect overlaps, while placement and seeds stay stable. |

Each input uses its typed image addressing and sampling settings. Set `controls.mapFilter` to `nearest` or `linear` to override filtering across all inputs. Wrapped tile axes sample the canonical anchor once before rasterizing its copies. The options follow the source-map workflows described for Adobe's Tile Sampler. [Adobe Tile Sampler reference](https://experienceleague.adobe.com/en/docs/substance-3d-designer/using/substance-graphs/nodes-reference-for-substance-graphs/node-library/texture-generators/patterns/tile-sampler)

## Seeds and controls

The existing `options` record still sets the layout, baseline stamp size and angle, palette, gutters, jitter, crop and root seed. The sampler's `controls` record defaults to:

```json
{
  "positionAmount": [1, 1],
  "rotationAmount": 180,
  "scaleRange": [0.25, 1.75],
  "density": 1,
  "visibilityThreshold": 0.5,
  "mapFilter": "image",
  "seeds": {}
}
```

Use signed safe integers in `controls.seeds` to override `selection`, `position`, `rotation`, `scale`, `color`, and `density` separately. Unspecified streams use the layout seed with independent hashed draws derived from the stable tile ID and channel. A position override changes position jitter. A color override changes palette draws and color jitter. A selection map takes precedence over a selection draw. Visibility and priority are deterministic map controls.

The aligned outputs are `value`, `coverage`, `tileId`, `course`, and `stampId`. IDs are one-based, and zero means background. `layout` includes each kept stamp's anchor, transformed placement, selected stamp ID and priority. It also reports rejection counts and the resolved seeds.

The direct API is `KIT.procedural.graphImages.tileSampler(width, height, columns, rows, stamps, maps, options, controls, seed)`. Omit a map or pass `null` to disconnect it.

## Current Inlay demo

```sh
node examples/material-tile-sampler/demo.cjs /tmp/ink-current-inlay
ink-studio graph run /tmp/ink-current-inlay/current-inlay.material.json --out /tmp/ink-inlay-replay
```

Open `index.html` and toggle the map inputs to inspect how they shape the inlay. Reroll the density seed to change which tiles appear, while the surviving tiles keep their shape, transform and color. Switch to Stamp IDs or Priority to inspect the labels and overlap order.
