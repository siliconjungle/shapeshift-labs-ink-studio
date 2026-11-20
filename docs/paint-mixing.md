# Paint mixing

`KIT.paint` mixes opaque paints by their spectral absorption and scattering, rather than interpolating display RGB. It provides weighted mixtures, reusable swatch books, tint/shade controls, gradients, and baked ramps or mixture lookup tables. Its implementation has no external runtime dependencies, downloaded datasets or imported mixer. All observer weights are generated locally using analytic functions; the existing color math handles display gamut mapping.

Try the [Pigment atelier](../examples/paint-mixing.html). It compares a blue/yellow pigment gradient with display-RGB interpolation and recolors the same SDF/splat garden using baked shades. Mix three paints, tint or shade them, save reusable swatches, click a baked mixture map, and export your paints.

## Mix paints

```js
const P = KIT.paint;
const blue = P.preset('blue');
const yellow = P.preset('yellow');
const leaf = P.mix([
  { paint: blue, weight: 2 },
  { paint: yellow, weight: 3 }
]);
const paleLeaf = P.tint(leaf, .3);
const darkLeaf = P.shade(leaf, .2);
```

Weights are finite nonnegative relative amounts. Their absolute scale does not matter; at least one must be positive. Up to 64 components may contribute. An array of paints without weighted records gives each paint equal weight. Nested mixtures retain absorption/scattering coefficients, so quantities compose correctly: mix `A:1, B:2` into `AB`, then mix `AB:3, C:4` to obtain the same result as `A:1, B:2, C:4`. Amounts describe a common concentration basis; the library does not infer tube densities or convert mass to volume.

A compiled paint is immutable and contains `name`, normalized sRGB `rgb`, packed RGB `hex`, and 36-element `reflectance`, `absorption` and `scattering` arrays. `KIT.paint.wavelengths` gives their wavelengths: 380–730 nm at 10 nm intervals. `snapshot()` exports solved absorption/scattering data that `swatch()` can restore without fitting RGB again. All paints share this grid and reference observer.

`tint(paint, amount, white?)` and `shade(paint, amount, black?)` mix with separate white/black paints. Amount is 0–1, with exact constituent endpoints. Defaults use the synthetic white and black presets. Supply your own swatches to control their optical behavior. Tinting does not desaturate by averaging RGB channels.

## Define a swatch

```js
const cobaltStyle = P.swatch({ name: 'Cool blue', color: '#2d55a6', strength: 1.4 });
const uniform = P.swatch({ name: 'Neutral sample', reflectance: .4, scattering: 1 });
const measured = P.swatch({
  name: 'Custom spectrum',
  wavelengths: [380, 500, 600, 730],
  absorption: [.8, .2, 1.4, 2.2],
  scattering: [1, .9, .8, .7]
});
```

A swatch has exactly one color source:

| Source | Definition |
| --- | --- |
| RGB estimate | `color` accepts a six-digit hex string, packed RGB integer or normalized sRGB triple. A color alone is shorthand for this source. |
| Reflectance | `reflectance` is a scalar or spectrum with values 0–1. Optional `scattering` defaults to one. The library derives absorption from reflectance and scattering. |
| Optical coefficients | `absorption` is a nonnegative scalar or spectrum. `scattering` defaults to one and may also be a nonnegative scalar or spectrum. Each wavelength needs positive total extinction. Zero scattering with positive absorption represents a fully absorbing band. |

Spectra and weights accept ordinary or typed numeric arrays. Without `wavelengths`, spectra need 36 values on the native grid. Custom wavelength arrays contain 2–512 strictly increasing values and must cover 380–730 nm. Spectra are resampled linearly. A scalar remains constant at every wavelength. Derived absorption uses a small positive reflectance floor (`1e-6`) to keep coefficients finite.

Optional `strength` scales absorption and scattering together. It changes how strongly a paint contributes to a mixture while preserving the pure paint's color. It defaults to one and accepts positive values up to `1e6`. `scattering` is distinct from strength: it helps define the paint's optical coefficients. Reflectance alone cannot determine both absorption and scattering uniquely.

