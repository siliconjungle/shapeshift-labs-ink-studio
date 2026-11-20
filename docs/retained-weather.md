# Weather that leaves a trace

A [weather-bound](weather-binding.md) surface grid remembers wetness, snow, and frost after the weather changes. Enable `standingWater` on that grid to retain excess rain and meltwater in low areas. Pools keep the underlying stone wet, can freeze in cold conditions, and release their water again when they thaw.

```js
const weatherBinding = {
  surface: {
    width: 40, height: 30, cell: .2, origin: [-4, -3],
    capacity: .28,
    standingWater: {
      capacity: (x, z) => lowStone(x, z) ? .35 : 0,
      drainage: .045,
      evaporation: .5
    },
    forcing(x, z) {
      const exposure = K.procedural.overheadCover.exposure(cover, [x, groundY(x, z), z]);
      return { precipitationExposure: exposure, shelter: 1 - exposure };
    }
  }
};
```

The grid’s `capacity` controls the wet film. The standing-water capacity controls how much extra liquid a cell can hold. Set it to zero at high points, use a number for a uniform surface, or provide a function for sculpted basins. `drainage` is a loss rate per second and `evaporation` scales the atmosphere’s effect on pooled water relative to the wet film. The same configuration works with `K.procedural.motion.surfaceWeather` directly. Each opt-in snapshot exposes a `standingWater` grid and includes that value in `sample(x, z)`.

Use `precipitationExposure` to keep a roofed area dry. Use `shelter` to reduce incident light and snow capture. The active profile’s `daylight`, `airTemperature`, wind, and humidity control warming and drying. Puddles freeze into the retained frost field and snowmelt can refill them. The surface solver also accepts a local light override for cast shadows or a directional clock.

## Put it on a material

Use [surface signals](surface-materials.md#drive-finish-properties) to
give several finish layers the same wet-film response. The tint darkens
the paving's diffuse color. The specular lobe becomes stronger and narrower
as that film builds. A separate signal from the same retained grid reveals
the reflected sky where water collects in the seams.

```js
const paving = K.surface.material(stone, {
  signals: {
    film: { type: 'weather', channel: 'wetness', range: [0.02, 0.25] },
    pools: { type: 'weather', channel: 'standingWater', range: [0.01, 0.095] }
  },
  layers: {
    absorption: {
      type: 'tint', blend: 'multiply', color: [0.55, 0.64, 0.72], strength: 0,
      drive: { strength: { signal: 'film', to: 1 } }
    },
    polish: {
      type: 'specular', color: '#cbdde1', roughness: [0.52, 0.36], strength: 0.14,
      drive: {
        roughness: { signal: 'film', to: [0.12, 0.18] },
        strength: { signal: 'film', to: 0.66 }
      }
    },
    seams: {
      type: 'reflection', source: 'scene', f0: 0.88, strength: 0,
      mask: { type: 'axis', axis: 'y', range: [-0.04, 0.02], invert: true },
      drive: { strength: { signal: 'pools', to: 0.94 } }
    }
  }
});
```

Use the basin capacity to retain water in low areas. The reflection
can live on the seam material itself or use a mask for height or layout.
A `planarReflection` layer with a named plane can reflect scene geometry.

## Individual weather masks

Use weather masks with `wetness`, `standingWater`, `snow`, or `frost`. A puddle can use a stronger reflection finish than the surrounding damp stone. Set increasing `low` and `high` values to map the local depth or amount to a smooth blend.

```js
const paving = K.surface.material(stone, { layers: {
  puddles: { type: 'reflection', source: 'scene', strength: .85, f0: .7,
    mask: { type: 'weather', channel: 'standingWater', low: .02, high: .25 } }
} });
```

Puddles appear as finish layers on the authored surface in the CPU renderer. The grid tracks the local amounts of liquid and frozen water.

## Compare a render

```sh
ink-studio sheet examples/wet-stone-finish.js --t 0,0.4,1.6 --w 272 --h 154 --px 1 --out wet-stone.png
ink-studio sheet examples/weather-traces.js --t 2.95,5.62,7.5,9.85 --raw --out traces.png
ink-studio render examples/weather-traces.js --t 2.95 --raw --retained-weather off --out before.png
```

In [Lantern Court](../examples/wet-stone-finish.js), the same light shows
dry paving, a damp film, and pooled seams after rain stops. In [the terrace example](../examples/weather-traces.js), rain fills the basins, colder air freezes the paving and adds snow, and sunlight thaws the exposed stones first. Set `--retained-weather on|off` or pass the boolean `retainedWeather` to the renderer to compare at the same time. This toggle controls the retained grid, so the profile continues to drive airborne weather. Use a `--weather-binding file.json` override to change the storage controls for a render.
