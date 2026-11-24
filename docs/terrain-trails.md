# Terrain trails

`KIT.terrainTrails.create` records timed contacts on a shared UV grid.
Give the terrain art a byte material ID at each native pixel. Ink reads the
same field to paint footprint swatches, displace vegetation pixels, and draw
expanding water ripples. The scene can be scrubbed or exported from any
timestamp when the contacts for that period are available.

```js
const trail = K.terrainTrails.create({
  width: 256, height: 144,
  contacts: [{ at: [42.5, 80.5], time: 0.3, strength: 0.9 }]
});

const terrain = trail.paint({
  raster: { w: 256, h: 144, rgba: terrainPixels },
  materials: terrainIds,
  reactions: {
    1: { kind: 'print', bands: [[0.2, '#a07964'], [0.5, '#705047']] },
    2: { kind: 'press', shift: [-4, -3] },
    3: { kind: 'ripple' }
  }
});

world.look.composite = { layers: [terrain.layer(), actorLayer] };
trail.stamp({ at: [174.5, 81.5], time: 4.2, channels: ['ripple'] });
```

## Contacts and the field

- `width` and `height` define the field and art grid. `origin` defaults to
  `[0, 0]`. `cell` defaults to one coordinate unit and accepts a scalar or a
  UV pair. With those defaults, `[x + 0.5, y + 0.5]` is the center of a
  top-down art pixel. Larger scenes can use world XZ units.
- A contact accepts `at: [u, v]`, `time` in seconds, and `strength` from zero
  to one. By default it contributes to all three channels. Pass `channels`
  to choose which it writes. For example, enable `ripple` only when the foot
  lands in water. A clip or live animation controller can submit the same
  records.
- Each channel accepts `radius`, `duration`, and exponential `decay` per
  second. Ripples also accept `speed` in grid-coordinate units per second
  and `width` for the ring falloff. The default radii scale with cell size.
- `trail.field.frame(time)` exposes `sample(channel, u, v)` and
  `data(channel)` on the sampled frame. Use `print`, `press`, and `ripple`
  as channel names. `data` returns a copy of the row-major scalar grid.
  Bounds and field revision are available to custom consumers.
- A trail retains up to 1,024 contacts. A live host can call
  `prune(before)` to remove contacts that had fully expired at that time.
  Keep the source contact log if the host needs to seek earlier. `clear()`
  removes all contacts.

## Paint and playback

Supply a top-down RGBA byte raster and a matching `Uint8Array` of material
IDs. `print` and `ripple` use the highest swatch threshold reached at each
pixel. `press` pulls nearby source pixels by a whole-pixel XY shift scaled
by the pressure. It samples only opaque or partially opaque pixels of the
same material. Material IDs without reactions keep their original art.

`terrain.render(time)` returns the painted raster directly.
`terrain.layer({ rect, clock: 'scene' })` creates a nearest-filtered
[composite layer](mixed-resolution.md) for WebGL and headless export. Use
`clock: 'interface'` when marks should run during a held scene pose.
Place later layers above the terrain for actors and foreground art.

For 3D splat surfaces, set
`surfaceEffects: { fields: { trail: trail.field } }` on the world and read
the channels from separate [projected material layers](projected-effects.md)
with `space: 'world'`. Ink's headless renderer supports those projected
layers. WebGL can use the native raster paint layer for 2D terrain.

## Salt Survey

The [editable scene](../examples/terrain-trails.js) walks through silt,
reeds, and a shallow pool. Use `--params '{"trails":false}'` to compare the
same scene with its reactions disabled.

```sh
node cli/ink-studio.js clip examples/terrain-trails.js --w 256 --h 144 --px 1 \
  --from 0 --to 9.5 --fps 24 --raw --out salt-survey.png
```