`preset(name, overrides?)` provides synthetic starting paints. `presets` lists their IDs: `blue`, `yellow`, `red`, `magenta`, `cyan`, `green`, `ochre`, `white`, `black`. Overrides accept `name`, `strength` and `scattering`. They are illustrative digital paints, not measured products. White uses high scattering and black uses strong absorption relative to its scattering.

### RGB estimates and diagnostics

RGB does not uniquely identify a paint spectrum. For RGB swatches, a bounded, smooth reflectance fit approximates the requested linear sRGB under the reference observer. Fitting is cached for up to 256 RGB colors. Compiling a swatch once avoids fitting it again during mixing. Some extreme display colors cannot be reproduced exactly by the chosen reflectance model.

`diagnostics` records `source`, the observer ID, and whether display gamut mapping occurred. RGB estimates also expose `requestedRGB` and `maxRGBError`. The compiled paint's `rgb` is the color represented by its solved spectrum; mixtures and gradient endpoints consistently use that represented color. Use supplied reflectance or absorption/scattering data for control over spectral behavior.

## Reusable swatch books

```js
const paints = P.book({
  blue: { preset: 'blue' },
  yellow: { preset: 'yellow' },
  green: { mix: [{ paint: 'blue', weight: 2 }, { paint: 'yellow', weight: 3 }] },
  pale: { mix: [{ paint: 'green', weight: 1 }, { paint: { preset: 'white' }, weight: 1 }] }
});
const color = paints.get('pale');
const another = paints.mix([{ paint: 'green', weight: 1 }, { paint: 'blue', weight: 1 }]);
const restored = P.book(JSON.parse(JSON.stringify(paints.snapshot())));
```

Books resolve 1–256 named swatches and reject cyclic recipes or missing references. `names` lists their keys. `get(name)` returns the compiled paint. `mix(entries)` resolves book names or inline paints. Snapshots contain solved coefficients, so exported books are self-contained and preserve the actual mixtures.

## Gradients and baked ramps

```js
const gradient = P.gradient({
  stops: [{ at: 0, paint: blue }, { at: 1, paint: yellow }],
  interpolation: 'linear',
  steps: 17
});
const exactPaint = gradient.sample(.35);
const baked = P.bakeRamp(gradient, { steps: 256 });
const fastRGB = baked.sample(.35);
```

A gradient has 2–64 strictly increasing stops covering 0–1. `linear`, `smooth` or `step` controls concentration progress. Sampling clamps finite coordinates and returns a compiled paint. Exact stop times preserve their exact paints. `rgb` and `hex` contain 2–4,096 preview samples, selected by `steps`. `snapshot()` exports a gradient with solved paints.

`bakeRamp()` evaluates the spectral mixtures once into 2–4,096 RGB entries. Its continuous `sample(t, out?)` performs only interpolation of cached RGB. Baked interpolation approximates the exact pigment trajectory; increase sample count for steep transitions or very strong colorants. `snapshot()` and `restoreRamp()` serialize and restore the table. Optional output buffers need at least three components.

To render baked material shades, use the colors directly in a palette:

```js
const shades = P.bakeRamp(gradient, { steps: 7 });
const B = makeBuilder(37, [0x09171a, ...shades.hex]);
// Material ramp indices: [1, 2, 3, 4, 5, 6, 7].
```

A short baked ramp can also supply a `KIT.palette` role path: `{ path: { colors: shades.rgb }, steps: 7 }`. Role paths use the palette library's perceptual interpolation between supplied colors; rendering uses the resulting baked shade slots. In a live scene, keep a stable `KIT.palette.bind` view and use actual geometry dirty rows as usual. The atelier rebuilds paint shades on edits and renders their cached grade each frame.

## Bake mixture lookup tables

```js
const table = P.bakeTable({ paints: [blue, yellow, P.preset('red'), P.preset('white')], size: 17 });
const rgb = table.sample([2, 3, 1, .5]);
const uvw = table.coordinates([2, 3, 1, .5]);
const volume = table.rgba();
const lut = table.asLUT();
```

