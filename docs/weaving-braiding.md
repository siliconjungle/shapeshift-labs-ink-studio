# Weaving and braiding

`KIT.procedural.interlace` builds strands with stable IDs, native curve
paths, and explicit over–under crossings. The paths supply arc-length
coordinates and continuous frames for tube sweeps, flat profiles,
filament details, and moving particles.

## Weave a repeated pattern

```js
const { interlace } = KIT.procedural;
const cloth = interlace.weave({
  warp: 18,
  weft: 12,
  pattern: ['1100', '0110', '0011', '1001'],
  spacing: [.42, .365],
  radius: .063,
  clearance: .022,
  origin: [-3.57, .8, 0],
  u: [1, 0, 0],
  v: [0, 1, 0]
});
for (const { path, radius } of cloth.strands)
  sculpt.tube(path.points, radius, radius, yarnMaterial);
```

- Warp follows V and weft follows U. The axes must be perpendicular
  and are normalized before measuring spacing in world units. The
  cross product U × V defines over. The default axes lay the cloth
  on XZ with +Y on top.
- `warp` and `weft` accept counts or arrays of `{ id, radius }` records.
  The global radius is used for omitted radii. IDs default to
  `warp:0`, `weft:0`, and so on.
- Binary pattern rows repeat along V and their columns repeat
  along U. A one puts the warp over the weft. A zero puts the weft
  over the warp. `spacing` is the pitch for U and V. Optional
  `margin` adds material beyond the outermost crossings on each axis.
- The reserved crossing span keeps the round strand envelopes at
  least `clearance` apart. Quintic ramps link the spans. Use
  `transitionSamples` to set their resolution. Increase pitch if the
  spans need more room.

## Braid around a path

```js
const cable = interlace.braid({
  spine: [[-3, .1, 0], [-1, 1.2, .3], [1, 1.4, .2], [3, .4, 0]],
  strands: [{ id: 'copper', radius: .09 }, { id: 'jade' }, { id: 'plum' }],
  radius: .08,
  word: [1, -2],
  repeats: 3,
  spacing: .41,
  clearance: .035,
  up: [0, 0, 1]
});
```

`spine` accepts a point list or a native `KIT.curve.path`.
A signed integer in `word` exchanges the two adjacent slots starting
at its absolute value, with slots numbered from one. Positive puts the
strand in the first slot over its neighbor along the spine normal.
Negative reverses that crossing. Each strand keeps its ID as it changes
slots. This is the signed adjacent exchange used in braid words.
[Artin's *Theory of Braids*](https://www.maths.ed.ac.uk/~v1ranick/papers/artinbraids.pdf)

The strands follow the spine's transported frame. `spacing` is the
gap between slot centers. `samplesPerCrossing` controls resolution.
The output includes `endOrder`. On a closed spine the word must
return each strand to its original slot, so its path can close under
the same ID and frame. For example, repeat `[1, -2]` three times
on a three-strand loop.

## Use crossing and clearance data

Both builders return immutable `strands` and `crossings`.
Each crossing records `over`, `under`, `overPoint`, `underPoint`,
`separation`, and `gap` between the declared round envelopes
at the crossing. Use `overDistance` and `underDistance` to sample
strand frames through the exact crossing.

Braids check the sampled segment envelopes between distinct
strands, including at different spine stations. Use
`interlace.checkClearance(strands, { clearance, maxChecks })`
to check any paths with IDs and round radii. A failed result
includes the first contact pair and their required separation.
Use the declared radius as a bounding radius for a flattened or
decorated profile.

## Render the studies

[Copper Loom and Braided Span](../examples/interlacing-studies.js)
use the same paths for static sweeps and moving highlights.

```sh
node cli/ink-studio.js clip examples/interlacing-studies.js --w 930 --h 560 --px 2 --to 6.4 --fps 10 --out copper-loom.png
node cli/ink-studio.js clip examples/interlacing-studies.js --params '{"study":"braid"}' --w 930 --h 560 --px 2 --to 6.4 --fps 10 --out braided-span.png
```
