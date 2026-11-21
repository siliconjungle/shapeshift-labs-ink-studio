# Seasonal and wear histories

Turn on `weatherBinding.surface.history` to add persistent finish signals to the retained surface grid. A stair and a sheltered wall can use the same stone and finish. Give the stair repeated wetting, exposed wind, and localized traffic. Give the wall shelter and a place for pigment to settle.

| Finish channel | What the grid retains |
| --- | --- |
| `wetCycles` | Completed wet–dry cycles per cell. The upper moisture threshold arms a cycle and the lower one completes it. The stored moisture includes the wet film, standing water, and frost, so a freeze by itself keeps the cycle armed. |
| `windExposure` | Normalized wind integrated over seconds and reduced by local shelter. |
| `abrasion` | Local abrasion rate integrated over seconds. Drive it with traffic, moving machinery, or an authored exposure field. |
| `pigment` | Retained pigment load. Deposition adds to it. Rain, wind, and rubbing can remove it. |

Use any of these channels in a `{ type: 'weather', channel, low, high }` finish mask or a named [finish signal](surface-materials.md#drive-finish-properties). The grid samples world XZ, with interpolation between cells. Use existing finish masks to confine a response to particular faces, regions, or details. Color, roughness, reflectance, and layer strength can share one signal.

```js
const limestone = K.surface.material(stone, {
  signals: {
    traffic: { type: 'weather', channel: 'abrasion', range: [0.3, 3] }
  },
  layers: {
    ochre: { type: 'tint', stage: 'material', color: '#a05a39',
      mask: { type: 'weather', channel: 'pigment', low: 0.06, high: 0.8 } },
    tread: { type: 'specular', color: '#fbd5a0', roughness: 0.65, strength: 0.08,
      drive: {
        roughness: { signal: 'traffic', to: 0.24 },
        strength: { signal: 'traffic', to: 0.5 }
      } }
  }
});
```

## Author a history

```js
const weatherBinding = {
  surface: {
    width: 44, height: 32, cell: 0.21, origin: [-4.62, -3.36], step: 0.1,
    history: { dryThreshold: 0.18, wetThreshold: 0.55, pigmentCapacity: 1,
      wash: 1.2, windLoss: 0.08, abrasionLoss: 0.65 },
    forcing(x, z, time, state, signal) {
      const exposed = exposureAt(x, z);
      return {
        precipitationExposure: exposed,
        shelter: 1 - exposed,
        abrasionRate: (signal.abrasionRate ?? 0) * trafficAt(x, z),
        pigmentRate: (signal.pigmentRate ?? 0) * depositAt(x, z)
      };
    }
  }
};
```

The shown values are the defaults for `history: true`. The thresholds are fractions of wet-film capacity, with `0 ≤ dryThreshold < wetThreshold ≤ 1`. The pigment capacity is a scalar in `[0, 10000]`. Each loss coefficient is in `[0, 1000]`. The solver scales pigment removal by local effective rain, unsheltered normalized wind, and local abrasion, respectively. Set a loss coefficient to zero to detach that process.

Author `surfaceAbrasion` and `surfacePigment` in sky profiles. These supply `abrasionRate` and `pigmentRate` in `[0, 1000]` per solver second and default to zero. Use profile tracks for seasonal timing and [weather fronts](weather-fronts.md) for local profile contributions. Both work in JSON, including stationary regions made from a front with one route key. A JavaScript forcing callback can override either rate, for example to concentrate wear on the center of a stair. Both rates also work in the forcing callback for `K.procedural.motion.surfaceWeather` directly.

The grid replays the authored clock on seek and includes the history and its wet-phase latch in checkpoints. Restore with the same grid settings. For a pre-aged surface, the solver's `initial` callback can seed the four public channels. Old scenes retain their usual wetness, snow, frost, and standing water without enabling the history.

## Review at export size

The [Salt Stair scene](../examples/material-histories.js) plays compressed rain, freeze, thaw, and drying through one fixture. It uses the same limestone finish on the stair and the wall. The headless renderer samples the retained grid. Read it at a world location with `environment inspect` under `weather.surface`.

```sh
ink-studio sheet examples/material-histories.js --t 0,1.6,8,16 --w 416 --h 248 --px 1 --raw --out salt-stair.png
ink-studio environment inspect examples/material-histories.js --t 16 --at '-1.85,.5,1.2' --out stair.json
ink-studio environment inspect examples/material-histories.js --t 16 --at '2.27,1,-.85' --out wall.json
```

To compare one moment under the same weather and light, put `{"surface":{"history":false}}` in an override file and pass it with `--weather-binding file.json`.
