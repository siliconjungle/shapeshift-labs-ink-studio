# Competition between growth fronts

`KIT.procedural.growth.competitive(options)` grows materials from seeds on
a masked XZ grid. The first front to reach an open cell claims it.
Only that seed can continue from the cell. The shared faces where
different materials meet form timed seams.

```js
const growth = KIT.procedural.growth.competitive({
  width: 160, height: 96, cell: .05, origin: [-4, -2.4],
  materials: [
    { id: 'copper', speed: 1.1, angle: .4, stretch: 1.6 },
    { id: 'jade', speed: .85, angle: 2.1, drift: .25 }
  ],
  seeds: [
    { at: [-2.5, -.6], material: 'copper' },
    { at: [2, .9], material: 'jade', time: .4 }
  ],
  mask: (x, z) => Math.hypot(x, z) > .35,
  pace: (x, z) => 1 + .2 * Math.sin(4 * x + 6 * z)
});
const growing = growth.frame(2.1);
const arrival = growing.source('arrival');
const joints = growing.seams();
```

## Author the fronts

- `width`, `height`, `cell`, `origin`, and `mask(x,z,index)` use the
  cell-centered motion grid. Supply a scalar or XZ pair for cell spacing.
  The grid supports up to 768 cells on either axis and 220,000 overall.
  `neighbors` selects four cardinal links or eight including diagonals
  (the default). A diagonal requires both intervening cardinal cells to
  be open in the mask. The selected lattice and resolution affect the
  facets of the resulting fronts and seams.
- Each of up to 64 `materials` has a unique string `id`. The baseline
  `speed` defaults to one scene unit per time unit and accepts .0001 to
  1000. `angle` is measured from +X toward +Z in radians. `stretch`
  (1 to 12) increases speed along that axis in both directions. `drift`
  (-.85 to .85) biases the speed toward one end of the axis.
- Each of up to 1,024 `seeds` starts at the center of the open cell
  containing `at`. It names a `material` and an optional launch
  `time` from zero to 1,000,000. Equal arrival times favor the earlier
  seed in the list. A delayed seed skips its launch if its cell is
  already claimed.
- `pace(x,z,index)` optionally returns a substrate speed multiplier
  between .02 and 16. Travel across a link averages the inverse pace
  of its two endpoints. The same substrate applies to every material.

## Sample and render

The constructor solves the complete event sequence once. Request
`frame(time)` in any order, or call `frame()` for the final result at
`endTime`.

| Output | Use |
| --- | --- |
| `frame.data(channel)` | Copies a row-major typed array. `material` and `seed` are zero-based indices in the authored lists. `arrival` is the absolute claim time and `age` is the number of time units since the claim. Unclaimed and masked cells use -1 for indices and Infinity for scalar times. |
| `frame.sample(channel,x,z)` | Looks up the containing cell. Returns `null` outside claimed cells. |
| `frame.source(channel,{ bounds,project,units })` | Adapts a channel to `KIT.fieldViews` for slices and other field consumers. It samples on XZ by default. Pass XYZ world bounds and a projection returning `[x,z]` to map onto another surface. |
| `frame.seams({ by })` | Returns frozen XZ segments with endpoints `a` and `b`, the two neighboring cell indices, material IDs, seed indices, and the time at which both cells have been claimed. Defaults to `by: 'material'`. Choose `'seed'` to include seams between grains of the same material. |
| `growth.mask()`, `growth.center(index)` | Copies the authored mask and returns the XZ location of a cell center. Use with `width`, `height`, and `bounds` for textures or surface placement. |

Color the material IDs through a palette, use age for a moving rim,
and draw the seam segments as weld beads or a crack network. The
[Vein Atlas and Weld Register studies](../examples/competitive-growth-studies.js)
paint both channels and time their highlights using the seams.

```sh
node cli/ink-studio.js clip examples/competitive-growth-studies.js --w 960 --h 600 --px 2 --to 6.4 --fps 10 --out vein-atlas.png
node cli/ink-studio.js clip examples/competitive-growth-studies.js --params '{"study":"weld"}' --w 960 --h 600 --px 2 --to 6.4 --fps 10 --out weld-register.png
```