Tables accept 2–4 paints and grid sizes 2–33. Two paints produce a 1D table, three a 2D table, and four a 3D table. `data` is normalized RGB with the first axis varying fastest. `size`, `dimensions` and paint `names` describe the grid. `sample(amounts, out?)` normalizes relative amounts and interpolates cached RGB; it does no spectral calculations. Pure paints and zero-paint edges remain on their corresponding grid faces. Other mixtures are approximated between grid samples. Paint ordering affects coordinate layout and approximation error.

Coordinates use successive conditional concentrations. For normalized amounts `[a,b,c,d]`, they are `[a, b/(1-a), c/(1-a-b)]`, with zero for exhausted remainders. This maps the mixture simplex onto a cube, keeping absent-paint boundaries on cube faces. It avoids introducing a third or fourth paint when interpolating an edge mixture. Call `coordinates(amounts)` rather than passing raw amounts as texture coordinates.

`rgba()` returns a fresh byte array plus `{ width, height, depth }`: `N×1×1`, `N×N×1` or `N×N×N`. Upload as an RGBA8 3D texture with linear filtering and clamp-to-edge wrapping. `KIT.paint.glsl` supplies `inkPaintCoordinates(vec4 amounts)` and `inkPaintTable(highp sampler3D image, vec4 amounts)`. Pad absent paints with zeros in the amount vector. The helper samples texel centers and needs no spectral shader code. CPU entry points reject all-zero amounts; the shader clamps negatives and chooses the last paint for all-zero input, so validate author input upstream.

`asLUT()` exports the existing `ink-studio/lut` format with trilinear interpolation. Lower-dimensional tables are expanded along unused axes. **Its inputs are mixture coordinates**, so apply it to a coordinate/weight image or palette, rather than treating ordinary scene RGB as physical paint amounts. `ColorLUT.prepare(lut).sample(table.coordinates(amounts))` agrees with the table's sampler. Native palette grading and render graphs can consume the exported LUT through their existing interfaces.

`snapshot()` and `restoreTable()` serialize the compact dimensional table. Restoring ramps and tables validates their dimensions and finite color data and performs no spectral fitting or mixing.

## Model and limits

The opaque, optically thick Kubelka–Munk model sums concentration-weighted absorption `K` and scattering `S` independently at each wavelength. Reflectance is recovered from their ratio. The inverse uses a rationalized form to avoid cancellation for dark paints. Nested mixtures retain both coefficients.

Observer weights use the analytic CIE 1931 fits from [Wyman, Sloan and Shirley (2013)](https://research.nvidia.com/labs/rtr/publication/wyman2013simple/) and a Planck 6504 K reference white-balanced to D65 tristimulus values. This is an approximate fixed reference, not a measured D65 illuminant spectrum. The 10 nm grid and RGB reconstruction are intended for controllable visual effects. Display conversion uses the existing OKLab chroma-reduction gamut mapping. The model does not simulate film thickness, a substrate, fluorescence or spectral scene lighting. It supplies material colors to the existing SDF/splat renderer. For background on concentration-weighted absorption/scattering, see [Practical Pigment Mixing for Digital Painting](https://scrtwpns.com/mixbox.pdf); the implementation here uses its own spectral fitting and mixing code.

## CLI

```sh
node cli/ink-studio.js paint mix examples/paint-mixture.json --out mixture.json
node cli/ink-studio.js paint swatches examples/paint-mixture.json --out paints.json
node cli/ink-studio.js paint ramp examples/paint-mixture.json --steps 32 --out ramp.json
node cli/ink-studio.js paint table examples/paint-mixture.json --size 17 --out table.json
node cli/ink-studio.js paint table examples/paint-mixture.json --size 17 --lut --out mixture-lut.json
```

The JSON file may contain `swatches` for reusable name resolution. `mix` uses its weighted `mix` array, optional `name`, `tint`, and `shade`, and exports a solved `paint` definition plus color/diagnostic data. `ramp` uses `stops` and optional `interpolation`. `table` uses `paints`, with optional `size` or the CLI size override. `--lut` exports the existing 3D LUT format. `swatches` exports the solved book; it also accepts a bare book definition.
