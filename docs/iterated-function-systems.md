# Iterated function systems and fractal flames

`KIT.procedural.ifs` runs a seeded chaos game in two or three dimensions.
Read the orbit as a packed point cloud, or deposit the same sequence into
a bounded density grid. The density grid exposes raw hit mass, logarithmic
display density, and structural color independently.

```js
const IFS = KIT.procedural.ifs;
const fern = IFS.preset('barnsley');
const grid = fern.density({
  seed: 29, count: 700000, exposure: .72,
  bounds: { min: [-2.9, -.23], max: [2.95, 10.38] },
  resolution: [252, 384]
});

const cloud = IFS.preset('tetrahedron').points({ seed: 29, count: 35000 });
```

The built-in recipes are `barnsley`, `sierpinski` (triangle), and
`tetrahedron` (Sierpiński tetrahedron). `IFS.presets` contains immutable
recipes you can reuse in `IFS.compile(recipe)`.

## Author a system

```js
const flame = IFS.compile({
  dimension: 3,
  transforms: [
    { matrix: [.56, 0, 0, 0, .56, 0, 0, 0, .56], offset: [.3, .5, -.1],
      weight: 3, color: .2,
      variations: [{ type: 'linear', weight: .55 }, { type: 'swirl', weight: .45 }] },
    { matrix: [.64, 0, 0, 0, .64, 0, 0, 0, .64], offset: [-.42, -.4, .35],
      weight: 2, color: .85,
      variations: [{ type: 'bubble' }] }
  ],
  final: { offset: [0, 1.65, 0] }
});
const volume = flame.density({
  seed: 29, count: 500000, resolution: [64, 72, 64],
  bounds: { min: [-1.4, .25, -1.4], max: [1.4, 3.05, 1.4] }
});

const light = KIT.atmosphere.field({ field: volume, color: '#ff9a6a',
  density: 3.8, step: .043, lit: false, emissive: '#ffbd85', emissiveGain: .7 });
```

Pass `light` in `finish.atmosphere` for the native headless volume
integrator. For a multicolor volume, use `volume.at(x, y, z).color` to
split density across colored fields. For example, a cooler layer can
receive `density * (1 - color)` and a warmer layer `density * color`.
The same normalized density supports scattering and threshold meshes.

Each iteration selects one of 1–64 transforms using its nonnegative
`weight`. At least one must have positive weight. A transform's
`matrix` is flat and row-major, with four entries in 2D or nine in 3D.
It defaults to identity. `offset` defaults to zero. In a flame transform,
the first affine maps the input, the weighted variations are added, and
the optional `post: { matrix, offset }` maps the result. Variation weights
are signed values in [-8, 8] and are used as supplied. A missing
`variations` list uses the affine result. The optional `final` takes the
same geometry controls and transforms the emitted point. The next
iteration still starts at the orbit point.

`color` is a palette coordinate in [0, 1] and defaults to an evenly spaced value by transform index. The orbit starts at .5 and
moves toward the selected transform's color by `colorMix` each step
(default .5), including during warm-up. Structural color therefore
depends on the path of the orbit.

| Variations | Effect |
| --- | --- |
| `linear`, `sinusoidal` | Identity and componentwise sine. |
| `spherical`, `bubble` | Rescale using the full 2D or 3D squared radius. |
| `swirl`, `horseshoe`, `polar` | Warp XY while carrying Z through in 3D. |

A transform can blend up to 16 variations. `IFS.variations` lists their
names. [Draves and Reckase's fractal flame algorithm](https://flam3.com/flame_draves.pdf) · [Draves's Electric Sheep SIGGRAPH talk](https://history.siggraph.org/wp-content/uploads/2022/12/2004-Talks-Draves_The-Electric-Sheep-Distributed-Screen-saver.pdf)

## Sampling and budgets

Both samplers take an integer `seed` (default 1, low 32 bits), `count` (1–2,000,000, default
100,000), `burnIn` (0–4,096, default 32), `start` (defaults to the
origin), and a positive per-coordinate `escape` limit (default 10,000,
up to 10,000,000). When the orbit escapes or becomes nonfinite,
it restarts from `start` and warms up again. An out-of-range final
projection discards the output and the underlying orbit continues.
Total work stays within `count + burnIn` iterations. The result reports
`attempts`, valid `count`, `restarts`, and `discarded`.

- `points()` returns `dimension`, packed `Float32Array` positions and
  structural colors, and a `Uint8Array` of zero-based `branches`.
- `density()` takes explicit same-dimensional XYZ or XY `bounds`. Supply
  a scalar resolution or one entry per axis (1–512 per axis, at most
  2,000,000 bins). The defaults are 256² or 64³. Points outside the
  inclusive bounds are `clipped`. `deposited` counts points assigned
  to bins and `peak` gives the largest hit count in any bin.
- `bin(i, j, k)` returns exact hit `mass`, displayed `density`, and mean
  `color` at a cell. `at(x, y, z)` interpolates between cell centers,
  weighting color by hit mass. Empty regions and out-of-bounds queries
  have zero mass and density and a `null` color. Omit the third argument
  for 2D.
- `sample(x, y, z)` returns only display density. Set `exposure: 0` for
  linear density, or use a positive exposure up to 1,000,000 to map hit mass by
  `log1p(exposure * mass) / log1p(exposure * peak)`. The default is 1.

## Demos

[Iterated Flame Studies](../examples/iterated-flame-studies.js) makes
a Barnsley density print and a Sierpiński point cloud in **Recursion
Cabinet**. **Ion Bloom** ray-marches a nonlinear 3D density grid with color
from the orbit.

```sh
node cli/ink-studio.js render examples/iterated-flame-studies.js --w 1080 --h 622 --out recursion-cabinet.png
node cli/ink-studio.js render examples/iterated-flame-studies.js --params '{"study":"bloom"}' --w 740 --h 688 --volume-scale 1 --out ion-bloom.png
node cli/ink-studio.js clip examples/iterated-flame-studies.js --params '{"study":"bloom"}' --w 516 --h 480 --yaw -.17 --camera-orbit 35 --to 2.4 --fps 10 --out ion-bloom-clip.png
```
