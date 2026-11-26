# Editable flow maps

Use an Ink flow map to paint direction and speed once and reuse the resulting
velocity field in water, smoke, cloth, and debris. The editor opens locally
and runs the four native solvers against the current map.

[Painting flow](painting-flow.md) uses the same map to advect retained marks with wrap seams, obstructions, and edge loss.

```sh
node cli/ink-studio.js flow-map editor --out split-current.html
node cli/ink-studio.js flow-map editor harbor-flow.json --out harbor-editor.html
```

Drag with **Flow** and **Follow stroke** to paint along the path at the selected
speed. Use **Fixed angle** for a constant heading or a single dab. **Speed
only** adjusts magnitude on moving cells and preserves each direction.
**Erase** moves velocities toward calm. Radius uses chart units, and opacity
blends the new vector with the existing vector. Undo and redo work per stroke.

Choose **Inspect** and click the chart, or enter exact U and V coordinates.
The readout shows the bilinear velocity, its speed and bearing, and the raw
native cell. Angles turn from +U toward +V. The top row starts at minimum V
and rows increase down the chart. Heat and arrow length show relative speed.
Drawing a stroke restarts the previews with the edited field.

**Export JSON** saves one portable asset. Open it again to continue painting
or pass it to a solver. The file records the grid dimensions, real chart
bounds `[minU, minV, maxU, maxV]`, and signed velocity pairs in row-major
order, with U changing fastest. Velocities are in scene units per second.
There is one vector at each cell center. Sampling interpolates components
and holds the edge cells up to the chart boundary. Sampling beyond the
boundary returns `null`.

## Paint and inspect headlessly

```sh
node cli/ink-studio.js flow-map new --size 48,32 --bounds -3,-2,3,2 --out empty.json
node cli/ink-studio.js flow-map paint empty.json stroke.json --out harbor-flow.json
node cli/ink-studio.js flow-map inspect harbor-flow.json --at 0,0
```

`stroke.json` can contain one stroke or a list of strokes. Points and radius
use the same chart coordinates as the editor.

```json
{
  "points": [[-2.5, 0], [-0.8, -0.5], [1.9, 0.3]],
  "radius": 0.45,
  "speed": 2.2,
  "opacity": 0.75,
  "direction": "stroke"
}
```

Use `direction: [u, v]` for a fixed heading, or `mode: "speed"` or
`mode: "erase"` for the other brushes. `hardness` in `[0,1]` sets the
fraction of the brush radius with full opacity. In an overlap within a
stroke, the strongest influence wins and the later segment breaks ties.
`KIT.flowMap.create()`, `KIT.flowMap.open(asset)`, and the editor use the
same brush and sampling code.

## Bind one asset to four solvers

```js
const map = KIT.flowMap.open(asset);
const water = KIT.procedural.motion.shallowWater({
  width: 48, height: 32, origin: [-3, -2], cell: .125, initial: () => .34
});
water.step(1 / 30, { flow: map.planar(), flowDrag: 5 });

const recipe = KIT.procedural.rasterSimulation.define('smoke', {
  width: 48, height: 32, flowMap: asset, flowScale: 6, flowDrag: 6
});
const smoke = KIT.procedural.rasterSimulation.session(recipe);
const puff = smoke.seek(.5);

const cloth = KIT.cloth(builder, { ...clothOptions, wind: map.world() });
const debris = KIT.debris(stage, { wind: map.world({ outside: 'none' }), windDrag: 3 });
```

- **Water** nudges each wet cell's velocity toward the map at
  `flowDrag` per second. It leaves depth and mass updates to the water
  solver and honors its masks and speed limit. A sampler may return
  `null` to leave a cell unforced.
- **Smoke** takes the JSON asset in its portable raster recipe and fits the
  chart over the smoke grid. `flowScale` converts map speeds into smoke
  grid units per second. `flowDrag` sets the coupling strength. Buoyancy,
  pressure, obstacles, and other configured forces still act.
- **Cloth** uses the map as an XYZ wind callback. The chart projects onto
  world XZ by default, and the cloth solver handles face and point drag.
- **Debris** samples at each chunk's center and relaxes its velocity toward
  the field at `windDrag` per second. Outside a map, `outside: 'none'`
  leaves the chunk ballistic. The default world sampler returns calm wind.

`planar({ bounds, scale })` fits the chart to another 2D rectangle and
applies an explicit speed multiplier. `world({ origin, u, v, bounds,
scale })` places it on perpendicular unit axes and lifts the sampled
velocity into XYZ. It projects along the plane normal, so the same map
can affect cloth and chunks at several heights. Placement changes where
the map is sampled. Use `scale` to tune speed separately. Your solvers
still decide how closely the resulting motion follows the painted field.
