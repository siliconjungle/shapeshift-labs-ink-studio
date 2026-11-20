# Art direction

Ink’s optional art-direction profile groups optical and timing controls for the headless renderer. Choose `painted-pixel` for firmer cloud edges and stepped tones, `storm-silhouette` for hard silhouettes and held motion, or `soft-dawn` for softer edges, lighter shadows, and continuous motion. Mix any of the controls independently.

The [Estuary Watch example](../examples/art-direction-estuary.js) uses the same geometry, authored sky, and camera for all three looks.

```sh
ink-studio render examples/art-direction-estuary.js --art-direction storm-silhouette --t 2 --px 1 --out storm.png
ink-studio clip examples/art-direction-estuary.js --art-direction soft-dawn --from 0 --to 4 --fps 24 --px 1 --out dawn.png
```

Set `look.artDirection` on the world, `finish.look.artDirection` in a diorama, or `visual.look.artDirection` in a simulation world. Use `--art-direction on|off|painted-pixel|storm-silhouette|soft-dawn|file.json` to select a preset, publish a custom profile, or toggle the authored choice. The library accepts the same settings through `render(world, { artDirection })`. The optical controls also work in raw renders.

```json
{
  "preset": "painted-pixel",
  "cloudEdge": 0.85,
  "atmosphereBands": 5,
  "foreground": { "contrast": 1.6, "pivot": 0.57, "near": 8, "far": 24 },
  "cadence": { "scene": 12, "environment": 6 }
}
```

- `cloudEdge` runs from 0 for softer coverage to 1 for a harder edge. Use 0.5 for the authored cloud coverage. It affects sheets, cloud volumes, and cloud impostors, including their sky reflections.
- `atmosphereBands` sets 2–64 evenly spaced levels in the sky gradient and optical fog or aerial-perspective coverage. Use 0 for continuous shading. Celestial disks, cloud coverage, and water absorption retain their own controls.
- `foreground` adjusts the contrast of visible nearby surfaces around the `pivot` luminance. A contrast above 1 darkens shadows and brightens highlights. A contrast below 1 compresses that range. The adjustment is full through `near` world units of camera depth and fades to zero at `far`. Emissive details retain their colors. Use `foreground: false` to bypass the preset’s contrast.
- `cadence.scene` and `cadence.environment` hold the respective animation clocks at the given frames per second. Use 0 for a continuous clock. The environment clock follows sky profiles and their associated effects. The view still samples the authored camera on every output frame.

`ArtDirection.prepare(config)` and `ArtDirection.time(prepared, seconds, channel)` are available from the library. Ink’s CLI poses animated dioramas at the held scene time. Hosts that manage their own stage updates can sample their stage at the same held time and pass the original time to the renderer. Simulation snapshots keep their requested tick.

## Motion cadence by effect

Set these rates in the same profile to hold each effect on its own beats. Rates are in frames per second from 0 to 240. Use 0 for continuous motion or omit a field to inherit the original clock.

```json
{
  "cadence": { "foliage": 8, "cloth": 4, "rain": 12, "water": 6, "emissive": 3 },
  "windResponse": { "water": 0.34, "emissive": 0.17 }
}
```

| Channel | Samples |
| --- | --- |
| `foliage` | Analytic sway, bone-carried wind motion, and falling leaves. |
| `cloth` | Tagged analytic fabric, live XPBD cloth presentation, and baked poses in the animation timeline. |
| `rain` | Rain and snow, including the fall, wind drift, and the related splash, ring, and runoff beats. |
| `water` | Water shimmer, the rippling-water preset, ring normals, and water-body reflection distortion. Use `normal: { cadence: "water", ... }` on a custom surface finish to join this clock. |
| `emissive` | Native twinkle and glow motion, and authored flicker on diorama lamps. |

Wind-aware foliage and fabric and world-space precipitation share the scene's [wind field](wind-field.md). Each effect samples that field at its own held time. Set `windResponse.water` to increase ripple distortion under gusts and `windResponse.emissive` to let a gust briefly dim flickering emissive splats. Both responses default to 0 and accept weights from 0 to 1. The headless renderer includes shelter and regional weather. WebGL uses open-air wind for its native splats and water optics.

For analytic fabric, use `KIT.procedural.airflow.pinned({ channel: "cloth", reach: 1 })` as the splat motion callback. For a live panel, `KIT.cloth(builder, { wind: "scene", ... })` connects the panel to the same authored wind as rain and foliage. XPBD continues solving between displayed poses. The CLI advances standalone cloth separately when the legacy scene clock is also held. A shared XPBD panel follows its owning solver's tick. Simulation world snapshots retain their requested tick.

The [Lantern Landing example](../examples/motion-cadence.js) uses a repeating gust and all five clocks. Export the four-second shot as a repeating PNG.

```sh
ink-studio clip examples/motion-cadence.js --from 0 --to 4 --fps 24 \
  --w 156 --h 96 --px 1 --out lantern-landing.png
```

`ArtDirection.motion(prepared, seconds, skySeconds)` reports the clocks for a host or review tool. `render(world, { artDirection, t })` applies the same profile headlessly. A host advancing a standalone `KIT.stage` can call `stage.update(dt, sceneTime, { separateCloth: true })` for scene ticks and `stage.advanceCloth(dt, time)` for its continuously advancing cloth ticks.
